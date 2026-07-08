// Data › Guidance (operator-data-explorer): the breadcrumb browser over the R2
// `guidance/**` tree, ported from the SSR pages/data.tsx. One read discriminated on its
// params — `gpath` renders one object (frontmatter PrettyKV + the Worker-rendered HTML;
// no client markdown), else `gprefix` lists a folder. Both ride validated search params,
// so every folder and file stays deep-linkable.
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Card, ErrorBanner, PrettyKV } from "../components/kit";
import { ChevronLeftIcon, ChevronRightIcon, FileTextIcon, FolderIcon } from "../components/icons";
import { guidanceQuery, type GuidanceData } from "../lib/queries";
import { assertNever } from "../lib/assert";
import { DataShell, queryErrorMessage } from "./data";

/** The guidance browser's URL state: `gpath` (an object) wins over `gprefix` (a folder);
 *  both absent lists the root. Present only when non-empty (defaults omitted). */
export interface GuidanceSearch {
  gpath?: string;
  gprefix?: string;
}

export function validateGuidanceSearch(s: Record<string, unknown>): GuidanceSearch {
  return {
    gpath: typeof s.gpath === "string" && s.gpath !== "" ? s.gpath : undefined,
    gprefix: typeof s.gprefix === "string" && s.gprefix !== "" ? s.gprefix : undefined,
  };
}

function joinPrefix(prefix: string, name: string): string {
  return prefix ? `${prefix.replace(/\/$/, "")}/${name}` : name;
}

/** The breadcrumb segments from a `guidance/**` prefix: `["cooking_techniques", "salt.md"]`
 *  style path parts (root "guidance/" stripped), for both the folder view and a file view. */
function crumbSegments(path: string): string[] {
  return path
    .replace(/^guidance\/?/, "")
    .replace(/\/$/, "")
    .split("/")
    .filter(Boolean);
}

const GuidanceBreadcrumb = ({ segments, fileSeg }: { segments: string[]; fileSeg?: string }) => (
  <div className="g-crumbs">
    <Link className="g-crumb" to="/data/guidance">
      guidance
    </Link>
    {segments.map((seg, i) => (
      <React.Fragment key={segments.slice(0, i + 1).join("/")}>
        <span className="g-crumb-sep">/</span>
        <Link className="g-crumb" to="/data/guidance" search={{ gprefix: segments.slice(0, i + 1).join("/") }}>
          {seg}
        </Link>
      </React.Fragment>
    ))}
    {fileSeg ? (
      <>
        <span className="g-crumb-sep">/</span>
        <span className="g-crumb current">{fileSeg}</span>
      </>
    ) : null}
  </div>
);

const GuidanceObject = ({ payload }: { payload: Extract<GuidanceData, { kind: "object" }> }) => {
  const segments = crumbSegments(payload.path);
  const fileSeg = segments.pop();
  return (
    <DataShell active="guidance" detail>
      <Link
        className="link-action rd-back"
        to="/data/guidance"
        search={{ gprefix: segments.length ? segments.join("/") : undefined }}
      >
        <ChevronLeftIcon size={15} /> Back
      </Link>
      <GuidanceBreadcrumb segments={segments} fileSeg={fileSeg} />
      <p className="group-label">{payload.path}</p>
      {payload.frontmatter ? (
        <Card>
          <PrettyKV obj={payload.frontmatter as Record<string, unknown>} />
        </Card>
      ) : null}
      <Card>
        <div className="md" dangerouslySetInnerHTML={{ __html: payload.html }} />
      </Card>
    </DataShell>
  );
};

const GuidanceListing = ({ payload }: { payload: Extract<GuidanceData, { kind: "listing" }> }) => {
  const segments = crumbSegments(payload.prefix);
  const dirs = payload.listing.entries.filter((e) => e.type === "dir");
  const files = payload.listing.entries.filter((e) => e.type === "file");

  return (
    <>
      <GuidanceBreadcrumb segments={segments} />
      <ul className="g-list">
        {dirs.map((d) => (
          <li key={d.name} className="g-row g-dir">
            <Link to="/data/guidance" search={{ gprefix: joinPrefix(payload.prefix, d.name) }}>
              <span className="g-ico g-ico-dir">
                <FolderIcon size={16} />
              </span>
              <span className="g-name">{d.name}</span>
              <ChevronRightIcon size={15} />
            </Link>
          </li>
        ))}
        {files.map((f) => (
          <li key={f.name} className="g-row g-file">
            <Link to="/data/guidance" search={{ gpath: joinPrefix(payload.prefix, f.name) }}>
              <span className="g-ico g-ico-file">
                <FileTextIcon size={16} />
              </span>
              <span className="g-name">{f.name}</span>
              <span className="g-meta muted small">markdown</span>
              <ChevronRightIcon size={15} />
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
};

/** Discriminate the loaded payload on its `kind` (listing vs object). */
const GuidanceView = ({ payload }: { payload: GuidanceData }) => {
  switch (payload.kind) {
    case "object":
      return <GuidanceObject payload={payload} />;
    case "listing":
      return (
        <DataShell active="guidance">
          <h2>Guidance</h2>
          <GuidanceListing payload={payload} />
        </DataShell>
      );
    default:
      return assertNever(payload);
  }
};

export function GuidanceScreen({ search }: { search: GuidanceSearch }) {
  const query = useQuery(guidanceQuery({ gpath: search.gpath, gprefix: search.gprefix }));
  switch (query.status) {
    case "pending":
      // An object deep-link (`gpath`) renders full-width like its loaded detail; a folder
      // keeps the sub-nav + landmark up while the listing loads.
      return search.gpath ? (
        <p className="screen-loading">Loading …</p>
      ) : (
        <DataShell active="guidance">
          <h2>Guidance</h2>
          <p className="screen-loading">Loading …</p>
        </DataShell>
      );
    case "error":
      return (
        <DataShell active="guidance">
          <h2>Guidance</h2>
          <ErrorBanner message={queryErrorMessage(query.error)} />
        </DataShell>
      );
    case "success":
      return <GuidanceView payload={query.data} />;
    default:
      return assertNever(query);
  }
}
