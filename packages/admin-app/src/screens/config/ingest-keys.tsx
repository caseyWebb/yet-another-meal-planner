// Config › Ingest Keys (ported from the SSR client/ingest-keys.tsx island): the satellite
// key roster over the ["ingest-keys"] query + the mint / revoke flows as mutations. The
// freshly-minted secret is a single `banner` value shown once (the `.minted` / `.once`
// callout, with a copy control); Revoke sits behind a destructive confirm dialog. The mint
// dialog's tenant binding is a NATIVE <select> (#mint-key-tenant): the empty-value default
// is operator-global, one option per allowlisted member (the ["tenants"] query).

import * as React from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api, apiErrorOf, unwrap } from "../../lib/api";
import { ingestKeysQuery, queryClient, tenantsQuery, type IngestKeysData } from "../../lib/queries";
import { assertNever } from "../../lib/assert";
import {
  Input,
  Label,
  NativeSelect,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@grocery-agent/ui";
import { Badge, Button, ErrorBanner } from "../../components/kit";
import { KeyIcon, TrashIcon } from "../../components/icons";
import { ConfigShell, Section } from "./shell";

type SatelliteRow = IngestKeysData["satellites"][number];

/** The one-time secret banner — present only right after a mint. */
interface Banner {
  label: string;
  secret: string;
  prefix: string;
}

/** The SSR island's relative age (null → "never", with the months tier the shared relAge lacks). */
function keyAge(at: number | null, now: number): string {
  if (at == null) return "never";
  const s = Math.max(0, Math.floor((now - at) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  const d = Math.floor(s / 86400);
  if (d < 60) return `${d}d ago`;
  return `${Math.floor(d / 30)}mo ago`;
}

export function ConfigIngestKeysScreen() {
  return (
    <ConfigShell>
      <Section
        title="Ingest keys"
        blurb="One key per home-network satellite — a machine that logs in to paid recipe sites, extracts recipes, and POSTs them to the Worker, feeding the discovery sweep. Mint a key per satellite; the secret is shown once. Bind a key to a member so its satellite may also claim that member's own pull-channel work."
      >
        <IngestKeysBody />
      </Section>
    </ConfigShell>
  );
}

function IngestKeysBody() {
  const q = useQuery(ingestKeysQuery);
  // The allowlisted member ids are the mint dialog's bind-target options (the key's tenant
  // binding is validated server-side against this same allowlist on mint).
  const tenantsQ = useQuery(tenantsQuery);
  const members = tenantsQ.data?.tenants.map((t) => t.id) ?? [];

  switch (q.status) {
    case "pending":
      return <p className="muted">Loading…</p>;
    case "error":
      return <ErrorBanner message={apiErrorOf(q.error)?.message ?? String(q.error)} />;
    case "success":
      return <IngestKeysRoster satellites={q.data.satellites} members={members} />;
    default:
      return assertNever(q);
  }
}

function MintedBanner({ banner, onDismiss }: { banner: Banner; onDismiss: () => void }) {
  const [copied, setCopied] = React.useState(false);
  return (
    <div className="minted">
      <div className="minted-head">
        <strong>Ingest key minted · {banner.label}</strong>
        <Button variant="ghost" size="sm" onClick={onDismiss}>
          Dismiss
        </Button>
      </div>
      <p className="once">
        Shown once — copy it now and store it in the satellite's config. You won't see this secret again; revoke and
        re-mint if it's lost.
      </p>
      <div className="minted-secret">
        <code className="minted-code">{banner.secret}</code>
        <Button
          className="minted-copy"
          variant="outline"
          size="sm"
          onClick={() => {
            void navigator.clipboard.writeText(banner.secret).then(() => setCopied(true));
          }}
        >
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
    </div>
  );
}

function KeyRow({ s, now, busy, onRevoke }: { s: SatelliteRow; now: number; busy: boolean; onRevoke: () => void }) {
  const revoked = s.status === "revoked";
  return (
    <TableRow className={revoked ? "cfg-key-revoked" : undefined}>
      <TableCell>
        <div className="item-title">{s.label}</div>
        <code className="muted small">{s.prefix}…</code>
      </TableCell>
      <TableCell>
        {s.tenant == null ? <span className="muted small">operator-global</span> : <Badge variant="outline">{s.tenant}</Badge>}
      </TableCell>
      <TableCell>
        {s.sources.length === 0 ? (
          <span className="muted small">none yet</span>
        ) : (
          <span className="badge-row">
            {s.sources.map((src) => (
              <Badge key={src.name} variant="outline">
                {src.name}
              </Badge>
            ))}
          </span>
        )}
      </TableCell>
      <TableCell className="muted small">{keyAge(s.created, now)}</TableCell>
      <TableCell className="muted small">{keyAge(s.lastPush, now)}</TableCell>
      <TableCell>
        <Badge variant={revoked ? "outline" : "secondary"}>{s.status}</Badge>
      </TableCell>
      <TableCell>
        {revoked ? (
          <span className="muted small">revoked</span>
        ) : (
          <Button variant="ghost" size="sm" disabled={busy} onClick={onRevoke}>
            <TrashIcon size={13} /> Revoke
          </Button>
        )}
      </TableCell>
    </TableRow>
  );
}

function IngestKeysRoster({ satellites, members }: { satellites: SatelliteRow[]; members: string[] }) {
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [label, setLabel] = React.useState("");
  const [tenant, setTenant] = React.useState("");
  const [banner, setBanner] = React.useState<Banner | null>(null);
  const [confirm, setConfirm] = React.useState<SatelliteRow | null>(null);
  const [now] = React.useState(() => Date.now());

  const mintMut = useMutation({
    // An empty tenant selection is operator-global (the server treats "" / absent as no binding).
    mutationFn: (input: { label: string; tenant: string | null }) =>
      unwrap(api.admin.api.ingest.keys.$post({ json: input })),
    onSuccess: (data, input) => {
      setBanner({ label: input.label, secret: data.secret, prefix: data.prefix });
      setLabel("");
      setTenant("");
      setDialogOpen(false);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["ingest-keys"] }),
  });

  const revokeMut = useMutation({
    mutationFn: (id: string) => unwrap(api.admin.api.ingest.keys[":id"].revoke.$post({ param: { id } })),
    onSettled: () => {
      setConfirm(null);
      void queryClient.invalidateQueries({ queryKey: ["ingest-keys"] });
    },
  });

  const busy = mintMut.isPending || revokeMut.isPending;
  const failure = mintMut.isError
    ? (apiErrorOf(mintMut.error)?.message ?? String(mintMut.error))
    : revokeMut.isError
      ? (apiErrorOf(revokeMut.error)?.message ?? String(revokeMut.error))
      : null;

  function doMint(e: React.FormEvent): void {
    e.preventDefault();
    if (!label.trim() || busy) return;
    revokeMut.reset();
    mintMut.mutate({ label, tenant: tenant || null });
  }

  return (
    <div>
      {banner ? <MintedBanner banner={banner} onDismiss={() => setBanner(null)} /> : null}
      {failure ? <ErrorBanner message={failure} /> : null}

      <div className="roster-head">
        <p className="group-label" style={{ margin: 0 }}>
          Keys
        </p>
        <Button size="sm" onClick={() => setDialogOpen(true)}>
          <KeyIcon size={14} /> Mint key
        </Button>
      </div>

      {satellites.length === 0 ? (
        <p className="muted">
          No ingest keys yet — mint one for your home satellite (a box on your network that logs in to a paid recipe
          site, extracts recipes, and pushes them here).
        </p>
      ) : (
        <div className="cfg-table-wrap">
          <Table className="table">
            <TableHeader>
              <TableRow>
                <TableHead>Satellite</TableHead>
                <TableHead>Binding</TableHead>
                <TableHead>Sources</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Last used</TableHead>
                <TableHead>Status</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {satellites.map((s) => (
                <KeyRow key={s.id} s={s} now={now} busy={busy} onRevoke={() => setConfirm(s)} />
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          if (!open) setDialogOpen(false);
        }}
      >
        <DialogContent>
          <form onSubmit={doMint}>
            <DialogHeader>
              <DialogTitle>Mint ingest key</DialogTitle>
              <DialogDescription>
                Name the satellite machine this key is for. The secret is shown once after minting.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-2" style={{ marginTop: "0.75rem" }}>
              <Label htmlFor="mint-key-label">Label</Label>
              <Input
                id="mint-key-label"
                type="text"
                placeholder="home-nas-satellite"
                value={label}
                onChange={(e) => setLabel(e.currentTarget.value)}
              />
              <p className="muted small">A name for the satellite — lowercase, no spaces.</p>
            </div>
            <div className="grid gap-2" style={{ marginTop: "0.75rem" }}>
              <Label htmlFor="mint-key-tenant">Tenant binding</Label>
              <NativeSelect id="mint-key-tenant" value={tenant} onChange={(e) => setTenant(e.currentTarget.value)}>
                <option value="">operator-global (default)</option>
                {members.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </NativeSelect>
              <p className="muted small">
                Operator-global claims cross-tenant (sale-scan) work only. Bind to a member so the satellite may also
                claim that member's own (order-list) work. Immutable — re-mint to change.
              </p>
            </div>
            <DialogFooter className="form-actions" style={{ marginTop: "0.75rem" }}>
              <Button type="button" variant="outline" size="sm" onClick={() => setDialogOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={busy || !label.trim()}>
                Mint key
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={confirm != null}
        onOpenChange={(open) => {
          if (!open) setConfirm(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Revoke ingest key</DialogTitle>
            <DialogDescription>
              {confirm ? (
                <>
                  Revoke <strong>{confirm.label}</strong>? The next push from this satellite will be rejected
                  immediately. This can't be undone — mint a new key to reconnect the machine.
                </>
              ) : null}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="form-actions">
            <Button type="button" variant="outline" size="sm" onClick={() => setConfirm(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={busy}
              onClick={() => {
                if (confirm) {
                  mintMut.reset();
                  revokeMut.mutate(confirm.id);
                }
              }}
            >
              Revoke key
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
