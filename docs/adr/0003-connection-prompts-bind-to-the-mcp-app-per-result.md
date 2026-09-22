---
status: accepted
---

# A connection prompt binds to the MCP App per result, not per tool

MCP Apps let a server ship an HTML component and have a host render a tool
result as that component instead of as text. A host learns which component to
render from `_meta.ui.resourceUri`, which a server may put in two places: on a
tool's definition (every result of that tool renders as the component) or on an
individual tool result.

Our connection prompt (see [Connection](../../CONTEXT.md)) is produced from two
places. `authorize_company` returns one and nothing else. The lazy-grant
checkpoint returns one from *any* of the server's ~145 tools, on the small
fraction of calls that name a [Company](../../CONTEXT.md) the employee has no
healthy grant for.

## Considered Options

**Declare the component on every tool.** Rejected. A tool-level binding is a
claim about every result that tool ever returns, and `create_invoice`'s ordinary
result is an invoice, not a connection prompt. Hosts would be told to render
every invoice, report and search result as a "Connect" card.

**A separate tool that only returns connection prompts, which the checkpoint
tells the model to call.** Rejected: it turns a refusal the employee can act on
directly into a round trip through the model, and the model may not make it.

**Bind per result for the checkpoint, per tool for `authorize_company`.**
Chosen. `authorize_company` gets both, since every one of its results really is
a connection prompt and the tool-level pointer is what a host reads from
`tools/list`; the checkpoint gets the result-level pointer only.

## Consequences

`ToolDefinition` carries an optional `uiResourceUri`, opted into by one tool
today, and the checkpoint's refusal carries `_meta` and `structuredContent` of
its own.

A host that honours only the tool-level binding renders the component for
`authorize_company` and falls back to text for the checkpoint. That fallback is
not a degraded path we tolerate but the one every non-MCP-Apps client gets, and
the only version the *model* ever reads, since `structuredContent` does not
reach it: the Markdown link in `content` stays load-bearing and stays tested.

No tool declares an `outputSchema`. Declaring one obliges every result of that
tool to carry `structuredContent`, which a connection prompt's sibling results
(an invoice, an error) do not. A host that forwards `structuredContent` only for
tools with a declared output schema would therefore not render the component;
whether any does is a question for live verification, not for this decision.
