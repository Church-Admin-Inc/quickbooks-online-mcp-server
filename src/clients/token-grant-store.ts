import dotenv from "dotenv";
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Where the server reads .env at startup and persists rotated refresh tokens.
// Defaults to the installed module's ../../.env (dist/clients/ -> package root)
// so a host-spawned server with an unrelated cwd still finds it. Override with
// QUICKBOOKS_TOKEN_STORE_PATH (an absolute path) to point at a WRITABLE location.
// This is required whenever the module itself lives on a read-only filesystem —
// containers with a read-only root, Nix/immutable installs (see #63, where the
// default path can't be written) — and lets a per-tenant host keep each
// connection's rotated token in its own isolated path.
//
// NOTE: this value is resolved BEFORE dotenv loads the file below, so the
// override only takes effect when set in the host process env (e.g. the MCP
// server config's env block) — setting it inside .env has no effect. It must
// be absolute: a relative path would resolve against the host app's working
// directory, which is unpredictable (the exact failure the module-relative
// default exists to avoid).
const tokenStorePathOverride = process.env.QUICKBOOKS_TOKEN_STORE_PATH?.trim();
if (tokenStorePathOverride && !path.isAbsolute(tokenStorePathOverride)) {
  throw Error(
    `QUICKBOOKS_TOKEN_STORE_PATH must be an absolute path, got "${tokenStorePathOverride}"`
  );
}
export const TOKEN_STORE_PATH =
  tokenStorePathOverride || path.join(__dirname, '..', '..', '.env');

// ── TokenGrantStore ──────────────────────────────────────────────────────────
// The seam a Firestore-backed store slots into later (see issue #1's Company
// model and the per-employee grants in ADR 0002) without QuickbooksClient's
// refresh/rotation logic being touched twice. FileTokenGrantStore below is
// today's only implementation: today's file-based read/rotate/write behaviour,
// unchanged, just moved behind this interface.
export interface TokenGrantStore {
  // The refresh token currently persisted in the store, or undefined if none
  // is stored or it can't be read. Used to pick up a rotation performed by a
  // sibling process (see FileTokenGrantStore.readRefreshToken).
  readRefreshToken(): string | undefined;

  // Persist a refresh token and/or realm id. Fields left undefined are not
  // touched in the underlying store.
  save(grant: { refreshToken?: string; realmId?: string }): void;
}

export class FileTokenGrantStore implements TokenGrantStore {
  constructor(private readonly storePath: string = TOKEN_STORE_PATH) {}

  // Read the refresh token currently persisted in the token store (.env by
  // default, or QUICKBOOKS_TOKEN_STORE_PATH). Used to pick up a rotation
  // performed by a SIBLING process before we attempt our own refresh: a host
  // may spawn this server more than once against the same store (e.g.
  // Claude Desktop and Claude Code simultaneously), and Intuit invalidates the
  // previous refresh token on every rotation — so a token loaded into memory at
  // startup can be silently superseded on disk by another process.
  readRefreshToken(): string | undefined {
    try {
      // Parse with dotenv itself so the value is normalized identically to how
      // the in-memory token was loaded at startup — surrounding quotes stripped,
      // inline comments removed, optional `export ` prefix handled. A naive
      // slice would keep quotes/comments and could poison a valid token with a
      // value that only looks different.
      const parsed = dotenv.parse(fs.readFileSync(this.storePath));
      const value = parsed.QUICKBOOKS_REFRESH_TOKEN?.trim();
      return value || undefined;
    } catch {
      return undefined;
    }
  }

  save(grant: { refreshToken?: string; realmId?: string }): void {
    const tokenPath = this.storePath;
    const envContent = fs.existsSync(tokenPath) ? fs.readFileSync(tokenPath, 'utf-8') : '';
    const envLines = envContent.split('\n');

    const updateEnvVar = (name: string, value: string) => {
      const index = envLines.findIndex(line => line.startsWith(`${name}=`));
      if (index !== -1) {
        envLines[index] = `${name}=${value}`;
      } else {
        envLines.push(`${name}=${value}`);
      }
    };

    if (grant.refreshToken) updateEnvVar('QUICKBOOKS_REFRESH_TOKEN', grant.refreshToken);
    if (grant.realmId) updateEnvVar('QUICKBOOKS_REALM_ID', grant.realmId);

    const newContent = envLines.join('\n');
    const isSymlink = this.isSymbolicLink(tokenPath);

    if (isSymlink) {
      // Write directly through the symlink to the real target. Using
      // rename on a symlink replaces the link itself rather than writing
      // through it, which breaks persistent-volume mounts in containers.
      // If the symlink target doesn't exist yet (fresh PVC mount), resolve
      // the link target without requiring it to exist, then write directly.
      let realPath: string;
      try {
        realPath = fs.realpathSync(tokenPath);
      } catch (e: any) {
        if (e?.code === 'ENOENT') {
          // Dangling symlink: target doesn't exist yet. readlinkSync returns the
          // link target as stored, which may be RELATIVE — and a relative path is
          // resolved against the process cwd, not the link's own directory. Resolve
          // it against the symlink's directory so we write to the intended location.
          const linkTarget = fs.readlinkSync(tokenPath);
          realPath = path.isAbsolute(linkTarget)
            ? linkTarget
            : path.resolve(path.dirname(tokenPath), linkTarget);
        } else {
          throw e;
        }
      }
      // Deliberate: no temp-file+rename here. Renaming over a symlink replaces the
      // link itself (the bug this branch fixes), so we write through to the target
      // directly. This trades atomicity for correct persistent-volume behavior — a
      // crash mid-write could leave the target .env partially written.
      fs.writeFileSync(realPath, newContent, { mode: 0o600 });
    } else {
      // Atomic write: write to a sibling temp file, then rename. On POSIX
      // rename is atomic within the same filesystem, so a crash mid-write
      // cannot leave .env half-written or empty.
      const tmpPath = `${tokenPath}.tmp.${process.pid}`;
      try {
        fs.writeFileSync(tmpPath, newContent, { mode: 0o600 });
        fs.renameSync(tmpPath, tokenPath);
      } catch (err) {
        try { fs.unlinkSync(tmpPath); } catch { /* best effort */ }
        throw err;
      }
    }
  }

  private isSymbolicLink(filePath: string): boolean {
    try {
      return fs.lstatSync(filePath).isSymbolicLink();
    } catch {
      return false;
    }
  }
}
