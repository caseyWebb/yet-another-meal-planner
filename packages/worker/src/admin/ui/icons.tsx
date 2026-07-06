// Inline Lucide icons (operator-admin) — Basecoat ships none, so icons used by more than one
// area live here (copy the path data from lucide.dev; admin/CLAUDE.md › Styling).

/** A small wrapper sharing the common SVG attributes every Lucide icon needs. `class` forwards
 *  so a caller can color/position a specific icon (e.g. the Nodes axis directional chevrons). */
const Icon = ({ children, size = 16, class: cls }: { children?: unknown; size?: number; class?: string }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    class={cls}
  >
    {children}
  </svg>
);

export const UsersIcon = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </Icon>
);

export const CheckCircleIcon = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <path d="M21.801 10A10 10 0 1 1 17 3.335" />
    <path d="m9 11 3 3L22 4" />
  </Icon>
);

export const ClockIcon = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <circle cx="12" cy="12" r="10" />
    <polyline points="12 6 12 12 16 14" />
  </Icon>
);

export const LinkIcon = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <path d="M9 17H7A5 5 0 0 1 7 7h2" />
    <path d="M15 7h2a5 5 0 1 1 0 10h-2" />
    <line x1="8" x2="16" y1="12" y2="12" />
  </Icon>
);

export const KeyIcon = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <path d="m15.5 7.5 2.3 2.3a1 1 0 0 0 1.4 0l2.1-2.1a1 1 0 0 0 0-1.4L19 4" />
    <path d="m21 2-9.6 9.6" />
    <circle cx="7.5" cy="15.5" r="5.5" />
  </Icon>
);

export const TrashIcon = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <path d="M3 6h18" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
    <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
  </Icon>
);

export const MoreIcon = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <circle cx="12" cy="12" r="1" />
    <circle cx="19" cy="12" r="1" />
    <circle cx="5" cy="12" r="1" />
  </Icon>
);

export const UserPlusIcon = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <path d="M2 21a8 8 0 0 1 13.292-6" />
    <circle cx="10" cy="8" r="5" />
    <path d="M19 16v6" />
    <path d="M22 19h-6" />
  </Icon>
);

export const ChevronLeftIcon = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <path d="m15 18-6-6 6-6" />
  </Icon>
);

export const DatabaseIcon = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <ellipse cx="12" cy="5" rx="9" ry="3" />
    <path d="M3 5V19A9 3 0 0 0 21 19V5" />
    <path d="M3 12A9 3 0 0 0 21 12" />
  </Icon>
);

export const SparklesIcon = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z" />
    <path d="M20 3v4" />
    <path d="M22 5h-4" />
    <path d="M4 17v2" />
    <path d="M5 18H3" />
  </Icon>
);

export const ActivityIcon = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2" />
  </Icon>
);

// ── Discovery (admin-ui-redesign-discovery) ──────────────────────────────────────────────────

export const TargetIcon = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <circle cx="12" cy="12" r="10" />
    <circle cx="12" cy="12" r="6" />
    <circle cx="12" cy="12" r="2" />
  </Icon>
);

export const DownloadIcon = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <path d="M12 15V3" />
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <path d="m7 10 5 5 5-5" />
  </Icon>
);

export const FileTextIcon = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
    <path d="M14 2v4a2 2 0 0 0 2 2h4" />
    <path d="M10 9H8" />
    <path d="M16 13H8" />
    <path d="M16 17H8" />
  </Icon>
);

export const GitMergeIcon = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <circle cx="18" cy="18" r="3" />
    <circle cx="6" cy="6" r="3" />
    <path d="M6 21V9a9 9 0 0 0 9 9" />
  </Icon>
);

export const ScanIcon = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <path d="M3 7V5a2 2 0 0 1 2-2h2" />
    <path d="M17 3h2a2 2 0 0 1 2 2v2" />
    <path d="M21 17v2a2 2 0 0 1-2 2h-2" />
    <path d="M7 21H5a2 2 0 0 1-2-2v-2" />
  </Icon>
);

export const CompassIcon = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <circle cx="12" cy="12" r="10" />
    <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" />
  </Icon>
);

export const XCircleIcon = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <circle cx="12" cy="12" r="10" />
    <path d="m15 9-6 6" />
    <path d="m9 9 6 6" />
  </Icon>
);

export const MinusCircleIcon = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <circle cx="12" cy="12" r="10" />
    <path d="M8 12h8" />
  </Icon>
);

export const RotateIcon = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
    <path d="M3 3v5h5" />
    <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
    <path d="M16 16h5v5" />
  </Icon>
);

export const RssIcon = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <path d="M4 11a9 9 0 0 1 9 9" />
    <path d="M4 4a16 16 0 0 1 16 16" />
    <circle cx="5" cy="19" r="1" />
  </Icon>
);

export const MailIcon = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <rect width="20" height="16" x="2" y="4" rx="2" />
    <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
  </Icon>
);

export const InboxIcon = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <polyline points="22 12 16 12 14 15 10 15 8 12 2 12" />
    <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
  </Icon>
);

export const ShieldIcon = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
  </Icon>
);

export const ChevronDownIcon = ({ size, class: cls }: { size?: number; class?: string }) => (
  <Icon size={size} class={cls}>
    <path d="m6 9 6 6 6-6" />
  </Icon>
);

export const ChevronRightIcon = ({ size, class: cls }: { size?: number; class?: string }) => (
  <Icon size={size} class={cls}>
    <path d="m9 18 6-6-6-6" />
  </Icon>
);

export const AlertTriangleIcon = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
    <path d="M12 9v4" />
    <path d="M12 17h.01" />
  </Icon>
);

/** A crossed circle — the source-audit quarantine glyph (a block, not a delete). */
export const BanIcon = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <circle cx="12" cy="12" r="10" />
    <path d="m4.9 4.9 14.2 14.2" />
  </Icon>
);

/** Opens-in-a-new-tab — marks an actionable (URL) provenance in the rejection drill-down. */
export const ExternalLinkIcon = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <path d="M15 3h6v6" />
    <path d="M10 14 21 3" />
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
  </Icon>
);

// ── Data explorer (admin-ui-redesign-data) ───────────────────────────────────────────────────

export const SearchIcon = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <circle cx="11" cy="11" r="8" />
    <path d="m21 21-4.3-4.3" />
  </Icon>
);

export const StoreIcon = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <path d="M2 7h20l-1.8 6.3a1 1 0 0 1-1 .7H4.8a1 1 0 0 1-1-.7Z" />
    <path d="M4 7V4a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v3" />
    <path d="M6 14v6a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-6" />
    <path d="M10 21v-4a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v4" />
  </Icon>
);

export const FolderIcon = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
  </Icon>
);

// ── Status (admin-ui-fidelity-pass) ──────────────────────────────────────────────────────────

export const UtensilsIcon = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <path d="M3 2v7c0 1.1.9 2 2 2h0a2 2 0 0 0 2-2V2" />
    <path d="M7 2v20" />
    <path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7" />
  </Icon>
);

// ── Config (admin-ui-fidelity-pass) ──────────────────────────────────────────────────────────

export const ArrowRightIcon = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <path d="M5 12h14" />
    <path d="m12 5 7 7-7 7" />
  </Icon>
);

// ── Normalization › Nodes (ingredient-identity graph) ─────────────────────────────────────────

export const LayersIcon = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z" />
    <path d="M2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 12" />
    <path d="M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 17" />
  </Icon>
);

// ── Insights (group-insights) ─────────────────────────────────────────────────────────────────

export const FlameIcon = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z" />
  </Icon>
);

export const HeartIcon = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" />
  </Icon>
);

export const TrophyIcon = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" />
    <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" />
    <path d="M4 22h16" />
    <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" />
    <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" />
    <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" />
  </Icon>
);

export const TrendingUpIcon = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" />
    <polyline points="16 7 22 7 22 13" />
  </Icon>
);
