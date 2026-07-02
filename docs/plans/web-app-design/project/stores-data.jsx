/* Store registry for the Data › Stores explorer. Mirrors the real shared corpus:
   the `stores` table (slug, name, domain, identity in `extra`: chain, label,
   address, location_id), the attributed `store_notes` (author + private + tag
   convention: layout / location / stock / general), and the Kroger `sku_cache`
   (keyed by ingredient + location_id), shown against the store its location_id
   belongs to. Only Kroger-chain stores have cached SKUs. Illustrative. */
(function () {
  window.GA = window.GA || {};
  const DAY = 86_400_000;
  const now = Date.now();
  const ago = (d) => now - d * DAY;
  const iso = (d) => { const x = new Date(now - d * DAY); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`; };
  const note = (author, body, tags, priv, d) => ({ author, body, tags, private: !!priv, at: ago(d) });
  const sku = (ingredient, sku_, brand, size, d) => ({ ingredient, sku: sku_, brand, size, last_used: iso(d) });

  const stores = [
    {
      slug: "kroger-hyde-park", name: "Kroger – Hyde Park", domain: "grocery",
      chain: "kroger", label: "the big Kroger", address: "3760 Paxton Ave, Cincinnati OH 45209", location_id: "01400412",
      notes: [
        note("casey", "Aisle 7: baking, spices, oils — flour and yeast at the far end by the bulk bins.", ["layout"], false, 30),
        note("casey", "Aisle 9: international foods. Harissa and gochujang live here, NOT with the condiments.", ["layout", "location"], false, 30),
        note("dlo", "Fish counter closes at 6 PM sharp — get there earlier on weekends.", ["general"], false, 12),
        note("marcus", "Doesn't carry fresh dill, only dried. Get dill at the Findlay stall instead.", ["stock"], false, 8),
        note("casey", "My usual self-checkout PIN reminder — back of the loyalty card.", [], true, 40),
      ],
      skus: [
        sku("salmon fillet", "0001111041700", "Private Selection", "1 lb", 4),
        sku("white miso", "0007373100123", "Hikari Organic", "17.6 oz", 11),
        sku("unsalted butter", "0001111060842", "Kroger", "1 lb", 2),
        sku("jasmine rice", "0001600018621", "Mahatma", "5 lb", 19),
        sku("coconut milk", "0004118200030", "Thai Kitchen", "13.66 oz", 7),
        sku("scallion", "0000000004068", "produce (PLU)", "1 bunch", 4),
        sku("garlic", "0000000004608", "produce (PLU)", "1 head", 3),
        sku("gochujang", "0008557700101", "Chung Jung One", "17.6 oz", 14),
      ],
    },
    {
      slug: "kroger-clifton", name: "Kroger – Clifton", domain: "grocery",
      chain: "kroger", label: "the small Kroger", address: "100 E McMillan St, Cincinnati OH 45219", location_id: "01400388",
      notes: [
        note("priya", "Tiny store — produce is thin after 7 PM. Good for a quick grab, not a full shop.", ["general"], false, 5),
        note("sage", "Aisle 3: pasta, canned tomatoes, oils. Beans share the bottom shelf.", ["layout"], false, 22),
      ],
      skus: [
        sku("dried pasta", "0007680850201", "De Cecco", "1 lb", 6),
        sku("canned tomatoes", "0001111090421", "Kroger", "28 oz", 9),
        sku("chickpeas", "0007089033111", "Goya", "15.5 oz", 13),
        sku("olive oil", "0007349100110", "California Olive Ranch", "16.9 oz", 16),
      ],
    },
    {
      slug: "trader-joes-oakley", name: "Trader Joe's – Oakley", domain: "grocery",
      chain: "trader-joes", label: "TJ's", address: "3038 Madison Rd, Cincinnati OH 45209", location_id: null,
      notes: [
        note("dlo", "Best for frozen, snacks, and cheap flowers. No loyalty SKU lookup — Kroger pricing tools don't apply here.", ["general"], false, 10),
        note("casey", "They stock the cult Unexpected Cheddar — grab two, it goes fast.", ["stock"], false, 18),
      ],
      skus: [],
    },
    {
      slug: "h-mart-west-chester", name: "H Mart – West Chester", domain: "grocery",
      chain: "h-mart", label: "H Mart", address: "9078 Union Centre Blvd, West Chester OH 45069", location_id: null,
      notes: [
        note("casey", "Worth the drive for the really sour kimchi and fresh tofu. Banchan counter in the back-left.", ["layout", "stock"], false, 9),
        note("ortega", "Huge produce selection — Thai basil, perilla, every chili. Parking fills up Sunday afternoons.", ["general"], false, 20),
      ],
      skus: [],
    },
  ];

  function relAge(ms) {
    const s = Math.max(0, Math.floor((now - ms) / 1000));
    if (s < 86400) return `${Math.max(1, Math.floor(s / 3600))}h ago`;
    const d = Math.floor(s / 86400);
    if (d < 14) return `${d}d ago`;
    if (d < 60) return `${Math.floor(d / 7)}w ago`;
    return `${Math.floor(d / 30)}mo ago`;
  }

  window.GA.stores = stores;
  window.GA.storesApi = { relAge };
})();
