import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { PHOTO_INPUT_SOURCES, PHOTO_ORDERS } from "../src/profile.js";
import {
  PHOTO_ORDER_OPTIONS,
  derivePhotoOrderPreview,
  profilePhotoSlots
} from "../public/form-preview.js";

test("structured editor and preview expose exactly the App photo-order schema values", () => {
  assert.deepEqual(PHOTO_ORDER_OPTIONS.map((item) => item.value), [...PHOTO_ORDERS]);
  assert.deepEqual(PHOTO_ORDER_OPTIONS.map((item) => item.value), [
    "fronts_then_backs",
    "front_back_per_unit"
  ]);
});

test("Panel field and values stay bound to the Android photo-order contract", async () => {
  const java = await readFile(new URL(
    "../../app/src/com/autoformkit/app/PhotoOrderRules.java",
    import.meta.url
  ), "utf8");
  assert.match(java, /GROUPED\s*=\s*"fronts_then_backs"/);
  assert.match(java, /PER_RECORD\s*=\s*"front_back_per_unit"/);
  assert.match(java, /optString\("defaultPhotoOrder"/);
});

test("photo-order preview uses configured box titles without guessing deployment roles", () => {
  const profile = {
    defaultPhotoOrder: "fronts_then_backs",
    photoSlots: [
      { field: "sample_one", title: "示例照片一" },
      { field: "sample_two", title: "示例照片二" }
    ]
  };

  assert.deepEqual(derivePhotoOrderPreview(profile), {
    value: "fronts_then_backs",
    label: "按照片框分组",
    detail: "示例照片一 → 示例照片二（每个照片框先完成所有条目）"
  });

  profile.defaultPhotoOrder = "front_back_per_unit";
  assert.deepEqual(derivePhotoOrderPreview(profile), {
    value: "front_back_per_unit",
    label: "按条目逐个完成",
    detail: "每个条目：示例照片一 → 示例照片二，完成后进入下一条目"
  });
});

test("unsupported or missing photo order is never silently normalized in the preview", () => {
  assert.equal(derivePhotoOrderPreview({ photoSlots: [] }), null);
  assert.equal(derivePhotoOrderPreview({
    defaultPhotoOrder: "sample-unsupported-order",
    photoSlots: []
  }), null);
});

test("Panel structured control writes profile.defaultPhotoOrder and keeps JSON/preview in sync", async () => {
  const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
  for (const marker of [
    "默认拍照顺序",
    "请选择（发布前必选）",
    'orderSelect.dataset.profileField="defaultPhotoOrder"',
    "p.defaultPhotoOrder=orderSelect.value",
    "syncDraftTextarea(p)",
    "renderPreview()"
  ]) assert.ok(html.includes(marker), marker);

  assert.deepEqual(PHOTO_ORDER_OPTIONS.map((item) => item.label), [
    "按照片框分组",
    "按条目逐个完成"
  ]);

  assert.match(html, /PHOTO_ORDER_OPTIONS[^\n]*from "\.\/form-preview\.js"/);
  assert.match(html, /window\.FormPreview = \{[^\n]*PHOTO_ORDER_OPTIONS/);
  assert.match(html, /orderSelect\.onchange=\(\)=>\{[\s\S]{0,320}p\.defaultPhotoOrder=orderSelect\.value;[\s\S]{0,120}syncDraftTextarea\(p\);[\s\S]{0,120}renderPreview\(\);/);
  assert.doesNotMatch(html, /delete\s+c\.defaultPhotoOrder/);
});

test("Panel exposes the same bounded input-source control at every operator photo location", async () => {
  assert.deepEqual([...PHOTO_INPUT_SOURCES], ["camera", "gallery", "file"]);
  const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
  for (const marker of [
    '["camera","仅拍照"]',
    '["gallery","仅从相册选择"]',
    '["file","仅从文件选择"]',
    'artifact?.inputSource||"camera"',
    'entry.inputSource||"camera"',
    'sl.inputSource||"camera"',
    'p.workflow.photos.inputSource||"camera"'
  ]) assert.ok(html.includes(marker), marker);
  assert.ok(html.includes(
    "const slotMode=Array.isArray(p.photoSlots)&&p.photoSlots.length>0;"));
});

test("an empty modern slot array still uses the legacy photo source policy", () => {
  const slots = profilePhotoSlots({
    photoSlots: [],
    uploadFields: [{ field: "legacy-photo", title: "Legacy photo" }],
    workflow: { photos: { inputSource: "file" } }
  });
  assert.equal(slots.length, 1);
  assert.equal(slots[0].field, "legacy-photo");
  assert.equal(slots[0].inputSource, "file");
});
