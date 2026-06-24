import { describe, it, expect } from "vitest";
import {
  parseAuthResults,
  authResultsHeader,
  gateMessage,
  rejectReasonFor,
  extractEmailBody,
  inboxCandidateUrl,
} from "../src/email.js";
import type { Allowlist } from "../src/corpus-db.js";

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

describe("inboxCandidateUrl", () => {
  // The inbox is a D1 table now; one received message has no single canonical url, so
  // dedup rides a synthetic url derived from (from, subject, received_at), carried into
  // the candidate's UNIQUE(url) column. Same triple → same url (an exact re-delivery).
  it("derives a stable url from the dedup triple", () => {
    const entry = { from: "news@seriouseats.com", subject: "This week", received_at: "2026-06-11", body: "x" };
    const url = inboxCandidateUrl(entry);
    expect(url).toBe(inboxCandidateUrl({ ...entry, body: "different body, same message" }));
    expect(url).not.toBe(inboxCandidateUrl({ ...entry, received_at: "2026-06-12" }));
  });
});
