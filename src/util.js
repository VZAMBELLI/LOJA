function brl(v) {
  return 'R$ ' + Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function slugify(s) {
  return String(s)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
}

function soDigitos(s) { return String(s || '').replace(/\D/g, '') }

// escape pro html dos emails (as views usam <%= que ja escapa)
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}

const STATUS = {
  aguardando: 'Aguardando pagamento',
  pago: 'Pago · em separação',
  enviado: 'Enviado',
  cancelado: 'Cancelado',
}

module.exports = { brl, slugify, soDigitos, esc, STATUS }
