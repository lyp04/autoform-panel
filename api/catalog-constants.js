// Catalog file names, schema versions and the publish conflict error.

export const SCHEMA_VERSION = 2; // keep in sync with FormCatalog.SUPPORTED_SCHEMA_VERSION (Android)

export class CatalogPublishConflictError extends Error {
  constructor() {
    super("catalog changed while publishing; reload the Panel and retry");
    this.name = "CatalogPublishConflictError";
  }
}

export const PROFILES_PATH = "form-profiles.json";

export const MANIFEST_PATH = "manifest.json";

export const PANEL_SETTINGS_PATH = "panel-settings.json";

export const CATALOG_PATHS = [PROFILES_PATH, MANIFEST_PATH, PANEL_SETTINGS_PATH];

export const R2_STATE_SCHEMA_VERSION = 1;

export const R2_POINTER_SCHEMA_VERSION = 1;

export const MAX_APP_CATALOG_VERSION = 2_147_483_647;

export const R2_CATALOG_POINTER_KEY = "catalog-current-v1.json";

export const R2_CATALOG_SNAPSHOT_PREFIX = "catalog-snapshots-v1/";
