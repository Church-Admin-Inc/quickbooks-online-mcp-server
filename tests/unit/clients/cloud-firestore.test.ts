import { describe, it, expect, afterEach } from '@jest/globals';
import { createFirestore, CloudFirestore } from '../../../src/clients/cloud-firestore';
import { InMemoryFirestore } from '../../../src/clients/in-memory-firestore';
import { Firestore } from '@google-cloud/firestore';

describe('createFirestore', () => {
  const originalGoogleCloudProject = process.env.GOOGLE_CLOUD_PROJECT;
  const originalGcloudProject = process.env.GCLOUD_PROJECT;
  const originalDatabaseId = process.env.FIRESTORE_DATABASE_ID;

  afterEach(() => {
    process.env.GOOGLE_CLOUD_PROJECT = originalGoogleCloudProject;
    process.env.GCLOUD_PROJECT = originalGcloudProject;
    process.env.FIRESTORE_DATABASE_ID = originalDatabaseId;
  });

  it('falls back to the in-process store when no GCP project is set', () => {
    delete process.env.GOOGLE_CLOUD_PROJECT;
    delete process.env.GCLOUD_PROJECT;

    expect(createFirestore()).toBeInstanceOf(InMemoryFirestore);
  });

  it('uses real Firestore, keyed by GOOGLE_CLOUD_PROJECT, when deployed', () => {
    process.env.GOOGLE_CLOUD_PROJECT = 'some-gcp-project';
    delete process.env.GCLOUD_PROJECT;
    delete process.env.FIRESTORE_DATABASE_ID;

    expect(createFirestore()).toBeInstanceOf(CloudFirestore);
  });

  it('falls back to GCLOUD_PROJECT when GOOGLE_CLOUD_PROJECT is unset', () => {
    delete process.env.GOOGLE_CLOUD_PROJECT;
    process.env.GCLOUD_PROJECT = 'some-gcp-project';

    expect(createFirestore()).toBeInstanceOf(CloudFirestore);
  });

  it('honors FIRESTORE_DATABASE_ID when set', () => {
    process.env.GOOGLE_CLOUD_PROJECT = 'some-gcp-project';
    process.env.FIRESTORE_DATABASE_ID = 'custom-db';

    expect(createFirestore()).toBeInstanceOf(CloudFirestore);
  });
});

describe('CloudFirestore', () => {
  // Thin adapter over the real Admin SDK (mirrors FirestoreLike's own
  // testing decision — see firestore-grant-store.ts's docstring: the seam is
  // driven behaviorally against InMemoryFirestore/FakeFirestore, not a real
  // or emulated Firestore instance). These smoke tests only confirm the
  // adapter shape wires onto the SDK without throwing at construction time;
  // no network call is made.
  it('exposes doc() with a stable path', () => {
    const adapter = new CloudFirestore(new Firestore({ projectId: 'some-gcp-project' }));
    expect(adapter.doc('grants/a').path).toBe('grants/a');
  });
});
