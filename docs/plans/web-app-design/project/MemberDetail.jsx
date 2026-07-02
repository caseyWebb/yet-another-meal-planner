/* Members › member detail — a clicked-through 360° view of one member, with a
   pills sub-nav (the same pattern as Data) over: profile/preferences, pantry,
   meal plan, grocery list, cooking log, and authored recipe notes. Reads
   GA.membersApi.buildMemberDetail. */
function MemberDetail({ m, onBack }) {
  const { Badge, Table } = window.DesignSystem_959bdd;
  const I = window.GA.icons;
  const api = window.GA.membersApi;
  const PrettyKV = window.GA.PrettyKV;
  const openRecipe = (slug) => window.GA.openRecipe && window.GA.openRecipe(slug);
  const PWD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const PMO = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function fmtPlanned(iso) {
    const [y, m, da] = iso.split("-").map(Number);
    const d = new Date(y, m - 1, da);
    return `${PWD[d.getDay()]} · ${PMO[m - 1]} ${da}`;
  }

  const SECTIONS = ["Profile", "Pantry", "Meal plan", "Grocery", "Cooking log", "Notes"];
  const [sec, setSec] = React.useState("Profile");
  const d = React.useMemo(() => api.buildMemberDetail(m), [m.user]);

  const Empty = ({ children }) => <p className="muted" style={{ marginTop: 0 }}>{children}</p>;

  function Section() {
    if (!d.connected) return <Empty>@{m.user} hasn’t connected their Claude.ai yet — no profile or activity to show.</Empty>;
    switch (sec) {
      case "Profile":
        return <div className="card"><section><PrettyKV obj={d.profile} /></section></div>;
      case "Pantry":
        return d.pantry.length === 0 ? <Empty>Pantry is empty.</Empty> : (
          <Table
            columns={["Item", { key: "quantity", label: "Qty", align: "right" }, { key: "category", label: "Category" }, { key: "prepared_from", label: "Prepared from" }, { key: "verified", label: "Last verified", align: "right" }]}
            rows={d.pantry.map((p) => ({
              Item: p.name,
              quantity: p.quantity,
              category: <span className="rfacet">{p.category}</span>,
              prepared_from: p.prepared_from ? <span className="md-prep">{p.prepared_from}</span> : <span className="pv-null">—</span>,
              verified: <span className="muted small">{p.last_verified_at}</span>,
            }))}
          />
        );
      case "Meal plan":
        return d.mealPlan.length === 0 ? <Empty>No meals planned.</Empty> : (
          <div className="md-plan">
            {d.mealPlan.map((p) => (
              <div className="md-plan-row" key={p.recipe}>
                <span className="md-plan-day">{p.planned_for ? fmtPlanned(p.planned_for) : <span className="muted">Unscheduled</span>}</span>
                <span className="md-plan-recipe">
                  <button className="md-recipe-link" onClick={() => openRecipe(p.recipe)}>{p.title}</button>
                  <span className="rslug">{p.recipe}</span>
                </span>
                {p.sides.length > 0 && <span className="md-plan-sides">+ {p.sides.join(", ")}</span>}
              </div>
            ))}
          </div>
        );
      case "Grocery": {
        if (d.grocery.length === 0) return <Empty>Grocery list is empty.</Empty>;
        return (
          <div className="md-grocery-list">
            {d.grocery.map((g, i) => (
              <div className="md-gitem" key={i}>
                <span className={"md-gstatus" + (g.status === "in_cart" ? " in-cart" : "")} title={g.status === "in_cart" ? "in cart" : "active"} />
                <div className="md-gmain">
                  <div className="md-gtop">
                    <span className="md-gname">{g.name}</span>
                    <span className="md-gqty muted small">{g.quantity}</span>
                    {g.status === "in_cart" && <span className="md-incart">in cart</span>}
                  </div>
                  <div className="md-gsub">
                    <span className="rfacet md-gsrc">{g.source.replace("_", "-")}</span>
                    {g.for_recipes.length > 0 && (
                      <span className="md-gfor muted small">for {g.for_recipes.map((s, j) => (
                        <React.Fragment key={s}>{j > 0 ? ", " : ""}<button className="md-recipe-link sm" onClick={() => openRecipe(s)}>{s}</button></React.Fragment>
                      ))}</span>
                    )}
                    {g.note && <span className="md-gnote muted small">· {g.note}</span>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        );
      }
      case "Cooking log":
        return d.cookingLog.length === 0 ? <Empty>No cooking history yet.</Empty> : (
          <Table
            columns={["Date", "Dish", { key: "protein", label: "Protein" }, { key: "cuisine", label: "Cuisine" }, { key: "type", label: "Type", align: "right" }]}
            rows={d.cookingLog.map((c) => ({
              Date: <span className="muted small">{c.date}</span>,
              Dish: c.recipe ? <span className="md-log-dish"><button className="md-recipe-link" onClick={() => openRecipe(c.recipe)}>{c.title}</button> <span className="rslug">{c.recipe}</span></span> : <span className="md-log-title">{c.title}</span>,
              protein: c.protein ? <span className="rfacet">{c.protein}</span> : <span className="pv-null">—</span>,
              cuisine: c.cuisine ? <span className="rfacet">{c.cuisine}</span> : <span className="pv-null">—</span>,
              type: <span className={"md-type md-type-" + c.type}>{c.type}</span>,
            }))}
          />
        );
      case "Notes":
        return d.notes.length === 0 ? <Empty>@{m.user} hasn’t written any recipe notes.</Empty> : (
          <div className="rd-notes">
            {d.notes.map((n, i) => (
              <div className="rd-note" key={i}>
                <div className="rd-note-head">
                  <span className="md-note-recipe">{n.title}</span>
                  {n.private && <Badge variant="outline">private</Badge>}
                  {n.tags.map((t) => <span className="rfacet" key={t}>{t}</span>)}
                  <span className="rd-note-time muted small">{api.relAge(n.at)}</span>
                </div>
                <div className="rd-note-body">{n.body}</div>
              </div>
            ))}
          </div>
        );
      default:
        return null;
    }
  }

  return (
    <div className="member-detail">
      <button className="link-action rd-back" onClick={onBack}><I.chevronLeft size={15} /> All members</button>

      <div className="md-head">
        <div className="md-id">
          <span className="md-user">@{m.user}</span>
          {m.owner && <Badge variant="secondary">owner</Badge>}
          {m.status === "active" ? <Badge variant="secondary">active</Badge> : <Badge variant="outline">pending</Badge>}
          {m.kroger === "linked" && <Badge variant="secondary"><I.link size={11} /> kroger</Badge>}
        </div>
        {m.status === "active" && (
          <div className="md-stats muted small">
            {m.cooked} recipes cooked · {m.favorites} favorites · joined {api.relAge(m.joined)}
          </div>
        )}
      </div>

      <div className="data-nav">
        {SECTIONS.map((s) => (
          <button key={s} className={"pill" + (s === sec ? " active" : "")} onClick={() => setSec(s)}>{s}</button>
        ))}
      </div>

      <Section />
    </div>
  );
}
window.GA = window.GA || {};
window.GA.MemberDetail = MemberDetail;
