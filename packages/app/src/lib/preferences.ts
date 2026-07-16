// The ONE preferences write path (member-app-core): merge-patch under If-Match with a
// single automatic rebase retry (merge-patches rebase trivially — the patch IS the
// intent), then invalidate the profile reads. Shared by the Preferences tab's knobs and
// the cookbook page's household-level flags (curated-hide, the cold-start onboarding
// dismissal) so every preferences-document write rides the identical class (a) loop.
import type { QueryClient } from "@tanstack/react-query";
import { toast } from "@yamp/ui";
import { api, apiError } from "./api";

export async function patchPreferences(
  qc: QueryClient,
  patch: Record<string, unknown>,
  storeBoundary = false,
): Promise<boolean> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const read = await api.api.profile.preferences.$get().catch(() => null);
    if (!read?.ok) break;
    const etag = read.headers.get("etag") ?? "";
    const res = await api.api.profile.preferences
      .$patch({ json: { patch } }, { headers: { "If-Match": etag } })
      .catch(() => null);
    if (!res) break;
    if (res.status === 412) continue; // raced — rebase on the fresh read and retry once
    if (!res.ok) {
      toast((await apiError(res)).message);
      return false;
    }
    await qc.invalidateQueries({ queryKey: ["profile"] });
    if (storeBoundary) {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["store-adapters"] }),
        qc.invalidateQueries({ queryKey: ["grocery", "to-buy", "enriched"] }),
      ]);
      window.dispatchEvent(new Event("yamp:store-adapter-changed"));
    }
    return true;
  }
  toast("Couldn't save preferences — try again");
  return false;
}
