// Preview.tsx
// Live preview that runs entirely in the user's browser. Nothing is sent to your server.

import { useEffect, useMemo } from "react";
import { SandpackPreview, SandpackProvider, useSandpack } from "@codesandbox/sandpack-react";
import { Project, hashFiles, toSandpackSetup } from "./preview-files";

// Reports the preview's current build/runtime error (or null when healthy) to the parent.
function ErrorWatcher({ onError }: { onError: (message: string | null) => void }) {
  const { sandpack } = useSandpack();
  const message = sandpack.error?.message ?? null;
  useEffect(() => {
    onError(message);
  }, [message, onError]);
  return null;
}

export interface PreviewProps {
  project: Project;
  // Called with the error text, or null when the preview is healthy.
  // Show a "Try to fix" button when this is non-null.
  onError?: (message: string | null) => void;
}

export default function Preview({ project, onError }: PreviewProps) {
  const setup = useMemo(() => toSandpackSetup(project), [project]);
  // A new key restarts the preview whenever any file changes, which guarantees it
  // always shows the latest code.
  const key = useMemo(() => hashFiles(project), [project]);

  return (
    <SandpackProvider
      key={key}
      template="react-ts"
      files={setup.files}
      customSetup={{ dependencies: setup.dependencies }}
      options={{
        externalResources: ["https://cdn.tailwindcss.com"],
        recompileMode: "delayed",
        recompileDelay: 300,
      }}
    >
      <SandpackPreview
        showNavigator
        showOpenInCodeSandbox={false}
        showRefreshButton
        style={{ height: "100%" }}
      />
      {onError ? <ErrorWatcher onError={onError} /> : null}
    </SandpackProvider>
  );
}
