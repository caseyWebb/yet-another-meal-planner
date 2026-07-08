// The prompt-to-reload update flow (member-app-offline D7): ONE banner, TWO triggers,
// member-initiated always. `needRefresh` (a new SW downloaded and WAITING — the
// registerType:"prompt" posture means it never activates by itself) and the passive
// version-skew flag (lib/api.ts's X-App-Build tap) render the same banner; the action
// activates the waiting SW and reloads — or, on the skew-only path (header arrived
// before any SW check found the build), attempts the update and plain-reloads.
// NOTHING ever auto-reloads: a member mid-grocery-aisle is never interrupted.
import * as React from "react";
import { useRegisterSW } from "virtual:pwa-register/react";
import { Button, toast } from "@grocery-agent/ui";
import { requestSwUpdateCheck, skewSnapshot, subscribeSkew } from "../lib/api";

export function ReloadPrompt() {
  const skewed = React.useSyncExternalStore(subscribeSkew, skewSnapshot, () => false);
  const {
    needRefresh: [needRefresh],
    offlineReady: [offlineReady, setOfflineReady],
    updateServiceWorker,
  } = useRegisterSW({});

  // The one-shot "works offline now" note, first successful precache only.
  React.useEffect(() => {
    if (!offlineReady) return;
    toast("Works offline now");
    setOfflineReady(false);
  }, [offlineReady, setOfflineReady]);

  // Bounded update checks (D7): returning to the foreground asks the registration to
  // check for a new build, throttled to once an hour inside requestSwUpdateCheck —
  // plus the skew trigger in the fetch wrapper. No polling loop.
  React.useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") requestSwUpdateCheck();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  if (!needRefresh && !skewed) return null;

  async function reload() {
    if (needRefresh) {
      // Activate the waiting SW and reload onto the new bundle.
      await updateServiceWorker(true);
      return;
    }
    // Skew-only: try to pick the new SW up, then plain-reload (covers the window
    // where the header arrives before any SW update check has found the build).
    try {
      await updateServiceWorker(true);
    } catch {
      // fall through to the reload
    }
    window.location.reload();
  }

  return (
    <div
      className="fixed top-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-lg border bg-card px-4 py-2 text-sm shadow-md"
      role="status"
      data-testid="reload-banner"
    >
      <span>A new version is ready.</span>
      <Button size="sm" data-testid="reload-apply" onClick={() => void reload()}>
        Reload
      </Button>
    </div>
  );
}
