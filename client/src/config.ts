// config.ts
// Build-time settings. Put them in client/.env (see .env.example) or pass them to the build.

export const APP_NAME: string = import.meta.env.VITE_APP_NAME || "App Builder";
export const TURNSTILE_SITE_KEY: string = import.meta.env.VITE_TURNSTILE_SITE_KEY || "";
