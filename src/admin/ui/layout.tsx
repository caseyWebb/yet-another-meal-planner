// The admin shell (operator-admin). One server-rendered document per route: the head
// (links the served styles.css), the persistent title + area nav, and the page body. The
// title and nav carry `view-transition-name`s so cross-document View Transitions (Decision
// 8) morph them across full-page navigations instead of flashing.

import type { Child } from "hono/jsx";

interface Area {
  href: string;
  label: string;
}

// The top-level areas. Phase 1 ships Status (home) + Members; the rest light up as their
// pages land, each a new entry here (the areas accumulate, nothing crams onto one page).
const AREAS: Area[] = [
  { href: "/admin", label: "Status" },
  { href: "/admin/members", label: "Members" },
  { href: "/admin/data", label: "Data" },
  { href: "/admin/usage", label: "Usage" },
  { href: "/admin/logs", label: "Logs" },
  { href: "/admin/config", label: "Config" },
];

function navClass(href: string, active: string): string {
  return href === active ? "nav-link active" : "nav-link";
}

export const Layout = ({
  title,
  active,
  wide,
  children,
}: {
  title: string;
  active: string;
  wide?: boolean;
  children?: Child;
}) => (
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <meta name="robots" content="noindex" />
      <title>{title}</title>
      <link rel="stylesheet" href="/admin/styles.css" />
    </head>
    <body>
      <div class={wide ? "wrap wrap-wide" : "wrap"}>
        <h1>grocery-agent admin</h1>
        <nav class="nav">
          {AREAS.map((a) => (
            <a href={a.href} class={navClass(a.href, active)}>
              {a.label}
            </a>
          ))}
        </nav>
        {children}
      </div>
    </body>
  </html>
);
