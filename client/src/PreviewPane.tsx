import { useState } from "react";
import Preview from "./Preview";
import { Project } from "./history";

const DEVICES = [
  { id: "mobile", label: "Phone", width: 390 },
  { id: "tablet", label: "Tablet", width: 768 },
  { id: "desktop", label: "Desktop", width: 0 },
] as const;

interface Props {
  project: Project;
  onError: (message: string | null) => void;
}

export default function PreviewPane({ project, onError }: Props) {
  const [device, setDevice] = useState<(typeof DEVICES)[number]["id"]>("desktop");
  const width = DEVICES.find((d) => d.id === device)!.width;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-1 border-b bg-white px-3 py-1.5" role="group" aria-label="Preview size">
        {DEVICES.map((d) => (
          <button
            key={d.id}
            onClick={() => setDevice(d.id)}
            aria-pressed={device === d.id}
            className={`rounded px-2 py-1 text-xs ${device === d.id ? "bg-slate-900 text-white" : "hover:bg-slate-100"}`}
          >
            {d.label}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-auto bg-slate-200">
        <div data-testid="preview-frame" className="mx-auto h-full bg-white shadow" style={{ width: width || "100%", maxWidth: "100%" }}>
          <Preview project={project} onError={onError} />
        </div>
      </div>
    </div>
  );
}
