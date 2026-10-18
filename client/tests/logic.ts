// Client logic tests. Run with: npm test (from the client folder or the repo root).
import { createHistory, commit, currentOf, undo, restoreTo, stateAt, compact, approxChars, MAX_VERSIONS } from "../src/history";
import { saveDraft, loadDraft, StorageLike, MAX_DRAFT_CHARS } from "../src/drafts";
import { createSseParser } from "../src/sse";
import { assetSlug, assetPathFor, assetModule } from "../src/images";
import { pushToGitHub, DEPLOY_WORKFLOW, WORKFLOW_PATH, GitHubError } from "../src/github";
import { validateResult } from "../src/api";

let fail = 0;
const t = (n: string, c: boolean) => { console.log((c ? "PASS " : "FAIL ") + n); if (!c) fail++; };
const norm = (v: any): any => Array.isArray(v) ? v.map(norm) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map(k => [k, norm(v[k])])) : v;
const eq = (a: any, b: any) => JSON.stringify(norm(a)) === JSON.stringify(norm(b)); // ignores key order

// ---------- history
let h = createHistory({ "a.ts": "1", "b.ts": "2" });
t("new history: current equals base", eq(currentOf(h), { "a.ts": "1", "b.ts": "2" }));
t("no-op commit returns same object", commit(h, { "a.ts": "1", "b.ts": "2" }, "noop") === h);
h = commit(h, { "a.ts": "1x", "b.ts": "2", "c.ts": "3" }, "add c, edit a", { now: 1000 });
h = commit(h, { "a.ts": "1x", "c.ts": "3" }, "delete b", { now: 2000 });
t("commit tracks edit, add, delete", eq(currentOf(h), { "a.ts": "1x", "c.ts": "3" }) && h.versions.length === 2);
t("stateAt gives older states", eq(stateAt(h, 0), { "a.ts": "1x", "b.ts": "2", "c.ts": "3" }) && eq(stateAt(h, -1), { "a.ts": "1", "b.ts": "2" }));
const u1 = undo(h, 3000);
t("undo restores previous state as a NEW version", eq(currentOf(u1), stateAt(h, 0)) && u1.versions.length === 3 && u1.versions[2].label === "Undo");
t("undo twice undoes the undo", eq(currentOf(undo(u1, 4000)), { "a.ts": "1x", "c.ts": "3" }));
t("undo with no versions is a no-op", undo(createHistory({ x: "1" })).versions.length === 0);
const r1 = restoreTo(h, h.versions[0].id, 5000);
t("restoreTo a version", eq(currentOf(r1), stateAt(h, 0)) && r1.versions[r1.versions.length - 1].label.startsWith("Restored"));
t("restoreTo start", eq(currentOf(restoreTo(h, "start", 6000)), { "a.ts": "1", "b.ts": "2" }));
t("restoreTo unknown id is a no-op", restoreTo(h, 999) === h);
t("history never mutates the base", eq(h.base, { "a.ts": "1", "b.ts": "2" }));

let m = createHistory({ "a.ts": "v0" });
m = commit(m, { "a.ts": "v1" }, "Manual edit", { coalesce: true, now: 1000 });
m = commit(m, { "a.ts": "v2" }, "Manual edit", { coalesce: true, now: 5000 });
t("coalesce merges quick manual edits", m.versions.length === 1 && eq(currentOf(m), { "a.ts": "v2" }));
m = commit(m, { "a.ts": "v3" }, "Manual edit", { coalesce: true, now: 5000 + 31_000 });
t("coalesce stops after 30s pause", m.versions.length === 2);
let m2 = createHistory({ "a.ts": "v0" });
m2 = commit(m2, { "a.ts": "v1" }, "Manual edit", { coalesce: true, now: 1000 });
m2 = commit(m2, { "a.ts": "v0" }, "Manual edit", { coalesce: true, now: 2000 });
t("edits that cancel out leave no version", m2.versions.length === 0 && eq(currentOf(m2), { "a.ts": "v0" }));

let p = createHistory({ "a.ts": "0" });
for (let i = 1; i <= MAX_VERSIONS + 5; i++) p = commit(p, { "a.ts": String(i) }, "edit " + i, { now: i });
t("history is capped and current is preserved", p.versions.length === MAX_VERSIONS && currentOf(p)["a.ts"] === String(MAX_VERSIONS + 5));
t("pruned versions fold into base", p.base["a.ts"] === "5");

let big = createHistory({ "a.ts": "x" });
for (let i = 0; i < 4; i++) big = commit(big, { "a.ts": String(i).repeat(900_000) }, "big " + i, { now: i + 1 });
const small = compact(big, MAX_DRAFT_CHARS);
t("compact shrinks history, keeps current", approxChars(small) <= MAX_DRAFT_CHARS && eq(currentOf(small), currentOf(big)) && small.versions.length < big.versions.length);

// ---------- drafts
const mem = (): StorageLike & { d: Map<string, string> } => { const d = new Map<string, string>(); return { d, getItem: k => d.get(k) ?? null, setItem: (k, v) => void d.set(k, v), removeItem: k => void d.delete(k) }; };
let st = mem();
const chat = [{ role: "user" as const, content: "hi" }, { role: "assistant" as const, content: "yo" }];
t("draft roundtrip keeps project, history and chat", saveDraft({ history: h, chat }, st).ok && eq(currentOf(loadDraft(st)!.history), currentOf(h)) && loadDraft(st)!.history.versions.length === 2 && loadDraft(st)!.chat.length === 2);
st = mem(); saveDraft({ history: big, chat: [] }, st);
t("saving oversize history compacts it to fit", st.d.get("builder:draft:v2")!.length < MAX_DRAFT_CHARS * 1.2 && eq(currentOf(loadDraft(st)!.history), currentOf(big)));
const bad = (mut: (d: any) => void) => { const s = mem(); saveDraft({ history: h, chat }, s); const d = JSON.parse(s.d.get("builder:draft:v2")!); mut(d); s.d.set("builder:draft:v2", JSON.stringify(d)); return loadDraft(s) === null; };
t("hostile path in a patch rejected", bad(d => { d.history.versions[0].patch["../x"] = "a"; }));
t("hostile path in base rejected", bad(d => { d.history.base["/etc/x"] = "a"; }));
t("non-text base file rejected", bad(d => { d.history.base["a.ts"] = 5; }));
t("bad chat role rejected", bad(d => { d.chat[0].role = "system"; }));
t("wrong version number rejected", bad(d => { d.v = 1; }));
st = mem(); st.setItem("builder:draft:v2", "{nope");
t("corrupt json removed", loadDraft(st) === null && st.d.size === 0);
const full: StorageLike = { getItem: () => null, removeItem() {}, setItem() { const e: any = new Error("full"); e.name = "QuotaExceededError"; throw e; } };
t("quota error reported", (saveDraft({ history: h, chat }, full) as any).reason === "storage_full");
t("no storage reported", (saveDraft({ history: h, chat }, null) as any).reason === "unavailable");

// ---------- stream reader
const got: string[] = []; const feed = createSseParser(x => got.push(x));
feed('data: {"a":1}\n\ndata: {"b"'); feed(':2}\n\n: ping\n\n'); feed("data: x\r\n\r\ndata: l1\ndata: l2\n\n");
t("sse: split chunks, comments, CRLF, multi-line", eq(got, ['{"a":1}', '{"b":2}', "x", "l1\nl2"]));

// ---------- images (pure parts)
t("asset slug", assetSlug("My Photo (1).PNG") === "my-photo-1" && assetSlug("***.png") === "image");
t("asset path avoids collisions", assetPathFor("logo.png", new Set(["src/assets/logo.ts", "src/assets/logo-2.ts"])) === "src/assets/logo-3.ts");
t("asset module is a default export of the data url", assetModule("data:image/png;base64,AAA") === 'export default "data:image/png;base64,AAA";\n');

// ---------- response validation
const okRes = { ok: true, reply: "x", attempts: 1, changes: { "src/a.ts": "x", "src/b.ts": null } };
t("validateResult accepts good", validateResult(okRes).ok === true);
const thr = (v: any) => { try { validateResult(v); return false; } catch { return true; } };
t("validateResult rejects bad shapes", thr(null) && thr({ ...okRes, changes: [] }) && thr({ ...okRes, changes: { "../x": "a" } }) && thr({ ...okRes, changes: { "src/a.ts": 5 } }) && thr({ ok: "yes" }));

// ---------- github (against a simulated GitHub)
function fakeGitHub(cfg: { exists?: boolean; priv?: boolean; pages?: "ok" | "409" | "403"; refMisses?: number; userStatus?: number; createStatus?: number; offline?: boolean } = {}) {
  const calls: { method: string; path: string; body: any; auth: string }[] = [];
  let misses = cfg.refMisses ?? 0;
  const R = (status: number, data: any = null) => new Response(status === 204 ? null : JSON.stringify(data), { status });
  const f: typeof fetch = async (url, init: any) => {
    if (cfg.offline) throw new Error("offline");
    const u = String(url).replace("https://api.github.com", ""); const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(init.body) : undefined;
    calls.push({ method, path: u, body, auth: init.headers.Authorization });
    const repo = "/repos/octo/my-app";
    if (u === "/user") return R(cfg.userStatus ?? 200, cfg.userStatus && cfg.userStatus !== 200 ? { message: "Bad credentials" } : { login: "octo" });
    if (u === repo && method === "GET") return cfg.exists ? R(200, { html_url: "https://github.com/octo/my-app", default_branch: "main", private: !!cfg.priv }) : R(404, { message: "Not Found" });
    if (u === "/user/repos") return cfg.createStatus && cfg.createStatus !== 201 ? R(cfg.createStatus, { message: "name already exists" }) : R(201, { html_url: "https://github.com/octo/my-app", default_branch: "main", private: body.private });
    if (u === repo + "/pages" && method === "POST") return cfg.pages === "409" ? R(409, { message: "exists" }) : cfg.pages === "403" ? R(403, { message: "Resource not accessible" }) : R(201, { html_url: "https://octo.github.io/my-app/" });
    if (u === repo + "/pages" && method === "PUT") return R(204);
    if (u === repo + "/git/ref/heads/main") return misses-- > 0 ? R(404, { message: "Not Found" }) : R(200, { object: { sha: "c0" } });
    if (u === repo + "/git/commits/c0") return R(200, { tree: { sha: "t0" } });
    if (u === repo + "/git/trees") return R(201, { sha: "t1" });
    if (u === repo + "/git/commits") return R(201, { sha: "c1" });
    if (u === repo + "/git/refs/heads/main") return R(200, {});
    return R(500, { message: "unexpected " + method + " " + u });
  };
  return { f, calls, idx: (m: string, p: string) => calls.findIndex(c => c.method === m && c.path === p) };
}
const files = { "package.json": "{}", "src/App.tsx": "app" };
const waits: number[] = []; const sleep = async (ms: number) => void waits.push(ms);
const base = { token: " ghp_x ", repoName: "my-app", isPrivate: false, publish: true, files, sleep };
const treeOf = (g: ReturnType<typeof fakeGitHub>) => g.calls.find(c => c.path.endsWith("/git/trees"))!.body.tree.map((x: any) => x.path);
const rejects = async (pr: Promise<any>, re: RegExp) => { try { await pr; return false; } catch (e) { return e instanceof GitHubError && re.test(e.message); } };

async function main() {
  let g = fakeGitHub({ refMisses: 2 });
  let res = await pushToGitHub({ ...base, fetchImpl: g.f });
  const paths = treeOf(g);
  t("github: new repo, files + README + workflow in one commit", res.created && paths.includes("src/App.tsx") && paths.includes("README.md") && paths.includes(WORKFLOW_PATH) && g.calls.find(c => c.path.endsWith("/git/trees"))!.body.base_tree === "t0");
  t("github: pages enabled BEFORE the commit is pushed", g.idx("POST", "/repos/octo/my-app/pages") < g.idx("POST", "/repos/octo/my-app/git/trees"));
  t("github: branch updated last, to the new commit", g.calls[g.calls.length - 1].method === "PATCH" && g.calls[g.calls.length - 1].body.sha === "c1");
  t("github: commit parent is the old head", g.calls.find(c => c.path.endsWith("/git/commits") && c.method === "POST")!.body.parents[0] === "c0");
  t("github: waited and retried while the new repo was not ready", waits.length === 2);
  t("github: token trimmed and sent as bearer", g.calls[0].auth === "Bearer ghp_x");
  t("github: result has urls", res.repoUrl === "https://github.com/octo/my-app" && res.pagesUrl === "https://octo.github.io/my-app/" && res.commitSha === "c1");

  g = fakeGitHub({ exists: true });
  res = await pushToGitHub({ ...base, fetchImpl: g.f });
  t("github: existing repo is reused, README untouched", !res.created && g.idx("POST", "/user/repos") === -1 && !treeOf(g).includes("README.md") && res.notes.some(n => /existing repository/.test(n)));

  g = fakeGitHub({ priv: true });
  res = await pushToGitHub({ ...base, isPrivate: true, fetchImpl: g.f });
  t("github: private repo skips publishing, no workflow", !res.pagesUrl && g.idx("POST", "/repos/octo/my-app/pages") === -1 && !treeOf(g).includes(WORKFLOW_PATH) && res.notes.some(n => /public repository/.test(n)));

  g = fakeGitHub({ pages: "409" });
  res = await pushToGitHub({ ...base, fetchImpl: g.f });
  t("github: pages already exists switches to Actions via PUT", g.idx("PUT", "/repos/octo/my-app/pages") !== -1 && !!res.pagesUrl);

  g = fakeGitHub({ pages: "403" });
  res = await pushToGitHub({ ...base, fetchImpl: g.f });
  t("github: pages failure still pushes code, no workflow, explains", !!res.commitSha && !res.pagesUrl && !treeOf(g).includes(WORKFLOW_PATH) && res.notes.some(n => /Publishing could not be turned on/.test(n)));

  g = fakeGitHub();
  res = await pushToGitHub({ ...base, publish: false, fetchImpl: g.f });
  t("github: publish off means no pages call and no workflow", g.idx("POST", "/repos/octo/my-app/pages") === -1 && !res.pagesUrl);

  t("github: bad token gives friendly error", await rejects(pushToGitHub({ ...base, fetchImpl: fakeGitHub({ userStatus: 401 }).f }), /did not accept that token/));
  t("github: name taken gives GitHub's reason", await rejects(pushToGitHub({ ...base, fetchImpl: fakeGitHub({ createStatus: 422 }).f }), /name already exists/));
  t("github: offline gives friendly error", await rejects(pushToGitHub({ ...base, fetchImpl: fakeGitHub({ offline: true }).f }), /Could not reach GitHub/));
  t("github: invalid repo name rejected before any call", await rejects(pushToGitHub({ ...base, repoName: "bad name!", fetchImpl: fakeGitHub().f }), /Repository names/));
  t("github: empty token rejected", await rejects(pushToGitHub({ ...base, token: "  ", fetchImpl: fakeGitHub().f }), /Paste a GitHub token/));
  t("github: stuck new repo times out cleanly", await rejects(pushToGitHub({ ...base, fetchImpl: fakeGitHub({ refMisses: 99 }).f }), /still preparing/));
  t("workflow keeps the page_url expression and uses Node 22", DEPLOY_WORKFLOW.includes("${{ steps.deployment.outputs.page_url }}") && DEPLOY_WORKFLOW.includes("node-version: 22"));

  console.log(fail ? `${fail} FAILED` : "ALL PASSED");
  process.exit(fail ? 1 : 0);
}
main();
