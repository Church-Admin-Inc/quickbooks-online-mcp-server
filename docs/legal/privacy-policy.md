# Privacy Policy — QuickBooks Online MCP Server

**Status: DRAFT for review. Not legal advice.** Written to satisfy the Privacy
Policy URL that Intuit requires before releasing production keys (issue #14).
Have counsel review before publishing, and replace every `TODO` below.

**Operator:** Church Admin Inc ("we")
**Contact:** TODO — a monitored address, e.g. `privacy@churchadm.com`
**Last updated:** TODO — date of publication

## Who this covers

This application is private and internal. It is used by Church Admin Inc
personnel to do bookkeeping work on behalf of the client organizations whose
books we keep. It is not offered to the public and is not listed on the
QuickBooks App Store.

Two groups of people are relevant:

- **Our personnel**, who sign in with their own Intuit account to use the app.
- **Our clients**, whose QuickBooks companies we are engaged to keep books for.
  Our handling of client data is governed by our engagement agreement with each
  client; this policy describes the technical specifics of this application.

## What we collect

**From the person signing in**, via their Intuit account:

- Their Intuit user identifier (`sub`) and email address.

**Per authorized QuickBooks company:**

- The QuickBooks company identifier (realm ID) and the company's display name.
- OAuth access and refresh tokens for that company.
- Timestamps for when the authorization was created, last refreshed, and last
  used, and its current health status.

**An activity log.** Every action taken through this application is recorded
with the person who took it, their email, the company it affected, the operation
performed, its parameters, and when it happened. Because operation parameters
describe the bookkeeping action being performed, this log may contain accounting
detail — amounts, dates, account and class names, memo text, and similar fields.

## What we do not collect

We do not store a general copy of any client's QuickBooks data. Financial
records are read from Intuit's API when needed to answer a request and are not
retained afterwards, apart from the company name and the activity log described
above. We do not collect payment card data, and we do not use any of this
information for advertising or profiling, or sell it.

## How we use it

Solely to operate the service: to authenticate personnel, to maintain the
authorizations that let the application reach each company, to perform the
bookkeeping operations our personnel request, and to keep the activity log that
lets us reconstruct who did what.

## Who we share it with

- **Intuit** — necessarily, since every operation is an API call to QuickBooks
  Online on the authorized company's behalf.
- **Google Cloud Platform** — our hosting provider. The application runs on
  Cloud Run with data stored in Firestore and credentials in Secret Manager, in
  the United States (`us-central1`).
- **Anthropic, PBC** — our personnel operate this application through Claude.
  Data returned by a requested operation passes to Claude in order to be shown
  to the person who asked for it, and is handled under Anthropic's terms for the
  account in use. TODO — confirm which Anthropic plan and terms apply, since
  data handling differs between consumer and commercial plans.

We do not otherwise disclose this information, except where the law requires it.

## Access control

Access is governed by QuickBooks' own permissions rather than by a separate
system of ours. A person can reach a company only if they authorize it with
their own Intuit account, and only to the extent their QuickBooks permissions
allow. An administrator revoking someone's QuickBooks access removes their
access here too. Actions are attributed to the individual in QuickBooks' own
audit log as well as in ours.

## Retention

- **Authorizations** expire automatically after 30 days without use, and are
  deleted when revoked.
- **Activity log entries** are deleted seven years after they are recorded.
  Seven years matches how long the financial records each entry describes are
  themselves kept, which is the reason for keeping the log at all. Deletion is
  automatic: each entry is stamped with its own expiry when written, and our
  database removes it when that passes.
- **Tokens** are deleted when the authorization they belong to ends.

## Disconnecting

Anyone can disconnect a company at any time, which revokes the tokens with
Intuit. Administrators can also revoke access from within QuickBooks directly.

## Security

Traffic is TLS-encrypted. Client credentials are held in Google Secret Manager,
never in source control. Tokens are stored in Firestore under Google Cloud's
encryption at rest. Authorization is checked on every operation.

## Changes

We will update this page and its "last updated" date if our practices change.

## Contact

TODO — monitored address, and a postal address if required in your jurisdiction.
