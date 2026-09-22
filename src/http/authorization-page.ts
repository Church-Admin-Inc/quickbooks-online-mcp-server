/**
 * The browser-facing pages of the Company-authorization flow (issue #31).
 *
 * These are the only part of this server an employee sees mid-flow, sitting
 * between Intuit's sign-in and the return to Claude. They are one variant of
 * the shared page surface in ./page.ts, which holds the document shell, the
 * base stylesheet and the escaping; what is here is only what makes an
 * authorization result an authorization result — an outcome mark, and the
 * two lines beside it.
 */
import { escapeHtml, renderPage } from "./page.js";

/**
 * Re-exported for the callers and tests that knew it here before the shell
 * moved to ./page.ts. That module is the canonical home; new code should
 * import it from there.
 */
export { escapeHtml };

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

/** Only the mark; the rest of the card is the shared stylesheet. */
const STYLES = `
.mark{width:48px;height:48px;margin:0 auto 20px;border-radius:50%;display:flex;align-items:center;justify-content:center}
.mark svg{width:24px;height:24px;stroke-width:2.5;stroke-linecap:round;stroke-linejoin:round;fill:none}
.success .mark{background:#e6f4ec}.success .mark svg{stroke:#1a7f47}
.failure .mark{background:#fdecec}.failure .mark svg{stroke:#b42318}
`;

const MARKS: Record<AuthorizationOutcome, string> = {
  // Inline, not an image request: see ./page.ts's own docstring.
  success: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12.5l5 5L20 6.5"/></svg>`,
  failure: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 7v6M12 17h.01"/><circle cx="12" cy="12" r="9"/></svg>`,
};

/** The full HTML document for one page. */
export function renderAuthorizationPage(page: AuthorizationPage): string {
  return renderPage({
    title: page.heading,
    bodyClass: page.outcome,
    styles: STYLES,
    body:
      `<div class="mark">${MARKS[page.outcome]}</div>` +
      `<h1>${escapeHtml(page.heading)}</h1>` +
      `<p>${escapeHtml(page.detail)}</p>`,
  });
}
