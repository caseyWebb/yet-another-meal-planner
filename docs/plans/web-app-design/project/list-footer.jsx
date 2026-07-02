/* Shared list footer — a page-size selector (25 / 50 / 100) plus the
   design-system <Pagination>. Every paginated list in the admin (Recipes,
   Flyer, Discovery, Logs) renders this so pagination is consistent.
   `page` and `onPage` are 0-indexed; DS <Pagination> is 1-indexed, so we
   translate at the boundary. The row-count selector always shows (even on a
   single page); the numbered nav only appears when there's more than one. */
function ListFooter({ page, pageSize, total, onPage, onPageSize, noun = "item", pageSizeOptions = [25, 50, 100] }) {
  const { Pagination, Select } = window.DesignSystem_959bdd;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const pg = Math.min(page, pages - 1);
  const start = total === 0 ? 0 : pg * pageSize + 1;
  const end = Math.min(total, pg * pageSize + pageSize);
  const label = total === 0
    ? `No ${noun}s`
    : `${start}\u2013${end} of ${total} ${total === 1 ? noun : noun + "s"}`;

  return (
    <div className="list-footer">
      <div className="lf-left">
        <span className="lf-count muted small">{label}</span>
        <label className="lf-size">
          <span className="muted small">Rows</span>
          <Select
            size="sm"
            value={String(pageSize)}
            onChange={(e) => onPageSize(Number(e.target.value))}
            options={pageSizeOptions.map((n) => String(n))}
          />
        </label>
      </div>
      {pages > 1 && (
        <Pagination page={pg + 1} total={pages} onChange={(p) => onPage(p - 1)} />
      )}
    </div>
  );
}
window.GA = window.GA || {};
window.GA.ListFooter = ListFooter;
