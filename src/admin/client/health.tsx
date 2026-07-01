// The global health-dock island (operator-admin): hydrates the shell-injected #health-dock pill
// (see ui/health-dock.tsx) into an expand/collapse control. Seeded from the page's JSON props —
// never a fetch-on-mount; the shell already built the rollup server-side. Open/closed is one
// boolean of island state (the only interactivity), so read-only pages still ship no other JS.

import { render, useState } from "hono/jsx/dom";
import type { HealthRollup, HealthDep } from "../shared.js";

function Dep({ dep }: { dep: HealthDep }) {
  return (
    <div class="hp-dep">
      <span class={`dot ${dep.state}`} />
      <span class="hp-dep-name">{dep.name}</span>
      <span class={`status-word ${dep.state}`}>{dep.word}</span>
    </div>
  );
}

function HealthDockIsland(initial: HealthRollup) {
  const [open, setOpen] = useState(false);
  const cls = initial.ok ? "ok" : "fail";
  const word = initial.ok ? "Healthy" : "Degraded";
  const failing = initial.failingJobs;

  return (
    <>
      {open ? (
        <div class="health-pop" role="dialog" aria-label="Service health">
          <div class="hp-head">
            <span class={`pulse-dot ${cls}`} />
            <span class={`status-word ${cls}`}>{word}</span>
          </div>
          {failing.length > 0 ? (
            <ul class="hp-fail-list">
              {failing.map((name) => (
                <li>
                  <span class="dot fail" />
                  <span class="hp-fail-name">{name}</span>
                  <span class="muted small">failing</span>
                </li>
              ))}
            </ul>
          ) : (
            <p class="muted small" style="margin: .6rem 0 0">All background jobs healthy.</p>
          )}
          <div class="hp-deps">
            {initial.deps.map((dep) => (
              <Dep dep={dep} />
            ))}
          </div>
          <a href="/admin" class="btn hp-link" data-variant="outline" data-size="sm">
            View status
          </a>
        </div>
      ) : null}
      <button
        class={`health-pill ${cls}`}
        type="button"
        aria-expanded={open}
        aria-label={`Service health: ${word}`}
        onClick={() => setOpen(!open)}
      >
        <span class={`pulse-dot ${cls}`} />
        <span class={`status-word ${cls}`}>{word}</span>
        {!initial.ok && failing.length > 0 ? <span class="hp-count">{failing.length}</span> : null}
        <span class={`hp-caret ${open ? "up" : ""}`} aria-hidden="true">
          ▾
        </span>
      </button>
    </>
  );
}

const host = document.getElementById("health-dock");
const propsEl = document.getElementById("health-props");
if (host && propsEl) {
  const rollup = JSON.parse(propsEl.textContent ?? "{}") as HealthRollup;
  host.replaceChildren();
  render(<HealthDockIsland ok={rollup.ok} failingJobs={rollup.failingJobs} deps={rollup.deps} />, host);
}
