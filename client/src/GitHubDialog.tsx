import { useEffect, useState } from "react";
import { GitHubError, PushResult, pushToGitHub, validRepoName } from "./github";
import { Project } from "./history";

interface Props {
  project: Project;
  onClose: () => void;
}

export default function GitHubDialog({ project, onClose }: Props) {
  const [token, setToken] = useState("");
  const [repo, setRepo] = useState("my-app");
  const [isPrivate, setIsPrivate] = useState(false);
  const [publish, setPublish] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PushResult | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !busy && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  const submit = async () => {
    setError(null);
    setResult(null);
    setBusy(true);
    try {
      setResult(await pushToGitHub({ token, repoName: repo, isPrivate, publish: publish && !isPrivate, files: project }));
    } catch (e) {
      setError(e instanceof GitHubError ? e.message : "Something went wrong while talking to GitHub.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4" onClick={() => !busy && onClose()}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Send to GitHub"
        className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-xl bg-white p-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-2 flex items-center justify-between">
          <h2 className="font-semibold">Send to GitHub</h2>
          <button onClick={onClose} disabled={busy} className="rounded px-2 py-1 text-sm hover:bg-slate-100 disabled:opacity-50">
            Close
          </button>
        </div>
        <p className="text-sm text-slate-600">
          Saves your code to your own GitHub account and can publish it as a free website. Your token stays in this
          browser and goes only to GitHub, never to our server.
        </p>

        <label className="mt-3 block text-sm font-medium" htmlFor="gh-token">
          GitHub token
        </label>
        <input
          id="gh-token"
          type="password"
          autoComplete="off"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          className="mt-1 w-full rounded border p-2 text-sm"
          placeholder="ghp_..."
        />
        <p className="mt-1 text-xs text-slate-500">
          <a
            className="underline"
            target="_blank"
            rel="noreferrer"
            href="https://github.com/settings/tokens/new?scopes=repo,workflow&description=App%20Builder"
          >
            Create a token
          </a>{" "}
          with the "repo" and "workflow" permissions. You can delete it right after.
        </p>

        <label className="mt-3 block text-sm font-medium" htmlFor="gh-repo">
          Repository name
        </label>
        <input
          id="gh-repo"
          value={repo}
          onChange={(e) => setRepo(e.target.value.trim())}
          className="mt-1 w-full rounded border p-2 text-sm"
        />
        {!validRepoName(repo) && <p className="mt-1 text-xs text-red-700">Use letters, numbers, dots, dashes, or underscores.</p>}

        <label className="mt-3 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={isPrivate} onChange={(e) => setIsPrivate(e.target.checked)} />
          Make the repository private
        </label>
        <label className="mt-1 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={publish && !isPrivate} disabled={isPrivate} onChange={(e) => setPublish(e.target.checked)} />
          Publish it as a website (GitHub Pages)
        </label>
        {isPrivate && <p className="mt-1 text-xs text-slate-500">Publishing needs a public repository on free GitHub accounts.</p>}

        <button
          onClick={() => void submit()}
          disabled={busy || !token.trim() || !validRepoName(repo)}
          className="mt-4 w-full rounded bg-slate-900 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {busy ? "Sending..." : "Send to GitHub"}
        </button>

        {error && (
          <p role="alert" className="mt-3 rounded bg-red-50 p-2 text-sm text-red-900">
            {error}
          </p>
        )}
        {result && (
          <div role="status" className="mt-3 space-y-1 rounded bg-green-50 p-3 text-sm text-green-900">
            <p>{result.created ? "Repository created and code sent." : "Code sent."}</p>
            <p>
              Code:{" "}
              <a className="underline" target="_blank" rel="noreferrer" href={result.repoUrl}>
                {result.repoUrl}
              </a>
            </p>
            {result.pagesUrl && (
              <p>
                Website:{" "}
                <a className="underline" target="_blank" rel="noreferrer" href={result.pagesUrl}>
                  {result.pagesUrl}
                </a>
              </p>
            )}
            {result.notes.map((n) => (
              <p key={n} className="text-xs">
                {n}
              </p>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
