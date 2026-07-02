import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Cursor, canonicalizeUrl, cursorPath } from "../src/cursor.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "satellite-cursor-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("canonicalizeUrl", () => {
  it("strips query, fragment, and trailing slash", () => {
    expect(canonicalizeUrl("https://p.example/r/1/?utm=x#frag")).toBe("https://p.example/r/1");
    expect(canonicalizeUrl("https://p.example/r/1")).toBe("https://p.example/r/1");
  });
});

describe("Cursor", () => {
  it("has/add tracks membership using canonical form", () => {
    const c = new Cursor(dir);
    expect(c.has("https://p.example/r/1")).toBe(false);
    c.add("https://p.example/r/1?utm=y");
    // A tracker-wrapped variant of the same URL is considered already seen.
    expect(c.has("https://p.example/r/1")).toBe(true);
    expect(c.has("https://p.example/r/1/#top")).toBe(true);
  });

  it("persists and reloads across instances", () => {
    const c = new Cursor(dir);
    c.add("https://p.example/r/1");
    c.add("https://p.example/r/2");
    c.save();

    const reloaded = Cursor.load(dir);
    expect(reloaded.has("https://p.example/r/1")).toBe(true);
    expect(reloaded.has("https://p.example/r/2")).toBe(true);
    expect(reloaded.size).toBe(2);
  });

  it("returns an empty cursor when no file exists (harmless lost cursor)", () => {
    const c = Cursor.load(dir);
    expect(c.size).toBe(0);
    expect(c.has("https://p.example/anything")).toBe(false);
  });

  it("evicts the oldest entry when over the cap", () => {
    const c = new Cursor(dir, [], 2);
    c.add("https://p.example/a");
    c.add("https://p.example/b");
    c.add("https://p.example/c"); // evicts a
    expect(c.size).toBe(2);
    expect(c.has("https://p.example/a")).toBe(false);
    expect(c.has("https://p.example/b")).toBe(true);
    expect(c.has("https://p.example/c")).toBe(true);
  });

  it("writes to <configDir>/state/seen.json", () => {
    const c = new Cursor(dir);
    c.add("https://p.example/r/1");
    c.save();
    expect(cursorPath(dir)).toBe(join(dir, "state", "seen.json"));
  });
});
