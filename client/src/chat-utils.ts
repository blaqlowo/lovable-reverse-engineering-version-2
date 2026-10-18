// chat-utils.ts
// Pure helpers for turning the on-screen chat into clean history.

export interface ChatItem {
  id: number;
  role: "user" | "assistant";
  content: string;
  failed?: boolean;
  changed?: string[];
  images?: string[]; // small preview pictures shown in the chat (not saved in drafts)
}

export interface HistoryMessage {
  role: "user" | "assistant";
  content: string;
}

export const MAX_MESSAGE_CHARS = 4000;

// Keep only complete, successful question/answer pairs. Used both for the history sent to
// the AI and for the saved draft. A message still waiting for its reply, or a failed turn,
// is left out so the history is always a clean user/assistant alternation.
export function completePairs(items: ChatItem[]): HistoryMessage[] {
  const ok = items.filter((i) => !i.failed);
  const out: HistoryMessage[] = [];
  for (let i = 0; i < ok.length - 1; i++) {
    if (ok[i].role === "user" && ok[i + 1].role === "assistant") {
      out.push(
        { role: "user", content: ok[i].content.slice(0, MAX_MESSAGE_CHARS) },
        { role: "assistant", content: ok[i + 1].content.slice(0, MAX_MESSAGE_CHARS) }
      );
      i++;
    }
  }
  return out;
}

// Friendly text for any thrown value.
export function messageOf(e: unknown): string {
  return e instanceof Error && e.message ? e.message : "Something went wrong. Please try again.";
}
