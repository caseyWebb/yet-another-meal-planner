// Authenticated GitHub data-access client. The single read/write path for repo
// data, bound to ONE repository (RepoCoords) and authenticated per request with a
// short-lived GitHub App installation token (D3) — never a global PAT. Reads files
// at the repo's ref via the Contents API with the raw media type (avoids base64
// round-trips). Retries transient failures and rate limits with backoff, and
// surfaces exhaustion as a typed error the tool boundary maps to a structured
// result. Because a client is bound to one repo, a caller targets the shared
// corpus vs. a tenant repo purely by which client it uses.

import type { RepoCoords } from "./tenant.js";

/** A provider of a currently-valid GitHub bearer token (installation token). */
export interface TokenProvider {
  token(): Promise<string>;
}

/** Thrown by the client; callers map `status` to a structured error code. */
export class GitHubError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "GitHubError";
    this.status = status;
  }
}

const MAX_ATTEMPTS = 3;
const USER_AGENT = "grocery-mcp";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Retry on 5xx, 429, and rate-limited 403; otherwise fail fast. */
function isTransient(status: number, remaining: string | null): boolean {
  if (status >= 500) return true;
  if (status === 429) return true;
  if (status === 403 && remaining === "0") return true;
  return false;
}

/** One file's full new content, addressed by repo-relative path. */
export interface TreeFile {
  path: string;
  content: string;
}

export interface GitHubClient {
  /** Fetch a repo file's raw text. Throws GitHubError(404) when absent. */
  getFile(path: string): Promise<string>;
  /** Resolve `heads/<ref>` to the commit sha it points at. */
  getRef(): Promise<string>;
  /** The tree sha of a commit. */
  getCommitTree(commitSha: string): Promise<string>;
  /** Create a tree from `base_tree` plus inline file contents; returns the new tree sha. */
  createTree(baseTree: string, files: TreeFile[]): Promise<string>;
  /** Create a commit with one parent; returns the new commit sha. */
  createCommit(message: string, tree: string, parent: string): Promise<string>;
  /**
   * Fast-forward `heads/<ref>` to `commitSha`. Throws GitHubError(422) when the
   * update is not a fast-forward (the ref moved under us) — the commit engine's
   * retry signal.
   */
  updateRef(commitSha: string): Promise<void>;
  /**
   * Open an issue on the repo (repo-level — not under any path prefix). Returns the
   * issue's html_url and number. A non-transient 403 (the App lacks `Issues: write`)
   * surfaces as GitHubError(403) for the caller to map to `insufficient_permission`.
   */
  createIssue(title: string, body: string, labels?: string[]): Promise<{ url: string; number: number }>;
}

export function createGitHubClient(coords: RepoCoords, auth: TokenProvider): GitHubClient {
  const contentsBase = `https://api.github.com/repos/${coords.owner}/${coords.repo}/contents`;
  const gitBase = `https://api.github.com/repos/${coords.owner}/${coords.repo}/git`;
  const branch = coords.ref;

  async function authHeaders(extra: Record<string, string> = {}): Promise<Record<string, string>> {
    return {
      Authorization: `Bearer ${await auth.token()}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": USER_AGENT,
      ...extra,
    };
  }

  async function getFile(path: string): Promise<string> {
    const url = `${contentsBase}/${path}?ref=${encodeURIComponent(branch)}`;
    let lastStatus = 0;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const res = await fetch(url, {
        headers: await authHeaders({ Accept: "application/vnd.github.raw" }),
      });

      if (res.ok) return res.text();

      lastStatus = res.status;
      if (res.status === 404) {
        throw new GitHubError(404, `Not found: ${path}`);
      }

      const remaining = res.headers.get("x-ratelimit-remaining");
      if (isTransient(res.status, remaining) && attempt < MAX_ATTEMPTS) {
        await sleep(200 * attempt);
        continue;
      }
      throw new GitHubError(res.status, `GitHub request failed (${res.status}) for ${path}`);
    }

    throw new GitHubError(lastStatus, `GitHub request exhausted retries for ${path}`);
  }

  /**
   * Authenticated JSON request to the Git Data API with the same transient-retry
   * policy as getFile. `expectStatuses` lists non-2xx codes the caller handles
   * itself (e.g. 422 on updateRef) — these are thrown immediately, not retried.
   */
  async function requestJson(
    method: string,
    url: string,
    body: unknown | null,
    expectStatuses: number[] = [],
  ): Promise<unknown> {
    let lastStatus = 0;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const res = await fetch(url, {
        method,
        headers: await authHeaders({
          Accept: "application/vnd.github+json",
          ...(body != null ? { "Content-Type": "application/json" } : {}),
        }),
        body: body != null ? JSON.stringify(body) : undefined,
      });

      if (res.ok) return res.status === 204 ? null : res.json();

      lastStatus = res.status;
      if (expectStatuses.includes(res.status)) {
        throw new GitHubError(res.status, `GitHub ${method} ${url} returned ${res.status}`);
      }

      const remaining = res.headers.get("x-ratelimit-remaining");
      if (isTransient(res.status, remaining) && attempt < MAX_ATTEMPTS) {
        await sleep(200 * attempt);
        continue;
      }
      throw new GitHubError(res.status, `GitHub ${method} request failed (${res.status})`);
    }
    throw new GitHubError(lastStatus, `GitHub ${method} request exhausted retries`);
  }

  async function getRef(): Promise<string> {
    const data = (await requestJson("GET", `${gitBase}/ref/heads/${branch}`, null)) as {
      object?: { sha?: string };
    };
    const sha = data.object?.sha;
    if (!sha) throw new GitHubError(502, `Malformed ref response for heads/${branch}`);
    return sha;
  }

  async function getCommitTree(commitSha: string): Promise<string> {
    const data = (await requestJson("GET", `${gitBase}/commits/${commitSha}`, null)) as {
      tree?: { sha?: string };
    };
    const sha = data.tree?.sha;
    if (!sha) throw new GitHubError(502, `Malformed commit response for ${commitSha}`);
    return sha;
  }

  async function createTree(baseTree: string, files: TreeFile[]): Promise<string> {
    const data = (await requestJson("POST", `${gitBase}/trees`, {
      base_tree: baseTree,
      tree: files.map((f) => ({ path: f.path, mode: "100644", type: "blob", content: f.content })),
    })) as { sha?: string };
    if (!data.sha) throw new GitHubError(502, "Malformed create-tree response");
    return data.sha;
  }

  async function createCommit(message: string, tree: string, parent: string): Promise<string> {
    const data = (await requestJson("POST", `${gitBase}/commits`, {
      message,
      tree,
      parents: [parent],
    })) as { sha?: string };
    if (!data.sha) throw new GitHubError(502, "Malformed create-commit response");
    return data.sha;
  }

  async function updateRef(commitSha: string): Promise<void> {
    // force:false → GitHub returns 422 when the update is not a fast-forward.
    await requestJson("PATCH", `${gitBase}/refs/heads/${branch}`, { sha: commitSha, force: false }, [
      422,
    ]);
  }

  async function createIssue(
    title: string,
    body: string,
    labels: string[] = [],
  ): Promise<{ url: string; number: number }> {
    const data = (await requestJson("POST", `https://api.github.com/repos/${coords.owner}/${coords.repo}/issues`, {
      title,
      body,
      labels,
    })) as { html_url?: string; number?: number };
    if (!data.html_url || typeof data.number !== "number") {
      throw new GitHubError(502, "Malformed create-issue response");
    }
    return { url: data.html_url, number: data.number };
  }

  return { getFile, getRef, getCommitTree, createTree, createCommit, updateRef, createIssue };
}

/**
 * Wrap a client so every repo-relative path is resolved under `prefix` (e.g.
 * "users/alice"). Reads (`getFile`) and tree writes (`createTree` file paths) are
 * prefixed; ref/commit/tree-sha operations target the same repo unchanged. This is
 * how a tenant's personal files (`users/<username>/pantry.toml`) are addressed
 * within the single shared data repo without a second client or repo. An empty
 * prefix returns the client unchanged (the pre-migration root layout).
 */
export function prefixedClient(gh: GitHubClient, prefix: string): GitHubClient {
  if (!prefix) return gh;
  const at = (p: string): string => `${prefix}/${p}`;
  return {
    getFile: (path) => gh.getFile(at(path)),
    getRef: gh.getRef,
    getCommitTree: gh.getCommitTree,
    createTree: (baseTree, files) =>
      gh.createTree(baseTree, files.map((f) => ({ ...f, path: at(f.path) }))),
    createCommit: gh.createCommit,
    updateRef: gh.updateRef,
    createIssue: gh.createIssue, // repo-level; path prefix is irrelevant
  };
}
