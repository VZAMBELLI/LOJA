const { q, one } = require('./db')

// regra de frete bem simples por estado.
// TODO: trocar por Melhor Envio quando tiver conta (cotacao real Correios/Jadlog)
const FRETE_UF = {
  SP: 19.9,
  RJ: 24.9, MG: 24.9, ES: 24.9, PR: 24.9, SC: 24.9, RS: 24.9,
  DF: 29.9, GO: 29.9, MS: 29.9, MT: 29.9,
}
const FRETE_PADRAO = 34.9

function calcFrete(uf, subtotal) {
  const gratis = Number(process.env.FRETE_GRATIS_ACIMA || 399)
  if (!uf) return null
  if (gratis > 0 && subtotal >= gratis) return 0
  return FRETE_UF[String(uf).toUpperCase()] ?? FRETE_PADRAO
}

async function validarCupom(codigo, clienteId) {
  if (!codigo) return { ok: false }
  const c = await one('select * from cupons where codigo = $1 and ativo', [codigo.trim().toUpperCase()])
  if (!c) return { ok: false, msg: 'Cupom inválido.' }
  if (c.valido_ate && new Date(c.valido_ate) < new Date(new Date().toDateString())) return { ok: false, msg: 'Esse cupom expirou.' }
  if (c.so_primeira_compra && clienteId) {
    const ja = await one(`select 1 from pedidos where cliente_id = $1 and status in ('pago','enviado') limit 1`, [clienteId])
    if (ja) return { ok: false, msg: 'Esse cupom vale só na primeira compra.' }
  }
  return { ok: true, cupom: c }
}

// monta a sacola a partir da sessao: precos SEMPRE do banco
async function montar(req, uf) {
  const bruta = req.session.sacola || []
  if (!bruta.length) return { itens: [], subtotal: 0, desconto: 0, frete: null, total: 0, qtd: 0, cupom: null }

  const ids = bruta.map(i => i.v)
  const rows = await q(`
    select v.id as variante_id, v.tamanho, v.estoque, p.id as produto_id, p.nome, p.slug, p.preco, p.imagens
    from variantes v join produtos p on p.id = v.produto_id
    where v.id = any($1) and p.ativo`, [ids])
  const porId = Object.fromEntries(rows.map(r => [r.variante_id, r]))

  const itens = []
  for (const i of bruta) {
    const r = porId[i.v]
    if (!r) continue // produto saiu do ar
    const qtd = Math.min(i.qtd, Math.max(r.estoque, 0))
    if (qtd <= 0) continue
    itens.push({ ...r, qtd, preco: Number(r.preco), total: Number(r.preco) * qtd })
  }
  // limpa o que sumiu / ajusta qtd
  req.session.sacola = itens.map(i => ({ v: i.variante_id, qtd: i.qtd }))

  const subtotal = itens.reduce((t, i) => t + i.total, 0)
  let cupom = null, desconto = 0
  if (req.session.cupom) {
    const r = await validarCupom(req.session.cupom, req.session.clienteId)
    if (r.ok) {
      cupom = r.cupom
      desconto = Math.round(subtotal * Number(cupom.percentual)) / 100
    } else {
      delete req.session.cupom
    }
  }
  const frete = calcFrete(uf, subtotal - desconto)
  const total = subtotal - desconto + (frete || 0)
  return { itens, subtotal, desconto, frete, total, qtd: itens.reduce((t, i) => t + i.qtd, 0), cupom }
}

module.exports = { montar, validarCupom, calcFrete }
