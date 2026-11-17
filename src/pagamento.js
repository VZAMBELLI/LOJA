const crypto = require('crypto')
const { MercadoPagoConfig, Preference, Payment } = require('mercadopago')
const { one, q, tx } = require('./db')
const mail = require('./mail')

const temMP = () => !!process.env.MP_ACCESS_TOKEN
const cliente = () => new MercadoPagoConfig({ accessToken: process.env.MP_ACCESS_TOKEN })
const base = () => (process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '')

async function criarPreferencia(pedido, comprador) {
  const body = {
    // um item so com o total: assim cupom e frete batem certinho
    items: [{
      id: String(pedido.id),
      title: `Pedido #${pedido.id} — ${process.env.LOJA_NOME || 'Meridiana'}`,
      quantity: 1,
      unit_price: Number(pedido.total),
      currency_id: 'BRL',
    }],
    payer: { email: comprador.email, name: comprador.nome },
    external_reference: String(pedido.id),
    back_urls: {
      success: `${base()}/checkout/retorno`,
      pending: `${base()}/checkout/retorno`,
      failure: `${base()}/checkout/retorno`,
    },
    payment_methods: { installments: Number(process.env.MAX_PARCELAS || 8) },
    statement_descriptor: (process.env.LOJA_NOME || 'MERIDIANA').slice(0, 13).toUpperCase(),
  }
  // MP recusa notification_url/auto_return com localhost
  if (!base().includes('localhost')) {
    body.notification_url = `${base()}/webhooks/mercadopago`
    body.auto_return = 'approved'
  }
  const pref = await new Preference(cliente()).create({ body })
  await q('update pedidos set mp_preference_id = $1 where id = $2', [pref.id, pedido.id])
  return pref.init_point
}

// marca como pago, baixa estoque e manda o email. idempotente
async function marcarPago(pedidoId, paymentId) {
  const res = await tx(async c => {
    const p = (await c.query('select * from pedidos where id = $1 for update', [pedidoId])).rows[0]
    if (!p || p.status !== 'aguardando') return null
    await c.query(`update pedidos set status = 'pago', pago_em = now(), mp_payment_id = $2 where id = $1`, [pedidoId, paymentId || null])
    const itens = (await c.query('select * from pedido_itens where pedido_id = $1', [pedidoId])).rows
    for (const i of itens) {
      await c.query('update variantes set estoque = greatest(estoque - $1, 0) where id = $2', [i.qtd, i.variante_id])
    }
    return { pedido: { ...p, status: 'pago' }, itens }
  })
  if (res) {
    const cl = await one('select * from clientes where id = $1', [res.pedido.cliente_id])
    await mail.pagamentoAprovado(cl, res.pedido, res.itens)
  }
  return !!res
}

// consulta o pagamento direto no MP (nunca confia no que veio na url/webhook)
async function conferirPagamento(paymentId) {
  const pay = await new Payment(cliente()).get({ id: paymentId })
  const pedidoId = Number(pay.external_reference)
  if (!pedidoId) return null
  if (pay.status === 'approved') {
    const pedido = await one('select total from pedidos where id = $1', [pedidoId])
    // valor tem que bater
    if (pedido && Math.abs(Number(pedido.total) - Number(pay.transaction_amount)) < 0.01) {
      await marcarPago(pedidoId, String(pay.id))
    } else {
      console.warn('valor do pagamento nao bate com o pedido', pedidoId, pay.transaction_amount)
    }
  } else if (['rejected', 'cancelled'].includes(pay.status)) {
    await q(`update pedidos set mp_payment_id = $2 where id = $1 and status = 'aguardando'`, [pedidoId, String(pay.id)])
  }
  return { pedidoId, status: pay.status }
}

// https://www.mercadopago.com.br/developers/pt/docs/your-integrations/notifications/webhooks
function assinaturaValida(req, dataId) {
  const segredo = process.env.MP_WEBHOOK_SECRET
  if (!segredo) return true // sem segredo configurado, confia na consulta ao MP
  const sig = req.get('x-signature') || ''
  const reqId = req.get('x-request-id') || ''
  const partes = Object.fromEntries(sig.split(',').map(s => s.trim().split('=')))
  if (!partes.ts || !partes.v1) return false
  const manifesto = `id:${String(dataId).toLowerCase()};request-id:${reqId};ts:${partes.ts};`
  const h = crypto.createHmac('sha256', segredo).update(manifesto).digest('hex')
  try {
    return crypto.timingSafeEqual(Buffer.from(h), Buffer.from(partes.v1))
  } catch { return false }
}

module.exports = { temMP, criarPreferencia, marcarPago, conferirPagamento, assinaturaValida }
