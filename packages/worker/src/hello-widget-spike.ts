// DIAGNOSTIC SPIKE — NOT FOR MERGE TO main.
//
// A throwaway "hello world" MCP Apps widget used to answer one question: does claude.ai
// render an inline `ui://` UI from a SELF-HOSTED custom connector, and if so is the
// postMessage/JSON-RPC bridge live? MCP Apps (`io.modelcontextprotocol/ui`, spec
// 2026-01-26) delivers a widget as a `ui://` resource (MIME `text/html;profile=mcp-app`)
// referenced from a tool via `_meta.ui.resourceUri`; the host renders it in a sandboxed
// iframe and hydrates it from the tool's `structuredContent`.
//
// Everything widget-related lives in THIS file so it rips out in one delete + one import
// line in tools.ts. It registers three things onto the same McpServer buildServer() serves:
//   - `hello_widget` — the tool that references the ui:// resource + returns structuredContent.
//     It ALSO reports whether the connected client advertised the MCP Apps capability, which
//     tells us whether claude.ai negotiates the extension for a custom connector at all.
//   - `echo` — a trivial tool the widget calls through the bridge (the interactive-leg probe).
//   - `ui://hello/card` — the self-contained HTML view (inline JS/CSS, no external requests,
//     so a strict sandbox CSP can't be the reason it fails to render).
//
// Diagnostic reading (see the PR body for the full matrix):
//   nothing renders          → Gate 1 closed (or capability not negotiated — check the tool output).
//   card renders, button dead → display works, interactive bridge blocked.
//   card + echo round-trip    → both gates open.

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE, getUiCapability } from "@modelcontextprotocol/ext-apps/server";
import { z } from "zod";

/** The ui:// resource the widget is served from. `hello_widget._meta.ui.resourceUri` must equal this. */
export const HELLO_URI = "ui://hello/card";

// Self-contained view: hand-rolled bridge (the ext-apps `App` class would need an iframe bundle
// step we don't want for a throwaway) following the spec-verbatim message shapes. No `${}` /
// backticks inside so the whole document stays one static template string. Guards against
// non-JSON-RPC host messages (claude.ai injects an auth frame) and answers host `ping`s.
export const HELLO_WIDGET_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>MCP Apps spike</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 14px/1.5 system-ui, -apple-system, sans-serif; margin: 0; padding: 16px; }
  .card { border: 1px solid #8884; border-radius: 12px; padding: 16px; max-width: 560px; }
  h1 { font-size: 16px; margin: 0 0 12px; }
  .muted { opacity: 0.7; }
  .row { display: flex; gap: 8px; margin-top: 14px; }
  input { flex: 1; padding: 6px 8px; border-radius: 8px; border: 1px solid #8886; background: transparent; color: inherit; }
  button { padding: 6px 12px; border-radius: 8px; border: 0; background: #4f46e5; color: #fff; cursor: pointer; }
  pre { background: #8881; padding: 8px; border-radius: 8px; overflow: auto; margin-top: 14px; font-size: 12px; white-space: pre-wrap; }
</style>
</head>
<body>
<div class="card">
  <h1>&#129514; MCP Apps spike &mdash; the iframe rendered</h1>
  <div>greeting: <strong id="greeting">&hellip;waiting for tool-result&hellip;</strong></div>
  <div class="muted">generated at: <span id="when">&mdash;</span></div>
  <div class="row">
    <input id="echo-in" value="ping from the widget" />
    <button id="echo-btn">Call echo() via the bridge</button>
  </div>
  <div style="margin-top:8px">echo result: <strong id="echo-out">&mdash;</strong></div>
  <pre id="log"></pre>
</div>
<script>
(function () {
  var host = window.parent;
  var pending = {};
  var nextId = 1;
  var logEl = document.getElementById("log");
  function log(msg) { logEl.textContent += msg + "\\n"; }
  function send(obj) { host.postMessage(obj, "*"); }
  function rpc(method, params) {
    var id = nextId++;
    return new Promise(function (resolve, reject) {
      pending[id] = { resolve: resolve, reject: reject };
      send({ jsonrpc: "2.0", id: id, method: method, params: params });
    });
  }
  function hydrate(sc) {
    if (!sc) return;
    if (sc.greeting != null) document.getElementById("greeting").textContent = String(sc.greeting);
    if (sc.when != null) document.getElementById("when").textContent = String(sc.when);
    log("tool-result: " + JSON.stringify(sc));
  }
  window.addEventListener("message", function (e) {
    if (e.source !== host) return;
    var m = e.data;
    if (!m || m.jsonrpc !== "2.0") return; // ignore non-JSON-RPC host frames (e.g. auth handshake)
    if (m.id != null && (Object.prototype.hasOwnProperty.call(m, "result") || m.error)) {
      var p = pending[m.id]; if (!p) return; delete pending[m.id];
      if (m.error) p.reject(m.error); else p.resolve(m.result);
      return;
    }
    if (m.method === "ping") { send({ jsonrpc: "2.0", id: m.id, result: {} }); return; }
    if (m.method === "ui/notifications/tool-result") { hydrate(m.params && m.params.structuredContent); return; }
  });
  document.getElementById("echo-btn").addEventListener("click", function () {
    rpc("tools/call", { name: "echo", arguments: { text: document.getElementById("echo-in").value } })
      .then(function (r) {
        var out = (r && r.structuredContent && r.structuredContent.text) ||
          (r && r.content && r.content[0] && r.content[0].text) || "[no result]";
        document.getElementById("echo-out").textContent = out;
        log("echo() ok: " + out);
      })
      .catch(function (err) {
        document.getElementById("echo-out").textContent = "[error]";
        log("echo() failed: " + JSON.stringify(err));
      });
  });
  log("view booting; sending ui/initialize\\u2026");
  rpc("ui/initialize", { protocolVersion: "2026-01-26", clientInfo: { name: "hello-spike", version: "1.0.0" }, appCapabilities: {} })
    .then(function (res) {
      log("ui/initialize OK; host=" + JSON.stringify(res && res.hostInfo));
      send({ jsonrpc: "2.0", method: "ui/notifications/initialized", params: {} });
    })
    .catch(function (err) { log("ui/initialize FAILED: " + JSON.stringify(err)); });
})();
</script>
</body>
</html>`;

/**
 * Register the diagnostic widget onto `server`. Call once from buildServer(), AFTER
 * instrumentTools() so the throwaway tools are telemetered like every other tool.
 */
export function registerHelloWidgetSpike(server: McpServer): void {
  // The ui:// HTML resource. `{}` config would default the MIME, but we set it explicitly
  // on the content item too — that's the value the host actually reads.
  registerAppResource(
    server,
    "Hello Card",
    HELLO_URI,
    { description: "Diagnostic MCP Apps view (spike)." },
    async () => ({
      contents: [{ uri: HELLO_URI, mimeType: RESOURCE_MIME_TYPE, text: HELLO_WIDGET_HTML }],
    }),
  );

  // The tool that references the view. Its structuredContent hydrates the iframe; it also
  // reports whether THIS client advertised the io.modelcontextprotocol/ui capability — the
  // single most decisive signal for "does claude.ai negotiate MCP Apps for a custom connector".
  registerAppTool(
    server,
    "hello_widget",
    {
      title: "Hello Widget (spike)",
      description:
        "DIAGNOSTIC SPIKE: renders a hello-world MCP Apps view inline. Its output also reports whether the connected client advertised MCP Apps support. Safe to call; writes nothing.",
      inputSchema: {},
      outputSchema: {
        greeting: z.string(),
        when: z.string(),
        client_advertises_mcp_apps: z.boolean(),
        client_ui_capability: z.unknown(),
      },
      _meta: { ui: { resourceUri: HELLO_URI } },
    },
    async () => {
      const uiCapability = getUiCapability(server.server.getClientCapabilities());
      const payload = {
        greeting: "hello world",
        when: new Date().toISOString(),
        client_advertises_mcp_apps: uiCapability !== undefined,
        client_ui_capability: uiCapability ?? null,
      };
      return { content: [{ type: "text", text: JSON.stringify(payload) }], structuredContent: payload };
    },
  );

  // Trivial tool the widget calls through the bridge — the interactive (Gate 2) probe.
  // visibility ["app"] keeps it out of the model's tool list; only the view calls it.
  registerAppTool(
    server,
    "echo",
    {
      title: "Echo (spike)",
      description: "DIAGNOSTIC SPIKE: echoes its input; called by the hello widget through the MCP Apps bridge.",
      inputSchema: { text: z.string() },
      outputSchema: { text: z.string() },
      _meta: { ui: { resourceUri: HELLO_URI, visibility: ["app"] } },
    },
    async ({ text }) => ({
      content: [{ type: "text", text }],
      structuredContent: { text },
    }),
  );
}
