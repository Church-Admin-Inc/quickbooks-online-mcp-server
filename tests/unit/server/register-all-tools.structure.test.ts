/**
 * Structural check on src/server/register-all-tools.ts: every `*Tool`
 * imported from ../tools/*.tool.js is registered exactly once, and nothing
 * is registered that wasn't imported.
 *
 * Deliberately static (reads the source as text) rather than importing the
 * module: importing it would load all ~145 tool modules for the first time
 * under Jest, surfacing them — currently untested — in the coverage report
 * and sinking the project's 100% global threshold. This still catches the
 * failure modes that matter here: a typo'd import, a tool imported but never
 * registered, or a tool registered twice.
 */
import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TOOL_GROUPS, DEFAULT_ENABLED_TOOL_GROUPS } from '../../../src/config/tool-groups';

const dir = dirname(fileURLToPath(import.meta.url));
const SOURCE_PATH = join(dir, '../../../src/server/register-all-tools.ts');
const source = readFileSync(SOURCE_PATH, 'utf8');

function namesOf(regex: RegExp): string[] {
  return [...source.matchAll(regex)].map((m) => m[1]);
}

describe('registerAllTools extraction', () => {
  const imported = namesOf(/import \{ (\w+Tool) \} from "\.\.\/tools\//g);
  // Tools are registered indirectly: every tool that should be registerable
  // is tagged with a group in TOOL_REGISTRY (issue #11), and registerAllTools
  // filters that list by the enabled tool groups before calling RegisterTool.
  const registryEntries = namesOf(/\{ tool: (\w+Tool), group: TOOL_GROUPS\.\w+ \}/g);

  it('imports at least the pre-refactor tool count', () => {
    // Guards against an accidental mass-deletion during a future edit; not
    // pinned to an exact number since new tools are added over time.
    expect(imported.length).toBeGreaterThanOrEqual(142);
  });

  it('tags every imported tool with a group exactly once, and nothing else', () => {
    expect(new Set(registryEntries)).toEqual(new Set(imported));
    expect(registryEntries.length).toBe(imported.length);
  });

  it('has no duplicate imports', () => {
    expect(new Set(imported).size).toBe(imported.length);
  });

  it('keeps the Company-connection tools reachable in the default tool surface', () => {
    // authorize_company (issue #29) is the only way to connect a Company, and
    // list_companies (issue #9) the only way to find one: an employee whose
    // enabled groups were narrowed to the default finance subset must still
    // reach both, or multi-Company mode has no entry point at all.
    const group = (tool: string) =>
      source.match(new RegExp(`\\{ tool: ${tool}, group: TOOL_GROUPS\\.(\\w+) \\}`))![1];
    for (const tool of ['AuthorizeCompanyTool', 'ListCompaniesTool']) {
      const groupKey = group(tool) as keyof typeof TOOL_GROUPS;
      expect(DEFAULT_ENABLED_TOOL_GROUPS).toContain(TOOL_GROUPS[groupKey]);
    }
  });

  it('calls RegisterTool exactly once, inside the enabled-groups filter loop', () => {
    const registerToolCalls = [...source.matchAll(/RegisterTool\(/g)];
    expect(registerToolCalls.length).toBe(1);
  });
});
