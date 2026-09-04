// Public, deployment-only provenance derived from Cloudflare's version metadata binding.
// This module is intentionally pure: malformed or unavailable metadata becomes one fixed
// unavailable sentinel and no raw binding value is ever reflected to clients.

const METADATA_KEYS = Object.freeze(["id", "tag", "timestamp"]);
const VERSION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const SOURCE_COMMIT_PATTERN = /^[0-9a-f]{40}$/u;
const SOURCE_TAG_PREFIX = "autoform-source-";
const UTC_TIMESTAMP_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?Z$/u;

const UNAUTHENTICATED_RUNTIME = Object.freeze({
  version: 0,
  provenance: "unavailable"
});

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value, expected) {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length
    && actual.every((key, index) => key === wanted[index]);
}

function validUtcTimestamp(value) {
  if (typeof value !== "string") return false;
  const match = value.match(UTC_TIMESTAMP_PATTERN);
  if (!match) return false;
  const [, year, month, day, hour, minute, second] = match;
  const date = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}Z`);
  return Number.isFinite(date.getTime())
    && date.getUTCFullYear() === Number(year)
    && date.getUTCMonth() + 1 === Number(month)
    && date.getUTCDate() === Number(day)
    && date.getUTCHours() === Number(hour)
    && date.getUTCMinutes() === Number(minute)
    && date.getUTCSeconds() === Number(second);
}

/**
 * Convert the official Cloudflare WorkerVersionMetadata binding to a small App-facing contract.
 * A v1 value proves only that Cloudflare supplied a canonical version id and a deployer-provided
 * full-commit tag. It is useful inside a trusted clean-deploy workflow, but is not a cryptographic
 * digest or attestation of the uploaded Worker bundle.
 */
export function panelRuntimeFromVersionMetadata(metadata) {
  try {
    if (!isPlainObject(metadata) || !hasExactKeys(metadata, METADATA_KEYS)) {
      return { ...UNAUTHENTICATED_RUNTIME };
    }
    if (typeof metadata.id !== "string" || !VERSION_ID_PATTERN.test(metadata.id)) {
      return { ...UNAUTHENTICATED_RUNTIME };
    }
    if (typeof metadata.tag !== "string"
        || !metadata.tag.startsWith(SOURCE_TAG_PREFIX)) {
      return { ...UNAUTHENTICATED_RUNTIME };
    }
    const sourceCommit = metadata.tag.slice(SOURCE_TAG_PREFIX.length);
    if (!SOURCE_COMMIT_PATTERN.test(sourceCommit)
        || metadata.tag !== `${SOURCE_TAG_PREFIX}${sourceCommit}`) {
      return { ...UNAUTHENTICATED_RUNTIME };
    }
    if (!validUtcTimestamp(metadata.timestamp)) {
      return { ...UNAUTHENTICATED_RUNTIME };
    }
    return {
      version: 1,
      provenance: "cloudflare_version_tag",
      workerVersionId: metadata.id,
      sourceCommit,
      versionCreatedAt: metadata.timestamp
    };
  } catch {
    return { ...UNAUTHENTICATED_RUNTIME };
  }
}

export function validPanelSourceCommit(value) {
  return typeof value === "string" && SOURCE_COMMIT_PATTERN.test(value);
}
