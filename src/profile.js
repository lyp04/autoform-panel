// Profile validation. The rules live in profile-*.js by concern; this file is the public
// entry point and re-exports them, so importers do not need to know the internal layout.

export { PHOTO_ORDERS, PHOTO_INPUT_SOURCES, normalizeSn, normalizeGrade, normalizePhotoOrder } from "./profile-shape.js";
export { validateFormProfile } from "./profile-validate.js";
export { validateAlternateEntryReferences } from "./profile-alternate-references.js";
export { preserveRuntimeProfileConfig } from "./profile-runtime-config.js";
