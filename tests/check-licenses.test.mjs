// Tests for scripts/check-licenses.mjs — the CI dependency-license gate's pure helpers.
// Covers the SPDX expression evaluator (OR = any, AND = all, WITH/paren/`+` normalization) against
// the AGPL-3.0 allowlist, and the package.json license extractor (string, deprecated object, and
// deprecated array forms).
import { test } from "node:test";
import assert from "node:assert/strict";
import { isLicenseAllowed, licenseOf, ALLOWED_LICENSES } from "../scripts/check-licenses.mjs";

test("isLicenseAllowed accepts permissive + v3-copyleft-family ids", () => {
  for (const id of ["MIT", "MIT-0", "ISC", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "0BSD", "MPL-2.0"]) {
    assert.equal(isLicenseAllowed(id), true, id);
  }
  // The AGPL/GPL/LGPL v3 family — including the deprecated bare ids — is compatible with AGPL-3.0.
  for (const id of ["AGPL-3.0-only", "GPL-3.0-or-later", "LGPL-3.0-only", "LGPL-3.0", "GPL-3.0"]) {
    assert.equal(isLicenseAllowed(id), true, id);
  }
});

test("isLicenseAllowed rejects GPLv2-only, proprietary, and unknown", () => {
  for (const id of ["GPL-2.0-only", "GPL-2.0", "LGPL-2.1-only", "UNLICENSED", "SEE LICENSE IN LICENSE", "", "CC-BY-NC-4.0"]) {
    assert.equal(isLicenseAllowed(id), false, id);
  }
  // Non-strings never pass.
  for (const v of [null, undefined, 42, {}]) {
    assert.equal(isLicenseAllowed(v), false, String(v));
  }
});

test("isLicenseAllowed: OR passes if any operand passes (parenthesized or bare)", () => {
  assert.equal(isLicenseAllowed("(MIT OR Apache-2.0)"), true);
  assert.equal(isLicenseAllowed("MIT OR Apache-2.0"), true);
  // AFL-2.1 is not on the allowlist, but the BSD-3-Clause alternative is — real npm string.
  assert.equal(isLicenseAllowed("(AFL-2.1 OR BSD-3-Clause)"), true);
  // Neither operand allowed → still rejected.
  assert.equal(isLicenseAllowed("(GPL-2.0-only OR LicenseRef-Proprietary)"), false);
});

test("isLicenseAllowed: AND passes only if every operand passes", () => {
  assert.equal(isLicenseAllowed("(MIT AND ISC)"), true);
  assert.equal(isLicenseAllowed("MIT AND GPL-2.0-only"), false);
  // Nested OR-within-AND.
  assert.equal(isLicenseAllowed("(MIT OR (Apache-2.0 AND BSD-3-Clause))"), true);
});

test("isLicenseAllowed normalizes WITH-exceptions and a trailing +", () => {
  assert.equal(isLicenseAllowed("Apache-2.0 WITH LLVM-exception"), true);
  assert.equal(isLicenseAllowed("GPL-3.0-or-later WITH GCC-exception-3.1"), true);
  assert.equal(isLicenseAllowed("Apache-2.0+"), true);
  // The base of a WITH on a disallowed license is still disallowed.
  assert.equal(isLicenseAllowed("GPL-2.0-only WITH Classpath-exception-2.0"), false);
});

test("licenseOf reads string, deprecated object, and deprecated array forms", () => {
  assert.equal(licenseOf({ license: "MIT" }), "MIT");
  assert.equal(licenseOf({ license: { type: "BSD-3-Clause", url: "..." } }), "BSD-3-Clause");
  assert.equal(licenseOf({ licenses: [{ type: "MIT" }, { type: "Apache-2.0" }] }), "(MIT OR Apache-2.0)");
  assert.equal(licenseOf({}), "");
  assert.equal(licenseOf(null), "");
  // A package.json declaring a deprecated dual-license array still resolves to an allowed expr.
  assert.equal(isLicenseAllowed(licenseOf({ licenses: [{ type: "MIT" }, { type: "GPL-2.0-only" }] })), true);
});

test("the allowlist excludes GPLv2-only by construction (guards an accidental re-add)", () => {
  assert.equal(ALLOWED_LICENSES.has("GPL-2.0-only"), false);
  assert.equal(ALLOWED_LICENSES.has("GPL-2.0"), false);
});
