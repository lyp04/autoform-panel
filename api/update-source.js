// Versioned App-facing repository coordinates stored in the private Panel catalog. Channel,
// manifest asset and release tag deliberately remain the installed App/device protocol.

const SOURCE_KEYS = new Set(["version", "owner", "repo"]);

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validOwner(value) {
  return /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/u.test(value)
    && !value.includes("--") && value.length <= 39;
}

function validRepo(value) {
  return /^[A-Za-z0-9_.-]+$/u.test(value)
    && !value.includes("..") && value.length <= 100;
}

/** Null clears the optional contract; absent data retains the old flat owner/repo shape. */
export function validateUpdateSource(value) {
  if (value === null) return [];
  if (!isPlainObject(value)) return ["updateSource must be an object or null"];
  const errors = [];
  for (const key of Object.keys(value)) {
    if (!SOURCE_KEYS.has(key)) errors.push(`updateSource.${key} is unsupported`);
  }
  if (value.version !== 1) errors.push("updateSource.version must be integer 1");
  const owner = typeof value.owner === "string" ? value.owner.trim() : "";
  const repo = typeof value.repo === "string" ? value.repo.trim() : "";
  if (!validOwner(owner)) errors.push("updateSource.owner must be a GitHub login segment");
  if (!validRepo(repo)) errors.push("updateSource.repo must be a GitHub repository segment");
  if (typeof value.owner === "string" && value.owner !== owner) {
    errors.push("updateSource.owner must already be normalized");
  }
  if (typeof value.repo === "string" && value.repo !== repo) {
    errors.push("updateSource.repo must already be normalized");
  }
  return errors;
}

export function normalizeUpdateSource(value) {
  const errors = validateUpdateSource(value);
  if (errors.length) throw new TypeError(errors.join("; "));
  if (value === null) return null;
  return { version: 1, owner: value.owner, repo: value.repo };
}

/** Old and new Apps must receive exactly the same repository strings. */
export function validateUpdateSourceCompatibility(settings) {
  const source = settings?.updateSource;
  if (source === undefined || source === null) return [];
  const errors = validateUpdateSource(source);
  if (errors.length) return errors;
  if (settings.updateOwner !== source.owner) {
    errors.push("legacy updateOwner must exactly equal updateSource.owner");
  }
  if (settings.updateRepo !== source.repo) {
    errors.push("legacy updateRepo must exactly equal updateSource.repo");
  }
  return errors;
}

/**
 * A corrupt stored source must not break backend/form bootstrap or echo private malformed values.
 * New Apps interpret version 0 as invalid and disable only update checks; old Apps ignore it and
 * continue consuming the independently emitted flat coordinates.
 */
export function safeUpdateSourceForApp(settings) {
  if (settings?.updateSource === undefined || settings?.updateSource === null) return null;
  if (validateUpdateSourceCompatibility(settings).length) return { version: 0 };
  return normalizeUpdateSource(settings.updateSource);
}

/** Old Apps always consume the flat values, including while a malformed source is being repaired. */
export function legacyUpdateCoordinates(settings) {
  return {
    owner: typeof settings?.updateOwner === "string" ? settings.updateOwner : "",
    repo: typeof settings?.updateRepo === "string" ? settings.updateRepo : ""
  };
}
