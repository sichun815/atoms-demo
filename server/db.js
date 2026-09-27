import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

const dbPath = process.env.DATABASE_PATH || "./data/atoms.db";
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new DatabaseSync(dbPath);

db.exec(`
  CREATE TABLE IF NOT EXISTS generations (
    id TEXT PRIMARY KEY,
    prompt TEXT NOT NULL,
    html TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    error TEXT,
    parent_id TEXT,
    created_at TEXT NOT NULL,
    completed_at TEXT
  )
`);

const insertGeneration = db.prepare(`
  INSERT INTO generations (
    id, prompt, html, status, error, parent_id, created_at, completed_at
  ) VALUES (?, ?, NULL, 'pending', NULL, ?, ?, NULL)
`);
const selectGeneration = db.prepare(`
  SELECT id, prompt, html, status, error, parent_id, created_at, completed_at
  FROM generations
  WHERE id = ?
`);
const selectGenerations = db.prepare(`
  SELECT id, prompt, html, status, error, parent_id, created_at, completed_at
  FROM generations
  ORDER BY created_at DESC
  LIMIT ?
`);
const markSuccess = db.prepare(`
  UPDATE generations
  SET html = ?, status = 'success', error = NULL, completed_at = ?
  WHERE id = ?
`);
const markFailed = db.prepare(`
  UPDATE generations
  SET status = 'failed', error = ?, completed_at = ?
  WHERE id = ?
`);
const resetForRetry = db.prepare(`
  UPDATE generations
  SET html = NULL, status = 'pending', error = NULL, completed_at = NULL
  WHERE id = ?
`);

export function createGeneration({ id, prompt, parentId = null }) {
  insertGeneration.run(id, prompt, parentId, new Date().toISOString());
  return getGeneration(id);
}

export function getGeneration(id) {
  return selectGeneration.get(id) ?? null;
}

export function listGenerations(limit = 50) {
  return selectGenerations.all(Math.max(1, Math.min(Number(limit) || 50, 100)));
}

export function updateGenerationSuccess(id, html) {
  markSuccess.run(html, new Date().toISOString(), id);
  return getGeneration(id);
}

export function updateGenerationFailed(id, error) {
  markFailed.run(error, new Date().toISOString(), id);
  return getGeneration(id);
}

export function resetGenerationForRetry(id) {
  resetForRetry.run(id);
  return getGeneration(id);
}
