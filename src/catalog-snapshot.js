// Reading the current snapshot from either store, and writing a new one atomically.
import { CATALOG_PATHS, CatalogPublishConflictError, R2_CATALOG_POINTER_KEY } from "./catalog-constants.js";
import { sha256Hex } from "./catalog-digest.js";
import { catalogHead, commitCatalogFiles, getFile } from "./catalog-github.js";
import { buildR2CatalogObjects, decodeR2CatalogPointer, decodeR2CatalogState, validateR2CatalogFileContract } from "./catalog-r2-state.js";
import { r2Bucket } from "./catalog-storage.js";

export async function githubCatalogSnapshot(env) {
  const head = await catalogHead(env);
  const entries = await Promise.all(CATALOG_PATHS.map((path) => getFile(env, path, head.parentSha)));
  return {
    storage: "github",
    github: head,
    files: Object.fromEntries(CATALOG_PATHS.map((path, index) => [path, entries[index].text]))
  };
}

export async function r2CatalogSnapshot(env) {
  const bucket = r2Bucket(env);
  if (!bucket) return null;
  const current = await bucket.get(R2_CATALOG_POINTER_KEY);
  if (!current) return { storage: "r2-missing", bucket };
  if (!current.etag || typeof current.text !== "function") {
    throw new Error("R2 catalog current pointer did not include an ETag and readable body");
  }
  const pointer = decodeR2CatalogPointer(await current.text());
  const object = await bucket.get(pointer.snapshotKey);
  if (!object || typeof object.text !== "function") {
    throw new Error(`R2 catalog snapshot ${pointer.snapshotKey} is missing or unreadable`);
  }
  const stateText = await object.text();
  if (await sha256Hex(stateText) !== pointer.stateSha256) {
    throw new Error(`R2 catalog snapshot ${pointer.snapshotKey} failed its SHA-256 check`);
  }
  const state = decodeR2CatalogState(stateText);
  const files = state.files;
  const identity = await validateR2CatalogFileContract(files);
  if (identity.version !== pointer.catalogVersion) {
    throw new Error("R2 catalog current pointer version does not match its snapshot");
  }
  return {
    storage: "r2",
    bucket,
    etag: current.etag,
    pointer,
    parentStateSha256: state.parentStateSha256,
    files
  };
}

/** R2 is authoritative only after its current pointer exists. A bound but unseeded bucket is a
 * read-only GitHub fallback, which makes cutover safe without silently publishing a version-bumped
 * state. A malformed pointer/snapshot fails closed. After an R2-only publish, GitHub is stale and
 * cannot be used as a direct rollback until the exact R2 current snapshot has been restored there. */
export async function catalogSnapshot(env) {
  const r2 = await r2CatalogSnapshot(env);
  if (r2?.storage === "r2") return r2;
  const github = await githubCatalogSnapshot(env);
  return r2?.storage === "r2-missing"
    ? { ...github, storage: "github-fallback", bucket: r2.bucket }
    : github;
}

export async function putR2CurrentPointer(bucket, pointerText, onlyIf) {
  let written;
  try {
    written = await bucket.put(R2_CATALOG_POINTER_KEY, pointerText, {
      onlyIf,
      httpMetadata: {
        contentType: "application/json; charset=utf-8",
        cacheControl: "no-store"
      }
    });
  } catch (error) {
    if (error?.status === 409 || error?.status === 412) throw new CatalogPublishConflictError();
    throw error;
  }
  // The Workers R2 API returns null when a conditional put precondition fails.
  if (!written) throw new CatalogPublishConflictError();
  if (!written.etag) throw new Error("R2 catalog current-pointer write did not return an ETag");
  return written;
}

export async function putImmutableR2Snapshot(bucket, objects) {
  let written;
  try {
    written = await bucket.put(objects.snapshotKey, objects.stateText, {
      // Headers preserve the standard wildcard semantics: create only when the key does not exist.
      onlyIf: new Headers({ "If-None-Match": "*" }),
      httpMetadata: {
        contentType: "application/json; charset=utf-8",
        // The state also contains Worker-only panel settings; never advertise it as public cache data.
        cacheControl: "no-store"
      }
    });
  } catch (error) {
    if (error?.status !== 409 && error?.status !== 412) throw error;
  }
  if (written) return written;

  // A content-addressed snapshot may already exist after a retry or concurrent identical publish.
  // Accept it only when its exact bytes still match the digest-derived key.
  const existing = await bucket.get(objects.snapshotKey);
  if (!existing || typeof existing.text !== "function"
      || await existing.text() !== objects.stateText) {
    throw new Error(`R2 immutable catalog snapshot collision at ${objects.snapshotKey}`);
  }
  return existing;
}

export async function publishCatalogFiles(env, updates, message, snapshot) {
  if (snapshot.storage === "r2") {
    const files = { ...snapshot.files, ...updates };
    const objects = await buildR2CatalogObjects(files, {
      parentStateSha256: snapshot.pointer.stateSha256
    });
    await putImmutableR2Snapshot(snapshot.bucket, objects);
    return putR2CurrentPointer(
      snapshot.bucket,
      objects.pointerText,
      { etagMatches: snapshot.etag }
    );
  }
  if (snapshot.storage === "github-fallback") {
    throw new Error(
      `R2 catalog is not initialized; seed ${R2_CATALOG_POINTER_KEY} before publishing or remove the CATALOG_R2 binding`
    );
  }
  return commitCatalogFiles(env, updates, message, snapshot.github);
}
