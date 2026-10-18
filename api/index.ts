// api/index.ts
// The Vercel entry point. Vercel runs this file as one serverless function, and
// vercel.json sends every /api/... request to it. The Express app lives in ../server.

import type { IncomingMessage, ServerResponse } from "node:http";
import { anthropicClient } from "../server/orchestrator";
import { createApp } from "../server/server";

const num = (v: string | undefined) => (v && Number.isFinite(Number(v)) ? Number(v) : undefined);

let app: ReturnType<typeof createApp> | null = null;

// Built on the first request, so a missing setting gives a clear message instead of a crash.
function getApp() {
  if (!app) {
    app = createApp(anthropicClient(), {
      trustProxy: true, // Vercel sits in front, so the real visitor address comes from its headers
      dailyLimit: num(process.env.DAILY_LIMIT),
      perIpPerMinute: num(process.env.PER_IP_PER_MINUTE),
      turnstileSecret: process.env.TURNSTILE_SECRET || undefined,
    });
  }
  return app;
}

export default function handler(req: IncomingMessage, res: ServerResponse) {
  let express;
  try {
    express = getApp();
  } catch (err) {
    console.error("setup failed:", err instanceof Error ? err.message : "unknown error");
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "The server is not set up yet. Add ANTHROPIC_API_KEY in the Vercel project settings, then redeploy." }));
    return;
  }
  return express(req as any, res as any);
}
