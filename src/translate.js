// Auto-optimize + translate a form profile's zh UI labels on publish.
//  - 照片框(photoSlots/optionalSlots): AI 把冗长标题精简成简短显示名 —— 原始标题备份到 titleFull,
//    简短中文写回 title,简短 en/es 写进 titleI18n。这样连中文都显示「外观图片」而不是一长串。
//  - 其它标题(materials/snPlugins/choiceFields…): 纯翻译,原文不动,只补 en/es sibling map。
// zh 是源;i18n map 是可选、向后兼容。任何 AI 失败都不抛错、只保留原文,发布永不被阻塞。
// Fill-only-when-absent by default; { retranslate:true } 强制重做(照片框以 titleFull 为源保证幂等)。

import { translateTitles, optimizeTitles } from "./ai.js";

// 纯翻译目标:哪个数组、哪个源字段、哪个 i18n sibling key。
const TRANSLATE = [
  { container: (p) => p.materials, srcKey: "name", i18nKey: "nameI18n" },
  { container: (p) => p.snPlugins, srcKey: "label", i18nKey: "labelI18n" },
  { container: (p) => p.snPluginsHidden, srcKey: "label", i18nKey: "labelI18n" },
  { container: (p) => p.snPlugins, srcKey: "placeholder", i18nKey: "placeholderI18n" },
  { container: (p) => p.snPluginsHidden, srcKey: "placeholder", i18nKey: "placeholderI18n" },
  { container: (p) => p.choiceFields, srcKey: "title", i18nKey: "titleI18n" },
  { container: (p) => p.operationFields, srcKey: "title", i18nKey: "titleI18n" },
  { container: (p) => p.conditionalFields, srcKey: "title", i18nKey: "titleI18n" },
  { container: (p) => p.materialGroups, srcKey: "title", i18nKey: "titleI18n" },
  {
    // Keep the established legacy/import translation path for signed old Apps. Translation only
    // fills labelI18n; it never rewrites the imported label or submit value.
    container: (p) => (p.gradeMap ? Object.values(p.gradeMap) : undefined),
    srcKey: "label",
    i18nKey: "labelI18n"
  },
  {
    container: (p) => (p.gradeMap ? Object.values(p.gradeMap) : undefined),
    srcKey: "operatorLabel",
    i18nKey: "operatorLabelI18n"
  },
  { container: (p) => p.workflow?.alternateEntries?.entries, srcKey: "title", i18nKey: "titleI18n" },
  {
    container: (p) => (p.workflow?.alternateEntries?.entries || [])
      .flatMap((entry) => Array.isArray(entry?.toggles) ? entry.toggles : []),
    srcKey: "label",
    i18nKey: "labelI18n"
  },
  {
    container: (p) => (p.workflow?.alternateEntries?.entries || [])
      .flatMap((entry) => Array.isArray(entry?.resultPresets?.items)
        ? entry.resultPresets.items : []),
    srcKey: "label",
    i18nKey: "labelI18n"
  }
];

// 优化(精简)目标:照片框。
const OPTIMIZE = [(p) => p.photoSlots, (p) => p.optionalSlots];

function hasI18n(el, i18nKey) {
  const m = el && el[i18nKey];
  return !!m && typeof m === "object" && !Array.isArray(m) &&
    ((typeof m.en === "string" && m.en.trim() !== "") || (typeof m.es === "string" && m.es.trim() !== ""));
}

export async function translateProfileTitles(profile, { baseUrl, apiKey, model } = {}, { retranslate = false } = {}) {
  if (!profile || typeof profile !== "object") return { profile, translated: false, failed: false };
  let translated = false;
  let attempted = false;

  // 1) 照片框:优化 + 多语。源 = titleFull(原始备份) || title。
  const optEls = [];
  for (const c of OPTIMIZE) {
    const list = c(profile);
    if (!Array.isArray(list)) continue;
    for (const el of list) {
      if (!el || typeof el !== "object") continue;
      const source = (typeof el.titleFull === "string" && el.titleFull.trim()) ? el.titleFull : el.title;
      if (typeof source !== "string" || source.trim() === "") continue;
      if (!retranslate && el.titleFull && hasI18n(el, "titleI18n")) continue; // 已优化过
      optEls.push({ el, source });
    }
  }
  if (optEls.length) {
    attempted = true;
    const map = await optimizeTitles({ baseUrl, apiKey, model, titles: [...new Set(optEls.map((o) => o.source))] });
    if (map && Object.keys(map).length) {
      for (const { el, source } of optEls) {
        const r = map[source];
        if (!r || !(r.zh || r.en || r.es)) continue;
        if (!el.titleFull) el.titleFull = source;      // 备份原始标题(一次)
        if (r.zh) el.title = r.zh;                      // 显示名精简
        const i18n = {};
        if (r.en) i18n.en = r.en;
        if (r.es) i18n.es = r.es;
        if (i18n.en || i18n.es) el.titleI18n = i18n;
        translated = true;
      }
    }
  }

  // 2) 其它标题:纯翻译。
  const pending = [];
  for (const t of TRANSLATE) {
    const list = t.container(profile);
    if (!Array.isArray(list)) continue;
    for (const el of list) {
      if (!el || typeof el !== "object") continue;
      const zh = el[t.srcKey];
      if (typeof zh !== "string" || zh.trim() === "") continue;
      if (!retranslate && hasI18n(el, t.i18nKey)) continue;
      pending.push({ el, zh, i18nKey: t.i18nKey });
    }
  }
  if (pending.length) {
    attempted = true;
    const map = await translateTitles({ baseUrl, apiKey, model, titles: [...new Set(pending.map((p) => p.zh))] });
    if (map && Object.keys(map).length) {
      for (const { el, zh, i18nKey } of pending) {
        const tr = map[zh];
        if (tr && (tr.en || tr.es)) { el[i18nKey] = tr; translated = true; }
      }
    }
  }

  return { profile, translated, failed: attempted && !translated };
}
