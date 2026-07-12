// The recipe-card widget entry (recipe-card-widget). Boots the canonical ext-apps `App`
// client — NOT a hand-rolled postMessage bridge (the spike proved hand-rolling is a miswire
// trap) — which performs the `ui/initialize` handshake claude.ai validates before it un-hides
// the frame and auto-sends size-changed notifications (autoResize). The card hydrates from the
// host's `ui/notifications/tool-result` (the `display_recipe` tool's `structuredContent`);
// `ontoolresult` is registered BEFORE `connect()` so the first notification is never missed.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "@modelcontextprotocol/ext-apps";
import type { RecipeCardData } from "@yamp/contract";
import { RecipeCard } from "./RecipeCard";
import "./styles.css";

// The iframe owns its own document, so it owns its theme (host light/dark sync is out of
// scope for v1). Default to the viewer's OS preference, falling back to light — theme.css
// keys dark on a `.dark` class on <html>.
function applyDefaultTheme(): void {
  const prefersDark =
    typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches;
  document.documentElement.classList.toggle("dark", prefersDark);
}

const rootEl = document.getElementById("root");
if (rootEl) {
  applyDefaultTheme();
  const root = createRoot(rootEl);
  // The card is a WRITING widget now (D18/D32), so the `App` instance is handed in — its cook mode
  // and favorite/log controls call server tools + push model context through the host bridge.
  const app = new App({ name: "recipe-card", version: "1.0.0" }, {}, { autoResize: true });

  function render(recipe: RecipeCardData | null): void {
    root.render(
      <StrictMode>
        {recipe ? (
          <RecipeCard app={app} recipe={recipe} />
        ) : (
          <p className="muted-line" data-testid="recipe-loading">
            Loading recipe…
          </p>
        )}
      </StrictMode>,
    );
  }

  render(null);

  // Hydrate from the tool result's structuredContent. Set BEFORE connect() so a
  // tool-result delivered during the handshake is not dropped.
  app.ontoolresult = (params) => {
    const data = params.structuredContent as RecipeCardData | undefined;
    if (data) render(data);
  };

  void app.connect();
}
