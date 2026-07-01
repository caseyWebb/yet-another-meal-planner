// The Normalization area island (operator-admin): hydrates #normalize-island with the mutations
// on the identity-graph audit surface — Override / Re-queue / Delete-decision on the Decisions
// tab, and Add / Delete on the Aliases tab (everything else is pure SSR, admin/CLAUDE.md rule 8).
// The shared NormalizeView renders both SSR (first paint) and here (so the markup is one source
// of truth); mutations call the typed /admin/api/normalization/* routes and reload on success so
// the stat tiles + counts — derived from the same read — reflect immediately (matching the
// Discovery island's reload-on-success behavior).
//
// The one in-flight mutation + its target + its failure are ONE ActionState union (rule 3), so
// "which op", "which target", and "the error" cannot contradict.

import { render, useState } from "hono/jsx/dom";
import { hc } from "hono/client";
import type { AdminApp } from "../app.js";
import type { NormalizationPage } from "../../normalize-admin.js";
import { NormalizeView, parseQuery } from "../pages/normalize.js";

const client = hc<AdminApp>(location.origin);

type Op =
  | { kind: "override"; term: string }
  | { kind: "requeue"; term: string }
  | { kind: "delete-decision"; id: string }
  | { kind: "alias-add" }
  | { kind: "alias-delete"; variant: string };

type ActionState = { status: "idle" } | { status: "busy"; op: Op } | { status: "failed"; op: Op; message: string };

async function readError(res: { status: number; json: () => Promise<unknown> }): Promise<string> {
  try {
    const body = await res.json();
    if (body && typeof body === "object" && "message" in body) {
      const m = (body as Record<string, unknown>).message;
      if (typeof m === "string") return m;
    }
  } catch {
    /* fall through */
  }
  return `HTTP ${res.status}`;
}

function dialog(id: string): HTMLDialogElement | null {
  return document.getElementById(id) as HTMLDialogElement | null;
}

function NormalizeIsland({ data }: { data: NormalizationPage }) {
  const [action, setAction] = useState<ActionState>({ status: "idle" });
  const query = parseQuery(new URL(location.href));

  async function run(op: Op, call: () => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>): Promise<void> {
    if (action.status === "busy") return;
    setAction({ status: "busy", op });
    const res = await call();
    if (res.ok) location.reload();
    else setAction({ status: "failed", op, message: await readError(res) });
  }

  function saveAlias(variant: string, canonicalId: string, op: Op): void {
    if (!variant.trim() || !canonicalId.trim()) return;
    void run(op, () => client.admin.api.normalization.alias.$post({ json: { variant: variant.trim(), canonicalId: canonicalId.trim() } }));
  }

  function onClick(e: Event): void {
    const el = (e.target as HTMLElement | null)?.closest<HTMLElement>("[data-action]");
    if (!el) return;
    const act = el.getAttribute("data-action");

    if (act === "dialog-cancel") {
      e.preventDefault();
      (el.closest("dialog") as HTMLDialogElement | null)?.close();
      return;
    }
    if (act === "override") {
      e.preventDefault();
      const term = el.getAttribute("data-term") ?? "";
      const dlg = dialog("nz-override");
      if (!dlg) return;
      dlg.setAttribute("data-term", term);
      const slot = dlg.querySelector<HTMLElement>('[data-slot="term"]');
      if (slot) slot.textContent = term;
      const input = dlg.querySelector<HTMLInputElement>('input[name="canonicalId"]');
      if (input) input.value = "";
      dlg.showModal();
      return;
    }
    if (act === "alias-add") {
      e.preventDefault();
      const dlg = dialog("nz-add");
      if (!dlg) return;
      dlg.querySelectorAll<HTMLInputElement>("input").forEach((i) => (i.value = ""));
      dlg.showModal();
      return;
    }
    if (act === "requeue") {
      e.preventDefault();
      const term = el.getAttribute("data-term") ?? "";
      void run({ kind: "requeue", term }, () => client.admin.api.normalization.requeue.$post({ json: { term } }));
      return;
    }
    if (act === "delete-decision") {
      e.preventDefault();
      const id = el.getAttribute("data-id") ?? "";
      void run({ kind: "delete-decision", id }, () => client.admin.api.normalization.decision[":id"].$delete({ param: { id } }));
      return;
    }
    if (act === "alias-delete") {
      e.preventDefault();
      const variant = el.getAttribute("data-variant") ?? "";
      void run({ kind: "alias-delete", variant }, () => client.admin.api.normalization.alias[":variant"].$delete({ param: { variant } }));
      return;
    }
  }

  function onSubmit(e: Event): void {
    const form = e.target as HTMLFormElement | null;
    if (!form || !form.hasAttribute("data-form")) return;
    e.preventDefault();
    const which = form.getAttribute("data-form");
    const canonicalId = form.querySelector<HTMLInputElement>('input[name="canonicalId"]')?.value ?? "";
    if (which === "override") {
      const term = dialog("nz-override")?.getAttribute("data-term") ?? "";
      dialog("nz-override")?.close();
      saveAlias(term, canonicalId, { kind: "override", term });
    } else if (which === "add") {
      const variant = form.querySelector<HTMLInputElement>('input[name="variant"]')?.value ?? "";
      dialog("nz-add")?.close();
      saveAlias(variant, canonicalId, { kind: "alias-add" });
    }
  }

  const busy = action.status === "busy";
  return (
    <div onClick={onClick} onSubmit={onSubmit}>
      {action.status === "failed" ? (
        <div class="alert" data-variant="destructive">
          <section>Action failed: {action.message}</section>
        </div>
      ) : null}
      <NormalizeView data={data} query={query} now={Date.now()} />
      {busy ? <p class="muted small">Working…</p> : null}
    </div>
  );
}

const host = document.getElementById("normalize-island");
const propsEl = document.getElementById("normalize-props");
if (host && propsEl) {
  const props = JSON.parse(propsEl.textContent ?? "{}") as { data: NormalizationPage };
  host.replaceChildren();
  render(<NormalizeIsland data={props.data} />, host);
}
