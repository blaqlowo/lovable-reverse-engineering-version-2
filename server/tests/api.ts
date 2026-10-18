import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp, sniffImageType } from "../server";
import { starterFiles } from "../template";
import { LlmClient, Block } from "../orchestrator";

let fail = 0;
const t = (n: string, c: boolean) => { console.log((c ? "PASS " : "FAIL ") + n); if (!c) fail++; };
const tpl = starterFiles();
const files = Object.fromEntries(tpl);

const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0]).toString("base64");
const WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.from([4, 0, 0, 0]), Buffer.from("WEBPVP8 ")]).toString("base64");

const edit = (search: string, replace: string, id = "e1"): Block => ({ type: "tool_use", id, name: "edit_file", input: { path: "src/App.tsx", search, replace } });
const state = { aborted: false, firstMessages: [] as any[], calls: 0 };

function llmWith(script: (call: number, a: any) => Promise<{ content: Block[]; stop_reason: string }>): LlmClient {
  return { async complete(a) { state.calls++; if (state.calls === 1 || a.messages.length <= 2) state.firstMessages = a.messages; return script(state.calls, a); } };
}
async function boot(llm: LlmClient, opts: any = {}) {
  const srv = createApp(llm, { perIpPerMinute: 1000, ...opts }).listen(0);
  const port = (srv.address() as any).port;
  const post = (path: string, body: any, signal?: AbortSignal) => fetch(`http://localhost:${port}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal });
  return { srv, port, post };
}
async function readEvents(res: Response) {
  const text = await res.text();
  return text.split("\n\n").filter((b) => b.startsWith("data: ")).map((b) => JSON.parse(b.slice(6)));
}
const base = { message: "hello", files };

(async () => {
  t("sniff png/jpeg/webp/garbage", sniffImageType(PNG) === "image/png" && sniffImageType(JPG) === "image/jpeg" && sniffImageType(WEBP) === "image/webp" && sniffImageType("AAAA") === null);

  // 1. Streaming happy path
  let s = await boot(llmWith(async (_c, a) => { a.onText?.("Making "); a.onText?.("it friendly."); return { stop_reason: "tool_use", content: [edit("Your app starts here", "Hi!"), { type: "text", text: "Making it friendly." }] }; }));
  let r = await s.post("/api/chat/stream", base);
  const ct = r.headers.get("content-type") ?? "";
  let ev = await readEvents(r);
  const types = ev.map((e) => e.type);
  t("stream: content type is event-stream", ct.startsWith("text/event-stream"));
  t("stream: status, text deltas, status, result in order", types[0] === "status" && types.filter((x) => x === "text").length === 2 && types.indexOf("text") < types.indexOf("result") && types[types.length - 1] === "result");
  const res1 = ev.find((e) => e.type === "result");
  t("stream: result carries changed file only", res1.ok && Object.keys(res1.changes).join() === "src/App.tsx" && res1.changes["src/App.tsx"].includes("Hi!"));

  // 2. Validation happens before the stream opens (plain JSON error)
  r = await s.post("/api/chat/stream", { message: "", files });
  t("stream: bad request is JSON 400, not a stream", r.status === 400 && (r.headers.get("content-type") ?? "").includes("application/json"));
  s.srv.close();

  // 3. Retry emits reset + status
  state.calls = 0;
  s = await boot(llmWith(async (c, a) => { a.onText?.("try " + c); return c === 1 ? { stop_reason: "tool_use", content: [edit("NOPE", "x")] } : { stop_reason: "tool_use", content: [edit("Your app starts here", "Fixed", "e2")] }; }));
  ev = await readEvents(await s.post("/api/chat/stream", base));
  const rs = ev.find((e) => e.type === "result");
  t("retry: reset event then success on attempt 2", ev.some((e) => e.type === "reset") && ev.some((e) => e.type === "status" && /attempt 2/.test(e.text)) && rs.ok && rs.attempts === 2);
  s.srv.close();

  // 4. Client disconnect cancels the AI call
  state.calls = 0; state.aborted = false;
  s = await boot(llmWith(async (_c, a) => { a.onText?.("working"); await new Promise((res) => { a.signal?.addEventListener("abort", () => { state.aborted = true; res(null); }); setTimeout(res, 4000); }); return { stop_reason: "end_turn", content: [{ type: "text", text: "late" }] }; }));
  const ac = new AbortController();
  const rr = await s.post("/api/chat/stream", base, ac.signal);
  const reader = rr.body!.getReader();
  await reader.read();
  ac.abort();
  await new Promise((res) => setTimeout(res, 500));
  t("abort: server cancels the AI call when the visitor disconnects", state.aborted);
  s.srv.close();

  // 5. Images
  state.calls = 0; state.firstMessages = [];
  s = await boot(llmWith(async () => ({ stop_reason: "end_turn", content: [{ type: "text", text: "Nice picture." }] })));
  r = await s.post("/api/chat", { ...base, images: [{ mediaType: "image/png", data: PNG }] });
  let j: any = await r.json();
  const first = state.firstMessages[state.firstMessages.length - 1].content;
  t("images: accepted and passed to the model as an image block", r.status === 200 && j.ok && Array.isArray(first) && first[0].type === "image" && first[0].source.media_type === "image/png" && first[first.length - 1].text === "hello");
  t("images: three formats ok", (await s.post("/api/chat", { ...base, images: [{ mediaType: "image/jpeg", data: JPG }, { mediaType: "image/webp", data: WEBP }] })).status === 200);
  t("images: type mismatch rejected", (await s.post("/api/chat", { ...base, images: [{ mediaType: "image/jpeg", data: PNG }] })).status === 400);
  t("images: svg rejected", (await s.post("/api/chat", { ...base, images: [{ mediaType: "image/svg+xml", data: PNG }] })).status === 400);
  t("images: more than 3 rejected", (await s.post("/api/chat", { ...base, images: Array(4).fill({ mediaType: "image/png", data: PNG }) })).status === 400);
  t("images: not base64 rejected", (await s.post("/api/chat", { ...base, images: [{ mediaType: "image/png", data: "not base64!!" }] })).status === 400);
  t("images: oversize rejected", (await s.post("/api/chat", { ...base, images: [{ mediaType: "image/png", data: PNG.slice(0, 8) + "A".repeat(350_000) }] })).status === 400);
  t("images: non-array rejected", (await s.post("/api/chat", { ...base, images: "x" })).status === 400);
  s.srv.close();

  // 6. Turnstile
  const calls: string[] = [];
  const fakeFetch: typeof fetch = async (_u, init: any) => {
    const body = init.body as URLSearchParams; calls.push(body.get("secret") + "|" + body.get("response"));
    const tok = body.get("response");
    if (tok === "net") throw new Error("network down");
    return new Response(JSON.stringify({ success: tok === "good" }), { status: 200 });
  };
  s = await boot(llmWith(async () => ({ stop_reason: "end_turn", content: [{ type: "text", text: "ok" }] })), { turnstileSecret: "SECRET", fetchImpl: fakeFetch });
  t("turnstile: missing token is 403", (await s.post("/api/chat", base)).status === 403);
  t("turnstile: bad token is 403", (await s.post("/api/chat", { ...base, turnstileToken: "bad" })).status === 403);
  t("turnstile: good token passes", (await s.post("/api/chat", { ...base, turnstileToken: "good" })).status === 200);
  t("turnstile: verifier outage fails closed (503)", (await s.post("/api/chat", { ...base, turnstileToken: "net" })).status === 503);
  t("turnstile: stream endpoint is protected too", (await s.post("/api/chat/stream", base)).status === 403);
  t("turnstile: secret and token sent to Cloudflare", calls.includes("SECRET|good"));
  s.srv.close();

  // 7. Static hosting
  const dir = mkdtempSync(join(tmpdir(), "dist-")); mkdirSync(join(dir, "assets"));
  writeFileSync(join(dir, "index.html"), "<html>HOME</html>"); writeFileSync(join(dir, "assets", "x.js"), "console.log(1)");
  s = await boot(llmWith(async () => ({ stop_reason: "end_turn", content: [] })), { clientDist: dir });
  const get = async (p: string) => { const x = await fetch(`http://localhost:${s.port}${p}`); return { status: x.status, text: await x.text() }; };
  t("static: root serves index.html", (await get("/")).text.includes("HOME"));
  t("static: asset served", (await get("/assets/x.js")).text.includes("console.log"));
  t("static: unknown page falls back to index.html", (await get("/some/page")).text.includes("HOME"));
  t("static: unknown api path is NOT index.html", !(await get("/api/nope")).text.includes("HOME"));
  t("static: template endpoint still works", (await get("/api/template")).status === 200);
  s.srv.close();

  // 8. Vercel-style hosting: the platform reads the body first and exposes a lazy parsed req.body
  {
    const { createServer } = await import("node:http");
    const { PassThrough } = await import("node:stream");
    const app = createApp(llmWith(async () => ({ stop_reason: "end_turn", content: [{ type: "text", text: "hello from vercel style" }] })), { perIpPerMinute: 1000 });
    const srv = createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      const buf = Buffer.concat(chunks);
      // same trick as Vercel's helper: lazy parsed body + a replacement stream that cannot satisfy Express's reader
      Object.defineProperty(req, "body", { configurable: true, enumerable: true,
        get() { let v: any; try { v = buf.length ? JSON.parse(buf.toString()) : {}; } catch { throw new Error("Invalid JSON"); } Object.defineProperty(req, "body", { value: v, writable: true, configurable: true, enumerable: true }); return v; },
        set(v) { Object.defineProperty(req, "body", { value: v, writable: true, configurable: true, enumerable: true }); } });
      const pt = new PassThrough(); const on = pt.on.bind(pt); const orig = req.on.bind(req);
      (req as any).read = pt.read.bind(pt);
      (req as any).on = (req as any).addListener = (n: string, cb: any) => (n === "data" || n === "end" ? on(n, cb) : orig(n, cb));
      pt.write(buf); pt.end();
      app(req as any, res as any);
    }).listen(0);
    const port = (srv.address() as any).port;
    const call = (body: string) => fetch(`http://localhost:${port}/api/chat`, { method: "POST", headers: { "content-type": "application/json" }, body });
    let r2 = await call(JSON.stringify(base));
    t("vercel-style: pre-read JSON body works", r2.status === 200 && (await r2.json()).reply === "hello from vercel style");
    r2 = await call("{not json");
    t("vercel-style: invalid JSON gives 400, not a crash", r2.status === 400 && (await r2.json()).error === "Invalid JSON");
    r2 = await call(JSON.stringify({ message: "x", files: { "src/a.ts": "y".repeat(1_600_000) } }));
    t("vercel-style: oversize project refused with 400", r2.status === 400);
    srv.close();
  }

  console.log(fail ? `${fail} FAILED` : "ALL PASSED");
  process.exit(fail ? 1 : 0);
})();
