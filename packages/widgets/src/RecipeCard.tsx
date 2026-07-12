// The dual-use recipe card widget (recipe-card-widget, D18/D19/D20/D32). Hydrated from the
// `display_recipe` tool's `structuredContent` (RecipeCardData), it reproduces the member app's
// recipe-detail surface AND carries guided cook mode plus the two persistent writes the card owns —
// `toggle_favorite` and `log_cooked` — through the D18 three-channel bridge protocol.
//
// It is a WRITING widget (D32 supersedes the old read-only stance): cook mode's step machine is the
// shared presentational `<CookMode>` (browse → mise → step → done), and the favorite/log controls
// drive the shared `useCookController` over `createCookBridgeAdapter`. The capability posture is
// FROZEN at first render (D18 ladder + D19 version gate); an unknown-newer `contract_version`
// degrades to the plain read-only card with no cook entry. Before enabling writes the widget
// re-hydrates the favorite via `read_recipe` (D19: the spawning payload is render-only); a failed
// re-hydrate keeps cook mode but disables writes. The structured `cook` block is preferred when the
// skill supplies it; otherwise `parseCookBody(body)` derives it client-side so every card is
// cook-capable.
import * as React from "react";
import type { App } from "@modelcontextprotocol/ext-apps";
import { KNOWN_RECIPE_CONTRACT_VERSION, type RecipeCardData } from "@yamp/contract";
import {
  Card,
  CardContent,
  CardHeader,
  CookMode,
  FacetChip,
  IconCalendar,
  IconCheck,
  IconClock,
  IconHeart,
  IconHeartFill,
  RecipeFacets,
  createCookBridgeAdapter,
  localDay,
  parseCookBody,
  parseReadRecipeFavorite,
  resolveCookCapabilities,
  useCookController,
  type CookBridge,
} from "@yamp/ui";
import { mdToHtml } from "./md";

export function RecipeCard({ app, recipe }: { app: App; recipe: RecipeCardData }) {
  // FROZEN at first render (like ProposeCard): the host re-renders the same instance on each
  // `ontoolresult`, so freezing the ladder/version gate keeps writes consistent with the first paint.
  const [caps] = React.useState(() => {
    const host = app.getHostCapabilities();
    return resolveCookCapabilities({
      contractVersion: recipe.contract_version,
      knownVersion: KNOWN_RECIPE_CONTRACT_VERSION,
      hostServerTools: host?.serverTools != null,
      hostUpdateModelContext: host?.updateModelContext != null,
      hostMessage: host?.message != null,
    });
  });

  // Boot re-hydrate (D19): the spawning payload's `favorite` is render-only, so re-read it before
  // enabling writes. `pending` shows the plain card; a failed re-hydrate resolves `canWrite:false`
  // (cook mode stays, writes are gated off).
  type Boot = { status: "pending" } | { status: "ready"; favorite: boolean; canWrite: boolean };
  const [boot, setBoot] = React.useState<Boot>(() =>
    caps.canWrite ? { status: "pending" } : { status: "ready", favorite: recipe.favorite ?? false, canWrite: false },
  );

  React.useEffect(() => {
    if (!caps.canWrite) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await (app as unknown as CookBridge).callServerTool({
          name: "read_recipe",
          arguments: { slug: recipe.slug },
        });
        const fav = parseReadRecipeFavorite(res);
        if (cancelled) return;
        if (fav == null) setBoot({ status: "ready", favorite: recipe.favorite ?? false, canWrite: false });
        else setBoot({ status: "ready", favorite: fav, canWrite: true });
      } catch {
        if (!cancelled) setBoot({ status: "ready", favorite: recipe.favorite ?? false, canWrite: false });
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Unknown-newer payload → degrade to the plain read-only card (no cook entry, no writes).
  if (caps.readOnly) return <PlainRecipeCard recipe={recipe} />;
  // Re-hydrating: render read-only until the favorite lands, then arm the writing card.
  if (boot.status === "pending") return <PlainRecipeCard recipe={recipe} />;

  return (
    <CookableCard
      app={app}
      recipe={recipe}
      canWrite={boot.canWrite}
      canSyncContext={caps.canSyncContext}
      messageMode={caps.messageMode}
      initialFavorite={boot.favorite}
    />
  );
}

/** The armed card: cook mode + the favorite/log write controls over the shared controller. */
function CookableCard({
  app,
  recipe,
  canWrite,
  canSyncContext,
  messageMode,
  initialFavorite,
}: {
  app: App;
  recipe: RecipeCardData;
  canWrite: boolean;
  canSyncContext: boolean;
  messageMode: "message" | "none";
  initialFavorite: boolean;
}) {
  const [adapter] = React.useState(() =>
    createCookBridgeAdapter(app as unknown as CookBridge, {
      capabilities: { readOnly: false, canWrite, canSyncContext, messageMode },
    }),
  );
  const [cook] = React.useState(() => recipe.cook ?? parseCookBody(recipe.body));
  const controller = useCookController({
    adapter,
    slug: recipe.slug,
    title: recipe.title,
    initialFavorite,
  });

  const [cooking, setCooking] = React.useState(false);
  const canCook = cook.steps.length > 0;

  // Painted-door voice hand-off (D5/Q3): a ui/message asking the agent to walk the cook aloud — no
  // native voice engine. Only offered when the host accepts messages.
  const onVoice =
    messageMode === "message"
      ? () =>
          void (app as unknown as CookBridge)
            .sendMessage({ role: "user", content: [{ type: "text", text: `Walk me through cooking ${recipe.title}.` }] })
            .catch(() => {})
      : undefined;

  if (cooking && canCook) {
    return (
      <div className="recipe-card-widget" data-widget="recipe-card" data-mode="cook">
        <CookMode
          cook={cook}
          title={recipe.title}
          onExit={() => setCooking(false)}
          onComplete={() => void controller.finishCooking()}
        />
      </div>
    );
  }

  return (
    <PlainRecipeCard
      recipe={recipe}
      fav={
        canWrite ? (
          <button
            type="button"
            className={`cook-fav${controller.favorite ? " on" : ""}`}
            data-testid="recipe-fav"
            aria-pressed={controller.favorite}
            title={controller.favorite ? "Unfavorite" : "Favorite"}
            onClick={() => void controller.setFavorite(!controller.favorite)}
          >
            {controller.favorite ? <IconHeartFill /> : <IconHeart />}
          </button>
        ) : null
      }
      entry={
        canCook ? (
          <CookEntry
            onStart={() => setCooking(true)}
            onVoice={onVoice}
            log={canWrite ? { busy: controller.busy, onLog: (date) => controller.logCooked({ date }) } : undefined}
          />
        ) : null
      }
    />
  );
}

/** The cook-entry control row (browse view): the split Start Cooking button + menu, and — when the
 *  host can write — the log-cooked popover. The favorite heart is rendered by the header. */
function CookEntry({
  onStart,
  onVoice,
  log,
}: {
  onStart(): void;
  onVoice?: () => void;
  log?: { busy: boolean; onLog(date: string): Promise<boolean> };
}) {
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [logOpen, setLogOpen] = React.useState(false);
  const [date, setDate] = React.useState(() => localDay(new Date()));
  const [loggedOn, setLoggedOn] = React.useState<string | null>(null);
  const today = localDay(new Date());

  async function doLog() {
    if (!log) return;
    const ok = await log.onLog(date);
    if (ok) {
      setLogOpen(false);
      setLoggedOn(date);
    }
  }

  return (
    <>
      <div className="cook-entry" data-testid="cook-entry">
        <div className="cook-entry-start">
          <button type="button" className="cook-start-btn" data-testid="cook-start-btn" onClick={onStart}>
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M5 3l14 9-14 9V3z" />
            </svg>
            Start Cooking
          </button>
          <button
            type="button"
            className="cook-start-caret"
            aria-label="More cooking options"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((o) => !o)}
          >
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="m6 9 6 6 6-6" />
            </svg>
          </button>
          {menuOpen ? (
            <div className="cook-menu">
              <button
                type="button"
                className="cook-menu-item"
                onClick={() => {
                  setMenuOpen(false);
                  onStart();
                }}
              >
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M5 3l14 9-14 9V3z" />
                </svg>
                <span className="cmi-labels">
                  <span className="cmi-title">Guided Cooking</span>
                  <span className="cmi-sub">Step through it yourself</span>
                </span>
              </button>
              {onVoice ? (
                <button
                  type="button"
                  className="cook-menu-item"
                  data-testid="cook-voice"
                  onClick={() => {
                    setMenuOpen(false);
                    onVoice();
                  }}
                >
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M12 2a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                    <path d="M19 10v1a7 7 0 0 1-14 0v-1M12 18v4M8 22h8" />
                  </svg>
                  <span className="cmi-labels">
                    <span className="cmi-title">Hands-Free Voice Mode</span>
                    <span className="cmi-sub">Steps read aloud, advance by voice</span>
                  </span>
                </button>
              ) : null}
            </div>
          ) : null}
        </div>

        {log ? (
          <div className="cook-log">
            <button
              type="button"
              className={`cook-log-btn${logOpen ? " on" : ""}`}
              data-testid="cook-log-btn"
              aria-expanded={logOpen}
              onClick={() => setLogOpen((o) => !o)}
            >
              <IconCalendar /> Log cooked
            </button>
            {logOpen ? (
              <div className="cook-log-pop">
                <div className="cook-log-pop-label">When did you cook this?</div>
                <input type="date" value={date} max={today} onChange={(e) => e.target.value && setDate(e.target.value)} />
                <button type="button" className="cook-log-confirm" data-testid="cook-log-confirm" disabled={log.busy} onClick={() => void doLog()}>
                  <IconCheck /> Log it
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
      {loggedOn ? (
        <div className="cook-logged" data-testid="cook-logged">
          <IconCheck /> Logged as cooked {loggedOn === today ? "today" : loggedOn}
        </div>
      ) : null}
    </>
  );
}

/** The read-only recipe card shell — title, facets, time/dietary, and the markdown body — with
 *  optional favorite/entry slots. The unknown-newer / re-hydrating degrade renders it bare. */
function PlainRecipeCard({
  recipe,
  fav,
  entry,
}: {
  recipe: RecipeCardData;
  fav?: React.ReactNode;
  entry?: React.ReactNode;
}) {
  const hasFacets =
    Boolean(recipe.protein) ||
    Boolean(recipe.cuisine) ||
    recipe.dietary.length > 0 ||
    (recipe.course?.length ?? 0) > 0 ||
    (recipe.tags?.length ?? 0) > 0 ||
    typeof recipe.time_total === "number";

  return (
    <div className="recipe-card-widget" data-widget="recipe-card">
      <Card>
        <CardHeader>
          <div className="detail-titlerow">
            <h1 data-testid="recipe-title">{recipe.title}</h1>
            {fav ?? null}
          </div>
          {recipe.description ? <p className="detail-source">{recipe.description}</p> : null}
          {entry ?? null}
        </CardHeader>
        <CardContent>
          {hasFacets ? (
            <div className="detail-meta">
              <RecipeFacets protein={recipe.protein ?? null} cuisine={recipe.cuisine ?? null} />
              {recipe.course?.map((c) => (
                <FacetChip key={`course-${c}`}>{c}</FacetChip>
              ))}
              {recipe.dietary.map((d) => (
                <FacetChip key={`diet-${d}`}>{d}</FacetChip>
              ))}
              {recipe.tags?.map((t) => (
                <FacetChip key={`tag-${t}`}>{t}</FacetChip>
              ))}
              {typeof recipe.time_total === "number" ? (
                <span className="detail-time">
                  <IconClock /> {recipe.time_total} min
                </span>
              ) : null}
            </div>
          ) : null}
          {/* Escape-first markdown render (md.ts) — hydrated from structuredContent, no raw HTML. */}
          <div className="prose" data-testid="recipe-body" dangerouslySetInnerHTML={{ __html: mdToHtml(recipe.body) }} />
        </CardContent>
      </Card>
    </div>
  );
}
