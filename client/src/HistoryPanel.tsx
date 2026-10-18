import { useEffect } from "react";
import { History } from "./history";

interface Props {
  history: History;
  onRestore: (id: number | "start") => void;
  onClose: () => void;
}

export default function HistoryPanel({ history, onRestore, onClose }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const newestFirst = [...history.versions].reverse();
  const time = (at: number) => new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Version history"
        className="flex max-h-[80vh] w-full max-w-md flex-col rounded-xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h2 className="font-semibold">Version history</h2>
          <button onClick={onClose} className="rounded px-2 py-1 text-sm hover:bg-slate-100">
            Close
          </button>
        </div>
        <ul className="flex-1 divide-y overflow-y-auto">
          {newestFirst.map((v, i) => (
            <li key={v.id} className="flex items-center gap-3 px-4 py-2 text-sm">
              <div className="min-w-0 flex-1">
                <p className="truncate">{v.label}</p>
                <p className="text-xs text-slate-500">
                  {time(v.at)} · {Object.keys(v.patch).length} file{Object.keys(v.patch).length === 1 ? "" : "s"}
                  {i === 0 ? " · current" : ""}
                </p>
              </div>
              {i !== 0 && (
                <button onClick={() => onRestore(v.id)} className="shrink-0 rounded border px-2 py-1 text-xs hover:bg-slate-100">
                  Restore
                </button>
              )}
            </li>
          ))}
          <li className="flex items-center gap-3 px-4 py-2 text-sm">
            <div className="min-w-0 flex-1">
              <p>Starting point</p>
              <p className="text-xs text-slate-500">The oldest version kept</p>
            </div>
            {history.versions.length > 0 && (
              <button onClick={() => onRestore("start")} className="shrink-0 rounded border px-2 py-1 text-xs hover:bg-slate-100">
                Restore
              </button>
            )}
          </li>
        </ul>
        <p className="border-t px-4 py-2 text-xs text-slate-500">
          Restoring never deletes anything. It adds a new version, so you can always go back. The last 30 versions are kept in this browser.
        </p>
      </div>
    </div>
  );
}
