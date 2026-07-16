import { describe, it, expect } from "vitest";
import { rpFromRequest, beginRegistration, finishRegistration, finishAuthentication } from "../src/webauthn.js";
import { isoBase64URL, isoUint8Array } from "@simplewebauthn/server/helpers";
import { fakeD1 } from "./fake-d1.js";
import type { Env } from "../src/env.js";
import type { RegistrationResponseJSON, AuthenticationResponseJSON } from "@simplewebauthn/server";

function memKv(): KVNamespace {
  const m = new Map<string, string>();
  return {
    async get(k: string) { return m.get(k) ?? null; },
    async put(k: string, v: string) { m.set(k, v); },
    async delete(k: string) { m.delete(k); },
  } as unknown as KVNamespace;
}
function makeEnv(): Env {
  const d = fakeD1({ tables: { webauthn_credentials: [] } });
  return { ...(d.env as object), TENANT_KV: memKv() } as unknown as Env;
}
const req = (url = "https://grocery.example.com/api/passkey/login/verify") => new Request(url);

describe("webauthn ceremonies", () => {
  it("rpFromRequest derives the exact host + origin", () => {
    expect(rpFromRequest(new Request("https://grocery.example.com/api/x"))).toEqual({
      rpID: "grocery.example.com",
      origin: "https://grocery.example.com",
    });
  });

  it("beginRegistration sets the user handle to the MEMBER id and the names to the handle", async () => {
    const options = await beginRegistration(makeEnv(), req(), { id: "m2", handle: "pat" }, []);
    // The WebAuthn user handle IS the member id (member-identity-split D4) — for a founding
    // member this equals the tenant id, i.e. exactly what pre-split credentials carry.
    expect(options.user.id).toBe(isoBase64URL.fromBuffer(isoUint8Array.fromUTF8String("m2")));
    expect(options.user.name).toBe("pat");
    expect(options.user.displayName).toBe("pat");
    expect(options.authenticatorSelection?.residentKey).toBe("required");
  });

  it("finishRegistration returns null on a malformed response (no throw escapes)", async () => {
    const bad = { id: "x", rawId: "x", type: "public-key", response: {} } as unknown as RegistrationResponseJSON;
    expect(await finishRegistration(makeEnv(), req(), bad)).toBeNull();
  });

  it("finishAuthentication returns null for an unknown credential id (uniform failure)", async () => {
    const bad = {
      id: "not-enrolled",
      rawId: "not-enrolled",
      type: "public-key",
      response: { clientDataJSON: "", authenticatorData: "", signature: "" },
    } as unknown as AuthenticationResponseJSON;
    expect(await finishAuthentication(makeEnv(), req(), bad)).toBeNull();
  });
});
