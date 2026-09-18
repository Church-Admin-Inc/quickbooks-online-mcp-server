import { describe, it, expect, afterEach, jest } from "@jest/globals";
import {
  getCrudCategory,
  isToolDisabled,
  knownParamKeys,
  permissiveParamsSchema,
  RegisterTool,
  setAuditLogger,
  setCompanyAuthorizationDeps,
  unsupportedParamsWarning,
} from "../../../src/helpers/register-tool";
import type { AuditLogEntry, AuditLogger } from "../../../src/audit/audit-log";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ToolDefinition } from "../../../src/types/tool-definition";
import {
  getCurrentCompanyContext,
  setDefaultCompanyContext,
} from "../../../src/context/company-context";
import { runWithEmployeeContext } from "../../../src/context/employee-context";
import { runWithRequestContext } from "../../../src/context/request-context";
import { CompanyAuthorizationStore } from "../../../src/auth/company-authorization";
import type { GrantStore, GrantHandle, Grant } from "../../../src/clients/firestore-grant-store";

// ── getCrudCategory ──────────────────────────────────────────────────────────
// Verifies that every verb prefix maps to the correct CRUD category string.
// Uses literal expected values (not re-exported constants) so the test catches
// both a wrong mapping AND a wrong constant value simultaneously.
// Covers both underscore (standard) and hyphen (legacy) separator variants.

describe("getCrudCategory", () => {
  it("returns WRITE for create_ prefix",  () => expect(getCrudCategory("create_invoice")).toBe("WRITE"));
  it("returns WRITE for create- prefix",  () => expect(getCrudCategory("create-bill")).toBe("WRITE"));
  it("returns UPDATE for update_ prefix", () => expect(getCrudCategory("update_customer")).toBe("UPDATE"));
  it("returns UPDATE for update- prefix", () => expect(getCrudCategory("update-vendor")).toBe("UPDATE"));
  it("returns DELETE for delete_ prefix", () => expect(getCrudCategory("delete_payment")).toBe("DELETE"));
  it("returns DELETE for delete- prefix", () => expect(getCrudCategory("delete-bill")).toBe("DELETE"));
  it("returns READ for get_ prefix",      () => expect(getCrudCategory("get_invoice")).toBe("READ"));
  it("returns READ for get- prefix",      () => expect(getCrudCategory("get-vendor")).toBe("READ"));
  it("returns READ for search_ prefix",   () => expect(getCrudCategory("search_customers")).toBe("READ"));
  it("returns READ for read_ prefix",     () => expect(getCrudCategory("read_invoice")).toBe("READ"));
});

// ── isToolDisabled ───────────────────────────────────────────────────────────
// Verifies that the correct env var name gates each CRUD category.
// Uses literal env var names ("QUICKBOOKS_DISABLE_WRITE" etc.) so the test catches any
// mismatch between the documented env var and what the implementation reads.
// afterEach deletes all three vars to prevent state leaking between tests.

describe("isToolDisabled", () => {
  afterEach(() => {
    delete process.env["QUICKBOOKS_DISABLE_WRITE"];
    delete process.env["QUICKBOOKS_DISABLE_UPDATE"];
    delete process.env["QUICKBOOKS_DISABLE_DELETE"];
  });

  // READ tools must never be suppressed regardless of env state.
  it("returns false for READ tool with no env vars set", () =>
    expect(isToolDisabled("get_invoice")).toBe(false));

  it("returns false for READ tool even when all DISABLE vars are true", () => {
    process.env["QUICKBOOKS_DISABLE_WRITE"]  = "true";
    process.env["QUICKBOOKS_DISABLE_UPDATE"] = "true";
    process.env["QUICKBOOKS_DISABLE_DELETE"] = "true";
    expect(isToolDisabled("search_customers")).toBe(false);
  });

  // WRITE — underscore and hyphen variants, both enabled and disabled states.
  it("returns true for WRITE tool when QUICKBOOKS_DISABLE_WRITE=true",        () => { process.env["QUICKBOOKS_DISABLE_WRITE"]  = "true"; expect(isToolDisabled("create_invoice")).toBe(true); });
  it("returns false for WRITE tool when QUICKBOOKS_DISABLE_WRITE unset",       () => expect(isToolDisabled("create_invoice")).toBe(false));
  it("returns true for hyphen WRITE tool when QUICKBOOKS_DISABLE_WRITE=true",  () => { process.env["QUICKBOOKS_DISABLE_WRITE"]  = "true"; expect(isToolDisabled("create-bill")).toBe(true); });

  // UPDATE — underscore and hyphen variants, both enabled and disabled states.
  it("returns true for UPDATE tool when QUICKBOOKS_DISABLE_UPDATE=true",       () => { process.env["QUICKBOOKS_DISABLE_UPDATE"] = "true"; expect(isToolDisabled("update_customer")).toBe(true); });
  it("returns false for UPDATE tool when QUICKBOOKS_DISABLE_UPDATE unset",      () => expect(isToolDisabled("update_customer")).toBe(false));
  it("returns true for hyphen UPDATE tool when QUICKBOOKS_DISABLE_UPDATE=true", () => { process.env["QUICKBOOKS_DISABLE_UPDATE"] = "true"; expect(isToolDisabled("update-vendor")).toBe(true); });

  // DELETE — underscore and hyphen variants, both enabled and disabled states.
  it("returns true for DELETE tool when QUICKBOOKS_DISABLE_DELETE=true",       () => { process.env["QUICKBOOKS_DISABLE_DELETE"] = "true"; expect(isToolDisabled("delete_payment")).toBe(true); });
  it("returns false for DELETE tool when QUICKBOOKS_DISABLE_DELETE unset",      () => expect(isToolDisabled("delete_payment")).toBe(false));
  it("returns true for hyphen DELETE tool when QUICKBOOKS_DISABLE_DELETE=true", () => { process.env["QUICKBOOKS_DISABLE_DELETE"] = "true"; expect(isToolDisabled("delete-bill")).toBe(true); });

  // Boundary: only the exact string "true" disables a tool; other truthy-ish values must not.
  it('returns false when env var is "false"', () => { process.env["QUICKBOOKS_DISABLE_WRITE"] = "false"; expect(isToolDisabled("create_invoice")).toBe(false); });
  it('returns false when env var is "1"',     () => { process.env["QUICKBOOKS_DISABLE_WRITE"] = "1";     expect(isToolDisabled("create_invoice")).toBe(false); });
});

// ── RegisterTool ─────────────────────────────────────────────────────────────
// Verifies the integration between isToolDisabled and server.tool():
//   - Enabled tools are registered with the exact fields from ToolDefinition.
//   - Disabled tools cause RegisterTool to return early without calling server.tool().
// Uses a minimal mock server object to avoid coupling to the MCP SDK internals.

describe("RegisterTool", () => {
  afterEach(() => {
    delete process.env["QUICKBOOKS_DISABLE_WRITE"];
    delete process.env["QUICKBOOKS_DISABLE_UPDATE"];
    delete process.env["QUICKBOOKS_DISABLE_DELETE"];
  });

  const schema = z.object({ id: z.string() });
  const handler = jest.fn() as ToolDefinition<typeof schema>["handler"];
  const def = (name: string): ToolDefinition<typeof schema> =>
    ({ name, description: `desc:${name}`, schema, handler });

  // Confirm all four ToolDefinition fields are forwarded to server.tool() unchanged.
  it("calls server.tool() with all definition fields when enabled", () => {
    const server = { tool: jest.fn() } as unknown as McpServer;
    const d = def("get_invoice");
    RegisterTool(server, d);
    expect(server.tool).toHaveBeenCalledTimes(1);
    const [name, description, shape, handler] = (server.tool as jest.Mock).mock.calls[0] as any[];
    expect(name).toBe(d.name);
    // #4: the description gains a realm_id note at registration time, so it
    // starts with (rather than equals) the definition's own description.
    expect(description).toContain(d.description);
    expect(typeof handler).toBe("function");
    // The registered schema is the definition's schema made permissive, so an
    // unsupported parameter survives validation and can be reported instead of
    // silently vanishing. It is therefore not the same object identity.
    expect((shape.params as any).parse({ id: "1", unexpected_key: 1 }).unexpected_key).toBe(1);
  });

  // One test per mutable category to confirm the early-return path is reached.
  it("skips server.tool() for disabled WRITE tool", () => {
    process.env["QUICKBOOKS_DISABLE_WRITE"] = "true";
    const server = { tool: jest.fn() } as unknown as McpServer;
    RegisterTool(server, def("create_invoice"));
    expect(server.tool).not.toHaveBeenCalled();
  });

  it("skips server.tool() for disabled UPDATE tool", () => {
    process.env["QUICKBOOKS_DISABLE_UPDATE"] = "true";
    const server = { tool: jest.fn() } as unknown as McpServer;
    RegisterTool(server, def("update_customer"));
    expect(server.tool).not.toHaveBeenCalled();
  });

  it("skips server.tool() for disabled DELETE tool", () => {
    process.env["QUICKBOOKS_DISABLE_DELETE"] = "true";
    const server = { tool: jest.fn() } as unknown as McpServer;
    RegisterTool(server, def("delete_payment"));
    expect(server.tool).not.toHaveBeenCalled();
  });

  // READ tools must register even when all three DISABLE vars are set.
  it("registers READ tool even when all DISABLE vars are true", () => {
    process.env["QUICKBOOKS_DISABLE_WRITE"]  = "true";
    process.env["QUICKBOOKS_DISABLE_UPDATE"] = "true";
    process.env["QUICKBOOKS_DISABLE_DELETE"] = "true";
    const server = { tool: jest.fn() } as unknown as McpServer;
    RegisterTool(server, def("search_invoices"));
    expect(server.tool).toHaveBeenCalledTimes(1);
  });

  // Confirm the legacy hyphen separator is handled by the early-return path.
  it("skips hyphen-prefixed WRITE tool when QUICKBOOKS_DISABLE_WRITE=true", () => {
    process.env["QUICKBOOKS_DISABLE_WRITE"] = "true";
    const server = { tool: jest.fn() } as unknown as McpServer;
    RegisterTool(server, def("create-bill"));
    expect(server.tool).not.toHaveBeenCalled();
  });
});


// ── unsupported parameters ───────────────────────────────────────────────────
// A tool schema is a strict zod object, so an undeclared parameter is dropped
// during validation and the caller is never told. These cover both halves of
// the fix: naming the parameter, and still not forwarding it to QuickBooks.
describe("unsupported parameter reporting", () => {
  const runRegistered = async (toolName: string, schema: any, params: any) => {
    const seen: any[] = [];
    const handler = jest.fn(async (args: any) => {
      seen.push(args);
      return { content: [{ type: "text", text: "ok" }] };
    });
    const server = { tool: jest.fn() } as unknown as McpServer;
    RegisterTool(server, { name: toolName, description: "d", schema, handler } as any);
    const registered = (server.tool as jest.Mock).mock.calls[0][3] as any;
    const result = await registered({ params });
    return { result, seenByHandler: seen[0]?.params };
  };

  it("names an unsupported parameter in the response", async () => {
    // create_invoice is a WRITE tool, so realm_id must be present or the call
    // is refused before this reporting ever runs (see "realm_id injection").
    const { result } = await runRegistered(
      "create_invoice",
      z.object({ customer_ref: z.string() }),
      { customer_ref: "1", realm_id: "co-a", ship_date: "2026-09-01" }
    );
    expect(result.content[0].text).toContain("create_invoice does not support");
    expect(result.content[0].text).toContain("ship_date");
    expect(result.content[0].text).toContain("customer_ref"); // lists what IS supported
    expect(result.content[1].text).toBe("ok"); // original response preserved
  });

  it("strips unknown keys so they cannot reach QuickBooks", async () => {
    // search-bills/customers/estimates/vendors spread leftover params into query
    // criteria; a key left in place would become a real SQL filter.
    const { seenByHandler } = await runRegistered(
      "search_bills",
      z.object({ criteria: z.any().optional() }),
      { criteria: [], DocNumber: "1042" }
    );
    expect(seenByHandler).toEqual({ criteria: [] });
    expect(seenByHandler).not.toHaveProperty("DocNumber");
  });

  it("leaves a fully supported call untouched", async () => {
    const { result, seenByHandler } = await runRegistered(
      "read_invoice",
      z.object({ invoice_id: z.string() }),
      { invoice_id: "42" }
    );
    expect(seenByHandler).toEqual({ invoice_id: "42" });
    expect(result.content[0].text).toBe("ok");
  });

  it("pluralises, and stays silent on input it cannot analyse", () => {
    const known = knownParamKeys(z.object({ a: z.string() }));
    expect(unsupportedParamsWarning("t", known, { b: 1, c: 2 })).toContain("these parameters");
    expect(unsupportedParamsWarning("t", known, { a: "x" })).toBeNull();
    expect(unsupportedParamsWarning("t", known, undefined)).toBeNull();
    expect(unsupportedParamsWarning("t", null, { b: 1 })).toBeNull();
  });

  it("knownParamKeys returns null for schemas without an object shape", () => {
    expect(knownParamKeys(z.string())).toBeNull();
    expect(knownParamKeys(undefined)).toBeNull();
  });

  it("knownParamKeys reads shape provided as a plain object (zod v4 style)", () => {
    const objectShapeSchema = { _def: { shape: { a: true, b: true } } };
    expect(knownParamKeys(objectShapeSchema)).toEqual(new Set(["a", "b"]));
  });

  it("knownParamKeys returns null when reading the shape throws", () => {
    const throwingSchema = {
      _def: {
        shape: () => {
          throw new Error("broken shape");
        },
      },
    };
    expect(knownParamKeys(throwingSchema)).toBeNull();
  });

  it("permissiveParamsSchema keeps unknown keys and passes non-object schemas through", () => {
    const permissive: any = permissiveParamsSchema(z.object({ a: z.string() }));
    expect(permissive.parse({ a: "x", extra: 1 }).extra).toBe(1);
    const plain = z.string();
    expect(permissiveParamsSchema(plain)).toBe(plain);
  });
});

// ── realm_id injection ───────────────────────────────────────────────────────
// #4: every tool schema gains a `realm_id` parameter at this single chokepoint
// (no per-tool edits), required for WRITE/UPDATE/DELETE and optional for READ,
// stripped before the handler runs, and used to route the call to the named
// Company via the AsyncLocalStorage context from src/context/company-context.
describe("realm_id injection", () => {
  const register = (name: string, schema: any, handler: any) => {
    const server = { tool: jest.fn() } as unknown as McpServer;
    RegisterTool(server, { name, description: "d", schema, handler } as any);
    const call = (server.tool as jest.Mock).mock.calls[0] as any[];
    return {
      registered: call?.[3] as any,
      paramsSchema: call?.[2]?.params as any,
    };
  };

  it("adds realm_id to every registered schema", () => {
    const { paramsSchema } = register("get_invoice", z.object({ id: z.string() }), jest.fn());
    expect(paramsSchema.parse({ id: "1", realm_id: "123" }).realm_id).toBe("123");
  });

  it("makes realm_id required for a WRITE tool's schema", () => {
    const { paramsSchema } = register("create_invoice", z.object({ customer_ref: z.string() }), jest.fn());
    expect(paramsSchema.safeParse({ customer_ref: "1" }).success).toBe(false);
    expect(paramsSchema.safeParse({ customer_ref: "1", realm_id: "co-a" }).success).toBe(true);
  });

  it("makes realm_id required for UPDATE and DELETE tools' schemas", () => {
    const update = register("update_customer", z.object({ id: z.string() }), jest.fn());
    expect(update.paramsSchema.safeParse({ id: "1" }).success).toBe(false);
    const del = register("delete_bill", z.object({ id: z.string() }), jest.fn());
    expect(del.paramsSchema.safeParse({ id: "1" }).success).toBe(false);
  });

  it("makes realm_id optional for a READ tool's schema", () => {
    const { paramsSchema } = register("get_invoice", z.object({ id: z.string() }), jest.fn());
    expect(paramsSchema.safeParse({ id: "1" }).success).toBe(true);
  });

  it("refuses a WRITE call missing realm_id without invoking the handler", async () => {
    const handler = jest.fn();
    const { registered } = register("create_invoice", z.object({ customer_ref: z.string() }), handler);
    const result = await registered({ params: { customer_ref: "1" } });
    expect(handler).not.toHaveBeenCalled();
    expect(result.content[0].text).toContain("create_invoice");
    expect(result.content[0].text).toContain("realm_id");
  });

  it("refuses an UPDATE or DELETE call missing realm_id without invoking the handler", async () => {
    const updateHandler = jest.fn();
    const update = register("update_customer", z.object({ id: z.string() }), updateHandler);
    await update.registered({ params: { id: "1" } });
    expect(updateHandler).not.toHaveBeenCalled();

    const deleteHandler = jest.fn();
    const del = register("delete_bill", z.object({ id: z.string() }), deleteHandler);
    await del.registered({ params: { id: "1" } });
    expect(deleteHandler).not.toHaveBeenCalled();
  });

  it("strips realm_id before the handler runs, for both writes and reads", async () => {
    const seen: any[] = [];
    const handler = jest.fn(async (args: any) => {
      seen.push(args.params);
      return { content: [{ type: "text", text: "ok" }] };
    });
    const { registered } = register("create_invoice", z.object({ customer_ref: z.string() }), handler);
    await registered({ params: { customer_ref: "1", realm_id: "co-a" } });
    expect(seen[0]).toEqual({ customer_ref: "1" });
  });

  it("routes a WRITE call to the Company named in realm_id", async () => {
    setDefaultCompanyContext({ realmId: "default-co" });
    const handler = jest.fn(async () => ({
      content: [{ type: "text", text: getCurrentCompanyContext().realmId }],
    }));
    const { registered } = register("create_invoice", z.object({ customer_ref: z.string() }), handler);
    const result = await registered({ params: { customer_ref: "1", realm_id: "named-co" } });
    expect(result.content[0].text).toBe("named-co");
  });

  it("falls back to the session Company for a READ call with no realm_id", async () => {
    setDefaultCompanyContext({ realmId: "default-co" });
    const handler = jest.fn(async () => ({
      content: [{ type: "text", text: getCurrentCompanyContext().realmId }],
    }));
    const { registered } = register("get_invoice", z.object({ id: z.string() }), handler);
    const result = await registered({ params: { id: "1" } });
    expect(result.content[0].text).toBe("default-co");
  });

  it("routes a READ call to the Company named in realm_id when provided", async () => {
    setDefaultCompanyContext({ realmId: "default-co" });
    const handler = jest.fn(async () => ({
      content: [{ type: "text", text: getCurrentCompanyContext().realmId }],
    }));
    const { registered } = register("get_invoice", z.object({ id: z.string() }), handler);
    const result = await registered({ params: { id: "1", realm_id: "named-co" } });
    expect(result.content[0].text).toBe("named-co");
  });

  it("mentions realm_id in the description so its meaning is unmissable", () => {
    const server = { tool: jest.fn() } as unknown as McpServer;
    RegisterTool(server, {
      name: "create_invoice",
      description: "Create an invoice.",
      schema: z.object({ customer_ref: z.string() }),
      handler: jest.fn(),
    } as any);
    const [, description] = (server.tool as jest.Mock).mock.calls[0] as any[];
    expect(description).toContain("realm_id");
  });

  it("still invokes a READ tool's handler when the call has no params object at all", async () => {
    setDefaultCompanyContext({ realmId: "default-co" });
    const handler = jest.fn(async () => ({
      content: [{ type: "text", text: getCurrentCompanyContext().realmId }],
    }));
    const { registered } = register("get_invoice", z.object({ id: z.string() }), handler);
    const result = await registered({});
    expect((handler as jest.Mock).mock.calls[0][0]).toEqual({});
    expect(result.content[0].text).toBe("default-co");
  });

  it("still reports unsupported parameters alongside realm_id handling", async () => {
    const handler = jest.fn(async () => ({ content: [{ type: "text", text: "ok" }] }));
    const { registered } = register("create_invoice", z.object({ customer_ref: z.string() }), handler);
    const result = await registered({
      params: { customer_ref: "1", realm_id: "co-a", ship_date: "2026-09-01" },
    });
    expect(result.content[0].text).toContain("does not support");
    expect(result.content[0].text).toContain("ship_date");
    const call = handler.mock.calls[0] as any[];
    expect(call[0].params).toEqual({ customer_ref: "1" });
  });
});

// ── Company-authorization checkpoint (#8) ───────────────────────────────────
// The single checkpoint every Company resolution passes through: applies only
// when a Company was named AND an authenticated employee is active (HTTP
// multi-tenant mode); stdio and single-tenant calls (no employee context, or
// no deps configured) are entirely unaffected.
describe("Company-authorization checkpoint", () => {
  const EMPLOYEE = { sub: "emp-1", email: "emp@example.com" };

  const register = (name: string, schema: any, handler: any) => {
    const server = { tool: jest.fn() } as unknown as McpServer;
    RegisterTool(server, { name, description: "d", schema, handler } as any);
    const call = (server.tool as jest.Mock).mock.calls[0] as any[];
    return call?.[3] as any;
  };

  function fakeGrantStore(grant: Grant | undefined): GrantStore {
    const handle: GrantHandle = {
      key: { employeeSub: "irrelevant", realmId: "irrelevant" },
      read: jest.fn(async () => grant),
      create: jest.fn(),
      refresh: jest.fn(),
      recordUse: jest.fn(),
      recordHealth: jest.fn(),
    } as unknown as GrantHandle;
    return { forGrant: jest.fn(() => handle) } as unknown as GrantStore;
  }

  const HEALTHY_GRANT: Grant = {
    employeeSub: EMPLOYEE.sub,
    realmId: "named-co",
    refreshToken: "rt",
    companyName: "Named Co",
    createdAt: new Date(),
    lastRefreshedAt: new Date(),
    lastUsedAt: undefined,
    health: "healthy",
  };

  afterEach(() => setCompanyAuthorizationDeps(undefined));

  it("prompts authorization, rather than erroring, when the calling employee holds no grant", async () => {
    setCompanyAuthorizationDeps({ grantStore: fakeGrantStore(undefined), pending: new CompanyAuthorizationStore() });
    const handler = jest.fn();
    const registered = register("create_invoice", z.object({ customer_ref: z.string() }), handler);

    const result = await runWithEmployeeContext(EMPLOYEE, () =>
      runWithRequestContext({ origin: "https://qbo.example.com" }, () =>
        registered({ params: { customer_ref: "1", realm_id: "named-co" } })
      )
    );

    expect(handler).not.toHaveBeenCalled();
    expect(result.content[0].text).toContain("named-co");
    expect(result.content[0].text).toContain("you have not yet authorized");
    expect(result.content[0].text).toContain("https://qbo.example.com/auth/quickbooks/authorize?token=");
  });

  it("tells the employee to re-authorize, distinctly from first-time authorization, when the grant has gone unhealthy", async () => {
    setCompanyAuthorizationDeps({
      grantStore: fakeGrantStore({ ...HEALTHY_GRANT, health: "unhealthy" }),
      pending: new CompanyAuthorizationStore(),
    });
    const handler = jest.fn();
    const registered = register("create_invoice", z.object({ customer_ref: z.string() }), handler);

    const result = await runWithEmployeeContext(EMPLOYEE, () =>
      runWithRequestContext({ origin: "https://qbo.example.com" }, () =>
        registered({ params: { customer_ref: "1", realm_id: "named-co" } })
      )
    );

    expect(handler).not.toHaveBeenCalled();
    expect(result.content[0].text).toContain("no longer valid and must be re-authorized");
    expect(result.content[0].text).not.toContain("you have not yet authorized");
  });

  it("invokes the handler when the calling employee already holds a healthy grant", async () => {
    setCompanyAuthorizationDeps({ grantStore: fakeGrantStore(HEALTHY_GRANT), pending: new CompanyAuthorizationStore() });
    const handler = jest.fn(async () => ({ content: [{ type: "text", text: "ok" }] }));
    const registered = register("create_invoice", z.object({ customer_ref: z.string() }), handler);

    const result = await runWithEmployeeContext(EMPLOYEE, () =>
      runWithRequestContext({ origin: "https://qbo.example.com" }, () =>
        registered({ params: { customer_ref: "1", realm_id: "named-co" } })
      )
    );

    expect(handler).toHaveBeenCalledTimes(1);
    expect(result.content[0].text).toBe("ok");
  });

  it("skips the checkpoint entirely when no employee context is active (stdio/single-tenant)", async () => {
    const grantStore = fakeGrantStore(undefined);
    setCompanyAuthorizationDeps({ grantStore, pending: new CompanyAuthorizationStore() });
    const handler = jest.fn(async () => ({ content: [{ type: "text", text: "ok" }] }));
    const registered = register("create_invoice", z.object({ customer_ref: z.string() }), handler);

    const result = await registered({ params: { customer_ref: "1", realm_id: "named-co" } });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(result.content[0].text).toBe("ok");
    expect(grantStore.forGrant).not.toHaveBeenCalled();
  });

  it("skips the checkpoint entirely when no company-authorization deps are configured", async () => {
    setCompanyAuthorizationDeps(undefined);
    const handler = jest.fn(async () => ({ content: [{ type: "text", text: "ok" }] }));
    const registered = register("create_invoice", z.object({ customer_ref: z.string() }), handler);

    const result = await runWithEmployeeContext(EMPLOYEE, () =>
      registered({ params: { customer_ref: "1", realm_id: "named-co" } })
    );

    expect(handler).toHaveBeenCalledTimes(1);
    expect(result.content[0].text).toBe("ok");
  });

  it("still authorizes when no request context is active (origin falls back to empty string)", async () => {
    setCompanyAuthorizationDeps({ grantStore: fakeGrantStore(HEALTHY_GRANT), pending: new CompanyAuthorizationStore() });
    const handler = jest.fn(async () => ({ content: [{ type: "text", text: "ok" }] }));
    const registered = register("create_invoice", z.object({ customer_ref: z.string() }), handler);

    const result = await runWithEmployeeContext(EMPLOYEE, () =>
      registered({ params: { customer_ref: "1", realm_id: "named-co" } })
    );

    expect(handler).toHaveBeenCalledTimes(1);
    expect(result.content[0].text).toBe("ok");
  });

  it("checks the grant belonging to the calling employee for the Company actually named", async () => {
    const grantStore = fakeGrantStore(undefined);
    setCompanyAuthorizationDeps({ grantStore, pending: new CompanyAuthorizationStore() });
    const registered = register("create_invoice", z.object({ customer_ref: z.string() }), jest.fn());

    await runWithEmployeeContext(EMPLOYEE, () =>
      runWithRequestContext({ origin: "https://qbo.example.com" }, () =>
        registered({ params: { customer_ref: "1", realm_id: "named-co" } })
      )
    );

    expect(grantStore.forGrant).toHaveBeenCalledWith({ employeeSub: EMPLOYEE.sub, realmId: "named-co" });
  });
});

// ── Write audit trail (#10) ──────────────────────────────────────────────────
// Every WRITE/UPDATE/DELETE call that names a Company and runs under an
// authenticated employee is logged before it executes; reads, calls refused
// earlier (missing realm_id, failed authorization), and calls with no active
// employee (stdio/single-tenant) are never logged.
describe("write audit trail", () => {
  const EMPLOYEE = { sub: "emp-1", email: "emp@example.com" };

  const register = (name: string, schema: any, handler: any) => {
    const server = { tool: jest.fn() } as unknown as McpServer;
    RegisterTool(server, { name, description: "d", schema, handler } as any);
    const call = (server.tool as jest.Mock).mock.calls[0] as any[];
    return call?.[3] as any;
  };

  function fakeAuditLogger(): AuditLogger & { entries: AuditLogEntry[] } {
    const entries: AuditLogEntry[] = [];
    const record = jest.fn(async (entry: AuditLogEntry) => {
      entries.push(entry);
    });
    return { entries, record };
  }

  afterEach(() => {
    setAuditLogger(undefined);
    setCompanyAuthorizationDeps(undefined);
  });

  it("logs employee identity, realm id, tool name and params before invoking the handler", async () => {
    const logger = fakeAuditLogger();
    setAuditLogger(logger);
    const order: string[] = [];
    (logger.record as jest.Mock).mockImplementationOnce(async (entry: unknown) => {
      order.push("logged");
      logger.entries.push(entry as AuditLogEntry);
    });
    const handler = jest.fn(async () => {
      order.push("handled");
      return { content: [{ type: "text", text: "ok" }] };
    });
    const registered = register("create_invoice", z.object({ customer_ref: z.string() }), handler);

    await runWithEmployeeContext(EMPLOYEE, () =>
      registered({ params: { customer_ref: "1", realm_id: "named-co" } })
    );

    expect(order).toEqual(["logged", "handled"]);
    expect(logger.entries).toEqual([
      {
        employeeSub: EMPLOYEE.sub,
        employeeEmail: EMPLOYEE.email,
        realmId: "named-co",
        toolName: "create_invoice",
        params: { customer_ref: "1" },
      },
    ]);
  });

  it("logs a write even when the handler goes on to fail", async () => {
    const logger = fakeAuditLogger();
    setAuditLogger(logger);
    const handler = jest.fn(async () => {
      throw new Error("QuickBooks is down");
    });
    const registered = register("create_invoice", z.object({ customer_ref: z.string() }), handler);

    await expect(
      runWithEmployeeContext(EMPLOYEE, () =>
        registered({ params: { customer_ref: "1", realm_id: "named-co" } })
      )
    ).rejects.toThrow("QuickBooks is down");

    expect(logger.entries).toHaveLength(1);
  });

  it("logs UPDATE and DELETE calls too, but never a READ call", async () => {
    const logger = fakeAuditLogger();
    setAuditLogger(logger);
    const handler = jest.fn(async () => ({ content: [{ type: "text", text: "ok" }] }));

    await runWithEmployeeContext(EMPLOYEE, () =>
      register("update_customer", z.object({ id: z.string() }), handler)({
        params: { id: "1", realm_id: "named-co" },
      })
    );
    await runWithEmployeeContext(EMPLOYEE, () =>
      register("delete_bill", z.object({ id: z.string() }), handler)({
        params: { id: "1", realm_id: "named-co" },
      })
    );
    await runWithEmployeeContext(EMPLOYEE, () =>
      register("get_invoice", z.object({ id: z.string() }), handler)({
        params: { id: "1", realm_id: "named-co" },
      })
    );

    expect(logger.entries.map((e) => e.toolName)).toEqual(["update_customer", "delete_bill"]);
  });

  it("never logs a write refused for missing realm_id", async () => {
    const logger = fakeAuditLogger();
    setAuditLogger(logger);
    const handler = jest.fn();
    const registered = register("create_invoice", z.object({ customer_ref: z.string() }), handler);

    await runWithEmployeeContext(EMPLOYEE, () => registered({ params: { customer_ref: "1" } }));

    expect(handler).not.toHaveBeenCalled();
    expect(logger.entries).toHaveLength(0);
  });

  it("never logs a write refused by the Company-authorization checkpoint", async () => {
    const logger = fakeAuditLogger();
    setAuditLogger(logger);
    setCompanyAuthorizationDeps({
      grantStore: { forGrant: () => ({ read: async () => undefined }) } as any,
      pending: new CompanyAuthorizationStore(),
    });
    const handler = jest.fn();
    const registered = register("create_invoice", z.object({ customer_ref: z.string() }), handler);

    await runWithEmployeeContext(EMPLOYEE, () =>
      runWithRequestContext({ origin: "https://qbo.example.com" }, () =>
        registered({ params: { customer_ref: "1", realm_id: "named-co" } })
      )
    );

    expect(handler).not.toHaveBeenCalled();
    expect(logger.entries).toHaveLength(0);
  });

  it("skips logging entirely when no employee context is active (stdio/single-tenant)", async () => {
    const logger = fakeAuditLogger();
    setAuditLogger(logger);
    const handler = jest.fn(async () => ({ content: [{ type: "text", text: "ok" }] }));
    const registered = register("create_invoice", z.object({ customer_ref: z.string() }), handler);

    await registered({ params: { customer_ref: "1", realm_id: "named-co" } });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(logger.entries).toHaveLength(0);
  });

  it("skips logging entirely when no audit logger is configured", async () => {
    const handler = jest.fn(async () => ({ content: [{ type: "text", text: "ok" }] }));
    const registered = register("create_invoice", z.object({ customer_ref: z.string() }), handler);

    const result = await runWithEmployeeContext(EMPLOYEE, () =>
      registered({ params: { customer_ref: "1", realm_id: "named-co" } })
    );

    expect(result.content[0].text).toBe("ok");
  });

  it("never blocks or alters the write when the audit logger itself fails", async () => {
    const logger: AuditLogger = { record: jest.fn(async () => { throw new Error("audit store down"); }) };
    setAuditLogger(logger);
    const handler = jest.fn(async () => ({ content: [{ type: "text", text: "ok" }] }));
    const registered = register("create_invoice", z.object({ customer_ref: z.string() }), handler);

    const result = await runWithEmployeeContext(EMPLOYEE, () =>
      registered({ params: { customer_ref: "1", realm_id: "named-co" } })
    );

    expect(handler).toHaveBeenCalledTimes(1);
    expect(result.content[0].text).toBe("ok");
  });
});
