// Tests for the GitHub client's createIssue (the report_bug tool's write path).
import { describe, it, expect, vi, afterEach } from "vitest";
import { createGitHubClient } from "../src/github.js";

const auth = { token: async () => "tok" };
const coords = { owner: "caseyWebb", repo: "groceries-agent-data", ref: "main" };

afterEach(() => vi.unstubAllGlobals());

describe("createIssue", () => {
  it("POSTs to the repo issues endpoint and returns the url + number", async () => {
    let captured: { url: string; init: RequestInit } | null = null;
    vi.stubGlobal("fetch", (async (url: string, init: RequestInit) => {
      captured = { url, init };
      return new Response(JSON.stringify({ html_url: "https://github.com/o/r/issues/7", number: 7 }), {
        status: 201,
      });
    }) as unknown as typeof fetch);

    const gh = createGitHubClient(coords, auth);
    const res = await gh.createIssue("Title", "Body", ["agent-reported"]);

    expect(res).toEqual({ url: "https://github.com/o/r/issues/7", number: 7 });
    expect(captured!.url).toBe("https://api.github.com/repos/caseyWebb/groceries-agent-data/issues");
    expect(captured!.init.method).toBe("POST");
    expect(JSON.parse(captured!.init.body as string)).toEqual({
      title: "Title",
      body: "Body",
      labels: ["agent-reported"],
    });
  });

  it("surfaces a 403 (no Issues:write) as GitHubError(403) for the tool to map", async () => {
    vi.stubGlobal(
      "fetch",
      (async () =>
        new Response("Forbidden", { status: 403, headers: { "x-ratelimit-remaining": "4999" } })) as unknown as typeof fetch,
    );
    const gh = createGitHubClient(coords, auth);
    await expect(gh.createIssue("t", "b")).rejects.toMatchObject({ status: 403 });
  });

  it("rejects a malformed issue response", async () => {
    vi.stubGlobal(
      "fetch",
      (async () => new Response(JSON.stringify({ nope: true }), { status: 201 })) as unknown as typeof fetch,
    );
    const gh = createGitHubClient(coords, auth);
    await expect(gh.createIssue("t", "b")).rejects.toMatchObject({ status: 502 });
  });
});
