/**
 * The shared chrome of every browser-facing page this server serves: the
 * document shell, the base stylesheet, and the escaping that keeps untrusted
 * values inert.
 *
 * The authorization result cards (./authorization-page.ts) are so far the
 * only caller; this exists so the prose pages that follow — legal pages, a
 * landing page, a disconnect confirmation — are each only their own content
 * on the same surface. Extracted ahead of them deliberately (issue #32), as
 * a prefactor: the authorization pages render unchanged.
 *
 * Everything is inline — no external stylesheet, font or image — so a page
 * renders identically on a slow or offline network and leaks no referrer to a
 * third party. These pages are also deliberately unbranded: a page that
 * dressed itself as Intuit or as the MCP client would misrepresent who is
 * asking.
 */

/**
 * Escapes the HTML-significant characters in text interpolated into a page.
 * Every page funnels its untrusted values through this rather than escaping
 * at the call site, so a new page cannot reintroduce an injection by
 * forgetting it. Load-bearing for the Company name
 * (../auth/company-info-provider.ts): it comes from QuickBooks' own
 * CompanyInfo — set by whoever administers that Company, not by this app —
 * so it is untrusted input, exactly as ../helpers/register-tool.ts's
 * escapeMarkdown() treats it.
 */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

export interface Page {
  /** Plain text. Escaped here, and titles the tab and the history entry. */
  title: string;
  /**
   * The contents of <main>, as HTML. The caller composes it and is
   * responsible for passing anything untrusted through escapeHtml() — this
   * is the one value that is not escaped, because it is markup by design.
   */
  body: string;
  /** Goes on <body>, for a page that styles itself by variant. */
  bodyClass?: string;
  /** Appended after the shared stylesheet, so a page can extend or override it. */
  styles?: string;
}

/**
 * Deliberately no dark-mode variant: these pages are opened once, read once
 * and closed, and a single well-lit surface is one fewer thing to get wrong.
 *
 * Sized for a phone first — Intuit's reconnect emails are usually opened on
 * one: a fluid card, a viewport meta, and padding that survives a narrow
 * screen. The geometry is still the result card's (centred text, generous
 * padding); a prose page overrides it through `styles`.
 */
const BASE_STYLES = `
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;
background:#f4f5f7;color:#1c1e21;
font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
line-height:1.5;-webkit-font-smoothing:antialiased}
main{width:100%;max-width:26rem;background:#fff;border:1px solid #e3e5e8;border-radius:12px;
padding:40px 32px;text-align:center;box-shadow:0 1px 2px rgba(0,0,0,.04),0 8px 24px rgba(0,0,0,.06)}
h1{margin:0 0 8px;font-size:1.25rem;font-weight:600;letter-spacing:-.01em}
p{margin:0;font-size:.9375rem;color:#5c6169}
`;

/** The full HTML document for one page. */
export function renderPage(page: Page): string {
  return (
    `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1">` +
    // Titles the browser tab and, more usefully, whatever the employee sees
    // if this ends up in their history.
    `<title>${escapeHtml(page.title)} - QuickBooks</title>` +
    `<style>${BASE_STYLES}${page.styles ?? ""}</style></head>` +
    `<body${page.bodyClass ? ` class="${escapeHtml(page.bodyClass)}"` : ""}><main>` +
    page.body +
    `</main></body></html>`
  );
}
