// client-helpers.ts
// Runs in the user's browser. The project lives only in memory here.

import JSZip from "jszip";

export type Project = Record<string, string>;
export type Changes = Record<string, string | null>; // null means deleted

// Merge the server's changes into the in-memory project. Returns a new object.
export function applyChanges(project: Project, changes: Changes): Project {
  const next: Project = { ...project };
  for (const [path, content] of Object.entries(changes)) {
    if (content === null) delete next[path];
    else next[path] = content;
  }
  return next;
}

export const README = `# My app

Built with an AI app builder. This is a standard Vite + React + TypeScript + Tailwind project.

## Run it

\`\`\`bash
npm install
npm run dev
\`\`\`

## Build for production

\`\`\`bash
npm run build
\`\`\`

The output goes in the \`dist\` folder and can be hosted on any static host.

Note: this project has no backend. If your app needs a database or login, connect your own
backend service (for example Supabase) and replace the placeholder data in the code.
`;

function safeName(name: string): string {
  const n = name.toLowerCase().replace(/[^a-z0-9-_]+/g, "-").replace(/^-+|-+$/g, "");
  return n || "my-app";
}

function makeZip(project: Project, name: string): { zip: JSZip; folder: string } {
  const folder = safeName(name);
  const zip = new JSZip();
  for (const [path, content] of Object.entries(project)) {
    zip.file(`${folder}/${path}`, content);
  }
  if (!("README.md" in project)) zip.file(`${folder}/README.md`, README);
  return { zip, folder };
}

// Build a ZIP that unpacks into one folder and runs with npm install + npm run dev.
export async function buildZip(project: Project, name = "my-app"): Promise<Uint8Array> {
  const { zip } = makeZip(project, name);
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}

// Browser only: trigger the download.
export async function downloadZip(project: Project, name = "my-app"): Promise<void> {
  const { zip, folder } = makeZip(project, name);
  const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${folder}.zip`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Since nothing is saved on the server, warn before the tab closes with unexported work.
// Call once on startup. Call markExported() after a successful download.
let dirty = false;
export function markDirty() {
  dirty = true;
}
export function markExported() {
  dirty = false;
}
export function warnBeforeLeave() {
  window.addEventListener("beforeunload", (e) => {
    if (dirty) {
      e.preventDefault();
      e.returnValue = "";
    }
  });
}
