// template.ts
// The starting project every new session begins with. Must run on its own after export.

import type { FileMap } from "./edit-parser";

export function starterFiles(): FileMap {
  return new Map<string, string>([
    [
      "package.json",
      JSON.stringify(
        {
          name: "my-app",
          private: true,
          version: "0.0.0",
          type: "module",
          scripts: {
            dev: "vite",
            build: "tsc --noEmit && vite build",
            preview: "vite preview",
          },
          dependencies: {
            "lucide-react": "^0.460.0",
            react: "^18.3.1",
            "react-dom": "^18.3.1",
            "react-router-dom": "^6.28.0",
          },
          devDependencies: {
            "@types/react": "^18.3.12",
            "@types/react-dom": "^18.3.1",
            "@vitejs/plugin-react": "^4.3.4",
            autoprefixer: "^10.4.20",
            postcss: "^8.4.49",
            tailwindcss: "^3.4.17",
            typescript: "^5.6.3",
            vite: "^5.4.11",
          },
        },
        null,
        2
      ) + "\n",
    ],
    [
      "index.html",
      `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>My App</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`,
    ],
    [
      "vite.config.ts",
      `import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({ base: "./", plugins: [react()] });
`,
    ],
    [
      "tailwind.config.ts",
      `import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: { extend: {} },
  plugins: [],
} satisfies Config;
`,
    ],
    [
      "postcss.config.js",
      `export default { plugins: { tailwindcss: {}, autoprefixer: {} } };
`,
    ],
    [
      "tsconfig.json",
      JSON.stringify(
        {
          compilerOptions: {
            target: "ES2020",
            lib: ["ES2020", "DOM", "DOM.Iterable"],
            module: "ESNext",
            moduleResolution: "bundler",
            jsx: "react-jsx",
            strict: true,
            noEmit: true,
            skipLibCheck: true,
          },
          include: ["src"],
        },
        null,
        2
      ) + "\n",
    ],
    ["src/vite-env.d.ts", `/// <reference types="vite/client" />\n`],
    [
      "src/main.tsx",
      `import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
`,
    ],
    [
      "src/App.tsx",
      `export default function App() {
  return (
    <main className="min-h-screen flex items-center justify-center bg-slate-50">
      <h1 className="text-3xl font-semibold text-slate-800">Your app starts here</h1>
    </main>
  );
}
`,
    ],
    [
      "src/index.css",
      `@tailwind base;
@tailwind components;
@tailwind utilities;
`,
    ],
  ]);
}
