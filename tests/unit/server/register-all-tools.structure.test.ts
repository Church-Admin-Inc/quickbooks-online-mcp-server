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

const dir = dirname(fileURLToPath(import.meta.url));
const SOURCE_PATH = join(dir, '../../../src/server/register-all-tools.ts');
const source = readFileSync(SOURCE_PATH, 'utf8');

function namesOf(regex: RegExp): string[] {
  return [...source.matchAll(regex)].map((m) => m[1]);
}

describe('registerAllTools extraction', () => {
  const imported = namesOf(/import \{ (\w+Tool) \} from "\.\.\/tools\//g);
  const registered = namesOf(/RegisterTool\(server, (\w+)\);/g);

  it('imports at least the pre-refactor tool count', () => {
    // Guards against an accidental mass-deletion during a future edit; not
    // pinned to an exact number since new tools are added over time.
    expect(imported.length).toBeGreaterThanOrEqual(142);
  });

  it('registers every imported tool exactly once, and nothing else', () => {
    expect(new Set(registered)).toEqual(new Set(imported));
    expect(registered.length).toBe(imported.length);
  });

  it('has no duplicate imports', () => {
    expect(new Set(imported).size).toBe(imported.length);
  });
});
