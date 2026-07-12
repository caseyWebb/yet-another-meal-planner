## ADDED Requirements

### Requirement: Grocery hosts launch review through shared seams

The shared Grocery component and both host adapters SHALL launch Order Review from current Kroger-online grocery state without embedding a second order implementation. The member host SHALL mount the shared Order Review modal through its adapter; the MCP Grocery host SHALL invoke `display_order_review` or the shared app-callable boot read according to host navigation capability. After a successful send or close, both SHALL return to/refetch the authoritative Grocery snapshot, and no old Order Review stage SHALL become Grocery state.

#### Scenario: Member launch mounts the shared review
- **WHEN** a Kroger-online member chooses Review order from the Grocery page
- **THEN** the page mounts the shared Order Review controller with the member adapter and a fresh preview

#### Scenario: Successful send returns fresh grocery truth
- **WHEN** Order Review sends items and closes to Grocery
- **THEN** Grocery refetches and shows those rows only in their send-linked In cart group, with no staged review choices retained

#### Scenario: Unsupported fulfillment does not launch Kroger review
- **WHEN** the current grocery snapshot is for a non-Kroger-online primary
- **THEN** the Grocery host exposes the appropriate launcher instead of calling the Kroger Order Review operations
