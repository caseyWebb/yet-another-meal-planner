// The member app's combobox (member-app-core 6.1): a WAI-ARIA editable combobox with
// list autocomplete, the React port of the design bundle's app-combobox.js — text
// input + filterable listbox popover, arrow-key navigation, optional free-text commit
// (allowCustom). Used by the plan page's add-recipe/add-side pickers and the dietary
// token adders.
import * as React from "react";
import { IconCheck, IconChevronDown } from "./icons";

export interface ComboOption {
  value: string;
  label: string;
  sub?: string;
}

let uid = 0;

export function Combobox(props: {
  options: ComboOption[];
  placeholder?: string;
  ariaLabel?: string;
  allowCustom?: boolean;
  emptyText?: string;
  autoFocus?: boolean;
  inputClassName?: string;
  onSelect: (value: string, label: string) => void;
  onCancel?: () => void;
}) {
  const [id] = React.useState(() => `cb${++uid}`);
  const [open, setOpen] = React.useState(false);
  const [text, setText] = React.useState("");
  const [active, setActive] = React.useState(-1);
  const hostRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const q = text.trim().toLowerCase();
  const filtered = q
    ? props.options.filter(
        (o) => o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q),
      )
    : props.options;

  const commit = React.useCallback(
    (opt: ComboOption | null) => {
      if (opt) {
        props.onSelect(opt.value, opt.label);
      } else if (props.allowCustom && text.trim()) {
        props.onSelect(text.trim(), text.trim());
      } else {
        return;
      }
      setText("");
      setOpen(false);
      setActive(-1);
    },
    [props, text],
  );

  // Outside click closes (and cancels) — the mock's document-level dismiss.
  React.useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (hostRef.current && !hostRef.current.contains(e.target as Node)) {
        setOpen(false);
        setActive(-1);
        props.onCancel?.();
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open, props]);

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((a) => Math.min(a + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      commit(active >= 0 ? filtered[active] : (filtered.length === 1 ? filtered[0] : null));
    } else if (e.key === "Escape") {
      setOpen(false);
      setActive(-1);
      props.onCancel?.();
    }
  }

  return (
    <div className="combobox" ref={hostRef}>
      <div className="cb-field">
        <input
          ref={inputRef}
          className={`input cb-input ${props.inputClassName ?? ""}`}
          type="text"
          role="combobox"
          autoComplete="off"
          spellCheck={false}
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={`${id}-list`}
          placeholder={props.placeholder}
          aria-label={props.ariaLabel}
          autoFocus={props.autoFocus}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setOpen(true);
            setActive(-1);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
        />
        <IconChevronDown className="cb-chevron" />
      </div>
      {open ? (
        <ul className="cb-list" id={`${id}-list`} role="listbox">
          {filtered.length === 0 ? (
            <li className="cb-empty">{props.emptyText ?? "No matches"}</li>
          ) : (
            filtered.map((o, i) => (
              <li
                key={o.value}
                className="cb-option"
                role="option"
                aria-selected={i === active}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  commit(o);
                }}
              >
                <span className="cb-opt-main">
                  <span className="cb-opt-label">{o.label}</span>
                  {o.sub ? <span className="cb-opt-sub">{o.sub}</span> : null}
                </span>
                {i === active ? <IconCheck className="cb-check" /> : null}
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}
