// The meal-plan proposal widget entry (meal-plan-widget). Boots the canonical ext-apps `App`
// client — NOT a hand-rolled postMessage bridge — which performs the `ui/initialize` handshake
// claude.ai validates before it un-hides the frame and auto-sends size-changed notifications
// (autoResize). The card hydrates from the host's `ui/notifications/tool-result` (the
// `display_meal_plan` tool's `structuredContent`); `ontoolresult` is registered BEFORE `connect()`
// so the first notification is never missed. The `App` instance is handed to the card so its dials
// can re-invoke the stateless propose op through the host (`App.callServerTool`) with no model turn.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "@modelcontextprotocol/ext-apps";
import type { ProposeCardData } from "@yamp/contract";
import { ProposeCard } from "./ProposeCard";
import "./styles.css";

// The iframe owns its own document, so it owns its theme (host light/dark sync is out of scope
// for v1). Default to the viewer's OS preference, falling back to light — theme.css keys dark on
// a `.dark` class on <html>.
function applyDefaultTheme(): void {
  const prefersDark =
    typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches;
  document.documentElement.classList.toggle("dark", prefersDark);
}

const rootEl = document.getElementById("root");
if (rootEl) {
  applyDefaultTheme();
  const root = createRoot(rootEl);
  const app = new App({ name: "plan-propose", version: "1.0.0" }, {}, { autoResize: true });

  function render(data: ProposeCardData | null): void {
    root.render(
      <StrictMode>
        {data ? (
          <ProposeCard app={app} data={data} />
        ) : (
          <p className="muted-line" data-testid="propose-loading">
            Proposing your week…
          </p>
        )}
      </StrictMode>,
    );
  }

  render(null);

  // Hydrate from the tool result's structuredContent. Set BEFORE connect() so a tool-result
  // delivered during the handshake is not dropped.
  app.ontoolresult = (params) => {
    const data = params.structuredContent as ProposeCardData | undefined;
    if (data) render(data);
  };

  void app.connect();
}
