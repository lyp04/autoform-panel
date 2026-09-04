import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  DAILY_STATS_MAX_GROUPS,
  DAILY_STATS_V2_MAX_FLAT_SUMMARIES,
  DAILY_STATS_V2_MAX_GROUPS,
  DAILY_STATS_V2_MAX_SELECTORS,
  validateDailyStats,
  validateDailyStatsAlternateEntries,
  validateDailyStatsV2
} from "../src/daily-stats.js";
import { validateFormProfile } from "../src/profile.js";
import { clientCatalog } from "../src/worker.js";

function visibleProfile(id, resultKeys) {
  return {
    id,
    pickerVisible: true,
    gradeMap: Object.fromEntries(resultKeys.map((key) => [key, {
      field: "sample-result",
      label: `Sample ${key}`,
      value: `SAMPLE_${key}`
    }]))
  };
}

function group(id, label, uiColor, resultKeys, extra = {}) {
  return { id, label, uiColor, resultKeys, ...extra };
}

function validDailyStats() {
  return {
    scope: "all_profiles",
    groups: [
      group("sample-ready-summary", "Sample ready", "#2563EB", ["sample-ready"], {
        labelI18n: { en: "Sample ready", es: "Ejemplo listo" }
      }),
      group("sample-review-summary", "Sample review", "#7C3AED", ["sample-review"])
    ]
  };
}

function selector(profileId, resultKey) {
  return { profileId, resultKey };
}

function statsV2Item(id, label, uiColor, selectors, extra = {}) {
  return { id, label, uiColor, selectors, ...extra };
}

function validDailyStatsV2() {
  return {
    version: 2,
    scope: "all_profiles",
    groups: [
      statsV2Item("sample-ready-v2", "Sample ready", "#2563EB",
        [selector("sample-one", "sample-ready")], {
          labelI18n: { en: "Sample ready", es: "Ejemplo listo" },
          legacyResultKeys: ["sample-ready"]
        }),
      statsV2Item("sample-review-v2", "Sample review", "#7C3AED",
        [selector("sample-two", "sample-review")])
    ],
    flatSummaries: [
      statsV2Item("sample-total-v2", "Sample total", "#64748B", [
        selector("sample-one", "sample-ready"),
        selector("sample-two", "sample-review")
      ])
    ]
  };
}

function alternateSourceProfile(id, resultKeys, entryIds, {
  pickerVisible = true,
  enabled = true
} = {}) {
  const profile = visibleProfile(id, resultKeys);
  profile.pickerVisible = pickerVisible;
  profile.workflow = {
    alternateEntries: {
      enabled,
      entries: entryIds.map((entryId) => ({ id: entryId }))
    }
  };
  return profile;
}

function alternateSelector(profileId, entryId) {
  return { profileId, entryId };
}

function alternateItem(id, selectors) {
  return { id, selectors };
}

function validDailyStatsAlternateEntries() {
  return {
    version: 1,
    scope: "all_profiles",
    groups: [
      alternateItem("sample-ready-v2", [
        alternateSelector("sample-one", "sample-entry-one")
      ]),
      alternateItem("sample-review-v2", [
        alternateSelector("sample-two", "sample-entry-two")
      ])
    ],
    flatSummaries: [
      alternateItem("sample-total-v2", [
        alternateSelector("sample-one", "sample-entry-one"),
        alternateSelector("sample-two", "sample-entry-two")
      ])
    ]
  };
}

test("dailyStats accepts ordered fictional groups backed by visible profile result keys", () => {
  const profiles = [
    visibleProfile("sample-one", ["sample-ready"]),
    visibleProfile("sample-two", ["sample-review"])
  ];
  assert.deepEqual(validateDailyStats(validDailyStats(), profiles), []);

  const source = {
    settings: {
      brand: "Sample",
      dailyStats: validDailyStats(),
      workerOnlyFutureSecret: "must-not-leak"
    },
    profiles
  };
  const served = clientCatalog(source);
  assert.deepEqual(served.settings.dailyStats.groups.map((item) => item.id), [
    "sample-ready-summary", "sample-review-summary"
  ]);
  assert.equal("workerOnlyFutureSecret" in served.settings, false);
});

test("dailyStatsV2 accepts profile-qualified groups and flat summaries", () => {
  const profiles = [
    visibleProfile("sample-one", ["sample-ready"]),
    visibleProfile("sample-two", ["sample-review"])
  ];
  const dailyStatsV2 = validDailyStatsV2();
  assert.deepEqual(validateDailyStatsV2(dailyStatsV2, profiles), []);

  const served = clientCatalog({
    settings: { dailyStatsV2, workerOnlyFutureSecret: "must-not-leak" },
    profiles
  });
  assert.deepEqual(served.settings.dailyStatsV2, dailyStatsV2);
  assert.equal("workerOnlyFutureSecret" in served.settings, false);
});

test("dailyStatsAlternateEntries maps exact enabled source entries to v2 items", () => {
  const profiles = [
    alternateSourceProfile("sample-one", ["sample-ready"], ["sample-entry-one"]),
    alternateSourceProfile("sample-two", ["sample-review"], ["sample-entry-two"])
  ];
  const dailyStatsV2 = validDailyStatsV2();
  const mapping = validDailyStatsAlternateEntries();
  assert.deepEqual(
    validateDailyStatsAlternateEntries(mapping, dailyStatsV2, profiles), []);
  assert.deepEqual(validateDailyStatsAlternateEntries({
    version: 1, scope: "all_profiles", groups: [], flatSummaries: []
  }, dailyStatsV2, profiles), []);
  assert.ok(validateDailyStatsAlternateEntries({
    version: 1, scope: "all_profiles", groups: [], flatSummaries: []
  }, undefined, profiles).includes(
    "dailyStatsAlternateEntries requires a valid dailyStatsV2"));

  const served = clientCatalog({
    settings: { dailyStatsV2, dailyStatsAlternateEntries: mapping },
    profiles
  });
  assert.deepEqual(served.settings.dailyStatsAlternateEntries, mapping);
});

test("flat summaries may be backed only by a required alternate-entry mapping", () => {
  const profiles = [
    alternateSourceProfile("sample-one", ["sample-ready"], ["sample-entry-one"]),
    alternateSourceProfile("sample-two", ["sample-review"], ["sample-entry-two"])
  ];
  const dailyStatsV2 = validDailyStatsV2();
  dailyStatsV2.flatSummaries[0].selectors = [];
  const mapping = validDailyStatsAlternateEntries();
  const coverageError =
    "dailyStatsAlternateEntries.flatSummaries must provide non-empty selectors for dailyStatsV2 flat summary \"sample-total-v2\" because its selectors are empty";

  assert.deepEqual(validateDailyStatsV2(dailyStatsV2, profiles), []);
  assert.deepEqual(
    validateDailyStatsAlternateEntries(mapping, dailyStatsV2, profiles), []);
  assert.ok(validateDailyStatsAlternateEntries(
    undefined, dailyStatsV2, profiles).includes(coverageError));
  assert.ok(validateDailyStatsAlternateEntries({
    ...mapping,
    flatSummaries: []
  }, dailyStatsV2, profiles).includes(coverageError));

  const served = clientCatalog({
    settings: { dailyStatsV2, dailyStatsAlternateEntries: mapping },
    profiles
  });
  assert.deepEqual(served.settings.dailyStatsV2, dailyStatsV2);
  assert.deepEqual(served.settings.dailyStatsAlternateEntries, mapping);

  const servedWithoutMapping = clientCatalog({
    settings: { dailyStatsV2 },
    profiles
  });
  assert.equal("dailyStatsV2" in servedWithoutMapping.settings, false);
  assert.equal("dailyStatsAlternateEntries" in servedWithoutMapping.settings, false);

  const invalidMapping = structuredClone(mapping);
  invalidMapping.flatSummaries[0].selectors[0].entryId = "missing-entry";
  const servedWithInvalidMapping = clientCatalog({
    settings: { dailyStatsV2, dailyStatsAlternateEntries: invalidMapping },
    profiles
  });
  assert.equal("dailyStatsV2" in servedWithInvalidMapping.settings, false);
  assert.equal("dailyStatsAlternateEntries" in servedWithInvalidMapping.settings, false);

  const emptyGroup = validDailyStatsV2();
  emptyGroup.groups[0].selectors = [];
  assert.ok(validateDailyStatsV2(emptyGroup, profiles).includes(
    "dailyStatsV2.groups[0].selectors must not be empty"));
});

test("dailyStatsAlternateEntries is strict, v2-bound and collection-qualified", () => {
  const profiles = [
    alternateSourceProfile("sample-one", ["sample-ready"], [
      "sample-entry-one", "sample-entry-one"
    ]),
    alternateSourceProfile("sample-two", ["sample-review", "sample-extra"], ["sample-entry-two"]),
    alternateSourceProfile("sample-hidden", ["sample-ready"], ["sample-hidden-entry"], {
      pickerVisible: false
    }),
    alternateSourceProfile("sample-disabled", ["sample-ready"], ["sample-disabled-entry"], {
      enabled: false
    })
  ];
  const dailyStatsV2 = validDailyStatsV2();
  dailyStatsV2.flatSummaries.push(statsV2Item(
    "sample-other-flat-v2", "Other", "#475569",
    [selector("sample-two", "sample-extra")]));
  const errors = validateDailyStatsAlternateEntries({
    version: 2,
    scope: "current_profile",
    groups: [
      {
        ...alternateItem("sample-total-v2", [
          alternateSelector("sample-one", "sample-entry-one"),
          alternateSelector("sample-one", "sample-entry-one"),
          alternateSelector("sample-hidden", "sample-hidden-entry"),
          alternateSelector("sample-disabled", "sample-disabled-entry")
        ]),
        unsupported: true
      },
      alternateItem("sample-ready-v2", [
        alternateSelector("sample-two", "sample-entry-two")
      ]),
      alternateItem("sample-review-v2", [
        alternateSelector("sample-two", "sample-entry-two")
      ])
    ],
    flatSummaries: [
      alternateItem("sample-total-v2", [
        alternateSelector("sample-two", "sample-entry-two")
      ]),
      alternateItem("sample-other-flat-v2", [
        alternateSelector("sample-two", "sample-entry-two")
      ])
    ],
    unsupported: true
  }, dailyStatsV2, profiles);
  for (const expected of [
    "dailyStatsAlternateEntries.unsupported is unsupported",
    "dailyStatsAlternateEntries.version must equal 1",
    "dailyStatsAlternateEntries.scope must equal all_profiles",
    "dailyStatsAlternateEntries.groups[0].unsupported is unsupported",
    "dailyStatsAlternateEntries.groups[0].id must reference a dailyStatsV2 group id",
    "dailyStatsAlternateEntries.groups[0].selectors[1] pair must be unique within its item",
    "dailyStatsAlternateEntries.groups[0].selectors[0] must reference exactly one enabled alternate entry on the selected pickerVisible profile",
    "dailyStatsAlternateEntries.groups[0].selectors[2] must reference exactly one enabled alternate entry on the selected pickerVisible profile",
    "dailyStatsAlternateEntries.groups[0].selectors[3] must reference exactly one enabled alternate entry on the selected pickerVisible profile",
    "dailyStatsAlternateEntries.groups[2].selectors[0] pair must not appear in more than one group",
    "dailyStatsAlternateEntries.flatSummaries[0].id must be unique across groups and flatSummaries",
    "dailyStatsAlternateEntries.flatSummaries[1].selectors[0] pair must not appear in more than one flat summary"
  ]) assert.ok(errors.includes(expected), expected);
  assert.equal(errors.some((error) => error.includes(
    "dailyStatsAlternateEntries.flatSummaries[0].selectors[0] pair must not appear in more than one group")), false);
});

test("invalid dailyStatsAlternateEntries is omitted without removing valid dailyStatsV2", () => {
  const profiles = [
    alternateSourceProfile("sample-one", ["sample-ready"], ["sample-entry-one"]),
    alternateSourceProfile("sample-two", ["sample-review"], ["sample-entry-two"])
  ];
  const dailyStatsV2 = validDailyStatsV2();
  const invalid = validDailyStatsAlternateEntries();
  invalid.groups[0].selectors[0].entryId = "missing-entry";
  const source = {
    settings: { dailyStatsV2, dailyStatsAlternateEntries: invalid },
    profiles
  };
  const served = clientCatalog(source);
  assert.deepEqual(served.settings.dailyStatsV2, dailyStatsV2);
  assert.equal("dailyStatsAlternateEntries" in served.settings, false);
  assert.equal(source.settings.dailyStatsAlternateEntries.groups[0]
    .selectors[0].entryId, "missing-entry");
});

test("dailyStatsV2 enforces root, item and collection bounds", () => {
  const profiles = [visibleProfile("sample-one", ["sample-ready"])];
  const baseItem = (id) => statsV2Item(id, "Sample", "#2563EB",
    [selector("sample-one", "sample-ready")]);
  const errors = validateDailyStatsV2({
    version: 1,
    scope: "current_profile",
    groups: [
      { ...baseItem(" duplicate "), unsupported: true },
      { ...baseItem("duplicate"), label: "", uiColor: "2563EB" }
    ],
    flatSummaries: [{ ...baseItem("duplicate"), legacyResultKeys: ["sample-ready"] }],
    unsupported: true
  }, profiles);
  assert.ok(errors.includes("dailyStatsV2.unsupported is unsupported"));
  assert.ok(errors.includes("dailyStatsV2.version must equal 2"));
  assert.ok(errors.includes("dailyStatsV2.scope must equal all_profiles"));
  assert.ok(errors.includes("dailyStatsV2.groups[0].unsupported is unsupported"));
  assert.ok(errors.includes("dailyStatsV2.groups[0].id must not have surrounding whitespace"));
  assert.ok(errors.includes("dailyStatsV2.groups[1].id must be unique across groups and flatSummaries"));
  assert.ok(errors.includes("dailyStatsV2.groups[1].label must be a non-empty string"));
  assert.ok(errors.includes("dailyStatsV2.groups[1].uiColor must be a six-digit #RRGGBB color"));
  assert.ok(errors.includes("dailyStatsV2.flatSummaries[0].id must be unique across groups and flatSummaries"));
  assert.ok(errors.includes("dailyStatsV2.flatSummaries[0].legacyResultKeys is unsupported"));

  const tooManyGroups = Array.from({ length: DAILY_STATS_V2_MAX_GROUPS + 1 },
    (_, index) => baseItem(`group-${index}`));
  assert.ok(validateDailyStatsV2({
    version: 2, scope: "all_profiles", groups: tooManyGroups, flatSummaries: []
  }, profiles).includes("dailyStatsV2.groups must contain at most 16 items"));
  const tooManyFlat = Array.from({ length: DAILY_STATS_V2_MAX_FLAT_SUMMARIES + 1 },
    (_, index) => baseItem(`flat-${index}`));
  assert.ok(validateDailyStatsV2({
    version: 2, scope: "all_profiles", groups: [baseItem("group")],
    flatSummaries: tooManyFlat
  }, profiles).includes("dailyStatsV2.flatSummaries must contain at most 8 items"));
  const tooManySelectors = Array.from({ length: DAILY_STATS_V2_MAX_SELECTORS + 1 },
    () => selector("sample-one", "sample-ready"));
  assert.ok(validateDailyStatsV2({
    version: 2, scope: "all_profiles",
    groups: [statsV2Item("group", "Sample", "#2563EB", tooManySelectors)],
    flatSummaries: []
  }, profiles).includes("dailyStatsV2.groups[0].selectors must contain at most 512 items"));
  const longReferenceErrors = validateDailyStatsV2({
    version: 2,
    scope: "all_profiles",
    groups: [statsV2Item("long-reference", "Sample", "#2563EB", [
      selector("p".repeat(257), "r".repeat(257))
    ])],
    flatSummaries: []
  }, profiles);
  assert.ok(longReferenceErrors.includes(
    "dailyStatsV2.groups[0].selectors[0].profileId must contain at most 256 characters"));
  assert.ok(longReferenceErrors.includes(
    "dailyStatsV2.groups[0].selectors[0].resultKey must contain at most 256 characters"));
});

test("dailyStatsV2 selector pairs are exact and non-overlapping within each collection", () => {
  const profiles = [
    visibleProfile("sample-one", ["sample-ready", "sample-review"]),
    { ...visibleProfile("sample-hidden", ["sample-hidden-only"]), pickerVisible: false }
  ];
  const errors = validateDailyStatsV2({
    version: 2,
    scope: "all_profiles",
    groups: [
      statsV2Item("group-one", "One", "#2563EB", [
        selector("sample-one", "sample-ready"),
        selector("sample-one", "sample-ready"),
        selector("sample-hidden", "sample-hidden-only")
      ]),
      statsV2Item("group-two", "Two", "#7C3AED", [
        selector("sample-one", "sample-ready"),
        selector("sample-one", "missing")
      ])
    ],
    flatSummaries: [
      statsV2Item("flat-one", "Flat one", "#64748B", [
        selector("sample-one", "sample-ready")
      ]),
      statsV2Item("flat-two", "Flat two", "#475569", [
        selector("sample-one", "sample-ready")
      ])
    ]
  }, profiles);
  assert.ok(errors.includes(
    "dailyStatsV2.groups[0].selectors[1] pair must be unique within its item"));
  assert.ok(errors.includes(
    "dailyStatsV2.groups[1].selectors[0] pair must not appear in more than one group"));
  assert.ok(errors.includes(
    "dailyStatsV2.flatSummaries[1].selectors[0] pair must not appear in more than one flat summary"));
  assert.ok(errors.includes(
    "dailyStatsV2.groups[0].selectors[2] must reference a gradeMap resultKey on the selected pickerVisible profile"));
  assert.ok(errors.includes(
    "dailyStatsV2.groups[1].selectors[1] must reference a gradeMap resultKey on the selected pickerVisible profile"));
  assert.equal(errors.some((error) => error.includes(
    "dailyStatsV2.flatSummaries[0].selectors[0] pair must not appear")), false);
});

test("dailyStatsV2 legacyResultKeys stay selected and globally unique across groups", () => {
  const profiles = [visibleProfile("sample-one", ["sample-ready", "sample-review"])];
  const errors = validateDailyStatsV2({
    version: 2,
    scope: "all_profiles",
    groups: [
      statsV2Item("group-one", "One", "#2563EB", [
        selector("sample-one", "sample-ready")
      ], { legacyResultKeys: ["sample-ready", "sample-ready", "sample-review"] }),
      statsV2Item("group-two", "Two", "#7C3AED", [
        selector("sample-one", "sample-review")
      ], { legacyResultKeys: ["sample-ready"] })
    ],
    flatSummaries: []
  }, profiles);
  assert.ok(errors.includes(
    "dailyStatsV2.groups[0].legacyResultKeys[1] must be unique within its group"));
  assert.ok(errors.includes(
    "dailyStatsV2.groups[0].legacyResultKeys[2] must match a resultKey selected by its group"));
  assert.ok(errors.includes(
    "dailyStatsV2.groups[1].legacyResultKeys[0] must match a resultKey selected by its group"));
  assert.ok(errors.includes(
    "dailyStatsV2.groups[1].legacyResultKeys[0] must not appear in more than one group"));
});

test("invalid stored dailyStatsV2 is omitted without affecting legacy dailyStats", () => {
  const profiles = [visibleProfile("sample-one", ["sample-ready", "sample-review"])];
  const source = {
    settings: {
      dailyStats: validDailyStats(),
      dailyStatsV2: {
        version: 2,
        scope: "all_profiles",
        groups: [statsV2Item("bad", "Bad", "#2563EB", [
          selector("sample-one", "missing")
        ])],
        flatSummaries: []
      }
    },
    profiles
  };
  const served = clientCatalog(source);
  assert.deepEqual(served.settings.dailyStats, source.settings.dailyStats);
  assert.equal("dailyStatsV2" in served.settings, false);
  assert.equal(source.settings.dailyStatsV2.groups[0].selectors[0].resultKey, "missing");
});

test("public sample catalog dailyStats is fictional and closes over its visible profiles", () => {
  const seed = JSON.parse(readFileSync(
    new URL("../../app/assets/form-profiles.seed.json", import.meta.url), "utf8"));
  assert.deepEqual(validateDailyStats(seed.settings.dailyStats, seed.profiles), []);
  assert.ok(seed.settings.dailyStats.groups.every((item) =>
    item.id.startsWith("sample-") && item.resultKeys.every((key) => key.startsWith("sample-"))));
});

test("dailyStats rejects unknown structure, invalid bounds, duplicate identity and bad colors", () => {
  const profiles = [visibleProfile("sample-one", ["sample-ready", "sample-review"])];
  const tooManyGroups = Array.from({ length: DAILY_STATS_MAX_GROUPS + 1 }, (_, index) =>
    group(`sample-${index}`, `Sample ${index}`, "#2563EB", [
      index === 0 ? "sample-ready" : `missing-${index}`
    ]));
  const errors = validateDailyStats({
    scope: "current_profile",
    groups: [
      group(" sample ", "", "2563EB", [], {
        labelI18n: { fr: "Exemple", en: " Example " },
        unsupported: true
      }),
      group("sample", "x".repeat(161), "#GGGGGG", ["sample-ready"])
    ],
    unsupported: true
  }, profiles);
  assert.ok(errors.includes("dailyStats.unsupported is unsupported"));
  assert.ok(errors.includes("dailyStats.scope must equal all_profiles"));
  assert.ok(errors.includes("dailyStats.groups[0].unsupported is unsupported"));
  assert.ok(errors.includes("dailyStats.groups[0].id must not have surrounding whitespace"));
  assert.ok(errors.includes("dailyStats.groups[0].label must be a non-empty string"));
  assert.ok(errors.includes("dailyStats.groups[0].labelI18n.fr is unsupported"));
  assert.ok(errors.includes("dailyStats.groups[0].labelI18n.en must not have surrounding whitespace"));
  assert.ok(errors.includes("dailyStats.groups[0].uiColor must be a six-digit #RRGGBB color"));
  assert.ok(errors.includes("dailyStats.groups[0].resultKeys must not be empty"));
  assert.ok(errors.includes("dailyStats.groups[1].id must be unique"));
  assert.ok(errors.includes("dailyStats.groups[1].label must contain at most 160 characters"));
  assert.ok(validateDailyStats({ scope: "all_profiles", groups: tooManyGroups }, profiles)
    .includes("dailyStats.groups must contain at most 16 items"));
});

test("dailyStats result keys are exact, unique and declared by pickerVisible profiles", () => {
  const profiles = [
    visibleProfile("sample-visible", ["sample-ready"]),
    { ...visibleProfile("sample-hidden", ["sample-hidden-only"]), pickerVisible: false }
  ];
  const errors = validateDailyStats({
    scope: "all_profiles",
    groups: [
      group("sample-one", "Sample one", "#2563EB",
        ["sample-ready", "sample-ready", " sample-review "]),
      group("sample-two", "Sample two", "#7C3AED",
        ["sample-ready", "sample-hidden-only"])
    ]
  }, profiles);
  assert.ok(errors.includes(
    "dailyStats.groups[0].resultKeys[1] must be unique within its group"));
  assert.ok(errors.includes(
    "dailyStats.groups[0].resultKeys[2] must not have surrounding whitespace"));
  assert.ok(errors.includes(
    "dailyStats.groups[0].resultKeys[2] must be declared by at least one pickerVisible profile gradeMap"));
  assert.ok(errors.includes(
    "dailyStats.groups[1].resultKeys[0] must not appear in more than one group"));
  assert.ok(errors.includes(
    "dailyStats.groups[1].resultKeys[1] must be declared by at least one pickerVisible profile gradeMap"));
});

test("invalid stored dailyStats is omitted from the App client catalog", () => {
  const source = {
    settings: {
      brand: "Sample",
      dailyStats: {
        scope: "all_profiles",
        groups: [group("sample", "Sample", "#2563EB", ["not-declared"])]
      }
    },
    profiles: [visibleProfile("sample-visible", ["sample-ready"])]
  };
  const served = clientCatalog(source);
  assert.equal("dailyStats" in served.settings, false);
  assert.equal(source.settings.dailyStats.groups[0].resultKeys[0], "not-declared");
});

test("Panel structured global editor wires dailyStats groups into the settings save", () => {
  const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  assert.match(html, /id="dailyStatsGroups"/u);
  assert.match(html, /id="addDailyStatsGroupBtn"/u);
  assert.match(html, /id="saveDailyStatsBtn"/u);
  assert.match(html, /function buildDailyStats\(\)/u);
  assert.match(html, /scope:"all_profiles",groups/u);
  assert.match(html, /body:\{[^}]*dailyStats/u);
});

test("Panel structured global editor wires exact groups and flat summaries into both v2 saves", () => {
  const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  assert.match(html, /id="dailyStatsV2Groups"/u);
  assert.match(html, /id="dailyStatsV2FlatSummaries"/u);
  assert.match(html, /id="addDailyStatsV2GroupBtn"/u);
  assert.match(html, /id="addDailyStatsV2FlatBtn"/u);
  assert.match(html, /id="saveDailyStatsV2Btn"/u);
  assert.match(html, /function buildDailyStatsV2\(alternateOnlyFlatIds=new Set\(\)\)/u);
  assert.match(html, /version:2,[\s\S]*scope:"all_profiles",[\s\S]*flatSummaries:/u);
  assert.match(html,
    /body:\{baseVersion:CATALOG_VERSION,dailyStatsV2,dailyStatsAlternateEntries\}/u);
  assert.match(html,
    /body:\{ baseVersion:CATALOG_VERSION,[^}]*dailyStats, dailyStatsV2, dailyStatsAlternateEntries,/u);
  assert.match(html, /applyDailyStatsV2ToLocalSettings\(dailyStatsV2\)/u);
});

test("Panel v2 editor saves independent-entry selectors in a separate supplemental setting", () => {
  const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  assert.match(html, /独立录入入口（可选）/u);
  assert.match(html, /function dailyStatsAlternateEntryAvailableSelectors\(\)/u);
  assert.match(html, /profile\?\.pickerVisible!==true \|\| alternateEntries\?\.enabled!==true/u);
  assert.match(html, /item\.alternateEntrySelectors/u);
  assert.match(html, /function mergeDailyStatsAlternateEntrySelectors\(items,storedItems\)/u);
  assert.match(html, /function buildDailyStatsAlternateEntries\(\)/u);
  assert.match(html,
    /return \{version:1,scope:"all_profiles",groups,flatSummaries\}/u);
  assert.match(html, /return \{profileId,entryId\}/u);
  assert.match(html,
    /applyDailyStatsAlternateEntriesToLocalSettings\(dailyStatsAlternateEntries\)/u);
  assert.match(html,
    /kind==="group"\|\|!alternateOnlyFlatIds\.has\(id\)/u);
  assert.match(html,
    /dailyStatsAlternateEntries=buildDailyStatsAlternateEntries\(\);[\s\S]*dailyStatsV2=buildDailyStatsV2\(alternateOnlyFlatIds\)/u);

  const v2Start = html.indexOf("function buildDailyStatsV2(");
  const v2End = html.indexOf("function mergeDailyStatsAlternateEntrySelectors", v2Start);
  assert.ok(v2Start >= 0 && v2End > v2Start);
  assert.doesNotMatch(html.slice(v2Start, v2End), /alternateEntrySelectors/u);
});

test("profile uiColor accepts only exact six-digit #RRGGBB values", () => {
  const base = {
    id: "sample-profile",
    displayName: "Sample profile",
    searchText: "sample profile"
  };
  assert.deepEqual(validateFormProfile({ ...base, uiColor: "#2563EB" }), []);
  for (const uiColor of ["2563EB", "#123", "#12345678", " #2563EB", 123456]) {
    assert.ok(validateFormProfile({ ...base, uiColor }).includes(
      "uiColor must be a six-digit #RRGGBB color"));
  }
});
