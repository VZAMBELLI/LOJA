const express = require('express')
const { q, one, tx } = require('../db')
const sacola = require('../sacola')
const pg = require('../pagamento')
const { precisaLogin, avisar } = require('../guardas')
const { lerEndereco } = require('./conta')

const r = express.Router()

r.get('/checkout', precisaLogin, async (req, res) => {
  const c = await one('select * from clientes where id = $1', [req.session.clienteId])
  const s = await sacola.montar(req, c.uf)
  if (!s.itens.length) return res.redirect('/sacola')
  res.render('checkout', { titulo: 'Finalizar compra', c, s, modoTeste: !pg.temMP() })
})

// recalcula o frete quando a pessoa muda o CEP no checkout
r.get('/api/frete', async (req, res) => {
  const s = await sacola.montar(req, String(req.query.uf || '').toUpperCase())
  res.json({ frete: s.frete, total: s.total })
})

r.post('/checkout', precisaLogin, async (req, res) => {
  const c = await one('select * from clientes where id = $1', [req.session.clienteId])
  const end = lerEndereco(req.body)
  if (end.cep.length !== 8 || !end.rua || !end.numero || !end.cidade || end.uf.length !== 2) {
    avisar(req, 'Confira o endereço de entrega.', 'erro')
    return res.redirect('/checkout')
  }
  const s = await sacola.montar(req, end.uf)
  if (!s.itens.length) return res.redirect('/sacola')

  const pedido = await tx(async db => {
    const p = (await db.query(`insert into pedidos (cliente_id, subtotal, desconto, frete, total, cupom, endereco)
      values ($1,$2,$3,$4,$5,$6,$7) returning *`,
      [c.id, s.subtotal, s.desconto, s.frete, s.total, s.cupom?.codigo || null, { ...end, nome: c.nome, telefone: c.telefone }])).rows[0]
    for (const i of s.itens) {
      await db.query(`insert into pedido_itens (pedido_id, produto_id, variante_id, nome, tamanho, preco, qtd) values ($1,$2,$3,$4,$5,$6,$7)`,
        [p.id, i.produto_id, i.variante_id, i.nome, i.tamanho, i.preco, i.qtd])
    }
    return p
  })

  // sacola zera assim que o pedido existe; se nao pagar, fica "aguardando" na conta
  req.session.sacola = []
  delete req.session.cupom
  req.session.ultimoPedido = pedido.id

  if (!pg.temMP()) return res.redirect(`/checkout/teste/${pedido.id}`)
  try {
    const url = await pg.criarPreferencia(pedido, c)
    res.redirect(url)
  } catch (e) {
    console.error('erro Mercado Pago', e.message)
    avisar(req, 'Não conseguimos abrir o pagamento agora. Tente de novo pelo pedido.', 'erro')
    res.redirect(`/conta/pedidos/${pedido.id}`)
  }
})

// pagar de novo um pedido que ficou aguardando
r.post('/checkout/pagar/:id', precisaLogin, async (req, res, next) => {
  const p = await one(`select * from pedidos where id = $1 and cliente_id = $2 and status = 'aguardando'`, [Number(req.params.id) || 0, req.session.clienteId])
  if (!p) return next()
  if (!pg.temMP()) return res.redirect(`/checkout/teste/${p.id}`)
  const c = await one('select * from clientes where id = $1', [p.cliente_id])
  try {
    res.redirect(await pg.criarPreferencia(p, c))
  } catch (e) {
    console.error('erro Mercado Pago', e.message)
    avisar(req, 'Não conseguimos abrir o pagamento agora. Tente de novo em instantes.', 'erro')
    res.redirect(`/conta/pedidos/${p.id}`)
  }
})

// volta do Mercado Pago
r.get('/checkout/retorno', async (req, res) => {
  const paymentId = req.query.payment_id || req.query.collection_id
  let pedidoId = Number(req.query.external_reference) || req.session.ultimoPedido
  let status = req.query.status || req.query.collection_status
  if (paymentId && paymentId !== 'null' && pg.temMP()) {
    try {
      const r2 = await pg.conferirPagamento(paymentId)
      if (r2) { pedidoId = r2.pedidoId; status = r2.status }
    } catch (e) { console.error('conferir pagamento', e.message) }
  }
  res.render('retorno', { titulo: 'Pedido', pedidoId, status })
})

// MP manda POST aqui quando o pagamento muda
r.post('/webhooks/mercadopago', async (req, res) => {
  const tipo = req.body?.type || req.query.type || req.query.topic
  const id = req.body?.data?.id || req.query['data.id'] || req.query.id
  res.sendStatus(200) // responde logo, MP reenvia se demorar
  if (tipo !== 'payment' || !id || !pg.temMP()) return
  if (!pg.assinaturaValida(req, id)) return console.warn('webhook com assinatura invalida')
  try { await pg.conferirPagamento(id) } catch (e) { console.error('webhook', e.message) }
})

// ---------- modo teste (sem MP_ACCESS_TOKEN) ----------
r.get('/checkout/teste/:id', precisaLogin, async (req, res, next) => {
  if (pg.temMP()) return next()
  const p = await one('select * from pedidos where id = $1 and cliente_id = $2', [Number(req.params.id) || 0, req.session.clienteId])
  if (!p) return next()
  res.render('pagamento-teste', { titulo: 'Pagamento de teste', p })
})

r.post('/checkout/teste/:id', precisaLogin, async (req, res, next) => {
  if (pg.temMP()) return next()
  const p = await one('select * from pedidos where id = $1 and cliente_id = $2', [Number(req.params.id) || 0, req.session.clienteId])
  if (!p) return next()
  await pg.marcarPago(p.id, 'teste-' + Date.now())
  res.redirect(`/checkout/retorno?external_reference=${p.id}&status=approved`)
})

module.exports = r
