import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  legacyUpdateCoordinates,
  normalizeUpdateSource,
  safeUpdateSourceForApp,
  validateUpdateSource,
  validateUpdateSourceCompatibility
} from "../src/update-source.js";

const valid = () => ({ version: 1, owner: "sample-owner", repo: "sample-releases" });

test("updateSource v1 is exactly version plus public repository coordinates", () => {
  assert.deepEqual(validateUpdateSource(valid()), []);
  assert.deepEqual(normalizeUpdateSource(valid()), valid());
  for (const extra of [
    { defaultChannel: "beta" },
    { channels: { stable: {} } },
    { manifestAsset: "update.json" },
    { releaseTag: "stable" }
  ]) {
    assert.notEqual(validateUpdateSource({ ...valid(), ...extra }).length, 0);
  }
});

test("missing contract preserves legacy flat coordinates", () => {
  const settings = { updateOwner: "legacy-owner", updateRepo: "legacy-repo" };
  assert.deepEqual(validateUpdateSourceCompatibility(settings), []);
  assert.equal(safeUpdateSourceForApp(settings), null);
  assert.deepEqual(legacyUpdateCoordinates(settings), {
    owner: "legacy-owner", repo: "legacy-repo"
  });
});

test("structured and flat coordinates must be exactly identical", () => {
  const source = valid();
  const settings = {
    updateSource: source,
    updateOwner: source.owner,
    updateRepo: source.repo
  };
  assert.deepEqual(validateUpdateSourceCompatibility(settings), []);
  assert.deepEqual(safeUpdateSourceForApp(settings), source);
  assert.deepEqual(validateUpdateSourceCompatibility({
    ...settings,
    updateOwner: ` ${source.owner}`
  }), ["legacy updateOwner must exactly equal updateSource.owner"]);
  assert.deepEqual(validateUpdateSourceCompatibility({
    updateSource: source
  }), [
    "legacy updateOwner must exactly equal updateSource.owner",
    "legacy updateRepo must exactly equal updateSource.repo"
  ]);
});

test("malformed stored source becomes a value-free invalid sentinel", () => {
  const malformed = {
    updateOwner: "legacy-owner",
    updateRepo: "legacy-repo",
    updateSource: {
      version: 1,
      owner: "private-do-not-emit",
      repo: "private-do-not-emit",
      secret: "private-do-not-emit"
    }
  };
  const safe = safeUpdateSourceForApp(malformed);
  assert.deepEqual(safe, { version: 0 });
  assert.equal(JSON.stringify(safe).includes("private-do-not-emit"), false);
  assert.deepEqual(legacyUpdateCoordinates(malformed), {
    owner: "legacy-owner", repo: "legacy-repo"
  });
});

test("unsafe, unnormalized and unversioned coordinates are rejected on save", () => {
  for (const value of [
    { ...valid(), version: 2 },
    { ...valid(), owner: " owner " },
    { ...valid(), owner: "owner/path" },
    { ...valid(), repo: "repo..other" }
  ]) {
    assert.notEqual(validateUpdateSource(value).length, 0);
  }
  assert.deepEqual(validateUpdateSource(null), []);
  assert.equal(normalizeUpdateSource(null), null);
});

test("Panel UI edits only owner/repo and sends their exact v1 duplicate", async () => {
  const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
  assert.match(html, /id=["']updateOwnerInput["']/u);
  assert.match(html, /id=["']updateRepoInput["']/u);
  for (const removed of [
    "updateDefaultChannelInput", "updateStableManifestInput", "updateStableTagInput",
    "updateBetaManifestInput", "updateBetaTagInput"
  ]) {
    assert.doesNotMatch(html, new RegExp(`id=["']${removed}["']`, "u"));
  }
  assert.match(html, /return \{version:1, owner, repo\}/u);
  assert.match(html, /updateSource, minAppVersionCode/u);
});
