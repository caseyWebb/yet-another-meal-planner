import { describe, it, expect } from "vitest";
import {
  parseAllowlist,
  parseAuthResults,
  authResultsHeader,
  gateMessage,
  rejectReasonFor,
  extractEmailBody,
  appendInboxEntry,
  addSources,
  INBOX_MAX_AGE_DAYS,
  type Allowlist,
} from "../src/email.js";
import { parseToml } from "../src/parse.js";
import { flattenInbox } from "../src/discovery.js";

describe("parseAllowlist", () => {
  it("parses members + senders, lowercasing addresses", () => {
    const a = parseAllowlist(`
[[members]]
address = "Alice@Example.com"
name = "Alice"

[[senders]]
address = "news@seriouseats.com"
`);
    expect(a.members.has("alice@example.com")).toBe(true);
    expect(a.senders.has("news@seriouseats.com")).toBe(true);
  });

  it("returns empty sets for absent/malformed input", () => {
    expect(parseAllowlist(null).members.size).toBe(0);
    expect(parseAllowlist("[[[ not toml").senders.size).toBe(0);
  });
});

describe("parseAuthResults", () => {
  it("extracts dkim/spf/dmarc verdicts and dkim domains", () => {
    const v = parseAuthResults(
      "mx.cloudflare.net; dkim=pass header.d=seriouseats.com; spf=pass; dmarc=pass",
    );
    expect(v).toMatchObject({ dkim: true, spf: true, dmarc: true });
    expect(v.dkimDomains).toContain("seriouseats.com");
  });

  it("records a failing dkim as false with no domain", () => {
    const v = parseAuthResults("mx; dkim=fail header.d=evil.com; spf=softfail; dmarc=none");
    expect(v.dkim).toBe(false);
    expect(v.dkimDomains).toEqual([]);
    expect(v.dmarc).toBe(false);
  });

  it("handles a null header", () => {
    expect(parseAuthResults(null)).toMatchObject({ dkim: false, spf: false, dmarc: false });
  });
});

describe("gateMessage", () => {
  const allowlist: Allowlist = {
    members: new Set(["alice@example.com"]),
    senders: new Set(["news@seriouseats.com"]),
  };
  const pass = (domain: string) => ({ dkim: true, spf: true, dmarc: true, dkimDomains: [domain] });

  it("(a) accepts an allowlisted sender with aligned DKIM (auto-forward)", () => {
    const r = gateMessage({ from: "news@seriouseats.com", allowlist, auth: pass("seriouseats.com") });
    expect(r).toMatchObject({ accepted: true, reason: "sender_dkim" });
  });

  it("(b) accepts an allowlisted member with aligned DKIM (manual forward)", () => {
    const r = gateMessage({ from: "alice@example.com", allowlist, auth: pass("example.com") });
    expect(r).toMatchObject({ accepted: true, reason: "member_dkim" });
  });

  it("drops an allowlisted sender whose DKIM is not aligned, as auth_unaligned", () => {
    const r = gateMessage({ from: "news@seriouseats.com", allowlist, auth: pass("mailchimp.com") });
    expect(r).toMatchObject({ accepted: false, reason: "auth_unaligned" });
  });

  it("drops mail from a non-allowlisted address as not_allowlisted (even with passing DKIM)", () => {
    const r = gateMessage({ from: "spam@nowhere.com", allowlist, auth: pass("nowhere.com") });
    expect(r).toMatchObject({ accepted: false, reason: "not_allowlisted" });
  });

  it("drops an allowlisted member when DKIM did not pass, as auth_unaligned (relay-SPF deferred)", () => {
    const r = gateMessage({
      from: "alice@example.com",
      allowlist,
      auth: { dkim: false, spf: true, dmarc: false, dkimDomains: [] },
    });
    expect(r).toMatchObject({ accepted: false, reason: "auth_unaligned" });
  });
});

describe("authResultsHeader", () => {
  const headers = [
    { key: "received", value: "from mail.protonmail.ch by cloudflare-email.net" },
    { key: "arc-authentication-results", value: "i=1; mx.cloudflare.net; dkim=pass header.d=dirtbag.social" },
    { key: "authentication-results", value: "mx.cloudflare.net; dkim=pass header.d=dirtbag.social; spf=pass" },
    { key: "dkim-signature", value: "v=1; a=rsa-sha256; d=dirtbag.social" },
  ];

  it("returns the verifier's authentication-results value (not arc-*)", () => {
    const v = authResultsHeader(headers);
    expect(v).toContain("dkim=pass header.d=dirtbag.social");
    expect(v?.startsWith("mx.cloudflare.net")).toBe(true);
  });

  it("prefers the Cloudflare line when several authentication-results exist", () => {
    const v = authResultsHeader([
      { key: "authentication-results", value: "mail.protonmail.ch; dkim=none" },
      { key: "authentication-results", value: "mx.cloudflare.net; dkim=pass header.d=dirtbag.social" },
    ]);
    expect(v).toContain("cloudflare");
    expect(v).toContain("dkim=pass");
  });

  it("returns null when none present (or undefined input)", () => {
    expect(authResultsHeader([{ key: "received", value: "x" }])).toBeNull();
    expect(authResultsHeader(undefined)).toBeNull();
  });

  it("feeds parseAuthResults to an aligned member verdict end-to-end", () => {
    const v = parseAuthResults(authResultsHeader(headers));
    expect(v.dkim).toBe(true);
    expect(v.dkimDomains).toContain("dirtbag.social");
  });
});

describe("rejectReasonFor", () => {
  const base = { from: "casey@dirtbag.social" };
  it("returns null for a successful write", () => {
    expect(rejectReasonFor({ ...base, accepted: true, reason: "member_dkim", written: true })).toBeNull();
  });

  it("returns null even when the email was a duplicate (not a bounce-worthy failure)", () => {
    expect(rejectReasonFor({ ...base, accepted: true, reason: "member_dkim", written: false })).toBeNull();
  });

  it("gives a detailed DKIM-alignment reason to a known-but-unaligned sender", () => {
    const r = rejectReasonFor({ ...base, accepted: false, reason: "auth_unaligned", written: false });
    expect(r).toMatch(/DKIM/i);
  });

  it("gives a terse reason to a non-allowlisted sender", () => {
    const r = rejectReasonFor({ ...base, accepted: false, reason: "not_allowlisted", written: false });
    expect(r).toMatch(/not an allowlisted/i);
  });
});

describe("extractEmailBody", () => {
  it("prefers the text/plain part when available", () => {
    const body = extractEmailBody("<p>HTML part</p>", "Text part with a link https://x.test/chili");
    expect(body).toBe("Text part with a link https://x.test/chili");
    expect(body).not.toContain("<p>");
  });

  it("falls back to HTML-to-text conversion when no text part", () => {
    const body = extractEmailBody(
      '<p>Try <a href="https://x.test/chili">Weeknight Chili</a> for dinner.</p>',
      null,
    );
    expect(body).toContain("Weeknight Chili");
    expect(body).toContain("https://x.test/chili");
    expect(body).not.toContain("<p>");
    expect(body).not.toContain("<a ");
  });

  it("expands anchor tags to 'TEXT (URL)' form so URLs are visible in the body", () => {
    const body = extractEmailBody(
      '<a href="https://seriouseats.com/chili">Weeknight Chili</a>',
      null,
    );
    expect(body).toMatch(/Weeknight Chili \(https:\/\/seriouseats\.com\/chili\)/);
  });

  it("drops non-http hrefs (mailto, tel) from the expanded text", () => {
    const body = extractEmailBody('<a href="mailto:x@y.com">Email us</a>', null);
    expect(body).toContain("Email us");
    expect(body).not.toContain("mailto:");
  });

  it("returns empty string when both parts are absent", () => {
    expect(extractEmailBody(null, null)).toBe("");
    expect(extractEmailBody(undefined, undefined)).toBe("");
  });

  it("truncates long bodies to BODY_MAX", () => {
    const long = "x".repeat(20_000);
    expect(extractEmailBody(null, long).length).toBeLessThanOrEqual(10_000);
  });
});

describe("appendInboxEntry", () => {
  const entry = {
    from: "news@seriouseats.com",
    subject: "This week",
    received_at: "2026-06-11",
    body: "Recipe links: Chili https://seriouseats.com/chili\nSoup https://seriouseats.com/soup",
  };

  it("appends a new entry and reports written: true", () => {
    const { text, written } = appendInboxEntry(null, entry);
    expect(written).toBe(true);
    const emails = flattenInbox(text);
    expect(emails).toHaveLength(1);
    expect(emails[0]).toMatchObject({
      from: "news@seriouseats.com",
      subject: "This week",
      received_at: "2026-06-11",
    });
    expect(emails[0].body).toContain("https://seriouseats.com/chili");
    // round-trips as valid TOML
    expect(() => parseToml(text, "discoveries_inbox.toml")).not.toThrow();
  });

  it("skips a duplicate entry (same from + subject + received_at)", () => {
    const { text: first } = appendInboxEntry(null, entry);
    const { text: second, written } = appendInboxEntry(first, entry);
    expect(written).toBe(false);
    expect(second).toBe(first);
  });

  it("prunes entries older than INBOX_MAX_AGE_DAYS on write", () => {
    // Build an inbox with one entry from way in the past.
    const old = {
      ...entry,
      subject: "Old newsletter",
      received_at: "2000-01-01",
    };
    const { text: withOld } = appendInboxEntry(null, old);
    const emails1 = flattenInbox(withOld);
    expect(emails1).toHaveLength(1);

    // Appending a fresh entry should prune the old one.
    const fresh = { ...entry, subject: "Fresh newsletter" };
    const { text: withFresh, written } = appendInboxEntry(withOld, fresh);
    expect(written).toBe(true);
    const emails2 = flattenInbox(withFresh);
    expect(emails2.map((e) => e.subject)).not.toContain("Old newsletter");
    expect(emails2.map((e) => e.subject)).toContain("Fresh newsletter");
  });

  it("keeps entries within the retention window", () => {
    const recent = { ...entry, subject: "Recent newsletter" };
    const { text } = appendInboxEntry(null, recent);
    const emails = flattenInbox(text);
    expect(emails.map((e) => e.subject)).toContain("Recent newsletter");
  });
});

describe("addSources", () => {
  it("adds members + senders and dedups by address", () => {
    const first = addSources(null, {
      members: [{ address: "Alice@Example.com" }], // members are address-only — no label
      senders: [{ address: "news@seriouseats.com", name: "Serious Eats" }],
    });
    expect(first.added).toEqual({ members: 1, senders: 1 });
    const second = addSources(first.text, {
      members: [{ address: "alice@example.com" }], // dup (case-insensitive)
      senders: [{ address: "cooking@nytimes.com" }],
    });
    expect(second.added).toEqual({ members: 0, senders: 1 });
    const al = parseAllowlist(second.text);
    expect(al.members.has("alice@example.com")).toBe(true);
    expect(al.senders.has("cooking@nytimes.com")).toBe(true);
    expect(al.senders.has("news@seriouseats.com")).toBe(true);
    // Member rows carry no label; the only `name` written is the newsletter's.
    expect(second.text).toContain('name = "Serious Eats"');
    expect((second.text.match(/name = /g) ?? []).length).toBe(1);
  });

  it("ignores entries with no @ address", () => {
    const { added } = addSources(null, { senders: [{ address: "not-an-email" }] });
    expect(added.senders).toBe(0);
  });
});
