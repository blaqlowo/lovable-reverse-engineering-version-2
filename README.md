# App Builder

An AI app builder. Users describe an app, the AI builds it while the answer streams in, a live preview
updates in the browser, and users can edit the code, undo, send it to GitHub, publish it, or export it as a ZIP.

**Design rules:** no accounts, no database, no stored user data. The project, its version history, and the
chat live in the user's own browser. The server is stateless and forgets every request.

## What is included

- Start screen, streaming answers, Stop button, progress messages
- Live preview with phone, tablet, and desktop sizes
- Code view with editing, undo, and version history (last 30 versions)
- Image attachments the AI can see (and that can be added to the app)
- Send to GitHub, and publish as a free website with GitHub Pages
- Export as a ZIP that builds on its own
- Drafts saved in the user's browser
- Bot check (Cloudflare Turnstile), rate limits, a daily cap, and cancellation when the visitor leaves

## Layout

```
api/index.ts      Vercel entry point (the whole API runs as one serverless function)
server/           the Express app: edit parser, prompt, streaming AI loop, limits, bot check
client/           the React website (Vite): all screens, preview, history, drafts, GitHub, export
vercel.json       build and routing settings for Vercel
.github/          CI: type check, tests, and build on every push
Dockerfile        optional: run everything in one container instead of Vercel
```

## Run it on your computer

You need **Node 22** (see `.nvmrc`).

```bash
npm run install:all          # installs the root and the client
cp .env.example .env         # then put your Anthropic API key in .env

npm run dev:server           # terminal 1: the API on http://localhost:3000
npm run dev:client           # terminal 2: the website on http://localhost:5173
```

Open http://localhost:5173. Never commit `.env`; `.gitignore` already excludes it.

Other commands: `npm run typecheck`, `npm test`, `npm run build`.

## Put it on GitHub

```bash
git init
git add .
git commit -m "First commit"
git branch -M main
git remote add origin https://github.com/YOUR-NAME/YOUR-REPO.git
git push -u origin main
```

Check that `.env` is NOT in the commit (`git status` should not list it). The included GitHub Actions
workflow then type-checks, tests, and builds on every push.

## Deploy on Vercel

1. In Vercel choose **Add New, then Project**, and import your GitHub repository.
2. Leave **Root Directory** empty. Everything else (install command, build command, output folder, API
   routing) comes from `vercel.json`.
3. Open **Environment Variables** and add:

   | Name | Value | Notes |
   | --- | --- | --- |
   | `ANTHROPIC_API_KEY` | your key | required |
   | `TURNSTILE_SECRET` | Turnstile secret key | strongly recommended |
   | `VITE_TURNSTILE_SITE_KEY` | Turnstile site key (public) | needed at build time |
   | `VITE_APP_NAME` | your product name | optional, needed at build time |
   | `MODEL` | a model name | optional |
   | `DAILY_LIMIT`, `PER_IP_PER_MINUTE` | numbers | optional, see "Limits" below |

4. Click **Deploy**.
5. Check it worked: open your site, and also open `/api/template` on it. You should see JSON, not an error.

`VITE_` variables are baked in when the site is built, so after changing one, redeploy.
Variables set only for "Production" are not used by preview deployments. Leave Preview unchecked if you
do not want preview branches to spend your API credits.

## Limits on Vercel you should know about

- **Time per request: 60 seconds** (`maxDuration` in `vercel.json`). A long AI answer that goes past it is cut
  off and the user sees an error. New Vercel projects usually have Fluid Compute, which allows up to 300
  seconds on Hobby: if yours does, raise the number in `vercel.json`. If a deploy fails with a message that
  `maxDuration` is too high for your plan, lower it.
- **Request size: 4.5 MB.** The app refuses projects larger than that on its own, with a clear message.
- **The rate limits and the daily cap are best effort.** They live in memory, and Vercel runs many
  separate copies of the function, so each copy counts on its own and a restart resets it. Treat
  `DAILY_LIMIT` and `PER_IP_PER_MINUTE` as a speed bump, not a guarantee.
- **Your real protections are:** the Turnstile bot check, a hard monthly spending limit on your
  Anthropic API key, and (on Vercel) a rate-limit rule in the project's Firewall settings.
- Each chat request can use up to 4 AI calls when the AI has to retry a failed edit.

## Bot check (Cloudflare Turnstile)

1. In the Cloudflare dashboard create a free Turnstile widget and add your site's domain.
2. Put the **secret key** in `TURNSTILE_SECRET` and the **site key** in `VITE_TURNSTILE_SITE_KEY`.
3. Redeploy. Without both keys the bot check is off, and the server logs a warning.

## Before you show this to the public

1. Set a hard monthly spending limit on your Anthropic API key.
2. Turn on the bot check.
3. Write a privacy page. It must say that messages, project files, and attached images are sent to an AI
   provider to build each change, and that the preview loads code from third parties (CodeSandbox,
   Tailwind's CDN, npm package hosts) in the visitor's browser.
4. Choose your own name, logo, and look. Do not copy another product's branding.
5. Run the first-time checks below with your real API key.

## First-time checks (things automated tests could not cover)

- The preview renders the starter page with Tailwind styling, and the phone and tablet sizes work.
- Ask for a change: the answer streams in, the preview updates, the chat lists the changed files.
- Break something on purpose: the red error bar appears with a "Try to fix" button.
- Attach an image and ask the AI to use it on the page.
- Send to GitHub with a real token and publishing on. Check the Actions tab, then open the website link.
- Export the ZIP, unzip it, run `npm install` and `npm run dev`. It should match the preview.
- With the bot check on: a normal request works, and a request without a token is refused.
- Ask for something that takes a long time. If it times out on Vercel, raise `maxDuration`.

## Troubleshooting

| What you see | Likely cause |
| --- | --- |
| "The server is not set up yet" | `ANTHROPIC_API_KEY` is missing. Add it in Vercel and redeploy. |
| "Bot check missing" or "failed" | Only one of the two Turnstile keys is set, or the domain is not added in Cloudflare. |
| Answers stop part way, "connection closed" | The request hit the time limit. Raise `maxDuration`, or ask for smaller changes. |
| "Your project is too large to send" | Over 4.5 MB. Remove files or images. |
| Preview stays blank | The visitor's network blocks CodeSandbox or the npm CDN, or the generated code has an error. |
| The site works but `/api/...` returns the web page | The `rewrites` entry in `vercel.json` was changed or removed. |

## GitHub and publishing (for your visitors)

A visitor pastes a GitHub token (a classic token with the `repo` and `workflow` permissions). It stays in
their browser and goes only to api.github.com, never to your server. The app creates the repository, pushes
one commit, and, if publishing is on, adds a workflow that builds the app and publishes it with GitHub
Pages. Free GitHub accounts need a public repository for Pages. Existing files in a repository are never
deleted.

## Docker (optional)

`Dockerfile` builds one container that serves the API and the website together. It was not tested in the
environment this project was prepared in.

```bash
docker build -t app-builder --build-arg VITE_TURNSTILE_SITE_KEY=your_site_key .
docker run -p 3000:3000 -e ANTHROPIC_API_KEY=... -e TURNSTILE_SECRET=... app-builder
```

## Known limits

- The code editor is plain text, without syntax colors.
- Custom settings in `tailwind.config.ts` apply after export, not in the preview.
- The preview restarts on each change.
- Generated apps have no backend. Users connect their own after exporting.
- Browsers keep about 5 MB per site, so very large projects may not fit in a saved draft. The app warns
  the user when a draft cannot be saved.
- Not verified in a real environment: the live preview rendering, the real Turnstile widget, real
  GitHub, and the Docker build. Everything else is covered by automated tests (see `npm test`).
