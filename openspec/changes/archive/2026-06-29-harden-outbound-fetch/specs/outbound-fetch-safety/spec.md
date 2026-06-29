## ADDED Requirements

### Requirement: Server-side fetches validate the target before connecting

Every server-side outbound fetch of an externally-influenced URL SHALL flow through the shared fetch primitive (`fetchWithBrowserHeaders`) — `parse_recipe`, the discovery sweep's feed and recipe-page fetches, and the operator feed-probe all do — and that primitive SHALL, **before opening a connection**, reject a URL that:

- is not `http:` or `https:` (a scheme allowlist; `file:`, `ftp:`, `data:`, etc. are refused);
- carries userinfo (`user[:pass]@host`);
- has a host that is a private, loopback, or link-local **literal** — IPv4 `127.0.0.0/8`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.0.0/16`, `0.0.0.0`; IPv6 `::1`, `fc00::/7` (unique-local), `fe80::/10` (link-local); and the names `localhost` and `*.localhost`.

A rejected target SHALL surface as the **same generic unreachable failure a dead host produces**, carrying no upstream HTTP status — so a caller (an authenticated feed writer or the LLM driving `parse_recipe`) cannot distinguish "blocked internal target" from "host does not exist" and cannot use the outcome as an internal-reachability oracle.

#### Scenario: A non-http scheme is refused

- **WHEN** the primitive is given a URL whose scheme is not `http:` or `https:` (e.g. `file:///etc/passwd`)
- **THEN** it does not open a connection and surfaces a generic unreachable failure with no status

#### Scenario: A private or loopback host is refused without a probe

- **WHEN** the primitive is given a URL whose host is a loopback/link-local/RFC-1918 literal (e.g. `http://127.0.0.1/`, `http://169.254.169.254/`, `http://10.1.2.3/`)
- **THEN** it does not open a connection and surfaces the same generic unreachable failure a dead public host would, carrying no HTTP status

#### Scenario: Embedded credentials are refused

- **WHEN** the primitive is given a URL containing userinfo (e.g. `http://admin:secret@host/`)
- **THEN** it does not open a connection and surfaces a generic unreachable failure

### Requirement: Redirects are followed manually with per-hop re-validation

The primitive SHALL NOT delegate redirect-following to the platform (no `redirect: "follow"`). It SHALL follow redirects **manually**, up to a bounded hop count, re-applying the full target validation (scheme, userinfo, private-host) to each hop's `Location` before following it — so a benign first host cannot 30x-redirect the Worker into a blocked internal target. A redirect chain that exceeds the hop cap, or whose next hop fails validation, SHALL surface as the generic unreachable failure (no status oracle).

#### Scenario: A redirect to an internal target is blocked at the hop

- **WHEN** a reachable public host responds with a 302 whose `Location` is a private/loopback target
- **THEN** the primitive re-validates the hop, refuses to follow it, and surfaces a generic unreachable failure rather than fetching the internal target

#### Scenario: An over-long redirect chain is bounded

- **WHEN** a host returns redirects that exceed the hop cap
- **THEN** the primitive stops following and surfaces a generic unreachable failure

### Requirement: Every fetch is time-bounded

The primitive SHALL abort a fetch that does not complete within a bounded timeout, using an `AbortSignal`, so a host that accepts the connection but never responds surfaces as a **per-call** failure rather than holding the invocation open until the platform kills it. This is what makes a batched caller's per-item `try/catch` isolation able to recover from a *stall* (not only from a rejection/non-2xx): one hung host SHALL NOT prevent the other fetches in the batch from settling.

#### Scenario: A hung host aborts at the timeout

- **WHEN** a host accepts the connection but does not respond within the timeout
- **THEN** the fetch is aborted and surfaces as a per-call unreachable failure

#### Scenario: One stalled host does not stall the batch

- **WHEN** several fetches run concurrently and one host hangs
- **THEN** the hung fetch aborts at its own timeout and the other fetches settle independently (the batch is not held open by the one stall)

### Requirement: Response bodies are read under a size cap

When a caller reads a fetched response body into memory as text before parsing (the feed-poll and feed-probe paths' `res.text()`), it SHALL cap the number of bytes read, so a single oversized or slow-drip feed cannot dominate the invocation's CPU/memory. A body that exceeds the cap SHALL be treated as unusable (surfaced as unreachable/unparseable) rather than read in full.

#### Scenario: An over-cap body is not read in full

- **WHEN** a feed responds with a body larger than the byte cap
- **THEN** the read stops at the cap and the feed is treated as unusable for this tick rather than buffering the entire body

#### Scenario: A normal body parses

- **WHEN** a feed responds with a body within the cap
- **THEN** the body is read and parsed normally

### Requirement: URLs stored for later server-side fetch are validated at write time

A tool that persists a URL the system will later fetch server-side SHALL validate it with the **same public-http guard** at write time and reject a non-conforming URL with `validation_failed`, writing nothing. This applies to every writer of the shared `feeds` table (`update_feeds` and the operator feed editor, which share one write helper). Write-time validation is in **addition** to — not a replacement for — the load-bearing fetch-time guard; it fails fast and keeps a blocked target out of stored config.

#### Scenario: A non-public feed URL is rejected at write

- **WHEN** a feed URL with a non-http scheme, embedded credentials, or a private/loopback/link-local host is submitted to a feed writer
- **THEN** the write is rejected with `validation_failed` and no row is stored

#### Scenario: A public feed URL is stored

- **WHEN** a well-formed public `http`/`https` feed URL is submitted
- **THEN** it passes the guard and is stored (subject to the existing add-only dedup)
