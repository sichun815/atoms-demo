import { randomBytes, randomUUID, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import {
  createSession,
  createUser,
  deleteSession,
  findUserByEmail,
  getSessionUser,
} from "./db.js";

const scryptAsync = promisify(scrypt);

export const SESSION_COOKIE = "atoms_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 天

const SCRYPT_KEYLEN = 64;

export async function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const derived = await scryptAsync(password, salt, SCRYPT_KEYLEN);
  return `scrypt$${salt}$${derived.toString("hex")}`;
}

export async function verifyPassword(password, stored) {
  if (typeof stored !== "string") return false;
  const [scheme, salt, hash] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const derived = await scryptAsync(password, salt, SCRYPT_KEYLEN);
  const expected = Buffer.from(hash, "hex");
  if (expected.length !== derived.length) return false;
  return timingSafeEqual(expected, derived);
}

export function validateCredentials({ email, username }, { requireUsername }) {
  if (typeof email !== "string" || !email.trim()) {
    throw Object.assign(new Error("请输入邮箱"), { statusCode: 400 });
  }
  const normalized = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw Object.assign(new Error("邮箱格式不正确"), { statusCode: 400 });
  }
  if (requireUsername) {
    if (typeof username !== "string" || !username.trim()) {
      throw Object.assign(new Error("请输入用户名"), { statusCode: 400 });
    }
    if (username.trim().length > 40) {
      throw Object.assign(new Error("用户名不能超过 40 个字符"), { statusCode: 400 });
    }
  }
  return normalized;
}

export function validatePassword(password) {
  if (typeof password !== "string" || password.length < 6) {
    throw Object.assign(new Error("密码至少需要 6 位"), { statusCode: 400 });
  }
  if (password.length > 128) {
    throw Object.assign(new Error("密码不能超过 128 位"), { statusCode: 400 });
  }
  return password;
}

export async function register({ email, username, password }) {
  const normalizedEmail = validateCredentials({ email, username }, { requireUsername: true });
  validatePassword(password);

  const existing = await findUserByEmail(normalizedEmail);
  if (existing) {
    throw Object.assign(new Error("该邮箱已注册，请直接登录"), { statusCode: 409 });
  }

  const passwordHash = await hashPassword(password);
  const user = await createUser({
    id: randomUUID(),
    email: normalizedEmail,
    username: username.trim(),
    passwordHash,
  });
  const token = await startSession(user.id);
  return { user, token };
}

export async function login({ email, password }) {
  const normalizedEmail = validateCredentials({ email }, { requireUsername: false });
  const user = await findUserByEmail(normalizedEmail);
  const ok = user ? await verifyPassword(password, user.password_hash) : false;
  if (!ok) {
    throw Object.assign(new Error("邮箱或密码不正确"), { statusCode: 401 });
  }
  const token = await startSession(user.id);
  return {
    user: { id: user.id, email: user.email, username: user.username, created_at: user.created_at },
    token,
  };
}

async function startSession(userId) {
  const token = randomBytes(32).toString("hex");
  await createSession({ token, userId, ttlMs: SESSION_TTL_MS });
  return token;
}

export async function logout(token) {
  return deleteSession(token);
}

export function readSessionToken(req) {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === SESSION_COOKIE) return decodeURIComponent(rest.join("="));
  }
  return null;
}

export function sessionCookie(token, { clear = false } = {}) {
  const base = `${SESSION_COOKIE}=${clear ? "" : token}; Path=/; HttpOnly; SameSite=Lax`;
  if (clear) return `${base}; Max-Age=0`;
  return `${base}; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`;
}

export async function currentUser(req) {
  const token = readSessionToken(req);
  if (!token) return null;
  return getSessionUser(token);
}
