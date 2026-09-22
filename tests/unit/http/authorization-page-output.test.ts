import { describe, it, expect } from '@jest/globals';
import { renderAuthorizationPage } from '../../../src/http/authorization-page';

/**
 * The authorization pages were moved onto the shared renderer (issue #32) as
 * a prefactor: same document, different seams. The suite next door asserts
 * substrings, which would not have caught a drift in the chrome, so this
 * pins the whole document. It was captured from the implementation that
 * predates the extraction; every rule in it, and every byte of markup, is
 * that page's. The only difference from then is the order of the CSS rules —
 * the mark rules now follow the shared ones instead of sitting between
 * `main` and `h1`, which no selector in the sheet is affected by.
 *
 * Failure means the shared chrome changed under these pages. That may be
 * fine — update the expectation deliberately, don't loosen the test.
 */
const GOLDEN_SUCCESS =
  '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">' +
  '<meta name="viewport" content="width=device-width,initial-scale=1">' +
  '<title>Connected to Grace - QuickBooks</title>' +
  '<style>\n' +
  '*{box-sizing:border-box}\n' +
  'body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;\n' +
  'background:#f4f5f7;color:#1c1e21;\n' +
  'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;\n' +
  'line-height:1.5;-webkit-font-smoothing:antialiased}\n' +
  'main{width:100%;max-width:26rem;background:#fff;border:1px solid #e3e5e8;border-radius:12px;\n' +
  'padding:40px 32px;text-align:center;box-shadow:0 1px 2px rgba(0,0,0,.04),0 8px 24px rgba(0,0,0,.06)}\n' +
  'h1{margin:0 0 8px;font-size:1.25rem;font-weight:600;letter-spacing:-.01em}\n' +
  'p{margin:0;font-size:.9375rem;color:#5c6169}\n' +
  '\n' +
  '.mark{width:48px;height:48px;margin:0 auto 20px;border-radius:50%;display:flex;align-items:center;justify-content:center}\n' +
  '.mark svg{width:24px;height:24px;stroke-width:2.5;stroke-linecap:round;stroke-linejoin:round;fill:none}\n' +
  '.success .mark{background:#e6f4ec}.success .mark svg{stroke:#1a7f47}\n' +
  '.failure .mark{background:#fdecec}.failure .mark svg{stroke:#b42318}\n' +
  '</style></head>' +
  '<body class="success"><main>' +
  '<div class="mark"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12.5l5 5L20 6.5"/></svg></div>' +
  '<h1>Connected to Grace</h1>' +
  '<p>You can return to Claude.</p>' +
  '</main></body></html>';

describe('the authorization page document', () => {
  it('is unchanged by the move onto the shared renderer', () => {
    expect(
      renderAuthorizationPage({
        outcome: 'success',
        heading: 'Connected to Grace',
        detail: 'You can return to Claude.',
      })
    ).toBe(GOLDEN_SUCCESS);
  });

  it('differs from the success document only in the mark and the outcome class', () => {
    const failure = renderAuthorizationPage({
      outcome: 'failure',
      heading: 'Connected to Grace',
      detail: 'You can return to Claude.',
    });
    expect(failure).toBe(
      GOLDEN_SUCCESS.replace('class="success"', 'class="failure"').replace(
        '<path d="M4 12.5l5 5L20 6.5"/>',
        '<path d="M12 7v6M12 17h.01"/><circle cx="12" cy="12" r="9"/>'
      )
    );
  });
});
