// Backend client driven exclusively by the versioned adapter resolved from Cloudflare or the
// private catalog. The Worker uses verifyToken; the browser consumes the authoring subset through
// /api/panel-config for login and template reads.

import {
  canonicalTemplate,
  firstValueAt,
  resolveBackendAdapter,
  templateItems,
  valueAt
} from "./backend-adapter.js";

function apiHeaders(adapter, token, fingerprint) {
  const headers = { Accept: "application/json, text/plain, */*" };
  if (token) headers.Authorization = `${adapter.request.authScheme} ${token}`;
  if (fingerprint && adapter.request.fingerprintHeader) {
    headers[adapter.request.fingerprintHeader] = String(fingerprint);
  }
  return headers;
}

function endpointUrl(adapter, endpoint) {
  try {
    return new URL(endpoint);
  } catch {
    return new URL(String(endpoint).replace(/^\/+/, ""), `${adapter.baseUrl.replace(/\/+$/, "")}/`);
  }
}

async function apiJson(adapter, endpointName, { method = "GET", query, body, token, fingerprint } = {}) {
  const endpoint = adapter.endpoints[endpointName];
  if (!endpoint) throw new Error(`backend endpoint is not configured: ${endpointName}`);
  const url = endpointUrl(adapter, endpoint);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
    }
  }
  const headers = apiHeaders(adapter, token, fingerprint);
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
  const response = await fetch(url, { method, headers, body: payload });
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: response.status, ok: response.ok, body: json, text };
}

function sameBusinessValue(left, right) {
  if (typeof left === typeof right) return left === right;
  return String(left) === String(right);
}

function isSuccess(result, adapter) {
  if (!result.ok) return false;
  const field = adapter.response.codeField;
  if (!field) return true;
  const code = valueAt(result.body, field);
  if (code !== undefined && code !== null) {
    return (adapter.response.successValues || [])
      .some((value) => sameBusinessValue(code, value));
  }
  return codeMissingCompatibilitySuccess(result.body, adapter);
}

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

function hasConfiguredMessage(body, adapter) {
  return (adapter.response.messageFields || []).some((path) => {
    const value = valueAt(body, path);
    if (value === undefined || value === null) return false;
    const text = typeof value === "object" ? JSON.stringify(value) : String(value);
    return text.trim() !== "";
  });
}

function codeMissingCompatibilitySuccess(body, adapter) {
  if (body === undefined || body === null || !adapter.response.codeField) return false;
  const fields = adapter.response.successFieldsWhenCodeMissing || [];
  if (fields.length === 0) return false;
  const code = valueAt(body, adapter.response.codeField);
  if (code !== undefined && code !== null) return false;
  if (adapter.response.rejectMessageWhenCodeMissing === true
      && hasConfiguredMessage(body, adapter)) return false;
  return fields.some((path) => hasPath(body, path));
}

function isAuthSuccess(result, adapter) {
  if (isSuccess(result, adapter)) return true;
  if (!result.ok || !adapter.response.codeField) return false;
  const code = valueAt(result.body, adapter.response.codeField);
  if (code !== undefined && code !== null) return false;
  if (hasConfiguredMessage(result.body, adapter)) return false;
  return (adapter.auth.successFieldsWhenCodeMissing || [])
    .some((path) => hasPath(result.body, path));
}

function apiData(body, adapter) {
  const configured = valueAt(body, adapter.response.dataField || "");
  if (configured !== undefined && configured !== null) return configured;
  if (adapter.response.dataRootWhenCodeMissing === true
      && codeMissingCompatibilitySuccess(body, adapter)) return body;
  return undefined;
}

function authData(body, adapter) {
  const configured = apiData(body, adapter);
  if (configured !== undefined && configured !== null) return configured;
  const code = adapter.response.codeField
    ? valueAt(body, adapter.response.codeField)
    : undefined;
  if (adapter.auth.dataRootWhenCodeMissing === true
      && adapter.response.codeField
      && (code === undefined || code === null)
      && !hasConfiguredMessage(body, adapter)) return body;
  return undefined;
}

function apiError(result, adapter) {
  const message = firstValueAt(result.body, adapter.response.messageFields);
  return message || result.text || `HTTP ${result.status}`;
}

function describe(step, result, adapter) {
  const code = adapter.response.codeField ? valueAt(result.body, adapter.response.codeField) : "";
  return `${step} [http=${result.status} code=${code}]: ${apiError(result, adapter)}`;
}

function adapterFor(env, adapter) {
  return adapter || resolveBackendAdapter(env);
}

function mappedLoginForm(adapter, { account, password, captcha, client }) {
  const fields = adapter.auth.loginFields;
  return {
    [fields.account]: account,
    [fields.password]: password,
    [fields.captcha]: captcha,
    [fields.client]: client
  };
}

export async function getCaptcha(env, adapterOverride) {
  const adapter = adapterFor(env, adapterOverride);
  const result = await apiJson(adapter, "captcha");
  if (!isAuthSuccess(result, adapter)) throw new Error(`captcha failed: ${apiError(result, adapter)}`);
  const data = authData(result.body, adapter);
  return {
    client: valueAt(data, adapter.fields.captchaClient) || "",
    captcha: valueAt(data, adapter.fields.captchaImage) || ""
  };
}

export async function login(env, credentials, adapterOverride) {
  const adapter = adapterFor(env, adapterOverride);
  const form = mappedLoginForm(adapter, credentials);
  if (adapter.endpoints.loginVerify) {
    const verify = await apiJson(adapter, "loginVerify", { method: "POST", body: form });
    if (!isAuthSuccess(verify, adapter)) throw new Error(describe("loginVerify", verify, adapter));
  }
  const result = await apiJson(adapter, "login", { method: "POST", body: form });
  if (!isAuthSuccess(result, adapter)) throw new Error(describe("login", result, adapter));
  const data = authData(result.body, adapter);
  const token = firstValueAt(data, adapter.auth.tokenFields)
    ?? firstValueAt(result.body, adapter.auth.tokenFields);
  if (!token) throw new Error("login succeeded but no token returned by configured tokenFields");
  const userName = firstValueAt(data, adapter.auth.userNameFields) || credentials.account;
  return { token: String(token), userName: String(userName || "") };
}

/** Confirm a token belongs to the configured backend session before allowing panel writes. */
export async function verifyToken(env, token, fingerprint, adapterOverride) {
  if (!token || String(token).trim().length < 20) throw new Error("backend token is not valid");
  const adapter = adapterFor(env, adapterOverride);
  const result = await apiJson(adapter, "userInfo", { token, fingerprint });
  if (isAuthSuccess(result, adapter)) {
    const data = authData(result.body, adapter);
    return {
      userName: String(firstValueAt(data, adapter.auth.userNameFields) || ""),
      raw: data && typeof data === "object" ? data : {}
    };
  }
  const proofCodes = new Set((adapter.auth.sessionProofCodes || []).map((value) => String(value)));
  const code = adapter.response.codeField ? valueAt(result.body, adapter.response.codeField) : undefined;
  if (code !== undefined && proofCodes.has(String(code))) {
    return { userName: "", raw: {}, sessionProof: true };
  }
  throw new Error("backend token is not valid");
}

export async function listTemplates(env, { token, fingerprint, keyword = "" }, adapterOverride) {
  const adapter = adapterFor(env, adapterOverride);
  const query = {
    [adapter.pagination.pageParam]: adapter.pagination.pageStart,
    [adapter.pagination.keywordParam]: keyword
  };
  const result = await apiJson(adapter, "templateList", { token, fingerprint, query });
  if (!isSuccess(result, adapter)) throw new Error(`listTemplates failed: ${apiError(result, adapter)}`);
  return templateItems(apiData(result.body, adapter), adapter).map((template) => ({
    id: template.id,
    name: template.name || "",
    sku: template.sku || "",
    step: template.process_id
  }));
}

export async function templateDetail(env, { token, fingerprint, id }, adapterOverride) {
  const adapter = adapterFor(env, adapterOverride);
  const query = { [adapter.operations.templateDetail.idParam]: id };
  const result = await apiJson(adapter, "templateDetail", { token, fingerprint, query });
  if (!isSuccess(result, adapter)) throw new Error(`templateDetail failed: ${apiError(result, adapter)}`);
  return canonicalTemplate(apiData(result.body, adapter), adapter);
}
