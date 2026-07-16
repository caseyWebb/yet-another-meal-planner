// route-show-me-asks: the show-me routing rule is description-owned contract
// (consumer-facing-descriptions) and the initialize result carries the minimal
// routing preamble (mcp-server) — tool descriptions are the load-bearing mechanism
// on every host; the preamble is claude.ai belt-and-braces, never the persona.

import { describe, it, expect } from "vitest";
import { buildServer } from "../src/tools.js";
import { withServer } from "./tool-harness.js";
import { sqliteEnv } from "./sqlite-d1.js";
import type { Tenant } from "../src/tenant.js";
import type { RegistrationContext } from "../src/tools.js";

const CALLER: Tenant = { id: "casey", member: "casey" };
const MEMBER_CTX: RegistrationContext = { profile: "self-hosted", operator: false, kroger: false, instacart: false };

async function descriptions(): Promise<Map<string, string>> {
  const h = sqliteEnv(["casey"]);
  const server = buildServer(h.env, CALLER, "https://yamp.example.com", MEMBER_CTX);
  return withServer(server, async (client) => {
    const { tools } = await client.listTools();
    return new Map(tools.map((t) => [t.name, t.description ?? ""]));
  });
}

describe("show-me routing lives in the tool descriptions", () => {
  it("each display tool leads with the show-me contract", async () => {
    const d = await descriptions();
    expect(d.get("display_grocery_list")).toMatch(/THE answer to a member's show-me ask/);
    expect(d.get("display_recipe")).toMatch(/THE answer when the member wants to SEE a recipe/);
    expect(d.get("display_meal_plan")).toMatch(/THE answer when the member wants to SEE and TWEAK a proposed week/);
  });

  it("paired reads declare themselves agent-internal, pointing at their display twin", async () => {
    const d = await descriptions();
    expect(d.get("read_to_buy")).toMatch(/Agent-internal reasoning read/);
    expect(d.get("read_to_buy")).toMatch(/display_grocery_list/);
    expect(d.get("read_recipe")).toMatch(/Agent-internal read/);
    expect(d.get("read_recipe")).toMatch(/display_recipe/);
  });

  it("the planning engine points a member-initiated ask at its widget twin", async () => {
    const d = await descriptions();
    expect(d.get("propose_meal_plan")).toMatch(/Agent-internal planning engine/);
    expect(d.get("propose_meal_plan")).toMatch(/render display_meal_plan instead/);
  });

  it("read_meal_plan disambiguates the saved plan from the propose widget", async () => {
    const d = await descriptions();
    expect(d.get("read_meal_plan")).toMatch(/saved plan's source of truth/);
    expect(d.get("read_meal_plan")).toMatch(/display_meal_plan does NOT show the saved plan/);
  });
});

describe("initialize instructions carry the routing preamble, never the persona", () => {
  it("serves the show-me rule in the handshake and stays persona-free", async () => {
    const h = sqliteEnv(["casey"]);
    const server = buildServer(h.env, CALLER, "https://yamp.example.com", MEMBER_CTX);
    const instructions = await withServer(server, async (client) => client.getInstructions());
    expect(instructions).toMatch(/display_\*/);
    expect(instructions).toMatch(/never answer a show-me ask/);
    // persona markers must not leak into the handshake
    expect(instructions).not.toMatch(/terse|learn silently|cookbook grows|nudge/i);
  });
});
