import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ChatPanel from "./ChatPanel";
import CodePanel from "./CodePanel";
import GitHubDialog from "./GitHubDialog";
import HistoryPanel from "./HistoryPanel";
import PreviewPane from "./PreviewPane";
import StartScreen from "./StartScreen";
import { ApiError, fetchTemplate, sendChatStream } from "./api";
import { ChatItem, MAX_MESSAGE_CHARS, completePairs, messageOf } from "./chat-utils";
import { applyChanges, downloadZip, markDirty, markExported, warnBeforeLeave } from "./client-helpers";
import { APP_NAME, TURNSTILE_SITE_KEY } from "./config";
import { clearDraft, createAutosaver, loadDraft } from "./drafts";
import { History, Project, commit, createHistory, currentOf, restoreTo, undo } from "./history";
import { Attachment, MAX_IMAGES, assetModule, assetPathFor, prepareImage } from "./images";
import { buildFixPrompt } from "./preview-files";
import { getTurnstileToken } from "./turnstile";

type Tab = "chat" | "preview" | "code";

export default function App() {
  // A saved draft is read once, before the first screen is drawn, so there is no flash.
  const [boot] = useState(() => loadDraft());
  const [hist, setHist] = useState<History | null>(boot?.history ?? null);
  const [chat, setChat] = useState<ChatItem[]>(() => (boot ? boot.chat.map((m, i) => ({ id: i + 1, ...m })) : []));
  const [view, setView] = useState<"start" | "work">(boot ? "work" : "start");
  const [restored, setRestored] = useState(!!boot);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [streamText, setStreamText] = useState("");
  const [status, setStatus] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [draftProblem, setDraftProblem] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("chat");
  const [showHistory, setShowHistory] = useState(false);
  const [showGitHub, setShowGitHub] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [attachError, setAttachError] = useState<string | null>(null);
  const [saveAsAssets, setSaveAsAssets] = useState(true);

  const nextId = useRef((boot?.chat.length ?? 0) + 1);
  const abortRef = useRef<AbortController | null>(null);

  const project: Project | null = useMemo(() => (hist ? currentOf(hist) : null), [hist]);

  // Always-current copy of the state, so the autosaver never saves stale data.
  const latest = useRef<{ hist: History | null; chat: ChatItem[] }>({ hist: null, chat: [] });
  latest.current = { hist, chat };

  const saver = useMemo(
    () =>
      createAutosaver({
        getDraft: () => ({ history: latest.current.hist!, chat: completePairs(latest.current.chat) }),
        onResult: (r) => {
          setDraftProblem(!r.ok);
          // If the draft could not be saved, warn before the tab closes. Otherwise no warning.
          if (r.ok) markExported();
          else markDirty();
        },
      }),
    []
  );

  const loadTemplate = useCallback(async () => {
    setLoadError(null);
    try {
      setHist(createHistory(await fetchTemplate()));
    } catch (e) {
      setLoadError(messageOf(e));
    }
  }, []);

  useEffect(() => {
    warnBeforeLeave();
    if (!boot) void loadTemplate();
  }, [boot, loadTemplate]);

  // Save after every change (only once a real session has started), and when the tab is hidden.
  useEffect(() => {
    if (hist && view === "work") saver.schedule();
  }, [hist, chat, view, saver]);

  useEffect(() => {
    const flush = () => {
      if (latest.current.hist) saver.flush();
    };
    const onVisibility = () => document.visibilityState === "hidden" && flush();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", flush);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", flush);
    };
  }, [saver]);

  const send = useCallback(
    async (text: string) => {
      const message = text.trim();
      if (!message || busy || !hist || !project) return;

      const userId = nextId.current++;
      const history = completePairs(chat).slice(-10);
      const atts = attachments;

      // Images the user wants kept become files in the project (only if the turn succeeds).
      const assetFiles: Project = {};
      if (saveAsAssets) {
        const taken = new Set(Object.keys(project));
        for (const a of atts) {
          const path = assetPathFor(a.name, taken);
          taken.add(path);
          assetFiles[path] = assetModule(a.dataUrl);
        }
      }
      const assetPaths = Object.keys(assetFiles);
      const note = !atts.length
        ? ""
        : assetPaths.length
          ? `\n\n(Attached images are saved in the project as: ${assetPaths.join(", ")})`
          : "\n\n(The images are for reference only. Do not add them to the app.)";
      const sent = message.slice(0, MAX_MESSAGE_CHARS - note.length) + note;

      setView("work");
      setChat((prev) => [...prev, { id: userId, role: "user", content: message, images: atts.map((a) => a.dataUrl) }]);
      setInput("");
      setAttachments([]);
      setAttachError(null);
      setBusy(true);
      setStreamText("");
      setStatus("Starting...");
      setTab("chat");

      const ctrl = new AbortController();
      abortRef.current = ctrl;
      try {
        const token = TURNSTILE_SITE_KEY ? await getTurnstileToken(TURNSTILE_SITE_KEY) : undefined;
        const res = await sendChatStream(
          {
            message: sent,
            files: { ...project, ...assetFiles },
            history,
            images: atts.map((a) => ({ mediaType: a.mediaType, data: a.data })),
            turnstileToken: token,
          },
          { onStatus: setStatus, onText: (d) => setStreamText((s) => s + d), onReset: () => setStreamText("") },
          ctrl.signal
        );
        setChat((prev) => [
          ...prev.map((i) => (i.id === userId && !res.ok ? { ...i, failed: true } : i)),
          { id: nextId.current++, role: "assistant", content: res.reply, failed: !res.ok, changed: Object.keys(res.changes) },
        ]);
        if (res.ok) {
          setHist((h) => (h ? commit(h, applyChanges({ ...currentOf(h), ...assetFiles }, res.changes), message) : h));
        }
      } catch (e) {
        const stopped = e instanceof ApiError && e.stopped;
        setChat((prev) => [
          ...prev.map((i) => (i.id === userId ? { ...i, failed: true } : i)),
          { id: nextId.current++, role: "assistant", content: stopped ? "Stopped. Nothing was changed." : messageOf(e), failed: true },
        ]);
      } finally {
        setBusy(false);
        setStreamText("");
        setStatus("");
        abortRef.current = null;
      }
    },
    [busy, hist, project, chat, attachments, saveAsAssets]
  );

  const addFiles = async (files: File[]) => {
    setAttachError(null);
    const room = MAX_IMAGES - attachments.length;
    if (files.length > room) setAttachError(`You can attach up to ${MAX_IMAGES} images at a time.`);
    for (const file of files.slice(0, Math.max(0, room))) {
      try {
        const prepared = await prepareImage(file);
        setAttachments((prev) => (prev.length >= MAX_IMAGES ? prev : [...prev, { id: nextId.current++, ...prepared }]));
      } catch (e) {
        setAttachError(messageOf(e));
      }
    }
  };

  const editFile = useCallback((path: string, text: string) => {
    setHist((h) => (h ? commit(h, { ...currentOf(h), [path]: text }, "Manual edit", { coalesce: true }) : h));
  }, []);

  const exportZip = async () => {
    if (!project) return;
    setExportError(null);
    try {
      await downloadZip(project, "my-app");
      markExported();
    } catch {
      setExportError("Could not create the download. Please try again.");
    }
  };

  const newProject = async () => {
    if (busy) return;
    const sure = window.confirm(
      "Start a new project? Your current project and its history will be removed from this browser. Export it first if you want to keep it."
    );
    if (!sure) return;
    saver.cancel();
    clearDraft();
    setChat([]);
    setAttachments([]);
    setPreviewError(null);
    setRestored(false);
    setHist(null);
    setView("start");
    setTab("chat");
    await loadTemplate();
  };

  if (view === "start") {
    return (
      <StartScreen
        appName={APP_NAME}
        ready={!!hist}
        error={loadError}
        onRetry={() => void loadTemplate()}
        onSubmit={(t) => void send(t)}
      />
    );
  }

  const canUndo = !!hist && hist.versions.length > 0 && !busy;
  const right = tab === "code" ? "code" : "preview";
  const fileCount = project ? Object.keys(project).length : 0;
  const tabBtn = (id: Tab, label: string, extra = "", selected = tab === id) => (
    <button
      key={id}
      onClick={() => setTab(id)}
      aria-pressed={selected}
      className={`${extra} ${selected ? "border-b-2 border-slate-900 font-medium" : "text-slate-500"}`}
    >
      {label}
    </button>
  );

  return (
    <div className="flex h-full flex-col bg-slate-50 text-slate-900">
      <header className="flex flex-wrap items-center gap-2 border-b bg-white px-4 py-2">
        <h1 className="mr-auto text-lg font-semibold">{APP_NAME}</h1>
        <button onClick={() => hist && !busy && setHist(undo(hist))} disabled={!canUndo} className="rounded border px-3 py-1.5 text-sm hover:bg-slate-100 disabled:opacity-50">
          Undo
        </button>
        <button onClick={() => setShowHistory(true)} disabled={!hist} className="rounded border px-3 py-1.5 text-sm hover:bg-slate-100 disabled:opacity-50">
          History
        </button>
        <button onClick={() => setShowGitHub(true)} disabled={!project || busy} className="rounded border px-3 py-1.5 text-sm hover:bg-slate-100 disabled:opacity-50">
          GitHub
        </button>
        <button onClick={newProject} disabled={busy} className="rounded border px-3 py-1.5 text-sm hover:bg-slate-100 disabled:opacity-50">
          New project
        </button>
        <button onClick={exportZip} disabled={!project} className="rounded bg-slate-900 px-3 py-1.5 text-sm text-white hover:bg-slate-700 disabled:opacity-50">
          Export code (ZIP)
        </button>
      </header>

      {draftProblem && (
        <div role="alert" className="bg-amber-100 px-4 py-2 text-sm text-amber-900">
          Your browser would not let us save a draft, so your work is not saved. Export your code before you close this tab.
        </div>
      )}
      {exportError && (
        <div role="alert" className="bg-red-100 px-4 py-2 text-sm text-red-900">
          {exportError}
        </div>
      )}

      <div className="flex border-b bg-white md:hidden">
        {(["chat", "preview", "code"] as Tab[]).map((id) => tabBtn(id, id[0].toUpperCase() + id.slice(1), "flex-1 py-2 text-sm"))}
      </div>

      <main className="grid min-h-0 flex-1 md:grid-cols-[minmax(320px,2fr)_3fr]">
        <section className={`${tab === "chat" ? "flex" : "hidden"} min-h-0 flex-col border-r bg-white md:flex`}>
          <ChatPanel
            items={chat}
            busy={busy}
            streamText={streamText}
            status={status}
            input={input}
            setInput={setInput}
            onSend={() => void send(input)}
            onStop={() => abortRef.current?.abort()}
            attachments={attachments}
            onAddFiles={(f) => void addFiles(f)}
            onRemoveAttachment={(id) => setAttachments((prev) => prev.filter((a) => a.id !== id))}
            attachError={attachError}
            saveAsAssets={saveAsAssets}
            setSaveAsAssets={setSaveAsAssets}
            restored={restored}
            ready={!!project}
          />
        </section>

        <section className={`${tab !== "chat" ? "flex" : "hidden"} min-h-0 flex-col md:flex`}>
          <div className="hidden items-center gap-4 border-b bg-white px-4 md:flex" role="group" aria-label="Right panel">
            {tabBtn("preview", "Preview", "py-2 text-sm", right === "preview")}
            {tabBtn("code", "Code", "py-2 text-sm", right === "code")}
          </div>
          {previewError && !busy && (
            <div role="alert" className="flex items-center gap-3 bg-red-50 px-4 py-2 text-sm text-red-900">
              <span className="min-w-0 flex-1 truncate">The preview has an error: {previewError}</span>
              <button onClick={() => void send(buildFixPrompt(previewError))} className="shrink-0 rounded bg-red-700 px-3 py-1 text-white hover:bg-red-600">
                Try to fix
              </button>
            </div>
          )}
          <div className="min-h-0 flex-1">
            {!project ? (
              <p className="p-4 text-sm text-slate-500">Loading...</p>
            ) : right === "preview" ? (
              <PreviewPane project={project} onError={setPreviewError} />
            ) : (
              <CodePanel project={project} busy={busy} onEdit={editFile} />
            )}
          </div>
          <p className="border-t bg-white px-4 py-1 text-xs text-slate-500">{fileCount} files in this project</p>
        </section>
      </main>

      {showHistory && hist && (
        <HistoryPanel
          history={hist}
          onRestore={(id) => {
            if (!busy) setHist((h) => (h ? restoreTo(h, id) : h));
            setShowHistory(false);
          }}
          onClose={() => setShowHistory(false)}
        />
      )}
      {showGitHub && project && <GitHubDialog project={project} onClose={() => setShowGitHub(false)} />}
    </div>
  );
}
