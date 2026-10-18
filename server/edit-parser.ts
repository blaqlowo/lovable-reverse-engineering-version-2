// edit-parser.ts
// Tool definitions for the LLM plus an atomic, validating edit applier.

export type FileMap = Map<string, string>;

export type EditOp =
  | { type: "write_file"; path: string; content: string }
  | { type: "edit_file"; path: string; search: string; replace: string }
  | { type: "delete_file"; path: string }
  | { type: "rename_file"; from: string; to: string };

export interface ApplyResult {
  ok: boolean;
  files: FileMap; // new state if ok, original state if not
  applied: number;
  errors: string[]; // send these back to the model as the next turn
}

// 1) Tool schemas to pass to the LLM API (Anthropic tool-use format).
export const EDIT_TOOLS = [
  {
    name: "write_file",
    description: "Create a new file or fully replace a small file.",
    input_schema: {
      type: "object",
      properties: { path: { type: "string" }, content: { type: "string" } },
      required: ["path", "content"],
    },
  },
  {
    name: "edit_file",
    description:
      "Replace one exact snippet in an existing file. 'search' must match exactly once. Include enough surrounding lines to be unique.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string" },
        search: { type: "string" },
        replace: { type: "string" },
      },
      required: ["path", "search", "replace"],
    },
  },
  {
    name: "delete_file",
    description: "Delete a file.",
    input_schema: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
    },
  },
  {
    name: "rename_file",
    description: "Rename or move a file.",
    input_schema: {
      type: "object",
      properties: { from: { type: "string" }, to: { type: "string" } },
      required: ["from", "to"],
    },
  },
] as const;

const ALLOWED_ROOTS = ["src/", "public/"];
const ALLOWED_TOP_FILES = new Set([
  "index.html",
  "package.json",
  "tailwind.config.ts",
  "vite.config.ts",
]);

// 2) Path safety: no traversal, no absolute paths, only known locations.
function checkPath(p: string): string | null {
  if (!p || p.startsWith("/") || p.includes("..") || p.includes("\\")) {
    return `Invalid path "${p}"`;
  }
  if (ALLOWED_TOP_FILES.has(p)) return null;
  if (ALLOWED_ROOTS.some((r) => p.startsWith(r))) return null;
  return `Path "${p}" is outside allowed locations`;
}

// 3) Convert raw tool_use blocks from the LLM into typed ops.
export function parseOps(
  blocks: { name: string; input: any }[]
): { ops: EditOp[]; errors: string[] } {
  const ops: EditOp[] = [];
  const errors: string[] = [];
  for (const b of blocks) {
    const i = b.input ?? {};
    switch (b.name) {
      case "write_file":
        if (typeof i.path === "string" && typeof i.content === "string")
          ops.push({ type: "write_file", path: i.path, content: i.content });
        else errors.push("write_file needs string path and content");
        break;
      case "edit_file":
        if (
          typeof i.path === "string" &&
          typeof i.search === "string" &&
          typeof i.replace === "string"
        )
          ops.push({
            type: "edit_file",
            path: i.path,
            search: i.search,
            replace: i.replace,
          });
        else errors.push("edit_file needs string path, search, replace");
        break;
      case "delete_file":
        if (typeof i.path === "string")
          ops.push({ type: "delete_file", path: i.path });
        else errors.push("delete_file needs string path");
        break;
      case "rename_file":
        if (typeof i.from === "string" && typeof i.to === "string")
          ops.push({ type: "rename_file", from: i.from, to: i.to });
        else errors.push("rename_file needs string from and to");
        break;
      default:
        errors.push(`Unknown tool "${b.name}"`);
    }
  }
  return { ops, errors };
}

// 4) Snippet replacement: exact match first, then whitespace-tolerant fallback.
function replaceSnippet(
  content: string,
  search: string,
  replace: string
): { ok: true; result: string } | { ok: false; error: string } {
  if (search.trim() === "") return { ok: false, error: "Empty search string" };

  // Exact match, must be unique. Slice instead of String.replace so "$&" is safe.
  const first = content.indexOf(search);
  if (first !== -1) {
    const second = content.indexOf(search, first + 1);
    if (second !== -1)
      return {
        ok: false,
        error: "Search matches more than once. Add surrounding lines.",
      };
    return {
      ok: true,
      result: content.slice(0, first) + replace + content.slice(first + search.length),
    };
  }

  // Fallback: compare line by line, ignoring indentation and trailing spaces.
  const lines = content.split("\n");
  const sLines = search.split("\n").map((l) => l.trim());
  while (sLines.length && sLines[sLines.length - 1] === "") sLines.pop();
  const hits: number[] = [];
  for (let i = 0; i + sLines.length <= lines.length; i++) {
    if (sLines.every((s, j) => lines[i + j].trim() === s)) hits.push(i);
  }
  if (hits.length === 0)
    return { ok: false, error: "Search text not found in file" };
  if (hits.length > 1)
    return { ok: false, error: "Search matches more than once. Add surrounding lines." };

  const start = hits[0];
  const out = [
    ...lines.slice(0, start),
    ...replace.split("\n"),
    ...lines.slice(start + sLines.length),
  ];
  return { ok: true, result: out.join("\n") };
}

// 5) Apply all ops atomically: if any op fails, nothing changes.
export function applyOps(original: FileMap, ops: EditOp[]): ApplyResult {
  const files: FileMap = new Map(original);
  const errors: string[] = [];
  let applied = 0;

  ops.forEach((op, idx) => {
    const tag = `op ${idx + 1} (${op.type})`;
    const paths = op.type === "rename_file" ? [op.from, op.to] : [op.path];
    for (const p of paths) {
      const e = checkPath(p);
      if (e) return void errors.push(`${tag}: ${e}`);
    }
    if (errors.some((e) => e.startsWith(tag))) return;

    switch (op.type) {
      case "write_file":
        files.set(op.path, op.content);
        applied++;
        break;
      case "edit_file": {
        const cur = files.get(op.path);
        if (cur === undefined) {
          errors.push(`${tag}: file "${op.path}" does not exist`);
          break;
        }
        const r = replaceSnippet(cur, op.search, op.replace);
        if (!r.ok) errors.push(`${tag}: ${r.error} in "${op.path}"`);
        else {
          files.set(op.path, r.result);
          applied++;
        }
        break;
      }
      case "delete_file":
        if (!files.delete(op.path))
          errors.push(`${tag}: file "${op.path}" does not exist`);
        else applied++;
        break;
      case "rename_file": {
        const cur = files.get(op.from);
        if (cur === undefined) {
          errors.push(`${tag}: file "${op.from}" does not exist`);
          break;
        }
        files.delete(op.from);
        files.set(op.to, cur);
        applied++;
        break;
      }
    }
  });

  if (errors.length) return { ok: false, files: original, applied: 0, errors };
  return { ok: true, files, applied, errors: [] };
}

// 6) Usage sketch inside your orchestrator:
//
//   const { ops, errors: parseErrors } = parseOps(toolUseBlocks);
//   const result = applyOps(projectFiles, ops);
//   if (!result.ok) {
//     // Feed result.errors (and parseErrors) back to the LLM as a tool_result
//     // so it can retry with a corrected edit.
//   } else {
//     // Persist result.files to Supabase, then hot-reload the sandbox.
//   }
