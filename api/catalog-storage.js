// Choosing a store: the object bucket, or the GitHub repository behind it.

export function r2Bucket(env, required = false) {
  const bucket = env?.CATALOG_R2;
  if (!bucket) {
    if (required) throw new Error("CATALOG_R2 binding is not configured");
    return null;
  }
  if (typeof bucket.get !== "function" || typeof bucket.put !== "function") {
    throw new Error("CATALOG_R2 is not a valid R2 binding");
  }
  return bucket;
}

/** Shared storage-presence predicate for callers that should read active settings with either
 * backend. GitHub credentials remain independently required for fallback and rollback. */
export function hasCatalogStorage(env) {
  return Boolean(env?.CATALOG_R2 || (env?.GITHUB_REPO && env?.GITHUB_TOKEN));
}

export function repoApi(env, path) {
  const repo = env.GITHUB_REPO; // "owner/name"
  if (!repo) throw new Error("GITHUB_REPO env is not set");
  return `https://api.github.com/repos/${repo}/contents/${path}`;
}

export function repoRoot(env) {
  const repo = env.GITHUB_REPO;
  if (!repo) throw new Error("GITHUB_REPO env is not set");
  return `https://api.github.com/repos/${repo}`;
}

export function ghHeaders(env) {
  if (!env.GITHUB_TOKEN) throw new Error("GITHUB_TOKEN env is not set");
  return {
    Authorization: `Bearer ${env.GITHUB_TOKEN}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "autoform-panel"
  };
}
