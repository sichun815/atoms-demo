import http from "node:http";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";
import {
  createGeneration,
  deleteGeneration,
  getGeneration,
  initDb,
  listGenerations,
  resetGenerationForRetry,
  updateGenerationFailed,
  updateGenerationSuccess,
} from "./db.js";
import {
  currentUser,
  login,
  logout,
  readSessionToken,
  register,
  sessionCookie,
} from "./auth.js";
import { generateHtml } from "./llm.js";
import { validateHtml } from "./validate.js";

const PORT = process.env.PORT || 3002;
const MAX_BODY_BYTES = 1024 * 1024;
const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Credentials": "true",
};

function sendJson(res, statusCode, data, extraHeaders = {}) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json",
    ...CORS_HEADERS,
    ...extraHeaders,
  });
  res.end(JSON.stringify(data));
}

function sendIndexHtml(res) {
  const indexPath = path.join(PROJECT_ROOT, "index.html");
  try {
    const html = fs.readFileSync(indexPath);
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      ...CORS_HEADERS,
    });
    res.end(html);
  } catch (error) {
    if (error.code === "ENOENT") {
      sendJson(res, 404, { error: "index.html not found" });
      return;
    }
    throw error;
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let tooLarge = false;

    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        tooLarge = true;
        chunks.length = 0;
      } else if (!tooLarge) {
        chunks.push(chunk);
      }
    });
    req.on("end", () => {
      if (tooLarge) {
        reject(Object.assign(new Error("Request body exceeds 1MB"), { statusCode: 413 }));
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(Object.assign(new Error("Invalid JSON body"), { statusCode: 400 }));
      }
    });
    req.on("error", reject);
  });
}

function startGeneration(id, prompt, originalHtml = null) {
  setImmediate(async () => {
    try {
      const { html } = await generateHtml(prompt, originalHtml);
      validateHtml(html);
      await updateGenerationSuccess(id, html);
    } catch (error) {
      console.error(`Generation ${id} failed:`, error);
      try {
        await updateGenerationFailed(id, error.message || "Generation failed");
      } catch (dbError) {
        console.error(`Could not mark generation ${id} as failed:`, dbError);
      }
    }
  });
}

async function getOwnedGeneration(id, userId) {
  const generation = await getGeneration(id);
  if (!generation) return null;
  if ((generation.user_id ?? null) !== (userId ?? null)) return null;
  return generation;
}

async function getParentHtml(parentId, userId) {
  if (typeof parentId !== "string" || !parentId) {
    throw Object.assign(new Error("parentId must be a valid ID"), { statusCode: 400 });
  }
  const parent = await getOwnedGeneration(parentId, userId);
  if (!parent) {
    throw Object.assign(new Error("Parent generation not found"), { statusCode: 404 });
  }
  if (parent.status !== "success" || !parent.html) {
    throw Object.assign(new Error("Parent generation must be successful"), { statusCode: 409 });
  }
  return parent.html;
}

function requireUser(user) {
  if (!user) {
    throw Object.assign(new Error("请先登录"), { statusCode: 401 });
  }
  return user;
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "OPTIONS") {
      res.writeHead(204, CORS_HEADERS);
      res.end();
      return;
    }

    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    const pathname = url.pathname;
    const parts = pathname.split("/").filter(Boolean);

    if (req.method === "GET" && (pathname === "/" || pathname === "/index.html")) {
      sendIndexHtml(res);
      return;
    }

    if (req.method === "GET" && pathname === "/api/health") {
      sendJson(res, 200, { status: "ok" });
      return;
    }

    /* ---------------- auth ---------------- */

    if (req.method === "POST" && pathname === "/api/auth/register") {
      const body = await readBody(req);
      const { user, token } = await register({
        email: body?.email,
        username: body?.username,
        password: body?.password,
      });
      sendJson(res, 201, { user }, { "Set-Cookie": sessionCookie(token) });
      return;
    }

    if (req.method === "POST" && pathname === "/api/auth/login") {
      const body = await readBody(req);
      const { user, token } = await login({ email: body?.email, password: body?.password });
      sendJson(res, 200, { user }, { "Set-Cookie": sessionCookie(token) });
      return;
    }

    if (req.method === "POST" && pathname === "/api/auth/logout") {
      await logout(readSessionToken(req));
      sendJson(res, 200, { success: true }, { "Set-Cookie": sessionCookie("", { clear: true }) });
      return;
    }

    if (req.method === "GET" && pathname === "/api/auth/me") {
      const user = await currentUser(req);
      sendJson(res, 200, { user: user ?? null });
      return;
    }

    /* ---------------- generations ---------------- */

    if (req.method === "POST" && pathname === "/api/generations") {
      const user = requireUser(await currentUser(req));
      const body = await readBody(req);
      const prompt = body?.prompt;
      if (typeof prompt !== "string" || !prompt.trim()) {
        sendJson(res, 400, { error: "prompt is required" });
        return;
      }

      const parentId = body.parentId ?? null;
      const originalHtml = parentId === null ? null : await getParentHtml(parentId, user.id);
      const id = randomUUID();
      await createGeneration({ id, prompt: prompt.trim(), parentId, userId: user.id });
      sendJson(res, 202, { id, status: "pending" });
      startGeneration(id, prompt.trim(), originalHtml);
      return;
    }

    if (req.method === "GET" && pathname === "/api/generations") {
      const user = requireUser(await currentUser(req));
      sendJson(res, 200, await listGenerations({ userId: user.id }));
      return;
    }

    if (parts[0] === "api" && parts[1] === "generations" && parts.length === 3) {
      const user = requireUser(await currentUser(req));

      if (req.method === "GET") {
        const generation = await getOwnedGeneration(parts[2], user.id);
        if (!generation) {
          sendJson(res, 404, { error: "not found" });
          return;
        }
        sendJson(res, 200, generation);
        return;
      }

      if (req.method === "DELETE") {
        const deleted = await deleteGeneration(parts[2], user.id);
        if (!deleted) {
          sendJson(res, 404, { error: "not found" });
          return;
        }
        sendJson(res, 200, { success: true });
        return;
      }
    }

    if (
      req.method === "POST" &&
      parts[0] === "api" &&
      parts[1] === "generations" &&
      parts.length === 4 &&
      parts[3] === "retry"
    ) {
      const user = requireUser(await currentUser(req));
      const generation = await getOwnedGeneration(parts[2], user.id);
      if (!generation) {
        sendJson(res, 404, { error: "not found" });
        return;
      }
      if (generation.status === "pending") {
        sendJson(res, 409, { error: "generation is already pending" });
        return;
      }

      const originalHtml = generation.parent_id
        ? await getParentHtml(generation.parent_id, user.id)
        : null;
      await resetGenerationForRetry(generation.id);
      sendJson(res, 202, { id: generation.id, status: "pending" });
      startGeneration(generation.id, generation.prompt, originalHtml);
      return;
    }

    sendJson(res, 404, { error: "not found" });
  } catch (error) {
    console.error(error.stack || error);
    if (!res.headersSent) {
      sendJson(res, error.statusCode || 500, { error: error.message || "Internal server error" });
    }
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Server listening on port ${PORT}`);
});

initDb()
  .then(() => console.log("Database schema ready"))
  .catch((error) => {
    console.error("Database init failed:", error.message);
    process.exit(1);
  });
