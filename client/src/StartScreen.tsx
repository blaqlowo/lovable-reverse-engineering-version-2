import { KeyboardEvent, useState } from "react";

const EXAMPLES = [
  "A to-do list with categories and a dark mode toggle",
  "A landing page for a small bakery with a menu section",
  "A tip calculator for restaurant bills",
  "A personal portfolio with a projects section and contact form",
];

interface Props {
  appName: string;
  ready: boolean;
  error: string | null;
  onRetry: () => void;
  onSubmit: (text: string) => void;
}

export default function StartScreen({ appName, ready, error, onRetry, onSubmit }: Props) {
  const [text, setText] = useState("");
  const go = () => {
    if (ready && text.trim()) onSubmit(text);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      go();
    }
  };

  return (
    <div className="flex h-full flex-col items-center justify-center bg-gradient-to-b from-slate-50 to-slate-200 px-4">
      <h1 className="text-3xl font-semibold text-slate-900 sm:text-4xl">{appName}</h1>
      <p className="mt-2 text-center text-slate-600">Describe an app. Watch it get built. Export the code.</p>

      <div className="mt-8 w-full max-w-2xl rounded-2xl border bg-white p-3 shadow-lg">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          maxLength={4000}
          rows={4}
          autoFocus
          aria-label="Describe your app"
          placeholder="What do you want to build?"
          className="w-full resize-none rounded p-2 text-base outline-none"
        />
        <div className="flex items-center justify-between">
          <span className="text-xs text-slate-400">Enter to build</span>
          <button
            onClick={go}
            disabled={!ready || !text.trim()}
            className="rounded-lg bg-slate-900 px-5 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-40"
          >
            {ready ? "Build it" : "Loading..."}
          </button>
        </div>
      </div>

      {error && (
        <div role="alert" className="mt-4 rounded bg-red-50 px-4 py-2 text-sm text-red-900">
          {error}{" "}
          <button className="underline" onClick={onRetry}>
            Try again
          </button>
        </div>
      )}

      <div className="mt-6 flex max-w-2xl flex-wrap justify-center gap-2">
        {EXAMPLES.map((ex) => (
          <button
            key={ex}
            onClick={() => setText(ex)}
            className="rounded-full border bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100"
          >
            {ex}
          </button>
        ))}
      </div>

      <p className="mt-10 max-w-md text-center text-xs text-slate-500">
        Your project stays in this browser. Your messages and files are sent to an AI service to build each change and
        are not stored by us.
      </p>
    </div>
  );
}
