// The shared cook-mode write controller (recipe-card-cook-mode, D18/D19/D20): the ONE brain behind
// the Recipe Card's two write paths — the member recipe page and the in-chat recipe-card widget —
// so the favorite/log/completion writes behave identically on both hosts. Cook mode's step machine
// (browse/mise/step/done, check-offs, timers) is presentational and lives in `<CookMode>`; THIS
// controller owns only the persistent writes the card carries: the favorite toggle, the log-cooked
// popover, and the completion hand-off.
//
// D18 channel discipline (realised in `createCookBridgeAdapter`, orchestrated here):
//   • favorite tap   → adapter.setFavorite (callServerTool) AND, once the write lands, a FULL
//     current-state snapshot to the host model (syncContext / ui/update-model-context) — never a
//     ui/message.
//   • log cooked     → adapter.logCooked (callServerTool) AND syncContext AND announce (ui/message).
//   • completion     → announce (ui/message) only — no write, no context.
// The worker tools are THROW-FREE (errors.ts `fail()` RESOLVES `{ isError: true }`), so the adapter
// treats a resolved `isError` as a failure exactly like a rejection; a write that did not land
// pushes no context and no message, and the optimistic favorite rolls back. Rapid favorite taps are
// seq-guarded (latest wins). The member host wires the adapter over its existing RQ mutations with
// syncContext/announce as no-ops; the widget host wires it over the ext-apps bridge.
import * as React from "react";
import type { BridgeToolResult } from "./propose-controller";

/** The meals a cook can be logged against (mirrors `log_cooked`'s `meal` enum). */
export type CookMeal = "breakfast" | "lunch" | "dinner" | "project";

/** The full current-state snapshot pushed to the host model on a write (D18 — never a delta). */
export interface CookContextSnapshot {
  slug: string;
  title: string;
  favorite: boolean;
}

// ── the host adapter ───────────────────────────────────────────────────────────────────

export interface CookHostAdapter {
  capabilities: {
    /** The favorite/log write controls are live (host can perform the backend write). */
    canWrite: boolean;
    /** The host accepts `ui/update-model-context`. */
    canSyncContext: boolean;
    /** `message` = the host accepts `ui/message`; `none` = completion/log announce is suppressed. */
    messageMode: "message" | "none";
  };
  /** Perform the favorite write. Returns true only when the durable write LANDED (a rejection or a
   *  throw-free `isError` both return false). The controller owns the context push. */
  setFavorite(slug: string, favorite: boolean): Promise<boolean>;
  /** Perform the log-cooked write. Returns true only when it landed. */
  logCooked(args: { slug: string; date: string; meal?: CookMeal }): Promise<boolean>;
  /** Push a full-state snapshot to the host model (D18). Widget → ui/update-model-context; member → no-op. */
  syncContext?(snapshot: CookContextSnapshot): void | Promise<void>;
  /** Announce a model turn (D18 ui/message) at a log or completion boundary. Widget → sendMessage;
   *  member → no-op. */
  announce?(text: string): void | Promise<void>;
}

// ── the capability ladder + contract-version gate (D18/D19) ──────────────────────────────

export interface CookCapabilityInputs {
  /** The payload's `contract_version` (`undefined` reads as 1). */
  contractVersion?: number;
  /** This build's `KNOWN_RECIPE_CONTRACT_VERSION`. */
  knownVersion: number;
  /** Host advertises `serverTools` (can proxy tool calls). */
  hostServerTools: boolean;
  /** Host accepts `ui/update-model-context`. */
  hostUpdateModelContext: boolean;
  /** Host accepts `ui/message`. */
  hostMessage: boolean;
}

export interface CookCapabilities {
  /** An unknown-newer `contract_version`: degrade to the plain read-only card (no cook entry, no
   *  writes) rather than mis-parsing a newer shape (D19). Cook mode is otherwise presentational and
   *  available on any known payload — the client body-parse makes every card cook-capable. */
  readOnly: boolean;
  canWrite: boolean;
  canSyncContext: boolean;
  messageMode: "message" | "none";
}

/** Resolve the widget's cook capabilities (D18 ladder + D19 version gate). A payload whose
 *  `contract_version` exceeds this build's known version degrades to the plain read-only card. */
export function resolveCookCapabilities(i: CookCapabilityInputs): CookCapabilities {
  const known = (i.contractVersion ?? 1) <= i.knownVersion;
  if (!known) {
    return { readOnly: true, canWrite: false, canSyncContext: false, messageMode: "none" };
  }
  return {
    readOnly: false,
    canWrite: i.hostServerTools,
    canSyncContext: i.hostUpdateModelContext,
    messageMode: i.hostMessage ? "message" : "none",
  };
}

// ── the ext-apps bridge adapter (the D18 realisation) ────────────────────────────────────

/** The minimal ext-apps `App` surface the cook bridge uses (structurally satisfied by `App`). */
export interface CookBridge {
  callServerTool(params: { name: string; arguments: Record<string, unknown> }): Promise<BridgeToolResult>;
  updateModelContext(params: { content?: unknown[]; structuredContent?: Record<string, unknown> }): Promise<unknown>;
  sendMessage(params: { role: "user"; content: { type: "text"; text: string }[] }): Promise<unknown>;
}

/**
 * Build a `CookHostAdapter` over an ext-apps bridge. Each write is a PURE backend call returning a
 * landed/not-landed boolean; the controller owns the context push and the announce, so the D18
 * pairing (write AND context, plus message for log/completion) is orchestrated controller-side. The
 * worker tools resolve failures as `{ isError: true }`, so `isError` is a failure just as much as a
 * rejection — a write that did not land returns false, and the controller pushes nothing.
 */
export function createCookBridgeAdapter(bridge: CookBridge, opts: { capabilities: CookCapabilities }): CookHostAdapter {
  const caps = opts.capabilities;
  return {
    capabilities: { canWrite: caps.canWrite, canSyncContext: caps.canSyncContext, messageMode: caps.messageMode },
    async setFavorite(slug, favorite) {
      if (!caps.canWrite) return false;
      let res: BridgeToolResult;
      try {
        res = await bridge.callServerTool({ name: "toggle_favorite", arguments: { slug, favorite } });
      } catch {
        return false;
      }
      return !res.isError;
    },
    async logCooked({ slug, date, meal }) {
      if (!caps.canWrite) return false;
      let res: BridgeToolResult;
      try {
        res = await bridge.callServerTool({
          name: "log_cooked",
          arguments: { type: "recipe", recipe: slug, date, ...(meal ? { meal } : {}) },
        });
      } catch {
        return false;
      }
      return !res.isError;
    },
    async syncContext(snapshot) {
      if (!caps.canSyncContext) return;
      // Best-effort after a durable write (D18) — never let a context-push failure reject the interaction.
      await bridge.updateModelContext({ structuredContent: snapshot as unknown as Record<string, unknown> }).catch(() => {});
    },
    async announce(text) {
      if (caps.messageMode !== "message") return;
      await bridge.sendMessage({ role: "user", content: [{ type: "text", text }] }).catch(() => {});
    },
  };
}

/** Parse a `read_recipe` result's overlay-merged `favorite` for the widget's boot re-hydrate (D19).
 *  Returns null when the read failed (a rejection or a throw-free `isError`) so the caller degrades
 *  to a read-only render rather than trusting the stale spawning payload. */
export function parseReadRecipeFavorite(res: BridgeToolResult): boolean | null {
  if (res.isError) return null;
  const sc = res.structuredContent as { frontmatter?: { favorite?: unknown } } | undefined;
  if (sc && sc.frontmatter && typeof sc.frontmatter === "object") return Boolean(sc.frontmatter.favorite);
  const text = res.content?.find((c) => c.type === "text")?.text;
  if (text) {
    try {
      const parsed = JSON.parse(text) as { frontmatter?: { favorite?: unknown } };
      if (parsed && parsed.frontmatter && typeof parsed.frontmatter === "object") return Boolean(parsed.frontmatter.favorite);
    } catch {
      return null;
    }
  }
  return null;
}

// ── the controller hook ──────────────────────────────────────────────────────────────────

const DEFAULT_LOG_MESSAGE = (title: string, date: string) => `I logged ${title} as cooked on ${date}.`;
const DEFAULT_COMPLETION_MESSAGE = (title: string) => `I finished cooking ${title}.`;

export interface UseCookControllerOptions {
  adapter: CookHostAdapter;
  slug: string;
  title: string;
  /** The favorite state at first render (member: the live overlay; widget: the boot re-hydrate). */
  initialFavorite: boolean;
  logMessage?: (title: string, date: string) => string;
  completionMessage?: (title: string) => string;
}

export interface CookController {
  favorite: boolean;
  busy: boolean;
  canWrite: boolean;
  /** Explicit favorite set (never a raw toggle) — optimistic, seq-guarded, rolled back on a failed write. */
  setFavorite(next: boolean): Promise<void>;
  /** Log this recipe as cooked on `date` (local-calendar YYYY-MM-DD). Returns whether the write landed. */
  logCooked(args: { date: string; meal?: CookMeal }): Promise<boolean>;
  /** The completion hand-off ("Plated up") — announces the finished cook (ui/message only). */
  finishCooking(): Promise<void>;
}

export function useCookController(opts: UseCookControllerOptions): CookController {
  const { adapter, slug, title } = opts;
  const [favorite, setFav] = React.useState(opts.initialFavorite);
  const [busy, setBusy] = React.useState(false);
  // Latest-wins guard for rapid favorite taps: a slower earlier reply can neither flip the icon nor
  // push a stale value to the host model (D18 full-state-snapshot invariant).
  const favSeqRef = React.useRef(0);
  const favoriteRef = React.useRef(favorite);
  favoriteRef.current = favorite;

  const snapshot = (fav: boolean): CookContextSnapshot => ({ slug, title, favorite: fav });

  const setFavorite = React.useCallback(
    async (next: boolean) => {
      const seq = ++favSeqRef.current;
      const prev = favoriteRef.current;
      // Optimistic flip — the heart responds instantly; a failed write rolls it back.
      setFav(next);
      favoriteRef.current = next;
      const landed = await adapter.setFavorite(slug, next);
      if (seq !== favSeqRef.current) return; // superseded by a newer tap — its own reply is authoritative
      if (!landed) {
        // A rejection OR a throw-free `isError`: roll back and push NO context (never announce a favorite).
        setFav(prev);
        favoriteRef.current = prev;
        return;
      }
      // Durable write landed — the context push is best-effort (D18) and never rejects.
      if (adapter.syncContext) await adapter.syncContext(snapshot(next));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [adapter, slug, title],
  );

  const logCooked = React.useCallback(
    async ({ date, meal }: { date: string; meal?: CookMeal }) => {
      setBusy(true);
      try {
        const landed = await adapter.logCooked({ slug, date, meal });
        if (!landed) return false;
        // Best-effort tail after the durable write (D18): context, then the provenance message.
        if (adapter.syncContext) await adapter.syncContext(snapshot(favoriteRef.current));
        if (adapter.announce) await adapter.announce((opts.logMessage ?? DEFAULT_LOG_MESSAGE)(title, date));
        return true;
      } finally {
        setBusy(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [adapter, slug, title],
  );

  const finishCooking = React.useCallback(
    async () => {
      if (adapter.announce) await adapter.announce((opts.completionMessage ?? DEFAULT_COMPLETION_MESSAGE)(title));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [adapter, title],
  );

  return { favorite, busy, canWrite: adapter.capabilities.canWrite, setFavorite, logCooked, finishCooking };
}
