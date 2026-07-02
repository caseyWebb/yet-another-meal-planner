/* @ds-bundle: {"format":3,"namespace":"DesignSystem_959bdd","components":[{"name":"Badge","sourcePath":"components/actions/Badge.jsx"},{"name":"Button","sourcePath":"components/actions/Button.jsx"},{"name":"ButtonGroup","sourcePath":"components/actions/ButtonGroup.jsx"},{"name":"Accordion","sourcePath":"components/display/Accordion.jsx"},{"name":"Avatar","sourcePath":"components/display/Avatar.jsx"},{"name":"Breadcrumb","sourcePath":"components/display/Breadcrumb.jsx"},{"name":"Card","sourcePath":"components/display/Card.jsx"},{"name":"Chart","sourcePath":"components/display/Chart.jsx"},{"name":"Item","sourcePath":"components/display/Item.jsx"},{"name":"ItemGroup","sourcePath":"components/display/Item.jsx"},{"name":"Kbd","sourcePath":"components/display/Kbd.jsx"},{"name":"Separator","sourcePath":"components/display/Kbd.jsx"},{"name":"ScrollArea","sourcePath":"components/display/ScrollArea.jsx"},{"name":"Table","sourcePath":"components/display/Table.jsx"},{"name":"Tabs","sourcePath":"components/display/Tabs.jsx"},{"name":"Alert","sourcePath":"components/feedback/Alert.jsx"},{"name":"Empty","sourcePath":"components/feedback/Empty.jsx"},{"name":"Progress","sourcePath":"components/feedback/Progress.jsx"},{"name":"Skeleton","sourcePath":"components/feedback/Spinner.jsx"},{"name":"Spinner","sourcePath":"components/feedback/Spinner.jsx"},{"name":"Toast","sourcePath":"components/feedback/Toast.jsx"},{"name":"Toaster","sourcePath":"components/feedback/Toast.jsx"},{"name":"Checkbox","sourcePath":"components/forms/Checkbox.jsx"},{"name":"Combobox","sourcePath":"components/forms/Combobox.jsx"},{"name":"Field","sourcePath":"components/forms/Field.jsx"},{"name":"Input","sourcePath":"components/forms/Input.jsx"},{"name":"InputGroupAddon","sourcePath":"components/forms/InputGroup.jsx"},{"name":"InputGroup","sourcePath":"components/forms/InputGroup.jsx"},{"name":"Label","sourcePath":"components/forms/Label.jsx"},{"name":"Radio","sourcePath":"components/forms/RadioGroup.jsx"},{"name":"RadioGroup","sourcePath":"components/forms/RadioGroup.jsx"},{"name":"Select","sourcePath":"components/forms/Select.jsx"},{"name":"Slider","sourcePath":"components/forms/Slider.jsx"},{"name":"Switch","sourcePath":"components/forms/Switch.jsx"},{"name":"Textarea","sourcePath":"components/forms/Textarea.jsx"},{"name":"Command","sourcePath":"components/navigation/Command.jsx"},{"name":"Pagination","sourcePath":"components/navigation/Pagination.jsx"},{"name":"Sidebar","sourcePath":"components/navigation/Sidebar.jsx"},{"name":"ThemeSwitcher","sourcePath":"components/navigation/ThemeSwitcher.jsx"},{"name":"AlertDialog","sourcePath":"components/overlay/AlertDialog.jsx"},{"name":"Dialog","sourcePath":"components/overlay/Dialog.jsx"},{"name":"Drawer","sourcePath":"components/overlay/Drawer.jsx"},{"name":"DropdownMenu","sourcePath":"components/overlay/DropdownMenu.jsx"},{"name":"Popover","sourcePath":"components/overlay/Popover.jsx"},{"name":"Tooltip","sourcePath":"components/overlay/Tooltip.jsx"}],"sourceHashes":{"components/actions/Badge.jsx":"99889218a12d","components/actions/Button.jsx":"fb453784c327","components/actions/ButtonGroup.jsx":"f2df96ad4260","components/display/Accordion.jsx":"965b11d38843","components/display/Avatar.jsx":"53ef25c0c278","components/display/Breadcrumb.jsx":"74e4b597e28c","components/display/Card.jsx":"3099c0d70421","components/display/Chart.jsx":"fce866666661","components/display/Item.jsx":"efa693eb931d","components/display/Kbd.jsx":"b7940392ddc3","components/display/ScrollArea.jsx":"88c06ef1fe4b","components/display/Table.jsx":"cdd12f908b6f","components/display/Tabs.jsx":"c132f0adf81f","components/feedback/Alert.jsx":"e2b8f5ea5ba4","components/feedback/Empty.jsx":"871e8a2f908f","components/feedback/Progress.jsx":"cc42712d3f11","components/feedback/Spinner.jsx":"8faa5a1af4d2","components/feedback/Toast.jsx":"89b3656475f4","components/forms/Checkbox.jsx":"84a5e0d338fc","components/forms/Combobox.jsx":"387bc27b16fa","components/forms/Field.jsx":"f245c880c63f","components/forms/Input.jsx":"8b965bd7828e","components/forms/InputGroup.jsx":"74c493e89f67","components/forms/Label.jsx":"7c4cc36ab671","components/forms/RadioGroup.jsx":"50c7beb6ca5f","components/forms/Select.jsx":"e43eb4792aa7","components/forms/Slider.jsx":"650ef5db2efe","components/forms/Switch.jsx":"c2c0cbc14f8f","components/forms/Textarea.jsx":"b0f02c5568e0","components/navigation/Command.jsx":"5ad8be3ba87f","components/navigation/Pagination.jsx":"516273c72226","components/navigation/Sidebar.jsx":"8120b1c83e31","components/navigation/ThemeSwitcher.jsx":"b4014803eae8","components/overlay/AlertDialog.jsx":"2ff20972470f","components/overlay/Dialog.jsx":"a7bbb7847507","components/overlay/Drawer.jsx":"4170fbbfb039","components/overlay/DropdownMenu.jsx":"c3a22716faca","components/overlay/Popover.jsx":"2a44803f5a5e","components/overlay/Tooltip.jsx":"b2b85d281c43","ui_kits/grocery-admin/ConfigScreen.jsx":"f7a2ced562ab","ui_kits/grocery-admin/DataScreen.jsx":"31adbc2aa712","ui_kits/grocery-admin/MembersScreen.jsx":"4cffadee2aed","ui_kits/grocery-admin/StatusScreen.jsx":"c59d6a1d9b62","ui_kits/grocery-admin/UsageScreen.jsx":"b2a283f05182","ui_kits/grocery-admin/icons.jsx":"6f86bd2a0716"},"inlinedExternals":[],"unexposedExports":[]} */

(() => {

const __ds_ns = (window.DesignSystem_959bdd = window.DesignSystem_959bdd || {});

const __ds_scope = {};

(__ds_ns.__errors = __ds_ns.__errors || []);

// components/actions/Badge.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Basecoat badge — a small status / count label. Emits `.badge` plus
 * `data-variant`. Renders a `<span>` by default; pass `as="a"` for a clickable
 * badge (hover state applies automatically).
 */
function Badge({
  variant = "primary",
  as: Tag = "span",
  children,
  className = "",
  ...props
}) {
  const cls = ["badge", className].filter(Boolean).join(" ");
  return /*#__PURE__*/React.createElement(Tag, _extends({
    className: cls,
    "data-variant": variant === "primary" ? undefined : variant
  }, props), children);
}
Object.assign(__ds_scope, { Badge });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/actions/Badge.jsx", error: String((e && e.message) || e) }); }

// components/actions/Button.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Basecoat button. Emits `.btn` plus `data-variant` / `data-size`, matching
 * Basecoat's HTML API exactly. Renders a `<button>` by default, or any element
 * via `as` (e.g. `as="a"` for a link-button).
 */
function Button({
  variant = "primary",
  size = "default",
  as: Tag = "button",
  type,
  children,
  className = "",
  ...props
}) {
  const cls = ["btn", className].filter(Boolean).join(" ");
  return /*#__PURE__*/React.createElement(Tag, _extends({
    className: cls,
    type: Tag === "button" ? type || "button" : type,
    "data-variant": variant === "primary" ? undefined : variant,
    "data-size": size === "default" ? undefined : size
  }, props), children);
}
Object.assign(__ds_scope, { Button });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/actions/Button.jsx", error: String((e && e.message) || e) }); }

// components/actions/ButtonGroup.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Basecoat button group — a joined row (or column) of `.btn`s that share
 * collapsed borders. Pass `<Button>`s (or any `.btn` elements) as children.
 * Set `orientation="vertical"` to stack them. Purely presentational; wire the
 * buttons' own `onClick`/`aria-pressed` for segmented/toggle behavior.
 */
function ButtonGroup({
  orientation = "horizontal",
  children,
  className = "",
  ...props
}) {
  const cls = ["btn-group", className].filter(Boolean).join(" ");
  return /*#__PURE__*/React.createElement("div", _extends({
    className: cls,
    role: "group",
    "data-orientation": orientation === "vertical" ? "vertical" : undefined
  }, props), children);
}
Object.assign(__ds_scope, { ButtonGroup });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/actions/ButtonGroup.jsx", error: String((e && e.message) || e) }); }

// components/display/Accordion.jsx
try { (() => {
const Chevron = () => /*#__PURE__*/React.createElement("svg", {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: "2",
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": "true"
}, /*#__PURE__*/React.createElement("path", {
  d: "m6 9 6 6 6-6"
}));

/**
 * Basecoat accordion. Pass `items` as `[{ title, content }]`. Built on native
 * `<details>` — set `multiple={false}` to make items mutually exclusive
 * (shared `name`, so opening one closes the others).
 */
function Accordion({
  items = [],
  multiple = true,
  className = ""
}) {
  const cls = ["accordion", className].filter(Boolean).join(" ");
  const name = React.useMemo(() => "acc-" + Math.random().toString(36).slice(2, 8), []);
  return /*#__PURE__*/React.createElement("div", {
    className: cls
  }, items.map((it, i) => /*#__PURE__*/React.createElement("details", {
    key: i,
    name: multiple ? undefined : name,
    open: it.open
  }, /*#__PURE__*/React.createElement("summary", null, it.title, /*#__PURE__*/React.createElement(Chevron, null)), /*#__PURE__*/React.createElement("div", null, it.content))));
}
Object.assign(__ds_scope, { Accordion });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/display/Accordion.jsx", error: String((e && e.message) || e) }); }

// components/display/Avatar.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Basecoat avatar. Pass `src` for an image, or `fallback` (initials) shown on
 * a muted circle. If both are given, the image wins and falls back on error.
 */
function Avatar({
  src,
  alt = "",
  fallback,
  size = "default",
  className = "",
  ...props
}) {
  const cls = ["avatar", className].filter(Boolean).join(" ");
  const [errored, setErrored] = React.useState(false);
  return /*#__PURE__*/React.createElement("span", _extends({
    className: cls,
    "data-size": size === "default" ? undefined : size
  }, props), src && !errored ? /*#__PURE__*/React.createElement("img", {
    src: src,
    alt: alt,
    onError: () => setErrored(true)
  }) : /*#__PURE__*/React.createElement("span", null, fallback));
}
Object.assign(__ds_scope, { Avatar });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/display/Avatar.jsx", error: String((e && e.message) || e) }); }

// components/display/Breadcrumb.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const Sep = () => /*#__PURE__*/React.createElement("svg", {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: "2",
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": "true"
}, /*#__PURE__*/React.createElement("path", {
  d: "m9 18 6-6-6-6"
}));

/**
 * Basecoat breadcrumb. Pass `items` as `[{ label, href }]`; the last item is
 * rendered as the current page (no link).
 */
function Breadcrumb({
  items = [],
  className = "",
  ...props
}) {
  const cls = ["breadcrumb", className].filter(Boolean).join(" ");
  return /*#__PURE__*/React.createElement("nav", _extends({
    className: cls,
    "aria-label": "Breadcrumb"
  }, props), /*#__PURE__*/React.createElement("ol", null, items.map((it, i) => {
    const last = i === items.length - 1;
    return /*#__PURE__*/React.createElement("li", {
      key: i
    }, last || !it.href ? /*#__PURE__*/React.createElement("span", {
      "aria-current": last ? "page" : undefined
    }, it.label) : /*#__PURE__*/React.createElement("a", {
      href: it.href
    }, it.label), !last && /*#__PURE__*/React.createElement("span", {
      "aria-hidden": "true",
      style: {
        display: "inline-flex"
      }
    }, /*#__PURE__*/React.createElement(Sep, null)));
  })));
}
Object.assign(__ds_scope, { Breadcrumb });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/display/Breadcrumb.jsx", error: String((e && e.message) || e) }); }

// components/display/Card.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Basecoat card — a contained surface (rounded-xl, 1px ring, subtle shadow).
 * Pass `title`/`description` to render the header, `footer` for the footer
 * row, and the main content as children (rendered in the padded section).
 */
function Card({
  title,
  description,
  footer,
  size = "default",
  children,
  className = "",
  ...props
}) {
  const cls = ["card", className].filter(Boolean).join(" ");
  return /*#__PURE__*/React.createElement("div", _extends({
    className: cls,
    "data-size": size === "sm" ? "sm" : undefined
  }, props), (title != null || description != null) && /*#__PURE__*/React.createElement("header", null, title != null && /*#__PURE__*/React.createElement("h3", {
    className: "card-title"
  }, title), description != null && /*#__PURE__*/React.createElement("p", {
    className: "card-description"
  }, description)), children != null && /*#__PURE__*/React.createElement("section", null, children), footer != null && /*#__PURE__*/React.createElement("footer", null, footer));
}
Object.assign(__ds_scope, { Card });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/display/Card.jsx", error: String((e && e.message) || e) }); }

// components/display/Chart.jsx
try { (() => {
const RAMP = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"];
const fmt = n => typeof n === "number" ? n.toLocaleString() : n;
function niceMax(v) {
  if (v <= 0) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / pow;
  const f = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
  return f * pow;
}

// Resolve the series map (or inferred keys) into an ordered list with colors.
function resolveSeries(series, data, labelKey) {
  let entries;
  if (series && Object.keys(series).length) {
    entries = Object.entries(series).map(([key, v]) => ({
      key,
      ...(v || {})
    }));
  } else {
    const keys = data.length ? Object.keys(data[0]).filter(k => k !== labelKey && typeof data[0][k] === "number") : [];
    entries = keys.map(key => ({
      key
    }));
  }
  return entries.map((e, i) => ({
    label: e.label || e.key,
    color: e.color || RAMP[i % RAMP.length],
    surface: e.surface,
    ...e
  }));
}

/* -------------------------------------------------- Cartesian (bar/line/area) */
function Cartesian({
  type,
  data,
  labelKey,
  seriesList,
  stacked,
  tooltip,
  yTicks,
  active,
  setActive
}) {
  const W = 640,
    H = 340;
  const pad = {
    top: 12,
    right: 8,
    bottom: 26,
    left: 40
  };
  const iw = W - pad.left - pad.right;
  const ih = H - pad.top - pad.bottom;
  const totals = data.map(d => stacked ? seriesList.reduce((s, se) => s + (+d[se.key] || 0), 0) : Math.max(0, ...seriesList.map(se => +d[se.key] || 0)));
  const max = niceMax(Math.max(1, ...totals));
  const y = v => pad.top + ih - v / max * ih;
  const bandW = iw / data.length;
  const cx = i => pad.left + i * bandW + bandW / 2;
  const ticks = Array.from({
    length: yTicks + 1
  }, (_, i) => max / yTicks * i);
  const paths = seriesList.map((se, si) => {
    const pts = data.map((d, i) => [cx(i), y(+d[se.key] || 0)]);
    const line = pts.map((p, i) => (i ? "L" : "M") + p[0] + " " + p[1]).join(" ");
    const fill = type === "area" || se.surface ? `${line} L ${pts[pts.length - 1][0]} ${y(0)} L ${pts[0][0]} ${y(0)} Z` : null;
    return {
      se,
      si,
      pts,
      line,
      fill
    };
  });
  return /*#__PURE__*/React.createElement("svg", {
    viewBox: `0 0 ${W} ${H}`,
    role: "img"
  }, /*#__PURE__*/React.createElement("g", {
    className: "chart-grid"
  }, ticks.map((t, i) => /*#__PURE__*/React.createElement("line", {
    key: i,
    x1: pad.left,
    x2: W - pad.right,
    y1: y(t),
    y2: y(t)
  }))), /*#__PURE__*/React.createElement("g", {
    className: "chart-axis"
  }, ticks.map((t, i) => /*#__PURE__*/React.createElement("text", {
    key: i,
    x: pad.left - 8,
    y: y(t) + 3,
    textAnchor: "end"
  }, fmt(Math.round(t)))), data.map((d, i) => /*#__PURE__*/React.createElement("text", {
    key: i,
    x: cx(i),
    y: H - 8,
    textAnchor: "middle"
  }, d[labelKey]))), type === "bar" && data.map((d, i) => {
    if (stacked) {
      let acc = 0;
      return seriesList.map(se => {
        const v = +d[se.key] || 0;
        const h = v / max * ih;
        const yTop = y(acc + v);
        acc += v;
        const bw = bandW * 0.62;
        return /*#__PURE__*/React.createElement("rect", {
          key: se.key,
          className: "chart-bar",
          x: cx(i) - bw / 2,
          y: yTop,
          width: bw,
          height: Math.max(0, h),
          rx: "3",
          fill: se.color,
          opacity: active == null || active === i ? 1 : 0.4
        });
      });
    }
    const groupW = bandW * 0.62;
    const bw = groupW / seriesList.length;
    return seriesList.map((se, si) => {
      const v = +d[se.key] || 0;
      const h = v / max * ih;
      return /*#__PURE__*/React.createElement("rect", {
        key: se.key,
        className: "chart-bar",
        x: cx(i) - groupW / 2 + si * bw + 1,
        y: y(v),
        width: Math.max(0, bw - 2),
        height: Math.max(0, h),
        rx: "3",
        fill: se.color,
        opacity: active == null || active === i ? 1 : 0.4
      });
    });
  }), (type === "line" || type === "area") && paths.map(({
    se,
    si,
    line,
    fill,
    pts
  }) => /*#__PURE__*/React.createElement("g", {
    key: se.key
  }, fill && /*#__PURE__*/React.createElement("path", {
    d: fill,
    fill: se.color,
    opacity: "0.15"
  }), /*#__PURE__*/React.createElement("path", {
    d: line,
    fill: "none",
    stroke: se.color,
    strokeWidth: "2",
    strokeLinejoin: "round",
    strokeLinecap: "round"
  }), pts.map((p, i) => /*#__PURE__*/React.createElement("circle", {
    key: i,
    cx: p[0],
    cy: p[1],
    r: active === i ? 4 : 0,
    fill: "var(--background)",
    stroke: se.color,
    strokeWidth: "2"
  })))), active != null && /*#__PURE__*/React.createElement("line", {
    className: "chart-hoverline",
    style: {
      opacity: type === "line" || type === "area" ? 1 : 0
    },
    x1: cx(active),
    x2: cx(active),
    y1: pad.top,
    y2: pad.top + ih
  }), data.map((d, i) => /*#__PURE__*/React.createElement("rect", {
    key: i,
    x: pad.left + i * bandW,
    y: pad.top,
    width: bandW,
    height: ih,
    fill: "transparent",
    onMouseEnter: () => setActive(i),
    onMouseLeave: () => setActive(null)
  })));
}

/* --------------------------------------------------------------- Donut / pie */
function Radial({
  type,
  data,
  labelKey,
  seriesList,
  active,
  setActive
}) {
  const key = seriesList[0] ? seriesList[0].key : null;
  const S = 240,
    r = 100,
    cx = S / 2,
    cy = S / 2;
  const inner = type === "donut" ? 62 : 0;
  const rows = data.map((d, i) => ({
    label: d[labelKey],
    value: +d[key] || 0,
    color: d.color || RAMP[i % RAMP.length]
  }));
  const total = rows.reduce((s, r) => s + r.value, 0) || 1;
  let a0 = -Math.PI / 2;
  const arc = (a1, a2, rad) => {
    const large = a2 - a1 > Math.PI ? 1 : 0;
    const x1 = cx + rad * Math.cos(a1),
      y1 = cy + rad * Math.sin(a1);
    const x2 = cx + rad * Math.cos(a2),
      y2 = cy + rad * Math.sin(a2);
    return {
      x1,
      y1,
      x2,
      y2,
      large
    };
  };
  const slices = rows.map((row, i) => {
    const a1 = a0,
      a2 = a0 + row.value / total * Math.PI * 2;
    a0 = a2;
    const o = arc(a1, a2, r),
      ii = arc(a1, a2, inner);
    const d = inner ? `M ${o.x1} ${o.y1} A ${r} ${r} 0 ${o.large} 1 ${o.x2} ${o.y2} L ${ii.x2} ${ii.y2} A ${inner} ${inner} 0 ${o.large} 0 ${ii.x1} ${ii.y1} Z` : `M ${cx} ${cy} L ${o.x1} ${o.y1} A ${r} ${r} 0 ${o.large} 1 ${o.x2} ${o.y2} Z`;
    return {
      ...row,
      d,
      i
    };
  });
  return /*#__PURE__*/React.createElement("svg", {
    viewBox: `0 0 ${S} ${S}`,
    role: "img"
  }, slices.map(s => /*#__PURE__*/React.createElement("path", {
    key: s.i,
    d: s.d,
    fill: s.color,
    opacity: active == null || active === s.i ? 1 : 0.4,
    stroke: "var(--background)",
    strokeWidth: "2",
    onMouseEnter: () => setActive(s.i),
    onMouseLeave: () => setActive(null)
  })), inner > 0 && active != null && /*#__PURE__*/React.createElement("text", {
    x: cx,
    y: cy,
    textAnchor: "middle",
    dominantBaseline: "middle",
    style: {
      fill: "var(--foreground)",
      fontSize: "18px",
      fontWeight: 600
    }
  }, fmt(rows[active].value)));
}

/**
 * Basecoat chart — dependency-free SVG bar / line / area / donut / pie charts
 * themed off the `--chart-1…5` ramp. `data` is an array of rows; `labelKey`
 * names the category (or slice) field; `series` maps value keys to
 * `{ label, color }`. Cartesian types hover per-category; radial types hover
 * per-slice. See `Chart.d.ts` for the full prop list.
 */
function Chart({
  type = "bar",
  data = [],
  labelKey = "label",
  series,
  stacked = false,
  legend = false,
  tooltip = true,
  yTicks = 4,
  height,
  className = ""
}) {
  const [active, setActive] = React.useState(null);
  const seriesList = resolveSeries(series, data, labelKey);
  const radial = type === "donut" || type === "pie";
  const cls = ["chart", className].filter(Boolean).join(" ");

  // Tooltip position + rows
  let tt = null;
  if (tooltip && active != null && data[active]) {
    if (radial) {
      const key = seriesList[0] && seriesList[0].key;
      const row = data[active];
      tt = {
        left: "50%",
        top: "50%",
        label: row[labelKey],
        rows: [{
          name: seriesList[0] ? seriesList[0].label : "",
          color: row.color || RAMP[active % RAMP.length],
          val: fmt(+row[key] || 0)
        }]
      };
    } else {
      const n = data.length;
      // plot spans x=40..632 in the 640-wide viewBox; center of band `active`
      const cx = 40 + (active + 0.5) * ((632 - 40) / n);
      tt = {
        left: `${cx / 640 * 100}%`,
        top: "8%",
        label: data[active][labelKey],
        rows: seriesList.map(se => ({
          name: se.label,
          color: se.color,
          val: fmt(+data[active][se.key] || 0)
        }))
      };
    }
  }
  return /*#__PURE__*/React.createElement("div", {
    className: cls
  }, /*#__PURE__*/React.createElement("div", {
    className: "chart-plot",
    style: {
      maxWidth: radial ? 260 : undefined,
      margin: radial ? "0 auto" : undefined,
      height
    }
  }, radial ? /*#__PURE__*/React.createElement(Radial, {
    type: type,
    data: data,
    labelKey: labelKey,
    seriesList: seriesList,
    active: active,
    setActive: setActive
  }) : /*#__PURE__*/React.createElement(Cartesian, {
    type: type,
    data: data,
    labelKey: labelKey,
    seriesList: seriesList,
    stacked: stacked,
    tooltip: tooltip,
    yTicks: yTicks,
    active: active,
    setActive: setActive
  }), tt && /*#__PURE__*/React.createElement("div", {
    className: "chart-tooltip",
    style: {
      left: tt.left,
      top: tt.top
    }
  }, /*#__PURE__*/React.createElement("div", {
    "data-tt-label": ""
  }, tt.label), tt.rows.map((r, i) => /*#__PURE__*/React.createElement("div", {
    "data-tt-row": "",
    key: i
  }, /*#__PURE__*/React.createElement("span", {
    "data-tt-swatch": "",
    style: {
      background: r.color
    }
  }), /*#__PURE__*/React.createElement("span", {
    "data-tt-name": ""
  }, r.name), /*#__PURE__*/React.createElement("span", {
    "data-tt-val": ""
  }, r.val))))), legend && /*#__PURE__*/React.createElement("div", {
    className: "chart-legend"
  }, radial ? data.map((d, i) => /*#__PURE__*/React.createElement("span", {
    key: i
  }, /*#__PURE__*/React.createElement("span", {
    "data-swatch": "",
    style: {
      background: d.color || RAMP[i % RAMP.length]
    }
  }), d[labelKey])) : seriesList.map(se => /*#__PURE__*/React.createElement("span", {
    key: se.key
  }, /*#__PURE__*/React.createElement("span", {
    "data-swatch": "",
    style: {
      background: se.color
    }
  }), se.label))));
}
Object.assign(__ds_scope, { Chart });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/display/Chart.jsx", error: String((e && e.message) || e) }); }

// components/display/Item.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Basecoat item — a list row: optional leading media (icon/avatar/image), a
 * title + description, and trailing actions. Emits `.item` plus
 * `data-variant` / `data-size`. Group rows with `ItemGroup`.
 */
function Item({
  media,
  title,
  description,
  actions,
  variant = "default",
  size = "default",
  as: Tag = "div",
  children,
  className = "",
  ...props
}) {
  const cls = ["item", className].filter(Boolean).join(" ");
  return /*#__PURE__*/React.createElement(Tag, _extends({
    className: cls,
    "data-variant": variant === "default" ? undefined : variant,
    "data-size": size === "default" ? undefined : size
  }, props), media != null && /*#__PURE__*/React.createElement("figure", null, media), /*#__PURE__*/React.createElement("section", null, title != null && /*#__PURE__*/React.createElement("h3", null, title), description != null && /*#__PURE__*/React.createElement("p", null, description), children), actions != null && /*#__PURE__*/React.createElement("aside", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 8,
      marginLeft: "auto"
    }
  }, actions));
}

/** Container that stacks `Item`s with consistent spacing. Emits `.item-group`. */
function ItemGroup({
  children,
  className = "",
  ...props
}) {
  const cls = ["item-group", className].filter(Boolean).join(" ");
  return /*#__PURE__*/React.createElement("div", _extends({
    className: cls
  }, props), children);
}
Object.assign(__ds_scope, { Item, ItemGroup });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/display/Item.jsx", error: String((e && e.message) || e) }); }

// components/display/Kbd.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/** Basecoat keyboard key. Emits `.kbd`. */
function Kbd({
  children,
  className = "",
  ...props
}) {
  const cls = ["kbd", className].filter(Boolean).join(" ");
  return /*#__PURE__*/React.createElement("kbd", _extends({
    className: cls
  }, props), children);
}

/** A thin divider. `orientation="vertical"` for inline use (set a height). */
function Separator({
  orientation = "horizontal",
  className = "",
  ...props
}) {
  const cls = ["separator", className].filter(Boolean).join(" ");
  const style = orientation === "vertical" ? {
    width: 1,
    alignSelf: "stretch"
  } : {
    height: 1,
    width: "100%"
  };
  return /*#__PURE__*/React.createElement("div", _extends({
    role: "separator",
    "aria-orientation": orientation,
    className: cls,
    style: style
  }, props));
}
Object.assign(__ds_scope, { Kbd, Separator });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/display/Kbd.jsx", error: String((e && e.message) || e) }); }

// components/display/ScrollArea.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Basecoat scroll area — a container with a slim, token-styled custom
 * scrollbar (thin track, rounded thumb that darkens on hover). Give it a
 * bounded size (`maxHeight`/`height` via `style` or `className`) and put
 * overflowing content inside. `orientation` hints which axis scrolls.
 */
function ScrollArea({
  orientation = "vertical",
  children,
  className = "",
  style,
  ...props
}) {
  const cls = ["scroll-area", className].filter(Boolean).join(" ");
  const overflow = orientation === "horizontal" ? {
    overflowX: "auto",
    overflowY: "hidden"
  } : orientation === "both" ? {
    overflow: "auto"
  } : {
    overflowY: "auto",
    overflowX: "hidden"
  };
  return /*#__PURE__*/React.createElement("div", _extends({
    className: cls,
    style: {
      ...overflow,
      ...style
    }
  }, props), children);
}
Object.assign(__ds_scope, { ScrollArea });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/display/ScrollArea.jsx", error: String((e && e.message) || e) }); }

// components/display/Table.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Basecoat table. Pass `columns` (array of strings or `{ key, label, align }`)
 * and `rows` (array of objects keyed by column key, or array of cell arrays).
 * Wrapped in a `.table-container` for horizontal scroll. Or pass raw
 * `<thead>/<tbody>` as children.
 */
function Table({
  columns,
  rows,
  children,
  className = "",
  ...props
}) {
  const cls = ["table", className].filter(Boolean).join(" ");
  const cols = (columns || []).map(c => typeof c === "string" ? {
    key: c,
    label: c
  } : c);
  return /*#__PURE__*/React.createElement("div", {
    className: "table-container"
  }, /*#__PURE__*/React.createElement("table", _extends({
    className: cls
  }, props), columns && /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", null, cols.map(c => /*#__PURE__*/React.createElement("th", {
    key: c.key,
    style: c.align ? {
      textAlign: c.align
    } : undefined
  }, c.label)))), rows ? /*#__PURE__*/React.createElement("tbody", null, rows.map((r, i) => /*#__PURE__*/React.createElement("tr", {
    key: i
  }, Array.isArray(r) ? r.map((cell, j) => /*#__PURE__*/React.createElement("td", {
    key: j
  }, cell)) : cols.map(c => /*#__PURE__*/React.createElement("td", {
    key: c.key,
    style: c.align ? {
      textAlign: c.align
    } : undefined
  }, r[c.key]))))) : children));
}
Object.assign(__ds_scope, { Table });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/display/Table.jsx", error: String((e && e.message) || e) }); }

// components/display/Tabs.jsx
try { (() => {
/**
 * Basecoat tabs. Pass `tabs` as `[{ value, label, content }]`. Uncontrolled by
 * default (set `defaultValue`); pass `value` + `onValueChange` to control it.
 * `variant="line"` swaps the pill track for an underline.
 */
function Tabs({
  tabs = [],
  variant = "default",
  defaultValue,
  value,
  onValueChange,
  className = ""
}) {
  const [internal, setInternal] = React.useState(defaultValue ?? tabs[0]?.value);
  const active = value !== undefined ? value : internal;
  const select = v => {
    if (value === undefined) setInternal(v);
    onValueChange && onValueChange(v);
  };
  const cls = ["tabs", className].filter(Boolean).join(" ");
  return /*#__PURE__*/React.createElement("div", {
    className: cls
  }, /*#__PURE__*/React.createElement("div", {
    role: "tablist",
    "data-variant": variant === "line" ? "line" : undefined
  }, tabs.map(t => /*#__PURE__*/React.createElement("button", {
    key: t.value,
    type: "button",
    role: "tab",
    "aria-selected": active === t.value,
    onClick: () => select(t.value)
  }, t.label))), tabs.map(t => active === t.value ? /*#__PURE__*/React.createElement("div", {
    key: t.value,
    role: "tabpanel"
  }, t.content) : null));
}
Object.assign(__ds_scope, { Tabs });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/display/Tabs.jsx", error: String((e && e.message) || e) }); }

// components/feedback/Alert.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Basecoat alert — an inline message banner. Emits `.alert` plus
 * `data-variant`. Pass `icon` (an inline SVG), `title`, and body as children.
 */
function Alert({
  variant = "default",
  icon,
  title,
  children,
  className = "",
  ...props
}) {
  const cls = ["alert", className].filter(Boolean).join(" ");
  return /*#__PURE__*/React.createElement("div", _extends({
    className: cls,
    "data-variant": variant === "default" ? undefined : variant,
    role: "alert"
  }, props), icon, title != null && /*#__PURE__*/React.createElement("h3", {
    "data-title": ""
  }, title), children != null && /*#__PURE__*/React.createElement("section", null, children));
}
Object.assign(__ds_scope, { Alert });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/feedback/Alert.jsx", error: String((e && e.message) || e) }); }

// components/feedback/Empty.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Basecoat empty state. Emits `.empty`. Pass `icon`, `title`, `description`,
 * and optional `action` (e.g. a Button). Use it for zero-data and no-results
 * views — Basecoat's dashed-border, centered placeholder.
 */
function Empty({
  icon,
  title,
  description,
  action,
  className = "",
  ...props
}) {
  const cls = ["empty", className].filter(Boolean).join(" ");
  return /*#__PURE__*/React.createElement("div", _extends({
    className: cls
  }, props), /*#__PURE__*/React.createElement("header", null, icon && /*#__PURE__*/React.createElement("figure", null, icon), title != null && /*#__PURE__*/React.createElement("h3", null, title), description != null && /*#__PURE__*/React.createElement("p", null, description)), action != null && /*#__PURE__*/React.createElement("footer", null, action));
}
Object.assign(__ds_scope, { Empty });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/feedback/Empty.jsx", error: String((e && e.message) || e) }); }

// components/feedback/Progress.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/** Basecoat progress bar. `value` 0–100. Emits `.progress` with a fill span. */
function Progress({
  value = 0,
  className = "",
  ...props
}) {
  const pct = Math.max(0, Math.min(100, value));
  const cls = ["progress", className].filter(Boolean).join(" ");
  return /*#__PURE__*/React.createElement("div", _extends({
    className: cls,
    role: "progressbar",
    "aria-valuenow": pct,
    "aria-valuemin": 0,
    "aria-valuemax": 100
  }, props), /*#__PURE__*/React.createElement("span", {
    style: {
      width: pct + "%"
    }
  }));
}
Object.assign(__ds_scope, { Progress });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/feedback/Progress.jsx", error: String((e && e.message) || e) }); }

// components/feedback/Spinner.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/** Basecoat skeleton placeholder. Emits `.skeleton`. Size via width/height. */
function Skeleton({
  width,
  height = "1rem",
  className = "",
  style,
  ...props
}) {
  const cls = ["skeleton", className].filter(Boolean).join(" ");
  return /*#__PURE__*/React.createElement("div", _extends({
    className: cls,
    style: {
      width,
      height,
      ...style
    }
  }, props));
}

/** Basecoat spinner — an indeterminate loading indicator. Emits `.spinner`. */
function Spinner({
  size,
  className = "",
  style,
  ...props
}) {
  const cls = ["spinner", className].filter(Boolean).join(" ");
  return /*#__PURE__*/React.createElement("span", _extends({
    className: cls,
    role: "status",
    "aria-label": "Loading",
    style: size ? {
      width: size,
      height: size,
      ...style
    } : style
  }, props));
}
Object.assign(__ds_scope, { Skeleton, Spinner });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/feedback/Spinner.jsx", error: String((e && e.message) || e) }); }

// components/feedback/Toast.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Basecoat toast — a single transient notification. Emits `.toast-content`
 * plus `data-variant`. Usually rendered by `Toaster`, not directly.
 */
function Toast({
  title,
  description,
  variant = "default",
  icon,
  onClose,
  className = ""
}) {
  const cls = ["toast-content", className].filter(Boolean).join(" ");
  return /*#__PURE__*/React.createElement("div", {
    className: cls,
    "data-variant": variant === "default" ? undefined : variant,
    role: "status"
  }, icon, /*#__PURE__*/React.createElement("section", null, title != null && /*#__PURE__*/React.createElement("span", {
    "data-title": ""
  }, title), description != null && /*#__PURE__*/React.createElement("span", {
    "data-description": ""
  }, description)), onClose && /*#__PURE__*/React.createElement("button", {
    "data-close": "",
    "aria-label": "Dismiss",
    onClick: onClose
  }, "\xD7"));
}

/**
 * Fixed-position stack that renders an array of `toasts`. Each toast is
 * `{ id, title, description, variant, icon }`. Call `onDismiss(id)` to remove.
 */
function Toaster({
  toasts = [],
  onDismiss,
  position = "bottom-right"
}) {
  return /*#__PURE__*/React.createElement("div", {
    className: "toaster",
    "data-position": position
  }, toasts.map(t => /*#__PURE__*/React.createElement(Toast, _extends({
    key: t.id
  }, t, {
    onClose: onDismiss ? () => onDismiss(t.id) : undefined
  }))));
}
Object.assign(__ds_scope, { Toast, Toaster });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/feedback/Toast.jsx", error: String((e && e.message) || e) }); }

// components/forms/Checkbox.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/** Basecoat checkbox. Emits `.input` on `<input type="checkbox">`. */
function Checkbox({
  className = "",
  ...props
}) {
  const cls = ["input", className].filter(Boolean).join(" ");
  return /*#__PURE__*/React.createElement("input", _extends({
    type: "checkbox",
    className: cls
  }, props));
}
Object.assign(__ds_scope, { Checkbox });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Checkbox.jsx", error: String((e && e.message) || e) }); }

// components/forms/Combobox.jsx
try { (() => {
const ChevronsUpDown = () => /*#__PURE__*/React.createElement("svg", {
  viewBox: "0 0 24 24",
  width: "16",
  height: "16",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: "2",
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": "true",
  style: {
    marginInlineStart: "auto",
    opacity: 0.5
  }
}, /*#__PURE__*/React.createElement("path", {
  d: "m7 15 5 5 5-5"
}), /*#__PURE__*/React.createElement("path", {
  d: "m7 9 5-5 5 5"
}));
const SearchIcon = () => /*#__PURE__*/React.createElement("svg", {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: "2",
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": "true"
}, /*#__PURE__*/React.createElement("path", {
  d: "m21 21-4.34-4.34"
}), /*#__PURE__*/React.createElement("circle", {
  cx: "11",
  cy: "11",
  r: "8"
}));
const CheckIcon = () => /*#__PURE__*/React.createElement("svg", {
  viewBox: "0 0 24 24",
  width: "16",
  height: "16",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: "2",
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": "true",
  style: {
    marginInlineStart: "auto"
  }
}, /*#__PURE__*/React.createElement("path", {
  d: "M20 6 9 17l-5-5"
}));
const XIcon = () => /*#__PURE__*/React.createElement("svg", {
  viewBox: "0 0 24 24",
  width: "14",
  height: "14",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: "2",
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": "true"
}, /*#__PURE__*/React.createElement("path", {
  d: "M18 6 6 18"
}), /*#__PURE__*/React.createElement("path", {
  d: "m6 6 12 12"
}));
const norm = o => typeof o === "string" ? {
  value: o,
  label: o
} : o;

/**
 * Basecoat combobox — an outline button that opens a searchable `.command`
 * list in a popover. Single-select with a check on the chosen item. Controlled
 * (`value`/`onChange`) or uncontrolled (`defaultValue`). Options are strings or
 * `{ value, label, keywords }`. Clearing: set `clearable` for an "×" in the
 * trigger, and/or re-click the selected row to toggle it off — both reset to
 * `""`.
 */
function Combobox({
  options = [],
  value,
  defaultValue = "",
  onChange,
  placeholder = "Select option…",
  searchPlaceholder = "Search…",
  emptyText = "No results found.",
  size = "default",
  clearable = false,
  disabled = false,
  className = ""
}) {
  const items = options.map(norm);
  const isControlled = value !== undefined;
  const [inner, setInner] = React.useState(defaultValue);
  const selected = isControlled ? value : inner;
  const [open, setOpen] = React.useState(false);
  const [q, setQ] = React.useState("");
  const wrapRef = React.useRef(null);
  const inputRef = React.useRef(null);
  React.useEffect(() => {
    if (!open) return;
    const onDoc = e => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = e => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    const t = setTimeout(() => inputRef.current && inputRef.current.focus(), 0);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
      clearTimeout(t);
    };
  }, [open]);
  const selectedItem = items.find(o => o.value === selected);
  const needle = q.trim().toLowerCase();
  const filtered = items.filter(o => (String(o.label) + " " + (o.keywords || "")).toLowerCase().includes(needle));
  const commit = v => {
    if (!isControlled) setInner(v);
    onChange && onChange(v);
  };
  // Selecting a row commits it; re-selecting the current row toggles it off.
  const pick = v => {
    commit(v === selected ? "" : v);
    setOpen(false);
    setQ("");
  };
  const clear = e => {
    e.stopPropagation();
    commit("");
  };
  const cls = ["popover", className].filter(Boolean).join(" ");
  return /*#__PURE__*/React.createElement("div", {
    ref: wrapRef,
    className: cls,
    style: {
      position: "relative",
      display: "inline-block"
    }
  }, /*#__PURE__*/React.createElement("button", {
    type: "button",
    className: "btn",
    "data-variant": "outline",
    "data-size": size === "default" ? undefined : size,
    role: "combobox",
    "aria-expanded": open,
    disabled: disabled,
    onClick: () => setOpen(o => !o),
    style: {
      width: "100%",
      justifyContent: "flex-start",
      fontWeight: "var(--font-weight-normal)"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap",
      color: selectedItem ? "var(--foreground)" : "var(--muted-foreground)"
    }
  }, selectedItem ? selectedItem.label : placeholder), clearable && selectedItem && !disabled ? /*#__PURE__*/React.createElement("span", {
    role: "button",
    tabIndex: 0,
    "aria-label": "Clear selection",
    onClick: clear,
    onKeyDown: e => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        clear(e);
      }
    },
    style: {
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      marginInlineStart: "auto",
      width: "1.125rem",
      height: "1.125rem",
      borderRadius: "var(--radius-sm)",
      color: "var(--muted-foreground)",
      cursor: "pointer"
    }
  }, /*#__PURE__*/React.createElement(XIcon, null)) : /*#__PURE__*/React.createElement(ChevronsUpDown, null)), open && /*#__PURE__*/React.createElement("div", {
    "data-popover": "",
    style: {
      position: "absolute",
      top: "calc(100% + 6px)",
      left: 0,
      zIndex: 50,
      minWidth: "100%",
      padding: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "command"
  }, /*#__PURE__*/React.createElement("header", null, /*#__PURE__*/React.createElement(SearchIcon, null), /*#__PURE__*/React.createElement("input", {
    ref: inputRef,
    value: q,
    onChange: e => setQ(e.target.value),
    placeholder: searchPlaceholder
  })), /*#__PURE__*/React.createElement("div", {
    role: "menu"
  }, filtered.length === 0 && /*#__PURE__*/React.createElement("div", {
    "data-empty": emptyText
  }), filtered.map(o => /*#__PURE__*/React.createElement("div", {
    role: "menuitem",
    key: o.value,
    "aria-selected": o.value === selected,
    className: o.value === selected ? "active" : undefined,
    onClick: () => pick(o.value)
  }, /*#__PURE__*/React.createElement("span", null, o.label), o.value === selected && /*#__PURE__*/React.createElement(CheckIcon, null)))))));
}
Object.assign(__ds_scope, { Combobox });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Combobox.jsx", error: String((e && e.message) || e) }); }

// components/forms/Field.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Basecoat field wrapper — stacks a label, a control, and optional help/error
 * text with consistent spacing. Emits `.field` and toggles `data-invalid` when
 * `error` is set (which also flips the control to its red state).
 */
function Field({
  label,
  htmlFor,
  hint,
  error,
  children,
  className = "",
  ...props
}) {
  const cls = ["field", className].filter(Boolean).join(" ");
  return /*#__PURE__*/React.createElement("div", _extends({
    className: cls,
    "data-invalid": error ? "true" : undefined
  }, props), label && /*#__PURE__*/React.createElement("label", {
    className: "label",
    htmlFor: htmlFor
  }, label), children, hint && !error && /*#__PURE__*/React.createElement("p", null, hint), error && /*#__PURE__*/React.createElement("p", {
    role: "alert"
  }, error));
}
Object.assign(__ds_scope, { Field });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Field.jsx", error: String((e && e.message) || e) }); }

// components/forms/Input.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Basecoat text input. Emits `.input`. Set `aria-invalid` for the error ring.
 * For inputs with a leading/trailing label or icon, wrap in a `Field`.
 */
function Input({
  type = "text",
  className = "",
  ...props
}) {
  const cls = ["input", className].filter(Boolean).join(" ");
  return /*#__PURE__*/React.createElement("input", _extends({
    type: type,
    className: cls
  }, props));
}
Object.assign(__ds_scope, { Input });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Input.jsx", error: String((e && e.message) || e) }); }

// components/forms/InputGroup.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Addon slot for an `InputGroup` — an icon, text, button, or spinner attached
 * to an input. `position`:
 *  - `start` / `end` — quiet inline content (icon or text) inside the field
 *  - `inline-start` / `inline-end` — a bordered, muted affix (e.g. `https://`, `.com`)
 * Pass a `.btn` as a child with `position="end"` for a trailing action button.
 */
function InputGroupAddon({
  position = "start",
  children,
  className = "",
  ...props
}) {
  return /*#__PURE__*/React.createElement("span", _extends({
    "data-addon": position,
    className: className
  }, props), children);
}

/**
 * Basecoat input group — a bordered container that merges an input (or
 * textarea) with leading/trailing addons behind one focus ring. Put an
 * `<InputGroupAddon>`, `.input`/`<input>`, and optional trailing addon or
 * `.btn` as children, in visual order. Set `invalid` for the destructive ring.
 */
function InputGroup({
  invalid = false,
  children,
  className = "",
  ...props
}) {
  const cls = ["input-group", className].filter(Boolean).join(" ");
  return /*#__PURE__*/React.createElement("div", _extends({
    className: cls,
    "aria-invalid": invalid ? "true" : undefined
  }, props), children);
}
Object.assign(__ds_scope, { InputGroupAddon, InputGroup });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/InputGroup.jsx", error: String((e && e.message) || e) }); }

// components/forms/Label.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/** Basecoat label. Emits `.label`. Associate with a control via `htmlFor`. */
function Label({
  children,
  className = "",
  ...props
}) {
  const cls = ["label", className].filter(Boolean).join(" ");
  return /*#__PURE__*/React.createElement("label", _extends({
    className: cls
  }, props), children);
}
Object.assign(__ds_scope, { Label });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Label.jsx", error: String((e && e.message) || e) }); }

// components/forms/RadioGroup.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/** Basecoat radio button. Emits `.input` on `<input type="radio">`. */
function Radio({
  className = "",
  ...props
}) {
  const cls = ["input", className].filter(Boolean).join(" ");
  return /*#__PURE__*/React.createElement("input", _extends({
    type: "radio",
    className: cls
  }, props));
}

/** Container for a set of radios. Emits `role="radiogroup"` (grid, gap-3). */
function RadioGroup({
  children,
  className = "",
  ...props
}) {
  return /*#__PURE__*/React.createElement("div", _extends({
    role: "radiogroup",
    className: className
  }, props), children);
}
Object.assign(__ds_scope, { Radio, RadioGroup });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/RadioGroup.jsx", error: String((e && e.message) || e) }); }

// components/forms/Select.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Basecoat native select. Emits `select.select` with the chevron background.
 * Pass `<option>`s as children, or an `options` array of {value,label}.
 */
function Select({
  options,
  size = "default",
  children,
  className = "",
  ...props
}) {
  const cls = ["select", className].filter(Boolean).join(" ");
  return /*#__PURE__*/React.createElement("select", _extends({
    className: cls,
    "data-size": size === "default" ? undefined : size
  }, props), options ? options.map(o => typeof o === "string" ? /*#__PURE__*/React.createElement("option", {
    key: o,
    value: o
  }, o) : /*#__PURE__*/React.createElement("option", {
    key: o.value,
    value: o.value
  }, o.label)) : children);
}
Object.assign(__ds_scope, { Select });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Select.jsx", error: String((e && e.message) || e) }); }

// components/forms/Slider.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/** Basecoat slider — a styled range input. Emits `.input` on `<input type="range">`. */
function Slider({
  className = "",
  ...props
}) {
  const cls = ["input", className].filter(Boolean).join(" ");
  return /*#__PURE__*/React.createElement("input", _extends({
    type: "range",
    className: cls
  }, props));
}
Object.assign(__ds_scope, { Slider });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Slider.jsx", error: String((e && e.message) || e) }); }

// components/forms/Switch.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/** Basecoat switch — a checkbox with `role="switch"`. Emits `.input`. */
function Switch({
  size = "default",
  className = "",
  ...props
}) {
  const cls = ["input", className].filter(Boolean).join(" ");
  return /*#__PURE__*/React.createElement("input", _extends({
    type: "checkbox",
    role: "switch",
    className: cls,
    "data-size": size === "default" ? undefined : size
  }, props));
}
Object.assign(__ds_scope, { Switch });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Switch.jsx", error: String((e && e.message) || e) }); }

// components/forms/Textarea.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/** Basecoat textarea. Emits `.textarea`. Vertically resizable, min 4rem. */
function Textarea({
  className = "",
  rows = 3,
  ...props
}) {
  const cls = ["textarea", className].filter(Boolean).join(" ");
  return /*#__PURE__*/React.createElement("textarea", _extends({
    className: cls,
    rows: rows
  }, props));
}
Object.assign(__ds_scope, { Textarea });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Textarea.jsx", error: String((e && e.message) || e) }); }

// components/navigation/Command.jsx
try { (() => {
const SearchIcon = () => /*#__PURE__*/React.createElement("svg", {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: "2",
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": "true"
}, /*#__PURE__*/React.createElement("path", {
  d: "m21 21-4.34-4.34"
}), /*#__PURE__*/React.createElement("circle", {
  cx: "11",
  cy: "11",
  r: "8"
}));

/**
 * Basecoat command menu (⌘K palette). Filterable, grouped action list. Render
 * inline, or set `asDialog` + `open`/`onClose` for the modal palette. Items:
 * `[{ label, icon, shortcut, group, keywords, onSelect }]`.
 */
function Command({
  items = [],
  placeholder = "Type a command or search…",
  emptyText = "No results found.",
  asDialog = false,
  open = false,
  onClose,
  className = ""
}) {
  const [q, setQ] = React.useState("");
  const ref = React.useRef(null);
  React.useEffect(() => {
    if (!asDialog) return;
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) {
      setQ("");
      el.showModal();
    } else if (!open && el.open) el.close();
  }, [open, asDialog]);
  const needle = q.trim().toLowerCase();
  const filtered = items.filter(it => (String(it.label) + " " + (it.keywords || "")).toLowerCase().includes(needle));
  const groups = [];
  const index = {};
  filtered.forEach(it => {
    const g = it.group || "";
    if (!(g in index)) {
      index[g] = groups.length;
      groups.push([g, []]);
    }
    groups[index[g]][1].push(it);
  });
  const inner = /*#__PURE__*/React.createElement("div", {
    className: ["command", className].filter(Boolean).join(" ")
  }, /*#__PURE__*/React.createElement("header", null, /*#__PURE__*/React.createElement(SearchIcon, null), /*#__PURE__*/React.createElement("input", {
    value: q,
    onChange: e => setQ(e.target.value),
    placeholder: placeholder,
    autoFocus: true
  })), /*#__PURE__*/React.createElement("div", {
    role: "menu"
  }, filtered.length === 0 && /*#__PURE__*/React.createElement("div", {
    "data-empty": emptyText
  }), groups.map(([g, list], gi) => /*#__PURE__*/React.createElement("div", {
    role: "group",
    key: gi
  }, g && /*#__PURE__*/React.createElement("div", {
    role: "heading"
  }, g), list.map((it, i) => /*#__PURE__*/React.createElement("div", {
    role: "menuitem",
    key: i,
    onClick: () => {
      it.onSelect && it.onSelect();
      onClose && onClose();
    }
  }, it.icon, /*#__PURE__*/React.createElement("span", null, it.label), it.shortcut && /*#__PURE__*/React.createElement("span", {
    "data-shortcut": ""
  }, it.shortcut)))))));
  if (!asDialog) return inner;
  return /*#__PURE__*/React.createElement("dialog", {
    ref: ref,
    className: "command-dialog",
    onClose: () => onClose && onClose(),
    onClick: e => {
      if (e.target === ref.current) onClose && onClose();
    }
  }, inner);
}
Object.assign(__ds_scope, { Command });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/navigation/Command.jsx", error: String((e && e.message) || e) }); }

// components/navigation/Pagination.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const Chevron = ({
  dir
}) => /*#__PURE__*/React.createElement("svg", {
  viewBox: "0 0 24 24",
  width: "16",
  height: "16",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: "2",
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": "true"
}, /*#__PURE__*/React.createElement("path", {
  d: dir === "left" ? "m15 18-6-6 6-6" : "m9 18 6-6-6-6"
}));

/**
 * Build the page list with ellipses. Always shows first, last, current, and
 * `siblings` neighbours; gaps collapse to "…".
 */
function pageList(total, current, siblings) {
  const out = [];
  const push = v => out.push(v);
  const lo = Math.max(2, current - siblings);
  const hi = Math.min(total - 1, current + siblings);
  push(1);
  if (lo > 2) push("…");
  for (let p = lo; p <= hi; p++) push(p);
  if (hi < total - 1) push("…");
  if (total > 1) push(total);
  return out;
}

/**
 * Basecoat pagination — previous/next plus numbered page links with ellipses.
 * Controlled: pass `page`, `total`, and `onChange(page)`. Renders `<a>` links
 * when you pass `href(page)`, otherwise `<button>`s.
 */
function Pagination({
  page = 1,
  total = 1,
  siblings = 1,
  onChange,
  href,
  ariaLabel = "pagination",
  className = ""
}) {
  const cls = ["pagination", className].filter(Boolean).join(" ");
  const go = p => e => {
    if (!href) e.preventDefault();
    if (p >= 1 && p <= total && p !== page) onChange && onChange(p);
  };
  const Tag = href ? "a" : "button";
  const linkProps = p => href ? {
    href: href(p)
  } : {
    type: "button"
  };
  return /*#__PURE__*/React.createElement("nav", {
    className: cls,
    role: "navigation",
    "aria-label": ariaLabel
  }, /*#__PURE__*/React.createElement("ul", null, /*#__PURE__*/React.createElement("li", null, /*#__PURE__*/React.createElement(Tag, _extends({}, linkProps(page - 1), {
    "aria-label": "Go to previous page",
    "aria-disabled": page <= 1 ? "true" : undefined,
    onClick: go(page - 1)
  }), /*#__PURE__*/React.createElement(Chevron, {
    dir: "left"
  }), /*#__PURE__*/React.createElement("span", null, "Previous"))), pageList(total, page, siblings).map((p, i) => p === "…" ? /*#__PURE__*/React.createElement("li", {
    key: `e${i}`
  }, /*#__PURE__*/React.createElement("span", {
    "data-ellipsis": "",
    "aria-hidden": "true"
  }, "\u2026")) : /*#__PURE__*/React.createElement("li", {
    key: p
  }, /*#__PURE__*/React.createElement(Tag, _extends({}, linkProps(p), {
    "aria-current": p === page ? "page" : undefined,
    "aria-label": `Go to page ${p}`,
    onClick: go(p)
  }), p))), /*#__PURE__*/React.createElement("li", null, /*#__PURE__*/React.createElement(Tag, _extends({}, linkProps(page + 1), {
    "aria-label": "Go to next page",
    "aria-disabled": page >= total ? "true" : undefined,
    onClick: go(page + 1)
  }), /*#__PURE__*/React.createElement("span", null, "Next"), /*#__PURE__*/React.createElement(Chevron, {
    dir: "right"
  })))));
}
Object.assign(__ds_scope, { Pagination });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/navigation/Pagination.jsx", error: String((e && e.message) || e) }); }

// components/navigation/Sidebar.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Basecoat sidebar — the app navigation rail. Pass `groups` as
 * `[{ heading, items: [{ label, icon, href, active, onClick }] }]`, plus
 * optional `header` / `footer` (e.g. a logo and a user menu).
 */
function Sidebar({
  header,
  footer,
  groups = [],
  width,
  className = "",
  ...props
}) {
  const cls = ["sidebar", className].filter(Boolean).join(" ");
  return /*#__PURE__*/React.createElement("aside", _extends({
    className: cls,
    style: width ? {
      "--sidebar-width": width
    } : undefined
  }, props), /*#__PURE__*/React.createElement("nav", null, header != null && /*#__PURE__*/React.createElement("header", null, header), /*#__PURE__*/React.createElement("section", null, groups.map((g, i) => /*#__PURE__*/React.createElement("div", {
    role: "group",
    key: i
  }, g.heading != null && /*#__PURE__*/React.createElement("h3", null, g.heading), /*#__PURE__*/React.createElement("ul", null, g.items.map((it, j) => {
    const Tag = it.href ? "a" : "button";
    return /*#__PURE__*/React.createElement("li", {
      key: j
    }, /*#__PURE__*/React.createElement(Tag, {
      href: it.href,
      type: it.href ? undefined : "button",
      "aria-current": it.active ? "page" : undefined,
      onClick: it.onClick
    }, it.icon, /*#__PURE__*/React.createElement("span", {
      style: {
        flex: 1
      }
    }, it.label), it.trailing));
  }))))), footer != null && /*#__PURE__*/React.createElement("footer", null, footer)));
}
Object.assign(__ds_scope, { Sidebar });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/navigation/Sidebar.jsx", error: String((e && e.message) || e) }); }

// components/navigation/ThemeSwitcher.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const Sun = () => /*#__PURE__*/React.createElement("svg", {
  viewBox: "0 0 24 24",
  width: "16",
  height: "16",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: "2",
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": "true"
}, /*#__PURE__*/React.createElement("circle", {
  cx: "12",
  cy: "12",
  r: "4"
}), /*#__PURE__*/React.createElement("path", {
  d: "M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"
}));
const Moon = () => /*#__PURE__*/React.createElement("svg", {
  viewBox: "0 0 24 24",
  width: "16",
  height: "16",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: "2",
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": "true"
}, /*#__PURE__*/React.createElement("path", {
  d: "M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"
}));

/**
 * Basecoat theme switcher — toggles `class="dark"` on `<html>` and persists the
 * choice to localStorage. Renders a ghost icon-button; pass a different
 * `storageKey` if you manage multiple themes.
 */
function ThemeSwitcher({
  storageKey = "theme",
  className = "",
  ...props
}) {
  const [dark, setDark] = React.useState(false);
  React.useEffect(() => {
    let initial = document.documentElement.classList.contains("dark");
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) initial = saved === "dark";
    } catch (e) {}
    document.documentElement.classList.toggle("dark", initial);
    setDark(initial);
  }, [storageKey]);
  const toggle = () => {
    const next = !dark;
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem(storageKey, next ? "dark" : "light");
    } catch (e) {}
    setDark(next);
  };
  const cls = ["btn", className].filter(Boolean).join(" ");
  return /*#__PURE__*/React.createElement("button", _extends({
    type: "button",
    className: cls,
    "data-variant": "ghost",
    "data-size": "icon",
    "aria-label": "Toggle dark mode",
    "aria-pressed": dark,
    onClick: toggle
  }, props), dark ? /*#__PURE__*/React.createElement(Sun, null) : /*#__PURE__*/React.createElement(Moon, null));
}
Object.assign(__ds_scope, { ThemeSwitcher });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/navigation/ThemeSwitcher.jsx", error: String((e && e.message) || e) }); }

// components/overlay/AlertDialog.jsx
try { (() => {
/**
 * Basecoat alert dialog — a modal for confirmations and destructive actions.
 * Wider than a plain `Dialog` and intentionally without a backdrop-click
 * escape: the user must pick an action. Controlled via `open`. Provide
 * `onCancel` / `onConfirm`; `destructive` styles the confirm button red.
 */
function AlertDialog({
  open,
  onCancel,
  onConfirm,
  title,
  description,
  cancelText = "Cancel",
  confirmText = "Continue",
  destructive = false,
  children,
  className = ""
}) {
  const ref = React.useRef(null);
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();else if (!open && el.open) el.close();
  }, [open]);
  const cls = ["alert-dialog", className].filter(Boolean).join(" ");
  return /*#__PURE__*/React.createElement("dialog", {
    ref: ref,
    className: cls,
    onCancel: e => {
      e.preventDefault();
      onCancel && onCancel();
    }
  }, /*#__PURE__*/React.createElement("div", null, (title != null || description != null) && /*#__PURE__*/React.createElement("header", null, title != null && /*#__PURE__*/React.createElement("h2", null, title), description != null && /*#__PURE__*/React.createElement("p", null, description)), children != null && /*#__PURE__*/React.createElement("section", null, children), /*#__PURE__*/React.createElement("footer", null, /*#__PURE__*/React.createElement("button", {
    type: "button",
    className: "btn",
    "data-variant": "outline",
    onClick: () => onCancel && onCancel()
  }, cancelText), /*#__PURE__*/React.createElement("button", {
    type: "button",
    className: "btn",
    "data-variant": destructive ? "destructive" : "primary",
    onClick: () => onConfirm && onConfirm()
  }, confirmText))));
}
Object.assign(__ds_scope, { AlertDialog });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/overlay/AlertDialog.jsx", error: String((e && e.message) || e) }); }

// components/overlay/Dialog.jsx
try { (() => {
/**
 * Basecoat dialog — a modal built on the native `<dialog>` element. Controlled
 * via `open` + `onClose`. `variant="alert"` renders the wider alert-dialog
 * shell for confirmations. Clicking the backdrop closes it.
 */
function Dialog({
  open,
  onClose,
  title,
  description,
  footer,
  children,
  variant = "dialog",
  className = ""
}) {
  const ref = React.useRef(null);
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();else if (!open && el.open) el.close();
  }, [open]);
  const cls = [variant === "alert" ? "alert-dialog" : "dialog", className].filter(Boolean).join(" ");
  return /*#__PURE__*/React.createElement("dialog", {
    ref: ref,
    className: cls,
    onClose: () => onClose && onClose(),
    onClick: e => {
      if (e.target === ref.current) onClose && onClose();
    }
  }, /*#__PURE__*/React.createElement("div", null, (title != null || description != null) && /*#__PURE__*/React.createElement("header", null, title != null && /*#__PURE__*/React.createElement("h2", null, title), description != null && /*#__PURE__*/React.createElement("p", null, description)), children != null && /*#__PURE__*/React.createElement("section", null, children), footer != null && /*#__PURE__*/React.createElement("footer", null, footer)));
}
Object.assign(__ds_scope, { Dialog });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/overlay/Dialog.jsx", error: String((e && e.message) || e) }); }

// components/overlay/Drawer.jsx
try { (() => {
/**
 * Basecoat drawer — a panel that slides in from a screen edge, built on the
 * native `<dialog>` element. Controlled via `open` + `onClose`. `side` is
 * `right` (default), `left`, `top`, or `bottom`. Clicking the backdrop or
 * pressing Esc closes it.
 */
function Drawer({
  open,
  onClose,
  side = "right",
  title,
  description,
  footer,
  children,
  className = ""
}) {
  const ref = React.useRef(null);
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();else if (!open && el.open) el.close();
  }, [open]);
  const cls = ["drawer", className].filter(Boolean).join(" ");
  return /*#__PURE__*/React.createElement("dialog", {
    ref: ref,
    className: cls,
    "data-side": side,
    onClose: () => onClose && onClose(),
    onClick: e => {
      if (e.target === ref.current) onClose && onClose();
    }
  }, /*#__PURE__*/React.createElement("div", null, (title != null || description != null) && /*#__PURE__*/React.createElement("header", null, title != null && /*#__PURE__*/React.createElement("h2", null, title), description != null && /*#__PURE__*/React.createElement("p", null, description)), children != null && /*#__PURE__*/React.createElement("section", null, children), footer != null && /*#__PURE__*/React.createElement("footer", null, footer)));
}
Object.assign(__ds_scope, { Drawer });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/overlay/Drawer.jsx", error: String((e && e.message) || e) }); }

// components/overlay/DropdownMenu.jsx
try { (() => {
/**
 * Basecoat dropdown menu — a list of actions anchored to a trigger. Pass
 * `trigger` and `items` as `[{ label, onClick, icon, shortcut, variant,
 * heading, separator }]`. Closes on select / outside-click / Esc.
 */
function DropdownMenu({
  trigger,
  items = [],
  align = "start",
  className = ""
}) {
  const [open, setOpen] = React.useState(false);
  const wrapRef = React.useRef(null);
  React.useEffect(() => {
    if (!open) return;
    const onDoc = e => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = e => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  const cls = ["dropdown-menu", className].filter(Boolean).join(" ");
  return /*#__PURE__*/React.createElement("div", {
    ref: wrapRef,
    className: cls,
    style: {
      position: "relative",
      display: "inline-block"
    }
  }, /*#__PURE__*/React.createElement("span", {
    onClick: () => setOpen(o => !o),
    "aria-haspopup": "menu",
    "aria-expanded": open,
    style: {
      display: "inline-flex"
    }
  }, trigger), open && /*#__PURE__*/React.createElement("div", {
    "data-popover": "",
    role: "menu",
    style: {
      position: "absolute",
      top: "calc(100% + 6px)",
      [align === "end" ? "right" : "left"]: 0,
      zIndex: 50
    }
  }, items.map((it, i) => {
    if (it.separator) return /*#__PURE__*/React.createElement("div", {
      key: i,
      role: "separator"
    });
    if (it.heading) return /*#__PURE__*/React.createElement("div", {
      key: i,
      role: "heading"
    }, it.heading);
    return /*#__PURE__*/React.createElement("div", {
      key: i,
      role: "menuitem",
      "data-variant": it.variant === "destructive" ? "destructive" : undefined,
      onClick: () => {
        it.onClick && it.onClick();
        setOpen(false);
      }
    }, it.icon, /*#__PURE__*/React.createElement("span", null, it.label), it.shortcut && /*#__PURE__*/React.createElement("span", {
      "data-shortcut": ""
    }, it.shortcut));
  })));
}
Object.assign(__ds_scope, { DropdownMenu });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/overlay/DropdownMenu.jsx", error: String((e && e.message) || e) }); }

// components/overlay/Popover.jsx
try { (() => {
/**
 * Basecoat popover — a floating panel anchored to a trigger. Pass the trigger
 * element via `trigger` and panel content as children. Toggles on click;
 * closes on outside-click or Esc.
 */
function Popover({
  trigger,
  children,
  align = "start",
  className = ""
}) {
  const [open, setOpen] = React.useState(false);
  const wrapRef = React.useRef(null);
  React.useEffect(() => {
    if (!open) return;
    const onDoc = e => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = e => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  const cls = ["popover", className].filter(Boolean).join(" ");
  return /*#__PURE__*/React.createElement("div", {
    ref: wrapRef,
    className: cls,
    style: {
      position: "relative",
      display: "inline-block"
    }
  }, /*#__PURE__*/React.createElement("span", {
    onClick: () => setOpen(o => !o),
    style: {
      display: "inline-flex"
    }
  }, trigger), open && /*#__PURE__*/React.createElement("div", {
    "data-popover": "",
    style: {
      position: "absolute",
      top: "calc(100% + 6px)",
      [align === "end" ? "right" : "left"]: 0,
      zIndex: 50,
      minWidth: "16rem"
    }
  }, children));
}
Object.assign(__ds_scope, { Popover });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/overlay/Popover.jsx", error: String((e && e.message) || e) }); }

// components/overlay/Tooltip.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Basecoat tooltip — a hover/focus hint. Wraps `children` and shows `label`
 * above on hover (uses the CSS-only `[data-tooltip]` treatment).
 */
function Tooltip({
  label,
  children,
  className = "",
  ...props
}) {
  return /*#__PURE__*/React.createElement("span", _extends({
    "data-tooltip": label,
    className: className,
    style: {
      display: "inline-flex"
    },
    tabIndex: 0
  }, props), children);
}
Object.assign(__ds_scope, { Tooltip });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/overlay/Tooltip.jsx", error: String((e && e.message) || e) }); }

// ui_kits/grocery-admin/ConfigScreen.jsx
try { (() => {
/* Config area — Calibration sub-nav + the discovery-sweep knobs in a card,
   with Save / Analyze / Dry-run actions. Field values from the admin's
   defaults. */
function ConfigScreen() {
  const {
    Field,
    Input,
    Button
  } = window.DesignSystem_959bdd;
  const pills = ["Calibration", "Ranking", "Flyer", "Aliases", "Flyer terms", "Feeds", "Senders", "Members"];
  const [pill, setPill] = React.useState("Calibration");
  const knobs = [["τ taste threshold", "0.55"], ["triage threshold", "0.45"], ["δ dedup threshold", "0.9"], ["classify cap", "12"], ["rate cap", "10"], ["fetch max / tick", "16"], ["max candidates / tick", "150"], ["retry max attempts", "5"], ["log retention days", "60"]];
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    className: "data-nav"
  }, pills.map(p => /*#__PURE__*/React.createElement("button", {
    key: p,
    className: "pill" + (p === pill ? " active" : ""),
    onClick: () => setPill(p)
  }, p))), /*#__PURE__*/React.createElement("h2", {
    className: "data-title"
  }, "Discovery calibration"), /*#__PURE__*/React.createElement("p", {
    className: "muted",
    style: {
      marginBottom: 16
    }
  }, "Tune the sweep's knobs, preview with Analyze / Dry-run, then Save (a below-floor value asks to confirm)."), /*#__PURE__*/React.createElement("div", {
    className: "card"
  }, /*#__PURE__*/React.createElement("section", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 16
    }
  }, knobs.map(([label, val], i) => /*#__PURE__*/React.createElement(Field, {
    key: label,
    label: label,
    htmlFor: "k" + i
  }, /*#__PURE__*/React.createElement(Input, {
    id: "k" + i,
    defaultValue: val,
    style: {
      width: "100%"
    }
  }))), /*#__PURE__*/React.createElement("div", {
    className: "form-actions"
  }, /*#__PURE__*/React.createElement(Button, {
    disabled: true
  }, "Save"), /*#__PURE__*/React.createElement(Button, {
    variant: "ghost"
  }, "Analyze"), /*#__PURE__*/React.createElement(Button, {
    variant: "ghost"
  }, "Dry-run")))));
}
window.GA.ConfigScreen = ConfigScreen;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/grocery-admin/ConfigScreen.jsx", error: String((e && e.message) || e) }); }

// ui_kits/grocery-admin/DataScreen.jsx
try { (() => {
/* Data area — sub-nav pills over the data domains. Mirrors the admin's empty
   state (no recipes seeded in the reference instance). */
function DataScreen() {
  const tabs = ["Recipes", "Members", "Corpus", "Discovery", "System"];
  const [tab, setTab] = React.useState("Recipes");
  const empty = {
    Recipes: "No recipes in the corpus or the index.",
    Members: "No members in this tenant yet.",
    Corpus: "The recipe corpus is empty — nothing authored in R2.",
    Discovery: "No discovery candidates queued.",
    System: "No system records to display."
  };
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    className: "data-nav"
  }, tabs.map(t => /*#__PURE__*/React.createElement("button", {
    key: t,
    className: "pill" + (t === tab ? " active" : ""),
    onClick: () => setTab(t)
  }, t))), /*#__PURE__*/React.createElement("h2", {
    className: "data-title"
  }, tab), /*#__PURE__*/React.createElement("p", {
    className: "muted"
  }, empty[tab]));
}
window.GA.DataScreen = DataScreen;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/grocery-admin/DataScreen.jsx", error: String((e && e.message) || e) }); }

// ui_kits/grocery-admin/MembersScreen.jsx
try { (() => {
/* Members area — the friend-group roster + the invite-code flow. "Invite
   member" opens a dialog; submitting mints an invite code (shown once in a
   highlighted callout) and adds a pending row. Composes the design-system
   Button / Dialog / Field / Input / Table / Badge. */
function MembersScreen() {
  const {
    Button,
    Dialog,
    Field,
    Input,
    Table,
    Badge
  } = window.DesignSystem_959bdd;
  const I = window.GA.icons;
  const [open, setOpen] = React.useState(false);
  const [email, setEmail] = React.useState("");
  const [minted, setMinted] = React.useState(null);
  const [members, setMembers] = React.useState([{
    email: "casey@dirtbag.social",
    status: "active",
    joined: "Owner"
  }]);
  function mint() {
    if (!email.trim()) return;
    const code = "GA-" + Math.random().toString(36).slice(2, 6).toUpperCase() + "-" + Math.random().toString(36).slice(2, 6).toUpperCase();
    setMembers(m => [...m, {
      email: email.trim(),
      status: "pending",
      joined: "—"
    }]);
    setMinted({
      email: email.trim(),
      code
    });
    setEmail("");
    setOpen(false);
  }
  const statusBadge = s => s === "active" ? /*#__PURE__*/React.createElement(Badge, {
    variant: "secondary"
  }, "active") : /*#__PURE__*/React.createElement(Badge, {
    variant: "outline"
  }, "pending");
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    className: "area-head"
  }, /*#__PURE__*/React.createElement("h2", null, "Members"), /*#__PURE__*/React.createElement(Button, {
    size: "sm",
    onClick: () => setOpen(true)
  }, /*#__PURE__*/React.createElement(I.plus, {
    size: 14
  }), " Invite member")), minted && /*#__PURE__*/React.createElement("div", {
    className: "minted"
  }, /*#__PURE__*/React.createElement("div", {
    className: "minted-head"
  }, /*#__PURE__*/React.createElement("strong", null, "Invite minted for ", minted.email), /*#__PURE__*/React.createElement("button", {
    className: "link-action",
    onClick: () => setMinted(null)
  }, "Dismiss")), /*#__PURE__*/React.createElement("p", {
    className: "once"
  }, "Shown once \u2014 copy it now. Share with the invitee to connect their Claude.ai."), /*#__PURE__*/React.createElement("code", {
    className: "code-block"
  }, minted.code)), /*#__PURE__*/React.createElement("div", {
    className: "card"
  }, /*#__PURE__*/React.createElement("section", null, /*#__PURE__*/React.createElement(Table, {
    columns: ["Member", {
      key: "status",
      label: "Status"
    }, {
      key: "joined",
      label: "Joined",
      align: "right"
    }],
    rows: members.map(m => ({
      Member: m.email,
      status: statusBadge(m.status),
      joined: m.joined
    }))
  }))), /*#__PURE__*/React.createElement(Dialog, {
    open: open,
    onClose: () => setOpen(false),
    title: "Invite member",
    description: "Mint an invite code for someone in your friend group.",
    footer: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Button, {
      variant: "outline",
      onClick: () => setOpen(false)
    }, "Cancel"), /*#__PURE__*/React.createElement(Button, {
      onClick: mint
    }, "Mint invite"))
  }, /*#__PURE__*/React.createElement(Field, {
    label: "Email",
    htmlFor: "invite-email",
    hint: "Just for your records \u2014 no email is sent."
  }, /*#__PURE__*/React.createElement(Input, {
    id: "invite-email",
    type: "email",
    placeholder: "friend@example.com",
    value: email,
    onChange: e => setEmail(e.target.value)
  }))));
}
window.GA.MembersScreen = MembersScreen;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/grocery-admin/MembersScreen.jsx", error: String((e && e.message) || e) }); }

// ui_kits/grocery-admin/StatusScreen.jsx
try { (() => {
/* Status area — "Service health": the destructive admin-gate alert, the
   overall headline, and one row per cron job / dependency with a status dot.
   Recreated from the grocery-agent admin (admin/visual snapshots). */
function StatusScreen() {
  const {
    Alert
  } = window.DesignSystem_959bdd;
  const I = window.GA.icons;
  const jobs = [["flyer-warm", "never", "never run"], ["recipe-classify", "never", "never run"], ["recipe-index", "never", "never run"], ["recipe-embed", "never", "never run"], ["email", "never", "never run"], ["discovery-sweep", "never", "never run"], ["d1", "ok", "reachable"], ["admin gate", "fail", "exposed"]];
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    className: "area-head"
  }, /*#__PURE__*/React.createElement("h2", null, "Service health"), /*#__PURE__*/React.createElement("button", {
    className: "link-action"
  }, "Refresh")), /*#__PURE__*/React.createElement(Alert, {
    variant: "destructive",
    title: "Admin gate exposed",
    icon: /*#__PURE__*/React.createElement(I.alert, null)
  }, "Access is unconfigured and the dev bypass is set \u2014 a deployed Worker would serve /admin unauthenticated. Set ", /*#__PURE__*/React.createElement("code", null, "ACCESS_TEAM_DOMAIN"), " and ", /*#__PURE__*/React.createElement("code", null, "ACCESS_AUD"), " ", "(and clear ", /*#__PURE__*/React.createElement("code", null, "ADMIN_DEV_BYPASS"), ")."), /*#__PURE__*/React.createElement("div", {
    className: "card"
  }, /*#__PURE__*/React.createElement("section", null, /*#__PURE__*/React.createElement("div", {
    className: "headline"
  }, /*#__PURE__*/React.createElement("span", {
    className: "dot fail"
  }), /*#__PURE__*/React.createElement("span", {
    className: "status-word fail"
  }, "Degraded")))), /*#__PURE__*/React.createElement("div", {
    className: "card"
  }, /*#__PURE__*/React.createElement("section", {
    style: {
      paddingTop: 4,
      paddingBottom: 4
    }
  }, jobs.map(([label, state, word]) => /*#__PURE__*/React.createElement("div", {
    className: "status-row",
    key: label
  }, /*#__PURE__*/React.createElement("div", {
    className: "status-line"
  }, /*#__PURE__*/React.createElement("span", {
    className: "dot " + state
  }), /*#__PURE__*/React.createElement("span", {
    className: "status-label"
  }, label), /*#__PURE__*/React.createElement("span", {
    className: "status-word " + state
  }, word)))))));
}
window.GA.StatusScreen = StatusScreen;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/grocery-admin/StatusScreen.jsx", error: String((e && e.message) || e) }); }

// ui_kits/grocery-admin/UsageScreen.jsx
try { (() => {
/* Usage area — three "not configured" info cards (the reference instance has
   no analytics token set). Muted body text inside plain cards. */
function UsageScreen() {
  const cards = [/*#__PURE__*/React.createElement(React.Fragment, null, "Usage analytics not configured. Set ", /*#__PURE__*/React.createElement("code", null, "CF_ACCOUNT_ID"), " and a read-only", " ", /*#__PURE__*/React.createElement("code", null, "CF_ANALYTICS_TOKEN"), " (Account Analytics: Read) to read account-wide KV-operation and Workers AI neuron usage. Reading usage costs no KV."), /*#__PURE__*/React.createElement(React.Fragment, null, "Usage trends not available. Per-job run history comes from the Workers Analytics Engine SQL API (reuses ", /*#__PURE__*/React.createElement("code", null, "CF_ACCOUNT_ID"), " and ", /*#__PURE__*/React.createElement("code", null, "CF_ANALYTICS_TOKEN"), "). Set them to see per-job trends over the last 30 days."), /*#__PURE__*/React.createElement(React.Fragment, null, "Tool usage not available. Per-tool call history comes from the Workers Analytics Engine SQL API (reuses ", /*#__PURE__*/React.createElement("code", null, "CF_ACCOUNT_ID"), " and ", /*#__PURE__*/React.createElement("code", null, "CF_ANALYTICS_TOKEN"), "). Set them to see per-tool calls, error rate, and latency over the last 30 days.")];
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    className: "area-head"
  }, /*#__PURE__*/React.createElement("h2", null, "Usage"), /*#__PURE__*/React.createElement("button", {
    className: "link-action"
  }, "Refresh")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 16
    }
  }, cards.map((c, i) => /*#__PURE__*/React.createElement("div", {
    className: "card",
    key: i
  }, /*#__PURE__*/React.createElement("section", null, /*#__PURE__*/React.createElement("p", {
    className: "muted",
    style: {
      margin: 0
    }
  }, c))))));
}
window.GA.UsageScreen = UsageScreen;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/grocery-admin/UsageScreen.jsx", error: String((e && e.message) || e) }); }

// ui_kits/grocery-admin/icons.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/* Shared icon set for the grocery-agent admin kit. Lucide paths (the icon
   system Basecoat itself uses), assigned to window so the kit's screens share
   them without polluting the design-system bundle (no `export`). */
function GAIcon({
  d,
  size = 16,
  ...props
}) {
  return /*#__PURE__*/React.createElement("svg", _extends({
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "2",
    strokeLinecap: "round",
    strokeLinejoin: "round",
    "aria-hidden": "true"
  }, props), Array.isArray(d) ? d.map((p, i) => /*#__PURE__*/React.createElement("path", {
    key: i,
    d: p
  })) : /*#__PURE__*/React.createElement("path", {
    d: d
  }));
}
window.GA = window.GA || {};
window.GA.icons = {
  alert: p => /*#__PURE__*/React.createElement(GAIcon, _extends({
    d: ["m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3z", "M12 9v4", "M12 17h.01"]
  }, p)),
  refresh: p => /*#__PURE__*/React.createElement(GAIcon, _extends({
    d: ["M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8", "M21 3v5h-5", "M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16", "M8 16H3v5"]
  }, p)),
  plus: p => /*#__PURE__*/React.createElement(GAIcon, _extends({
    d: ["M5 12h14", "M12 5v14"]
  }, p)),
  more: p => /*#__PURE__*/React.createElement(GAIcon, _extends({
    d: ["M12 12h.01", "M19 12h.01", "M5 12h.01"]
  }, p)),
  utensils: p => /*#__PURE__*/React.createElement(GAIcon, _extends({
    d: ["M3 2v7c0 1.1.9 2 2 2h0a2 2 0 0 0 2-2V2", "M7 2v20", "M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7"]
  }, p)),
  users: p => /*#__PURE__*/React.createElement(GAIcon, _extends({
    d: ["M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2", "M9 7a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z", "M22 21v-2a4 4 0 0 0-3-3.87", "M16 3.13a4 4 0 0 1 0 7.75"]
  }, p)),
  search: p => /*#__PURE__*/React.createElement(GAIcon, _extends({
    d: ["m21 21-4.34-4.34", "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14Z"]
  }, p))
};
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/grocery-admin/icons.jsx", error: String((e && e.message) || e) }); }

__ds_ns.Badge = __ds_scope.Badge;

__ds_ns.Button = __ds_scope.Button;

__ds_ns.ButtonGroup = __ds_scope.ButtonGroup;

__ds_ns.Accordion = __ds_scope.Accordion;

__ds_ns.Avatar = __ds_scope.Avatar;

__ds_ns.Breadcrumb = __ds_scope.Breadcrumb;

__ds_ns.Card = __ds_scope.Card;

__ds_ns.Chart = __ds_scope.Chart;

__ds_ns.Item = __ds_scope.Item;

__ds_ns.ItemGroup = __ds_scope.ItemGroup;

__ds_ns.Kbd = __ds_scope.Kbd;

__ds_ns.Separator = __ds_scope.Separator;

__ds_ns.ScrollArea = __ds_scope.ScrollArea;

__ds_ns.Table = __ds_scope.Table;

__ds_ns.Tabs = __ds_scope.Tabs;

__ds_ns.Alert = __ds_scope.Alert;

__ds_ns.Empty = __ds_scope.Empty;

__ds_ns.Progress = __ds_scope.Progress;

__ds_ns.Skeleton = __ds_scope.Skeleton;

__ds_ns.Spinner = __ds_scope.Spinner;

__ds_ns.Toast = __ds_scope.Toast;

__ds_ns.Toaster = __ds_scope.Toaster;

__ds_ns.Checkbox = __ds_scope.Checkbox;

__ds_ns.Combobox = __ds_scope.Combobox;

__ds_ns.Field = __ds_scope.Field;

__ds_ns.Input = __ds_scope.Input;

__ds_ns.InputGroupAddon = __ds_scope.InputGroupAddon;

__ds_ns.InputGroup = __ds_scope.InputGroup;

__ds_ns.Label = __ds_scope.Label;

__ds_ns.Radio = __ds_scope.Radio;

__ds_ns.RadioGroup = __ds_scope.RadioGroup;

__ds_ns.Select = __ds_scope.Select;

__ds_ns.Slider = __ds_scope.Slider;

__ds_ns.Switch = __ds_scope.Switch;

__ds_ns.Textarea = __ds_scope.Textarea;

__ds_ns.Command = __ds_scope.Command;

__ds_ns.Pagination = __ds_scope.Pagination;

__ds_ns.Sidebar = __ds_scope.Sidebar;

__ds_ns.ThemeSwitcher = __ds_scope.ThemeSwitcher;

__ds_ns.AlertDialog = __ds_scope.AlertDialog;

__ds_ns.Dialog = __ds_scope.Dialog;

__ds_ns.Drawer = __ds_scope.Drawer;

__ds_ns.DropdownMenu = __ds_scope.DropdownMenu;

__ds_ns.Popover = __ds_scope.Popover;

__ds_ns.Tooltip = __ds_scope.Tooltip;

})();
