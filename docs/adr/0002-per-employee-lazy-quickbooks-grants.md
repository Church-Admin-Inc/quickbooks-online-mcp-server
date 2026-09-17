---
status: accepted
---

# QuickBooks grants are per-employee and created lazily

A [QuickBooks connection](../../CONTEXT.md) could be owned by the agency — one
grant per Company, shared by every employee — or by each employee individually.
We chose per-employee grants, created the first time that employee touches a
Company rather than all at once during onboarding.

## Considered Options

**Agency-owned tokens.** 35 grants total, and the natural reading of "the agency
administers these books". Rejected for two reasons. Access control would need a
second permission system of our own, maintained alongside the one managers
already use in QuickBooks. And QuickBooks attributes API writes to the
authorizing identity, so every Company's audit log would read "Church Admin's
integration" and never name the person who posted the journal entry — for a
write-heavy workload on client books, that is the wrong trade.

**Per-employee tokens, granted up front.** Rejected on arithmetic: Intuit
authorizes one realm per handshake and publishes no API that enumerates the
Companies a user or accountant firm can reach, so onboarding would mean roughly
6 x 35 = 210 handshakes before anyone did any work.

**Per-employee tokens, granted lazily.** Chosen.

## Consequences

Managers keep granting and revoking access in QuickBooks, where they already
work; no parallel ACL exists to drift. An employee can only complete a grant for
a Company their own Intuit login reaches. QuickBooks' audit log names the real
person on every write. Grants accumulate only for Companies an employee actually
touches.

Employee login to this server therefore federates to **Intuit** rather than to
Google Workspace: the same identity that owns the grants also identifies the
caller, so no mapping table is needed.

Two costs we accepted:

*First-touch friction.* The first use of a Company in a conversation interrupts
the employee with an authorization popup.

*Revocation is eventually-consistent.* Intuit does not appear to enforce the
authorizing user's in-company role on subsequent API calls — no primary-source
statement exists either way, and developer reports suggest it does not. So
QuickBooks-managed access is a real boundary at **grant** time and only an
eventual one afterwards: an employee removed from a Company in QuickBooks cannot
create new grants, but an existing refresh token may keep working until revoked.
Mitigated by re-validating grants weekly and expiring any grant unused for 30
days. Instant revocation would be a materially more expensive design.

Operationally this means many more tokens than the 35 an agency-owned design
would hold. That is a scheduled job, not a chore: Intuit's refresh tokens roll to
100 days on each use, so a daily refresh keeps every grant alive indefinitely.
Refreshes must be single-flight per grant — two concurrent refreshes of the same
token yield `invalid_grant` and can trigger revocation — which the token store
enforces transactionally.
