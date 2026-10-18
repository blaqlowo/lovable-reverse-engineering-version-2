// drafts.ts
// Saves the user's work in THEIR browser (localStorage). Nothing is sent to your server.

import { History, MAX_VERSIONS, compact } from "./history";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface Draft {
  history: History; // the project plus its version history (current project = latest version)
  chat: ChatMessage[];
  savedAt: number;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export type SaveResult = { ok: true } | { ok: false; reason: "unavailable" | "storage_full" | "error" };

const KEY = "builder:draft:v2";
const MAX_FILES = 200;
const MAX_CHAT = 200;
// Browsers allow roughly 5 MB per site. Stay well under it.
export const MAX_DRAFT_CHARS = 2_000_000;

// Some browsers block storage (private mode, strict settings). Never let that crash the app.
export function browserStorage(): StorageLike | null {
  try {
    const s = window.localStorage;
    const probe = "__builder_probe__";
    s.setItem(probe, "1");
    s.removeItem(probe);
    return s;
  } catch {
    return null;
  }
}

const safePath = (p: string) => !p.includes("..") && !p.startsWith("/") && p.length > 0 && p.length <= 200;

function validFiles(f: any, allowNull: boolean): boolean {
  if (!f || typeof f !== "object" || Array.isArray(f)) return false;
  const entries = Object.entries(f as Record<string, unknown>);
  if (entries.length > MAX_FILES) return false;
  return entries.every(([p, c]) => safePath(p) && (typeof c === "string" || (allowNull && c === null)));
}

function validHistory(h: any): h is History {
  if (!h || typeof h !== "object") return false;
  if (!validFiles(h.base, false) || Object.keys(h.base).length === 0) return false;
  if (typeof h.nextId !== "number" || !Array.isArray(h.versions) || h.versions.length > MAX_VERSIONS + 5) return false;
  return h.versions.every(
    (v: any) =>
      v && typeof v.id === "number" && typeof v.label === "string" && typeof v.at === "number" && validFiles(v.patch, true)
  );
}

function validDraft(d: any): d is Draft {
  if (!d || typeof d !== "object" || d.v !== 2 || typeof d.savedAt !== "number") return false;
  if (!validHistory(d.history)) return false;
  if (!Array.isArray(d.chat) || d.chat.length > MAX_CHAT) return false;
  return d.chat.every(
    (m: any) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string"
  );
}

export function saveDraft(
  draft: Omit<Draft, "savedAt">,
  storage: StorageLike | null = browserStorage()
): SaveResult {
  if (!storage) return { ok: false, reason: "unavailable" };
  try {
    const history = compact(draft.history, MAX_DRAFT_CHARS);
    storage.setItem(KEY, JSON.stringify({ v: 2, history, chat: draft.chat, savedAt: Date.now() }));
    return { ok: true };
  } catch (e: any) {
    const full = e?.name === "QuotaExceededError" || e?.code === 22 || e?.code === 1014;
    return { ok: false, reason: full ? "storage_full" : "error" };
  }
}

// Returns null when there is no draft, or when the stored data is damaged (and removes it).
export function loadDraft(storage: StorageLike | null = browserStorage()): Draft | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (validDraft(parsed)) return parsed;
  } catch {
    // fall through to cleanup
  }
  try {
    storage.removeItem(KEY);
  } catch {
    // ignore
  }
  return null;
}

export function clearDraft(storage: StorageLike | null = browserStorage()): void {
  try {
    storage?.removeItem(KEY);
  } catch {
    // ignore
  }
}

// Waits for a pause in activity, then saves once. Call schedule() after every change.
export function createAutosaver(opts: {
  getDraft: () => Omit<Draft, "savedAt">;
  storage?: StorageLike | null;
  delayMs?: number;
  onResult?: (r: SaveResult) => void;
}) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const run = () => {
    timer = null;
    opts.onResult?.(saveDraft(opts.getDraft(), opts.storage ?? browserStorage()));
  };
  return {
    schedule() {
      if (timer) clearTimeout(timer);
      timer = setTimeout(run, opts.delayMs ?? 500);
    },
    flush() {
      if (timer) clearTimeout(timer);
      run();
    },
    cancel() {
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}
