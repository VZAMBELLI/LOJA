// npm run seed  -> categorias, cupom BEMVINDA, produtos de exemplo e a conta admin
require('dotenv').config()
const bcrypt = require('bcryptjs')
const { q, one, pool, criarTabelas } = require('./db')
const { slugify } = require('./util')

const CATS = ['Vestidos', 'Blusas', 'Conjuntos', 'Casacos e blazers', 'Saias', 'Calças', 'Acessórios']

// exemplos so pra loja nao abrir vazia. apagar/desativar no painel
const EXEMPLOS = [
  ['Vestido longo de franjas', 'Vestidos', 389.9, 449.9, true],
  ['Vestido midi acetinado', 'Vestidos', 329.9, null, true],
  ['Vestido tubinho canelado', 'Vestidos', 249.9, null, false],
  ['Blusa gola alta com botões', 'Blusas', 189.9, null, true],
  ['Camisa de cetim', 'Blusas', 219.9, null, false],
  ['Conjunto couro ecológico', 'Conjuntos', 549.9, null, true],
  ['Conjunto alfaiataria grafite', 'Conjuntos', 479.9, null, true],
  ['Casaco transpassado de lã com cinto', 'Casacos e blazers', 689.9, null, true],
  ['Blazer estruturado', 'Casacos e blazers', 429.9, null, false],
  ['Saia lápis em couro', 'Saias', 259.9, null, true],
  ['Calça pantalona', 'Calças', 299.9, null, false],
  ['Bolsa baguete', 'Acessórios', 199.9, null, false],
]

async function main() {
  await criarTabelas()

  for (const [i, nome] of CATS.entries()) {
    await q('insert into categorias (nome, slug, ordem) values ($1,$2,$3) on conflict (slug) do nothing', [nome, slugify(nome), i])
  }

  await q(`insert into cupons (codigo, percentual, so_primeira_compra) values ('BEMVINDA', 5, true) on conflict do nothing`)

  const temProduto = await one('select 1 from produtos limit 1')
  if (!temProduto) {
    for (const [nome, cat, preco, antigo, destaque] of EXEMPLOS) {
      const c = await one('select id from categorias where nome = $1', [cat])
      const p = await one(`insert into produtos (nome, slug, categoria_id, descricao, preco, preco_antigo, destaque)
        values ($1,$2,$3,$4,$5,$6,$7) returning id`,
        [nome, slugify(nome), c.id, 'Descrição da peça: tecido, caimento, cuidados e medidas da modelo.', preco, antigo, destaque])
      const tams = cat === 'Acessórios' ? ['ÚNICO'] : ['PP', 'P', 'M', 'G', 'GG']
      for (const [j, t] of tams.entries()) {
        await q('insert into variantes (produto_id, tamanho, estoque, ordem) values ($1,$2,$3,$4)', [p.id, t, j === 0 ? 1 : 4, j])
      }
    }
    await q(`insert into banners (titulo, subtitulo, link, ordem) values
      ('Nova coleção', 'Essências de verão', '/c/vestidos', 0),
      ('5% na primeira compra', 'Use o cupom BEMVINDA', '/produtos', 1)`)
    console.log('produtos de exemplo criados')
  }

  const email = (process.env.ADMIN_EMAIL || '').toLowerCase()
  if (email && process.env.ADMIN_SENHA) {
    const hash = await bcrypt.hash(process.env.ADMIN_SENHA, 10)
    await q(`insert into clientes (nome, email, senha_hash, is_admin) values ('Administração', $1, $2, true)
      on conflict (email) do update set is_admin = true, senha_hash = excluded.senha_hash`, [email, hash])
    console.log('admin pronto:', email)
  } else {
    console.log('ADMIN_EMAIL/ADMIN_SENHA nao definidos no .env — sem admin por enquanto')
  }
  await pool.end()
}

main().catch(e => { console.error(e); process.exit(1) })
