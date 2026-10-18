// preview-files.ts
// Pure functions (no browser needed) that prepare the project for the Sandpack preview.

export type Project = Record<string, string>;

const FALLBACK_DEPENDENCIES: Record<string, string> = {
  react: "^18.3.1",
  "react-dom": "^18.3.1",
  "react-router-dom": "^6.28.0",
  "lucide-react": "^0.460.0",
};

// Read runtime dependencies from the project's package.json. Fall back if it is missing or broken.
export function readDependencies(project: Project): Record<string, string> {
  try {
    const pkg = JSON.parse(project["package.json"] ?? "");
    const deps = pkg?.dependencies;
    if (!deps || typeof deps !== "object" || Array.isArray(deps)) return { ...FALLBACK_DEPENDENCIES };
    const clean: Record<string, string> = {};
    for (const [name, version] of Object.entries(deps)) {
      if (typeof version === "string" && /^[@a-z0-9][\w@./-]*$/i.test(name)) clean[name] = version;
    }
    return Object.keys(clean).length ? clean : { ...FALLBACK_DEPENDENCIES };
  } catch {
    return { ...FALLBACK_DEPENDENCIES };
  }
}

// The preview cannot run PostCSS, so Tailwind comes from its CDN script instead.
// Remove the build-time @tailwind lines so the browser does not see unknown rules.
export function stripTailwindDirectives(css: string): string {
  return css.replace(/^[ \t]*@tailwind\s+\w+\s*;[ \t]*\r?\n?/gm, "");
}

export interface SandpackSetup {
  files: Record<string, string>;
  dependencies: Record<string, string>;
}

// Map our project to what Sandpack's "react-ts" template expects.
export function toSandpackSetup(project: Project): SandpackSetup {
  const files: Record<string, string> = {};
  for (const [path, content] of Object.entries(project)) {
    if (!path.startsWith("src/")) continue; // config files are for the exported build, not the preview
    files[`/${path}`] = path.endsWith(".css") ? stripTailwindDirectives(content) : content;
  }
  // The template starts at /index.tsx. Point it at our real entry file.
  files["/index.tsx"] = 'import "./src/main";\n';
  return { files, dependencies: readDependencies(project) };
}

// Short, stable fingerprint of the project. When it changes, the preview restarts.
export function hashFiles(project: Project): string {
  let h = 0x811c9dc5; // FNV-1a
  for (const path of Object.keys(project).sort()) {
    const s = `${path}\u0000${project[path]}\u0001`;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
  }
  return h.toString(16);
}

// Message sent to the AI when the user clicks "Try to fix". Kept well under the server's 4000 limit.
export function buildFixPrompt(error: string, maxChars = 1500): string {
  const trimmed = error.trim().slice(0, maxChars);
  return `The preview shows this error. Fix it with the smallest possible change:\n\n${trimmed}`;
}
