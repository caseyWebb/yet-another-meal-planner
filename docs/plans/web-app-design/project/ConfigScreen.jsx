/* Config area — the operator calibration console, redesigned for Basecoat.
   Four consolidated groups (Discovery · Kroger Flyer · Ranking · Aliases) over
   the real config schema. Knob consoles use a Clean | Dirty | NeedsConfirm state
   machine: Save is disabled until dirty, and a below-floor value surfaces a
   destructive confirm (the real needsConfirm gate). The Discovery console also
   runs Analyze (cheap) and Dry-run (full pipeline, no writes). Corpus editors
   (feeds, always-import addresses, flyer terms, aliases) list + add + remove;
   feeds additionally probe a URL. Reads GA.config. */
function ConfigScreen({ configTarget }) {
  const { Button, Input, Slider, Switch, Select, Badge, Alert, Dialog, AlertDialog, Field, Empty } = window.DesignSystem_959bdd;
  const I = window.GA.icons;
  const C = window.GA.config;
  const [group, setGroup] = React.useState("Discovery");
  const feedsRef = React.useRef(null);
  const [flashFeeds, setFlashFeeds] = React.useState(false);

  // Cross-area deep link: the Status "RSS feeds" tile lands on Config › Discovery
  // and flags the feeds section.
  React.useEffect(() => {
    if (!configTarget || configTarget.section !== "feeds") return;
    setGroup("Discovery");
    setFlashFeeds(true);
    const t1 = setTimeout(() => {
      const el = feedsRef.current;
      if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 80, behavior: "smooth" });
    }, 90);
    const t2 = setTimeout(() => setFlashFeeds(false), 2200);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [configTarget]);

  // ── A single knob: label + numeric input + slider + help/floor warning ──
  function KnobRow({ knob, value, onChange }) {
    const below = value < knob.floor;
    const disp = knob.pct ? Math.round(value * 100) : value;
    const setFromInput = (raw) => {
      let n = Number(raw);
      if (!Number.isFinite(n)) return;
      if (knob.pct) n = n / 100;
      onChange(n);
    };
    return (
      <div className={"knob" + (below ? " below" : "")}>
        <div className="knob-head">
          <label className="knob-label" htmlFor={"k-" + knob.key}>{knob.label}</label>
          <div className="knob-value">
            <Input id={"k-" + knob.key} type="number" size="sm" step={knob.pct ? 1 : knob.step}
            value={disp} onChange={(e) => setFromInput(e.target.value)} className="knob-input" />
            {knob.pct ? <span className="knob-unit">%</span> : null}
          </div>
        </div>
        <Slider min={knob.min} max={knob.max} step={knob.step} value={value}
        onChange={(e) => onChange(Number(e.target.value))} />
        <p className="knob-help muted small">
          {knob.help}
          {below ? <span className="knob-floor"> · below safe floor ({knob.pct ? Math.round(knob.floor * 100) + "%" : knob.floor})</span> : null}
        </p>
      </div>);

  }

  // ── A knob console with dirty tracking + below-floor confirm ──
  function KnobConsole({ spec, preview }) {
    const init = React.useMemo(() => {
      const o = {};spec.knobs.forEach((k) => {o[k.key] = k.value;});return o;
    }, [spec]);
    const [saved, setSaved] = React.useState(init);
    const [draft, setDraft] = React.useState(init);
    const [confirm, setConfirm] = React.useState(null); // {key,label,floor} | null
    const [savedFlash, setSavedFlash] = React.useState(false);

    const dirty = spec.knobs.some((k) => draft[k.key] !== saved[k.key]);
    const setKnob = (key, v) => {setDraft((d) => ({ ...d, [key]: v }));setConfirm(null);setSavedFlash(false);};

    function save(force) {
      if (!force) {
        const bad = spec.knobs.find((k) => draft[k.key] < k.floor);
        if (bad) {setConfirm({ key: bad.key, label: bad.label, floor: bad.pct ? Math.round(bad.floor * 100) + "%" : bad.floor });return;}
      }
      setSaved({ ...draft });setConfirm(null);setSavedFlash(true);
    }
    function reset() {setDraft({ ...saved });setConfirm(null);}

    return (
      <div className="knob-console">
        <div className="knob-grid">
          {spec.knobs.map((k) =>
          <KnobRow key={k.key} knob={k} value={draft[k.key]} onChange={(v) => setKnob(k.key, v)} />
          )}
        </div>

        {confirm &&
        <Alert variant="destructive" className="cfg-alert">
            <strong>{confirm.label}</strong> is below its safe floor ({confirm.floor}). Saving may degrade the pipeline.
          </Alert>
        }

        <div className="form-actions cfg-actions">
          {confirm ?
          <>
              <Button size="sm" variant="destructive" onClick={() => save(true)}>Confirm &amp; save</Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirm(null)}>Cancel</Button>
            </> :

          <>
              <Button size="sm" disabled={!dirty} onClick={() => save(false)}>Save</Button>
              {dirty && <Button size="sm" variant="ghost" onClick={reset}>Discard</Button>}
              {savedFlash && !dirty && <span className="cfg-saved small"><I.checkCircle size={13} /> Saved</span>}
            </>
          }
        </div>

        {preview && <AnalyzeDryRun draft={draft} />}
      </div>);

  }

  // ── Analyze + Dry-run panels (Discovery only) ──
  function AnalyzeDryRun({ draft }) {
    const [analyze, setAnalyze] = React.useState(null);
    const [dry, setDry] = React.useState(null);
    const [busy, setBusy] = React.useState(null);
    const run = (kind) => {
      setBusy(kind);
      setTimeout(() => {
        if (kind === "analyze") {setAnalyze(C.analyze(draft.tasteThreshold, draft.dedupThreshold));setDry(null);} else
        {setDry(C.dryRun(draft.tasteThreshold));setAnalyze(null);}
        setBusy(null);
      }, 650);
    };
    const OUT = window.GA.discovery.outcomes;
    return (
      <>
        <div className="cfg-preview-actions">
          <Button size="sm" variant="outline" onClick={() => run("analyze")} disabled={busy}>
            <I.target size={13} /> {busy === "analyze" ? "Analyzing…" : "Analyze"}
          </Button>
          <Button size="sm" variant="outline" onClick={() => run("dry")} disabled={busy}>
            <I.scan size={13} /> {busy === "dry" ? "Running…" : "Dry-run"}
          </Button>
          <span className="muted small">Analyze is cheap (no AI). Dry-run runs the full pipeline with no writes.</span>
        </div>

        {analyze &&
        <div className="cfg-result">
            <p className="cfg-result-head">Analyze · matches at τ {draft.tasteThreshold.toFixed(2)}</p>
            <p className="muted small">δ near-duplicate pairs: {analyze.deltaPairCount}{analyze.deltaBounded ? " (sampled)" : ""} · corpus {analyze.deltaCorpusSize} recipes</p>
            <div className="cfg-tau-grid">
              {analyze.memberTau.map((m) =>
            <div className="cfg-tau" key={m.tenant}>
                  <span className="cfg-tau-name">@{m.tenant}</span>
                  <span className="cfg-tau-count">{m.matchCount}<span className="muted"> matches</span></span>
                  {m.coldStart ? <span className="cfg-cold">cold start</span> : null}
                </div>
            )}
            </div>
          </div>
        }

        {dry &&
        <div className="cfg-result">
            <p className="cfg-result-head">Dry-run · {dry.length} candidates (no writes)</p>
            <div className="cfg-dry">
              {dry.map((o, i) =>
            <div className={"cfg-dry-row kind-" + (OUT[o.outcome] ? OUT[o.outcome].kind : "reject")} key={i}>
                  <span className="cfg-dry-out">{OUT[o.outcome] ? OUT[o.outcome].label : o.outcome}</span>
                  <span className="cfg-dry-title">{o.title}</span>
                  {o.wouldMatchMembers.length > 0 && <span className="cfg-dry-who muted small">→ {o.wouldMatchMembers.join(", ")}</span>}
                </div>
            )}
            </div>
          </div>
        }
      </>);

  }

  // ── Generic corpus editor ──
  function CorpusEditor({ title, help, columns, rows: seed, pk, fields, renderCells, probe }) {
    const [rows, setRows] = React.useState(seed);
    const [draft, setDraft] = React.useState({});
    const [probeState, setProbe] = React.useState(null); // {key, status:'testing'|'ok'|'fail', summary}
    const setField = (k, v) => setDraft((d) => ({ ...d, [k]: v }));

    function add() {
      for (const f of fields) if (f.required && !(draft[f.key] || "").trim()) return;
      const row = {};
      fields.forEach((f) => {
        const raw = (draft[f.key] || "").trim();
        if (f.kind === "number") row[f.key] = raw ? Number(raw) : f.default ?? 0;else
        if (f.kind === "tags") row[f.key] = raw ? raw.split(",").map((s) => s.trim()).filter(Boolean) : [];else
        row[f.key] = raw || (f.default ?? "");
      });
      fields.forEach((f) => {if (f.fixed !== undefined) row[f.key] = f.fixed;});
      setRows((r) => [...r, row]);
      setDraft({});
    }
    function remove(key) {setRows((r) => r.filter((x) => x[pk] !== key));}
    function runProbe(url, key) {
      if (!url || !url.trim()) return;
      setProbe({ key, status: "testing" });
      setTimeout(() => {
        const ok = !/contentfarm|t\.co|broken/.test(url);
        setProbe({ key, status: ok ? "ok" : "fail", summary: ok ? "reachable, 24 items · sample: 3 imported, 1 duplicate" : "unreachable" });
      }, 800);
    }

    return (
      <div className="cfg-corpus">
        {help && <p className="cfg-help muted small">{help}</p>}
        <div className="cfg-table-wrap">
          <table className="cfg-table">
            <thead>
              <tr>{columns.map((c) => <th key={c}>{c}</th>)}<th className="cfg-th-act" /></tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const key = String(row[pk]);
                return (
                  <tr key={key}>
                    {renderCells(row)}
                    <td className="cfg-row-act">
                      {probe &&
                      <button className="cfg-mini" onClick={() => runProbe(row[probe], key)} disabled={probeState && probeState.status === "testing"}>
                          {probeState && probeState.key === key && probeState.status === "testing" ? "testing…" : "test"}
                        </button>
                      }
                      {probe && probeState && probeState.key === key && probeState.status !== "testing" &&
                      <span className={"cfg-probe " + probeState.status}>{probeState.summary}</span>
                      }
                      <button className="cfg-remove" onClick={() => remove(key)} aria-label="Remove"><I.trash size={14} /></button>
                    </td>
                  </tr>);

              })}
            </tbody>
          </table>
        </div>

        <div className="cfg-add" data-comment-anchor="bc80524b8f-div-223-9">
          <span className="cfg-add-label">Add</span>
          <div className="cfg-add-fields">
            {fields.filter((f) => f.fixed === undefined).map((f) =>
            f.kind === "select" ?
            <Select key={f.key} size="sm" options={f.options} value={draft[f.key] || f.options[0]} onChange={(e) => setField(f.key, e.target.value)} /> :
            <Input key={f.key} size="sm" type={f.kind === "number" ? "number" : "text"} placeholder={f.label}
            value={draft[f.key] || ""} onChange={(e) => setField(f.key, e.target.value)} className={"cfg-add-" + (f.wide ? "wide" : "norm")} data-comment-anchor="d8c3d7abe2-input-229-13" />
            )}
            <Button size="sm" onClick={add}>Add</Button>
            {probe &&
            <Button size="sm" variant="ghost" onClick={() => runProbe(draft[probe], "__draft__")} disabled={probeState && probeState.status === "testing"}>Test url</Button>
            }
          </div>
          {probe && probeState && probeState.key === "__draft__" && probeState.status !== "testing" &&
          <span className={"cfg-probe " + probeState.status}>{probeState.summary}</span>
          }
        </div>
      </div>);

  }

  // ── Always-import editor (members + automated senders, abstracted) ──
  function AlwaysImport() {
    const [rows, setRows] = React.useState(C.corpus.alwaysImport);
    const [draft, setDraft] = React.useState({});
    const setField = (k, v) => setDraft((d) => ({ ...d, [k]: v }));
    const remove = (addr) => setRows((r) => r.filter((x) => x.address !== addr));
    function add() {
      const address = (draft.address || "").trim();
      if (!address) return;
      setRows((r) => [...r, { address, label: (draft.label || "").trim() || address, kind: draft.kind || "member" }]);
      setDraft({});
    }
    return (
      <div className="cfg-corpus">
        <p className="cfg-help muted small">
          Mail forwarded from these addresses skips taste-matching and is imported directly.
          <strong> Members</strong> are people in your group sharing recipes they like;
          <strong> automated forwards</strong> are third-party newsletters or services you've set up to forward here.
        </p>
        <div className="ai-list">
          {rows.map((r) =>
          <div className="ai-row" key={r.address}>
              <span className={"ai-kind " + r.kind}>{r.kind === "member" ? <I.users size={13} /> : <I.rss size={13} />}</span>
              <div className="ai-id">
                <span className="ai-label">{r.label}</span>
                <span className="ai-addr muted">{r.address}</span>
              </div>
              <Badge variant="outline">{r.kind === "member" ? "member" : "automated"}</Badge>
              <button className="cfg-remove" onClick={() => remove(r.address)} aria-label="Remove"><I.trash size={14} /></button>
            </div>
          )}
        </div>
        <div className="cfg-add">
          <span className="cfg-add-label">Add address</span>
          <div className="cfg-add-fields">
            <Input size="sm" placeholder="email address" value={draft.address || ""} onChange={(e) => setField("address", e.target.value)} className="cfg-add-wide" data-comment-anchor="ec7b9361cb-input-285-13" />
            <Input size="sm" placeholder="label (optional)" value={draft.label || ""} onChange={(e) => setField("label", e.target.value)} className="cfg-add-norm" />
            <Select size="sm" options={[{ value: "member", label: "member" }, { value: "automated", label: "automated forward" }]} value={draft.kind || "member"} onChange={(e) => setField("kind", e.target.value)} />
            <Button size="sm" onClick={add}>Add</Button>
          </div>
        </div>
      </div>);

  }

  // ── Group bodies ──
  function tagCells(arr) {
    return arr && arr.length ? <span className="cfg-tags">{arr.map((t) => <span className="cfg-tag" key={t}>{t}</span>)}</span> : <span className="muted">—</span>;
  }

  function GroupDiscovery() {
    return (
      <>
        <Section title="Calibration" blurb={C.calibration.blurb}>
          <KnobConsole spec={C.calibration} preview />
        </Section>
        <Section title="Discovery feeds" blurb="RSS sources the sweep polls for new candidates. Weight scales a feed's taste contribution; test a URL before adding." sectionRef={feedsRef} flash={flashFeeds}>
          <CorpusEditor
            pk="url" probe="url"
            columns={["feed", "weight", "tags"]}
            rows={C.corpus.feeds}
            fields={[
            { key: "url", label: "feed url", kind: "text", required: true, wide: true },
            { key: "name", label: "name", kind: "text" },
            { key: "weight", label: "weight", kind: "number", default: 1 },
            { key: "tags", label: "tags (comma-sep)", kind: "tags" }]
            }
            renderCells={(row) => <>
              <td><div className="cfg-feed"><span className="cfg-feed-name">{row.name || "—"}</span><span className="cfg-feed-url muted">{row.url.replace(/^https?:\/\//, "")}</span></div></td>
              <td className="cfg-num">{Number(row.weight).toFixed(1)}</td>
              <td>{tagCells(row.tags)}</td>
            </>} />
          
        </Section>
        <Section title="Email Sources" blurb={null}>
          <AlwaysImport />
        </Section>
      </>);

  }

  function GroupFlyer() {
    return (
      <>
        <Section title="Flyer behaviour" blurb={C.flyer.blurb}>
          <KnobConsole spec={C.flyer} />
        </Section>
        <Section title="Flyer terms" blurb="Search terms the flyer warm tracks for deals. The agent adds via its tools; prune noise here.">
          <CorpusEditor
            pk="term"
            columns={["term"]}
            rows={C.corpus.flyerTerms}
            fields={[{ key: "term", label: "term", kind: "text", required: true, wide: true }]}
            renderCells={(row) => <td className="cfg-mono">{row.term}</td>} />
          
        </Section>
      </>);

  }

  function GroupRanking() {
    return (
      <Section title="Ranking weights" blurb={C.ranking.blurb}>
        <KnobConsole spec={C.ranking} />
      </Section>);

  }

  function GroupAliases() {
    return (
      <Section title="Ingredient aliases" blurb="Group-wide alias map — a variant name resolves to its canonical ingredient for pantry + flyer matching.">
        <CorpusEditor
          pk="variant"
          columns={["variant", "canonical"]}
          rows={C.corpus.aliases}
          fields={[
          { key: "variant", label: "variant", kind: "text", required: true },
          { key: "canonical", label: "canonical", kind: "text", required: true }]
          }
          renderCells={(row) => <>
            <td className="cfg-mono">{row.variant}</td>
            <td className="cfg-mono cfg-canon"><I.arrowRight size={12} /> {row.canonical}</td>
          </>} />
        
      </Section>);

  }

  // ── Ingest Keys editor (island — mints/revokes keys for home scrapers) ──
  // Mirrors the invite-code flow: mint reveals the secret ONCE in a callout with
  // a copy button and a "you won't see this again" warning; the row persists, the
  // secret does not. Per-row revoke is destructive with a confirm step.
  function IngestKeys() {
    const N = window.GA.ingest;
    const [rows, setRows] = React.useState(N.scrapers);
    const [open, setOpen] = React.useState(false);      // mint dialog
    const [label, setLabel] = React.useState("");
    const [reveal, setReveal] = React.useState(null);   // { label, secret }
    const [copied, setCopied] = React.useState(false);
    const [confirm, setConfirm] = React.useState(null); // key row pending revoke

    function mint() {
      const l = (label || "").trim().toLowerCase().replace(/\s+/g, "-");
      if (!l) return;
      const secret = N.mintSecret();
      setRows((r) => [
        { id: "ik_" + Math.random().toString(16).slice(2, 6), label: l, prefix: secret.slice(0, 13), created: Date.now(), lastPush: null, status: "active", scraperVersion: null, contractVersion: null, sources: [], sourceCount: 0 },
        ...r,
      ]);
      setReveal({ label: l, secret });
      setCopied(false);
      setLabel("");
      setOpen(false);
    }
    function revoke(row) { setRows((r) => r.map((x) => x.id === row.id ? { ...x, status: "revoked" } : x)); setConfirm(null); }
    function copy() {
      try { navigator.clipboard.writeText(reveal.secret); } catch (e) {}
      setCopied(true);
    }

    return (
      <Section title="Ingest keys" blurb="One key per home-network scraper. A scraper is a machine you run that authenticates to paid recipe sites (it can be configured with several), extracts recipes, and POSTs them in batches to the Worker using its key; accepted batches feed the background discovery sweep. Mint one key per scraper machine.">
        {reveal && (
          <div className="minted" role="status">
            <div className="minted-head">
              <strong>Key minted · {reveal.label}</strong>
              <button className="link-action" onClick={() => setReveal(null)}>Dismiss</button>
            </div>
            <p className="once">Shown once — copy it now. You won't see this secret again; store it in the scraper's config. Revoke and re-mint if it's lost.</p>
            <div className="minted-secret">
              <code className="minted-code">{reveal.secret}</code>
              <Button size="sm" variant={copied ? "secondary" : "outline"} onClick={copy}>
                {copied ? <><I.checkCircle size={13} /> Copied</> : <><I.copy size={13} /> Copy</>}
              </Button>
            </div>
          </div>
        )}

        <div className="roster-head cfg-keys-head">
          <span className="muted small">{rows.filter((k) => k.status === "active").length} active · {rows.length} total</span>
          <Button size="sm" onClick={() => setOpen(true)}><I.key size={14} /> Mint key</Button>
        </div>

        {rows.length === 0 ? (
          <Empty
            icon={<I.key size={22} />}
            title="No ingest keys yet"
            description="Mint one for your home scraper — a box on your network that logs in to a paid recipe site, extracts recipes, and pushes them here."
            action={<Button size="sm" onClick={() => setOpen(true)}><I.key size={14} /> Mint key</Button>}
          />
        ) : (
          <div className="cfg-table-wrap">
            <table className="cfg-table">
              <thead>
                <tr><th>Scraper</th><th>Sources</th><th>Created</th><th>Last used</th><th>Status</th><th className="cfg-th-act" /></tr>
              </thead>
              <tbody>
                {rows.map((k) => (
                  <tr key={k.id} className={k.status === "revoked" ? "cfg-key-revoked" : ""}>
                    <td>
                      <div className="cfg-feed">
                        <span className="cfg-feed-name">{k.label}</span>
                        <span className="cfg-feed-url muted">{k.prefix}…</span>
                      </div>
                    </td>
                    <td>{k.sources && k.sources.length ? <span className="cfg-tags">{k.sources.map((s) => <span className="cfg-tag" key={s.name}>{s.name}</span>)}</span> : <span className="muted small">none yet</span>}</td>
                    <td className="muted small">{N.relAge(k.created)}</td>
                    <td className="small">{k.lastPush == null ? <span className="muted">never</span> : N.relAge(k.lastPush)}</td>
                    <td><Badge variant={k.status === "active" ? "secondary" : "outline"}>{k.status}</Badge></td>
                    <td className="cfg-row-act">
                      {k.status === "active"
                        ? <button className="cfg-key-revoke" onClick={() => setConfirm(k)}>Revoke</button>
                        : <span className="muted small">revoked</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <Dialog
          open={open}
          onClose={() => setOpen(false)}
          title="Mint ingest key"
          description="Name the scraper this key is for. The secret is shown once after minting."
          footer={<>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={mint}>Mint key</Button>
          </>}
        >
          <Field label="Label" htmlFor="ingest-key-label" hint="A name for the scraper — lowercase, no spaces. e.g. home-nas-scraper.">
            <Input id="ingest-key-label" type="text" placeholder="home-nas-scraper"
              value={label} onChange={(e) => setLabel(e.target.value)} />
          </Field>
        </Dialog>

        <AlertDialog
          open={!!confirm}
          onCancel={() => setConfirm(null)}
          onConfirm={() => revoke(confirm)}
          destructive
          title={confirm ? `Revoke ${confirm.label}?` : "Revoke key?"}
          description="The scraper using this key will start getting 401s on its next push. This can't be undone — you'll need to mint a new key and update the scraper."
          confirmText="Revoke key"
        />
      </Section>
    );
  }

  function Section({ title, blurb, children, sectionRef, flash }) {
    return (
      <section className={"cfg-section" + (flash ? " cfg-flash" : "")} ref={sectionRef}>
        <h3 className="cfg-section-title">{title}</h3>
        {blurb && <p className="cfg-section-blurb muted">{blurb}</p>}
        {children}
      </section>);

  }

  const BODY = { Discovery: GroupDiscovery, "Ingest Keys": IngestKeys, "Kroger Flyer": GroupFlyer, Ranking: GroupRanking, Aliases: GroupAliases };
  const Body = BODY[group];

  return (
    <div className="config">
      <div className="data-nav">
        {C.groups.map((g) =>
        <button key={g} className={"pill" + (g === group ? " active" : "")} onClick={() => setGroup(g)}>{g}</button>
        )}
      </div>
      <Body />
    </div>);

}
window.GA = window.GA || {};
window.GA.ConfigScreen = ConfigScreen;