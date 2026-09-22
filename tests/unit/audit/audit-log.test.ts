import { describe, it, expect } from "@jest/globals";
import {
  AUDIT_LOG_RETENTION_YEARS,
  FirestoreAuditLog,
  auditLogExpiryFor,
  createDefaultAuditLog,
} from "../../../src/audit/audit-log";
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

  it("stamps every entry with a Firestore TTL expiry seven years out", async () => {
    const firestore = new InMemoryFirestore();
    const log = new FirestoreAuditLog(firestore);

    await log.record({
      employeeSub: "sub-1",
      employeeEmail: "a@example.com",
      realmId: "company-a",
      toolName: "create_invoice",
      params: {},
    });

    const [doc] = await firestore.listCollection("audit-log");
    const recordedAt = new Date(doc!.recordedAt as string);
    const expiresAt = doc!.expiresAt;
    // A Date, not an ISO string: the Admin SDK maps it to the Timestamp a
    // Firestore TTL policy requires.
    expect(expiresAt).toBeInstanceOf(Date);
    expect((expiresAt as Date).toISOString()).toBe(auditLogExpiryFor(recordedAt).toISOString());
    expect((expiresAt as Date).getUTCFullYear()).toBe(recordedAt.getUTCFullYear() + AUDIT_LOG_RETENTION_YEARS);
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

describe("auditLogExpiryFor", () => {
  it("expires an entry seven years after it was recorded", () => {
    // The period the Privacy Policy publishes; same clock time, seven years on.
    expect(auditLogExpiryFor(new Date("2026-09-22T13:45:00.000Z")).toISOString()).toBe(
      "2033-09-22T13:45:00.000Z"
    );
  });

  it("keeps the same calendar date across the leap days in the window", () => {
    // Seven fixed 365-day years would land two days early here.
    expect(auditLogExpiryFor(new Date("2024-01-31T00:00:00.000Z")).toISOString()).toBe(
      "2031-01-31T00:00:00.000Z"
    );
  });

  it("does not mutate the date it is given", () => {
    // setUTCFullYear mutates in place, so the copy inside the helper matters:
    // recordedAt is also written to the stored entry.
    const recordedAt = new Date("2026-09-22T00:00:00.000Z");
    auditLogExpiryFor(recordedAt);
    expect(recordedAt.toISOString()).toBe("2026-09-22T00:00:00.000Z");
  });
});
