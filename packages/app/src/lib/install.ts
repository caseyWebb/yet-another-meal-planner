// The install affordance's plumbing (member-app-offline D10): capture
// `beforeinstallprompt` once at module setup (the browser fires it before React
// mounts), expose it as subscribable state, and fire the stored prompt on demand.
// Platforms that never fire the event (iOS) simply never offer the affordance —
// no dead menu item; the manifest + apple-touch-icon make Add-to-Home-Screen work.
import { useSyncExternalStore } from "react";

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
}

let deferredPrompt: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault(); // keep the mini-infobar quiet; the menu item owns the moment
    deferredPrompt = e as BeforeInstallPromptEvent;
    for (const l of listeners) l();
  });
  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    for (const l of listeners) l();
  });
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

function isStandalone(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(display-mode: standalone)").matches;
}

/** True only when the browser has offered an install prompt AND the app is not
 *  already running standalone — the render gate for the "Install app" menu item. */
export function useInstallAvailable(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => deferredPrompt !== null && !isStandalone(),
    () => false,
  );
}

/** Fire the stored prompt (a member-initiated gesture — the browser requires one). */
export function promptInstall(): void {
  deferredPrompt?.prompt().catch(() => {
    // the browser declined to show it (already used / dismissed) — nothing to do
  });
  deferredPrompt = null;
  for (const l of listeners) l();
}
