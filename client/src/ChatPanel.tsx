import { ChangeEvent, KeyboardEvent, useEffect, useRef } from "react";
import { ChatItem, MAX_MESSAGE_CHARS } from "./chat-utils";
import { Attachment, MAX_IMAGES } from "./images";

interface Props {
  items: ChatItem[];
  busy: boolean;
  streamText: string;
  status: string;
  input: string;
  setInput: (v: string) => void;
  onSend: () => void;
  onStop: () => void;
  attachments: Attachment[];
  onAddFiles: (files: File[]) => void;
  onRemoveAttachment: (id: number) => void;
  attachError: string | null;
  saveAsAssets: boolean;
  setSaveAsAssets: (v: boolean) => void;
  restored: boolean;
  ready: boolean;
}

export default function ChatPanel(p: Props) {
  const listRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [p.items, p.streamText, p.busy]);

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      p.onSend();
    }
  };
  const onPick = (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = ""; // allow picking the same file again
    if (files.length) p.onAddFiles(files);
  };

  return (
    <>
      <div ref={listRef} className="flex-1 space-y-3 overflow-y-auto p-4" aria-live="polite">
        {p.restored && (
          <p className="rounded bg-sky-50 px-3 py-2 text-sm text-sky-900">
            Welcome back. Your saved draft was restored from this browser.
          </p>
        )}
        {p.items.map((m) => (
          <div key={m.id} className={m.role === "user" ? "text-right" : ""}>
            {m.images && m.images.length > 0 && (
              <div className="mb-1 flex justify-end gap-1">
                {m.images.map((src, i) => (
                  <img key={i} src={src} alt="attached" className="h-16 w-16 rounded object-cover" />
                ))}
              </div>
            )}
            <div
              className={`inline-block max-w-[90%] whitespace-pre-wrap rounded-lg px-3 py-2 text-left text-sm ${
                m.role === "user" ? "bg-slate-900 text-white" : m.failed ? "bg-red-50 text-red-900" : "bg-slate-100"
              }`}
            >
              {m.content}
            </div>
            {m.changed && m.changed.length > 0 && (
              <p className="mt-1 text-xs text-slate-500">Changed: {m.changed.join(", ")}</p>
            )}
          </div>
        ))}
        {p.busy && (
          <div>
            <div data-testid="stream" className="inline-block max-w-[90%] whitespace-pre-wrap rounded-lg bg-slate-100 px-3 py-2 text-sm">
              {p.streamText || "..."}
            </div>
            {p.status && <p className="mt-1 text-xs text-slate-500">{p.status}</p>}
          </div>
        )}
      </div>

      <div className="border-t p-3">
        {p.attachments.length > 0 && (
          <div className="mb-2">
            <div className="flex flex-wrap gap-2">
              {p.attachments.map((a) => (
                <div key={a.id} className="relative">
                  <img src={a.dataUrl} alt={a.name} className="h-14 w-14 rounded border object-cover" />
                  <button
                    onClick={() => p.onRemoveAttachment(a.id)}
                    aria-label={`Remove ${a.name}`}
                    className="absolute -right-1 -top-1 h-5 w-5 rounded-full bg-slate-900 text-xs leading-5 text-white"
                  >
                    x
                  </button>
                </div>
              ))}
            </div>
            <label className="mt-2 flex items-center gap-2 text-xs text-slate-600">
              <input type="checkbox" checked={p.saveAsAssets} onChange={(e) => p.setSaveAsAssets(e.target.checked)} />
              Also add these images to the app's files so they can be used on the page
            </label>
          </div>
        )}
        {p.attachError && (
          <p role="alert" className="mb-2 text-xs text-red-700">
            {p.attachError}
          </p>
        )}
        <textarea
          value={p.input}
          onChange={(e) => p.setInput(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={!p.ready || p.busy}
          maxLength={MAX_MESSAGE_CHARS - 300}
          rows={3}
          placeholder="What should we build or change?"
          aria-label="Message"
          className="w-full resize-none rounded border p-2 text-sm disabled:bg-slate-100"
        />
        <div className="mt-2 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={onPick} aria-label="Attach images" />
            <button
              onClick={() => fileRef.current?.click()}
              disabled={!p.ready || p.busy || p.attachments.length >= MAX_IMAGES}
              className="rounded border px-3 py-1.5 text-sm hover:bg-slate-100 disabled:opacity-50"
            >
              Attach image
            </button>
            <span className="hidden text-xs text-slate-500 sm:inline">Enter to send</span>
          </div>
          {p.busy ? (
            <button onClick={p.onStop} className="rounded border border-red-300 px-4 py-1.5 text-sm text-red-800 hover:bg-red-50">
              Stop
            </button>
          ) : (
            <button
              onClick={p.onSend}
              disabled={!p.ready || !p.input.trim()}
              className="rounded bg-slate-900 px-4 py-1.5 text-sm text-white disabled:opacity-50"
            >
              Send
            </button>
          )}
        </div>
        <p className="mt-2 text-xs text-slate-400">
          Your project stays in this browser. Your messages, files, and images are sent to an AI service to build each
          change and are not stored by us.
        </p>
      </div>
    </>
  );
}
