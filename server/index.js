import http from "node:http";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";
import {
  createGeneration,
  getGeneration,
  listGenerations,
  resetGenerationForRetry,
  updateGenerationFailed,
  updateGenerationSuccess,
} from "./db.js";
import { generateHtml } from "./llm.js";
import { validateHtml } from "./validate.js";

const PORT = process.env.PORT || 3002;
const MAX_BODY_BYTES = 1024 * 1024;
const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json",
    ...CORS_HEADERS,
  });
  res.end(JSON.stringify(data));
}

function sendIndexHtml(res) {
  const indexPath = path.join(PROJECT_ROOT, "index.html");
  try {
    const html = fs.readFileSync(indexPath);
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
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
      updateGenerationSuccess(id, html);
    } catch (error) {
      console.error(`Generation ${id} failed:`, error);
      try {
        updateGenerationFailed(id, error.message || "Generation failed");
      } catch (dbError) {
        console.error(`Could not mark generation ${id} as failed:`, dbError);
      }
    }
  });
}

function getParentHtml(parentId) {
  if (typeof parentId !== "string" || !parentId) {
    throw Object.assign(new Error("parentId must be a valid ID"), { statusCode: 400 });
  }
  const parent = getGeneration(parentId);
  if (!parent) {
    throw Object.assign(new Error("Parent generation not found"), { statusCode: 404 });
  }
  if (parent.status !== "success" || !parent.html) {
    throw Object.assign(new Error("Parent generation must be successful"), { statusCode: 409 });
  }
  return parent.html;
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

    if (req.method === "POST" && pathname === "/api/generations") {
      const body = await readBody(req);
      const prompt = body?.prompt;
      if (typeof prompt !== "string" || !prompt.trim()) {
        sendJson(res, 400, { error: "prompt is required" });
        return;
      }

      const parentId = body.parentId ?? null;
      const originalHtml = parentId === null ? null : getParentHtml(parentId);
      const id = randomUUID();
      createGeneration({ id, prompt: prompt.trim(), parentId });
      sendJson(res, 202, { id, status: "pending" });
      startGeneration(id, prompt.trim(), originalHtml);
      return;
    }

    if (req.method === "GET" && pathname === "/api/generations") {
      sendJson(res, 200, listGenerations());
      return;
    }

    if (parts[0] === "api" && parts[1] === "generations" && parts.length === 3) {
      if (req.method === "GET") {
        const generation = getGeneration(parts[2]);
        if (!generation) {
          sendJson(res, 404, { error: "not found" });
          return;
        }
        sendJson(res, 200, generation);
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
      const generation = getGeneration(parts[2]);
      if (!generation) {
        sendJson(res, 404, { error: "not found" });
        return;
      }
      if (generation.status === "pending") {
        sendJson(res, 409, { error: "generation is already pending" });
        return;
      }

      const originalHtml = generation.parent_id
        ? getParentHtml(generation.parent_id)
        : null;
      resetGenerationForRetry(generation.id);
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
