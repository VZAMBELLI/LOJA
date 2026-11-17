const crypto = require('crypto')
const express = require('express')
const bcrypt = require('bcryptjs')
const { q, one } = require('../db')
const mail = require('../mail')
const { soDigitos } = require('../util')
const { precisaLogin, avisar } = require('../guardas')

const r = express.Router()

const CAMPOS_END = ['cep', 'rua', 'numero', 'complemento', 'bairro', 'cidade', 'uf']

function lerEndereco(body) {
  const e = {}
  for (const k of CAMPOS_END) e[k] = String(body[k] || '').trim().slice(0, 120)
  e.cep = soDigitos(e.cep).slice(0, 8)
  e.uf = e.uf.toUpperCase().slice(0, 2)
  return e
}

function cpfValido(cpf) {
  cpf = soDigitos(cpf)
  if (cpf.length !== 11 || /^(\d)\1+$/.test(cpf)) return false
  for (const t of [9, 10]) {
    let s = 0
    for (let i = 0; i < t; i++) s += Number(cpf[i]) * (t + 1 - i)
    const d = ((s * 10) % 11) % 10
    if (d !== Number(cpf[t])) return false
  }
  return true
}

function entrar(req, id) {
  return new Promise((ok, falha) => {
    const sacola = req.session.sacola
    const cupom = req.session.cupom
    const voltar = req.session.voltarPara
    // regenera a sessao (evita fixation) mas mantem a sacola
    req.session.regenerate(err => {
      if (err) return falha(err)
      req.session.clienteId = id
      req.session.sacola = sacola
      req.session.cupom = cupom
      ok(voltar)
    })
  })
}

// tentativas de login por ip, bem basico
const tentativas = new Map()
function bloqueado(ip) {
  const t = tentativas.get(ip)
  if (!t) return false
  if (Date.now() - t.em > 15 * 60_000) { tentativas.delete(ip); return false }
  return t.n >= 8
}

r.get('/cadastro', (req, res) => {
  if (req.session.clienteId) return res.redirect('/conta')
  res.render('conta/cadastro', { titulo: 'Criar conta', v: {}, erros: [] })
})

r.post('/cadastro', async (req, res) => {
  const b = req.body
  const v = {
    nome: String(b.nome || '').trim().slice(0, 100),
    email: String(b.email || '').trim().toLowerCase().slice(0, 120),
    cpf: soDigitos(b.cpf),
    telefone: soDigitos(b.telefone).slice(0, 13),
    ...lerEndereco(b),
  }
  const erros = []
  if (v.nome.split(' ').filter(Boolean).length < 2) erros.push('Coloque nome e sobrenome.')
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email)) erros.push('E-mail inválido.')
  if (!cpfValido(v.cpf)) erros.push('CPF inválido.')
  if (v.telefone.length < 10) erros.push('Telefone com DDD, por favor.')
  if (String(b.senha || '').length < 8) erros.push('A senha precisa ter pelo menos 8 caracteres.')
  if (v.cep.length !== 8 || !v.rua || !v.numero || !v.cidade || v.uf.length !== 2) erros.push('Endereço incompleto.')
  if (!erros.length && await one('select 1 from clientes where email = $1', [v.email])) erros.push('Já existe uma conta com esse e-mail. Quer entrar?')
  if (erros.length) return res.status(400).render('conta/cadastro', { titulo: 'Criar conta', v, erros })

  const hash = await bcrypt.hash(b.senha, 10)
  const c = await one(`insert into clientes (nome, email, senha_hash, cpf, telefone, cep, rua, numero, complemento, bairro, cidade, uf)
    values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning *`,
    [v.nome, v.email, hash, v.cpf, v.telefone, v.cep, v.rua, v.numero, v.complemento, v.bairro, v.cidade, v.uf])
  mail.boasVindas(c) // sem await, nao precisa esperar
  const voltar = await entrar(req, c.id)
  avisar(req, `Conta criada! Bem-vinda, ${v.nome.split(' ')[0]}.`)
  res.redirect(voltar || '/conta')
})

r.get('/entrar', (req, res) => {
  if (req.session.clienteId) return res.redirect('/conta')
  res.render('conta/entrar', { titulo: 'Entrar', email: '', erro: null })
})

r.post('/entrar', async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase()
  if (bloqueado(req.ip)) return res.status(429).render('conta/entrar', { titulo: 'Entrar', email, erro: 'Muitas tentativas. Espere 15 minutos.' })
  const c = await one('select * from clientes where email = $1', [email])
  const ok = c && await bcrypt.compare(String(req.body.senha || ''), c.senha_hash)
  if (!ok) {
    const t = tentativas.get(req.ip) || { n: 0, em: Date.now() }
    t.n++; tentativas.set(req.ip, t)
    return res.status(401).render('conta/entrar', { titulo: 'Entrar', email, erro: 'E-mail ou senha incorretos.' })
  }
  tentativas.delete(req.ip)
  const voltar = await entrar(req, c.id)
  res.redirect(voltar || (c.is_admin ? '/admin' : '/conta'))
})

r.post('/sair', (req, res) => {
  req.session.destroy(() => res.redirect('/'))
})

// ---------- esqueci a senha ----------
r.get('/esqueci', (req, res) => res.render('conta/esqueci', { titulo: 'Esqueci a senha', enviado: false }))

r.post('/esqueci', async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase()
  const c = await one('select * from clientes where email = $1', [email])
  if (c) {
    const token = crypto.randomBytes(24).toString('hex')
    await q(`insert into senha_tokens (token, cliente_id, expira_em) values ($1, $2, now() + interval '1 hour')`, [token, c.id])
    const base = (process.env.BASE_URL || process.env.RENDER_EXTERNAL_URL || 'http://localhost:3000').replace(/\/$/, '')
    await mail.redefinirSenha(c, `${base}/redefinir/${token}`)
  }
  // mesma resposta sempre, pra nao revelar quem tem conta
  res.render('conta/esqueci', { titulo: 'Esqueci a senha', enviado: true })
})

r.get('/redefinir/:token', async (req, res) => {
  const t = await one('select * from senha_tokens where token = $1 and expira_em > now()', [req.params.token])
  if (!t) return res.render('erro', { titulo: 'Link expirado', msg: 'Peça um novo link em "Esqueci a senha".' })
  res.render('conta/redefinir', { titulo: 'Nova senha', token: req.params.token, erro: null })
})

r.post('/redefinir/:token', async (req, res) => {
  const t = await one('select * from senha_tokens where token = $1 and expira_em > now()', [req.params.token])
  if (!t) return res.render('erro', { titulo: 'Link expirado', msg: 'Peça um novo link em "Esqueci a senha".' })
  if (String(req.body.senha || '').length < 8) return res.render('conta/redefinir', { titulo: 'Nova senha', token: req.params.token, erro: 'Mínimo de 8 caracteres.' })
  await q('update clientes set senha_hash = $1 where id = $2', [await bcrypt.hash(req.body.senha, 10), t.cliente_id])
  await q('delete from senha_tokens where cliente_id = $1', [t.cliente_id])
  avisar(req, 'Senha alterada. Pode entrar.')
  res.redirect('/entrar')
})

// ---------- minha conta ----------
r.get('/conta', precisaLogin, async (req, res) => {
  const c = await one('select * from clientes where id = $1', [req.session.clienteId])
  const pedidos = await q('select * from pedidos where cliente_id = $1 order by id desc limit 5', [c.id])
  res.render('conta/painel', { titulo: 'Minha conta', c, pedidos })
})

r.post('/conta', precisaLogin, async (req, res) => {
  const e = lerEndereco(req.body)
  const tel = soDigitos(req.body.telefone).slice(0, 13)
  if (e.cep.length !== 8 || !e.rua || !e.numero || !e.cidade || e.uf.length !== 2) {
    avisar(req, 'Endereço incompleto.', 'erro')
    return res.redirect('/conta')
  }
  await q(`update clientes set telefone=$1, cep=$2, rua=$3, numero=$4, complemento=$5, bairro=$6, cidade=$7, uf=$8 where id=$9`,
    [tel, e.cep, e.rua, e.numero, e.complemento, e.bairro, e.cidade, e.uf, req.session.clienteId])
  avisar(req, 'Dados atualizados.')
  res.redirect('/conta')
})

r.get('/conta/pedidos', precisaLogin, async (req, res) => {
  const pedidos = await q('select * from pedidos where cliente_id = $1 order by id desc', [req.session.clienteId])
  res.render('conta/pedidos', { titulo: 'Meus pedidos', pedidos })
})

r.get('/conta/pedidos/:id', precisaLogin, async (req, res, next) => {
  const p = await one('select * from pedidos where id = $1 and cliente_id = $2', [Number(req.params.id) || 0, req.session.clienteId])
  if (!p) return next()
  const itens = await q('select * from pedido_itens where pedido_id = $1', [p.id])
  res.render('conta/pedido', { titulo: `Pedido #${p.id}`, p, itens })
})

r.get('/conta/favoritos', precisaLogin, async (req, res) => {
  const lista = await q(`
    select p.*, true as fav,
      coalesce((select json_agg(json_build_object('id', v.id, 't', v.tamanho, 'e', v.estoque) order by v.ordem, v.id) from variantes v where v.produto_id = p.id), '[]') as tamanhos
    from favoritos f join produtos p on p.id = f.produto_id
    where f.cliente_id = $1 and p.ativo order by f.criado_em desc`, [req.session.clienteId])
  res.render('lista', { titulo: 'Favoritos', lista, busca: '', cat: null, ordemAtual: null, semFiltro: true })
})

module.exports = r
module.exports.lerEndereco = lerEndereco
