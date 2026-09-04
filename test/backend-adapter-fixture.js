export function validBackendAdapter(overrides = {}) {
  const base = {
    version: 1,
    baseUrl: "https://api.test.invalid/v1",
    endpoints: {
      captcha: "/auth/challenge",
      login: "/auth/session",
      userInfo: "/account/me",
      templateList: "/forms",
      templateDetail: "/forms/detail",
      uploadFile: "/files",
      submitEntry: "/entries",
      detectionData: "/entries/detection-data",
      snRepetition: "/entries/serial-repetition"
    },
    request: {
      bodyEncoding: "json",
      authScheme: "Token",
      fingerprintHeader: "X-Test-Fingerprint",
      webUserAgent: "Example-Test-Client/1.0",
      webAcceptLanguage: "en-US"
    },
    response: {
      codeField: "meta.state",
      dataField: "payload",
      messageFields: ["meta.message"],
      successValues: ["accepted"]
    },
    auth: {
      loginFields: {
        account: "loginName",
        password: "loginSecret",
        captcha: "challengeAnswer",
        client: "challengeKey"
      },
      tokenFields: ["session.value"],
      userNameFields: ["person.label"],
      successFieldsWhenCodeMissing: ["payload", "session.value"],
      dataRootWhenCodeMissing: true,
      sessionProofCodes: [],
      sessionInvalidHttpStatuses: [401],
      sessionInvalidCodes: [],
      sessionInvalidMessagePatterns: []
    },
    pagination: {
      pageParam: "pageIndex",
      pageStart: 0,
      keywordParam: "search"
    },
    operations: {
      upload: { multipartField: "blob", resultPath: "location" },
      ocr: { multipartField: "scan", userInfoUrlFields: ["links.ocr"], resultPaths: ["text"] },
      submit: {
        templateIdField: "formId",
        warehouseIdField: "locationId",
        skuField: "itemCode",
        dataField: "values",
        videoIdField: "mediaId",
        videoIdValue: "",
        materialItemMapping: { codeField: "itemCode", nameField: "itemLabel", quantityField: "amount" },
        retryableMessagePatterns: [],
        missingMaterialMessagePatterns: []
      },
      previousSteps: {
        queryFields: { templateId: "formId", warehouseId: "locationId", sku: "itemCode", serial: "serial" },
        itemsPath: "rows",
        itemDataPath: "values",
        serialPath: "serial",
        missingResponseCodes: [],
        missingMessagePatterns: [],
        retryableMessagePatterns: [],
        alreadyExistsMessagePatterns: [],
        optionValueBuilders: {
          "sample-option-object": {
            type: "object",
            members: {
              code: { type: "present", path: "option.id", fallbackIfMissing: "" },
              label: { type: "firstNonEmpty", paths: ["option.title", "option.englishTitle"] },
              quantity: { type: "integer", path: "option.quantity", default: 1 }
            }
          }
        },
        recipeResolvers: {
          "sample-template-detail-v1": {
            version: 1,
            identity: {
              templateId: { type: "present", path: "template.id", fallbackIfMissing: 0 },
              expectedStep: { type: "present", path: "template.step", fallbackIfMissing: 0 },
              warehouseId: { type: "present", path: "template.warehouseId", fallbackIfMissing: 0 },
              sku: { type: "firstNonEmpty", paths: ["template.sku"] }
            },
            searchTextAttributes: ["title", "englishTitle", "typeName"],
            optionSearchTextAttributes: ["title", "englishTitle", "id"],
            kindSelectors: [
              {
                kind: "sample-serial",
                selector: {
                  allOf: [{ attribute: "type", equalsAny: ["sample-serial"], caseSensitive: true }]
                }
              },
              {
                kind: "sample-photo",
                selector: {
                  allOf: [{ attribute: "type", equalsAny: ["sample-photo"], caseSensitive: true }]
                }
              },
              {
                kind: "sample-choice",
                selector: {
                  allOf: [{ attribute: "type", equalsAny: ["sample-choice"], caseSensitive: true }]
                }
              }
            ],
            rules: [
              {
                selector: {
                  allOf: [{ attribute: "kind", equalsAny: ["sample-serial"], caseSensitive: true }]
                },
                cardinality: "exactly_one",
                action: { type: "serial" }
              },
              {
                selector: {
                  allOf: [{ attribute: "kind", equalsAny: ["sample-photo"], caseSensitive: true }]
                },
                cardinality: "exactly_one",
                action: { type: "photo", source: "sample-evidence", joinWith: "," }
              },
              {
                selector: {
                  allOf: [{ attribute: "kind", equalsAny: ["sample-choice"], caseSensitive: true }]
                },
                cardinality: "first_in_backend_order",
                action: {
                  type: "fixedOption",
                  optionSelectors: [{
                    selector: {
                      allOf: [{
                        attribute: "searchText",
                        containsAny: ["sample accepted"],
                        caseSensitive: false
                      }]
                    },
                    cardinality: "exactly_one"
                  }],
                  valueBuilder: "sample-option-object",
                  onNoMatch: "reject"
                }
              },
              {
                selector: {
                  allOf: [{ attribute: "visible", equalsAny: [false], caseSensitive: true }]
                },
                cardinality: "first_in_backend_order",
                action: { type: "omit", allowRequired: false }
              }
            ]
          }
        }
      },
      duplicateCheck: {
        queryFields: { templateId: "formId", serial: "serial" },
        itemsPath: "rows",
        dateFields: ["createdAt"],
        dateTransforms: [],
        epochUnits: ["seconds", "milliseconds"],
        epochDigitLengths: [],
        numericFractionPolicy: "reject",
        textParseConsumption: "full",
        plausibilityScope: "all",
        timeZoneSource: "configured",
        rootValueEnabled: false,
        dateFormats: ["yyyy-MM-dd'T'HH:mm:ssX"],
        timeZone: "UTC"
      },
      templateDetail: { idParam: "formId" }
    },
    fields: {
      captchaClient: "challenge.key",
      captchaImage: "challenge.image",
      templateList: ["rows"],
      template: {
        id: "formKey",
        name: "displayLabel",
        sku: "itemCode",
        step: "stage",
        warehouseId: "locationKey",
        fieldList: "elements"
      },
      formField: {
        id: "key",
        type: "kind",
        parentType: "parentKind",
        typeName: "kindLabel",
        title: "label",
        englishTitle: "englishLabel",
        required: "mandatory",
        visible: "shown",
        maxCount: "limit",
        options: "choices"
      },
      option: {
        value: "key",
        label: "label",
        englishLabel: "englishLabel",
        quantity: "quantity"
      }
    },
    conversion: {
      fieldKinds: {
        photo: ["image"],
        result: ["outcome"],
        items: ["items"],
        serial: ["serial"],
        scan: ["scanner"],
        number: ["number"],
        singleChoice: ["single-choice"],
        multipleChoice: ["multiple-choice"],
        text: ["text"]
      },
      result: {
        includeUnmapped: true,
        mappings: []
      }
    },
    printing: {
      enabled: false,
      online: { statusPath: "state", values: [] },
      jobsPath: "rows",
      query: { serialParam: "serial", pageParam: "pageIndex", pageStart: 0 },
      fields: { id: "id", serial: "serial", type: "type", status: "state" },
      values: { acceptedTypes: [], printed: [], failed: [], ongoing: [] },
      retryIdField: "id"
    }
  };
  return merge(base, overrides);
}

function merge(base, incoming) {
  const out = structuredClone(base);
  for (const [key, value] of Object.entries(incoming || {})) {
    if (isObject(value) && isObject(out[key])) out[key] = merge(out[key], value);
    else out[key] = structuredClone(value);
  }
  return out;
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
