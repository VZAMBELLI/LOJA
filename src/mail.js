const nodemailer = require('nodemailer')
const { brl, esc } = require('./util')

let transporte
function tr() {
  if (transporte) return transporte
  if (process.env.SMTP_HOST) {
    transporte = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: Number(process.env.SMTP_PORT) === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    })
  } else {
    // sem SMTP configurado: so mostra no terminal
    transporte = nodemailer.createTransport({ jsonTransport: true })
  }
  return transporte
}

const NOME = () => process.env.LOJA_NOME || 'Meridiana'
const URL = () => (process.env.BASE_URL || process.env.RENDER_EXTERNAL_URL || 'http://localhost:3000').replace(/\/$/, '')

function moldura(titulo, corpo) {
  return `<!doctype html><html><body style="margin:0;background:#EEEDEB;font-family:Helvetica,Arial,sans-serif;color:#1B1B1B">
  <div style="max-width:560px;margin:0 auto;padding:32px 20px">
    <div style="font-size:20px;letter-spacing:6px;text-transform:uppercase">${esc(NOME())}<span style="color:#C2577E">.</span></div>
    <div style="background:#fff;margin-top:20px;padding:32px 28px">
      <h1 style="font-weight:400;font-size:24px;margin:0 0 16px">${titulo}</h1>
      ${corpo}
    </div>
    <p style="font-size:12px;color:#6B6966;margin-top:18px">Você recebeu este e-mail por ter uma conta em ${esc(NOME())}.</p>
  </div></body></html>`
}

function botao(href, txt) {
  return `<a href="${href}" style="display:inline-block;background:#1B1B1B;color:#fff;text-decoration:none;padding:13px 28px;border-radius:999px;font-size:14px;margin-top:12px">${txt}</a>`
}

async function enviar(para, assunto, html) {
  try {
    const info = await tr().sendMail({
      from: process.env.SMTP_FROM || `${NOME()} <no-reply@exemplo.com>`,
      to: para, subject: assunto, html,
    })
    if (!process.env.SMTP_HOST) console.log('[email simulado] para:', para, '|', assunto)
    return info
  } catch (e) {
    // email falhar nao pode derrubar o pedido
    console.error('falha ao enviar email', para, e.message)
  }
}

function tabelaItens(itens) {
  return `<table style="width:100%;border-collapse:collapse;font-size:14px;margin:16px 0">` +
    itens.map(i => `<tr><td style="padding:8px 0;border-bottom:1px solid #eee">${esc(i.nome)} · ${esc(i.tamanho)} × ${i.qtd}</td>
      <td style="padding:8px 0;border-bottom:1px solid #eee;text-align:right">${brl(i.preco * i.qtd)}</td></tr>`).join('') +
    `</table>`
}

module.exports = {
  boasVindas: c => enviar(c.email, `Bem-vinda à ${NOME()}`, moldura(`Oi, ${esc(c.nome.split(' ')[0])}!`,
    `<p>Sua conta foi criada. Na primeira compra, use o cupom <b>BEMVINDA</b> e ganhe 5% de desconto.</p>${botao(URL() + '/produtos', 'Ver a loja')}`)),

  pagamentoAprovado: (c, pedido, itens) => enviar(c.email, `Pedido #${pedido.id} confirmado`, moldura('Pagamento aprovado',
    `<p>Recebemos o pagamento do pedido <b>#${pedido.id}</b>. Já estamos separando suas peças.</p>
    ${tabelaItens(itens)}
    <p style="font-size:14px">Frete: ${brl(pedido.frete)}${Number(pedido.desconto) ? ` · Desconto: −${brl(pedido.desconto)}` : ''}<br><b>Total: ${brl(pedido.total)}</b></p>
    <p style="font-size:14px;color:#6B6966">Entrega em: ${esc(pedido.endereco.rua)}, ${esc(pedido.endereco.numero)} — ${esc(pedido.endereco.cidade)}/${esc(pedido.endereco.uf)}</p>
    ${botao(URL() + '/conta/pedidos/' + pedido.id, 'Acompanhar pedido')}`)),

  pedidoEnviado: (c, pedido) => enviar(c.email, `Pedido #${pedido.id} a caminho`, moldura('Seu pedido saiu para entrega',
    `<p>O pedido <b>#${pedido.id}</b> foi postado.</p><p>Código de rastreio: <b>${esc(pedido.rastreio)}</b></p>
    ${botao('https://rastreamento.correios.com.br/app/index.php', 'Rastrear')}`)),

  redefinirSenha: (c, link) => enviar(c.email, 'Redefinir sua senha', moldura('Redefinir senha',
    `<p>Alguém pediu para redefinir a senha da sua conta. Se foi você, clique abaixo (o link vale 1 hora).</p>${botao(link, 'Criar nova senha')}
    <p style="font-size:13px;color:#6B6966;margin-top:18px">Se não foi você, ignore este e-mail.</p>`)),

  contato: (dados) => enviar(process.env.LOJA_EMAIL || process.env.SMTP_USER, `Contato pelo site: ${dados.nome}`,
    moldura('Nova mensagem', `<p><b>${esc(dados.nome)}</b> &lt;${esc(dados.email)}&gt;</p><p style="white-space:pre-line">${esc(dados.mensagem)}</p>`)),
}
