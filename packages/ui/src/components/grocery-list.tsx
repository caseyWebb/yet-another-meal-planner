import type { GroceryLine, GroceryListData } from "@yamp/contract";
import * as React from "react";
import {
  createGroceryController,
  type GroceryAction,
  type GroceryGrouping,
  type GroceryHostAdapter,
  groceryActionKey,
  groupGroceryLines,
  orderedRecipeAttribution,
  projectGroceryAction,
  runGroceryAction,
} from "../grocery-controller";
import { Button } from "./button";
import { Card, CardContent } from "./card";
import { Input } from "./input";

export interface GroceryListProps {
  data: GroceryListData;
  adapter: GroceryHostAdapter;
  onDataChange?(data: GroceryListData): void;
}

export function GroceryList({ data, adapter, onDataChange }: GroceryListProps) {
  const [state, setState] = React.useState(() => createGroceryController(data));
  const [add, setAdd] = React.useState("");
  const stateRef = React.useRef(state);
  const pendingRef = React.useRef(new Map<string, GroceryAction>());
  React.useEffect(() => {
    setState((current) => {
      let projected = data;
      for (const pending of pendingRef.current.values()) projected = projectGroceryAction(projected, pending);
      const next = { ...current, data: projected };
      stateRef.current = next;
      return next;
    });
  }, [data]);
  const act = React.useCallback(
    (action: GroceryAction) => {
      const key = groceryActionKey(action);
      if (pendingRef.current.has(key)) return;
      pendingRef.current.set(key, action);
      const current = stateRef.current;
      const submitted = {
        ...current,
        data: projectGroceryAction(current.data, action),
        pending: [...current.pending, key],
      };
      stateRef.current = submitted;
      setState(submitted);
      void (async () => {
        const result = await runGroceryAction({ ...submitted, data: current.data }, adapter, action);
        pendingRef.current.delete(key);
        setState((current) => {
          let projected = result.data;
          for (const pending of pendingRef.current.values())
            projected = projectGroceryAction(projected, pending);
          const next = {
            ...current,
            data: projected,
            pending: current.pending.filter((item) => item !== key),
            conflict: result.conflict,
            confirmation: result.confirmation,
          };
          stateRef.current = next;
          return next;
        });
        onDataChange?.(result.data);
      })();
    },
    [adapter, onDataChange],
  );
  const grouping = state.grouping;
  const groups = groupGroceryLines(state.data.lines, grouping);
  const readonly = adapter.mode === "readonly";
  const isPending = (action: GroceryAction): boolean => state.pending.includes(groceryActionKey(action));
  return (
    <section className="grocery-shared" data-testid="shared-grocery-list" data-host-mode={adapter.mode}>
      <div className="grocery-stats" aria-label="Grocery status">
        <Stat label="To buy" value={state.data.counts.to_buy} />
        <Stat label="Checked" value={state.data.counts.checked} />
        <Stat label="In carts" value={state.data.counts.in_carts} />
      </div>
      {state.conflict ? (
        <p className="grocery-conflict" role="alert">
          {state.conflict}
        </p>
      ) : null}
      <div className="grocery-grouping" role="radiogroup" aria-label="Group grocery list">
        {(["department", "recipe"] as GroceryGrouping[]).map((mode) => (
          <Button
            key={mode}
            role="radio"
            aria-checked={grouping === mode}
            size="sm"
            variant={grouping === mode ? "default" : "outline"}
            onClick={() => setState((cur) => ({ ...cur, grouping: mode }))}
          >
            {mode === "department" ? "Department" : "Recipe"}
          </Button>
        ))}
      </div>
      <div className="grocery-groups">
        {groups.map((group) => (
          <section key={group.key} data-testid="grocery-group" data-group={group.label}>
            <h2>
              {group.label} <small>{group.lines.length}</small>
            </h2>
            <ul>
              {group.lines.map((line) => (
                <ShoppingLine
                  key={line.key}
                  line={line}
                  snapshotVersion={state.data.snapshot_version}
                  readonly={readonly}
                  pending={state.pending.includes(`line:${line.key}`)}
                  onAction={act}
                />
              ))}
            </ul>
          </section>
        ))}
      </div>
      {state.data.substitution_decisions?.length || state.data.coverage_decisions?.length ? (
        <section className="grocery-decisions" aria-label="Saved grocery decisions">
          <h2>Saved decisions</h2>
          <ul>
            {(state.data.substitution_decisions ?? []).map((decision) => (
              <li key={`sub-${decision.original_key}`}>
                Using {decision.replacement_key} instead of {decision.original_key}{" "}
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={readonly || state.pending.includes(`line:${decision.original_key}`)}
                  onClick={() =>
                    void act({
                      kind: "substitute_undo",
                      original_key: decision.original_key,
                      snapshot_version: state.data.snapshot_version,
                    })
                  }
                >
                  Undo
                </Button>
              </li>
            ))}
            {(state.data.coverage_decisions ?? []).map((decision) => (
              <li key={`coverage-${decision.line_key}`}>
                Buying {decision.line_key} despite pantry coverage{" "}
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={readonly || state.pending.includes(`line:${decision.line_key}`)}
                  onClick={() =>
                    void act({
                      kind: "pantry_undo",
                      key: decision.line_key,
                      snapshot_version: state.data.snapshot_version,
                    })
                  }
                >
                  Undo
                </Button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <form
        className="grocery-add"
        onSubmit={(event) => {
          event.preventDefault();
          const name = add.trim();
          if (!name) return;
          void act({ kind: "add", name });
          setAdd("");
        }}
      >
        <Input
          aria-label="Add grocery item"
          placeholder="Add an item"
          value={add}
          onChange={(e) => setAdd(e.target.value)}
          disabled={readonly}
        />
        <Button
          type="submit"
          disabled={readonly || !add.trim() || isPending({ kind: "add", name: add.trim() })}
        >
          Add
        </Button>
      </form>
      {state.data.underived.length ? (
        <p className="grocery-underived" role="note">
          Ingredients for {state.data.underived.join(", ")} are not derived yet and may be missing.
        </p>
      ) : null}
      <div className="grocery-carts">
        {state.data.in_cart_groups.map((group, index) => (
          <details
            key={group.send_id ?? `unlinked-${index}`}
            className="grocery-cart-group"
            data-testid="grocery-cart-group"
            open
          >
            <summary aria-label={`${group.store ?? "Unlinked"} cart, ${group.lines.length} items`}>
              <span className="grocery-cart-title">
                {group.store ? `In your ${group.store} cart` : "In cart — no send record"}
              </span>
              <small>{group.lines.length} items</small>
            </summary>
            <Card>
              <CardContent>
                <p>
                  {group.sent_at
                    ? `Sent ${new Date(group.sent_at).toLocaleString()}`
                    : "No linked send history"}{" "}
                  · {group.lines.length} items
                </p>
                {group.awaiting_confirmation ? <p className="muted">Awaiting confirmation</p> : null}
                {group.estimated_total != null ? (
                  <p>
                    <strong>Sent estimate ${group.estimated_total.toFixed(2)}</strong>
                    {group.flyer_savings && group.flyer_savings > 0
                      ? ` · $${group.flyer_savings.toFixed(2)} flyer savings`
                      : ""}
                  </p>
                ) : null}
                {group.estimated_total != null ? (
                  <p className="muted">Send-time quote, not a final fulfillment price.</p>
                ) : null}
                <ul>
                  {group.lines.map((line) => (
                    <li key={line.key} data-testid="grocery-cart-line" data-key={line.key}>
                      <span>
                        {line.name} · {line.quantity}
                      </span>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={readonly || state.pending.includes(`send:${group.send_id}`)}
                        onClick={() =>
                          void act({
                            kind: "relist",
                            send_id: group.send_id,
                            key: line.key,
                            expected_row_version: line.row_version,
                          })
                        }
                      >
                        Back to list
                      </Button>
                    </li>
                  ))}
                </ul>
                {group.send_id && group.can_mark_placed ? (
                  <Button
                    disabled={
                      readonly || state.pending.includes(`send:${group.send_id}`) || adapter.online === false
                    }
                    title={adapter.online === false ? "Reconnect to confirm this purchase" : undefined}
                    onClick={() =>
                      void act({
                        kind: "mark_placed",
                        send_id: group.send_id!,
                        expected_line_keys: group.lines.map((line) => line.key).sort(),
                        snapshot_version: state.data.snapshot_version,
                      })
                    }
                  >
                    Mark order placed
                  </Button>
                ) : null}
              </CardContent>
            </Card>
          </details>
        ))}
      </div>
      {state.data.pantry_covered.length ? (
        <section className="grocery-pantry">
          <h2>Pantry covers these — still good?</h2>
          <ul>
            {state.data.pantry_covered.map((line) => (
              <li key={line.key} data-testid="grocery-pantry-line" data-key={line.key}>
                <span>
                  {line.display_name ?? line.name}
                  {line.freshness === "worth_a_look" ? ` · ${line.freshness_reason ?? "worth a look"}` : ""}
                </span>
                <span>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={readonly || state.pending.includes(`line:${line.key}`)}
                    onClick={() =>
                      void act({
                        kind: "pantry_verify",
                        key: line.key,
                        snapshot_version: state.data.snapshot_version,
                      })
                    }
                  >
                    Still good
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={readonly || state.pending.includes(`line:${line.key}`)}
                    onClick={() =>
                      void act({
                        kind: "pantry_buy_anyway",
                        key: line.key,
                        snapshot_version: state.data.snapshot_version,
                      })
                    }
                  >
                    Buy anyway
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {state.confirmation ? (
        <p className="grocery-confirmation" aria-live="polite">
          Saved ·{" "}
          {undoFor(state.confirmation, state.data.snapshot_version) ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                const undo = undoFor(state.confirmation!, state.data.snapshot_version);
                if (undo) void act(undo);
              }}
            >
              Undo
            </Button>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setState((cur) => ({ ...cur, confirmation: null }))}
            >
              Dismiss
            </Button>
          )}
        </p>
      ) : null}
    </section>
  );
}

function undoFor(action: GroceryAction, snapshotVersion: string): GroceryAction | null {
  if (action.kind === "pantry_buy_anyway")
    return { kind: "pantry_undo", key: action.key, snapshot_version: snapshotVersion };
  if (action.kind === "substitute")
    return { kind: "substitute_undo", original_key: action.original_key, snapshot_version: snapshotVersion };
  return null;
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function ShoppingLine({
  line,
  snapshotVersion,
  readonly,
  pending,
  onAction,
}: {
  line: GroceryLine;
  snapshotVersion: string;
  readonly: boolean;
  pending: boolean;
  onAction(action: GroceryAction): void;
}) {
  const checked = line.checked_at != null;
  const recipes = orderedRecipeAttribution(line);
  const firstRecipe = recipes[0]?.slug;
  const [dismissedSubstitutes, setDismissedSubstitutes] = React.useState<Set<string>>(() => new Set());
  return (
    <li
      data-testid="grocery-line"
      data-key={line.key}
      data-name={line.name}
      data-origin={line.origin}
      data-checked={checked || undefined}
    >
      <label>
        <input
          type="checkbox"
          checked={checked}
          disabled={readonly || pending}
          onChange={(e) =>
            onAction({
              kind: "checked",
              key: line.key,
              checked: e.target.checked,
              expected_row_version: line.row_version,
              snapshot_version: snapshotVersion,
            })
          }
        />
        <span className={checked ? "checked" : ""}>{line.display_name ?? line.name}</span>
        {line.staple ? (
          <span className="grocery-staple" data-testid="grocery-staple">
            Staple
          </span>
        ) : null}
      </label>
      <span>
        {line.quantity}
        {line.assumed_quantity ? " assumed" : ""}
        {line.note ? ` · ${line.note}` : ""}
        {firstRecipe ? (
          <>
            {" "}
            · <a href={`/recipe/${firstRecipe}`}>{firstRecipe}</a>
            {recipes.length > 1 ? ` +${recipes.length - 1}` : ""}
          </>
        ) : (
          ""
        )}
      </span>
      {line.origin !== "plan" ? (
        <Button
          size="sm"
          variant="ghost"
          disabled={readonly || pending}
          onClick={() => onAction({ kind: "remove", key: line.key })}
        >
          Remove
        </Button>
      ) : null}
      {(line.substitutes ?? []).map((candidate) => {
        const c = candidate as {
          id?: string;
          label?: string;
          relation?: { role?: string; via?: string; via_label?: string };
          in_pantry?: boolean;
          on_sale_hint?: { price?: { promo?: number } };
        };
        if (!c.id || !c.label || dismissedSubstitutes.has(c.id)) return null;
        const via = c.relation?.via_label ?? c.relation?.via;
        const relation =
          c.relation?.role === "sibling"
            ? `same family${via ? ` · via ${via}` : ""}`
            : c.relation?.role === "satisfies"
              ? "can stand in"
              : null;
        return (
          <span
            className="grocery-substitute"
            data-testid="grocery-substitute"
            data-substitute-id={c.id}
            key={c.id}
          >
            Try {c.label}? {relation ? <span data-testid="subs-relation">{relation}</span> : null}{" "}
            {c.in_pantry ? <span data-testid="subs-pantry-hit">in your pantry</span> : null}{" "}
            {typeof c.on_sale_hint?.price?.promo === "number" ? (
              <span data-testid="subs-sale-hint">${c.on_sale_hint.price.promo.toFixed(2)} at your store</span>
            ) : null}{" "}
            <Button
              size="sm"
              variant="outline"
              disabled={readonly || pending}
              onClick={() =>
                onAction({
                  kind: "substitute",
                  original_key: line.key,
                  replacement_key: c.id!,
                  replacement_name: c.label!,
                  snapshot_version: snapshotVersion,
                })
              }
            >
              Swap in
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={readonly || pending}
              onClick={() => setDismissedSubstitutes((current) => new Set(current).add(c.id!))}
            >
              Keep original
            </Button>
          </span>
        );
      })}
    </li>
  );
}
