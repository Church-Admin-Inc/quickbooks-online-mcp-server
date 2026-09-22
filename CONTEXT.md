# Context

Glossary for this repository. Terms only — no implementation detail, no decisions.

## Company

A single QuickBooks Online company file: one organisation's books. The agency
administers many of these on behalf of the organisations it serves.

Aligned with QuickBooks' own `CompanyInfo` entity. Never called a "client".

## Realm ID

Intuit's opaque identifier for a Company. The canonical key for a Company
everywhere in this codebase, matching the existing `QUICKBOOKS_REALM_ID`
configuration and the `realmId` used throughout the QuickBooks client.

## Customer

A QuickBooks entity: someone a [[Company]] invoices. Strictly the QBO entity
exposed by `get_customer`, `search_customers`, and friends. A Customer lives
*inside* a Company's books and is never a Company itself.

## Client

Avoided entirely as a term for an organisation. In this codebase "client" means
only an MCP client (the software connecting to this server) or an OAuth client
(as in `client_id`). When referring to an organisation whose books the agency
keeps, say [[Company]].

## Connection

Ambiguous on its own; always qualify.

- **MCP connection** — an MCP client's session with this server.
- **QuickBooks connection** — this server's authorised access to one
  [[Company]], represented by a stored refresh token for that [[Realm ID]].

The two are independent: re-establishing an MCP connection does nothing to a
QuickBooks connection. A QuickBooks connection is established only by the
`authorize_company` tool or by naming an unauthorized [[Company]] in a tool
call — never from an MCP client's own connector settings.
