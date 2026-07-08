// The operator-config knob console (ported from the SSR client/opconfig.tsx island) —
// shared by the Ranking and Kroger Flyer Config groups. Consumes the shared KnobConsole
// (components/knob-console.tsx), so both groups get the identical Clean|Dirty|NeedsConfirm
// state machine: Save is disabled until dirty, and a below-floor value
// (flyerRefreshHours/flyerBatchUnits — the only two operator-config knobs with a real safe
// floor; the five ranking weights are intentionally floor-free) surfaces a destructive
// "Confirm & save" gate before the write carries `confirm:true`.

import { useMutation, useQuery } from "@tanstack/react-query";
import { api, apiErrorOf } from "../../lib/api";
import { operatorConfigQuery, queryClient, type OperatorConfigData } from "../../lib/queries";
import { assertNever } from "../../lib/assert";
import { Card, ErrorBanner, type KnobSpec } from "../../components/kit";
import { KnobConsole, floorWarningOrThrow, type FloorWarning } from "../../components/knob-console";

export function OperatorKnobConsole({ knobs }: { knobs: KnobSpec[] }) {
  const q = useQuery(operatorConfigQuery);
  switch (q.status) {
    case "pending":
      return <p className="muted">Loading…</p>;
    case "error":
      return <ErrorBanner message={apiErrorOf(q.error)?.message ?? String(q.error)} />;
    case "success":
      return <OperatorKnobConsoleBody knobs={knobs} config={q.data.config} />;
    default:
      return assertNever(q);
  }
}

type SaveResult = { ok: true; config: Record<string, number> } | { ok: false; warning: FloorWarning | null };

function OperatorKnobConsoleBody({ knobs, config }: { knobs: KnobSpec[]; config: OperatorConfigData["config"] }) {
  const saveMut = useMutation({
    mutationFn: async ({ patch, confirm }: { patch: Record<string, number>; confirm: boolean }): Promise<SaveResult> => {
      const res = await api.admin.api["operator-config"].$put({ json: { ...patch, confirm } });
      if (res.ok) return { ok: true, config: (await res.json()).config as unknown as Record<string, number> };
      return { ok: false, warning: await floorWarningOrThrow(res) };
    },
    onSuccess: (result) => {
      if (result.ok) {
        queryClient.setQueryData(operatorConfigQuery.queryKey, {
          config: result.config as unknown as OperatorConfigData["config"],
        });
      }
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["operator-config"] }),
  });

  return (
    <Card>
      {saveMut.isError ? (
        <ErrorBanner message={`Save failed: ${apiErrorOf(saveMut.error)?.message ?? String(saveMut.error)}`} />
      ) : null}
      <KnobConsole
        knobs={knobs}
        saved={config as unknown as Record<string, number>}
        onSaved={() => {
          // The saved baseline lives in the ["operator-config"] cache (setQueryData above).
        }}
        save={(patch, confirm) => saveMut.mutateAsync({ patch, confirm })}
        saving={saveMut.isPending}
      />
    </Card>
  );
}
