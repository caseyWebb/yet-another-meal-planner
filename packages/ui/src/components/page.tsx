// Shared member-page furniture (member-app-core 6.1): page head, group headings,
// empty-state block, breadcrumb, facet chip — the design bundle's shared bits
// (app-pages.js pageHead/emptyBlock/crumb/facets) as presentational React components
// over the ported cookbook.css classes.
import * as React from "react";
import { IconChevronRight, IconSearch } from "./icons";

/** The page header: title, optional subtitle, optional right-aligned actions. */
export function PageHead(props: { title: string; sub?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <header className="page-head">
      <div>
        <h1>{props.title}</h1>
        {props.sub ? <p>{props.sub}</p> : null}
      </div>
      {props.actions ? <div className="page-head-actions">{props.actions}</div> : null}
    </header>
  );
}

/** The uppercase group heading used by list groupings. */
export function GroupHeading({ children }: { children: React.ReactNode }) {
  return <h2 className="group-h">{children}</h2>;
}

/** Design-system empty state: centered dashed card, accent figure, muted copy. */
export function EmptyState(props: {
  title: string;
  sub: string;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  testId?: string;
}) {
  return (
    <div className="empty" data-testid={props.testId}>
      <header>
        <figure data-accentfig="">{props.icon ?? <IconSearch />}</figure>
        <h2>{props.title}</h2>
        <p>{props.sub}</p>
      </header>
      {props.action ? <div className="empty-action">{props.action}</div> : null}
    </div>
  );
}

export interface CrumbItem {
  label: string;
  /** Rendered by `renderLink` when present; the last item is always plain text. */
  to?: string;
}

/**
 * Breadcrumb trail. `renderLink` injects the SPA's Link (packages/ui stays
 * router-agnostic); the last item renders as the current page.
 */
export function Crumbs(props: {
  items: CrumbItem[];
  renderLink: (to: string, label: string) => React.ReactNode;
}) {
  const parts: React.ReactNode[] = [];
  props.items.forEach((it, i) => {
    if (i) {
      parts.push(
        <li aria-hidden="true" key={`sep-${i}`}>
          <IconChevronRight />
        </li>,
      );
    }
    const last = i === props.items.length - 1;
    parts.push(
      <li key={i}>
        {last || !it.to ? <span aria-current="page">{it.label}</span> : props.renderLink(it.to, it.label)}
      </li>,
    );
  });
  return (
    <nav className="breadcrumb crumbs" aria-label="Breadcrumb">
      <ol>{parts}</ol>
    </nav>
  );
}

/** One facet chip; `kind="protein"` gets the accent treatment. */
export function FacetChip(props: { kind?: "protein" | "time"; children: React.ReactNode }) {
  return (
    <span className="facet" data-kind={props.kind}>
      {props.children}
    </span>
  );
}

/** The recipe facet chips (protein accent + cuisine + optional "{n} min" time) the
 *  list rows and details share. `timeTotal` renders only when numeric — an unknown
 *  time gets no chip, never a fabricated one. */
export function RecipeFacets(props: {
  protein?: string | null;
  cuisine?: string | null;
  timeTotal?: number | null;
}) {
  return (
    <>
      {props.protein ? <FacetChip kind="protein">{props.protein}</FacetChip> : null}
      {props.cuisine ? <FacetChip>{props.cuisine}</FacetChip> : null}
      {typeof props.timeTotal === "number" ? <FacetChip kind="time">{props.timeTotal} min</FacetChip> : null}
    </>
  );
}
