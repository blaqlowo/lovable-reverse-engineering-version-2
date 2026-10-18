// server.ts
// Stateless API. The browser holds the project. The server stores nothing and
// forgets each request when it replies. No accounts, no database.

import express, { NextFunction, Request, Response } from "express";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { FileMap } from "./edit-parser";
import { ImageInput, LlmClient, SimpleMsg, TurnResult, runTurn } from "./orchestrator";
import { starterFiles } from "./template";
import { verifyTurnstile } from "./turnstile";

const LIMITS = {
  messageChars: 4000,
  fileCount: 200,
  totalBytes: 1_500_000,
  pathChars: 200,
  historyMessages: 10,
  images: 3,
  imageBase64Chars: 340_000, // about 250 KB of image data each
};
const PATH_PATTERN = /^[A-Za-z0-9_@.\-/]+$/;
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

// Returns a FileMap, or a string describing what is wrong.
export function parseFiles(raw: unknown): FileMap | string {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return "files must be an object of path to text";
  const entries = Object.entries(raw as Record<string, unknown>);
  if (entries.length === 0 || entries.length > LIMITS.fileCount)
    return `files must contain 1 to ${LIMITS.fileCount} entries`;
  const map: FileMap = new Map();
  let bytes = 0;
  for (const [path, content] of entries) {
    if (
      path.length > LIMITS.pathChars ||
      !PATH_PATTERN.test(path) ||
      path.includes("..") ||
      path.startsWith("/")
    )
      return `invalid file path "${path.slice(0, 60)}"`;
    if (typeof content !== "string") return `file "${path}" must be text`;
    bytes += Buffer.byteLength(content, "utf8");
    if (bytes > LIMITS.totalBytes) return "project is too large";
    map.set(path, content);
  }
  return map;
}

// Client-supplied history is untrusted. Keep it only if it is a clean user/assistant alternation.
export function parseHistory(raw: unknown): SimpleMsg[] {
  if (!Array.isArray(raw)) return [];
  const items = raw.slice(-LIMITS.historyMessages);
  const clean: SimpleMsg[] = [];
  for (const m of items) {
    if (
      !m ||
      (m.role !== "user" && m.role !== "assistant") ||
      typeof m.content !== "string" ||
      !m.content.trim() ||
      m.content.length > LIMITS.messageChars
    )
      return [];
    clean.push({ role: m.role, content: m.content });
  }
  while (clean.length && clean[0].role !== "user") clean.shift();
  for (let i = 0; i < clean.length; i++) {
    if (clean[i].role !== (i % 2 === 0 ? "user" : "assistant")) return [];
  }
  if (clean.length && clean[clean.length - 1].role !== "assistant") return [];
  return clean;
}

// Identify an image from its first bytes, so a file cannot lie about its type.
export function sniffImageType(b64: string): string | null {
  const b = Buffer.from(b64.slice(0, 32), "base64");
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
    return "image/png";
  if (b.length >= 4 && b.subarray(0, 4).toString("ascii") === "GIF8") return "image/gif";
  if (b.length >= 12 && b.subarray(0, 4).toString("ascii") === "RIFF" && b.subarray(8, 12).toString("ascii") === "WEBP")
    return "image/webp";
  return null;
}

export function parseImages(raw: unknown): ImageInput[] | string {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw) || raw.length > LIMITS.images) return `at most ${LIMITS.images} images`;
  const out: ImageInput[] = [];
  for (const im of raw) {
    if (!im || typeof im.mediaType !== "string" || typeof im.data !== "string") return "invalid image";
    if (!IMAGE_TYPES.has(im.mediaType)) return "unsupported image type";
    if (!im.data || im.data.length > LIMITS.imageBase64Chars || !BASE64.test(im.data))
      return "invalid or too large image";
    if (sniffImageType(im.data) !== im.mediaType) return "image data does not match its type";
    out.push({ mediaType: im.mediaType, data: im.data });
  }
  return out;
}

// Only what changed. A null value means the file was deleted.
export function diffFiles(before: FileMap, after: FileMap): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const p of new Set([...before.keys(), ...after.keys()])) {
    if (before.get(p) !== after.get(p)) out[p] = after.get(p) ?? null;
  }
  return out;
}

function rateLimiter(max: number, windowMs: number) {
  const hits = new Map<string, { count: number; reset: number }>();
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
  }, windowMs).unref();
  return (req: Request, res: Response, next: NextFunction) => {
    const key = req.ip ?? "unknown";
    const now = Date.now();
    const h = hits.get(key);
    if (!h || h.reset < now) {
      hits.set(key, { count: 1, reset: now + windowMs });
      return next();
    }
    if (++h.count > max) {
      res.setHeader("Retry-After", Math.ceil((h.reset - now) / 1000));
      return void res.status(429).json({ error: "Too many requests. Please wait a minute." });
    }
    next();
  };
}

export interface AppOptions {
  perIpPerMinute?: number; // default 6
  dailyLimit?: number; // total chat requests per UTC day for everyone, default 500
  allowedOrigin?: string; // your frontend URL, for CORS (not needed if the server hosts the frontend)
  trustProxy?: boolean; // true when behind a hosting proxy, so IPs are real
  turnstileSecret?: string; // when set, every chat request needs a valid bot-check token
  clientDist?: string; // folder with the built frontend; when set, this server hosts it too
  fetchImpl?: typeof fetch; // for tests
}

interface Prepared {
  message: string;
  files: FileMap;
  history: SimpleMsg[];
  images: ImageInput[];
}

export function createApp(llm: LlmClient, opts: AppOptions = {}) {
  const app = express();
  app.set("trust proxy", opts.trustProxy ?? false);
  app.disable("x-powered-by");
  // On Vercel the platform reads the request body BEFORE Express sees it and keeps a parsed copy on
  // req.body, which leaves nothing for Express's own reader ("stream is not readable").
  // When that parsed copy exists we use it and tell body-parser to skip. Anywhere else
  // (your computer, Docker) req.body is empty here, so Express reads the body itself as usual.
  app.use((req, _res, next) => {
    const type = req.headers["content-type"];
    if (typeof type === "string" && type.includes("application/json")) {
      try {
        const parsed = (req as any).body;
        if (parsed && typeof parsed === "object") (req as any)._body = true;
      } catch {
        return next(Object.assign(new Error("Invalid JSON"), { type: "entity.parse.failed" }));
      }
    }
    next();
  });
  app.use(express.json({ limit: "6mb" }));

  app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    if (req.path.startsWith("/api")) res.setHeader("Cache-Control", "no-store");
    if (opts.allowedOrigin) {
      res.setHeader("Access-Control-Allow-Origin", opts.allowedOrigin);
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");
      if (req.method === "OPTIONS") return void res.sendStatus(204);
    }
    next();
  });

  let day = "";
  let dayCount = 0;
  const dailyLimit = opts.dailyLimit ?? 500;
  const limiter = rateLimiter(opts.perIpPerMinute ?? 6, 60_000);

  // Validate the request body. Returns the cleaned data, or an error string.
  const prepare = (req: Request): Prepared | string => {
    const message = req.body?.message;
    if (typeof message !== "string" || !message.trim() || message.length > LIMITS.messageChars)
      return `message must be 1 to ${LIMITS.messageChars} characters`;
    const files = parseFiles(req.body?.files);
    if (typeof files === "string") return files;
    const images = parseImages(req.body?.images);
    if (typeof images === "string") return images;
    return { message, files, history: parseHistory(req.body?.history), images };
  };

  // Bot check, then the shared daily cap. Returns a denial, or null to proceed.
  const admit = async (req: Request): Promise<{ status: number; error: string } | null> => {
    if (opts.turnstileSecret) {
      const token = req.body?.turnstileToken;
      if (typeof token !== "string" || !token || token.length > 2048)
        return { status: 403, error: "Bot check missing. Refresh the page and try again." };
      const verdict = await verifyTurnstile(opts.turnstileSecret, token, req.ip, opts.fetchImpl);
      if (verdict === "failed") return { status: 403, error: "Bot check failed. Refresh the page and try again." };
      if (verdict === "unavailable")
        return { status: 503, error: "Could not run the bot check right now. Please try again." };
    }
    const today = new Date().toISOString().slice(0, 10);
    if (today !== day) {
      day = today;
      dayCount = 0;
    }
    if (dayCount >= dailyLimit) return { status: 503, error: "Daily capacity reached. Please try again tomorrow." };
    dayCount++;
    return null;
  };

  const payload = (turn: TurnResult, before: FileMap) => ({
    ok: turn.ok,
    reply: turn.reply,
    attempts: turn.attempts,
    changes: diffFiles(before, turn.files),
  });

  app.get("/healthz", (_req, res) => void res.json({ ok: true }));

  app.get("/api/template", (_req, res) => {
    res.json({ files: Object.fromEntries(starterFiles()) });
  });

  // Plain JSON version (no streaming).
  app.post("/api/chat", limiter, async (req, res) => {
    const p = prepare(req);
    if (typeof p === "string") return void res.status(400).json({ error: p });
    const denied = await admit(req);
    if (denied) return void res.status(denied.status).json({ error: denied.error });
    try {
      const turn = await runTurn({ llm, ...p, userMessage: p.message });
      res.json(payload(turn, p.files));
    } catch (err) {
      // Never log the request body: we do not keep user content.
      console.error("chat failed:", err instanceof Error ? err.message : "unknown error");
      res.status(500).json({ error: "Something went wrong. Nothing was changed." });
    }
  });

  // Streaming version (Server-Sent Events): progress and text arrive while the AI works.
  app.post("/api/chat/stream", limiter, async (req, res) => {
    const p = prepare(req);
    if (typeof p === "string") return void res.status(400).json({ error: p });
    const denied = await admit(req);
    if (denied) return void res.status(denied.status).json({ error: denied.error });

    res.status(200);
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-store, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no"); // stop proxies from holding the stream back
    res.flushHeaders();

    const send = (e: object) => {
      if (!res.writableEnded && !res.destroyed) res.write(`data: ${JSON.stringify(e)}\n\n`);
    };
    const ping = setInterval(() => {
      if (!res.writableEnded && !res.destroyed) res.write(": ping\n\n");
    }, 15_000);

    // If the visitor closes the tab or presses Stop, cancel the AI call so we stop paying for it.
    const ac = new AbortController();
    res.on("close", () => {
      clearInterval(ping);
      if (!res.writableEnded) ac.abort();
    });

    try {
      const turn = await runTurn({ llm, ...p, userMessage: p.message, signal: ac.signal, onEvent: send });
      send({ type: "result", ...payload(turn, p.files) });
    } catch (err) {
      if (!ac.signal.aborted) {
        console.error("chat failed:", err instanceof Error ? err.message : "unknown error");
        send({ type: "error", message: "Something went wrong. Nothing was changed." });
      }
    } finally {
      clearInterval(ping);
      res.end();
    }
  });

  // Optionally serve the built website from this same server (one deployment, no CORS).
  if (opts.clientDist) {
    const dist = resolve(opts.clientDist);
    if (existsSync(join(dist, "index.html"))) {
      app.use(express.static(dist, { maxAge: "1h" }));
      app.get(/^\/(?!api\/|healthz).*/, (_req, res) => void res.sendFile(join(dist, "index.html")));
    } else {
      console.warn(`CLIENT_DIST is set but ${dist}/index.html was not found.`);
    }
  }

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    if (err?.type === "entity.too.large") return void res.status(413).json({ error: "Request too large" });
    if (err?.type === "entity.parse.failed") return void res.status(400).json({ error: "Invalid JSON" });
    // Log only the kind of error, never the request itself: we do not keep user content.
    console.error("request failed:", err?.type ?? err?.code ?? err?.message ?? "unknown error");
    res.status(500).json({ error: "Something went wrong." });
  });

  return app;
}
