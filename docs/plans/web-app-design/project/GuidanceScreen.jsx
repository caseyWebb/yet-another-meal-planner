/* Data › Guidance — a browser over the R2 guidance/** markdown tree. Navigate
   folders (breadcrumb + folder/file rows); open a file to read its rendered
   markdown. Mirrors guidanceListing (dir browse) / guidanceObject (read).
   Reads GA.guidance. */
function GuidanceScreen({ onDetailChange }) {
  const I = window.GA.icons;
  const root = window.GA.guidance;
  const [path, setPath] = React.useState([]);
  const [file, setFile] = React.useState(null);
  React.useEffect(() => { if (onDetailChange) onDetailChange(!!file); }, [file]);

  function nodeAt(segs) {
    let n = root;
    for (const seg of segs) {
      const next = n.children.find((c) => c.name === seg && c.type === "dir");
      if (!next) return n;
      n = next;
    }
    return n;
  }

  function mdHtml(src) {
    if (window.marked && window.marked.parse) return window.marked.parse(src);
    return "<pre>" + src.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c])) + "</pre>";
  }

  const Breadcrumb = ({ onLeaf }) => (
    <div className="g-crumbs">
      <button className="g-crumb" onClick={() => { setFile(null); setPath([]); }}>guidance</button>
      {path.map((seg, i) => (
        <React.Fragment key={i}>
          <span className="g-crumb-sep">/</span>
          <button className="g-crumb" onClick={() => { setFile(null); setPath(path.slice(0, i + 1)); }}>{seg}</button>
        </React.Fragment>
      ))}
      {file && (
        <>
          <span className="g-crumb-sep">/</span>
          <span className="g-crumb current">{file.name}</span>
        </>
      )}
    </div>
  );

  if (file) {
    return (
      <div className="recipe-detail">
        <button className="link-action rd-back" onClick={() => setFile(null)}><I.chevronLeft size={15} /> Back</button>
        <Breadcrumb />
        <p className="group-label">guidance/{[...path, file.name].join("/")}</p>
        <div className="card"><section><div className="md" dangerouslySetInnerHTML={{ __html: mdHtml(file.body) }} /></section></div>
      </div>
    );
  }

  const cur = nodeAt(path);
  const dirs = cur.children.filter((c) => c.type === "dir");
  const files = cur.children.filter((c) => c.type === "file");

  return (
    <div className="guidance">
      <Breadcrumb />
      <ul className="g-list">
        {dirs.map((dir) => (
          <li key={dir.name} className="g-row g-dir" onClick={() => setPath([...path, dir.name])} role="button" tabIndex={0}
            onKeyDown={(e) => { if (e.key === "Enter") setPath([...path, dir.name]); }}>
            <span className="g-ico g-ico-dir"><I.folder size={16} /></span>
            <span className="g-name">{dir.name}</span>
            <span className="g-meta muted small">{dir.children.length} items</span>
            <I.chevronRight size={15} className="rchev" />
          </li>
        ))}
        {files.map((f) => (
          <li key={f.name} className="g-row g-file" onClick={() => setFile(f)} role="button" tabIndex={0}
            onKeyDown={(e) => { if (e.key === "Enter") setFile(f); }}>
            <span className="g-ico g-ico-file"><I.fileText size={16} /></span>
            <span className="g-name">{f.name}</span>
            <span className="g-meta muted small">markdown</span>
            <I.chevronRight size={15} className="rchev" />
          </li>
        ))}
      </ul>
    </div>
  );
}
window.GA = window.GA || {};
window.GA.GuidanceScreen = GuidanceScreen;
