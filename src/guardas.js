function precisaLogin(req, res, next) {
  if (req.session.clienteId) return next()
  req.session.voltarPara = req.originalUrl
  res.redirect('/entrar')
}

function precisaAdmin(req, res, next) {
  if (res.locals.cliente && res.locals.cliente.is_admin) return next()
  if (!req.session.clienteId) {
    req.session.voltarPara = req.originalUrl
    return res.redirect('/entrar')
  }
  res.status(403).render('erro', { titulo: 'Sem acesso', msg: 'Essa área é só da equipe da loja.' })
}

// aviso que aparece uma vez na proxima pagina
function avisar(req, txt, tipo = 'ok') {
  req.session.aviso = { txt, tipo }
}

module.exports = { precisaLogin, precisaAdmin, avisar }
