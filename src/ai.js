// AI layer for the admin panel. Calls a configurable OpenAI-compatible chat endpoint
// to turn natural-language instructions + the configured backend template into a
// refined form profile, then runs an anti-hallucination gate: every field id / option value the
// model emits MUST already exist in the source template (the model maps/structures — it never
// invents the dynamic keyXXXX ids the backend controls). Pure ESM (fetch only) so it runs both in
// the Worker and in a plain Node test.

export const SYSTEM_PROMPT = [
  "你是一个可配置表单 App 的配置编辑器。你会收到：后端模板字段（含精确的 field id 和 option value）、一份当前草稿 profile、以及用户的自然语言指令。",
  "你的任务：按指令产出【完整的】更新后 profile，输出严格的 JSON（不要任何解释、不要 markdown 代码块）。",
  "硬规则：",
  "1. 只能使用模板/草稿里已经出现过的 field id 和 option value，绝不可凭空编造 keyXXXX 之类的字段 id 或 sku/code。",
  "2. template、输入映射、各 field id、option value 和提交 payload 由 Panel 结构化编辑器维护；AI 不得修改。",
  "3. v2 照片结构是 photoSlots:[{field,title,minPhotos,maxPhotos}]；保留草稿已有模块、顺序和条件，除非指令明确要求改。",
  "4. required、conditional、maxCount 等含义只能来自输入模板；不得根据名称或行业经验自行推断业务分支、结果分类、字段角色或默认选项。",
  "5. 新增或重组字段时必须能追溯到输入模板；拿不准就保留当前草稿并把改动限制在用户明确点名的 UI 文案/数量/显隐范围。",
  "6. UI title 可以按用户指令简化，但 field id、option value 和提交 payload 必须保持原样。",
  "7. 草稿中与模板字段无关的 App 运行配置不得新增、删除或修改，必须原样保留。",
  "8. choiceFields 的 value 和 reviewRequired 属于提交契约；AI 不得选默认项或代替管理员清除核对标记。",
  "9. 只输出 JSON 对象。"
].join("\n");

export async function callLLM({ baseUrl, apiKey, model, system, user, temperature = 0.2 }) {
  if (!apiKey) throw new Error("AI_API_KEY is required");
  if (!baseUrl) throw new Error("AI_BASE_URL is required when AI is enabled");
  if (!model) throw new Error("AI_MODEL is required when AI is enabled");
  const base = baseUrl.replace(/\/+$/, "");
  const url = base + "/chat/completions";
  const body = {
    model,
    temperature,
    max_tokens: 8000,
    messages: [
      { role: "system", content: system || SYSTEM_PROMPT },
      { role: "user", content: user }
    ]
  };
  const res = await fetch(url, {
    method: "POST",
    signal: AbortSignal.timeout(100000), // some models can run 40-70s under load; give margin
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`LLM HTTP ${res.status}: ${text.slice(0, 500)}`);
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`LLM returned non-JSON envelope: ${text.slice(0, 300)}`);
  }
  const msg = data?.choices?.[0]?.message || {};
  // Some free/reasoning models leave content empty and put the answer in reasoning fields.
  const content = msg.content || msg.reasoning_content || msg.reasoning || "";
  if (!content) throw new Error(`LLM returned no content: ${text.slice(0, 300)}`);
  return content;
}

/** Tolerantly extract a JSON object from an LLM reply (handles ```json fences and stray prose). */
export function parseJsonLoose(content) {
  let s = String(content).trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  const first = s.indexOf("{");
  const last = s.lastIndexOf("}");
  if (first >= 0 && last > first) s = s.slice(first, last + 1);
  return JSON.parse(s);
}

function normalizedValue(value) {
  if (Array.isArray(value)) return value.map(normalizedValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, normalizedValue(value[key])]));
  }
  return value;
}

function valueRef(value) {
  return `${value === null ? "null" : typeof value}:${JSON.stringify(normalizedValue(value))}`;
}

function addAllowed(map, field, values) {
  if (!field) return;
  if (!map.fields.has(field)) map.fields.add(field);
  if (values && values.length) {
    const set = map.options.get(field) || new Set();
    for (const v of values) set.add(valueRef(v));
    map.options.set(field, set);
  }
}

/** Allowed field ids + option values from a raw backend template (field_list). */
export function allowedRefsFromTemplate(template) {
  const refs = { fields: new Set(), options: new Map() };
  for (const f of template?.field_list || []) {
    addAllowed(refs, f.field, (f.option_list || []).map((o) => o.value));
  }
  return refs;
}

/** Allowed field ids + option values from an existing profile (which already carries real ids). */
export function allowedRefsFromProfile(profile) {
  const refs = { fields: new Set(), options: new Map() };
  (profile.uploadFields || []).forEach((u) => addAllowed(refs, u.field));
  (profile.photoSlots || []).forEach((s) => addAllowed(refs, s.field));
  (profile.optionalSlots || []).forEach((s) => addAllowed(refs, s.field));
  Object.values(profile.snFields || {}).forEach((field) => addAllowed(refs, field));
  [...(profile.snPlugins || []), ...(profile.snPluginsHidden || [])]
    .forEach((plugin) => addAllowed(refs, plugin.field));
  Object.values(profile.gradeMap || {}).forEach((g) => addAllowed(refs, g.field, [g?.value]));
  (profile.conditionalFields || []).forEach((c) => {
    const resultMap = c.perResult && typeof c.perResult === "object"
      ? c.perResult : (c.perGrade && typeof c.perGrade === "object" ? c.perGrade : null);
    const values = resultMap
      ? Object.values(resultMap).flatMap((selected) => Array.isArray(selected) ? selected : [])
      : (Array.isArray(c.value) ? c.value : (c.value === undefined ? [] : [c.value]));
    addAllowed(refs, c.field, values);
  });
  (profile.operationFields || []).forEach((o) => addAllowed(refs, o.field, Array.isArray(o.value) ? o.value : [o.value]));
  (profile.materialGroups || []).forEach((g) => addAllowed(refs, g.field, (g.materials || []).map((m) => m.code)));
  (profile.choiceFields || []).forEach((c) => addAllowed(refs, c.field, (c.options || []).map((o) => o.value)));
  return refs;
}

/**
 * Union of allowed refs from a template AND a base profile. The AI may legitimately reference any
 * field/value that exists in either — crucial when editing an already-published profile (no live
 * template), where the draft itself carries the real field ids; otherwise the gate would falsely
 * flag every field as invented.
 */
export function allowedRefs(template, profile) {
  const a = allowedRefsFromTemplate(template || {});
  const b = allowedRefsFromProfile(profile || {});
  const fields = new Set([...a.fields, ...b.fields]);
  const options = new Map(a.options);
  for (const [k, set] of b.options) {
    const cur = options.get(k) || new Set();
    for (const v of set) cur.add(v);
    options.set(k, cur);
  }
  return { fields, options };
}

/** Returns a list of references the profile uses that don't exist in `allowed` (hallucinations). */
export function checkProfileRefs(profile, allowed) {
  const bad = [];
  const checkField = (field, where) => {
    if (field && !allowed.fields.has(field)) bad.push(`${where}: 未知 field "${field}"`);
  };
  const checkValue = (field, value, where) => {
    const set = allowed.options.get(field);
    if (!set || !set.has(valueRef(value))) bad.push(`${where}: 未知 option value`);
  };
  (profile.photoSlots || []).forEach((s, i) => checkField(s.field, `photoSlots[${i}]`));
  (profile.uploadFields || []).forEach((u, i) => checkField(u.field, `uploadFields[${i}]`));
  (profile.optionalSlots || []).forEach((s, i) => checkField(s.field, `optionalSlots[${i}]`));
  Object.entries(profile.snFields || {}).forEach(([role, field]) => checkField(field, `snFields.${role}`));
  [...(profile.snPlugins || []), ...(profile.snPluginsHidden || [])]
    .forEach((plugin, i) => checkField(plugin.field, `snPlugins[${i}]`));
  Object.entries(profile.gradeMap || {}).forEach(([g, v]) => {
    checkField(v.field, `gradeMap.${g}`);
    if (v && Object.prototype.hasOwnProperty.call(v, "value")) {
      checkValue(v.field, v.value, `gradeMap.${g}.value`);
    }
  });
  (profile.conditionalFields || []).forEach((c, i) => {
    checkField(c.field, `conditionalFields[${i}]`);
    const resultMapKey = c.perResult && typeof c.perResult === "object"
      ? "perResult" : "perGrade";
    Object.entries(c[resultMapKey] || {}).forEach(([resultKey, selected]) => {
      (Array.isArray(selected) ? selected : []).forEach((value, j) =>
        checkValue(c.field, value,
          `conditionalFields[${i}].${resultMapKey}.${resultKey}[${j}]`));
    });
  });
  (profile.operationFields || []).forEach((o, i) => {
    checkField(o.field, `operationFields[${i}]`);
    const values = Array.isArray(o.value) ? o.value : [o.value];
    values.forEach((value, j) => checkValue(o.field, value, `operationFields[${i}].value[${j}]`));
  });
  (profile.materialGroups || []).forEach((g, i) => {
    checkField(g.field, `materialGroups[${i}]`);
    (g.materials || []).forEach((m, j) => {
      checkValue(g.field, m.code, `materialGroups[${i}].materials[${j}].code`);
    });
  });
  (profile.choiceFields || []).forEach((c, i) => {
    checkField(c.field, `choiceFields[${i}]`);
    (c.options || []).forEach((option, j) =>
      checkValue(c.field, option.value, `choiceFields[${i}].options[${j}].value`));
  });
  return bad;
}

/**
 * One-shot: prompt -> LLM -> parsed profile -> ref gate. `allowed` is the set of legal refs
 * (from the backend template, or from the source profile when refining an existing one).
 */
export async function aiRefineProfile({ baseUrl, apiKey, model, user, allowed }) {
  const content = await callLLM({ baseUrl, apiKey, model, user });
  const profile = parseJsonLoose(content);
  const violations = allowed ? checkProfileRefs(profile, allowed) : [];
  return { profile, violations, raw: content };
}

const TRANSLATE_SYSTEM_PROMPT = [
  "You translate short UI labels for a configurable data-entry app.",
  "Translate each Chinese label to English and Spanish. Terse noun phrases, no trailing punctuation,",
  "preserve any identifiers and serial codes verbatim. Return ONLY JSON."
].join(" ");

/**
 * Batch-translate a list of unique zh UI labels to {en,es}. Sends ONE call (temperature 0) and
 * returns a map keyed by the ORIGINAL zh string: { "第一组照片": {en, es}, ... }. On ANY failure
 * (empty input, LLM error/timeout, parse failure, wrong shape) returns {} — never throws, so the
 * caller can safely fall back to zh-only. `titles` is an array of unique zh strings.
 */
export async function translateTitles({ baseUrl, apiKey, model, titles }) {
  const uniq = [...new Set((titles || []).map((t) => String(t == null ? "" : t)).filter((t) => t.trim() !== ""))];
  if (!uniq.length) return {};
  // Index-keyed so codes/duplicates survive the round-trip and we can re-key by original string.
  const indexed = {};
  uniq.forEach((t, i) => (indexed[i] = t));
  const user = [
    "Translate each Chinese label below. Return ONLY a JSON object keyed by the SAME index,",
    'each value {"en":"...","es":"..."}. Example: {"0":{"en":"...","es":"..."}}.',
    "",
    JSON.stringify(indexed, null, 2)
  ].join("\n");
  try {
    const content = await callLLM({
      baseUrl,
      apiKey,
      model,
      system: TRANSLATE_SYSTEM_PROMPT,
      user,
      temperature: 0
    });
    const parsed = parseJsonLoose(content);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out = {};
    uniq.forEach((zh, i) => {
      const entry = parsed[i] ?? parsed[String(i)];
      if (!entry || typeof entry !== "object") return;
      const en = typeof entry.en === "string" ? entry.en.trim() : "";
      const es = typeof entry.es === "string" ? entry.es.trim() : "";
      const map = {};
      if (en) map.en = en;
      if (es) map.es = es;
      if (map.en || map.es) out[zh] = map;
    });
    return out;
  } catch {
    return {};
  }
}

// 把冗长的「照片上传框」标题优化成简短干净的显示名(去掉「请上传」「（最多可上传N张）」这类套话、只保留核心
// 主体),并给出同样简短的 en/es。返回 { 原串: {zh,en,es} };任何失败返回 {}(调用方保留原串,不阻塞发布)。
export async function optimizeTitles({ baseUrl, apiKey, model, titles }) {
  const uniq = [...new Set((titles || []).map((t) => String(t == null ? "" : t)).filter((t) => t.trim() !== ""))];
  if (!uniq.length) return {};
  const indexed = {};
  uniq.forEach((t, i) => (indexed[i] = t));
  const system = [
    "你在为可配置表单 App 精简「照片上传框」的显示名。把每个冗长的中文标签优化成简短干净的显示名:",
    "去掉『请上传』『（最多可上传N张）』这类套话,只保留核心主体。例:",
    "『请上传第一组记录图片（最多可上传十张）』→『第一组图片』;",
    "『请上传附件放置图片（最多可上传十张）』→『附件图片』。",
    "再给出同样简短的英文、西班牙文(名词短语,无结尾标点、无括注)。只返回 JSON。"
  ].join("");
  const user = [
    'Optimize + translate each label. Return ONLY a JSON object keyed by the SAME index,',
    'each value {"zh":"...","en":"...","es":"..."} where zh is the shortened Chinese display name.',
    "",
    JSON.stringify(indexed, null, 2)
  ].join("\n");
  try {
    const content = await callLLM({ baseUrl, apiKey, model, system, user, temperature: 0 });
    const parsed = parseJsonLoose(content);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out = {};
    uniq.forEach((orig, i) => {
      const entry = parsed[i] ?? parsed[String(i)];
      if (!entry || typeof entry !== "object") return;
      const zh = typeof entry.zh === "string" ? entry.zh.trim() : "";
      const en = typeof entry.en === "string" ? entry.en.trim() : "";
      const es = typeof entry.es === "string" ? entry.es.trim() : "";
      if (zh || en || es) out[orig] = { zh: zh || orig, en, es };
    });
    return out;
  } catch {
    return {};
  }
}
