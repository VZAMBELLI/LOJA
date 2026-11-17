const express = require('express')
const multer = require('multer')
const { q, one, tx } = require('../db')
const mail = require('../mail')
const { slugify } = require('../util')
const { precisaAdmin, avisar } = require('../guardas')

const r = express.Router()
r.use(precisaAdmin)

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 4 * 1024 * 1024, files: 8 },
  fileFilter: (req, f, cb) => cb(null, /^image\/(jpeg|png|webp|avif)$/.test(f.mimetype)),
})

async function salvarImagens(files) {
  const ids = []
  for (const f of files || []) {
    const row = await one('insert into imagens (mime, dados) values ($1, $2) returning id', [f.mimetype, f.buffer])
    ids.push(row.id)
  }
  return ids
}

r.get('/', async (req, res) => {
  const [resumo] = await q(`
    select
      count(*) filter (where status = 'pago') as a_enviar,
      count(*) filter (where status = 'aguardando' and criado_em > now() - interval '3 days') as aguardando,
      coalesce(sum(total) filter (where status in ('pago','enviado') and pago_em > date_trunc('month', now())), 0) as mes,
      count(*) filter (where status in ('pago','enviado') and pago_em > date_trunc('month', now())) as pedidos_mes
    from pedidos`)
  const recentes = await q(`select p.*, c.nome from pedidos p join clientes c on c.id = p.cliente_id order by p.id desc limit 10`)
  const baixo = await q(`select p.nome, p.id, v.tamanho, v.estoque from variantes v join produtos p on p.id = v.produto_id where p.ativo and v.estoque <= 1 order by v.estoque, p.nome limit 12`)
  res.render('admin/inicio', { titulo: 'Painel', resumo, recentes, baixo })
})

// ---------- produtos ----------
r.get('/produtos', async (req, res) => {
  const lista = await q(`
    select p.*, c.nome as categoria,
      (select coalesce(sum(estoque), 0) from variantes v where v.produto_id = p.id) as estoque
    from produtos p left join categorias c on c.id = p.categoria_id order by p.ativo desc, p.id desc`)
  res.render('admin/produtos', { titulo: 'Produtos', lista })
})

function lerTamanhos(txt) {
  // formato: "P:3, M:5, G:0"
  return String(txt || '').split(/[,\n;]/).map(s => s.trim()).filter(Boolean).map((s, i) => {
    const [t, e] = s.split(':').map(x => x.trim())
    return { tamanho: t.toUpperCase().slice(0, 10), estoque: Math.max(0, parseInt(e, 10) || 0), ordem: i }
  }).filter(t => t.tamanho)
}

r.get('/produtos/novo', (req, res) => {
  res.render('admin/produto-form', { titulo: 'Novo produto', p: { tamanhosTxt: 'PP:0, P:0, M:0, G:0, GG:0', imagens: [], ativo: true }, erro: null })
})

r.get('/produtos/:id', async (req, res, next) => {
  const p = await one('select * from produtos where id = $1', [Number(req.params.id) || 0])
  if (!p) return next()
  const vs = await q('select * from variantes where produto_id = $1 order by ordem, id', [p.id])
  p.tamanhosTxt = vs.map(v => `${v.tamanho}:${v.estoque}`).join(', ')
  res.render('admin/produto-form', { titulo: p.nome, p, erro: null })
})

r.post('/produtos/salvar', upload.array('fotos', 8), async (req, res) => {
  const b = req.body
  const id = Number(b.id) || null
  const dados = {
    nome: String(b.nome || '').trim().slice(0, 140),
    categoria_id: Number(b.categoria_id) || null,
    descricao: String(b.descricao || '').slice(0, 4000),
    preco: Number(String(b.preco).replace(/\./g, '').replace(',', '.')),
    preco_antigo: b.preco_antigo ? Number(String(b.preco_antigo).replace(/\./g, '').replace(',', '.')) : null,
    destaque: b.destaque === 'on',
    ativo: b.ativo === 'on',
  }
  const tamanhos = lerTamanhos(b.tamanhos)
  if (!dados.nome || !(dados.preco > 0) || !tamanhos.length) {
    return res.status(400).render('admin/produto-form', { titulo: 'Produto', p: { ...dados, id, tamanhosTxt: b.tamanhos, imagens: [] }, erro: 'Nome, preço e pelo menos um tamanho são obrigatórios.' })
  }
  const novas = await salvarImagens(req.files)
  const remover = [].concat(b.remover || []).map(Number)

  const salvo = await tx(async db => {
    let p
    if (id) {
      const atual = (await db.query('select imagens from produtos where id = $1', [id])).rows[0]
      const imgs = atual.imagens.filter(i => !remover.includes(i)).concat(novas)
      p = (await db.query(`update produtos set nome=$1, categoria_id=$2, descricao=$3, preco=$4, preco_antigo=$5, destaque=$6, ativo=$7, imagens=$8 where id=$9 returning *`,
        [dados.nome, dados.categoria_id, dados.descricao, dados.preco, dados.preco_antigo, dados.destaque, dados.ativo, imgs, id])).rows[0]
    } else {
      let slug = slugify(dados.nome)
      const existe = (await db.query('select 1 from produtos where slug = $1', [slug])).rows.length
      if (existe) slug += '-' + Date.now().toString(36).slice(-4)
      p = (await db.query(`insert into produtos (nome, slug, categoria_id, descricao, preco, preco_antigo, destaque, ativo, imagens) values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning *`,
        [dados.nome, slug, dados.categoria_id, dados.descricao, dados.preco, dados.preco_antigo, dados.destaque, dados.ativo, novas])).rows[0]
    }
    // atualiza tamanhos sem apagar os que tem pedido (so zera)
    const nomes = tamanhos.map(t => t.tamanho)
    await db.query('update variantes set estoque = 0 where produto_id = $1 and not (tamanho = any($2))', [p.id, nomes])
    for (const t of tamanhos) {
      await db.query(`insert into variantes (produto_id, tamanho, estoque, ordem) values ($1,$2,$3,$4)
        on conflict (produto_id, tamanho) do update set estoque = excluded.estoque, ordem = excluded.ordem`, [p.id, t.tamanho, t.estoque, t.ordem])
    }
    return p
  })
  if (remover.length) await q('delete from imagens where id = any($1) and not exists (select 1 from produtos where id <> $2 and imagens && $1::int[])', [remover, salvo.id])
  avisar(req, 'Produto salvo.')
  res.redirect('/admin/produtos/' + salvo.id)
})

// ---------- pedidos ----------
r.get('/pedidos', async (req, res) => {
  const st = ['aguardando', 'pago', 'enviado', 'cancelado'].includes(req.query.status) ? req.query.status : null
  const lista = await q(`select p.*, c.nome, c.email from pedidos p join clientes c on c.id = p.cliente_id
    where ($1::text is null or p.status = $1) order by p.id desc limit 300`, [st])
  res.render('admin/pedidos', { titulo: 'Pedidos', lista, st })
})

r.get('/pedidos/:id', async (req, res, next) => {
  const p = await one(`select p.*, c.nome, c.email, c.cpf, c.telefone from pedidos p join clientes c on c.id = p.cliente_id where p.id = $1`, [Number(req.params.id) || 0])
  if (!p) return next()
  const itens = await q('select * from pedido_itens where pedido_id = $1', [p.id])
  res.render('admin/pedido', { titulo: `Pedido #${p.id}`, p, itens })
})

r.post('/pedidos/:id/enviar', async (req, res) => {
  const rastreio = String(req.body.rastreio || '').trim().toUpperCase().slice(0, 40)
  if (!rastreio) { avisar(req, 'Coloque o código de rastreio.', 'erro'); return res.redirect('/admin/pedidos/' + req.params.id) }
  const p = await one(`update pedidos set status = 'enviado', rastreio = $1, enviado_em = now() where id = $2 and status in ('pago','enviado') returning *`, [rastreio, Number(req.params.id)])
  if (p) {
    const c = await one('select * from clientes where id = $1', [p.cliente_id])
    await mail.pedidoEnviado(c, p)
    avisar(req, 'Marcado como enviado. A cliente recebeu o rastreio por e-mail.')
  }
  res.redirect('/admin/pedidos/' + req.params.id)
})

r.post('/pedidos/:id/cancelar', async (req, res) => {
  // devolve estoque se ja tinha baixado
  await tx(async db => {
    const p = (await db.query('select * from pedidos where id = $1 for update', [Number(req.params.id)])).rows[0]
    if (!p || p.status === 'cancelado') return
    if (p.status === 'pago' || p.status === 'enviado') {
      const itens = (await db.query('select * from pedido_itens where pedido_id = $1', [p.id])).rows
      for (const i of itens) await db.query('update variantes set estoque = estoque + $1 where id = $2', [i.qtd, i.variante_id])
    }
    await db.query(`update pedidos set status = 'cancelado' where id = $1`, [p.id])
  })
  avisar(req, 'Pedido cancelado. Se já foi pago, faça o estorno no painel do Mercado Pago.')
  res.redirect('/admin/pedidos/' + req.params.id)
})

// ---------- categorias, cupons, banners, clientes ----------
r.get('/loja', async (req, res) => {
  const [cats, cupons, banners] = await Promise.all([
    q('select c.*, (select count(*) from produtos p where p.categoria_id = c.id) as n from categorias c order by ordem, nome'),
    q('select * from cupons order by codigo'),
    q('select * from banners order by ordem, id'),
  ])
  res.render('admin/loja', { titulo: 'Categorias, cupons e banners', cats, cupons, banners })
})

r.post('/categorias', async (req, res) => {
  const nome = String(req.body.nome || '').trim().slice(0, 60)
  if (nome) await q('insert into categorias (nome, slug, ordem) values ($1, $2, $3) on conflict (slug) do nothing', [nome, slugify(nome), Number(req.body.ordem) || 0])
  req.app.locals.limparCacheCategorias()
  res.redirect('/admin/loja')
})

r.post('/categorias/:id/excluir', async (req, res) => {
  await q('delete from categorias where id = $1', [Number(req.params.id)])
  req.app.locals.limparCacheCategorias()
  res.redirect('/admin/loja')
})

r.post('/cupons', async (req, res) => {
  const codigo = String(req.body.codigo || '').trim().toUpperCase().replace(/\s/g, '').slice(0, 30)
  const pct = Number(String(req.body.percentual).replace(',', '.'))
  if (codigo && pct > 0 && pct <= 90) {
    await q(`insert into cupons (codigo, percentual, so_primeira_compra, valido_ate) values ($1,$2,$3,$4)
      on conflict (codigo) do update set percentual = excluded.percentual, so_primeira_compra = excluded.so_primeira_compra, valido_ate = excluded.valido_ate, ativo = true`,
      [codigo, pct, req.body.primeira === 'on', req.body.valido_ate || null])
  }
  res.redirect('/admin/loja')
})

r.post('/cupons/:codigo/alternar', async (req, res) => {
  await q('update cupons set ativo = not ativo where codigo = $1', [req.params.codigo])
  res.redirect('/admin/loja')
})

r.post('/banners', upload.single('imagem'), async (req, res) => {
  const [img] = await salvarImagens(req.file ? [req.file] : [])
  await q('insert into banners (titulo, subtitulo, link, ordem, imagem_id) values ($1,$2,$3,$4,$5)',
    [String(req.body.titulo || '').slice(0, 80), String(req.body.subtitulo || '').slice(0, 140), String(req.body.link || '/produtos').slice(0, 200), Number(req.body.ordem) || 0, img || null])
  res.redirect('/admin/loja')
})

r.post('/banners/:id/excluir', async (req, res) => {
  await q('delete from banners where id = $1', [Number(req.params.id)])
  res.redirect('/admin/loja')
})

r.get('/clientes', async (req, res) => {
  const lista = await q(`select c.*, (select count(*) from pedidos p where p.cliente_id = c.id and p.status in ('pago','enviado')) as compras
    from clientes c order by c.id desc limit 500`)
  res.render('admin/clientes', { titulo: 'Clientes', lista })
})

module.exports = r
