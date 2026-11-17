const express = require('express')
const { q, one } = require('../db')
const sacola = require('../sacola')
const mail = require('../mail')
const { avisar } = require('../guardas')

const r = express.Router()

// lista de produtos com 1a imagem, faixa de preco e se ta favoritado
async function listar({ where = 'true', params = [], ordem = 'p.criado_em desc', limite = 60, clienteId = null }) {
  const idx = params.length + 1
  return q(`
    select p.*, c.nome as categoria, c.slug as cat_slug,
      coalesce((select json_agg(json_build_object('id', v.id, 't', v.tamanho, 'e', v.estoque) order by v.ordem, v.id)
               from variantes v where v.produto_id = p.id), '[]') as tamanhos,
      exists(select 1 from favoritos f where f.produto_id = p.id and f.cliente_id = $${idx}) as fav
    from produtos p left join categorias c on c.id = p.categoria_id
    where p.ativo and (${where})
    order by ${ordem}
    limit ${Number(limite)}`, [...params, clienteId])
}

r.get('/', async (req, res) => {
  const cid = req.session.clienteId || null
  const [banners, destaques, novidades] = await Promise.all([
    q('select * from banners where ativo order by ordem, id'),
    listar({ where: 'p.destaque', limite: 8, clienteId: cid }),
    listar({ limite: 4, clienteId: cid }),
  ])
  res.render('home', { titulo: null, banners, destaques, novidades })
})

const ORDENS = {
  novos: 'p.criado_em desc',
  menor: 'p.preco asc',
  maior: 'p.preco desc',
}

r.get('/produtos', async (req, res) => {
  const ordem = ORDENS[req.query.ordem] || ORDENS.novos
  const busca = String(req.query.q || '').trim().slice(0, 60)
  const lista = busca
    ? await listar({ where: 'p.nome ilike $1 or p.descricao ilike $1', params: ['%' + busca + '%'], ordem, clienteId: req.session.clienteId })
    : await listar({ ordem, clienteId: req.session.clienteId, limite: 200 })
  res.render('lista', { titulo: busca ? `Busca: ${busca}` : 'Todos os produtos', lista, busca, cat: null, ordemAtual: req.query.ordem || 'novos' })
})

r.get('/c/:slug', async (req, res, next) => {
  const cat = await one('select * from categorias where slug = $1', [req.params.slug])
  if (!cat) return next()
  const ordem = ORDENS[req.query.ordem] || ORDENS.novos
  const lista = await listar({ where: 'p.categoria_id = $1', params: [cat.id], ordem, clienteId: req.session.clienteId, limite: 200 })
  res.render('lista', { titulo: cat.nome, lista, busca: '', cat, ordemAtual: req.query.ordem || 'novos' })
})

r.get('/produto/:slug', async (req, res, next) => {
  const [p] = await listar({ where: 'p.slug = $1', params: [req.params.slug], clienteId: req.session.clienteId, limite: 1 })
  if (!p) return next()
  const relacionados = p.categoria_id
    ? await listar({ where: 'p.categoria_id = $1 and p.id <> $2', params: [p.categoria_id, p.id], limite: 4, clienteId: req.session.clienteId })
    : []
  res.render('produto', { titulo: p.nome, p, relacionados })
})

// imagens ficam no banco (Render apaga arquivos a cada deploy)
r.get('/img/:id', async (req, res, next) => {
  const img = await one('select mime, dados from imagens where id = $1', [Number(req.params.id) || 0])
  if (!img) return next()
  res.set('Content-Type', img.mime)
  res.set('Cache-Control', 'public, max-age=31536000, immutable')
  res.send(img.dados)
})

r.post('/favoritos/:id', async (req, res) => {
  const quer = req.get('accept')?.includes('json')
  if (!req.session.clienteId) {
    if (quer) return res.status(401).json({ login: true })
    return res.redirect('/entrar')
  }
  const id = Number(req.params.id)
  const del = await q('delete from favoritos where cliente_id = $1 and produto_id = $2 returning 1', [req.session.clienteId, id])
  if (!del.length) await q('insert into favoritos (cliente_id, produto_id) values ($1, $2) on conflict do nothing', [req.session.clienteId, id])
  if (quer) return res.json({ fav: !del.length })
  res.redirect(req.get('referer') || '/')
})

// ---------- sacola ----------
r.get('/sacola', async (req, res) => {
  const s = await sacola.montar(req)
  res.render('sacola', { titulo: 'Sacola', s })
})

r.post('/sacola/adicionar', async (req, res) => {
  const v = Number(req.body.variante)
  const qtd = Math.max(1, Math.min(10, Number(req.body.qtd) || 1))
  const quer = req.get('accept')?.includes('json')
  const variante = await one(`select v.*, p.nome from variantes v join produtos p on p.id = v.produto_id where v.id = $1 and p.ativo`, [v])
  if (!variante || variante.estoque <= 0) {
    if (quer) return res.status(400).json({ erro: 'Esse tamanho esgotou.' })
    avisar(req, 'Esse tamanho esgotou.', 'erro')
    return res.redirect(req.get('referer') || '/')
  }
  const atual = req.session.sacola || []
  const item = atual.find(i => i.v === v)
  if (item) item.qtd = Math.min(item.qtd + qtd, variante.estoque)
  else atual.push({ v, qtd: Math.min(qtd, variante.estoque) })
  req.session.sacola = atual
  const total = atual.reduce((t, i) => t + i.qtd, 0)
  if (quer) return res.json({ ok: true, qtd: total, nome: variante.nome, tamanho: variante.tamanho })
  avisar(req, `${variante.nome} (${variante.tamanho}) foi para a sacola.`)
  res.redirect('/sacola')
})

r.post('/sacola/atualizar', (req, res) => {
  const v = Number(req.body.variante)
  const qtd = Number(req.body.qtd)
  let atual = req.session.sacola || []
  if (qtd <= 0) atual = atual.filter(i => i.v !== v)
  else atual.forEach(i => { if (i.v === v) i.qtd = Math.min(qtd, 10) })
  req.session.sacola = atual
  res.redirect('/sacola')
})

r.post('/sacola/cupom', async (req, res) => {
  const codigo = String(req.body.cupom || '').trim().toUpperCase()
  if (!codigo) { delete req.session.cupom; return res.redirect(req.get('referer') || '/sacola') }
  const v = await sacola.validarCupom(codigo, req.session.clienteId)
  if (v.ok) { req.session.cupom = codigo; avisar(req, `Cupom ${codigo} aplicado.`) }
  else avisar(req, v.msg, 'erro')
  res.redirect(req.get('referer') || '/sacola')
})

// ---------- institucionais ----------
const PAGINAS = {
  'como-comprar': 'Como comprar',
  'trocas-e-devolucoes': 'Trocas e devoluções',
  'politica-de-envio': 'Política de envio',
  'perguntas-frequentes': 'Perguntas frequentes',
  'quem-somos': 'Quem somos',
  'privacidade': 'Privacidade',
  'contato': 'Contato',
}
r.get('/p/:pagina', (req, res, next) => {
  const t = PAGINAS[req.params.pagina]
  if (!t) return next()
  res.render('paginas/' + req.params.pagina, { titulo: t })
})

r.post('/contato', async (req, res) => {
  const { nome = '', email = '', mensagem = '' } = req.body
  if (!nome.trim() || !/\S+@\S+\.\S+/.test(email) || mensagem.trim().length < 5) {
    avisar(req, 'Preencha nome, e-mail e mensagem.', 'erro')
    return res.redirect('/p/contato')
  }
  await mail.contato({ nome: nome.slice(0, 100), email: email.slice(0, 120), mensagem: mensagem.slice(0, 3000) })
  avisar(req, 'Mensagem enviada! Respondemos em até 1 dia útil.')
  res.redirect('/p/contato')
})

module.exports = r
