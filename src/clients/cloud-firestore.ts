import { Firestore, type DocumentSnapshot } from "@google-cloud/firestore";
import type {
  FirestoreDocRefLike,
  FirestoreDocSnapshotLike,
  FirestoreLike,
  FirestoreTransactionLike,
} from "./firestore-grant-store.js";
import { InMemoryFirestore } from "./in-memory-firestore.js";

/**
 * Real Firestore-backed implementation of the FirestoreLike seam (issue
 * #13's deployment). Every path this codebase uses is flat
 * ("collection/docId" — see grantId() in firestore-grant-store.ts), so
 * mapping straight onto the Admin SDK's own doc()/collection() needs no
 * path-segment handling beyond what Firestore already does.
 */
export class CloudFirestore implements FirestoreLike {
  constructor(private readonly firestore: Firestore) {}

  doc(path: string): FirestoreDocRefLike {
    const ref = this.firestore.doc(path);
    return {
      path,
      get: async () => toSnapshotLike(await ref.get()),
      set: async (data) => {
        await ref.set(data);
      },
    };
  }

  async listCollection(collectionPath: string): Promise<Record<string, unknown>[]> {
    const snapshot = await this.firestore.collection(collectionPath).get();
    return snapshot.docs.map((doc) => doc.data());
  }

  runTransaction<T>(
    updateFunction: (transaction: FirestoreTransactionLike) => Promise<T>,
    options?: { maxAttempts?: number }
  ): Promise<T> {
    return this.firestore.runTransaction(
      async (tx) => {
        const txLike: FirestoreTransactionLike = {
          get: async (ref) => toSnapshotLike(await tx.get(this.firestore.doc(ref.path))),
          set: (ref, data) => {
            tx.set(this.firestore.doc(ref.path), data);
          },
        };
        return updateFunction(txLike);
      },
      options?.maxAttempts !== undefined ? { maxAttempts: options.maxAttempts } : undefined
    );
  }
}

function toSnapshotLike(snapshot: DocumentSnapshot): FirestoreDocSnapshotLike {
  return {
    exists: snapshot.exists,
    data: () => snapshot.data(),
  };
}

/**
 * Selects the deployed Firestore instance when GOOGLE_CLOUD_PROJECT is set
 * (Cloud Run and every other GCP compute product export it automatically —
 * see https://cloud.google.com/run/docs/container-contract#env-vars),
 * falling back to the in-process store everywhere else (local dev, tests,
 * stdio usage) so nothing outside a real deployment needs GCP credentials.
 */
export function createFirestore(): FirestoreLike {
  const projectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT;
  if (!projectId) return new InMemoryFirestore();

  const databaseId = process.env.FIRESTORE_DATABASE_ID || "(default)";
  return new CloudFirestore(new Firestore({ projectId, databaseId }));
}
