// The Members area page (operator-admin), server-rendered. SSR lists the current members
// (proving SSR-via-`src/`-call: `listTenants`); the interactive onboard / rotate / revoke
// controls are hydrated by the Members island, seeded from the same data as JSON props.

import { Layout } from "../ui/layout.js";
import { Card, Table } from "../ui/kit.js";
import type { MembersIslandProps } from "../shared.js";

/** JSON for the island's `<script type="application/json">`, with `<` escaped so the
 *  serialized payload can never close the script element early. */
function serializeProps(props: MembersIslandProps): string {
  return JSON.stringify(props).replace(/</g, "\\u003c");
}

export const MembersPage = ({ props }: { props: MembersIslandProps }) => (
  <Layout title="Members · grocery-agent admin" active="/admin/members">
    <Card>
      <h2>Members</h2>
      {/* The island replaces this region with the interactive list + onboard form on
          hydration; the server-rendered table is the first paint. */}
      <div id="members-island">
        <Table head={<th>member</th>}>
          {props.members.map((m) => (
            <tr>
              <td>{m}</td>
            </tr>
          ))}
        </Table>
      </div>
    </Card>
    <script
      type="application/json"
      id="members-props"
      // deno-lint-ignore react-no-danger -- trusted, server-built JSON (see serializeProps)
      dangerouslySetInnerHTML={{ __html: serializeProps(props) }}
    />
    <script type="module" src="/admin/islands/members.js" />
  </Layout>
);
