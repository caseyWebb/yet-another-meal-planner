import type { WasteReason } from "@yamp/contract";
import { ToolError } from "./errors.js";
import type { Avoidability } from "./waste-shapes.js";

const WASTE_AVOIDABILITY_V1 = Object.freeze({
  forgot: "avoidable",
  bought_too_much: "avoidable",
  never_opened: "avoidable",
  freezer_burned: "avoidable",
  stale: "avoidable",
  spoiled: "hard_to_avoid",
  moldy: "hard_to_avoid",
  over_ripe: "hard_to_avoid",
  expired: "hard_to_avoid",
  other: "hard_to_avoid",
} as const satisfies Record<WasteReason, Avoidability>);

export const WASTE_AVOIDABILITY_MAPPINGS = Object.freeze({
  "waste-avoidability-v1": WASTE_AVOIDABILITY_V1,
} as const);

export type WasteAvoidabilityVersion = keyof typeof WASTE_AVOIDABILITY_MAPPINGS;
export type WasteAvoidabilityMapping = Readonly<Record<WasteReason, Avoidability>>;

export const CURRENT_WASTE_AVOIDABILITY_VERSION: WasteAvoidabilityVersion = "waste-avoidability-v1";

export interface ResolvedWasteAvoidabilityMapping {
  version: WasteAvoidabilityVersion;
  currentVersion: WasteAvoidabilityVersion;
  isCurrent: boolean;
  mapping: WasteAvoidabilityMapping;
}

export function resolveWasteAvoidabilityMapping(version?: string): ResolvedWasteAvoidabilityMapping {
  const selected = version ?? CURRENT_WASTE_AVOIDABILITY_VERSION;
  if (!Object.hasOwn(WASTE_AVOIDABILITY_MAPPINGS, selected)) {
    throw new ToolError(
      "validation_failed",
      `unsupported waste avoidability mapping version; supported versions: ${Object.keys(WASTE_AVOIDABILITY_MAPPINGS).join(", ")}`,
    );
  }

  const resolvedVersion = selected as WasteAvoidabilityVersion;
  return {
    version: resolvedVersion,
    currentVersion: CURRENT_WASTE_AVOIDABILITY_VERSION,
    isCurrent: resolvedVersion === CURRENT_WASTE_AVOIDABILITY_VERSION,
    mapping: WASTE_AVOIDABILITY_MAPPINGS[resolvedVersion],
  };
}
