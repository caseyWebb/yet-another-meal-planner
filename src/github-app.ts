// GitHub App installation-token minting (D3). Repo access is authenticated with a
// short-lived *installation access token* minted on demand from the App's id +
// private key — never a global PAT and never a stored per-user PAT. An App JWT
// (RS256, signed with the App private key) authenticates the call to
// `POST /app/installations/<id>/access_tokens`, which returns a token valid ~1h
// scoped to that installation's repos.
//
// Tokens are cached in isolate memory keyed by installation id (an installation
// covers the operator org, so the shared corpus and a tenant's repo share one),
// re-minted shortly before expiry. The cache is module-level *but keyed by
// installation*, so it never serves one installation's token to another; the
// per-tenant isolation that matters (repo coords, Kroger tokens) lives upstream.

import { importPKCS8, SignJWT } from "jose";
import { GitHubError, type TokenProvider } from "./github.js";

interface CachedToken {
  token: string;
  /** Epoch ms at which GitHub expires this token. */
  expiresAt: number;
}

const tokenCache = new Map<string, CachedToken>();

const APP_JWT_TTL_S = 540; // 9 min (GitHub caps App JWTs at 10).
const APP_JWT_BACKDATE_S = 30; // tolerate minor clock skew on GitHub's side.
const REFRESH_SKEW_MS = 60_000; // re-mint a minute before expiry.
const USER_AGENT = "grocery-mcp";

async function mintAppJwt(appId: string, privateKeyPem: string): Promise<string> {
  const key = await importPKCS8(privateKeyPem, "RS256");
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({})
    .setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .setIssuer(appId)
    .setIssuedAt(now - APP_JWT_BACKDATE_S)
    .setExpirationTime(now + APP_JWT_TTL_S)
    .sign(key);
}

/** Which installation to mint tokens for: an explicit id (configured), or the data
 *  repo coords from which the id is resolved at runtime when no id is configured. */
export interface InstallationRef {
  /** Configured installation id, if any. When set, used as-is (no resolution). */
  id?: string;
  owner: string;
  repo: string;
}

// Resolved installation ids, keyed by `<owner>/<repo>` (lowercased). The id is
// global per deployment (one App install covers the data repo) and changes only on
// reinstall, so an isolate-lifetime cache is plenty; a cold start re-resolves.
const installationIdCache = new Map<string, string>();

/**
 * Resolve which App installation covers `owner/repo` via
 * `GET /repos/{owner}/{repo}/installation` (App-JWT authenticated). Lets a deploy
 * omit a hand-configured installation id — the Worker already holds the App key.
 */
async function resolveInstallationId(
  appId: string,
  privateKeyPem: string,
  owner: string,
  repo: string,
  fetchImpl: typeof fetch,
): Promise<string> {
  const cacheKey = `${owner}/${repo}`.toLowerCase();
  const cached = installationIdCache.get(cacheKey);
  if (cached) return cached;

  const jwt = await mintAppJwt(appId, privateKeyPem);
  const res = await fetchImpl(`https://api.github.com/repos/${owner}/${repo}/installation`, {
    headers: {
      Authorization: `Bearer ${jwt}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": USER_AGENT,
    },
  });
  if (!res.ok) {
    throw new GitHubError(
      res.status,
      `Failed to resolve App installation for ${owner}/${repo} (${res.status}) — is the App installed on that repo?`,
    );
  }
  const data = (await res.json()) as { id?: number };
  if (!data.id) throw new GitHubError(502, "Malformed installation response (no id)");
  const id = String(data.id);
  installationIdCache.set(cacheKey, id);
  return id;
}

/**
 * An installation-token provider. `appId` and `privateKeyPem` are the App
 * credentials (PKCS#8 PEM). `installation` is either an explicit id or the data
 * repo coords to resolve it from at first use. `fetchImpl` is injectable for tests.
 */
export function createInstallationAuth(
  appId: string,
  privateKeyPem: string,
  installation: InstallationRef,
  fetchImpl: typeof fetch = fetch,
): TokenProvider {
  async function token(): Promise<string> {
    const installationId =
      installation.id ??
      (await resolveInstallationId(appId, privateKeyPem, installation.owner, installation.repo, fetchImpl));
    const cached = tokenCache.get(installationId);
    if (cached && cached.expiresAt - REFRESH_SKEW_MS > Date.now()) {
      return cached.token;
    }

    const jwt = await mintAppJwt(appId, privateKeyPem);
    const res = await fetchImpl(
      `https://api.github.com/app/installations/${installationId}/access_tokens`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${jwt}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": USER_AGENT,
        },
      },
    );

    if (!res.ok) {
      throw new GitHubError(
        res.status,
        `Failed to mint installation token for ${installationId} (${res.status})`,
      );
    }

    const data = (await res.json()) as { token?: string; expires_at?: string };
    if (!data.token || !data.expires_at) {
      throw new GitHubError(502, "Malformed installation-token response");
    }

    const entry: CachedToken = { token: data.token, expiresAt: Date.parse(data.expires_at) };
    tokenCache.set(installationId, entry);
    return entry.token;
  }

  return { token };
}

/** Test helper: drop the module-level installation-token + resolved-id caches. */
export function __resetInstallationTokenCache(): void {
  tokenCache.clear();
  installationIdCache.clear();
}
