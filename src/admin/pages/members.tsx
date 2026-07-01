// The Members area page (operator-admin), server-rendered. SSR renders the summary stat
// tiles + the roster (proving SSR-via-`src/`-call: `listTenants`'s structured rows); the
// interactive invite dialog + per-row actions menu are hydrated by the Members island,
// seeded from the same data as JSON props (admin/CLAUDE.md rule 8).

import { Layout } from "../ui/layout.js";
import { StatCardGrid, StatCard, ItemGroup, Item, Avatar, Badge } from "../ui/kit.js";
import { UsersIcon, CheckCircleIcon, ClockIcon, LinkIcon } from "../ui/icons.js";
import { relAge } from "./status.js";
import type { MembersIslandProps } from "../shared.js";
import type { TenantRosterRow } from "../../admin.js";

/** JSON for the island's `<script type="application/json">`, with `<` escaped so the
 *  serialized payload can never close the script element early. */
function serializeProps(props: MembersIslandProps): string {
  return JSON.stringify(props).replace(/</g, "\\u003c");
}

function counts(members: TenantRosterRow[]) {
  return {
    total: members.length,
    active: members.filter((m) => m.status === "active").length,
    pending: members.filter((m) => m.status === "pending").length,
    kroger: members.filter((m) => m.kroger === "linked").length,
  };
}

/** The roster's activity meta line: cooked/favorites + last-active age for an active member,
 *  invited age for a pending one (no activity counts to show yet). */
function metaLine(m: TenantRosterRow, now: number): string {
  if (m.status === "active") {
    const active = m.lastActive != null ? `active ${relAge(now - m.lastActive)}` : "active";
    return `${m.cooked} recipes cooked · ${m.favorites} favorites · ${active}`;
  }
  // A pending member has no first-seen yet; joined doubles as "invited" until they connect.
  return m.joined != null ? `Invited ${relAge(now - m.joined)} · awaiting Claude.ai connection` : "Awaiting Claude.ai connection";
}

const RosterRow = ({ m, now }: { m: TenantRosterRow; now: number }) => (
  <Item
    outline
    media={<Avatar fallback={m.id.slice(0, 2).toUpperCase()} size="lg" />}
    title={
      <>
        {`@${m.id}`} {m.owner ? <Badge variant="secondary">owner</Badge> : null}
      </>
    }
    description={metaLine(m, now)}
    actions={
      <>
        {m.kroger === "linked" ? (
          <Badge variant="secondary">
            <LinkIcon size={11} /> kroger
          </Badge>
        ) : null}
        {m.status === "active" ? <Badge variant="secondary">active</Badge> : <Badge variant="outline">pending</Badge>}
      </>
    }
  />
);

export const MembersPage = ({ props }: { props: MembersIslandProps }) => {
  const c = counts(props.members);
  const now = Date.now();
  return (
    <Layout title="Members · grocery-agent admin" active="/admin/members">
      <StatCardGrid>
        <StatCard icon={<UsersIcon size={15} />} label="Members" value={c.total} />
        <StatCard icon={<CheckCircleIcon size={15} />} label="Active" value={c.active} />
        <StatCard icon={<ClockIcon size={15} />} label="Pending" value={c.pending} />
        <StatCard icon={<LinkIcon size={15} />} label="Kroger linked" value={c.kroger} />
      </StatCardGrid>

      <p class="group-label">Roster</p>
      {/* The island replaces this region with the interactive roster (clickable rows + the
          invite dialog + per-row actions menu) on hydration; this is the first paint. */}
      <div id="members-island">
        {props.members.length === 0 ? (
          <p class="muted">No members yet.</p>
        ) : (
          <ItemGroup>
            {props.members.map((m) => (
              <RosterRow m={m} now={now} />
            ))}
          </ItemGroup>
        )}
      </div>
      <script
        type="application/json"
        id="members-props"
        // deno-lint-ignore react-no-danger -- trusted, server-built JSON (see serializeProps)
        dangerouslySetInnerHTML={{ __html: serializeProps(props) }}
      />
      <script type="module" src="/admin/islands/members.js" />
    </Layout>
  );
};
