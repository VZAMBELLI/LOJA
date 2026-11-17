const fs = require('fs')
const path = require('path')
const { Pool } = require('pg')

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Neon / Render pedem ssl, local nao
  ssl: process.env.DATABASE_SSL === '1' ? { rejectUnauthorized: false } : false,
})

async function q(sql, params) {
  return (await pool.query(sql, params)).rows
}
async function one(sql, params) {
  return (await pool.query(sql, params)).rows[0]
}

// transacao simples, sem firula
async function tx(fn) {
  const c = await pool.connect()
  try {
    await c.query('begin')
    const r = await fn(c)
    await c.query('commit')
    return r
  } catch (e) {
    await c.query('rollback')
    throw e
  } finally {
    c.release()
  }
}

async function criarTabelas() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8')
  await pool.query(sql)
}

module.exports = { pool, q, one, tx, criarTabelas }
