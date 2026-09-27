import pg from "pg";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set");
}

const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const columns = "id, prompt, html, status, error, parent_id, created_at, completed_at";

export async function createGeneration({ id, prompt, parentId = null }) {
  const result = await pool.query(
    `INSERT INTO generations (
      id, prompt, html, status, error, parent_id, created_at, completed_at
    ) VALUES ($1, $2, NULL, 'pending', NULL, $3, $4, NULL)
    RETURNING ${columns}`,
    [id, prompt, parentId, new Date().toISOString()],
  );
  return result.rows[0];
}

export async function getGeneration(id) {
  const result = await pool.query(
    `SELECT ${columns} FROM generations WHERE id = $1`,
    [id],
  );
  return result.rows[0] ?? null;
}

export async function listGenerations(limit = 50) {
  const result = await pool.query(
    `SELECT ${columns} FROM generations ORDER BY created_at DESC LIMIT $1`,
    [Math.max(1, Math.min(Number(limit) || 50, 100))],
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

export async function deleteGeneration(id) {
  const result = await pool.query("DELETE FROM generations WHERE id = $1", [id]);
  return result.rowCount > 0;
}
