import { KeyboardEvent, useMemo, useState } from "react";
import { Project } from "./history";

interface Props {
  project: Project;
  busy: boolean;
  onEdit: (path: string, text: string) => void;
}

export default function CodePanel({ project, busy, onEdit }: Props) {
  const paths = useMemo(() => Object.keys(project).sort(), [project]);
  const [chosen, setChosen] = useState("src/App.tsx");
  const active = paths.includes(chosen) ? chosen : paths.includes("src/App.tsx") ? "src/App.tsx" : paths[0];
  const isAsset = active?.startsWith("src/assets/");

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Escape hands the keyboard back so Tab can leave the editor.
    if (e.key === "Escape") (e.target as HTMLTextAreaElement).blur();
  };

  return (
    <div className="flex h-full min-h-0 flex-col md:flex-row">
      <nav aria-label="Project files" className="max-h-40 shrink-0 overflow-auto border-b bg-white p-2 md:max-h-none md:w-56 md:border-b-0 md:border-r">
        <ul className="space-y-0.5 text-sm">
          {paths.map((p) => (
            <li key={p}>
              <button
                onClick={() => setChosen(p)}
                aria-current={p === active}
                className={`w-full truncate rounded px-2 py-1 text-left font-mono text-xs ${p === active ? "bg-slate-900 text-white" : "hover:bg-slate-100"}`}
                title={p}
              >
                {p}
              </button>
            </li>
          ))}
        </ul>
      </nav>
      <div className="min-h-0 flex-1 bg-white">
        {!active ? null : isAsset ? (
          <p className="p-4 text-sm text-slate-500">This is an image saved as code. It cannot be edited here.</p>
        ) : (
          <textarea
            value={project[active] ?? ""}
            onChange={(e) => onEdit(active, e.target.value)}
            onKeyDown={onKeyDown}
            readOnly={busy}
            spellCheck={false}
            wrap="off"
            aria-label={`Code of ${active}`}
            className="h-full w-full resize-none overflow-auto whitespace-pre p-3 font-mono text-xs leading-5 outline-none read-only:bg-slate-50"
          />
        )}
      </div>
    </div>
  );
}
