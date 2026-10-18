import { applyOps, parseOps, FileMap } from "../edit-parser";
let fail = 0;
const t = (n: string, c: boolean) => { console.log((c ? "PASS " : "FAIL ") + n); if (!c) fail++; };
const base: FileMap = new Map([["src/App.tsx", "export default function App() {\n  return <div>Hi</div>;\n}\n"]]);

let r = applyOps(base, [{ type: "edit_file", path: "src/App.tsx", search: "<div>Hi</div>", replace: "<div>Hello</div>" }]);
t("exact edit", r.ok && r.files.get("src/App.tsx")!.includes("Hello"));

r = applyOps(base, [{ type: "edit_file", path: "src/App.tsx", search: "return <div>Hi</div>;", replace: "return <p>$&</p>;" }]);
t("dollar patterns are literal", r.ok && r.files.get("src/App.tsx")!.includes("<p>$&</p>"));

r = applyOps(base, [{ type: "edit_file", path: "src/App.tsx", search: "return <div>Hi</div>;", replace: "  return <b>Yo</b>;" }]);
t("fuzzy indentation match", r.ok && r.files.get("src/App.tsx")!.includes("<b>Yo</b>"));

const dup: FileMap = new Map([["src/a.ts", "x\nx\n"]]);
r = applyOps(dup, [{ type: "edit_file", path: "src/a.ts", search: "x", replace: "y" }]);
t("ambiguous match rejected", !r.ok && r.files === dup);

r = applyOps(base, [
  { type: "write_file", path: "src/New.tsx", content: "ok" },
  { type: "edit_file", path: "src/App.tsx", search: "NOPE", replace: "z" },
]);
t("atomic: one failure applies nothing", !r.ok && !r.files.has("src/New.tsx"));

r = applyOps(base, [{ type: "write_file", path: "../etc/passwd", content: "x" }]);
t("path traversal blocked", !r.ok);

r = applyOps(base, [{ type: "write_file", path: "node_modules/x.js", content: "x" }]);
t("outside roots blocked", !r.ok);

r = applyOps(base, [{ type: "rename_file", from: "src/App.tsx", to: "src/Main.tsx" }]);
t("rename", r.ok && r.files.has("src/Main.tsx") && !r.files.has("src/App.tsx"));

r = applyOps(base, [{ type: "delete_file", path: "src/Nope.tsx" }]);
t("delete missing file errors", !r.ok);

r = applyOps(base, [{ type: "edit_file", path: "src/App.tsx", search: "  ", replace: "z" }]);
t("whitespace-only search rejected", !r.ok);

const p = parseOps([{ name: "edit_file", input: { path: 1 } }, { name: "bogus", input: {} }]);
t("parseOps flags bad input", p.errors.length === 2 && p.ops.length === 0);

console.log(fail ? `${fail} FAILED` : "ALL PASSED");
