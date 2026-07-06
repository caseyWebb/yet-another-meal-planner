// The Satellite source-audit island (satellite-source-audit): hydrates #satellite-audit-island with
// the interactive liveness + source-health hero. Re-renders the SAME shared `AuditHero` the SSR page
// emitted (one source of truth) with real handlers — the expand-in-place drill-down, the quarantine
// confirm dialog, and the reversible quarantine toggle. Mirrors client/ingest-keys.tsx: the in-flight
// mutation + its target + its failure are ONE discriminated `ActionState`; the update is optimistic
// (revert on failure). Every satellite/source was seeded via the #satellite-audit-props block, so a
// toggle re-renders from data already on the page — no fetch-on-mount.

import { render, useState, useRef, useEffect } from "hono/jsx/dom";
import { hc } from "hono/client";
import type { AdminApp } from "../app.js";
import { AuditHero } from "../pages/satellites.js";
import { assertNever } from "../lib/remote.js";
import { pct, type AuditSatellite, type AuditSource, type QState } from "../satellite-audit-shared.js";
import { BanIcon } from "../ui/icons.js";

const client = hc<AdminApp>(location.origin);

/** The single quarantine note the operator toggle persists (the Worker records no actor). */
const QUARANTINE_NOTE = "quarantined by the operator from the source-health audit";

type Op = { kind: "quarantine"; key: string } | { kind: "unquarantine"; key: string };
type ActionState =
  | { status: "idle" }
  | { status: "busy"; op: Op }
  | { status: "failed"; op: Op; message: string };

/** The source whose row is currently mutating (drives the row's pending state) — exhaustive. */
function busyKeyOf(action: ActionState): string | null {
  switch (action.status) {
    case "idle":
      return null;
    case "failed":
      return null;
    case "busy":
      return action.op.key;
    default:
      return assertNever(action);
  }
}

/** The failure message to surface, if any — exhaustive over the action union. */
function actionError(action: ActionState): string | null {
  switch (action.status) {
    case "idle":
      return null;
    case "busy":
      return null;
    case "failed":
      return action.message;
    default:
      return assertNever(action);
  }
}

function errMessage(body: unknown): string {
  if (body && typeof body === "object" && "message" in body) {
    const m = (body as Record<string, unknown>).message;
    if (typeof m === "string") return m;
  }
  return "Something went wrong.";
}

/** The quarantine confirm modal — a native <dialog> opened by island state (Basecoat CSS-only). */
function ConfirmDialog({ src, busy, onConfirm, onClose }: { src: AuditSource | null; busy: boolean; onConfirm: () => void; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (src && !el.open) el.showModal();
    else if (!src && el.open) el.close();
  }, [src]);
  return (
    <dialog
      ref={ref}
      class="dialog"
      aria-labelledby="satellite-quarantine-title"
      onClose={onClose}
      onClick={(e: Event) => e.target === ref.current && onClose()}
    >
      <header>
        <h2 id="satellite-quarantine-title">{src ? `Quarantine ${src.source}?` : "Quarantine source?"}</h2>
      </header>
      <section>
        <p class="muted small">
          This does <strong>not</strong> stop the satellite; it stops the Worker from accepting this one source — the machine's
          other sources keep flowing. Its observations are rejected until you un-quarantine.
        </p>
        {src ? (
          <p class="ig-confirm-stat">
            <strong>{pct(src.quality.failRate)}</strong> of the last {src.quality.sample} observations failed validation.
          </p>
        ) : null}
        <p class="muted small">
          Reversible in one click. This is a scalpel for one source — the whole-machine revoke lever lives in Config › Ingest keys.
        </p>
      </section>
      <footer class="form-actions">
        <button type="button" class="btn" data-variant="outline" data-size="sm" onClick={onClose}>
          Cancel
        </button>
        <button type="button" class="btn" data-variant="destructive" data-size="sm" disabled={busy} onClick={onConfirm}>
          <BanIcon size={14} /> Quarantine source
        </button>
      </footer>
    </dialog>
  );
}

function SatelliteAuditIsland(initial: { satellites: AuditSatellite[]; contractVersion: string }) {
  const [sats, setSats] = useState<AuditSatellite[]>(initial.satellites);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<AuditSource | null>(null);
  const [action, setAction] = useState<ActionState>({ status: "idle" });
  const now = Date.now();
  const busyKey = busyKeyOf(action);
  const errorMsg = actionError(action);

  /** Patch one source (by key) in the nested satellite list — the optimistic write. */
  function mutateSource(key: string, patch: Partial<AuditSource>): void {
    setSats((prev) =>
      prev.map((s) => ({
        ...s,
        sources: s.sources.map((src) => (src.key === key ? { ...src, ...patch } : src)),
      })),
    );
  }

  async function doQuarantine(src: AuditSource): Promise<void> {
    const snapshot = sats;
    setConfirm(null);
    setAction({ status: "busy", op: { kind: "quarantine", key: src.key } });
    // Optimistic: mark held + reveal the ledger so the new state is visible.
    mutateSource(src.key, { qstate: "quarantined", quarantine: { quarantined_at: now, note: QUARANTINE_NOTE } });
    setOpenKey(src.key);
    const res = await client.admin.api.satellites.quarantine.$post({
      json: { kind: src.kind, source: src.source, tenant: src.tenant, note: QUARANTINE_NOTE },
    });
    if (res.ok) {
      setAction({ status: "idle" });
    } else {
      setSats(snapshot);
      setAction({ status: "failed", op: { kind: "quarantine", key: src.key }, message: errMessage(await res.json()) });
    }
  }

  async function doUnquarantine(src: AuditSource): Promise<void> {
    const snapshot = sats;
    setAction({ status: "busy", op: { kind: "unquarantine", key: src.key } });
    // Optimistic: back to degrading if it would still be recommended, else healthy.
    const nextState: QState = src.quality.recommendQuarantine ? "degrading" : "healthy";
    mutateSource(src.key, { qstate: nextState, quarantine: null });
    const res = await client.admin.api.satellites.quarantine.clear.$post({
      json: { kind: src.kind, source: src.source, tenant: src.tenant },
    });
    if (res.ok) {
      setAction({ status: "idle" });
    } else {
      setSats(snapshot);
      setAction({ status: "failed", op: { kind: "unquarantine", key: src.key }, message: errMessage(await res.json()) });
    }
  }

  return (
    <div>
      {errorMsg ? (
        <div class="alert" data-variant="destructive">
          <section>{errorMsg}</section>
        </div>
      ) : null}
      <AuditHero
        satellites={sats}
        now={now}
        contractVersion={initial.contractVersion}
        openKey={openKey}
        busyKey={busyKey}
        onToggle={(key) => setOpenKey(openKey === key ? null : key)}
        onQuarantine={(src) => setConfirm(src)}
        onUnquarantine={doUnquarantine}
      />
      <ConfirmDialog src={confirm} busy={action.status === "busy"} onConfirm={() => confirm && doQuarantine(confirm)} onClose={() => setConfirm(null)} />
    </div>
  );
}

const host = document.getElementById("satellite-audit-island");
const propsEl = document.getElementById("satellite-audit-props");
if (host && propsEl) {
  const props = JSON.parse(propsEl.textContent ?? "{}") as { satellites: AuditSatellite[]; contractVersion: string };
  host.replaceChildren();
  render(<SatelliteAuditIsland satellites={props.satellites ?? []} contractVersion={props.contractVersion ?? ""} />, host);
}
