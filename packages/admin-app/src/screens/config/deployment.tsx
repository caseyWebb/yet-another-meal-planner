// Config › Deployment (deployment-profiles-and-visibility-lens) — the deployment-profile
// card: the resolved profile (with the unset-defaults-to-self-hosted hint), the guarded
// flip control, and the curated-source knob. The flip mirrors the calibration console's
// needs-confirm idiom: the first PUT goes without `confirm`, the Worker's structured
// `needsConfirm` error opens the confirm dialog (whose copy states the SaaS consequences),
// and confirming re-submits with `confirm:true`. A SaaS → self-hosted flip the Worker
// REFUSES (the consent-inversion guard — a structured `conflict`, no write) renders its
// reason on the card; confirm cannot override it. The curated source repoints with a URL,
// disables with "", and resets to the compiled default with null — the PUT's contract.

import * as React from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
  Input,
  Label,
} from "@yamp/ui";
import { api, apiErrorOf } from "../../lib/api";
import { deploymentConfigQuery, queryClient, type DeploymentConfigData } from "../../lib/queries";
import { assertNever } from "../../lib/assert";
import { Badge, Button, Card, ErrorBanner } from "../../components/kit";
import { ConfigShell, Section } from "./shell";

type DeploymentConfig = DeploymentConfigData["config"];
type Profile = DeploymentConfig["profile"];

/** The flip control's finite states (src/admin/CLAUDE.md rule 5 — one union, never
 *  parallel booleans): `needsConfirm` is the open confirm dialog (self-hosted → SaaS
 *  only); `refused` is the consent-inversion refusal rendered on the card until
 *  dismissed or a new flip attempt replaces it. */
type FlipState =
  | { t: "idle" }
  | { t: "needsConfirm"; message: string }
  | { t: "refused"; message: string; households: number };

/** A flip PUT RESOLVES to one of these (the knob console's SaveResult idiom); any other
 *  failure rejects carrying the structured ApiError, landing in the mutation's error
 *  state (rule 4) — the two guard outcomes are states, not banner-only errors. */
type FlipResult =
  | { t: "saved"; config: DeploymentConfig }
  | { t: "needsConfirm"; message: string }
  | { t: "refused"; message: string; households: number };

/** The curated-source control: clean renders the stored state; editing carries the draft. */
type CuratedForm = { t: "clean" } | { t: "editing"; draft: string };

/** Classify a failed deployment-config PUT body (`ToolError.toShape()` spreads its context
 *  at the top level): the flip guards' two structured outcomes, or null for anything else. */
function flipFailureOf(body: unknown): Exclude<FlipResult, { t: "saved" }> | null {
  const b = body as { message?: string; needsConfirm?: boolean; guard?: string; households?: number } | null;
  if (b?.needsConfirm) return { t: "needsConfirm", message: b.message ?? "Flipping the profile needs an explicit confirmation." };
  if (b?.guard === "consent_inversion")
    return { t: "refused", message: b.message ?? "Refused by the consent-inversion guard.", households: b.households ?? 0 };
  return null;
}

function profileSummary(profile: Profile): string {
  switch (profile) {
    case "self-hosted":
      return "Every household sees every household's recipes (implicit all-to-all visibility), and the public /cookbook site publishes the whole corpus.";
    case "saas":
      return "Households see their own, their friends', and the curated recipes; the public /cookbook site publishes the curated tier only.";
    default:
      return assertNever(profile);
  }
}

export function ConfigDeploymentScreen() {
  return (
    <ConfigShell>
      <Section
        title="Deployment"
        blurb="The deployment's sharing profile and the curated recipe source. Profile flips are guarded on the config write path."
      >
        <DeploymentBody />
      </Section>
    </ConfigShell>
  );
}

function DeploymentBody() {
  const q = useQuery(deploymentConfigQuery);
  switch (q.status) {
    case "pending":
      return <p className="muted">Loading…</p>;
    case "error":
      return <ErrorBanner message={apiErrorOf(q.error)?.message ?? String(q.error)} />;
    case "success":
      return <DeploymentCard config={q.data.config} />;
    default:
      return assertNever(q);
  }
}

function DeploymentCard({ config }: { config: DeploymentConfig }) {
  const [flip, setFlip] = React.useState<FlipState>({ t: "idle" });
  const [curated, setCurated] = React.useState<CuratedForm>({ t: "clean" });

  const flipMut = useMutation({
    mutationFn: async (input: { profile: Profile; confirm: boolean }): Promise<FlipResult> => {
      const res = await api.admin.api["deployment-config"].$put({ json: { profile: input.profile, confirm: input.confirm } });
      if (res.ok) return { t: "saved", config: (await res.json()).config };
      const body: unknown = await (res.json() as Promise<unknown>).catch(() => null);
      const guarded = flipFailureOf(body);
      if (guarded) return guarded;
      const b = body as { error?: string; message?: string } | null;
      const err =
        typeof b?.error === "string"
          ? { error: b.error, message: b.message ?? "" }
          : { error: "internal", message: `Request failed (${res.status})` };
      throw Object.assign(new Error(err.message || err.error), { api: err });
    },
    onSuccess: (result) => {
      switch (result.t) {
        case "saved":
          setFlip({ t: "idle" });
          queryClient.setQueryData(deploymentConfigQuery.queryKey, { config: result.config });
          break;
        case "needsConfirm":
          setFlip({ t: "needsConfirm", message: result.message });
          break;
        case "refused":
          setFlip({ t: "refused", message: result.message, households: result.households });
          break;
        default:
          assertNever(result);
      }
    },
    // A non-guard failure closes any pending confirm; the mutation error renders the banner.
    onError: () => setFlip({ t: "idle" }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["deployment-config"] }),
  });

  const curatedMut = useMutation({
    // The write contract: a URL repoints, "" disables curated intake, null resets to the default.
    mutationFn: async (curated_source_url: string | null) => {
      const res = await api.admin.api["deployment-config"].$put({ json: { curated_source_url } });
      if (res.ok) return res.json();
      const body: unknown = await (res.json() as Promise<unknown>).catch(() => null);
      const b = body as { error?: string; message?: string } | null;
      const err =
        typeof b?.error === "string"
          ? { error: b.error, message: b.message ?? "" }
          : { error: "internal", message: `Request failed (${res.status})` };
      throw Object.assign(new Error(err.message || err.error), { api: err });
    },
    onSuccess: (data) => {
      setCurated({ t: "clean" });
      queryClient.setQueryData(deploymentConfigQuery.queryKey, data);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["deployment-config"] }),
  });

  const busy = flipMut.isPending || curatedMut.isPending;
  const target: Profile = config.profile === "self-hosted" ? "saas" : "self-hosted";

  function startFlip(): void {
    flipMut.reset();
    curatedMut.reset();
    // The honest first submit goes WITHOUT confirm — the Worker's needsConfirm opens the dialog.
    flipMut.mutate({ profile: target, confirm: false });
  }

  return (
    <Card>
      {flipMut.isError ? (
        <ErrorBanner message={`Profile change failed: ${apiErrorOf(flipMut.error)?.message ?? String(flipMut.error)}`} />
      ) : null}
      {curatedMut.isError ? (
        <ErrorBanner message={`Curated source save failed: ${apiErrorOf(curatedMut.error)?.message ?? String(curatedMut.error)}`} />
      ) : null}

      <div className="roster-head">
        <div>
          <p className="group-label" style={{ margin: 0 }}>
            Profile
          </p>
          <div className="deploy-profile flex items-center gap-2 mt-1">
            <Badge variant={config.profile === "saas" ? "default" : "secondary"}>{config.profile}</Badge>
            {config.profileSet ? null : <span className="deploy-default-hint muted small">(default — never explicitly set)</span>}
          </div>
        </div>
        <Button size="sm" disabled={busy} onClick={startFlip}>
          {target === "saas" ? "Switch to SaaS" : "Switch to self-hosted"}
        </Button>
      </div>
      <p className="muted small">{profileSummary(config.profile)}</p>

      {flip.t === "refused" ? (
        <div className="deploy-refusal grid gap-2">
          <ErrorBanner message={flip.message} />
          <div className="form-actions">
            <Button variant="ghost" size="sm" onClick={() => setFlip({ t: "idle" })}>
              Dismiss
            </Button>
          </div>
        </div>
      ) : null}

      <div className="deploy-curated mt-4">
        <p className="group-label" style={{ margin: 0 }}>
          Curated source
        </p>
        <CuratedControl config={config} form={curated} setForm={setCurated} save={(url) => curatedMut.mutate(url)} busy={busy} />
      </div>

      <AlertDialog
        open={flip.t === "needsConfirm"}
        onOpenChange={(open) => {
          if (!open) setFlip({ t: "idle" });
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Switch to the SaaS profile</AlertDialogTitle>
            <AlertDialogDescription>
              Implicit all-to-all visibility ends immediately: households stop seeing each other's recipes (until real
              friendships exist), and the public /cookbook site narrows to the curated tier. Flipping back is refused
              while more than one household owns a non-empty cookbook.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={busy} onClick={() => flipMut.mutate({ profile: "saas", confirm: true })}>
              Switch to SaaS
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

/** The effective curated source per state (the read's `curatedSourceState` discriminant). */
function CuratedSummary({ config }: { config: DeploymentConfig }) {
  switch (config.curatedSourceState) {
    case "default":
      return (
        <>
          <code className="minted-code">{config.curatedSourceDefault}</code>
          <p className="muted small">
            The compiled default — not yet overridden. The deployment inherits the product-maintained curated feed
            without action.
          </p>
        </>
      );
    case "custom":
      return (
        <>
          <code className="minted-code">{config.curatedSourceUrl}</code>
          <p className="muted small">A custom source overriding the compiled default.</p>
        </>
      );
    case "disabled":
      return <p className="muted">Curated intake is disabled — the sweep never polls a curated source.</p>;
    default:
      return assertNever(config.curatedSourceState);
  }
}

function CuratedControl({
  config,
  form,
  setForm,
  save,
  busy,
}: {
  config: DeploymentConfig;
  form: CuratedForm;
  setForm: (f: CuratedForm) => void;
  save: (url: string | null) => void;
  busy: boolean;
}) {
  switch (form.t) {
    case "editing":
      return (
        <form
          className="grid gap-2 mt-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (busy || !form.draft.trim()) return;
            save(form.draft.trim());
          }}
        >
          <Label htmlFor="curated-source-url">Curated source URL</Label>
          <Input
            id="curated-source-url"
            type="text"
            placeholder={config.curatedSourceDefault}
            value={form.draft}
            onChange={(e) => setForm({ t: "editing", draft: e.currentTarget.value })}
          />
          <p className="muted small">A public http(s) feed the sweep polls for curated recipes under the SaaS profile.</p>
          <div className="form-actions">
            <Button type="submit" size="sm" disabled={busy || !form.draft.trim()}>
              Save URL
            </Button>
            <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => setForm({ t: "clean" })}>
              Cancel
            </Button>
          </div>
        </form>
      );
    case "clean":
      return (
        <div className="grid gap-2 mt-2">
          <CuratedSummary config={config} />
          <div className="form-actions">
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => setForm({ t: "editing", draft: config.curatedSourceUrl ?? config.curatedSourceDefault })}
            >
              Edit URL
            </Button>
            {config.curatedSourceState !== "disabled" ? (
              <Button variant="ghost" size="sm" disabled={busy} onClick={() => save("")}>
                Disable
              </Button>
            ) : null}
            {config.curatedSourceState !== "default" ? (
              <Button variant="ghost" size="sm" disabled={busy} onClick={() => save(null)}>
                Reset to default
              </Button>
            ) : null}
          </div>
        </div>
      );
    default:
      return assertNever(form);
  }
}
