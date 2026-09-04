// The prompt handed to the AI drafting endpoint.

/** Build the LLM user message: real template fields (the only legal ids) + draft + instructions. */
export function aiUserPrompt(template, draft, instructions) {
  const fields = (template?.field_list || []).map((f) => ({
    field: f.field,
    kind: f.kind,
    title: f.title || f.en_title,
    required: !!f.required,
    conditional: f.visible === false,
    maxCount: f.count,
    options: (f.option_list || []).map((o) => ({ value: o.value, name: o.name || o.en_name }))
  }));
  return [
    "【后端模板字段（只能使用这里出现的 field 和 option value）】",
    JSON.stringify(fields, null, 2),
    "",
    "【当前草稿 profile】",
    JSON.stringify(draft, null, 2),
    "",
    "【指令】",
    instructions || "把草稿整理成可用的 v2 profile。",
    "",
    "只输出更新后的完整 profile JSON。"
  ].join("\n");
}
