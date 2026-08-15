import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations')

export async function runMigrations(pool: pg.Pool): Promise<string[]> {
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`)
  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort()
  const applied = new Set(
    (await pool.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name as string),
  )
  const ran: string[] = []
  for (const file of files) {
    if (applied.has(file)) continue
    const sql = await readFile(path.join(MIGRATIONS_DIR, file), 'utf8')
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await client.query(sql)
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file])
      await client.query('COMMIT')
      ran.push(file)
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
  }
  return ran
}

const isCli = process.argv[1] !== undefined && import.meta.url === new URL(`file://${process.argv[1]}`).href

if (isCli) {
  const url = process.env.DATABASE_URL ?? 'postgres://ta:ta@localhost:5432/ta_dev'
  const pool = new pg.Pool({ connectionString: url })
  const ran = await runMigrations(pool)
  console.log(ran.length === 0 ? 'migrations: up to date' : `migrations applied: ${ran.join(', ')}`)
  await pool.end()
}
