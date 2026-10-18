// orchestrator.ts
// The core loop: prompt -> LLM (streaming) -> tool calls -> apply edits -> retry on error.

import Anthropic from "@anthropic-ai/sdk";
import { EDIT_TOOLS, FileMap, applyOps, parseOps } from "./edit-parser";
import { buildSystemPrompt, pickRelevantFiles } from "./system-prompt";

export type Block =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: any };

export interface Msg {
  role: "user" | "assistant";
  content: string | any[];
}

export interface SimpleMsg {
  role: "user" | "assistant";
  content: string;
}

export interface ImageInput {
  mediaType: string; // image/jpeg, image/png, image/gif, image/webp
  data: string; // base64, no prefix
}

// Progress events streamed to the browser while a turn runs.
export type TurnEvent =
  | { type: "status"; text: string }
  | { type: "text"; delta: string }
  | { type: "reset" }; // a retry started: throw away the text streamed so far

export interface LlmClient {
  complete(args: {
    system: string;
    messages: Msg[];
    signal?: AbortSignal;
    onText?: (delta: string) => void;
  }): Promise<{ content: Block[]; stop_reason: string | null }>;
}

export function anthropicClient(apiKey = process.env.ANTHROPIC_API_KEY): LlmClient {
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");
  const client = new Anthropic({ apiKey });
  return {
    async complete({ system, messages, signal, onText }) {
      const stream = client.messages.stream(
        {
          model: process.env.MODEL ?? "claude-sonnet-5-5",
          max_tokens: 8000,
          system,
          messages: messages as any,
          tools: EDIT_TOOLS as any,
        },
        { signal }
      );
      if (onText) stream.on("text", (delta: string) => onText(delta));
      const res = await stream.finalMessage();
      return { content: res.content as Block[], stop_reason: res.stop_reason };
    },
  };
}

export interface TurnResult {
  ok: boolean;
  files: FileMap; // unchanged if ok is false
  reply: string;
  attempts: number;
  errors: string[];
}

const MAX_OPS_PER_TURN = 30;

export async function runTurn(opts: {
  llm: LlmClient;
  files: FileMap;
  userMessage: string;
  history?: SimpleMsg[];
  images?: ImageInput[];
  maxRetries?: number;
  signal?: AbortSignal;
  onEvent?: (e: TurnEvent) => void;
}): Promise<TurnResult> {
  const { llm, files, userMessage, signal } = opts;
  const maxRetries = opts.maxRetries ?? 3;
  const emit = (e: TurnEvent) => {
    try {
      opts.onEvent?.(e);
    } catch {
      // a broken listener must never break the turn
    }
  };

  const system = buildSystemPrompt(files, pickRelevantFiles(files, userMessage));
  const firstContent: string | any[] = opts.images?.length
    ? [
        ...opts.images.map((i) => ({
          type: "image",
          source: { type: "base64", media_type: i.mediaType, data: i.data },
        })),
        { type: "text", text: userMessage },
      ]
    : userMessage;
  const messages: Msg[] = [...(opts.history ?? []), { role: "user", content: firstContent }];

  let lastErrors: string[] = [];

  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    if (signal?.aborted) throw new Error("aborted");
    if (attempt === 1) {
      emit({ type: "status", text: "Thinking..." });
    } else {
      emit({ type: "reset" });
      emit({ type: "status", text: `Fixing a problem, trying again (attempt ${attempt})...` });
    }

    const res = await llm.complete({
      system,
      messages,
      signal,
      onText: (delta) => emit({ type: "text", delta }),
    });
    const text = res.content
      .filter((b): b is Extract<Block, { type: "text" }> => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();
    const toolUses = res.content.filter(
      (b): b is Extract<Block, { type: "tool_use" }> => b.type === "tool_use"
    );
    const truncated = res.stop_reason === "max_tokens";

    if (!toolUses.length && !truncated) {
      return { ok: true, files, reply: text, attempts: attempt, errors: [] };
    }

    emit({ type: "status", text: `Applying ${toolUses.length} change${toolUses.length === 1 ? "" : "s"}...` });

    let errors: string[] = [];
    if (truncated) {
      errors.push(
        "Your response was cut off, so the edits may be incomplete. Make smaller changes: fewer files per turn."
      );
    } else if (toolUses.length > MAX_OPS_PER_TURN) {
      errors.push(`Too many tool calls (${toolUses.length}). The limit is ${MAX_OPS_PER_TURN} per turn.`);
    } else {
      const parsed = parseOps(toolUses);
      if (parsed.errors.length) {
        errors = parsed.errors;
      } else {
        const result = applyOps(files, parsed.ops);
        if (result.ok) {
          return { ok: true, files: result.files, reply: text || "Done.", attempts: attempt, errors: [] };
        }
        errors = result.errors;
      }
    }

    lastErrors = errors;
    const feedback =
      "Nothing was applied. Fix these problems and resend ALL of your changes:\n- " + errors.join("\n- ");

    messages.push({ role: "assistant", content: res.content });
    if (toolUses.length) {
      messages.push({
        role: "user",
        content: toolUses.map((t) => ({
          type: "tool_result",
          tool_use_id: t.id,
          is_error: true,
          content: feedback,
        })),
      });
    } else {
      messages.push({ role: "user", content: feedback });
    }
  }

  return {
    ok: false,
    files,
    reply:
      "I could not apply that change safely, so nothing was modified. Try rephrasing or asking for a smaller change.",
    attempts: maxRetries + 1,
    errors: lastErrors,
  };
}
