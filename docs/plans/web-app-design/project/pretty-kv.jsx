/* Shared "pretty" renderer for structured records — turns a plain object into a
   readable key/value table (arrays → chips, null → em-dash, urls → links, nested
   objects → indented sub-tables). Used by the recipe detail (frontmatter, D1 row)
   and the member detail (preferences). Exposed on window.GA.PrettyKV. */
function PrettyValue({ v }) {
  if (v === null || v === undefined) return <span className="pv-null">—</span>;
  if (typeof v === "boolean") return <span className="pv-bool">{String(v)}</span>;
  if (typeof v === "number") return <span className="pv-num">{v.toLocaleString()}</span>;
  if (Array.isArray(v)) {
    return v.length ? (
      <span className="pv-chips">{v.map((x, i) => <span className="pv-chip" key={i}>{typeof x === "object" ? JSON.stringify(x) : String(x)}</span>)}</span>
    ) : <span className="pv-null">empty</span>;
  }
  if (typeof v === "object") return <PrettyKV obj={v} nested />;
  if (/^https?:\/\//.test(v)) return <a className="pv-link" href={v} target="_blank" rel="noreferrer">{v}</a>;
  return <span className="pv-str">{v}</span>;
}

function PrettyKV({ obj, nested }) {
  const entries = Object.entries(obj || {});
  if (entries.length === 0) return <p className="muted" style={{ margin: 0 }}>(empty)</p>;
  return (
    <div className={"pkv" + (nested ? " pkv-nested" : "")}>
      {entries.map(([k, v]) => (
        <div className="pkv-row" key={k}>
          <span className="pkv-k">{k}</span>
          <span className="pkv-v"><PrettyValue v={v} /></span>
        </div>
      ))}
    </div>
  );
}
window.GA = window.GA || {};
window.GA.PrettyKV = PrettyKV;
window.GA.PrettyValue = PrettyValue;
