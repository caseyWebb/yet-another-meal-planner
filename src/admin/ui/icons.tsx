// Inline Lucide icons (operator-admin) — Basecoat ships none, so icons used by more than one
// area live here (copy the path data from lucide.dev; admin/CLAUDE.md › Styling).

/** A small wrapper sharing the common SVG attributes every Lucide icon needs. */
const Icon = ({ children, size = 16 }: { children?: unknown; size?: number }) => (
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
