// form-preview.js — schema-driven, interactive mockup of the entry form the app renders.
//
// One pure entry point: renderFormPreview(mountEl, profile). It reads a FormProfile (the same object
// the panel edits / publishes) and paints a phone-frame mockup that looks like what the app shows the
// operator — so an admin can SEE what a form will look like before publishing, without guessing from
// JSON. It is intentionally GENERIC (works for any form category):
//   - Input fields are modeled as plugins (snPlugins), each with configurable labels and controls.
//   - Result choices come directly from the profile's result mapping; keys and labels are deployment data.
//   - Lists, choices and uploads are rendered from schema arrays without deployment-role guesses.
//
// No dependencies, no build step. Styles are injected once under a `.fp-*` namespace so they never
// collide with the panel's own CSS.

const FP_STYLE_ID = "fp-style";

// Keep the profile field/value pair visible to both the structured editor and this preview. These
// are the same two values accepted by Panel validation and the Android PhotoOrderRules contract.
export const PHOTO_ORDER_OPTIONS = Object.freeze([
  Object.freeze({
    value: "fronts_then_backs",
    label: "按照片框分组",
    hint: "先完成一个照片框的所有条目，再进入下一个照片框"
  }),
  Object.freeze({
    value: "front_back_per_unit",
    label: "按条目逐个完成",
    hint: "每个条目依次完成所有照片框，再进入下一个条目"
  })
]);

export function derivePhotoOrderPreview(profile) {
  const option = PHOTO_ORDER_OPTIONS.find((item) => item.value === profile?.defaultPhotoOrder);
  if (!option) return null;
  const route = profilePhotoSlots(profile).map((slot) => slot.title).filter(Boolean).join(" → ");
  return {
    value: option.value,
    label: option.label,
    detail: route
      ? (option.value === "fronts_then_backs"
        ? `${route}（每个照片框先完成所有条目）`
        : `每个条目：${route}，完成后进入下一条目`)
      : option.hint
  };
}

function injectStyles() {
  if (document.getElementById(FP_STYLE_ID)) return;
  const css = `
  .fp-phone{ --fp-blue:#1989fa; --fp-ink:#1a1a1a; --fp-muted:#969799; --fp-line:#ebedf0; --fp-red:#ee0a24;
    width:340px; margin:0 auto; background:#fff; border:1px solid #e6e8eb; border-radius:22px; overflow:hidden;
    box-shadow:0 10px 34px rgba(15,23,42,.16); font:14px/1.5 -apple-system,system-ui,"PingFang SC","Microsoft YaHei",sans-serif; color:var(--fp-ink); }
  .fp-status{ height:30px; display:flex; align-items:center; justify-content:space-between; padding:0 16px; font-size:12.5px; font-weight:600; color:#0b0b0b; }
  .fp-status .fp-dots{ display:flex; gap:5px; align-items:center; opacity:.85; }
  .fp-nav{ height:44px; display:flex; align-items:center; padding:0 8px; border-bottom:1px solid var(--fp-line); position:relative; }
  .fp-nav .fp-back{ font-size:24px; line-height:1; color:#222; width:40px; text-align:center; }
  .fp-nav .fp-title{ position:absolute; left:0; right:0; text-align:center; font-size:17px; font-weight:600; pointer-events:none; }
  .fp-body{ max-height:560px; overflow-y:auto; padding:6px 16px 12px; -webkit-overflow-scrolling:touch; }
  .fp-formtitle{ font-size:16px; font-weight:700; margin:12px 2px 4px; line-height:1.4; }
  .fp-field{ padding:12px 2px; border-bottom:1px solid var(--fp-line); }
  .fp-lab{ font-size:15px; font-weight:600; margin-bottom:9px; display:flex; align-items:center; gap:2px; flex-wrap:wrap; }
  .fp-lab .fp-star{ color:var(--fp-red); font-weight:700; margin-right:1px; }
  .fp-lab .fp-multi{ color:var(--fp-muted); font-weight:500; font-size:13px; }
  .fp-lab .fp-reset{ margin-left:auto; color:var(--fp-blue); font-weight:500; font-size:14px; cursor:pointer; }
  .fp-snrow{ display:flex; align-items:center; gap:10px; }
  .fp-snrow input{ flex:1; border:0; outline:0; font-size:15px; padding:4px 0; background:transparent; color:var(--fp-ink); }
  .fp-snrow input::placeholder{ color:#c8c9cc; }
  .fp-icon{ width:26px; height:26px; flex:0 0 auto; color:var(--fp-blue); cursor:pointer; }
  .fp-search{ display:flex; align-items:center; gap:8px; background:#f7f8fa; border-radius:8px; padding:8px 12px; margin-bottom:12px; }
  .fp-search svg{ width:16px; height:16px; color:var(--fp-muted); flex:0 0 auto; }
  .fp-search input{ border:0; background:transparent; outline:0; flex:1; font-size:14px; color:var(--fp-ink); }
  .fp-search input::placeholder{ color:#c8c9cc; }
  .fp-selrow{ display:flex; align-items:center; margin:4px 0 6px; }
  .fp-selrow .fp-selnote{ margin-left:auto; display:flex; align-items:center; gap:8px; color:var(--fp-muted); font-size:14px; }
  .fp-opt{ display:flex; align-items:center; gap:12px; padding:11px 0; cursor:pointer; }
  .fp-opt .fp-txt{ flex:1; font-size:15px; }
  .fp-qty{ display:flex; align-items:center; gap:12px; flex:0 0 auto; }
  .fp-qty .fp-qn{ color:var(--fp-blue); font-weight:600; font-size:14px; }
  .fp-qty .fp-icon{ width:23px; height:23px; }
  .fp-box{ width:21px; height:21px; flex:0 0 auto; border:1.5px solid #c8c9cc; border-radius:5px; position:relative; transition:.12s; }
  .fp-opt.on .fp-box{ background:var(--fp-blue); border-color:var(--fp-blue); }
  .fp-opt.on .fp-box:after{ content:""; position:absolute; left:6.5px; top:3px; width:5px; height:9px; border:solid #fff; border-width:0 2px 2px 0; transform:rotate(45deg); }
  .fp-radio{ width:22px; height:22px; flex:0 0 auto; border:1.5px solid #c8c9cc; border-radius:50%; position:relative; transition:.12s; }
  .fp-opt.on .fp-radio{ border-color:var(--fp-blue); }
  .fp-opt.on .fp-radio:after{ content:""; position:absolute; inset:4px; border-radius:50%; background:var(--fp-blue); }
  .fp-switch{ width:44px; height:25px; border-radius:999px; background:#e4e7ed; position:relative; flex:0 0 auto; cursor:pointer; transition:.15s; }
  .fp-switch.on{ background:var(--fp-blue); }
  .fp-switch:before{ content:""; position:absolute; width:21px; height:21px; border-radius:50%; background:#fff; top:2px; left:2px; transition:.15s; box-shadow:0 1px 3px rgba(0,0,0,.2); }
  .fp-switch.on:before{ transform:translateX(19px); }
  .fp-uploads .fp-uplab{ font-size:15px; font-weight:600; margin:14px 2px 10px; display:flex; gap:2px; }
  .fp-uploads .fp-uplab .fp-star{ color:var(--fp-red); margin-right:1px; }
  .fp-upbtn{ width:86px; height:86px; border:1px solid #dcdfe6; border-radius:8px; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:7px; color:var(--fp-blue); cursor:pointer; }
  .fp-upbtn svg{ width:30px; height:30px; }
  .fp-upbtn span{ font-size:13px; }
  .fp-photo-flow{ margin:12px 2px 2px; padding:9px 10px; border-radius:8px; background:#f7f8fa; color:var(--fp-muted); font-size:12px; line-height:1.5; }
  .fp-photo-flow b{ display:block; color:var(--fp-ink); font-size:13px; margin-bottom:2px; }
  .fp-review{ margin:8px 0; padding:8px 10px; border-radius:7px; background:#fff7e6; color:#ad6800; font-size:12px; line-height:1.5; }
  .fp-empty{ color:var(--fp-muted); font-size:13px; padding:10px 2px; }
  .fp-foot{ display:flex; gap:12px; padding:12px 16px; border-top:1px solid var(--fp-line); background:#fff; }
  .fp-foot button{ border:0; border-radius:8px; padding:12px 0; font-size:16px; font-weight:600; cursor:pointer; }
  .fp-foot .fp-back2{ background:#f2f3f5; color:#323233; flex:0 0 96px; }
  .fp-foot .fp-submit{ background:var(--fp-blue); color:#fff; flex:1; }
  .fp-hint{ color:var(--fp-muted); font-size:12px; margin:2px 2px 0; }
  `;
  const el = document.createElement("style");
  el.id = FP_STYLE_ID;
  el.textContent = css;
  document.head.appendChild(el);
}

/* ---------- tiny svg icons matching the app ---------- */
const ICON_SEARCH = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><line x1="16.5" y1="16.5" x2="21" y2="21"/></svg>`;
// barcode-scan frame (corner brackets + center line), like the app's ScanIconButton
const ICON_SCAN = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8V5a2 2 0 0 1 2-2h3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M21 16v3a2 2 0 0 1-2 2h-3"/><line x1="3.5" y1="12" x2="20.5" y2="12"/></svg>`;
const ICON_UPLOAD = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 15V4"/><path d="m8 8 4-4 4 4"/><path d="M4 14v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"/></svg>`;
const ICON_MINUS = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><line x1="8" y1="12" x2="16" y2="12"/></svg>`;
const ICON_PLUS = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><line x1="8" y1="12" x2="16" y2="12"/><line x1="12" y1="8" x2="12" y2="16"/></svg>`;
const ICON_SIGNAL = `<svg viewBox="0 0 24 24" width="15" height="11" fill="currentColor"><rect x="1" y="7" width="3" height="5" rx="1"/><rect x="6" y="5" width="3" height="7" rx="1"/><rect x="11" y="3" width="3" height="9" rx="1"/><rect x="16" y="1" width="3" height="11" rx="1"/></svg>`;
const ICON_BATT = `<svg viewBox="0 0 26 13" width="22" height="11" fill="none"><rect x="1" y="1" width="20" height="11" rx="3" stroke="currentColor"/><rect x="3" y="3" width="14" height="7" rx="1.5" fill="currentColor"/><rect x="22.5" y="4" width="2" height="5" rx="1" fill="currentColor"/></svg>`;

/* ---------- schema derivations (the "universal" layer) ---------- */

// Input plugins. Explicit profile data wins; the fallback keeps older profiles editable without
// inventing deployment field names or semantic roles beyond primary/secondary.
export function deriveSnPlugins(p) {
  if (Array.isArray(p && p.snPlugins) && p.snPlugins.length) {
    return p.snPlugins.map((s) => {
      const key = s.key || s.field || "";
      const dedicatedScanner = key === "primary" || key === "secondary";
      return {
        key,
        label: s.label || s.field || s.key || "Identifier",
        field: s.field || "",
        required: !!s.required,
        search: s.search !== false,
        // The Android runtime has dedicated camera routes only for these two roles. Never preview
        // a scanner icon for an extra text plugin that the App cannot actually open.
        scan: dedicatedScanner && s.scan !== false,
        placeholder: s.placeholder || s.label || s.field || "Identifier"
      };
    });
  }
  const sn = (p && p.snFields) || {};
  const out = [{ key: "primary", label: "Primary identifier", field: sn.primary || "", required: true, search: true, scan: true, placeholder: "Identifier" }];
  if ((p && p.requiresSecondSn) || sn.secondary) {
    out.push({ key: "secondary", label: "Secondary identifier", field: sn.secondary || "", required: false, search: false, scan: true, placeholder: "Identifier" });
  }
  Object.entries(sn).forEach(([key, field]) => {
    if (["primary", "secondary"].includes(key) || typeof field !== "string" || !field.trim()) return;
    out.push({ key, label: key, field, required: false, search: false, scan: false, placeholder: key });
  });
  return out;
}

export function deriveResultOptions(p) {
  return Object.entries((p && p.gradeMap) || {}).map(([key, item]) => ({
    key,
    label: item?.operatorLabel || item?.label || item?.value?.name || key
  }));
}

// Keep the app-facing snFields/requiresSecondSn in sync with the editable snPlugins list, so a profile
// whose identifier plugins were edited in the panel still submits correctly in the app (which reads snFields).
export function syncSnFields(p) {
  if (!p || !Array.isArray(p.snPlugins)) return;
  const sn = p.snFields || (p.snFields = {});
  const byKey = (k) => p.snPlugins.find((s) => s.key === k);
  const primary = byKey("primary");
  sn.primary = (primary && primary.field) || sn.primary || "";
  const secondary = byKey("secondary");
  if (secondary && secondary.field) { sn.secondary = secondary.field; p.requiresSecondSn = true; }
  else { sn.secondary = ""; p.requiresSecondSn = false; }
}

// Normalize a slot-ish object to { field, title, minPhotos, maxPhotos, required }.
function normSlot(s, fallbackInputSource = "camera") {
  return {
    field: s.field || s.kind || "",
    title: s.title || s.field || "上传照片",
    minPhotos: s.minPhotos == null ? 1 : s.minPhotos,
    maxPhotos: s.maxPhotos == null ? 10 : s.maxPhotos,
    required: s.required !== false,
    inputSource: s.inputSource || fallbackInputSource
  };
}

// Profile photo slots. Supports v2 photoSlots and legacy uploadFields/imageFields.
export function profilePhotoSlots(p) {
  if (Array.isArray(p && p.photoSlots) && p.photoSlots.length) {
    return p.photoSlots.map((slot) => normSlot(slot));
  }
  if (Array.isArray(p && p.uploadFields) && p.uploadFields.length) {
    const source = p.workflow?.photos?.inputSource || "camera";
    return p.uploadFields.map((slot) => normSlot(slot, source));
  }
  return [];
}

// Optional extras are available only when the profile explicitly defines them.
export function optionalSlots(p) {
  if (Array.isArray(p && p.optionalSlots)) {
    return p.optionalSlots.map((s) => ({ ...normSlot(s), required: false }));
  }
  return [];
}

// A generated single choice is intentionally empty and reviewRequired. Only an explicit Panel
// interaction may both choose the opaque backend value and clear that gate; AI/template order does
// not count as operator review. Exported for a DOM-free contract test.
export function confirmChoiceValue(field, value) {
  if (!field || typeof field !== "object") return;
  field.value = value;
  field.reviewRequired = false;
}

/* ---------- render ---------- */

export function renderFormPreview(mount, profile, opts = {}) {
  injectStyles();
  const p = profile || {};
  // Theme color follows profile.uiColor (panel-editable via the 设置 color picker), falling back to the
  // default app blue when unset/invalid — so the mockup shows the actual color the operator will get.
  const accent = /^#[0-9a-fA-F]{6}$/.test(String(p.uiColor || "")) ? p.uiColor : "#1989fa";

  const snPlugins = deriveSnPlugins(p);
  const results = deriveResultOptions(p);
  const photoSlots = profilePhotoSlots(p);
  const extraSlots = optionalSlots(p);
  const matGroups = (p.materialGroups || []).filter((g) => ((g.materials || []).length || (g._allMaterials || []).length));

  // Local interaction state. `edit()` flows a preview edit back into the profile/JSON (index.html passes
  // opts.onEdit). When onEdit is absent the preview is a read-only mockup (old behavior).
  const state = { result: opts.result || null, checks: {}, onlySel: {} };
  const edit = () => { if (opts.onEdit) opts.onEdit(); };
  // Editable multi-select over a field's string `value`: shows the full configured option list.
  // (materialized once into field.allValues), each checked iff still in `value`; toggling edits `value`,
  // which is exactly what the app submits (data[field]=value). So the checkboxes control real submission.
  function editableStrList(fieldObj, defaultTitle, id) {
    if (!Array.isArray(fieldObj.allValues)) fieldObj.allValues = (fieldObj.value || []).slice();
    const sel = new Set(fieldObj.value || []);
    return multiSelect({
      id, title: fieldObj.title || defaultTitle, required: true, searchPlaceholder: "搜索",
      items: fieldObj.allValues.map((v) => ({ label: v, checked: sel.has(v), key: v })),
      editable: !!opts.onEdit,
      onToggle: (v, on) => {
        const cur = new Set(fieldObj.value || []);
        if (on) cur.add(v); else cur.delete(v);
        fieldObj.value = fieldObj.allValues.filter((x) => cur.has(x)); // keep source order
        edit();
      },
      state
    });
  }

  // Editable generic choice (choiceFields): single→radio, multi→checkbox. The submitted `value`
  // (a string for single, an array of option values for multi) is EXACTLY what the app sends
  // (data[field]=value), so these controls drive real submission. options are {value,label} — we
  // show the label but store/submit the value.
  function editableChoice(fieldObj, id) {
    const optList = Array.isArray(fieldObj.options) ? fieldObj.options : [];
    if (fieldObj.kind === "multi") {
      const sel = new Set(Array.isArray(fieldObj.value) ? fieldObj.value : []);
      return multiSelect({
        id, title: fieldObj.title || "请选择", required: !!fieldObj.required, searchPlaceholder: "搜索",
        items: optList.map((o) => ({ label: o.label || o.value, checked: sel.has(o.value), key: o.value })),
        editable: !!opts.onEdit,
        onToggle: (val, on) => {
          const cur = new Set(Array.isArray(fieldObj.value) ? fieldObj.value : []);
          if (on) cur.add(val); else cur.delete(val);
          fieldObj.value = optList.map((o) => o.value).filter((v) => cur.has(v)); // keep source order
          if (fieldObj.reviewRequired === true) fieldObj.reviewRequired = false;
          edit();
        },
        state
      });
    }
    // single → radio: exactly one selected; picking sets fieldObj.value to that option value.
    const wrap = document.createElement("div");
    wrap.className = "fp-field";
    wrap.appendChild(h(`<div class="fp-lab">${fieldObj.required ? '<span class="fp-star">*</span>' : ""}${esc(fieldObj.title || "请选择")}<span class="fp-multi">[单选]</span></div>`));
    let reviewNote = null;
    if (fieldObj.reviewRequired === true) {
      reviewNote = h('<div class="fp-review">模板没有声明安全默认值。请在 Panel 明确选择本字段要提交的选项；确认前禁止发布。</div>');
      wrap.appendChild(reviewNote);
    }
    const paint = () => {
      [...wrap.querySelectorAll(".fp-opt")].forEach((el) => el.remove());
      optList.forEach((o) => {
        const on = fieldObj.value === o.value;
        const opt = h(`<div class="fp-opt ${on ? "on" : ""}"><div class="fp-radio"></div><div class="fp-txt">${esc(o.label || o.value)}</div></div>`);
        if (opts.onEdit) opt.onclick = () => {
          confirmChoiceValue(fieldObj, o.value);
          if (reviewNote) {
            reviewNote.remove();
            reviewNote = null;
          }
          paint();
          edit();
        };
        wrap.appendChild(opt);
      });
    };
    paint();
    return wrap;
  }

  const root = document.createElement("div");
  root.className = "fp-phone";
  if (accent) root.style.setProperty("--fp-blue", accent);

  // status + nav bar
  root.appendChild(h(`
    <div class="fp-status"><span>3:40</span><span class="fp-dots">${ICON_SIGNAL}<span style="display:inline-flex">${ICON_BATT}</span></span></div>
    <div class="fp-nav"><div class="fp-back">‹</div><div class="fp-title">表单录入</div></div>
  `));

  const body = document.createElement("div");
  body.className = "fp-body";
  root.appendChild(body);

  // form title
  body.appendChild(h(`<div class="fp-formtitle">${esc(p.displayName || p.model || p.id || "（未命名表单）")}</div>`));

  // Identifier plugin fields
  snPlugins.forEach((sp) => {
    const f = document.createElement("div");
    f.className = "fp-field";
    f.appendChild(h(`<div class="fp-lab">${sp.required ? '<span class="fp-star">*</span>' : ""}${esc(sp.label)}</div>`));
    const row = document.createElement("div");
    row.className = "fp-snrow";
    row.appendChild(h(`<input placeholder="${esc(sp.placeholder || "请输入")}" />`));
    if (sp.search) row.appendChild(iconBtn(ICON_SEARCH));
    if (sp.scan) row.appendChild(iconBtn(ICON_SCAN));
    f.appendChild(row);
    body.appendChild(f);
  });

  // Configured item groups — checkbox controls inclusion and qty controls the submitted quantity.
  // The full list lives in g._allMaterials (display); g.materials is the included subset the app submits.
  const matSection = document.createElement("div");
  body.appendChild(matSection);
  matGroups.forEach((g, gi) => {
    if (!Array.isArray(g._allMaterials)) g._allMaterials = (g.materials || []).slice();
    const selCodes = new Set((g.materials || []).map((m) => m.code));
    matSection.appendChild(multiSelect({
      id: "mat" + gi,
      title: g.title || "项目列表",
      searchPlaceholder: "搜索项目",
      items: g._allMaterials.map((m) => ({ label: m.name || m.code, qty: m.defaultQty || 1, checked: selCodes.has(m.code), key: m.code })),
      withQty: true,
      preCheckAll: g.selectAll !== false,
      editable: !!opts.onEdit,
      onToggle: (code, on) => {
        if (on) { if (!(g.materials || []).some((m) => m.code === code)) { const full = g._allMaterials.find((m) => m.code === code); if (full) (g.materials = g.materials || []).push(full); } }
        else { g.materials = (g.materials || []).filter((m) => m.code !== code); }
        edit();
      },
      onQty: (code, n) => { const m = g._allMaterials.find((x) => x.code === code); if (m) m.defaultQty = n; const m2 = (g.materials || []).find((x) => x.code === code); if (m2) m2.defaultQty = n; edit(); },
      state
    }));
  });

  const uploadWrap = document.createElement("div");
  uploadWrap.className = "fp-uploads";
  function renderUploads() {
    uploadWrap.innerHTML = "";
    const flow = derivePhotoOrderPreview(p);
    if (flow) {
      uploadWrap.appendChild(h(`<div class="fp-photo-flow" data-photo-order="${esc(flow.value)}"><b>拍照流程预览 · ${esc(flow.label)}</b>${esc(flow.detail)}</div>`));
    }
    photoSlots.forEach((s) => uploadWrap.appendChild(uploadSlot(s)));
    (p.operationFields || []).filter((f) => Array.isArray(f.value)).forEach((f, gi) => uploadWrap.appendChild(editableStrList(f, "操作选项", "op" + gi)));
    extraSlots.forEach((s) => uploadWrap.appendChild(uploadSlot(s)));
  }

  // Result selector. Keys are opaque configuration values; only labels are shown to operators.
  if (results.length) {
    const resWrap = document.createElement("div");
    resWrap.className = "fp-field";
    resWrap.appendChild(h(`<div class="fp-lab"><span class="fp-star">*</span>结果<span class="fp-reset" data-reset>重置</span></div>`));
    const paint = () => {
      [...resWrap.querySelectorAll(".fp-opt")].forEach((el) => el.remove());
      results.forEach((r) => {
        const key = "result:" + r.key;
        const opt = h(`<div class="fp-opt ${state.result === key ? "on" : ""}"><div class="fp-radio"></div><div class="fp-txt">${esc(r.label)}</div></div>`);
        opt.onclick = () => { state.result = key; paint(); applyResultView(); };
        resWrap.appendChild(opt);
      });
    };
    paint();
    const rst = resWrap.querySelector("[data-reset]");
    if (rst) rst.onclick = (e) => { e.stopPropagation(); state.result = null; paint(); applyResultView(); };
    body.appendChild(resWrap);
  }

  // Result-dependent fields remain data-driven through the profile's per-result map.
  const lowerSection = document.createElement("div");
  const reasonsWrap = document.createElement("div");
  lowerSection.appendChild(reasonsWrap);
  function currentResult() { return (state.result && state.result.indexOf("result:") === 0) ? state.result.slice(7) : null; }
  function renderReasons() {
    reasonsWrap.innerHTML = "";
    const resultKey = currentResult();
    (p.conditionalFields || []).filter((f) => Array.isArray(f.value)).forEach((f, gi) => {
      const perResult = f.perResult;
      const usePer = perResult && resultKey && Array.isArray(perResult[resultKey]);
      const selected = usePer ? perResult[resultKey] : (f.value || []);
      const title = (f.title || "条件选项") + (usePer ? `（${resultKey}）` : (perResult ? "（选择结果后显示）" : ""));
      reasonsWrap.appendChild(multiSelect({
        id: "rs" + gi, title, required: true, searchPlaceholder: "搜索",
        items: (f.value || []).map((v) => ({ label: v, checked: selected.indexOf(v) >= 0, key: v })),
        editable: !!opts.onEdit,
        onToggle: (v, on) => {
          const cur = new Set(usePer ? perResult[resultKey] : (f.value || []));
          if (on) cur.add(v); else cur.delete(v);
          const next = (f.value || []).filter((x) => cur.has(x)); // keep master order
          if (usePer) perResult[resultKey] = next; else f.value = next;
          edit();
        },
        state
      }));
    });
  }
  (p.choiceFields || []).forEach((f, gi) => lowerSection.appendChild(editableChoice(f, "cf" + gi)));
  lowerSection.appendChild(uploadWrap);
  body.appendChild(lowerSection);

  function applyResultView() {
    const resultKey=currentResult();
    const resultColor=resultKey&&p.gradeMap&&p.gradeMap[resultKey]?.uiColor;
    root.style.setProperty("--fp-blue",/^#[0-9a-fA-F]{6}$/.test(String(resultColor||""))?resultColor:accent);
    renderReasons();
    renderUploads();
  }
  applyResultView();

  // footer
  root.appendChild(h(`<div class="fp-foot"><button class="fp-back2">返回</button><button class="fp-submit">提交</button></div>`));

  mount.innerHTML = "";
  mount.appendChild(root);
  return root;
}

/* ---------- small builders ---------- */

function h(html) {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstChild;
}
function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}
function iconBtn(svg) {
  const b = document.createElement("span");
  b.className = "fp-icon";
  b.innerHTML = svg;
  return b;
}
function uploadSlot(s) {
  const w = document.createElement("div");
  w.appendChild(h(`<div class="fp-uplab">${s.required ? '<span class="fp-star">*</span>' : ""}${esc(s.title)}</div>`));
  const action = s.inputSource === "gallery" ? "相册"
    : (s.inputSource === "file" ? "文件" : "拍照");
  w.appendChild(h(`<div class="fp-upbtn">${ICON_UPLOAD}<span>${action}</span></div>`));
  return w;
}

// A faithful 多选 group: title + [多选] + search box + 全选 row with 已选 switch + checkbox list.
// `withQty`: checked rows grow a quantity stepper (X N ⊖ ⊕).
// `items` may be strings or { label, qty } objects.
// `editable`: when true the control EDITS the profile — checkbox toggles / qty steppers call onToggle/
// onQty(key, …), and each item's initial `checked` comes from the data (not preCheckAll). This turns the
// preview into a real editor whose changes flow into the JSON (index.html passes callbacks that mutate
// DRAFT). Non-editable keeps the old mockup behavior. `items` may be strings or { label, qty, checked, key }.
function multiSelect({ id, title, required, searchPlaceholder, items, withQty, preCheckAll, editable, onToggle, onQty, state }) {
  const data = (items || []).map((it) => (typeof it === "string"
    ? { label: it, qty: 1, checked: false, key: it }
    : { label: it.label, qty: it.qty == null ? 1 : it.qty, checked: !!it.checked, key: it.key == null ? it.label : it.key }));
  // Index ALL state by the stable `key` (submit value / material code), NEVER the display label —
  // two options can share a label but carry different keys (重名选项), and label-keyed state would
  // silently merge them (预览显示 与 实际提交 不一致). label is used only for display + search.
  const wrap = document.createElement("div");
  wrap.className = "fp-field";
  wrap.appendChild(h(`<div class="fp-lab">${required ? '<span class="fp-star">*</span>' : ""}${esc(title)}<span class="fp-multi">[多选]</span></div>`));

  const search = h(`<div class="fp-search">${ICON_SEARCH}<input placeholder="${esc(searchPlaceholder || "搜索")}" /></div>`);
  wrap.appendChild(search);

  const selrow = h(`<div class="fp-selrow"></div>`);
  const allOpt = h(`<div class="fp-opt" style="padding:6px 0"><div class="fp-box"></div><div class="fp-txt">全选</div></div>`);
  const note = h(`<div class="fp-selnote"><span class="fp-switch"></span><span>已选</span></div>`);
  selrow.appendChild(allOpt);
  selrow.appendChild(note);
  wrap.appendChild(selrow);

  const list = document.createElement("div");
  wrap.appendChild(list);

  // In editable mode the initial checked state comes from the data; otherwise preCheckAll (mockup).
  // We rebuild checks each render (editable) so it always mirrors the profile after external JSON edits.
  const checks = {};
  if (editable) data.forEach((d) => { checks[d.key] = d.checked; });
  else {
    state.checks[id] = state.checks[id] || {};
    Object.assign(checks, state.checks[id]);
    if (preCheckAll && !Object.keys(checks).length) data.forEach((d) => { checks[d.key] = true; });
    state.checks[id] = checks;
  }
  const qtys = {};
  data.forEach((d) => { qtys[d.key] = d.qty; });
  let query = "";
  let onlySel = false;

  function draw() {
    list.innerHTML = "";
    const visible = data.filter((d) => (!query || d.label.toLowerCase().includes(query)) && (!onlySel || checks[d.key]));
    if (!visible.length) list.appendChild(h(`<div class="fp-empty">无匹配项</div>`));
    visible.forEach((d) => {
      const on = !!checks[d.key];
      const row = h(`<div class="fp-opt ${on ? "on" : ""}"><div class="fp-box"></div><div class="fp-txt">${esc(d.label)}</div></div>`);
      if (withQty && on) {
        const st = h(`<div class="fp-qty"><span class="fp-qn">X ${qtys[d.key] || 1}</span></div>`);
        st.onclick = (e) => e.stopPropagation(); // tapping the stepper must not toggle the checkbox
        const minus = iconBtn(ICON_MINUS), plus = iconBtn(ICON_PLUS);
        minus.onclick = (e) => { e.stopPropagation(); qtys[d.key] = Math.max(1, (qtys[d.key] || 1) - 1); if (editable && onQty) onQty(d.key, qtys[d.key]); draw(); };
        plus.onclick = (e) => { e.stopPropagation(); qtys[d.key] = (qtys[d.key] || 1) + 1; if (editable && onQty) onQty(d.key, qtys[d.key]); draw(); };
        st.appendChild(minus); st.appendChild(plus);
        row.appendChild(st);
      }
      row.onclick = () => { checks[d.key] = !checks[d.key]; if (editable && onToggle) onToggle(d.key, checks[d.key]); draw(); };
      list.appendChild(row);
    });
    allOpt.classList.toggle("on", data.length && data.every((d) => checks[d.key]));
  }

  allOpt.onclick = () => {
    const allOn = data.every((d) => checks[d.key]);
    data.forEach((d) => { const nv = !allOn; if (checks[d.key] !== nv) { checks[d.key] = nv; if (editable && onToggle) onToggle(d.key, nv); } });
    draw();
  };
  note.querySelector(".fp-switch").onclick = function () {
    onlySel = !onlySel; this.classList.toggle("on", onlySel); draw();
  };
  search.querySelector("input").oninput = function () { query = this.value.trim().toLowerCase(); draw(); };

  draw();
  return wrap;
}
