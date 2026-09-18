import { describe, it, expect } from '@jest/globals';
import { InMemoryFirestore } from '../../../src/clients/in-memory-firestore';

describe('InMemoryFirestore', () => {
  it('reads back what was set, and reports non-existence for an unset doc', async () => {
    const store = new InMemoryFirestore();
    const ref = store.doc('grants/a');

    expect((await ref.get()).exists).toBe(false);
    expect((await ref.get()).data()).toBeUndefined();

    await ref.set({ refreshToken: 'rt' });
    const snap = await ref.get();
    expect(snap.exists).toBe(true);
    expect(snap.data()).toEqual({ refreshToken: 'rt' });
  });

  it('runs a transaction that reads and writes through the same document', async () => {
    const store = new InMemoryFirestore();
    await store.doc('grants/a').set({ count: 1 });

    const result = await store.runTransaction(async (tx) => {
      const ref = store.doc('grants/a');
      const snap = await tx.get(ref);
      const count = (snap.data()?.count as number) + 1;
      tx.set(ref, { count });
      return count;
    });

    expect(result).toBe(2);
    expect((await store.doc('grants/a').get()).data()).toEqual({ count: 2 });
  });

  it('serializes concurrent transactions rather than interleaving their writes', async () => {
    const store = new InMemoryFirestore();
    await store.doc('grants/a').set({ count: 0 });

    const increment = () =>
      store.runTransaction(async (tx) => {
        const ref = store.doc('grants/a');
        const snap = await tx.get(ref);
        const count = (snap.data()?.count as number) + 1;
        tx.set(ref, { count });
      });

    await Promise.all([increment(), increment(), increment()]);

    expect((await store.doc('grants/a').get()).data()).toEqual({ count: 3 });
  });

  it('does not let a failed transaction wedge subsequent ones', async () => {
    const store = new InMemoryFirestore();
    await store.doc('grants/a').set({ count: 0 });

    await expect(
      store.runTransaction(async () => {
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');

    const result = await store.runTransaction(async (tx) => {
      const ref = store.doc('grants/a');
      const snap = await tx.get(ref);
      return (snap.data()?.count as number) + 1;
    });
    expect(result).toBe(1);
  });

  it('lists every document stored under a collection, ignoring documents elsewhere', async () => {
    const store = new InMemoryFirestore();
    await store.doc('grants/emp-1:company-a').set({ employeeSub: 'emp-1', realmId: 'company-a' });
    await store.doc('grants/emp-1:company-b').set({ employeeSub: 'emp-1', realmId: 'company-b' });
    await store.doc('other-grants/emp-1:company-c').set({ employeeSub: 'emp-1', realmId: 'company-c' });

    const docs = await store.listCollection('grants');

    expect(docs).toHaveLength(2);
    expect(docs).toEqual(
      expect.arrayContaining([
        { employeeSub: 'emp-1', realmId: 'company-a' },
        { employeeSub: 'emp-1', realmId: 'company-b' },
      ])
    );
  });

  it('returns an empty list for a collection with no documents', async () => {
    const store = new InMemoryFirestore();
    expect(await store.listCollection('grants')).toEqual([]);
  });
});
