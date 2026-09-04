// Controlled message templates and the v3 formatters that render them.
import { DATA_KEY_PATTERN, MAX_FORMATTER_SEPARATOR_LENGTH, MAX_FORMATTER_TEMPLATE_LENGTH, MAX_FORMATTER_TEXT_LENGTH, MAX_MESSAGE_CONDITIONAL_DEPTH, MAX_MESSAGE_TEMPLATE_TOKENS, SUBMISSION_ROUND_FIELDS, SUBMISSION_ROUND_FIELD_SHAPE, V3_FORMATTER_KEYS, V3_FORMATTER_TYPES } from "./notification-adapter-constants.js";
import { boundedString, isPlainObject } from "./notification-adapter-primitives.js";

export function controlledTemplateTokens(template, path, errors, {
  allowedPlaceholders,
  allowedConditionals = new Set(),
  allowConditionals = false,
  maxDepth = 0
}) {
  const tokens = [];
  let cursor = 0;
  let conditionalDepth = 0;
  let tokenLimitReported = false;
  while (cursor < template.length) {
    const open = template.indexOf("{{", cursor);
    const strayClose = template.indexOf("}}", cursor);
    if (strayClose !== -1 && (open === -1 || strayClose < open)) {
      errors.push(`${path} contains an unexpected }} token`);
      cursor = strayClose + 2;
      continue;
    }
    if (open === -1) {
      if (cursor < template.length) tokens.push({ kind: "text", value: template.slice(cursor) });
      break;
    }
    if (open > cursor) tokens.push({ kind: "text", value: template.slice(cursor, open) });
    const close = template.indexOf("}}", open + 2);
    if (close === -1) {
      errors.push(`${path} contains an unterminated {{ token`);
      break;
    }
    const raw = template.slice(open + 2, close);
    if (raw === "/if") {
      if (!allowConditionals) {
        errors.push(`${path} does not support conditional blocks`);
      } else if (conditionalDepth === 0) {
        errors.push(`${path} contains {{/if}} without a matching {{#if field}}`);
      } else {
        conditionalDepth--;
      }
      tokens.push({ kind: "ifEnd" });
    } else if (raw.startsWith("#if")) {
      const match = raw.match(/^#if ([A-Za-z][A-Za-z0-9]{0,63})$/);
      if (!allowConditionals) {
        errors.push(`${path} does not support conditional blocks`);
      } else if (!match) {
        errors.push(`${path} uses invalid conditional token {{${raw}}}`);
      } else {
        const field = match[1];
        if (!allowedConditionals.has(field)) {
          errors.push(`${path} uses unsupported conditional field ${field}`);
        }
        conditionalDepth++;
        if (conditionalDepth > maxDepth) {
          errors.push(`${path} conditional blocks must not exceed ${maxDepth} levels`);
        }
        tokens.push({ kind: "ifStart", field });
      }
    } else if (!DATA_KEY_PATTERN.test(raw) && raw !== "type") {
      errors.push(`${path} uses invalid placeholder {{${raw}}}`);
      tokens.push({ kind: "placeholder", field: raw });
    } else {
      if (!allowedPlaceholders.has(raw)) {
        errors.push(`${path} uses unsupported placeholder {{${raw}}}`);
      }
      tokens.push({ kind: "placeholder", field: raw });
    }
    if (tokens.length > MAX_MESSAGE_TEMPLATE_TOKENS && !tokenLimitReported) {
      errors.push(`${path} must not contain more than ${MAX_MESSAGE_TEMPLATE_TOKENS} template tokens`);
      tokenLimitReported = true;
    }
    cursor = close + 2;
  }
  if (conditionalDepth > 0) {
    errors.push(`${path} contains an unclosed {{#if field}} block`);
  }
  return tokens;
}

export function validateRoundMessageTemplate(template, path, errors) {
  if (!boundedString(template, 4000)) {
    errors.push(`${path} must be a non-empty string not exceeding 4000 characters`);
    return;
  }
  controlledTemplateTokens(template, path, errors, {
    allowedPlaceholders: new Set(["type", ...SUBMISSION_ROUND_FIELDS]),
    allowedConditionals: new Set(SUBMISSION_ROUND_FIELDS),
    allowConditionals: true,
    maxDepth: MAX_MESSAGE_CONDITIONAL_DEPTH
  });
}

function validateFormatterText(value, path, maxLength, errors, allowEmpty = true) {
  if (!boundedString(value, maxLength, { allowEmpty })) {
    errors.push(`${path} must be a string not exceeding ${maxLength} characters`);
  }
}

function validateFormatterTemplate(value, path, allowedPlaceholders, errors) {
  if (!boundedString(value, MAX_FORMATTER_TEMPLATE_LENGTH)) {
    errors.push(`${path} must be a non-empty string not exceeding ${MAX_FORMATTER_TEMPLATE_LENGTH} characters`);
    return;
  }
  controlledTemplateTokens(value, path, errors, {
    allowedPlaceholders: new Set(allowedPlaceholders)
  });
}

export function validateV3Formatters(formatters, path, errors) {
  if (formatters === undefined) return;
  if (!isPlainObject(formatters)) {
    errors.push(`${path} must be an object`);
    return;
  }
  const entries = Object.entries(formatters);
  if (entries.length > SUBMISSION_ROUND_FIELDS.length) {
    errors.push(`${path} must not contain more than ${SUBMISSION_ROUND_FIELDS.length} fields`);
  }
  for (const [field, formatter] of entries) {
    const itemPath = `${path}.${field}`;
    const fieldKind = SUBMISSION_ROUND_FIELD_SHAPE[field];
    if (!fieldKind) {
      errors.push(`${itemPath} is not a supported submission.round field`);
      continue;
    }
    if (!isPlainObject(formatter)) {
      errors.push(`${itemPath} must be an object`);
      continue;
    }
    const type = formatter.type;
    if (!V3_FORMATTER_TYPES.has(type)) {
      errors.push(`${itemPath}.type must be one of: ${[...V3_FORMATTER_TYPES].join(", ")}`);
      for (const key of Object.keys(formatter)) {
        if (key !== "type") errors.push(`${itemPath}.${key} is not supported`);
      }
      continue;
    }
    for (const key of Object.keys(formatter)) {
      if (!V3_FORMATTER_KEYS[type].has(key)) errors.push(`${itemPath}.${key} is not supported`);
    }
    const compatible = type === "length"
      ? fieldKind === "stringArray" || fieldKind === "countedItemArray"
      : type === "list"
        ? fieldKind === "stringArray"
        : type === "isoLocalSeconds"
          ? fieldKind === "isoOffsetDateTime"
          : fieldKind === "countedItemArray";
    if (!compatible) {
      errors.push(`${itemPath}.type ${type} is not supported for ${field}`);
    }
    if (type === "list") {
      validateFormatterText(formatter.empty, `${itemPath}.empty`, MAX_FORMATTER_TEXT_LENGTH, errors);
      validateFormatterText(formatter.separator, `${itemPath}.separator`,
        MAX_FORMATTER_SEPARATOR_LENGTH, errors);
      validateFormatterText(formatter.prefixEach, `${itemPath}.prefixEach`,
        MAX_FORMATTER_SEPARATOR_LENGTH, errors);
    } else if (type === "groupedCountList") {
      validateFormatterText(formatter.empty, `${itemPath}.empty`, MAX_FORMATTER_TEXT_LENGTH, errors);
      validateFormatterText(formatter.groupSeparator, `${itemPath}.groupSeparator`,
        MAX_FORMATTER_SEPARATOR_LENGTH, errors);
      validateFormatterText(formatter.itemSeparator, `${itemPath}.itemSeparator`,
        MAX_FORMATTER_SEPARATOR_LENGTH, errors);
      validateFormatterTemplate(formatter.groupTemplate, `${itemPath}.groupTemplate`,
        ["count", "items"], errors);
      validateFormatterTemplate(formatter.itemTemplate, `${itemPath}.itemTemplate`,
        ["index", "label", "count"], errors);
    }
  }
}
