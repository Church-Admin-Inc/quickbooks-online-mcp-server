import { describe, it, expect, afterEach } from "@jest/globals";
import {
  DEFAULT_ENABLED_TOOL_GROUPS,
  ENABLED_TOOL_GROUPS_ENV,
  TOOL_GROUPS,
  getEnabledToolGroups,
  selectEnabledTools,
} from "../../../src/config/tool-groups";

describe("getEnabledToolGroups", () => {
  afterEach(() => {
    delete process.env[ENABLED_TOOL_GROUPS_ENV];
  });

  it("defaults to the finance-workflow subset when the env var is unset", () => {
    expect(getEnabledToolGroups()).toEqual(new Set(DEFAULT_ENABLED_TOOL_GROUPS));
  });

  it("defaults to the finance-workflow subset when the env var is blank", () => {
    process.env[ENABLED_TOOL_GROUPS_ENV] = "   ";
    expect(getEnabledToolGroups()).toEqual(new Set(DEFAULT_ENABLED_TOOL_GROUPS));
  });

  it("includes classes and departments in the default set", () => {
    const enabled = getEnabledToolGroups();
    expect(enabled.has(TOOL_GROUPS.CLASSES)).toBe(true);
    expect(enabled.has(TOOL_GROUPS.DEPARTMENTS)).toBe(true);
  });

  it("reads a comma-separated override from the env var, trimming whitespace", () => {
    process.env[ENABLED_TOOL_GROUPS_ENV] = " reports, invoices ,estimates";
    expect(getEnabledToolGroups()).toEqual(new Set(["reports", "invoices", "estimates"]));
  });

  it("lets a tool outside the default subset be enabled without a code change", () => {
    process.env[ENABLED_TOOL_GROUPS_ENV] = "estimates";
    const enabled = getEnabledToolGroups();
    expect(enabled.has(TOOL_GROUPS.ESTIMATES)).toBe(true);
    expect(enabled.has(TOOL_GROUPS.REPORTS)).toBe(false);
  });

  it("drops empty entries produced by stray commas", () => {
    process.env[ENABLED_TOOL_GROUPS_ENV] = "reports,,invoices,";
    expect(getEnabledToolGroups()).toEqual(new Set(["reports", "invoices"]));
  });
});

describe("selectEnabledTools", () => {
  const entries = [
    { tool: "A", group: TOOL_GROUPS.REPORTS },
    { tool: "B", group: TOOL_GROUPS.ESTIMATES },
    { tool: "C", group: TOOL_GROUPS.CLASSES },
  ] as const;

  it("keeps only entries whose group is enabled, preserving order", () => {
    const enabled = new Set([TOOL_GROUPS.REPORTS, TOOL_GROUPS.CLASSES]);
    expect(selectEnabledTools(entries, enabled)).toEqual(["A", "C"]);
  });

  it("returns an empty list when no groups are enabled", () => {
    expect(selectEnabledTools(entries, new Set())).toEqual([]);
  });

  it("returns every tool when every group is enabled", () => {
    const enabled = new Set([TOOL_GROUPS.REPORTS, TOOL_GROUPS.ESTIMATES, TOOL_GROUPS.CLASSES]);
    expect(selectEnabledTools(entries, enabled)).toEqual(["A", "B", "C"]);
  });
});
