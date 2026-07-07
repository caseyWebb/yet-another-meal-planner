// Shared member-app controls (member-app-core 6.1): segmented control, chip toggles,
// and the removable-token field — the design bundle's seg()/multiChips()/chips()
// renderers as controlled React components over the ported cookbook.css classes.
import * as React from "react";
import { IconX } from "./icons";

/** The mock's segmented control (single select). */
export function SegmentedControl<T extends string>(props: {
  value: T | null;
  options: readonly T[];
  onChange: (value: T) => void;
  labelFor?: (value: T) => string;
  name?: string;
}) {
  return (
    <div className="seg" data-seg={props.name}>
      {props.options.map((o) => (
        <button
          key={o}
          type="button"
          aria-pressed={o === props.value}
          onClick={() => props.onChange(o)}
        >
          {props.labelFor ? props.labelFor(o) : o}
        </button>
      ))}
    </div>
  );
}

/** A single toggle chip (the mock's .chip-tog / .wxchip). */
export function ToggleChip(props: {
  on: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  const base = props.className ?? "chip-tog";
  return (
    <button
      type="button"
      className={`${base}${props.on ? " on" : ""}`}
      aria-pressed={props.on}
      onClick={props.onToggle}
    >
      {props.children}
    </button>
  );
}

/** Selected values as removable tokens; the caller renders the adder beside them. */
export function TokenField(props: {
  values: string[];
  onRemove: (value: string) => void;
  children?: React.ReactNode;
}) {
  return (
    <div className="token-field">
      {props.values.map((v) => (
        <span className="token" key={v}>
          <span className="token-label">{v}</span>
          <button
            type="button"
            className="token-x"
            aria-label={`Remove ${v}`}
            title="Remove"
            onClick={() => props.onRemove(v)}
          >
            <IconX />
          </button>
        </span>
      ))}
      {props.children}
    </div>
  );
}
