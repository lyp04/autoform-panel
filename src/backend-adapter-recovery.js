// Existing material quantity policy and the controlled recovery operation.
import { CONTROLLED_RECOVERY_OPERATIONS, CONTROLLED_RECOVERY_VERSION } from "./backend-adapter-constants.js";
import { allowOnly } from "./backend-adapter-outcome-policy.js";
import { isPlainObject } from "./backend-adapter-primitives.js";

export function validateExistingMaterialQuantityPolicy(templateDetail, errors) {
  if (!Object.prototype.hasOwnProperty.call(templateDetail, "existingQuantityPolicy")) return;
  if (!["strict_live_match", "profile_authoritative"]
    .includes(templateDetail.existingQuantityPolicy)) {
    errors.push("operations.templateDetail.existingQuantityPolicy must be one of: strict_live_match, profile_authoritative");
  }
}

export function validateControlledRecoveryOperation(operation, errors, required) {
  if (!isPlainObject(operation)) {
    if (required) errors.push("operations.recovery must be configured");
    return;
  }
  allowOnly(errors, operation, [
    "version", "issuanceMode", "evidenceAlgorithm", "keyId", "publicKeySpkiHex",
    "maxEvidenceAgeSeconds", "reconciliationContractSha256", "enabledOperations"
  ], "operations.recovery");
  if (operation.version !== CONTROLLED_RECOVERY_VERSION) {
    errors.push(`operations.recovery.version must be ${CONTROLLED_RECOVERY_VERSION}`);
  }
  if (operation.issuanceMode !== "panel_signed_exact_reconciliation") {
    errors.push("operations.recovery.issuanceMode must be panel_signed_exact_reconciliation");
  }
  if (operation.evidenceAlgorithm !== "RS256") {
    errors.push("operations.recovery.evidenceAlgorithm must be RS256");
  }
  if (typeof operation.keyId !== "string" || operation.keyId.length === 0
      || operation.keyId.length > 128 || !/^[A-Za-z0-9_.-]+$/u.test(operation.keyId)) {
    errors.push("operations.recovery.keyId must be a bounded safe identifier");
  }
  const publicKey = operation.publicKeySpkiHex;
  // rsaEncryption OID inside a bounded DER SubjectPublicKeyInfo. Android performs the authoritative
  // KeyFactory check before accepting the capability; this synchronous Worker check rejects random
  // hex and non-RSA placeholders before a private catalog can be published.
  if (typeof publicKey !== "string" || publicKey.length < 512 || publicKey.length > 8192
      || (publicKey.length % 2) !== 0 || !/^[0-9a-f]+$/u.test(publicKey)
      || !publicKey.slice(0, 256).includes("06092a864886f70d010101")) {
    errors.push("operations.recovery.publicKeySpkiHex must be a bounded lowercase RSA SPKI DER value");
  }
  if (!Number.isInteger(operation.maxEvidenceAgeSeconds)
      || operation.maxEvidenceAgeSeconds <= 0
      || operation.maxEvidenceAgeSeconds > 3600) {
    errors.push("operations.recovery.maxEvidenceAgeSeconds must be an integer from 1 to 3600");
  }
  if (typeof operation.reconciliationContractSha256 !== "string"
      || !/^[0-9a-f]{64}$/u.test(operation.reconciliationContractSha256)) {
    errors.push("operations.recovery.reconciliationContractSha256 must be lowercase SHA-256");
  }
  if (!Array.isArray(operation.enabledOperations) || operation.enabledOperations.length === 0) {
    errors.push("operations.recovery.enabledOperations must be a non-empty array");
  } else {
    const seen = new Set();
    operation.enabledOperations.forEach((value, index) => {
      if (!CONTROLLED_RECOVERY_OPERATIONS.includes(value)) {
        errors.push(`operations.recovery.enabledOperations[${index}] must be one of: ${CONTROLLED_RECOVERY_OPERATIONS.join(", ")}`);
      } else if (seen.has(value)) {
        errors.push(`operations.recovery.enabledOperations[${index}] must not be duplicated`);
      }
      seen.add(value);
    });
  }
}

/**
 * Strict release-only capability gate. Ordinary Panel migration may omit recovery so the installed
 * App and existing catalog remain usable, but an official release must call this with every remote
 * side-effect kind it actually ships. A capability declaration is not proof of backend semantics;
 * its reconciliationContractSha256 must separately match the private replay attestation.
 */
export function validateControlledRecoveryConfig(
  adapter,
  { required = true, requiredOperations = CONTROLLED_RECOVERY_OPERATIONS } = {}
) {
  const errors = [];
  const operation = adapter?.operations?.recovery;
  validateControlledRecoveryOperation(operation, errors, required);
  if (!isPlainObject(operation)) return errors;
  const enabled = new Set(Array.isArray(operation.enabledOperations)
    ? operation.enabledOperations : []);
  for (const requiredOperation of requiredOperations || []) {
    if (!CONTROLLED_RECOVERY_OPERATIONS.includes(requiredOperation)) {
      errors.push(`required recovery operation is unknown: ${String(requiredOperation)}`);
    } else if (!enabled.has(requiredOperation)) {
      errors.push(`operations.recovery.enabledOperations must include ${requiredOperation}`);
    }
  }
  return errors;
}

