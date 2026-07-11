import { describe, expect, it } from "vitest";
import {
  buildProposeRequest,
  defaultProposeSession,
  proposePanelOf,
  proposeSessionFromRequest,
  proposeSlotToView,
  type ProposeSession,
} from "./propose-orchestration";

const baseSession: ProposeSession = {
  seed: 20260711,
  nights: 4,
  variety: 0.7,
  proteinWants: ["tofu", "chicken"],
  freeform: "  bright dinners  ",
  locked: { vibe_b: "locked-slug" },
  overrides: { vibe_a: "swap-slug", vibe_b: "ignored-swap" },
  excluded: ["ziti", "alfredo"],
  slotProtein: { vibe_c: "salmon" },
  slotCuisine: { vibe_a: "thai" },
  slotMaxTime: { vibe_b: null, vibe_c: 30 },
  slotVibe: { vibe_c: "weeknight fish" },
};

describe("propose orchestration", () => {
  it("serializes sessions into canonical propose requests", () => {
    expect(buildProposeRequest(baseSession)).toEqual({
      nights: 4,
      seed: 20260711,
      exclude: ["alfredo", "ziti"],
      nudges: { variety: 0.7, freeform: "bright dinners", proteins: ["chicken", "tofu"] },
      slots: [
        { vibe_id: "vibe_a", cuisine: "thai", recipe: "swap-slug" },
        { vibe_id: "vibe_b", max_time_total: null, recipe: "locked-slug" },
        { vibe_id: "vibe_c", protein: "salmon", max_time_total: 30, vibe: "weeknight fish" },
      ],
    });
  });

  it("hydrates widget request echoes back into session state", () => {
    expect(
      proposeSessionFromRequest({
        seed: 9,
        nights: 3,
        variety: 0.2,
        proteins: ["beans"],
        freeform: "cheap",
        exclude: ["steak"],
        slots: [
          { vibe_id: "vibe_a", protein: "beans", cuisine: "mexican", max_time_total: null, vibe: "tacos", recipe: "bean-tacos" },
        ],
      }),
    ).toMatchObject({
      seed: 9,
      nights: 3,
      variety: 0.2,
      proteinWants: ["beans"],
      freeform: "cheap",
      excluded: ["steak"],
      slotProtein: { vibe_a: "beans" },
      slotCuisine: { vibe_a: "mexican" },
      slotMaxTime: { vibe_a: null },
      slotVibe: { vibe_a: "tacos" },
      overrides: { vibe_a: "bean-tacos" },
    });
  });

  it("projects slots into shared UI views with labels, pins, flags, and sides", () => {
    const session = defaultProposeSession(12, 1);
    session.locked.vibe_a = "main-a";
    session.slotProtein.vibe_a = "chicken";
    session.slotMaxTime.vibe_a = null;

    expect(
      proposeSlotToView(
        {
          vibe_id: "vibe_a",
          main: {
            slug: "main-a",
            title: "Main A",
            description: null,
            protein: "chicken",
            cuisine: "thai",
            time_total: 25,
          },
          sides: [{ title: "Rice" }],
          flags: { waste: ["cilantro"], meal_prep: true, no_corpus_side: true },
          why: ["uses pantry"],
          alternates: [],
          alt_similar: null,
          alt_different: null,
          weather_category: "wet",
        },
        0,
        session,
        { vibeLabels: { vibe_a: "Cozy" } },
      ),
    ).toMatchObject({
      key: "vibe_a:0",
      vibeId: "vibe_a",
      vibeLabel: "Cozy",
      locked: true,
      pinnedProtein: "chicken",
      timePin: { explicit: true, value: null },
      sides: ["Rice"],
      flags: [
        { type: "waste", label: "Single-use: cilantro" },
        { type: "meal-prep", label: "Meal-preps well" },
        { type: "side", label: "No corpus side — add your own" },
      ],
    });
  });

  it("keeps null-vibe widget labels and panel parsing host-compatible", () => {
    expect(
      proposeSlotToView(
        {
          vibe_id: null,
          reason: "new_for_me",
          main: null,
          sides: [],
          flags: {},
          why: [],
          alternates: [],
          alt_similar: null,
          alt_different: null,
        },
        2,
        defaultProposeSession(3, 1),
        { nullVibeLabel: (slot) => (slot.reason === "new_for_me" ? "new to you" : "your pick") },
      ).vibeLabel,
    ).toBe("new to you");

    expect(proposePanelOf("vibe_a|swap", "vibe_a")).toBe("swap");
    expect(proposePanelOf("vibe_b|swap", "vibe_a")).toBeNull();
  });
});
