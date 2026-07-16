// The Config area's shared chrome (ported from the SSR pages/config.tsx): the pill sub-nav
// over the FIVE routed groups — Discovery (default, bare /config), Ingest Keys, Kroger
// Flyer, Ranking, Deployment — and the titled `cfg-section` wrapper each group composes
// its consoles and editors into.

import * as React from "react";
import { Link } from "@tanstack/react-router";

/** The Config groups (the bare /config is the Discovery default). */
const GROUPS = [
  { to: "/config", label: "Discovery" },
  { to: "/config/ingest-keys", label: "Ingest Keys" },
  { to: "/config/flyer", label: "Kroger Flyer" },
  { to: "/config/ranking", label: "Ranking" },
  { to: "/config/deployment", label: "Deployment" },
] as const;

export const ConfigShell = ({ children }: { children?: React.ReactNode }) => (
  <>
    <div className="data-nav">
      {GROUPS.map((g) => (
        <Link
          key={g.to}
          to={g.to}
          className="pill"
          activeProps={{ className: "pill active" }}
          activeOptions={{ exact: g.to === "/config" }}
        >
          {g.label}
        </Link>
      ))}
    </div>
    {children}
  </>
);

export const Section = ({
  title,
  blurb,
  children,
}: {
  title: string;
  blurb?: string;
  children?: React.ReactNode;
}) => (
  <section className="cfg-section">
    <h3 className="cfg-section-title">{title}</h3>
    {blurb ? <p className="cfg-section-blurb muted">{blurb}</p> : null}
    {children}
  </section>
);
