// The prompt-to-reload update flow (member-app-offline D7): the banner appears ONLY when
// a new service worker has downloaded and is WAITING (`needRefresh` — the
// registerType:"prompt" posture means it never activates by itself), so it never shows
// unless an update is genuinely ready to apply, and the action always lands on the new
// bundle. A detected build skew (lib/api.ts's X-App-Build tap) does NOT itself prompt —
// a bare header mismatch is not proof a new bundle exists to load — it only kicks a
// bounded SW update check so a waiting worker can materialize. NOTHING ever auto-reloads:
// a member mid-grocery-aisle is never interrupted.
import * as React from "react";
import { useRegisterSW } from "virtual:pwa-register/react";
import { Button, toast } from "@grocery-agent/ui";
import { requestSwUpdateCheck } from "../lib/api";

export function ReloadPrompt() {
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

  if (!needRefresh) return null;

  return (
    <div
      className="fixed top-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-lg border bg-card px-4 py-2 text-sm shadow-md"
      role="status"
      data-testid="reload-banner"
    >
      <span>A new version is ready.</span>
      {/* A waiting worker always exists here, so this skip-waits into it and reloads
          onto the new bundle — no plain-reload path that could re-serve the old shell. */}
      <Button size="sm" data-testid="reload-apply" onClick={() => void updateServiceWorker(true)}>
        Reload
      </Button>
    </div>
  );
}
