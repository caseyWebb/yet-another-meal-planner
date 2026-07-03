/* Order Helper — curated Lucide icon set. 2px stroke, round caps, currentColor.
   Ported verbatim from the Claude Design bundle (order-helper/icons.jsx); `React` is the
   global provided by the vendored React UMD that loads before this bundle. */

function mk(paths) {
  return function Icon(props) {
    const size = (props && props.size) || 16;
    const rest = Object.assign({}, props);
    delete rest.size;
    return React.createElement(
      "svg",
      Object.assign(
        {
          xmlns: "http://www.w3.org/2000/svg",
          width: size,
          height: size,
          viewBox: "0 0 24 24",
          fill: "none",
          stroke: "currentColor",
          strokeWidth: 2,
          strokeLinecap: "round",
          strokeLinejoin: "round",
          "aria-hidden": "true",
        },
        rest,
      ),
      paths.map(function (d, i) {
        return React.createElement("path", { key: i, d: d });
      }),
    );
  };
}
function mkRaw(children) {
  return function Icon(props) {
    const size = (props && props.size) || 16;
    const rest = Object.assign({}, props);
    delete rest.size;
    return React.createElement(
      "svg",
      Object.assign(
        {
          xmlns: "http://www.w3.org/2000/svg",
          width: size,
          height: size,
          viewBox: "0 0 24 24",
          fill: "none",
          stroke: "currentColor",
          strokeWidth: 2,
          strokeLinecap: "round",
          strokeLinejoin: "round",
          "aria-hidden": "true",
        },
        rest,
      ),
      children(),
    );
  };
}
const e = React.createElement;

export const I = {
  refresh: mk(["M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8", "M21 3v5h-5", "M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16", "M8 16H3v5"]),
  check: mk(["M20 6 9 17l-5-5"]),
  checkCircle: mkRaw(function () { return [e("circle", { key: 0, cx: 12, cy: 12, r: 10 }), e("path", { key: 1, d: "m9 12 2 2 4-4" })]; }),
  x: mk(["M18 6 6 18", "M6 6l12 12"]),
  cart: mkRaw(function () { return [e("circle", { key: 0, cx: 8, cy: 21, r: 1 }), e("circle", { key: 1, cx: 19, cy: 21, r: 1 }), e("path", { key: 2, d: "M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12" })]; }),
  store: mkRaw(function () { return [e("path", { key: 0, d: "m2 7 4.41-4.41A2 2 0 0 1 7.83 2h8.34a2 2 0 0 1 1.42.59L22 7" }), e("path", { key: 1, d: "M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" }), e("path", { key: 2, d: "M15 22v-4a2 2 0 0 0-2-2h-2a2 2 0 0 0-2 2v4" }), e("path", { key: 3, d: "M2 7h20" }), e("path", { key: 4, d: "M22 7v3a2 2 0 0 1-2 2 2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 16 12a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 12 12a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 8 12a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 4 12a2 2 0 0 1-2-2V7" })]; }),
  wifi: mk(["M12 20h.01", "M2 8.82a15 15 0 0 1 20 0", "M5 12.859a10 10 0 0 1 14 0", "M8.5 16.429a5 5 0 0 1 7 0"]),
  wifiOff: mk(["M12 20h.01", "M8.5 16.429a5 5 0 0 1 7 0", "M5 12.859a10 10 0 0 1 5.17-2.69", "M19 12.859a10 10 0 0 0-2.007-1.523", "M2 8.82a15 15 0 0 1 4.177-2.643", "M22 8.82a15 15 0 0 0-11.288-3.764", "M2 2l20 20"]),
  alert: mkRaw(function () { return [e("path", { key: 0, d: "m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" }), e("path", { key: 1, d: "M12 9v4" }), e("path", { key: 2, d: "M12 17h.01" })]; }),
  search: mkRaw(function () { return [e("circle", { key: 0, cx: 11, cy: 11, r: 8 }), e("path", { key: 1, d: "m21 21-4.3-4.3" })]; }),
  chevronRight: mk(["m9 18 6-6-6-6"]),
  chevronDown: mk(["m6 9 6 6 6-6"]),
  pause: mkRaw(function () { return [e("rect", { key: 0, x: 14, y: 4, width: 4, height: 16, rx: 1 }), e("rect", { key: 1, x: 6, y: 4, width: 4, height: 16, rx: 1 })]; }),
  play: mkRaw(function () { return [e("polygon", { key: 0, points: "6 3 20 12 6 21 6 3" })]; }),
  stop: mkRaw(function () { return [e("rect", { key: 0, x: 5, y: 5, width: 14, height: 14, rx: 2 })]; }),
  lock: mkRaw(function () { return [e("rect", { key: 0, width: 18, height: 11, x: 3, y: 11, rx: 2, ry: 2 }), e("path", { key: 1, d: "M7 11V7a5 5 0 0 1 10 0v4" })]; }),
  sun: mkRaw(function () { return [e("circle", { key: 0, cx: 12, cy: 12, r: 4 }), e("path", { key: 1, d: "M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" })]; }),
  moon: mk(["M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"]),
  arrowRight: mk(["M5 12h14", "m12 5 7 7-7 7"]),
  external: mkRaw(function () { return [e("path", { key: 0, d: "M15 3h6v6" }), e("path", { key: 1, d: "M10 14 21 3" }), e("path", { key: 2, d: "M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" })]; }),
  circle: mkRaw(function () { return [e("circle", { key: 0, cx: 12, cy: 12, r: 10 })]; }),
  dot: mkRaw(function () { return [e("circle", { key: 0, cx: 12, cy: 12, r: 3, fill: "currentColor", stroke: "none" })]; }),
  minus: mk(["M5 12h14"]),
  package: mkRaw(function () { return [e("path", { key: 0, d: "M11 21.73a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73z" }), e("path", { key: 1, d: "M3.3 7 12 12l8.7-5" }), e("path", { key: 2, d: "M12 22V12" })]; }),
  sparkles: mk(["M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"]),
  listChecks: mk(["m3 17 2 2 4-4", "m3 7 2 2 4-4", "M13 6h8", "M13 12h8", "M13 18h8"]),
  settings: mkRaw(function () { return [e("path", { key: 0, d: "M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" }), e("circle", { key: 1, cx: 12, cy: 12, r: 3 })]; }),
  info: mkRaw(function () { return [e("circle", { key: 0, cx: 12, cy: 12, r: 10 }), e("path", { key: 1, d: "M12 16v-4" }), e("path", { key: 2, d: "M12 8h.01" })]; }),
  shieldCheck: mkRaw(function () { return [e("path", { key: 0, d: "M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" }), e("path", { key: 1, d: "m9 12 2 2 4-4" })]; }),
  swap: mk(["M16 3h5v5", "M8 3H3v5", "M21 3l-7 7", "M3 21l7-7", "M16 21h5v-5", "M8 21H3v-5"]),
  replace: mkRaw(function () { return [e("path", { key: 0, d: "M14 4a2 2 0 0 1 2-2" }), e("path", { key: 1, d: "M16 10a2 2 0 0 1-2-2" }), e("path", { key: 2, d: "M20 2a2 2 0 0 1 2 2" }), e("path", { key: 3, d: "M22 8a2 2 0 0 1-2 2" }), e("path", { key: 4, d: "m3 7 3 3 3-3" }), e("path", { key: 5, d: "M6 10V5a3 3 0 0 1 3-3h1" }), e("rect", { key: 6, x: 2, y: 14, width: 8, height: 8, rx: 2 })]; }),
  utensils: mk(["M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2", "M7 2v20", "M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7"]),
};
