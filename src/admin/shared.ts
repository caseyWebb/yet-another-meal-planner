// Island hydration props (operator-admin). These cross the server→client boundary as JSON
// embedded in the page, so they MUST be JSON-serializable (no Date/Map) — the island
// hydrates with state matching the server-render. Shared by the SSR page and the island.

/** Seed for the Members island: the current allowlisted member ids (operational only). */
export interface MembersIslandProps {
  members: string[];
}
