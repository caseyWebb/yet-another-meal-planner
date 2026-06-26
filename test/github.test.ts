import { describe, it, expect, vi, afterEach } from "vitest";
import { createGitHubClient } from "../src/github.js";

afterEach(() => vi.unstubAllGlobals());

describe("listDir", () => {
  const auth = { token: async () => "tok" };
  const coords = { owner: "o", repo: "r", ref: "main" };

  it("returns the file/dir entries from a Contents API listing, dropping unknown types", async () => {
    let captured = "";
    vi.stubGlobal("fetch", (async (url: string) => {
      captured = url;
      return new Response(
        JSON.stringify([
          { name: "tender-herbs.md", type: "file" },
          { name: "sub", type: "dir" },
          { name: "weird", type: "symlink" },
        ]),
        { status: 200 },
      );
    }) as unknown as typeof fetch);

    const gh = createGitHubClient(coords, auth);
    expect(await gh.listDir("storage_guidance")).toEqual([
      { name: "tender-herbs.md", type: "file" },
      { name: "sub", type: "dir" },
    ]);
    expect(captured).toBe(
      "https://api.github.com/repos/o/r/contents/storage_guidance?ref=main",
    );
  });

  it("throws GitHubError(404) when the directory is absent", async () => {
    vi.stubGlobal(
      "fetch",
      (async () => new Response("Not Found", { status: 404 })) as unknown as typeof fetch,
    );
    const gh = createGitHubClient(coords, auth);
    await expect(gh.listDir("nope")).rejects.toMatchObject({ status: 404 });
  });
});

describe("getPagesUrl", () => {
  const auth = { token: async () => "tok" };
  const coords = { owner: "o", repo: "r", ref: "main" };

  it("returns the published html_url when Pages is enabled", async () => {
    let captured = "";
    vi.stubGlobal("fetch", (async (url: string) => {
      captured = url;
      return new Response(JSON.stringify({ html_url: "https://recipes.example.org", status: "built" }), {
        status: 200,
      });
    }) as unknown as typeof fetch);
    const gh = createGitHubClient(coords, auth);
    expect(await gh.getPagesUrl()).toEqual({ url: "https://recipes.example.org", enabled: true });
    expect(captured).toBe("https://api.github.com/repos/o/r/pages");
  });

  it("reports not enabled when Pages returns 404", async () => {
    vi.stubGlobal(
      "fetch",
      (async () => new Response("Not Found", { status: 404 })) as unknown as typeof fetch,
    );
    const gh = createGitHubClient(coords, auth);
    expect(await gh.getPagesUrl()).toEqual({ url: null, enabled: false });
  });

  it("surfaces a 403 (App lacks Pages: read) as GitHubError", async () => {
    vi.stubGlobal(
      "fetch",
      (async () =>
        new Response("Forbidden", {
          status: 403,
          headers: { "x-ratelimit-remaining": "100" },
        })) as unknown as typeof fetch,
    );
    const gh = createGitHubClient(coords, auth);
    await expect(gh.getPagesUrl()).rejects.toMatchObject({ status: 403 });
  });
});
