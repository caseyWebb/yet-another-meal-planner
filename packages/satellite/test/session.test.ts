import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  cookieHeaderFor,
  importSession,
  loadSession,
  looksLikeAuthWall,
  saveSession,
  sessionPath,
  type StorageState,
} from "../src/session.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "satellite-session-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const state = (): StorageState => ({
  cookies: [
    { name: "sid", value: "abc", domain: ".paid.example", path: "/", secure: true },
    { name: "pref", value: "dark", domain: "paid.example", path: "/recipes", secure: false },
    { name: "other", value: "no", domain: "other.example", path: "/", secure: false },
  ],
  origins: [],
});

describe("save/load session round-trip", () => {
  it("persists to <configDir>/sessions/<id>.json and reloads", () => {
    saveSession(dir, "paid", state());
    expect(sessionPath(dir, "paid")).toBe(join(dir, "sessions", "paid.json"));
    const loaded = loadSession(dir, "paid");
    expect(loaded?.cookies).toHaveLength(3);
  });

  it("returns null when no session captured", () => {
    expect(loadSession(dir, "missing")).toBeNull();
  });

  it("returns null for a corrupt session file (treated as auth_expired upstream)", () => {
    saveSession(dir, "corrupt", state());
    writeFileSync(sessionPath(dir, "corrupt"), "{ not json", "utf8");
    expect(loadSession(dir, "corrupt")).toBeNull();
  });
});

describe("importSession", () => {
  it("copies a storageState JSON into the session store", () => {
    const src = join(dir, "exported.json");
    writeFileSync(src, JSON.stringify(state()), "utf8");
    const imported = importSession(dir, "paid", src);
    expect(imported.cookies).toHaveLength(3);
    expect(loadSession(dir, "paid")?.cookies).toHaveLength(3);
  });

  it("throws on a file that is not a storageState", () => {
    const src = join(dir, "bad.json");
    writeFileSync(src, JSON.stringify({ nope: true }), "utf8");
    expect(() => importSession(dir, "paid", src)).toThrow(/not a Playwright storageState/);
  });
});

describe("cookieHeaderFor", () => {
  it("includes only cookies whose domain + path + scheme match the URL", () => {
    const header = cookieHeaderFor(state(), "https://paid.example/recipes/one");
    // sid (.paid.example, secure, path /) and pref (path /recipes) match on https; other.example does not.
    expect(header).toContain("sid=abc");
    expect(header).toContain("pref=dark");
    expect(header).not.toContain("other=no");
  });

  it("omits a secure cookie over http", () => {
    const header = cookieHeaderFor(state(), "http://paid.example/recipes/one");
    expect(header).not.toContain("sid=abc"); // secure → https only
    expect(header).toContain("pref=dark");
  });

  it("omits a path-scoped cookie for a non-matching path", () => {
    const header = cookieHeaderFor(state(), "https://paid.example/about");
    expect(header).toContain("sid=abc"); // path /
    expect(header).not.toContain("pref=dark"); // path /recipes
  });

  it("returns an empty string when nothing matches", () => {
    expect(cookieHeaderFor(state(), "https://elsewhere.example/x")).toBe("");
  });
});

describe("looksLikeAuthWall", () => {
  it("is true when the final URL is a login/subscribe/account route", () => {
    expect(looksLikeAuthWall("https://paid.example/subscribe", "<html></html>")).toBe(true);
    expect(looksLikeAuthWall("https://paid.example/account/settings", "<html></html>")).toBe(true);
    expect(looksLikeAuthWall("https://paid.example/login?next=/r/1", "<html></html>")).toBe(true);
  });

  it("is true for a paywall marker with no recipe JSON-LD", () => {
    expect(
      looksLikeAuthWall("https://paid.example/recipes/one", "<html><body>Please subscribe to read</body></html>"),
    ).toBe(true);
  });

  it("is false for a real recipe page even if it mentions subscribe in a footer", () => {
    const html = `<html><head>
      <script type="application/ld+json">{"@type":"Recipe","name":"X"}</script>
      </head><body><footer>subscribe to our newsletter</footer></body></html>`;
    expect(looksLikeAuthWall("https://paid.example/recipes/one", html)).toBe(false);
  });
});
