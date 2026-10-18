// turnstile.ts
// Server-side check of a Cloudflare Turnstile bot-check token.

export type TurnstileVerdict = "ok" | "failed" | "unavailable";

export async function verifyTurnstile(
  secret: string,
  token: string,
  ip?: string,
  fetchImpl: typeof fetch = fetch
): Promise<TurnstileVerdict> {
  try {
    const body = new URLSearchParams({ secret, response: token });
    if (ip) body.set("remoteip", ip);
    const res = await fetchImpl("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body,
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return "unavailable";
    const data: any = await res.json();
    return data?.success === true ? "ok" : "failed";
  } catch {
    // Fail closed: if we cannot verify, we do not let the request through.
    return "unavailable";
  }
}
