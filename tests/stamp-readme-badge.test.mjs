// Tests for scripts/stamp-readme-badge.mjs — the deploy's README health-badge stamper.
// Covers the idempotent marker replace, the insert-after-first-heading path for repos
// created from an older template, the badge URL shape, and the token read from config.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  healthTokenFromConfig,
  badgeSnippet,
  stampReadmeBadge,
} from "../scripts/stamp-readme-badge.mjs";

const START = "<!-- health-badge:start -->";
const END = "<!-- health-badge:end -->";

test("badgeSnippet builds a /health.svg URL, normalizing host and encoding the token", () => {
  assert.equal(
    badgeSnippet("grocery-mcp.me.workers.dev", "abc123"),
    "![grocery-mcp health](https://grocery-mcp.me.workers.dev/health.svg?token=abc123)",
  );
  // Tolerates a scheme / trailing slash on the host, and encodes token specials.
  assert.equal(
    badgeSnippet("https://grocery.example.com/", "a/b+c"),
    "![grocery-mcp health](https://grocery.example.com/health.svg?token=a%2Fb%2Bc)",
  );
});

test("healthTokenFromConfig reads vars.HEALTH_TOKEN (JSON5 with comments)", () => {
  assert.equal(
    healthTokenFromConfig('{ "vars": { "HEALTH_TOKEN": "tok" } } // trailing comment'),
    "tok",
  );
  assert.equal(healthTokenFromConfig('{ "vars": {} }'), undefined);
  assert.equal(healthTokenFromConfig("not json"), undefined);
});

test("stampReadmeBadge inserts the block after the first heading when markers are absent", () => {
  const readme = "# My data repo\n\nIntro text.\n";
  const out = stampReadmeBadge(readme, "![b](u)");
  const lines = out.split("\n");
  assert.equal(lines[0], "# My data repo");
  assert.ok(out.includes(`${START}\n![b](u)\n${END}`));
  // The block sits above the intro, after the heading.
  assert.ok(out.indexOf(START) < out.indexOf("Intro text."));
  assert.ok(out.indexOf("# My data repo") < out.indexOf(START));
});

test("stampReadmeBadge replaces between existing markers and is idempotent", () => {
  const seeded = stampReadmeBadge("# T\n\nbody\n", badgeSnippet("h", "t1"));
  const updated = stampReadmeBadge(seeded, badgeSnippet("h", "t2"));
  // Only one marker block ever exists, and it now carries the new token.
  assert.equal(updated.match(new RegExp(START, "g")).length, 1);
  assert.ok(updated.includes("token=t2"));
  assert.ok(!updated.includes("token=t1"));
  // Re-stamping with the same snippet changes nothing (true no-op).
  assert.equal(stampReadmeBadge(updated, badgeSnippet("h", "t2")), updated);
});

test("stampReadmeBadge prepends when the README has no heading", () => {
  const out = stampReadmeBadge("just text, no heading\n", "![b](u)");
  assert.ok(out.startsWith(`${START}\n![b](u)\n${END}`));
  assert.ok(out.includes("just text, no heading"));
});
