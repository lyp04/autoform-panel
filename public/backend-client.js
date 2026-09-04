// Generic browser-side interpreter for the versioned backend adapter returned by /api/panel-config.
// It contains no deployment endpoint, business code or field-name fallback.

export function valueAt(value, path) {
  if (path === undefined || path === null || path === "" || path === "$") return value;
  return String(path).split(".").reduce((current, key) =>
    current === undefined || current === null ? undefined : current[key], value);
}

function firstValueAt(value, paths) {
  for (const path of paths || []) {
    const found = valueAt(value, path);
    if (found !== undefined && found !== null && found !== "") return found;
  }
  return undefined;
}

function sameBusinessValue(left, right) {
  if (typeof left === typeof right) return left === right;
  return String(left) === String(right);
}

const AUTH_ENDPOINTS = new Set(["captcha", "loginVerify", "login", "userInfo"]);

function hasPath(value, path) {
  const normalized = path === undefined || path === null ? "" : String(path).trim();
  if (normalized === "" || normalized === "$") {
    return value !== undefined;
  }
  let current = value;
  for (const key of normalized.split(".")) {
    if (current === null || typeof current !== "object"
        || !Object.prototype.hasOwnProperty.call(current, key)) return false;
    current = current[key];
  }
  return true;
}

function hasConfiguredMessage(envelope, adapter) {
  return (adapter.response.messageFields || []).some((path) => {
    const value = valueAt(envelope, path);
    if (value === undefined || value === null) return false;
    const text = typeof value === "object" ? JSON.stringify(value) : String(value);
    return text.trim() !== "";
  });
}

function codeMissingCompatibilitySuccess(envelope, adapter) {
  if (envelope === undefined || envelope === null || !adapter.response.codeField) return false;
  const fields = adapter.response.successFieldsWhenCodeMissing || [];
  if (fields.length === 0) return false;
  const code = valueAt(envelope, adapter.response.codeField);
  if (code !== undefined && code !== null) return false;
  if (adapter.response.rejectMessageWhenCodeMissing === true
      && hasConfiguredMessage(envelope, adapter)) return false;
  return fields.some((path) => hasPath(envelope, path));
}

function responseSuccess(envelope, adapter) {
  if (!adapter.response.codeField) return true;
  const code = valueAt(envelope, adapter.response.codeField);
  if (code !== undefined && code !== null) {
    return (adapter.response.successValues || [])
      .some((value) => sameBusinessValue(code, value));
  }
  return codeMissingCompatibilitySuccess(envelope, adapter);
}

function responseData(envelope, adapter) {
  const configured = valueAt(envelope, adapter.response.dataField || "");
  if (configured !== undefined && configured !== null) return configured;
  if (adapter.response.dataRootWhenCodeMissing === true
      && codeMissingCompatibilitySuccess(envelope, adapter)) return envelope;
  return undefined;
}

function authSuccess(envelope, adapter) {
  if (responseSuccess(envelope, adapter)) return true;
  if (!adapter.response.codeField) return false;
  const code = valueAt(envelope, adapter.response.codeField);
  if (code !== undefined && code !== null) {
    return (adapter.response.successValues || [])
      .some((value) => sameBusinessValue(code, value));
  }
  if (hasConfiguredMessage(envelope, adapter)) return false;
  return (adapter.auth.successFieldsWhenCodeMissing || [])
    .some((path) => hasPath(envelope, path));
}

function authData(envelope, adapter) {
  const configured = responseData(envelope, adapter);
  if (configured !== undefined && configured !== null) return configured;
  const code = adapter.response.codeField
    ? valueAt(envelope, adapter.response.codeField)
    : undefined;
  if (adapter.auth.dataRootWhenCodeMissing === true
      && adapter.response.codeField
      && (code === undefined || code === null)
      && !hasConfiguredMessage(envelope, adapter)) return envelope;
  return undefined;
}

function cloneValue(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

const CANONICAL_FIELD_KINDS = [
  "photo",
  "result",
  "items",
  "serial",
  "scan",
  "number",
  "singleChoice",
  "multipleChoice",
  "text"
];

function endpointUrl(adapter, endpoint) {
  try {
    return new URL(endpoint);
  } catch {
    return new URL(String(endpoint).replace(/^\/+/, ""), `${adapter.baseUrl.replace(/\/+$/, "")}/`);
  }
}

function canonicalOption(raw, map) {
  return {
    value: valueAt(raw, map.value),
    name: valueAt(raw, map.label),
    en_name: valueAt(raw, map.englishLabel),
    num: valueAt(raw, map.quantity)
  };
}

function canonicalFieldKind(rawType, fieldKinds) {
  for (const kind of CANONICAL_FIELD_KINDS) {
    if ((fieldKinds?.[kind] || []).some((value) => sameBusinessValue(value, rawType))) return kind;
  }
  return "unknown";
}

function resultMapping(option, mappings) {
  const label = `${option.name || ""} ${option.en_name || ""}`.trim();
  return (mappings || []).find((mapping) =>
    (mapping.matchValues || []).some((value) => sameBusinessValue(value, option.value))
      || (mapping.matchLabelPatterns || []).some((pattern) => new RegExp(pattern, "i").test(label)));
}

function canonicalFormField(raw, map, optionMap, conversion) {
  const options = valueAt(raw, map.options);
  const rawType = valueAt(raw, map.type);
  const kind = canonicalFieldKind(rawType, conversion?.fieldKinds);
  const canonicalOptions = Array.isArray(options) ? options.map((option) => canonicalOption(option, optionMap)) : [];
  if (kind === "result") {
    canonicalOptions.forEach((option, index) => {
      const mapping = resultMapping(option, conversion?.result?.mappings);
      option.resultKey = mapping?.key || `option-${index + 1}`;
      option.resultLabel = mapping?.label || option.name || option.en_name || option.resultKey;
      if (mapping?.labelI18n) option.resultLabelI18n = JSON.parse(JSON.stringify(mapping.labelI18n));
      if (mapping?.operatorLabel) option.resultOperatorLabel = mapping.operatorLabel;
      if (mapping?.operatorLabelI18n) {
        option.resultOperatorLabelI18n = JSON.parse(JSON.stringify(mapping.operatorLabelI18n));
      }
      if (mapping?.uiColor) option.resultUiColor = mapping.uiColor;
      option.resultValue = mapping && Object.prototype.hasOwnProperty.call(mapping, "submitValue")
        ? cloneValue(mapping.submitValue)
        : cloneValue(option.value);
      option.includeInResults = mapping ? mapping.include !== false : conversion?.result?.includeUnmapped !== false;
    });
  }
  return {
    field: valueAt(raw, map.id),
    kind,
    type: rawType,
    parent_type: valueAt(raw, map.parentType),
    type_name: valueAt(raw, map.typeName),
    title: valueAt(raw, map.title),
    en_title: valueAt(raw, map.englishTitle),
    required: valueAt(raw, map.required),
    visible: valueAt(raw, map.visible),
    count: valueAt(raw, map.maxCount),
    option_list: canonicalOptions
  };
}

export function canonicalTemplate(raw, adapter) {
  const map = adapter.fields.template;
  const fields = valueAt(raw, map.fieldList);
  return {
    id: valueAt(raw, map.id),
    name: valueAt(raw, map.name),
    sku: valueAt(raw, map.sku),
    process_id: valueAt(raw, map.step),
    warehouse_id: valueAt(raw, map.warehouseId),
    field_list: Array.isArray(fields)
      ? fields.map((field) => canonicalFormField(field, adapter.fields.formField, adapter.fields.option, adapter.conversion))
      : []
  };
}

export function createBackendClient(adapter, { fetchImpl = fetch, fingerprint = "" } = {}) {
  if (!adapter || !adapter.baseUrl || !adapter.endpoints) throw new Error("backend adapter is missing");
  const authEnvelopeByData = new WeakMap();

  async function request(endpointName, { method = "GET", query, body, token } = {}) {
    const endpoint = adapter.endpoints[endpointName];
    if (!endpoint) throw new Error(`backend endpoint is not configured: ${endpointName}`);
    const url = endpointUrl(adapter, endpoint);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
      }
    }
    const headers = { Accept: "application/json, text/plain, */*" };
    if (token) headers.Authorization = `${adapter.request.authScheme} ${token}`;
    if (fingerprint && adapter.request.fingerprintHeader) {
      headers[adapter.request.fingerprintHeader] = fingerprint;
    }
    let payload;
    if (body !== undefined) {
      if (adapter.request.bodyEncoding === "json") {
        payload = JSON.stringify(body);
        headers["Content-Type"] = "application/json; charset=utf-8";
      } else {
        payload = new URLSearchParams(body).toString();
        headers["Content-Type"] = "application/x-www-form-urlencoded; charset=utf-8";
      }
    }
    const response = await fetchImpl(url, { method, headers, body: payload });
    const text = await response.text();
    let envelope = null;
    try { envelope = text ? JSON.parse(text) : null; } catch {}
    const isAuthEndpoint = AUTH_ENDPOINTS.has(endpointName);
    const success = response.ok && (isAuthEndpoint
      ? authSuccess(envelope, adapter)
      : responseSuccess(envelope, adapter));
    if (!success) {
      const message = firstValueAt(envelope, adapter.response.messageFields);
      throw new Error(message || `HTTP ${response.status} ${String(text).slice(0, 150)}`);
    }
    const data = isAuthEndpoint
      ? authData(envelope, adapter)
      : responseData(envelope, adapter);
    if (isAuthEndpoint && data !== null
        && (typeof data === "object" || typeof data === "function")) {
      authEnvelopeByData.set(data, envelope);
    }
    return data;
  }

  function loginBody({ account, password, captcha, client }) {
    const fields = adapter.auth.loginFields;
    return {
      [fields.account]: account,
      [fields.password]: password,
      [fields.captcha]: captcha,
      [fields.client]: client
    };
  }

  function captcha(data) {
    return {
      client: valueAt(data, adapter.fields.captchaClient) || "",
      image: valueAt(data, adapter.fields.captchaImage) || ""
    };
  }

  function token(data) {
    return firstValueAt(data, adapter.auth.tokenFields)
      ?? firstValueAt(data && (typeof data === "object" || typeof data === "function")
        ? authEnvelopeByData.get(data)
        : undefined, adapter.auth.tokenFields);
  }

  function userName(data) {
    return firstValueAt(data, adapter.auth.userNameFields) || "";
  }

  function templateList(data) {
    for (const path of adapter.fields.templateList) {
      const items = valueAt(data, path);
      if (Array.isArray(items)) return items.map((item) => canonicalTemplate(item, adapter));
    }
    return [];
  }

  function templateListQuery(keyword) {
    return {
      [adapter.pagination.pageParam]: adapter.pagination.pageStart,
      [adapter.pagination.keywordParam]: keyword
    };
  }

  function templateDetailQuery(id) {
    return { [adapter.operations.templateDetail.idParam]: id };
  }

  return {
    adapter,
    request,
    loginBody,
    captcha,
    token,
    userName,
    templateList,
    templateListQuery,
    templateDetailQuery,
    canonicalTemplate: (raw) => canonicalTemplate(raw, adapter)
  };
}
