import * as React from "react";
import * as AllIcons from "../../packages/ui/src/components/icons";

/**
 * The full @yamp/ui icon set, shown together for reference. In real code,
 * import each icon individually by name — e.g. `import { IconCart, IconHeart } from "@yamp/ui"`.
 * Every icon is an SVG component accepting standard `React.SVGProps<SVGSVGElement>`
 * (width/height/className/color via currentColor).
 */
export function Icons(props: React.SVGProps<SVGSVGElement>) {
  const entries = Object.entries(AllIcons).filter(
    ([name, val]) => name.startsWith("Icon") && typeof val === "function",
  ) as [string, React.ComponentType<React.SVGProps<SVGSVGElement>>][];
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(96px, 1fr))",
        gap: 8,
        padding: 4,
      }}
    >
      {entries.map(([name, Icon]) => (
        <div
          key={name}
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 8,
            padding: "12px 8px",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-md)",
            background: "var(--card)",
            color: "var(--card-foreground)",
          }}
        >
          <Icon width={22} height={22} {...props} />
          <span style={{ fontSize: 11, color: "var(--muted-foreground)", fontFamily: "var(--font-mono)" }}>
            {name}
          </span>
        </div>
      ))}
    </div>
  );
}
