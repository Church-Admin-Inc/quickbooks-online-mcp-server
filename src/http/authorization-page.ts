/**
 * The browser-facing pages of the Company-authorization flow (issue #31).
 *
 * These are the only part of this server an employee ever looks at directly,
 * and they sit mid-flow between Intuit's sign-in and the return to Claude.
 * They are deliberately unbranded: a page that dressed itself as either end
 * of that journey would misrepresent who is asking. Everything is inline —
 * no external stylesheet, font or image — so a page renders identically on a
 * slow or offline network and leaks no referrer to a third party.
 */

/**
 * Whether the flow ended in a connected Company or in something the employee
 * has to act on. Drives the mark and its colour, so the two are
 * distinguishable at a glance rather than only by reading the text.
 */
export type AuthorizationOutcome = "success" | "failure";

export interface AuthorizationPage {
  outcome: AuthorizationOutcome;
  /** Short statement of what happened, as a sentence fragment — no trailing period. */
  heading: string;
  /** What is true now, or what to do next. One or two sentences. */
  detail: string;
}

/**
 * Escapes the HTML-significant characters in text interpolated into a page.
 * Applied to every value renderAuthorizationPage() interpolates, rather than
 * at each call site, so a future page cannot reintroduce an injection by
 * forgetting it. Load-bearing for the Company name
 * (../auth/company-info-provider.ts): it comes from QuickBooks' own
 * CompanyInfo — set by whoever administers that Company, not by this app —
 * so it is untrusted input, exactly as ../helpers/register-tool.ts's
 * escapeMarkdown() treats it.
 */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/**
 * Deliberately no dark-mode variant: these pages are opened once, read once
 * and closed, and a single well-lit surface is one fewer thing to get wrong.
 */
const STYLES = `
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;
background:#f4f5f7;color:#1c1e21;
font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
line-height:1.5;-webkit-font-smoothing:antialiased}
main{width:100%;max-width:26rem;background:#fff;border:1px solid #e3e5e8;border-radius:12px;
padding:40px 32px;text-align:center;box-shadow:0 1px 2px rgba(0,0,0,.04),0 8px 24px rgba(0,0,0,.06)}
.mark{width:48px;height:48px;margin:0 auto 20px;border-radius:50%;display:flex;align-items:center;justify-content:center}
.mark svg{width:24px;height:24px;stroke-width:2.5;stroke-linecap:round;stroke-linejoin:round;fill:none}
.success .mark{background:#e6f4ec}.success .mark svg{stroke:#1a7f47}
.failure .mark{background:#fdecec}.failure .mark svg{stroke:#b42318}
h1{margin:0 0 8px;font-size:1.25rem;font-weight:600;letter-spacing:-.01em}
p{margin:0;font-size:.9375rem;color:#5c6169}
`;

const MARKS: Record<AuthorizationOutcome, string> = {
  // Inline, not an image request: see this module's own docstring.
  success: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12.5l5 5L20 6.5"/></svg>`,
  failure: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 7v6M12 17h.01"/><circle cx="12" cy="12" r="9"/></svg>`,
};

/** The full HTML document for one page. */
export function renderAuthorizationPage(page: AuthorizationPage): string {
  return (
    `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1">` +
    // Titles the browser tab and, more usefully, whatever the employee sees
    // if this ends up in their history.
    `<title>${escapeHtml(page.heading)} - QuickBooks</title>` +
    `<style>${STYLES}</style></head>` +
    `<body class="${page.outcome}"><main>` +
    `<div class="mark">${MARKS[page.outcome]}</div>` +
    `<h1>${escapeHtml(page.heading)}</h1>` +
    `<p>${escapeHtml(page.detail)}</p>` +
    `</main></body></html>`
  );
}
