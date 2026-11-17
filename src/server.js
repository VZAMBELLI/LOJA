require('dotenv').config()
const path = require('path')
const express = require('express')
const session = require('express-session')
const PgSession = require('connect-pg-simple')(session)
const { pool, q, criarTabelas } = require('./db')
const { brl, STATUS } = require('./util')

const app = express()
const PROD = process.env.NODE_ENV === 'production'

app.set('view engine', 'ejs')
app.set('views', path.join(__dirname, '..', 'views'))
app.set('trust proxy', 1) // render/railway ficam atras de proxy
app.disable('x-powered-by')

app.use('/static', express.static(path.join(__dirname, '..', 'public'), { maxAge: PROD ? '7d' : 0 }))
app.use(express.urlencoded({ extended: false, limit: '200kb' }))
app.use(express.json({ limit: '200kb' }))

app.use(session({
  store: new PgSession({ pool, createTableIfMissing: true }),
  secret: process.env.SESSION_SECRET || 'troca-isso-em-producao',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', secure: PROD, maxAge: 1000 * 60 * 60 * 24 * 30 },
}))

// cache simples das categorias pro menu
let catsCache = { em: 0, lista: [] }
async function categoriasMenu() {
  if (Date.now() - catsCache.em > 60_000) {
    catsCache = { em: Date.now(), lista: await q('select * from categorias order by ordem, nome') }
  }
  return catsCache.lista
}
app.locals.limparCacheCategorias = () => { catsCache.em = 0 }

app.use(async (req, res, next) => {
  try {
    res.locals.cliente = null
    if (req.session.clienteId) {
      const r = await q('select id, nome, email, is_admin from clientes where id = $1', [req.session.clienteId])
      res.locals.cliente = r[0] || null
      if (!r[0]) delete req.session.clienteId
    }
    res.locals.qtdSacola = (req.session.sacola || []).reduce((t, i) => t + i.qtd, 0)
    res.locals.categorias = await categoriasMenu()
    res.locals.loja = {
      nome: process.env.LOJA_NOME || 'Meridiana',
      whatsapp: process.env.LOJA_WHATSAPP || '',
      email: process.env.LOJA_EMAIL || '',
      parcelas: Number(process.env.MAX_PARCELAS || 8),
      freteGratis: Number(process.env.FRETE_GRATIS_ACIMA || 399),
    }
    res.locals.brl = brl
    res.locals.STATUS = STATUS
    res.locals.caminho = req.path
    res.locals.aviso = req.session.aviso || null
    delete req.session.aviso
    next()
  } catch (e) { next(e) }
})

app.use(require('./rotas/loja'))
app.use(require('./rotas/conta'))
app.use(require('./rotas/checkout'))
app.use('/admin', require('./rotas/admin'))

app.use((req, res) => res.status(404).render('erro', { titulo: 'Página não encontrada', msg: 'O link pode ter mudado ou a peça saiu do ar.' }))
app.use((err, req, res, next) => {
  console.error(err)
  res.status(500).render('erro', { titulo: 'Algo deu errado', msg: 'Tente de novo em instantes.' })
})

const porta = process.env.PORT || 3000
criarTabelas()
  .then(() => app.listen(porta, () => console.log(`loja no ar: http://localhost:${porta}`)))
  .catch(e => { console.error('nao consegui conectar no banco', e.message); process.exit(1) })
