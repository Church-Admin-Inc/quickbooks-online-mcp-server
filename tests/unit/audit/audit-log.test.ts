import { describe, it, expect } from "@jest/globals";
import { FirestoreAuditLog, createDefaultAuditLog } from "../../../src/audit/audit-log";
import { InMemoryFirestore } from "../../../src/clients/in-memory-firestore";

describe("FirestoreAuditLog", () => {
  it("persists employee identity, realm id, tool name and params", async () => {
    const firestore = new InMemoryFirestore();
    const log = new FirestoreAuditLog(firestore);

    await log.record({
      employeeSub: "intuit-sub-1",
      employeeEmail: "person@example.com",
      realmId: "company-a",
      toolName: "create_invoice",
      params: { customer_ref: "42" },
    });

    const docs = await firestore.listCollection("audit-log");
    expect(docs).toHaveLength(1);
    expect(docs[0]).toMatchObject({
      employeeSub: "intuit-sub-1",
      employeeEmail: "person@example.com",
      realmId: "company-a",
      toolName: "create_invoice",
    });
    expect(JSON.parse(docs[0]!.params as string)).toEqual({ customer_ref: "42" });
    expect(typeof docs[0]!.recordedAt).toBe("string");
  });

  it("gives every entry its own document, even for the same tool and Company", async () => {
    const firestore = new InMemoryFirestore();
    const log = new FirestoreAuditLog(firestore);

    await log.record({
      employeeSub: "sub-1",
      employeeEmail: "a@example.com",
      realmId: "company-a",
      toolName: "create_invoice",
      params: {},
    });
    await log.record({
      employeeSub: "sub-1",
      employeeEmail: "a@example.com",
      realmId: "company-a",
      toolName: "create_invoice",
      params: {},
    });

    const docs = await firestore.listCollection("audit-log");
    expect(docs).toHaveLength(2);
  });

  it("writes to a custom collection path when given one", async () => {
    const firestore = new InMemoryFirestore();
    const log = new FirestoreAuditLog(firestore, "custom-audit");

    await log.record({
      employeeSub: "sub-1",
      employeeEmail: "a@example.com",
      realmId: "company-a",
      toolName: "delete_bill",
      params: {},
    });

    expect(await firestore.listCollection("audit-log")).toHaveLength(0);
    expect(await firestore.listCollection("custom-audit")).toHaveLength(1);
  });
});

describe("createDefaultAuditLog", () => {
  it("returns a working in-process audit logger", async () => {
    const log = createDefaultAuditLog();
    await expect(
      log.record({
        employeeSub: "sub-1",
        employeeEmail: "a@example.com",
        realmId: "company-a",
        toolName: "create_invoice",
        params: {},
      })
    ).resolves.toBeUndefined();
  });
});
