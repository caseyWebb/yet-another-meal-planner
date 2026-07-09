import { SlotCard, type ProposeSlotView } from "@yamp/ui";

const proteins = ["Chicken", "Beef", "Salmon", "Tofu"];
const cuisines = ["Italian", "Asian", "Mediterranean"];
const palettePresets = ["Weeknight", "Comfort", "Light"];

const renderTitle = (slug: string, title: string) => <a href={`/recipe/${slug}`}>{title}</a>;

const noop = () => {};

export function FilledSlot() {
  const slot: ProposeSlotView = {
    key: "mon",
    vibeId: "v1",
    vibeLabel: "Weeknight",
    vibeEdited: false,
    weatherCategory: "grill",
    main: {
      slug: "pan-seared-salmon",
      title: "Pan-seared salmon",
      description: "Crisp-skinned salmon with roasted broccoli and lemon rice — on the table in under half an hour.",
      protein: "Salmon",
      cuisine: "Mediterranean",
      time_total: 25,
    },
    emptyReason: null,
    locked: false,
    pinnedProtein: null,
    pinnedCuisine: null,
    timePin: { explicit: false, value: null },
    why: ["matches your Weeknight vibe", "grill-friendly for a warm night"],
    sides: ["roasted broccoli", "lemon rice"],
    flags: [{ type: "meal-prep", label: "Makes leftovers" }],
    alternates: [],
    altSimilar: null,
    altDifferent: null,
  };
  return (
    <div style={{ maxWidth: 420 }}>
      <SlotCard
        slot={slot}
        panel={null}
        onPanel={noop}
        proteins={proteins}
        cuisines={cuisines}
        palettePresets={palettePresets}
        renderTitle={renderTitle}
        onLockToggle={noop}
        onSwapTo={noop}
        onExclude={noop}
        onFacetPick={noop}
        onTimePick={noop}
        onVibeApply={noop}
        onVibeReset={noop}
      />
    </div>
  );
}

export function LockedWithPins() {
  const slot: ProposeSlotView = {
    key: "tue",
    vibeId: "v2",
    vibeLabel: "Comfort",
    vibeEdited: true,
    weatherCategory: "cold-comfort",
    main: {
      slug: "chicken-tikka-masala",
      title: "Chicken tikka masala",
      description: "Creamy, spiced tomato curry over basmati — a cozy Tuesday-night comfort dinner.",
      protein: "Chicken",
      cuisine: "Asian",
      time_total: 40,
    },
    emptyReason: null,
    locked: true,
    pinnedProtein: "Chicken",
    pinnedCuisine: null,
    timePin: { explicit: true, value: 45 },
    why: ["you locked this one", "warm and hearty for a cold night"],
    sides: ["basmati rice", "naan", "cucumber raita"],
    flags: [{ type: "waste", label: "Use up the cilantro" }],
    alternates: [],
    altSimilar: null,
    altDifferent: null,
  };
  return (
    <div style={{ maxWidth: 420 }}>
      <SlotCard
        slot={slot}
        panel={null}
        onPanel={noop}
        proteins={proteins}
        cuisines={cuisines}
        palettePresets={palettePresets}
        renderTitle={renderTitle}
        onLockToggle={noop}
        onSwapTo={noop}
        onExclude={noop}
        onFacetPick={noop}
        onTimePick={noop}
        onVibeApply={noop}
        onVibeReset={noop}
      />
    </div>
  );
}

export function EmptySlot() {
  const slot: ProposeSlotView = {
    key: "wed",
    vibeId: "v3",
    vibeLabel: "Light",
    vibeEdited: false,
    weatherCategory: "mild",
    main: null,
    emptyReason: "No recipe matched your pins",
    locked: false,
    pinnedProtein: "Tofu",
    pinnedCuisine: "Italian",
    timePin: { explicit: true, value: 20 },
    why: [],
    sides: [],
    flags: [],
    alternates: [],
    altSimilar: null,
    altDifferent: null,
  };
  return (
    <div style={{ maxWidth: 420 }}>
      <SlotCard
        slot={slot}
        panel={null}
        onPanel={noop}
        proteins={proteins}
        cuisines={cuisines}
        palettePresets={palettePresets}
        renderTitle={renderTitle}
        onLockToggle={noop}
        onSwapTo={noop}
        onExclude={noop}
        onFacetPick={noop}
        onTimePick={noop}
        onVibeApply={noop}
        onVibeReset={noop}
      />
    </div>
  );
}
