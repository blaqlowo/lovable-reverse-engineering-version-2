// history.ts
// Version history kept entirely in the browser. Each version stores only what changed,
// so history stays small. Restoring never deletes anything: it adds a new version.

export type Project = Record<string, string>;
export type Patch = Record<string, string | null>; // null means the file was deleted

export interface Version {
  id: number;
  label: string;
  at: number; // ms since epoch
  patch: Patch;
}

export interface History {
  base: Project; // the project before the first kept version
  versions: Version[];
  nextId: number;
}

export const MAX_VERSIONS = 30;
const COALESCE_MS = 30_000;

export function createHistory(base: Project): History {
  return { base: { ...base }, versions: [], nextId: 1 };
}

function applyPatch(project: Project, patch: Patch): Project {
  const next: Project = { ...project };
  for (const [path, content] of Object.entries(patch)) {
    if (content === null) delete next[path];
    else next[path] = content;
  }
  return next;
}

export function diff(before: Project, after: Project): Patch {
  const out: Patch = {};
  for (const p of Object.keys(after)) if (before[p] !== after[p]) out[p] = after[p];
  for (const p of Object.keys(before)) if (!(p in after)) out[p] = null;
  return out;
}

// Project as it was after version number `index` (-1 means the starting point).
export function stateAt(h: History, index: number): Project {
  let state = h.base;
  for (let i = 0; i <= index && i < h.versions.length; i++) state = applyPatch(state, h.versions[i].patch);
  return state === h.base ? { ...h.base } : state;
}

export function currentOf(h: History): Project {
  return stateAt(h, h.versions.length - 1);
}

function clip(label: string): string {
  const one = label.replace(/\s+/g, " ").trim();
  return one.length > 80 ? one.slice(0, 79) + "…" : one || "Change";
}

// Record a new project state. Returns the same object when nothing changed.
// With coalesce, repeated edits with the same label within 30 seconds merge into one version.
export function commit(
  h: History,
  next: Project,
  label: string,
  opts: { coalesce?: boolean; now?: number } = {}
): History {
  const patch = diff(currentOf(h), next);
  if (Object.keys(patch).length === 0) return h;
  const now = opts.now ?? Date.now();
  const text = clip(label);
  const last = h.versions[h.versions.length - 1];

  if (opts.coalesce && last && last.label === text && now - last.at < COALESCE_MS) {
    const before = stateAt(h, h.versions.length - 2);
    const merged = diff(before, next);
    if (Object.keys(merged).length === 0) return { ...h, versions: h.versions.slice(0, -1) };
    return { ...h, versions: [...h.versions.slice(0, -1), { ...last, at: now, patch: merged }] };
  }

  let versions = [...h.versions, { id: h.nextId, label: text, at: now, patch }];
  let base = h.base;
  while (versions.length > MAX_VERSIONS) {
    base = applyPatch(base, versions[0].patch);
    versions = versions.slice(1);
  }
  return { base, versions, nextId: h.nextId + 1 };
}

// Go back to how the project was before the latest version. Itself a new version,
// so pressing Undo twice undoes the undo.
export function undo(h: History, now?: number): History {
  if (h.versions.length === 0) return h;
  return commit(h, stateAt(h, h.versions.length - 2), "Undo", { now });
}

export function restoreTo(h: History, id: number | "start", now?: number): History {
  if (id === "start") return commit(h, { ...h.base }, "Restored the starting point", { now });
  const idx = h.versions.findIndex((v) => v.id === id);
  if (idx === -1) return h;
  return commit(h, stateAt(h, idx), `Restored: ${h.versions[idx].label}`, { now });
}

// Rough size in characters, cheap to compute (no JSON needed).
export function approxChars(h: History): number {
  let n = 0;
  for (const [p, c] of Object.entries(h.base)) n += p.length + c.length;
  for (const v of h.versions) {
    n += v.label.length + 30;
    for (const [p, c] of Object.entries(v.patch)) n += p.length + (c ? c.length : 4);
  }
  return n;
}

// Fold the oldest versions into the base until the history fits in `maxChars`.
export function compact(h: History, maxChars: number): History {
  let cur = h;
  while (approxChars(cur) > maxChars && cur.versions.length > 0) {
    cur = { ...cur, base: applyPatch(cur.base, cur.versions[0].patch), versions: cur.versions.slice(1) };
  }
  return cur;
}
