import type {
  FirestoreDocRefLike,
  FirestoreDocSnapshotLike,
  FirestoreLike,
  FirestoreTransactionLike,
} from "./firestore-grant-store.js";

/**
 * Default backing for FirestoreGrantStore until a real Firestore client is
 * wired up for a deployed environment (see the streamable-http-index.ts
 * comment on issue #13). In-process only — grants survive across
 * conversations for the life of this server process, but not a restart. Runs
 * every transaction through a single queue: correct for a single Node
 * process (there is no cross-process race to guard against, unlike real
 * Firestore), simpler than reimplementing FakeFirestore's version-conflict
 * detection used by tests/mocks/fake-firestore.ts for that purpose.
 */
export class InMemoryFirestore implements FirestoreLike {
  private readonly docs = new Map<string, Record<string, unknown>>();
  private queue: Promise<unknown> = Promise.resolve();

  doc(path: string): FirestoreDocRefLike {
    return {
      path,
      get: async () => this.snapshotOf(path),
      set: async (data) => {
        this.docs.set(path, { ...data });
      },
    };
  }

  async listCollection(collectionPath: string): Promise<Record<string, unknown>[]> {
    const prefix = `${collectionPath}/`;
    const results: Record<string, unknown>[] = [];
    for (const [path, data] of this.docs) {
      if (path.startsWith(prefix)) results.push({ ...data });
    }
    return results;
  }

  runTransaction<T>(updateFunction: (transaction: FirestoreTransactionLike) => Promise<T>): Promise<T> {
    const run = this.queue.then(async () => {
      const tx: FirestoreTransactionLike = {
        get: async (ref) => this.snapshotOf(ref.path),
        set: (ref, data) => {
          this.docs.set(ref.path, { ...data });
        },
      };
      return updateFunction(tx);
    });
    // Keep chaining even if this attempt rejects, so a failed transaction
    // never wedges every subsequent one behind a rejected promise.
    this.queue = run.catch(() => undefined);
    return run;
  }

  private snapshotOf(path: string): FirestoreDocSnapshotLike {
    const data = this.docs.get(path);
    return {
      exists: data !== undefined,
      data: () => (data ? { ...data } : undefined),
    };
  }
}
