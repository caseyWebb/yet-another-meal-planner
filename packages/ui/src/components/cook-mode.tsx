// The guided cook-mode step machine (recipe-card-cook-mode, D32/D20): the presentational half of
// the Recipe Card, shared verbatim by the member recipe page and the in-chat widget. It walks the
// structured `CookData` — mise-en-place check-off → per-step navigation with a progress bar and
// per-step timers → the "Plated up" done screen — ported from the design mockup's cook mode. It
// holds only ephemeral client state (phase, check-offs, the running timer); persistence and the
// completion hand-off are the host's `useCookController`, not this component (D32: the step machine
// is presentational — no writes). Step prose is rendered through `interpolateIngredientRefs`, so an
// `{id}` token surfaces the ingredient's amount as a hover tooltip.
import * as React from "react";
import { cookKeyMap, interpolateIngredientRefs, type CookData } from "../cook-parse";

export interface CookModeProps {
  cook: CookData;
  title: string;
  /** Show a mise-en-place check-off phase before step 1 (default true). */
  miseEnPlace?: boolean;
  /** Render per-step timers when a step declares `timer_seconds` (default true). */
  showTimers?: boolean;
  /** Leave cook mode — the "Back to Recipe Card" / "Back to recipes" affordance. */
  onExit(): void;
  /** Fired once when the walk reaches the "Plated up" done screen (the completion hand-off). */
  onComplete?(): void;
}

/** mm:ss for a countdown. */
function fmt(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Group the mise ingredients by their authored `group` (order-preserving; ungrouped lines share
 *  one headerless bucket) — the mockup's location grouping without the painted-door heuristic (D5). */
function miseGroups(cook: CookData): { label: string | null; items: CookData["ingredients"] }[] {
  const order: (string | null)[] = [];
  const byGroup = new Map<string | null, CookData["ingredients"]>();
  for (const ing of cook.ingredients) {
    const key = ing.group ?? null;
    if (!byGroup.has(key)) {
      byGroup.set(key, []);
      order.push(key);
    }
    byGroup.get(key)!.push(ing);
  }
  return order.map((label) => ({ label, items: byGroup.get(label)! }));
}

export function CookMode({ cook, title, miseEnPlace = true, showTimers = true, onExit, onComplete }: CookModeProps) {
  const total = cook.steps.length;
  const keyMap = React.useMemo(() => cookKeyMap(cook), [cook]);

  const [step, setStep] = React.useState<number>(miseEnPlace ? -1 : 0);
  const [checked, setChecked] = React.useState<Record<string, boolean>>({});
  const [remaining, setRemaining] = React.useState<number | null>(null);
  const [running, setRunning] = React.useState(false);
  const completedRef = React.useRef(false);

  const atMise = miseEnPlace && step < 0;
  const atStep = step >= 0 && step < total;
  const atDone = step >= total && total > 0;

  const curTimer = atStep ? cook.steps[step].timer_seconds ?? null : null;

  // The countdown tick — a single interval driven by `running`, torn down on pause/unmount/step change.
  React.useEffect(() => {
    if (!running) return;
    const iv = setInterval(() => {
      setRemaining((r) => {
        if (r == null) return r;
        if (r <= 1) {
          setRunning(false);
          return 0;
        }
        return r - 1;
      });
    }, 1000);
    return () => clearInterval(iv);
  }, [running]);

  function gotoStep(next: number) {
    const armed = next >= 0 && next < total ? cook.steps[next].timer_seconds ?? null : null;
    setRunning(false);
    setRemaining(armed);
    setStep(next);
  }

  function nextStep() {
    if (step < total - 1) {
      gotoStep(step + 1);
    } else {
      setRunning(false);
      setStep(total);
      if (!completedRef.current) {
        completedRef.current = true;
        onComplete?.();
      }
    }
  }

  function prevStep() {
    if (step <= 0) {
      if (miseEnPlace) {
        setRunning(false);
        setRemaining(null);
        setStep(-1);
      }
    } else {
      gotoStep(step - 1);
    }
  }

  function startCooking() {
    gotoStep(0);
  }

  function cookAgain() {
    completedRef.current = false;
    setChecked({});
    setRunning(false);
    setRemaining(null);
    setStep(miseEnPlace ? -1 : 0);
  }

  function toggleTimer() {
    if (running) {
      setRunning(false);
      return;
    }
    if (!curTimer) return;
    if (remaining == null || remaining <= 0) setRemaining(curTimer);
    setRunning(true);
  }

  function resetTimer() {
    setRunning(false);
    setRemaining(curTimer);
  }

  const phaseLabel = atMise ? "Mise en place" : atDone ? "Complete" : `Step ${step + 1} of ${total}`;
  const frac = atMise ? 0.05 : atDone ? 1 : total ? (step + 1) / total : 0;

  const checkedCount = cook.ingredients.filter((i) => checked[i.id]).length;
  const showTimer = atStep && showTimers && !!curTimer;
  const displayRemaining = remaining != null ? remaining : curTimer ?? 0;
  const timerDone = showTimer && displayRemaining <= 0;
  const ringCirc = 2 * Math.PI * 53;
  const ringFrac = curTimer ? Math.max(0, Math.min(1, displayRemaining / curTimer)) : 0;

  return (
    <div className="cook-mode" data-widget="cook-mode" data-phase={atMise ? "mise" : atDone ? "done" : "step"}>
      <div className="cook-head">
        <div className="cook-head-main">
          <span className="cook-phase-label">{phaseLabel}</span>
          <div className="cook-title" title={title}>
            {title}
          </div>
        </div>
        <button type="button" className="cook-exit" data-testid="cook-exit" onClick={onExit}>
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M19 12H5M11 18l-6-6 6-6" />
          </svg>
          Back to Recipe Card
        </button>
      </div>

      <div className="cook-progress">
        <div className="cook-progress-bar" style={{ width: `${frac * 100}%` }} data-testid="cook-progress" />
      </div>

      <div className="cook-body">
        {atMise ? (
          <div data-testid="cook-mise">
            <div className="cook-mise-intro">
              <h2>Mise en place</h2>
              <p>Gather and prep everything before the heat goes on. Tap each item as it's ready.</p>
            </div>
            <div className="cook-mise-groups">
              {miseGroups(cook).map((grp, gi) => (
                <div className="cook-group" key={grp.label ?? `g${gi}`}>
                  {grp.label ? <div className="cook-group-head">{grp.label}</div> : null}
                  <div className="cook-check-list">
                    {grp.items.map((ing) => {
                      const on = !!checked[ing.id];
                      return (
                        <button
                          type="button"
                          key={ing.id}
                          className={`cook-check${on ? " on" : ""}`}
                          data-testid="cook-check"
                          aria-pressed={on}
                          onClick={() => setChecked((c) => ({ ...c, [ing.id]: !c[ing.id] }))}
                        >
                          <span className="cook-check-box" aria-hidden="true">
                            {on ? (
                              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M20 6 9 17l-5-5" />
                              </svg>
                            ) : null}
                          </span>
                          <span className="cook-check-text">{ing.text}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
            <div className="cook-mise-footer">
              <span className="cook-count" data-testid="cook-mise-count">
                {checkedCount} / {cook.ingredients.length} ready
              </span>
              <button type="button" className="cook-primary" data-testid="cook-start" onClick={startCooking}>
                Start cooking
                <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M5 12h14M13 6l6 6-6 6" />
                </svg>
              </button>
            </div>
          </div>
        ) : null}

        {atStep ? (
          <div data-testid="cook-step">
            {cook.steps[step].title ? <div className="cook-step-title">{cook.steps[step].title}</div> : null}
            <p
              className="cook-step-body"
              data-testid="cook-step-body"
              dangerouslySetInnerHTML={{ __html: interpolateIngredientRefs(cook.steps[step].content, keyMap) }}
            />

            {showTimer ? (
              <div className="cook-timer" data-testid="cook-timer">
                <div className="cook-timer-ring">
                  <svg width="172" height="172" viewBox="0 0 120 120" aria-hidden="true">
                    <circle cx="60" cy="60" r="53" fill="none" stroke="var(--muted)" strokeWidth="6" />
                    <circle
                      cx="60"
                      cy="60"
                      r="53"
                      fill="none"
                      stroke="var(--primary)"
                      strokeWidth="6"
                      strokeLinecap="round"
                      style={{
                        strokeDasharray: ringCirc.toFixed(1),
                        strokeDashoffset: (ringCirc * (1 - ringFrac)).toFixed(1),
                        transition: "stroke-dashoffset 1s linear",
                      }}
                    />
                  </svg>
                  <div className="cook-timer-inner">
                    <span className={`cook-timer-display${timerDone ? " done" : ""}`} data-testid="cook-timer-display">
                      {fmt(displayRemaining)}
                    </span>
                    <span className={`cook-timer-label${timerDone ? " done" : ""}`}>
                      {timerDone ? "Time's up" : running ? "Counting down" : "Ready"}
                    </span>
                  </div>
                </div>
                <div className="cook-timer-controls">
                  <button type="button" className="cook-timer-btn" data-testid="cook-timer-toggle" onClick={toggleTimer}>
                    {running ? (
                      <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true">
                        <rect x="6" y="5" width="4" height="14" rx="1" />
                        <rect x="14" y="5" width="4" height="14" rx="1" />
                      </svg>
                    ) : (
                      <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true">
                        <path d="M6 4.5v15a1 1 0 0 0 1.53.85l12-7.5a1 1 0 0 0 0-1.7l-12-7.5A1 1 0 0 0 6 4.5Z" />
                      </svg>
                    )}
                    {running ? "Pause" : displayRemaining <= 0 ? "Restart" : "Start"}
                  </button>
                  <button type="button" className="cook-timer-reset" onClick={resetTimer}>
                    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M3 12a9 9 0 1 0 9-9 9 9 0 0 0-6.36 2.64L3 8" />
                      <path d="M3 3v5h5" />
                    </svg>
                    Reset
                  </button>
                </div>
              </div>
            ) : null}

            <div className="cook-nav">
              <button
                type="button"
                className="cook-back"
                data-testid="cook-back"
                disabled={!(step > 0 || miseEnPlace)}
                onClick={prevStep}
              >
                <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M19 12H5M11 18l-6-6 6-6" />
                </svg>
                Back
              </button>
              <button type="button" className="cook-next" data-testid="cook-next" onClick={nextStep}>
                {step >= total - 1 ? "Finish" : "Next"}
                <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M5 12h14M13 6l6 6-6 6" />
                </svg>
              </button>
            </div>
          </div>
        ) : null}

        {atDone ? (
          <div className="cook-done" data-testid="cook-done">
            <div className="cook-done-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 6 9 17l-5-5" />
              </svg>
            </div>
            <h2>Plated up</h2>
            <p>You cooked {title}. Nicely done.</p>
            <div className="cook-done-actions">
              <button type="button" className="cook-secondary" data-testid="cook-again" onClick={cookAgain}>
                Cook again
              </button>
              <button type="button" className="cook-primary" data-testid="cook-finish" onClick={onExit}>
                Back to recipes
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
