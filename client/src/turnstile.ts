// turnstile.ts
// Browser side of the Cloudflare Turnstile bot check. Invisible for most visitors.

declare global {
  interface Window {
    turnstile?: {
      render(el: HTMLElement, opts: Record<string, unknown>): string;
      execute(id: string): void;
      reset(id: string): void;
    };
  }
}

const SCRIPT = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
const FAIL = "The bot check failed. Refresh the page and try again.";

let scriptPromise: Promise<void> | null = null;
let widgetId: string | null = null;
let container: HTMLElement | null = null;
let pending: { resolve: (t: string) => void; reject: (e: Error) => void } | null = null;

function loadScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  if (!scriptPromise) {
    scriptPromise = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = SCRIPT;
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => {
        scriptPromise = null; // allow a retry later
        reject(new Error("Could not load the bot check. Check your connection and try again."));
      };
      document.head.appendChild(s);
    });
  }
  return scriptPromise;
}

// Each token works once, so ask for a fresh one before every request.
export async function getTurnstileToken(siteKey: string): Promise<string> {
  await loadScript();
  const ts = window.turnstile;
  if (!ts) throw new Error(FAIL);

  return new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending = null;
      reject(new Error("The bot check took too long. Please try again."));
    }, 30_000);
    pending = {
      resolve: (t) => {
        clearTimeout(timer);
        resolve(t);
      },
      reject: (e) => {
        clearTimeout(timer);
        reject(e);
      },
    };

    if (widgetId === null) {
      container = document.createElement("div");
      container.style.cssText = "position:fixed;bottom:12px;right:12px;z-index:50";
      document.body.appendChild(container);
      widgetId = ts.render(container, {
        sitekey: siteKey,
        execution: "execute",
        appearance: "interaction-only",
        callback: (token: string) => pending?.resolve(token),
        "error-callback": () => pending?.reject(new Error(FAIL)),
        "expired-callback": () => undefined,
        "timeout-callback": () => pending?.reject(new Error(FAIL)),
      });
    } else {
      ts.reset(widgetId);
    }
    ts.execute(widgetId);
  });
}
