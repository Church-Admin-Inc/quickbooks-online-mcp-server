import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

/**
 * The Company-connection MCP App (issue #28).
 *
 * Every path that asks an employee to connect a QuickBooks Company —
 * `authorize_company` (issue #29) and the lazy-grant checkpoint in
 * ../helpers/register-tool.ts (issue #8) — could previously only hand back a
 * sentence with a Markdown link in it. MCP Apps (SEP-1865) let a server ship
 * an HTML component that a supporting host renders inline, so the employee
 * gets an actual "Connect" button instead of a URL to read.
 *
 * The contract has three parts and a host needs all three:
 *
 *   1. a resource at a `ui://` URI whose mimeType is
 *      `text/html;profile=mcp-app` (registerConnectCompanyApp below),
 *   2. `_meta.ui.resourceUri` pointing at it — on the tool definition, and
 *      on the tool result, and
 *   3. `structuredContent` on the result, which is handed to the component
 *      and is NOT shown to the model.
 *
 * The text content stays exactly as it was on every one of those results.
 * It is the fallback for every client that does not implement MCP Apps —
 * Claude Code's own MCP client among them — and it is also what the model
 * reads, since `structuredContent` never reaches it.
 */

/** Where the component lives. `ui://` is what marks a resource as an MCP App. */
export const CONNECT_COMPANY_RESOURCE_URI = "ui://quickbooks/connect-company.html";

/** The MCP Apps mimeType (SEP-1865). A plain `text/html` resource is not rendered. */
export const CONNECT_COMPANY_MIME_TYPE = "text/html;profile=mcp-app";

/** The pointer a tool definition or tool result carries to bind itself to the component. */
export const CONNECT_COMPANY_UI_META = {
  ui: { resourceUri: CONNECT_COMPANY_RESOURCE_URI },
} as const;

/**
 * Why the employee is being asked to connect. Drives the component's wording,
 * so someone reconnecting a dead QuickBooks connection is never told they
 * have not connected it yet — the same distinction the text fallback draws.
 *
 * - `new` — no Company named at all: `authorize_company`, where the employee
 *   picks the Company on Intuit's own screen.
 * - `missing` — a named Company this employee has never authorized.
 * - `unhealthy` — a named Company whose QuickBooks connection has since died.
 */
export type ConnectCompanyReason = "new" | "missing" | "unhealthy";

export interface ConnectCompanyPrompt {
  /** The one-time authorization URL this server minted. */
  authorizeUrl: string;
  reason: ConnectCompanyReason;
  /** The Company's name, when one is known. Absent for `new`. */
  companyName?: string;
  /** The Company's Realm ID, when one is known. Absent for `new`. */
  realmId?: string;
}

/**
 * The component's data. Snake_case to match every other structured payload
 * this server emits (see ../handlers/authorize-company.handler.ts). Optional
 * fields are omitted rather than set to null so the component can test for
 * presence directly.
 */
export function connectCompanyStructuredContent(
  prompt: ConnectCompanyPrompt
): Record<string, unknown> {
  return {
    authorize_url: prompt.authorizeUrl,
    reason: prompt.reason,
    ...(prompt.companyName === undefined ? {} : { company_name: prompt.companyName }),
    ...(prompt.realmId === undefined ? {} : { realm_id: prompt.realmId }),
  };
}

/**
 * Everything a tool result needs to render as the component, spread onto the
 * `{ content: [...] }` every handler already returns. Both keys are
 * host-and-component-only: a client that ignores them still sees the text.
 */
export function connectCompanyResultFields(prompt: ConnectCompanyPrompt): {
  structuredContent: Record<string, unknown>;
  _meta: Record<string, unknown>;
} {
  return {
    structuredContent: connectCompanyStructuredContent(prompt),
    // A fresh object rather than the shared constant: a result's _meta is
    // handed to the SDK, and nothing downstream should be able to mutate the
    // pointer every other result reads from.
    _meta: { ui: { resourceUri: CONNECT_COMPANY_RESOURCE_URI } },
  };
}

/**
 * The component, as one self-contained HTML document.
 *
 * Inline styles and script only — no external stylesheet, font or image —
 * for the same reasons as the browser-facing pages in
 * ../http/authorization-page.ts: it renders identically offline and leaks no
 * referrer. Here there is a second reason: an MCP App runs in a sandboxed
 * cross-origin iframe whose CSP the host controls, and a subresource request
 * is the first thing such a sandbox denies.
 *
 * Company names come from QuickBooks' own CompanyInfo — set by whoever
 * administers that Company, not by this app — so they are untrusted. The
 * script assigns them through `textContent`, never `innerHTML`, so a crafted
 * name is text and can never become markup.
 */
export function renderConnectCompanyApp(): string {
  return CONNECT_COMPANY_HTML;
}

/**
 * Registers the component on an MCP server. Called once per server instance
 * (see ../server/register-all-tools.ts), alongside the tools, so the stdio
 * and streamable-HTTP transports expose the same surface. Registering it
 * adds the `resources` capability to the server, which is what lets a host
 * fetch the component at all.
 */
export function registerConnectCompanyApp(server: McpServer): void {
  server.registerResource(
    "connect-company",
    CONNECT_COMPANY_RESOURCE_URI,
    {
      title: "Connect a QuickBooks Company",
      description:
        "Interactive prompt for connecting (or reconnecting) a QuickBooks Company to this server.",
      mimeType: CONNECT_COMPANY_MIME_TYPE,
    },
    () => ({
      contents: [
        {
          uri: CONNECT_COMPANY_RESOURCE_URI,
          mimeType: CONNECT_COMPANY_MIME_TYPE,
          text: renderConnectCompanyApp(),
        },
      ],
    })
  );
}

/**
 * The component's script takes its data from whichever channel the host
 * offers, because MCP Apps hosts do not agree on one:
 *
 *   - `window.openai.toolOutput`, set before the document runs;
 *   - a `notifications/tools/call/result` JSON-RPC notification posted to
 *     the iframe after it announces itself with `notifications/initialized`.
 *
 * Neither is guaranteed, so the document renders a usable card with no data
 * at all: the generic "Connect a QuickBooks Company" wording, with the button
 * hidden until an authorize URL actually arrives.
 */
const CONNECT_COMPANY_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Connect a QuickBooks Company</title>
<style>
*{box-sizing:border-box}
body{margin:0;padding:16px;background:transparent;color:#1c1e21;
font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
line-height:1.5;-webkit-font-smoothing:antialiased}
main{max-width:26rem;background:#fff;border:1px solid #e3e5e8;border-radius:12px;padding:20px 20px 18px;
box-shadow:0 1px 2px rgba(0,0,0,.04)}
h1{margin:0 0 6px;font-size:1rem;font-weight:600;letter-spacing:-.01em}
p{margin:0;font-size:.875rem;color:#5c6169}
a.connect{display:inline-block;margin-top:16px;padding:9px 18px;border-radius:8px;background:#1c1e21;
color:#fff;font-size:.875rem;font-weight:600;text-decoration:none}
a.connect:focus-visible{outline:2px solid #1c1e21;outline-offset:2px}
[hidden]{display:none}
/* Unlike the browser-facing pages in ../http/authorization-page.ts, this one
   is embedded in a host's own chat surface, which is as often dark as light. */
@media (prefers-color-scheme:dark){
body{color:#ececec}
main{background:#1f2023;border-color:#34363b;box-shadow:none}
p{color:#a6a9b0}
a.connect{background:#ececec;color:#1c1e21}
a.connect:focus-visible{outline-color:#ececec}
}
</style>
</head>
<body>
<main>
  <h1 id="heading">Connect a QuickBooks Company</h1>
  <p id="detail">Sign in with your Intuit account and choose the Company to connect.</p>
  <a id="connect" class="connect" target="_blank" rel="noopener noreferrer" hidden>Connect QuickBooks</a>
</main>
<script>
(function () {
  var heading = document.getElementById("heading");
  var detail = document.getElementById("detail");
  var connect = document.getElementById("connect");

  function post(message) {
    try {
      window.parent.postMessage(message, "*");
    } catch (e) {
      /* no host listening is not an error worth showing the employee */
    }
  }

  function render(data) {
    if (!data || typeof data !== "object") return;
    var name = typeof data.company_name === "string" ? data.company_name : "";
    var label = name || (typeof data.realm_id === "string" ? data.realm_id : "");

    if (data.reason === "unhealthy") {
      heading.textContent = label ? "Reconnect " + label : "Reconnect a QuickBooks Company";
      detail.textContent =
        "This QuickBooks connection is no longer valid. Sign in with your Intuit account to " +
        "restore it, then retry your request.";
      connect.textContent = "Reconnect QuickBooks";
    } else if (label) {
      heading.textContent = "Connect " + label;
      detail.textContent =
        "You have not authorized this QuickBooks Company yet. Sign in with your Intuit account to " +
        "connect it, then retry your request.";
      connect.textContent = "Connect QuickBooks";
    }

    if (typeof data.authorize_url === "string" && /^https?:\\/\\//.test(data.authorize_url)) {
      connect.href = data.authorize_url;
      connect.hidden = false;
    }
    post({ jsonrpc: "2.0", method: "notifications/size_changed",
           params: { height: document.documentElement.scrollHeight } });
  }

  window.addEventListener("message", function (event) {
    if (event.source !== window.parent) return;
    var message = event.data;
    if (!message || message.method !== "notifications/tools/call/result") return;
    var result = message.params || {};
    render(result.structuredContent || result);
  });

  post({ jsonrpc: "2.0", method: "notifications/initialized" });
  if (window.openai && window.openai.toolOutput) render(window.openai.toolOutput);
})();
</script>
</body>
</html>`;
