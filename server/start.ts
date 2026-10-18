// start.ts
// Run with: npm start   (reads settings from .env, see .env.example)

import { anthropicClient } from "./orchestrator";
import { createApp } from "./server";

const num = (v: string | undefined) => (v && Number.isFinite(Number(v)) ? Number(v) : undefined);

const port = num(process.env.PORT) ?? 3000;
const app = createApp(anthropicClient(), {
  allowedOrigin: process.env.ALLOWED_ORIGIN || undefined,
  trustProxy: process.env.TRUST_PROXY === "true",
  dailyLimit: num(process.env.DAILY_LIMIT),
  perIpPerMinute: num(process.env.PER_IP_PER_MINUTE),
  turnstileSecret: process.env.TURNSTILE_SECRET || undefined,
  clientDist: process.env.CLIENT_DIST || undefined,
});

app.listen(port, () => {
  console.log(`Builder API listening on http://localhost:${port}`);
  if (!process.env.TURNSTILE_SECRET) console.warn("Bot check is OFF (TURNSTILE_SECRET is not set).");
});
