// Connectivity as React state (member-app-offline D10): one hook over TanStack's
// onlineManager — the SAME signal that pauses/resumes the class (b) mutation queue,
// so the offline pill and the disabled online-only affordances can never disagree
// with replay behavior.
import { onlineManager } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";

export function useOnline(): boolean {
  return useSyncExternalStore(
    (onChange) => onlineManager.subscribe(onChange),
    () => onlineManager.isOnline(),
    () => true,
  );
}
