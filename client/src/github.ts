// github.ts
// Push the project to the user's own GitHub, and optionally publish it with GitHub Pages.
// Runs in the browser and talks straight to api.github.com. The token never touches your server.

import { README } from "./client-helpers";

export type Project = Record<string, string>;

const API = "https://api.github.com";
export const WORKFLOW_PATH = ".github/workflows/deploy.yml";

// Builds the app on GitHub and publishes it with GitHub Pages on every push to main.
export const DEPLOY_WORKFLOW = `name: Deploy to GitHub Pages

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: true

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm install
      - run: npm run build
      - uses: actions/upload-pages-artifact@v3
        with:
          path: dist

  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: \${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
`;

export class GitHubError extends Error {}

export function validRepoName(name: string): boolean {
  return /^[A-Za-z0-9._-]{1,100}$/.test(name) && name !== "." && name !== ".." && !name.endsWith(".git");
}

export interface PushOptions {
  token: string;
  repoName: string;
  isPrivate: boolean;
  publish: boolean; // set up GitHub Pages deployment
  files: Project;
  commitMessage?: string;
  fetchImpl?: typeof fetch; // for tests
  sleep?: (ms: number) => Promise<void>; // for tests
}

export interface PushResult {
  repoUrl: string;
  pagesUrl?: string;
  commitSha: string;
  created: boolean;
  notes: string[];
}

type Reply = { status: number; data: any };

function explain(status: number, data: any, what: string): string {
  const detail = typeof data?.message === "string" ? data.message : "";
  if (status === 401) return "GitHub did not accept that token. Check that it is correct and has not expired.";
  if (status === 403)
    return `GitHub refused this${detail ? ` (${detail})` : ""}. Check that the token has the "repo" and "workflow" permissions, or wait a minute if you hit a rate limit.`;
  if (status === 404) return `GitHub could not find ${what}. If the repository is private, the token needs the "repo" permission.`;
  if (status === 422) return `GitHub rejected the request${detail ? `: ${detail}` : "."}`;
  return `GitHub returned an error (${status}) while ${what}.`;
}

export async function pushToGitHub(o: PushOptions): Promise<PushResult> {
  const doFetch = o.fetchImpl ?? fetch;
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const notes: string[] = [];

  if (!o.token.trim()) throw new GitHubError("Paste a GitHub token first.");
  if (!validRepoName(o.repoName)) throw new GitHubError("Repository names can only use letters, numbers, dots, dashes, and underscores.");

  async function call(method: string, path: string, body?: unknown): Promise<Reply> {
    let res: Response;
    try {
      res = await doFetch(API + path, {
        method,
        headers: {
          Authorization: `Bearer ${o.token.trim()}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new GitHubError("Could not reach GitHub. Check your internet connection.");
    }
    let data: any = null;
    try {
      data = await res.json();
    } catch {
      // some replies (204) have no body
    }
    return { status: res.status, data };
  }
  const must = (r: Reply, ok: number[], what: string): any => {
    if (!ok.includes(r.status)) throw new GitHubError(explain(r.status, r.data, what));
    return r.data;
  };

  // 1. Who is this?
  const login: string = must(await call("GET", "/user"), [200], "your account").login;
  const repoPath = `/repos/${encodeURIComponent(login)}/${encodeURIComponent(o.repoName)}`;

  // 2. Use the repository if it exists, otherwise create it.
  let repo: any;
  let created = false;
  const existing = await call("GET", repoPath);
  if (existing.status === 200) {
    repo = existing.data;
    notes.push("Updated an existing repository. Files already in it that are not in your project were left alone.");
  } else if (existing.status === 404) {
    repo = must(
      await call("POST", "/user/repos", {
        name: o.repoName,
        private: o.isPrivate,
        auto_init: true,
        description: "Built with an AI app builder",
      }),
      [201],
      "creating the repository"
    );
    created = true;
  } else {
    must(existing, [200], "the repository");
  }
  const branch: string = repo.default_branch || "main";
  const branchPath = branch.split("/").map(encodeURIComponent).join("/");

  // 3. Turn on publishing BEFORE pushing the workflow, so the first run can succeed.
  let publishing = false;
  let pagesUrl: string | undefined;
  if (o.publish) {
    if (repo.private) {
      notes.push("Publishing was skipped: GitHub Pages needs a public repository on free accounts.");
    } else {
      let pages = await call("POST", `${repoPath}/pages`, { build_type: "workflow" });
      if (pages.status === 409) {
        const put = await call("PUT", `${repoPath}/pages`, { build_type: "workflow" });
        if (put.status === 204 || put.status === 200) {
          pages = { status: 201, data: null };
          notes.push("Publishing settings were switched to GitHub Actions.");
        } else pages = put;
      }
      if (pages.status === 201 || pages.status === 200) {
        publishing = true;
        const isUserSite = o.repoName.toLowerCase() === `${login.toLowerCase()}.github.io`;
        pagesUrl =
          (typeof pages.data?.html_url === "string" && pages.data.html_url) ||
          `https://${login}.github.io/${isUserSite ? "" : o.repoName + "/"}`;
      } else {
        notes.push(`Publishing could not be turned on: ${explain(pages.status, pages.data, "enabling GitHub Pages")}`);
      }
    }
  }

  // 4. Find the latest commit (a brand-new repository can take a moment to be ready).
  let headSha = "";
  for (let i = 0; i < 6 && !headSha; i++) {
    const ref = await call("GET", `${repoPath}/git/ref/heads/${branchPath}`);
    if (ref.status === 200) headSha = ref.data?.object?.sha ?? "";
    else if (ref.status === 404 || ref.status === 409) await sleep(1000);
    else must(ref, [200], "the branch");
  }
  if (!headSha) throw new GitHubError("GitHub is still preparing the new repository. Wait a moment and try again.");
  const treeSha: string = must(await call("GET", `${repoPath}/git/commits/${headSha}`), [200], "the latest commit").tree.sha;

  // 5. One commit with every file.
  const all: Project = { ...o.files };
  if (created && !("README.md" in all)) all["README.md"] = README;
  if (publishing) all[WORKFLOW_PATH] = DEPLOY_WORKFLOW;
  const tree = Object.entries(all).map(([path, content]) => ({ path, mode: "100644", type: "blob", content }));

  const newTree = must(await call("POST", `${repoPath}/git/trees`, { base_tree: treeSha, tree }), [201], "saving your files");
  const commit = must(
    await call("POST", `${repoPath}/git/commits`, {
      message: o.commitMessage || "Update from App Builder",
      tree: newTree.sha,
      parents: [headSha],
    }),
    [201],
    "creating the commit"
  );
  must(await call("PATCH", `${repoPath}/git/refs/heads/${branchPath}`, { sha: commit.sha }), [200], "updating the branch");

  if (publishing) notes.push("The first publish takes 1 to 2 minutes. If the page is not up after that, check the Actions tab in the repository.");
  return { repoUrl: repo.html_url, pagesUrl, commitSha: commit.sha, created, notes };
}
