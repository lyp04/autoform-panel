// Seeding the object store from GitHub for the first time.
import { CatalogPublishConflictError, R2_CATALOG_POINTER_KEY } from "./catalog-constants.js";
import { buildR2CatalogObjects, catalogVersionFromFiles } from "./catalog-r2-state.js";
import { githubCatalogSnapshot, putImmutableR2Snapshot, putR2CurrentPointer, r2CatalogSnapshot } from "./catalog-snapshot.js";
import { r2Bucket } from "./catalog-storage.js";

/** Returns byte-exact seed material without writing R2. Upload `snapshot` first and `current`
 * second; neither operation parses/re-serializes the three catalog files. */
export async function buildR2CatalogSeed(env, { expectedVersion = undefined } = {}) {
  const snapshot = await githubCatalogSnapshot(env);
  const version = catalogVersionFromFiles(snapshot.files);
  if (expectedVersion !== undefined && expectedVersion !== version) {
    throw new CatalogPublishConflictError();
  }
  const objects = await buildR2CatalogObjects(snapshot.files);
  return {
    version,
    sourceRevision: snapshot.github.parentSha,
    snapshot: {
      key: objects.snapshotKey,
      text: objects.stateText,
      sha256: objects.stateSha256
    },
    current: {
      key: R2_CATALOG_POINTER_KEY,
      text: objects.pointerText
    }
  };
}

/** One-shot in-Worker migration helper. First route all writes through an unseeded CATALOG_R2
 * deployment (whose publish path fails closed), then call this with expectedVersion. Git and R2
 * cannot share one CAS, so seeding while an older Git-backed Worker still accepts writes is unsafe.
 * The helper copies one immutable GitHub commit exactly and creates the current pointer with
 * If-None-Match:* so concurrent seeds cannot replace authority. */
export async function seedR2CatalogFromGitHub(env, { expectedVersion = undefined } = {}) {
  const bucket = r2Bucket(env, true);
  const existing = await r2CatalogSnapshot(env);
  if (existing?.storage === "r2") {
    const version = existing.pointer.catalogVersion;
    if (expectedVersion !== undefined && expectedVersion !== version) {
      throw new CatalogPublishConflictError();
    }
    return {
      created: false,
      key: R2_CATALOG_POINTER_KEY,
      version,
      etag: existing.etag,
      snapshotKey: existing.pointer.snapshotKey
    };
  }
  const seed = await buildR2CatalogSeed(env, { expectedVersion });
  await putImmutableR2Snapshot(bucket, {
    snapshotKey: seed.snapshot.key,
    stateText: seed.snapshot.text
  });
  const written = await putR2CurrentPointer(
    bucket,
    seed.current.text,
    new Headers({ "If-None-Match": "*" })
  );
  return {
    created: true,
    key: R2_CATALOG_POINTER_KEY,
    version: seed.version,
    etag: written.etag,
    snapshotKey: seed.snapshot.key,
    sourceRevision: seed.sourceRevision
  };
}
