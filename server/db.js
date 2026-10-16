import pg from "pg";
import { randomUUID } from "node:crypto";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set");
}

const { Pool } = pg;

function createPool(useSsl) {
  return new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: useSsl ? { rejectUnauthorized: false } : false,
  });
}

let pool = createPool(true);

const INIT_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  username TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS generations (
  id UUID PRIMARY KEY,
  prompt TEXT NOT NULL,
  html TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  error TEXT,
  parent_id UUID,
  user_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

ALTER TABLE generations ADD COLUMN IF NOT EXISTS user_id UUID;

CREATE INDEX IF NOT EXISTS generations_user_created_idx
  ON generations (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions (user_id);
`;

export async function initDb() {
  try {
    await pool.query("SELECT 1");
  } catch (err) {
    if (/SSL/i.test(err.message || "")) {
      pool = createPool(false);
      await pool.query("SELECT 1");
    } else {
      throw err;
    }
  }
  await pool.query(INIT_SQL);
}

const columns = "id, prompt, html, status, error, parent_id, created_at, completed_at";

/* ---------------- users / sessions ---------------- */

export async function createUser({ id = randomUUID(), email, username, passwordHash }) {
  const result = await pool.query(
    `INSERT INTO users (id, email, username, password_hash, created_at)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, email, username, created_at`,
    [id, email, username, passwordHash, new Date().toISOString()],
  );
  return result.rows[0];
}

export async function findUserByEmail(email) {
  const result = await pool.query(
    "SELECT id, email, username, password_hash, created_at FROM users WHERE lower(email) = lower($1)",
    [email],
  );
  return result.rows[0] ?? null;
}

export async function getPublicUser(id) {
  const result = await pool.query(
    "SELECT id, email, username, created_at FROM users WHERE id = $1",
    [id],
  );
  return result.rows[0] ?? null;
}

export async function createSession({ token, userId, ttlMs }) {
  const expiresAt = new Date(Date.now() + ttlMs).toISOString();
  await pool.query(
    `INSERT INTO sessions (token, user_id, created_at, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [token, userId, new Date().toISOString(), expiresAt],
  );
  return expiresAt;
}

export async function getSessionUser(token) {
  if (!token) return null;
  const result = await pool.query(
    `SELECT u.id, u.email, u.username, u.created_at
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token = $1 AND s.expires_at > now()`,
    [token],
  );
  return result.rows[0] ?? null;
}

export async function deleteSession(token) {
  if (!token) return false;
  const result = await pool.query("DELETE FROM sessions WHERE token = $1", [token]);
  return result.rowCount > 0;
}

/* ---------------- generations ---------------- */

export async function createGeneration({ id, prompt, parentId = null, userId = null }) {
  const result = await pool.query(
    `INSERT INTO generations (
      id, prompt, html, status, error, parent_id, user_id, created_at, completed_at
    ) VALUES ($1, $2, NULL, 'pending', NULL, $3, $4, $5, NULL)
    RETURNING ${columns}`,
    [id, prompt, parentId, userId, new Date().toISOString()],
  );
  return result.rows[0];
}

export async function getGeneration(id) {
  const result = await pool.query(
    `SELECT ${columns}, user_id FROM generations WHERE id = $1`,
    [id],
  );
  return result.rows[0] ?? null;
}

export async function listGenerations({ userId, limit = 50 }) {
  const result = await pool.query(
    `SELECT ${columns} FROM generations
     WHERE user_id IS NOT DISTINCT FROM $2
     ORDER BY created_at DESC LIMIT $1`,
    [Math.max(1, Math.min(Number(limit) || 50, 100)), userId],
  );
  return result.rows;
}

export async function updateGenerationSuccess(id, html) {
  const result = await pool.query(
    `UPDATE generations
     SET html = $1, status = 'success', error = NULL, completed_at = $2
     WHERE id = $3
     RETURNING ${columns}`,
    [html, new Date().toISOString(), id],
  );
  return result.rows[0] ?? null;
}

export async function updateGenerationFailed(id, error) {
  const result = await pool.query(
    `UPDATE generations
     SET status = 'failed', error = $1, completed_at = $2
     WHERE id = $3
     RETURNING ${columns}`,
    [error, new Date().toISOString(), id],
  );
  return result.rows[0] ?? null;
}

export async function resetGenerationForRetry(id) {
  const result = await pool.query(
    `UPDATE generations
     SET html = NULL, status = 'pending', error = NULL, completed_at = NULL
     WHERE id = $1
     RETURNING ${columns}`,
    [id],
  );
  return result.rows[0] ?? null;
}

export async function deleteGeneration(id, userId = null) {
  const result = await pool.query(
    `DELETE FROM generations WHERE id = $1 AND user_id IS NOT DISTINCT FROM $2`,
    [id, userId],
  );
  return result.rowCount > 0;
}
