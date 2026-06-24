// Shared repo-read helpers used by both the read tools and the write tools
// (the write path reads a file's current content before computing its update).

import { GitHubError, type GitHubClient } from "./github.js";
import { ToolError } from "./errors.js";

/** Read a file, mapping a 404 to `notFoundCode` and other failures to upstream. */
export async function readFile(
  gh: GitHubClient,
  path: string,
  notFoundCode: "not_found" | "index_unavailable",
  notFoundMessage: string,
): Promise<string> {
  try {
    return await gh.getFile(path);
  } catch (e) {
    if (e instanceof GitHubError) {
      if (e.status === 404) throw new ToolError(notFoundCode, notFoundMessage);
      throw new ToolError("upstream_unavailable", e.message);
    }
    throw e;
  }
}

/** Read a file that may be absent; map 404 to null, other failures to upstream. */
export async function readOptional(gh: GitHubClient, path: string): Promise<string | null> {
  try {
    return await gh.getFile(path);
  } catch (e) {
    if (e instanceof GitHubError) {
      if (e.status === 404) return null;
      throw new ToolError("upstream_unavailable", e.message);
    }
    throw e;
  }
}
