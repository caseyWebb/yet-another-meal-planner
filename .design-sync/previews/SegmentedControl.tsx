import { SegmentedControl } from "@yamp/ui";

export function Timeframe() {
  return (
    <SegmentedControl
      value={"week"}
      options={["week", "month", "all"] as const}
      onChange={() => {}}
      labelFor={(v) => ({ week: "This week", month: "This month", all: "All time" }[v])}
    />
  );
}

export function Meal() {
  return (
    <SegmentedControl
      value={"dinner"}
      options={["breakfast", "lunch", "dinner"] as const}
      onChange={() => {}}
      labelFor={(v) => ({ breakfast: "Breakfast", lunch: "Lunch", dinner: "Dinner" }[v])}
    />
  );
}

export function Unselected() {
  return (
    <SegmentedControl
      value={null}
      options={["easy", "medium", "ambitious"] as const}
      onChange={() => {}}
      labelFor={(v) => ({ easy: "Easy", medium: "Medium", ambitious: "Ambitious" }[v])}
    />
  );
}
