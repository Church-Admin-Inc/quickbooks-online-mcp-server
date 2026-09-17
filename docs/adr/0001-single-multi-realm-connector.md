---
status: accepted
---

# One multi-realm connector, not one connector per Company

The agency keeps books for 35+ [Companies](../../CONTEXT.md) and needs Claude to
reach all of them. QuickBooks grants are per-realm, so the obvious path is to
register the server once per Company — 35 connector entries, each bound to one
realm, with today's single-tenant client untouched. We rejected that and instead
made `realm_id` an explicit parameter on every tool, served by a single
connector.

## Considered Options

**35 connector registrations.** Appears far cheaper, but the saving is an
illusion: it still requires the whole expensive half of the work — streamable
HTTP transport, an OAuth authorization server with RFC 9728 protected-resource
metadata, Cloud Run, a shared token store, and Intuit's production app
assessment. All it avoids is threading the realm through, and this codebase has
two chokepoints that make that cheap: `RegisterTool` (injects the parameter into
all 145 tool schemas in one place) and `QuickbooksClient.getInstance()` (reads
the resolved Company from an `AsyncLocalStorage` context rather than a module
singleton). Roughly a day of work saved.

**One multi-realm connector.** Chosen.

## Consequences

The rejected option charges rent forever: 35 entries in every employee's
connector list; 145 tools of context per *enabled* connector, so an employee
comparing two Companies pays 290 and one who leaves several enabled silently
degrades tool selection everywhere; cross-Company questions ("which Companies
have AR over 90 days?") become impossible in a single conversation; and each new
Company each quarter requires every employee to add a connector by hand.

Under the chosen option a new Company simply appears in `list_companies`.

The cost we accepted: the Company is now a parameter Claude must get right.
Mitigated by making `realm_id` **required on every create/update/delete** —
enforced centrally via the existing `getCrudCategory` prefix classification —
so a write can never inherit an ambient or stale Company. Reads may default to a
session Company; writes may not.
