/* Data area — sub-nav over the data domains. Recipes, Stores, and Guidance are
   built-out explorers; Discovery/System keep reference empty states pending a
   holistic redesign. The sub-nav hides while an individual record is open (the
   detail page owns the full width). Cross-area "open recipe" deep-links land here
   via recipeTarget. */
function DataScreen({ recipeTarget, dataTarget }) {
  const tabs = ["Recipes", "Stores", "Flyer", "Guidance"];
  const [tab, setTab] = React.useState("Recipes");
  const [detail, setDetail] = React.useState(false);
  React.useEffect(() => { if (recipeTarget) setTab("Recipes"); }, [recipeTarget]);
  React.useEffect(() => { if (dataTarget && dataTarget.tab) { setDetail(false); setTab(dataTarget.tab); } }, [dataTarget]);

  const switchTab = (t) => { setDetail(false); setTab(t); };
  const Recipes = window.GA.RecipesScreen;
  const Stores = window.GA.StoresScreen;
  const Flyer = window.GA.FlyerScreen;
  const Guidance = window.GA.GuidanceScreen;

  return (
    <>
      {!detail && (
        <div className="data-nav">
          {tabs.map((t) => (
            <button key={t} className={"pill" + (t === tab ? " active" : "")} onClick={() => switchTab(t)}>{t}</button>
          ))}
        </div>
      )}
      {tab === "Recipes" ? (
        <Recipes onDetailChange={setDetail} openSlug={recipeTarget} />
      ) : tab === "Stores" ? (
        <Stores onDetailChange={setDetail} />
      ) : tab === "Flyer" ? (
        <Flyer onDetailChange={setDetail} />
      ) : (
        <Guidance onDetailChange={setDetail} />
      )}
    </>
  );
}
window.GA = window.GA || {};
window.GA.DataScreen = DataScreen;
