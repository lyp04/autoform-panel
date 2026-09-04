// Reading and committing catalog files through the GitHub API.
import { CatalogPublishConflictError } from "./catalog-constants.js";
import { b64decode } from "./catalog-digest.js";
import { ghHeaders, repoApi, repoRoot } from "./catalog-storage.js";

/** Returns { text, sha } for a repo file, or { text: null, sha: null } when it doesn't exist yet. */
export async function getFile(env, path, ref = "") {
  const requestedRef = String(ref || env.GITHUB_BRANCH || "").trim();
  const url = requestedRef ? `${repoApi(env, path)}?ref=${encodeURIComponent(requestedRef)}` : repoApi(env, path);
  const res = await fetch(url, { headers: ghHeaders(env) });
  if (res.status === 404) return { text: null, sha: null };
  if (!res.ok) {
    const error = new Error(`GitHub GET ${path} failed: ${res.status} ${await res.text()}`);
    error.status = res.status;
    throw error;
  }
  const json = await res.json();
  return { text: b64decode(json.content), sha: json.sha };
}

async function githubJson(env, path, options = {}) {
  const res = await fetch(`${repoRoot(env)}${path}`, {
    ...options,
    headers: { ...ghHeaders(env), "Content-Type": "application/json", ...(options.headers || {}) }
  });
  if (!res.ok) {
    const error = new Error(`GitHub ${options.method || "GET"} ${path} failed: ${res.status} ${await res.text()}`);
    error.status = res.status;
    throw error;
  }
  return res.json();
}

function encodedRefPath(branch) {
  return String(branch).split("/").map(encodeURIComponent).join("/");
}

export async function catalogHead(env) {
  let branch = String(env.GITHUB_BRANCH || "").trim();
  if (!branch) {
    const repository = await githubJson(env, "");
    branch = String(repository.default_branch || "").trim();
  }
  if (!branch) throw new Error("GitHub default branch is not configured");
  const refPath = `heads/${encodedRefPath(branch)}`;
  const ref = await githubJson(env, `/git/ref/${refPath}`);
  const parentSha = ref?.object?.sha;
  if (!parentSha) throw new Error("GitHub branch ref did not include a commit SHA");
  return { branch, refPath, parentSha };
}

/** Write every catalog file from one immutable snapshot, then move the branch only if it still
 * points to that snapshot. Blob/tree/commit creation can leave unreachable Git objects on failure,
 * but Apps never observe a partial or stale overwrite because the ref is the sole publication point. */
export async function commitCatalogFiles(env, files, message, snapshot) {
  const { refPath, parentSha } = snapshot;
  const parent = await githubJson(env, `/git/commits/${parentSha}`);
  const baseTree = parent?.tree?.sha;
  if (!baseTree) throw new Error("GitHub parent commit did not include a tree SHA");

  const tree = [];
  for (const [path, content] of Object.entries(files)) {
    const blob = await githubJson(env, "/git/blobs", {
      method: "POST",
      body: JSON.stringify({ content, encoding: "utf-8" })
    });
    if (!blob?.sha) throw new Error(`GitHub blob creation did not return a SHA for ${path}`);
    tree.push({ path, mode: "100644", type: "blob", sha: blob.sha });
  }
  const nextTree = await githubJson(env, "/git/trees", {
    method: "POST",
    body: JSON.stringify({ base_tree: baseTree, tree })
  });
  const commit = await githubJson(env, "/git/commits", {
    method: "POST",
    body: JSON.stringify({ message, tree: nextTree.sha, parents: [parentSha] })
  });
  if (!commit?.sha) throw new Error("GitHub commit creation did not return a SHA");
  let updated;
  try {
    updated = await githubJson(env, `/git/refs/${refPath}`, {
      method: "PATCH",
      body: JSON.stringify({ sha: commit.sha, force: false })
    });
  } catch (error) {
    if (error?.status === 409 || error?.status === 422) throw new CatalogPublishConflictError();
    throw error;
  }
  if (updated?.object?.sha !== commit.sha) {
    throw new Error("GitHub branch update did not confirm the new commit SHA");
  }
  return commit.sha;
}
