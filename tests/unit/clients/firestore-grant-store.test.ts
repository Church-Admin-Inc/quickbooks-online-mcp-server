import { jest } from '@jest/globals';
import { FirestoreGrantStore, GrantNotFoundError, type GrantKey } from '../../../src/clients/firestore-grant-store.js';
import { FakeFirestore } from '../../mocks/fake-firestore.js';

const KEY: GrantKey = { employeeSub: 'intuit-sub-1', realmId: '12345' };

describe('FirestoreGrantStore', () => {
  it('persists a created grant, keyed by employee and Company, readable back', async () => {
    const store = new FirestoreGrantStore(new FakeFirestore());

    const created = await store.forGrant(KEY).create('seed-refresh-token');
    expect(created).toMatchObject({
      employeeSub: KEY.employeeSub,
      realmId: KEY.realmId,
      refreshToken: 'seed-refresh-token',
      health: 'healthy',
      lastUsedAt: undefined,
    });

    const read = await store.forGrant(KEY).read();
    expect(read).toMatchObject({ refreshToken: 'seed-refresh-token', health: 'healthy' });
  });

  it('reads undefined for a grant that was never created', async () => {
    const store = new FirestoreGrantStore(new FakeFirestore());
    await expect(store.forGrant(KEY).read()).resolves.toBeUndefined();
  });

  it('keeps grants in a caller-chosen collection separate from the default one', async () => {
    const firestore = new FakeFirestore();
    const defaultStore = new FirestoreGrantStore(firestore);
    const otherStore = new FirestoreGrantStore(firestore, 'other-grants');

    await defaultStore.forGrant(KEY).create('default-collection-token');

    await expect(otherStore.forGrant(KEY).read()).resolves.toBeUndefined();
  });

  it('records last-used state', async () => {
    const store = new FirestoreGrantStore(new FakeFirestore());
    await store.forGrant(KEY).create('seed-refresh-token');

    await store.forGrant(KEY).recordUse();

    const grant = await store.forGrant(KEY).read();
    expect(grant?.lastUsedAt).toBeInstanceOf(Date);
  });

  it('recording use of a grant that does not exist throws', async () => {
    const store = new FirestoreGrantStore(new FakeFirestore());
    await expect(store.forGrant(KEY).recordUse()).rejects.toThrow(GrantNotFoundError);
  });

  it('records health state', async () => {
    const store = new FirestoreGrantStore(new FakeFirestore());
    await store.forGrant(KEY).create('seed-refresh-token');

    await store.forGrant(KEY).recordHealth('unhealthy');

    const grant = await store.forGrant(KEY).read();
    expect(grant?.health).toBe('unhealthy');
  });

  it('recording health of a grant that does not exist throws', async () => {
    const store = new FirestoreGrantStore(new FakeFirestore());
    await expect(store.forGrant(KEY).recordHealth('unhealthy')).rejects.toThrow(GrantNotFoundError);
  });

  it('refreshing a grant that does not exist throws, without calling the exchange', async () => {
    const store = new FirestoreGrantStore(new FakeFirestore());
    const exchangeToken = jest.fn<(current: string) => Promise<{ refreshToken: string }>>();

    await expect(store.forGrant(KEY).refresh(exchangeToken)).rejects.toThrow(GrantNotFoundError);
    expect(exchangeToken).not.toHaveBeenCalled();
  });

  it('persists whatever refresh token comes back, even when it did not change', async () => {
    const store = new FirestoreGrantStore(new FakeFirestore());
    await store.forGrant(KEY).create('seed-refresh-token');
    const before = await store.forGrant(KEY).read();

    const refreshed = await store.forGrant(KEY).refresh(async (current) => {
      expect(current).toBe('seed-refresh-token');
      return { refreshToken: current }; // Intuit did not rotate this time.
    });

    expect(refreshed.refreshToken).toBe('seed-refresh-token');
    expect(refreshed.health).toBe('healthy');
    expect(refreshed.lastRefreshedAt.getTime()).toBeGreaterThanOrEqual(before!.lastRefreshedAt.getTime());
  });

  it('persists a rotated refresh token', async () => {
    const store = new FirestoreGrantStore(new FakeFirestore());
    await store.forGrant(KEY).create('seed-refresh-token');

    await store.forGrant(KEY).refresh(async () => ({ refreshToken: 'rotated-refresh-token' }));

    await expect(store.forGrant(KEY).read()).resolves.toMatchObject({
      refreshToken: 'rotated-refresh-token',
    });
  });

  it('concurrent refreshes of the same grant, from the same store, share exactly one exchange', async () => {
    const store = new FirestoreGrantStore(new FakeFirestore());
    await store.forGrant(KEY).create('seed-refresh-token');

    let exchangeCalls = 0;
    let resolveExchange: (value: { refreshToken: string }) => void;
    const exchangePromise = new Promise<{ refreshToken: string }>((resolve) => {
      resolveExchange = resolve;
    });
    const exchangeToken = jest.fn(async () => {
      exchangeCalls += 1;
      return exchangePromise;
    });

    const first = store.forGrant(KEY).refresh(exchangeToken);
    const second = store.forGrant(KEY).refresh(exchangeToken);

    resolveExchange!({ refreshToken: 'rotated-once' });
    const [firstGrant, secondGrant] = await Promise.all([first, second]);

    expect(exchangeCalls).toBe(1);
    expect(firstGrant).toEqual(secondGrant);
    expect(firstGrant.refreshToken).toBe('rotated-once');
  });

  it('a refresh that loses the race to a sibling store does not invalidate the winning refresh token', async () => {
    const firestore = new FakeFirestore();
    // Two FirestoreGrantStore instances sharing the same underlying
    // Firestore, modelling two sibling processes racing the same grant.
    const storeA = new FirestoreGrantStore(firestore);
    const storeB = new FirestoreGrantStore(firestore);
    await storeA.forGrant(KEY).create('seed-refresh-token');

    let releaseWinner: () => void;
    const winnerGate = new Promise<void>((resolve) => {
      releaseWinner = resolve;
    });

    // The loser reads first (racing storeA's read below) but is held open
    // until after the winner has already committed its own refresh.
    const loserExchange = jest.fn(async (current: string) => {
      await winnerGate;
      return { refreshToken: `loser-rotated-from-${current}` };
    });
    const loserRefresh = storeB.forGrant(KEY).refresh(loserExchange);

    const winnerExchange = jest.fn(async (current: string) => ({
      refreshToken: `winner-rotated-from-${current}`,
    }));
    await storeA.forGrant(KEY).refresh(winnerExchange);
    releaseWinner!();

    await expect(loserRefresh).rejects.toThrow(/concurrent modification/);

    const grant = await storeA.forGrant(KEY).read();
    expect(grant?.refreshToken).toBe('winner-rotated-from-seed-refresh-token');
  });
});
