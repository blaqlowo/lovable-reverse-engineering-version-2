// api.ts
// Talks to the stateless server. Every failure becomes a short, friendly message.

import type { Project } from "./client-helpers";
import type { HistoryMessage } from "./chat-utils";
import { createSseParser } from "./sse";

export class ApiError extends Error {
  stopped = false; // true when the user pressed Stop
}

export interface ChatResponse {
  ok: boolean;
  reply: string;
  attempts: number;
  changes: Record<string, string | null>;
}

export interface StreamHandlers {
  onStatus?: (text: string) => void;
  onText?: (delta: string) => void;
  onReset?: () => void;
}

const PATH = /^[A-Za-z0-9_@.\-/]+$/;
const validPath = (p: string) => PATH.test(p) && !p.includes("..") && !p.startsWith("/");

async function readJson(res: Response): Promise<any> {
  try {
    return await res.json();
  } catch {
    return null; // for example an HTML error page from a proxy
  }
}

export async function fetchTemplate(): Promise<Project> {
  let res: Response;
  try {
    res = await fetch("/api/template", { signal: AbortSignal.timeout(15_000) });
  } catch {
    throw new ApiError("Could not reach the server. Check your internet connection.");
  }
  const data = await readJson(res);
  const files = data?.files;
  if (!res.ok || !files || typeof files !== "object") throw new ApiError("Could not load the starter project.");
  for (const [p, c] of Object.entries(files)) {
    if (!validPath(p) || typeof c !== "string") throw new ApiError("The starter project was invalid.");
  }
  return files as Project;
}

// Never trust the server blindly: check the shape before the app uses it.
export function validateResult(data: any): ChatResponse {
  const changes = data?.changes;
  const valid =
    data &&
    typeof data.ok === "boolean" &&
    typeof data.reply === "string" &&
    changes &&
    typeof changes === "object" &&
    !Array.isArray(changes) &&
    Object.entries(changes).every(([p, c]) => validPath(p) && (c === null || typeof c === "string"));
  if (!valid) throw new ApiError("The server sent an unexpected response.");
  return data as ChatResponse;
}

export async function sendChatStream(
  body: {
    message: string;
    files: Project;
    history: HistoryMessage[];
    images?: { mediaType: string; data: string }[];
    turnstileToken?: string;
  },
  handlers: StreamHandlers = {},
  signal?: AbortSignal
): Promise<ChatResponse> {
  // One controller covers both the 3 minute limit and the user's Stop button.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new DOMException("Timed out", "TimeoutError")), 180_000);
  const onUserAbort = () => ctrl.abort(new DOMException("Stopped", "AbortError"));
  if (signal?.aborted) onUserAbort();
  signal?.addEventListener("abort", onUserAbort);

  const toError = (e: unknown): ApiError => {
    if (e instanceof ApiError) return e;
    const name = (e as any)?.name;
    if (name === "TimeoutError") return new ApiError("That took too long. Try a smaller request.");
    if (name === "AbortError") {
      const err = new ApiError("Stopped.");
      err.stopped = true;
      return err;
    }
    return new ApiError("Could not reach the server. Check your internet connection and try again.");
  };

  try {
    const res = await fetch("/api/chat/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });

    if (!res.ok || !(res.headers.get("content-type") ?? "").includes("text/event-stream")) {
      const data = await readJson(res);
      if (res.status === 413) throw new ApiError("Your project is too large to send. Remove some files or images and try again.");
      throw new ApiError(typeof data?.error === "string" ? data.error : `Request failed (${res.status}).`);
    }
    if (!res.body) throw new ApiError("Your browser could not read the response.");

    let result: ChatResponse | null = null;
    let streamError: string | null = null;
    const feed = createSseParser((raw) => {
      let e: any;
      try {
        e = JSON.parse(raw);
      } catch {
        return;
      }
      if (e?.type === "status" && typeof e.text === "string") handlers.onStatus?.(e.text);
      else if (e?.type === "text" && typeof e.delta === "string") handlers.onText?.(e.delta);
      else if (e?.type === "reset") handlers.onReset?.();
      else if (e?.type === "result") {
        try {
          result = validateResult(e);
        } catch (err) {
          streamError = (err as Error).message;
        }
      } else if (e?.type === "error") streamError = typeof e.message === "string" ? e.message : "Something went wrong.";
    });

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      feed(decoder.decode(value, { stream: true }));
    }
    if (streamError) throw new ApiError(streamError);
    if (!result) throw new ApiError("The connection closed before the answer finished. Please try again.");
    return result;
  } catch (e) {
    throw toError(e);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onUserAbort);
  }
}
