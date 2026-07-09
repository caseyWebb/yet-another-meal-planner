// The Members › Invite codes sub-tab (self-service-signup): mint a multi-use group invite code
// (cap + optional expiry/label, shown once), list codes with live usage + provenance, revoke a
// code (halts further sign-ups; accounts already created are untouched). Mirrors members.tsx —
// one primary query (status union → assertNever), one mutation whose `variables` is the op union,
// a show-once banner, a mint Dialog, and a revoke AlertDialog.
import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
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
  NativeSelect,
} from "@yamp/ui";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, inviteCodesQuery, type InviteCodeRow } from "../lib/queries";
import { api, unwrap, apiErrorOf } from "../lib/api";
import { assertNever } from "../lib/assert";
import { Button, Badge, ErrorBanner, StatCardGrid, StatCard, Item, ItemGroup } from "../components/kit";
import { KeyIcon, UsersIcon, CheckCircleIcon, TrashIcon, UserPlusIcon } from "../components/icons";
import { relFuture, utc } from "../lib/format";

const DAY = 24 * 60 * 60 * 1000;

/** The freshly-minted code, surfaced once. */
type Banner = {
  code: string;
  signup_url: string;
  max_redemptions: number;
  expires_at: number | null;
  label: string | null;
};

/** One op at a time (CLAUDE.md rule 3): `variables` is the busy op. */
type Op =
  | { kind: "mint"; cap: number; expires_at: number | null; label: string | null }
  | { kind: "revoke"; code: string };

async function runOp(op: Op): Promise<Banner | null> {
  switch (op.kind) {
    case "mint": {
      const data = await unwrap(
        api.admin.api["invite-codes"].$post({ json: { cap: op.cap, expires_at: op.expires_at, label: op.label } }),
      );
      return {
        code: data.code,
        signup_url: data.signup_url,
        max_redemptions: data.max_redemptions,
        expires_at: data.expires_at,
        label: data.label,
      };
    }
    case "revoke": {
      await unwrap(api.admin.api["invite-codes"][":code"].revoke.$post({ param: { code: op.code } }));
      return null;
    }
    default:
      return assertNever(op);
  }
}

/** One once-shown credential line: label + mono value + a clipboard copy button. */
const MintedRow = ({ label, value }: { label: string; value: string }) => (
  <div className="minted-row">
    <span className="minted-label">{label}</span>
    <code className="minted-code">{value}</code>
    <Button className="minted-copy" variant="outline" size="sm" onClick={() => void navigator.clipboard.writeText(value)}>
      Copy
    </Button>
  </div>
);

type CodeStatus = "active" | "revoked" | "expired" | "full";
function statusOf(row: InviteCodeRow, now: number): CodeStatus {
  if (row.revoked_at != null) return "revoked";
  if (row.expires_at != null && row.expires_at <= now) return "expired";
  if (row.used >= row.max_redemptions) return "full";
  return "active";
}

function counts(codes: InviteCodeRow[], now: number) {
  return {
    total: codes.length,
    active: codes.filter((c) => statusOf(c, now) === "active").length,
    redemptions: codes.reduce((n, c) => n + c.redemptions.length, 0),
  };
}

function InviteCodesView({ codes }: { codes: InviteCodeRow[] }): React.ReactElement {
  const [now] = React.useState(() => Date.now());
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [cap, setCap] = React.useState(10);
  const [expiryDays, setExpiryDays] = React.useState<number | null>(null);
  const [label, setLabel] = React.useState("");
  const [banner, setBanner] = React.useState<Banner | null>(null);
  const [revokeTarget, setRevokeTarget] = React.useState<InviteCodeRow | null>(null);

  const action = useMutation({
    mutationFn: runOp,
    onSuccess: (minted, op) => {
      if (minted) setBanner(minted);
      if (op.kind === "mint") {
        setDialogOpen(false);
        setLabel("");
      }
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["inviteCodes"] }),
  });
  const busy = action.isPending;
  const busyOp = action.isPending ? action.variables : null;
  const c = counts(codes, now);

  return (
    <>
      <StatCardGrid>
        <StatCard icon={<KeyIcon size={15} />} label="Codes" value={c.total} />
        <StatCard icon={<CheckCircleIcon size={15} />} label="Active" value={c.active} />
        <StatCard icon={<UsersIcon size={15} />} label="Sign-ups" value={c.redemptions} />
      </StatCardGrid>

      {banner ? (
        <div className="minted">
          <div className="minted-head">
            <strong>Invite code minted{banner.label ? ` · ${banner.label}` : ""}</strong>
            <Button variant="ghost" size="sm" onClick={() => setBanner(null)}>
              Dismiss
            </Button>
          </div>
          <p className="once">
            Shown once — copy it now. Share the code with your group; anyone can sign up at the link with their own username
            (up to {banner.max_redemptions}
            {banner.expires_at != null ? `, until ${utc(banner.expires_at)}` : ""}).
          </p>
          <MintedRow label="invite code" value={banner.code} />
          <MintedRow label="sign-up url" value={banner.signup_url} />
        </div>
      ) : null}
      {action.isError ? <ErrorBanner message={apiErrorOf(action.error)?.message ?? String(action.error)} /> : null}

      <div className="roster-head">
        <p className="group-label" style={{ margin: 0 }}>
          Invite codes
        </p>
        <Button size="sm" onClick={() => setDialogOpen(true)}>
          <UserPlusIcon size={14} /> Mint code
        </Button>
      </div>

      {codes.length === 0 ? (
        <p className="muted">No group invite codes yet. Mint one to let a group self-serve sign-ups.</p>
      ) : (
        <ItemGroup>
          {codes.map((row) => {
            const status = statusOf(row, now);
            return (
              <Item
                key={row.code}
                outline
                media={<KeyIcon size={16} />}
                title={<code className="minted-code">{row.code}</code>}
                description={
                  <>
                    {row.used}/{row.max_redemptions} used
                    {row.expires_at != null ? ` · expires ${relFuture(row.expires_at, now)}` : " · no expiry"}
                    {row.label ? ` · ${row.label}` : ""}
                  </>
                }
                actions={
                  status === "active" ? (
                    <Button variant="destructive" size="sm" disabled={busy} onClick={() => setRevokeTarget(row)}>
                      <TrashIcon size={13} /> {busyOp?.kind === "revoke" && busyOp.code === row.code ? "Revoking…" : "Revoke"}
                    </Button>
                  ) : (
                    <Badge variant={status === "revoked" ? "destructive" : "secondary"}>{status}</Badge>
                  )
                }
              >
                {row.redemptions.length > 0 ? (
                  <div className="muted small">joined: {row.redemptions.map((t) => `@${t}`).join(", ")}</div>
                ) : null}
              </Item>
            );
          })}
        </ItemGroup>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (busy) return;
              action.mutate({
                kind: "mint",
                cap,
                expires_at: expiryDays == null ? null : now + expiryDays * DAY,
                label: label.trim() ? label.trim() : null,
              });
            }}
          >
            <DialogHeader>
              <DialogTitle>Mint invite code</DialogTitle>
            </DialogHeader>
            <p className="muted small">A multi-use code your group redeems to self-serve sign-ups. Shown once.</p>
            <div className="grid gap-2">
              <Label htmlFor="code-cap">Max sign-ups</Label>
              <NativeSelect id="code-cap" value={String(cap)} onChange={(e) => setCap(Number(e.currentTarget.value))}>
                {[5, 10, 15, 25, 50].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="code-expiry">Expires</Label>
              <NativeSelect
                id="code-expiry"
                value={expiryDays == null ? "never" : String(expiryDays)}
                onChange={(e) => setExpiryDays(e.currentTarget.value === "never" ? null : Number(e.currentTarget.value))}
              >
                <option value="never">Never</option>
                <option value="7">In 7 days</option>
                <option value="30">In 30 days</option>
                <option value="90">In 90 days</option>
              </NativeSelect>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="code-label">Label (optional)</Label>
              <Input
                id="code-label"
                type="text"
                placeholder="summer camp crew"
                value={label}
                onChange={(e) => setLabel(e.currentTarget.value)}
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" size="sm" onClick={() => setDialogOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={busy}>
                Mint code
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={revokeTarget !== null} onOpenChange={(open) => !open && setRevokeTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke invite code</AlertDialogTitle>
            <AlertDialogDescription>
              This stops the code from admitting any further sign-ups. Members who already signed up through it keep their
              accounts — revoke those individually from the roster.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (revokeTarget) action.mutate({ kind: "revoke", code: revokeTarget.code });
                setRevokeTarget(null);
              }}
            >
              Revoke code
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export function InviteCodesScreen(): React.ReactElement {
  const q = useQuery(inviteCodesQuery);
  switch (q.status) {
    case "pending":
      return <p className="screen-loading">Loading invite codes…</p>;
    case "error":
      return <ErrorBanner message={apiErrorOf(q.error)?.message ?? String(q.error)} />;
    case "success":
      return <InviteCodesView codes={q.data.codes} />;
    default:
      return assertNever(q);
  }
}
