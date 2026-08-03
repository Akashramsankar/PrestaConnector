const DEFAULT_ADMIN_PATH = "admin";
const DEFAULT_STORE_CODE = "default";
const REQUIRED_STORE_FIELDS = ["base_url", "access_token", "store_name"];
const FRESHDESK_KEY_PLACEHOLDER = "Freshdesk API Key";
const FRESHDESK_FIELD_DEFAULTS_KEY = "freshdesk_required_field_defaults";
const FRESHDESK_FIELD_TYPES_KEY = "freshdesk_required_field_types";
const FRESHDESK_TICKET_AUTOFILLED_FIELDS = new Set([
  "description",
  "email",
  "name",
  "priority",
  "requester",
  "requester_id",
  "subject",
  "status",
]);
const FRESHDESK_CONTACT_AUTOFILLED_FIELDS = new Set([
  "description",
  "email",
  "name",
]);

const state = {
  client: null,
  initialized: false,
  initializing: null,
  hydrating: false,
  reconnectingSync: false,
  savedConfigs: {},
  sessionSecrets: {
    freshdeskAuth: "",
  },
  freshdeskVerified: false,
  freshdeskFieldsLoading: false,
  freshdeskFieldsLoaded: false,
  freshdeskFieldsLoadFailed: false,
  freshdeskRequiredFields: {
    ticket: [],
    contact: [],
  },
  freshdeskFieldDefaults: {
    ticket: {},
    contact: {},
  },
  stores: [],
  nextStoreId: 1,
};

const refs = {};

document.addEventListener("DOMContentLoaded", () => {
  void ensureInitialized();
});

function ensureInitialized() {
  if (!state.initializing) {
    state.initializing = initialize();
  }
  return state.initializing;
}

async function initialize() {
  state.client = await app.initialized();
  bindRefs();
  bindEvents();
  updateSyncActionState();
  state.initialized = true;
  await hydrateFromConfigs(state.savedConfigs);
}

function bindRefs() {
  refs.domain = document.getElementById("domain");
  refs.apiKey = document.getElementById("apiKey");
  refs.verifyFreshdeskBtn = document.getElementById("verifyFreshdeskBtn");
  refs.freshdeskStatusLine = document.getElementById("freshdeskStatusLine");
  refs.freshdeskMessage = document.getElementById("freshdeskMessage");
  refs.freshdeskRequiredFieldsSection = document.getElementById("freshdeskRequiredFieldsSection");
  refs.loadFreshdeskFieldsBtn = document.getElementById("loadFreshdeskFieldsBtn");
  refs.freshdeskFieldsStatusLine = document.getElementById("freshdeskFieldsStatusLine");
  refs.freshdeskFieldsMessage = document.getElementById("freshdeskFieldsMessage");
  refs.freshdeskRequiredFieldsContainer = document.getElementById("freshdeskRequiredFieldsContainer");
  refs.storesContainer = document.getElementById("storesContainer");
  refs.addStoreBtn = document.getElementById("addStoreBtn");
  refs.reconnectSyncBtn = document.getElementById("reconnectSyncBtn");
  refs.syncMessage = document.getElementById("syncMessage");
  refs.syncContactOnCustomerCreated = document.getElementById("syncContactOnCustomerCreated");
  refs.syncContactOnCustomerUpdated = document.getElementById("syncContactOnCustomerUpdated");
  refs.syncTicketOnCustomerCreated = document.getElementById("syncTicketOnCustomerCreated");
  refs.syncTicketOnOrderCreated = document.getElementById("syncTicketOnOrderCreated");
  refs.showOrderDataInOrderTab = document.getElementById("showOrderDataInOrderTab");
  refs.displayNotFoundOnlyWhenAllStoresEmpty = document.getElementById("displayNotFoundOnlyWhenAllStoresEmpty");
  refs.allowAgentCancelOrders = document.getElementById("allowAgentCancelOrders");
  refs.allowAgentUpdateShippingAddress = document.getElementById("allowAgentUpdateShippingAddress");
}

function bindEvents() {
  refs.verifyFreshdeskBtn.addEventListener("click", () => {
    void verifyFreshdeskCredentials();
  });
  refs.addStoreBtn.addEventListener("click", () => {
    addStore(createEmptyStore());
  });
  refs.reconnectSyncBtn.addEventListener("click", () => {
    void reconnectSync();
  });
  refs.domain.addEventListener("input", resetFreshdeskConnection);
  refs.apiKey.addEventListener("input", resetFreshdeskConnection);
  refs.loadFreshdeskFieldsBtn.addEventListener("click", () => {
    void loadFreshdeskRequiredFields();
  });
  refs.freshdeskRequiredFieldsContainer.addEventListener("input", handleFreshdeskFieldDefaultInput);
  refs.freshdeskRequiredFieldsContainer.addEventListener("change", handleFreshdeskFieldDefaultInput);
  refs.storesContainer.addEventListener("input", handleStoreInput);
  refs.storesContainer.addEventListener("click", handleStoreActions);
}

async function hydrateFromConfigs(configs) {
  if (!state.initialized || state.hydrating) {
    return;
  }

  state.hydrating = true;

  try {
    const safeConfigs = configs || {};
    const enableDefaults = !hasSavedAppConfig(safeConfigs);
    refs.domain.value = safeConfigs.domain || "";
    refs.apiKey.value = hasSavedFreshdeskConnection(safeConfigs) ? getMaskedSecretPlaceholder() : "";
    refs.apiKey.setAttribute("placeholder", FRESHDESK_KEY_PLACEHOLDER);
    refs.syncContactOnCustomerCreated.checked = getBooleanConfig(safeConfigs, "sync_contact_on_customer_created", enableDefaults);
    refs.syncContactOnCustomerUpdated.checked = getBooleanConfig(safeConfigs, "sync_contact_on_customer_updated", enableDefaults);
    refs.syncTicketOnCustomerCreated.checked = getBooleanConfig(safeConfigs, "sync_ticket_on_customer_created", enableDefaults);
    refs.syncTicketOnOrderCreated.checked = getBooleanConfig(safeConfigs, "sync_ticket_on_order_created", enableDefaults);
    refs.showOrderDataInOrderTab.checked = getBooleanConfig(safeConfigs, "show_order_data_in_order_tab", true);
    refs.displayNotFoundOnlyWhenAllStoresEmpty.checked = getBooleanConfig(safeConfigs, "display_not_found_only_when_all_stores_empty", enableDefaults);
    refs.allowAgentCancelOrders.checked = getBooleanConfig(safeConfigs, "allow_agent_cancel_orders", enableDefaults);
    refs.allowAgentUpdateShippingAddress.checked = getBooleanConfig(safeConfigs, "allow_agent_update_shipping_address", enableDefaults);

    state.sessionSecrets.freshdeskAuth = safeConfigs.api_key || "";
    state.freshdeskVerified = Boolean(safeConfigs.freshdesk_verified || hasSavedFreshdeskConnection(safeConfigs));
    state.freshdeskFieldsLoaded = false;
    state.freshdeskFieldsLoadFailed = false;
    state.freshdeskRequiredFields = {
      ticket: [],
      contact: [],
    };
    state.freshdeskFieldDefaults = normalizeFreshdeskFieldDefaults(safeConfigs[FRESHDESK_FIELD_DEFAULTS_KEY]);
    state.stores = normalizeSavedStores(safeConfigs.prestashop_stores || safeConfigs.prestashop_store_summaries);
    state.nextStoreId = state.stores.reduce((maxValue, store) => Math.max(maxValue, store.id), 0) + 1;

    if (!state.stores.length) {
      state.stores = [createEmptyStore()];
      state.nextStoreId = state.stores[0].id + 1;
    }

    updateFreshdeskStatus();
    renderFreshdeskRequiredFields();
    renderStores();
    if (state.freshdeskVerified && getActiveFreshdeskAuth()) {
      void loadFreshdeskRequiredFields();
    }
  } finally {
    state.hydrating = false;
  }
}

function normalizeSavedStores(rawStores) {
  const parsedStores = safeParseJson(rawStores, rawStores);
  if (!Array.isArray(parsedStores)) {
    return [];
  }

  return parsedStores.map((store, index) => normalizeStoreRecord(store, index + 1)).filter(Boolean);
}

function normalizeStoreRecord(store, fallbackId) {
  if (!store || typeof store !== "object") {
    return null;
  }

  const normalizedStore = {
    id: Number(store.id) || fallbackId,
    base_url: normalizeStoreBaseUrl(store.base_url || store.baseUrl || ""),
    subdomain: normalizeStorePathFragment(store.subdomain || store.path || ""),
    store_code: normalizeStoreCode(store.store_code || store.storeCode || DEFAULT_STORE_CODE),
    access_token: String(store.access_token || store.accessToken || "").trim(),
    api_mode: String(store.api_mode || store.apiMode || "").trim(),
    store_name: String(store.store_name || store.storeName || "").trim(),
    custom_admin_path: normalizeAdminPath(store.custom_admin_path || store.customAdminPath || DEFAULT_ADMIN_PATH),
    verified: Boolean(
      store.verified ||
        (store.base_url || store.baseUrl) &&
          (store.access_token || store.accessToken) &&
          (store.store_name || store.storeName)
    ),
    messageType: "",
    messageText: "",
  };

  return normalizedStore;
}

function createEmptyStore() {
  const id = state.nextStoreId++;
  return {
    id,
    base_url: "",
    subdomain: "",
    store_code: DEFAULT_STORE_CODE,
    access_token: "",
    api_mode: "",
    store_name: "",
    custom_admin_path: DEFAULT_ADMIN_PATH,
    verified: false,
    messageType: "",
    messageText: "",
  };
}

function addStore(store) {
  state.stores.push(store);
  renderStores();
}

function removeStore(storeId) {
  if (state.stores.length <= 1) {
    return;
  }

  state.stores = state.stores.filter((store) => store.id !== storeId);
  renderStores();
}

function handleStoreInput(event) {
  const target = event.target;
  if (!target || !target.dataset) {
    return;
  }

  const storeId = Number(target.dataset.storeId);
  const field = target.dataset.field;
  if (!storeId || !field) {
    return;
  }

  const store = findStore(storeId);
  if (!store) {
    return;
  }

  store[field] = target.value;

  if (field === "base_url") {
    store.base_url = normalizeStoreBaseUrl(store.base_url);
  }

  if (field === "subdomain") {
    store.subdomain = normalizeStorePathFragment(store.subdomain);
  }

  if (field === "store_code") {
    store.store_code = normalizeStoreCode(store.store_code || "");
  }

  if (field === "custom_admin_path") {
    store.custom_admin_path = normalizeAdminPath(store.custom_admin_path || "");
  }

  if (REQUIRED_STORE_FIELDS.includes(field) || field === "subdomain" || field === "custom_admin_path") {
    const shouldRerender = store.verified || Boolean(store.messageText);
    store.verified = false;
    clearStoreMessage(store);
    if (shouldRerender) {
      renderStores();
    }
  }
}

function handleStoreActions(event) {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }

  const verifyButton = target.closest("[data-action='verify-store']");
  if (verifyButton) {
    const storeId = Number(verifyButton.dataset.storeId);
    if (storeId) {
      void validateStore(storeId);
    }
    return;
  }

  const removeButton = target.closest("[data-action='remove-store']");
  if (removeButton) {
    const storeId = Number(removeButton.dataset.storeId);
    if (storeId) {
      removeStore(storeId);
    }
  }
}

function findStore(storeId) {
  return state.stores.find((store) => store.id === storeId) || null;
}

function renderStores() {
  refs.storesContainer.innerHTML = state.stores
    .map((store, index) => renderStoreCard(store, index))
    .join("");
}

function renderStoreCard(store, index) {
  const messageClass = store.messageType ? `message ${store.messageType}` : "message";
  const messageText = store.messageText ? escapeHtml(store.messageText) : "";
  const statusText = store.verified ? "Verified" : "Not verified";
  const removeButton = state.stores.length > 1
    ? `<button type="button" class="button button-danger" data-action="remove-store" data-store-id="${store.id}">Remove Store</button>`
    : "";

  return `
    <div class="store-card">
      <div class="store-card-header">
        <h3 class="store-card-title">Store ${index + 1}</h3>
        ${removeButton}
      </div>
      <div class="field-grid">
        <div class="field">
          <label for="store-base-url-${store.id}">Base URL *</label>
          <input
            id="store-base-url-${store.id}"
            type="text"
            data-store-id="${store.id}"
            data-field="base_url"
            value="${escapeAttribute(store.base_url)}"
            placeholder="example.com" />
        </div>
        <div class="field">
          <label for="store-subdomain-${store.id}">Store Path</label>
          <input
            id="store-subdomain-${store.id}"
            type="text"
            data-store-id="${store.id}"
            data-field="subdomain"
            value="${escapeAttribute(store.subdomain)}"
            placeholder="shop" />
          <div class="helper-text">Optional path segment, for example host.name/shop.</div>
        </div>
        <div class="field">
          <label for="store-code-${store.id}">Shop ID</label>
          <input
            id="store-code-${store.id}"
            type="text"
            data-store-id="${store.id}"
            data-field="store_code"
            value="${escapeAttribute(store.store_code || DEFAULT_STORE_CODE)}"
            placeholder="${DEFAULT_STORE_CODE}" />
          <div class="helper-text">Use default unless this PrestaShop multishop needs a specific id_shop.</div>
        </div>
        <div class="field">
          <label for="store-access-token-${store.id}">PrestaShop API Key *</label>
          <input
            id="store-access-token-${store.id}"
            type="password"
            data-store-id="${store.id}"
            data-field="access_token"
            value="${escapeAttribute(store.access_token)}"
            placeholder="Module token or webservice key" />
        </div>
      </div>
      <div class="field-grid two-column" style="margin-top: 16px;">
        <div class="field">
          <label for="store-name-${store.id}">Store Name *</label>
          <input
            id="store-name-${store.id}"
            type="text"
            data-store-id="${store.id}"
            data-field="store_name"
            value="${escapeAttribute(store.store_name)}"
            placeholder="Store Name" />
        </div>
        <div class="field">
          <label for="store-admin-path-${store.id}">Custom Admin Path</label>
          <input
            id="store-admin-path-${store.id}"
            type="text"
            data-store-id="${store.id}"
            data-field="custom_admin_path"
            value="${escapeAttribute(store.custom_admin_path)}"
            placeholder="${DEFAULT_ADMIN_PATH}" />
          <div class="helper-text">${DEFAULT_ADMIN_PATH} by default. Set it if your PrestaShop admin uses a custom path.</div>
        </div>
      </div>
      <div class="action-row">
        <button type="button" class="button button-primary" data-action="verify-store" data-store-id="${store.id}">Validate Store</button>
        <span class="status-line">${statusText}</span>
      </div>
      <div class="${messageClass}">${messageText}</div>
    </div>
  `;
}

function handleFreshdeskFieldDefaultInput(event) {
  const target = event.target;
  if (!target || !target.dataset) {
    return;
  }

  const category = target.dataset.freshdeskFieldCategory;
  const fieldName = target.dataset.freshdeskFieldName;
  if (!category || !fieldName || !state.freshdeskFieldDefaults[category]) {
    return;
  }

  state.freshdeskFieldDefaults[category][fieldName] = target.type === "checkbox"
    ? String(Boolean(target.checked))
    : target.value;
  clearMessage(refs.freshdeskFieldsMessage);
}

async function loadFreshdeskRequiredFields() {
  await ensureInitialized();

  const domain = normalizeFreshdeskDomain(refs.domain.value);
  const encodedAuth = getActiveFreshdeskAuth();
  clearMessage(refs.freshdeskFieldsMessage);

  if (!domain) {
    showMessage(refs.freshdeskFieldsMessage, "Enter your Freshdesk domain before loading required fields.", "error");
    state.freshdeskFieldsLoadFailed = true;
    renderFreshdeskRequiredFields();
    return false;
  }

  if (!encodedAuth) {
    showMessage(refs.freshdeskFieldsMessage, "Enter your Freshdesk API key before loading required fields.", "error");
    state.freshdeskFieldsLoadFailed = true;
    renderFreshdeskRequiredFields();
    return false;
  }

  state.freshdeskFieldsLoading = true;
  state.freshdeskFieldsLoadFailed = false;
  renderFreshdeskRequiredFields();

  try {
    const ticketFields = await fetchFreshdeskFields(domain, encodedAuth, "/api/v2/ticket_fields");
    const contactFields = await fetchFreshdeskFields(domain, encodedAuth, "/api/v2/contact_fields");

    state.freshdeskRequiredFields = {
      ticket: normalizeRequiredFreshdeskFields(ticketFields, "ticket"),
      contact: normalizeRequiredFreshdeskFields(contactFields, "contact"),
    };
    state.freshdeskFieldsLoaded = true;
    state.freshdeskFieldsLoadFailed = false;
    showMessage(
      refs.freshdeskFieldsMessage,
      getFreshdeskRequiredFieldCount() ? "Required fields loaded. Add defaults before saving." : "No extra required Freshdesk fields found.",
      "success"
    );
    renderFreshdeskRequiredFields();
    return true;
  } catch (error) {
    state.freshdeskFieldsLoaded = false;
    state.freshdeskFieldsLoadFailed = true;
    console.error("Failed to load Freshdesk required fields:", error);
    showMessage(
      refs.freshdeskFieldsMessage,
      resolveErrorMessage(error, "Could not load Freshdesk required fields. Please verify credentials and try again."),
      "error"
    );
    return false;
  } finally {
    state.freshdeskFieldsLoading = false;
    renderFreshdeskRequiredFields();
  }
}

async function fetchFreshdeskFields(domain, encodedAuth, requestPath) {
  const response = await state.client.request.invokeTemplate("freshdesk_get_live", {
    context: {
      domain,
      encoded_auth: encodedAuth,
      request_path: requestPath,
    },
  });

  if (Number(response.status) < 200 || Number(response.status) >= 300) {
    const payload = safeParseJson(response.response, {});
    throw new Error(
      normalizeText(payload && (payload.message || payload.error || payload.code)) ||
        "Could not load Freshdesk field metadata."
    );
  }

  return safeParseJson(response.response, []);
}

function renderFreshdeskRequiredFields() {
  if (!refs.freshdeskRequiredFieldsContainer) {
    return;
  }

  const requiredFieldCount = getFreshdeskRequiredFieldCount();
  const shouldShowSection = state.freshdeskFieldsLoading ||
    state.freshdeskFieldsLoadFailed ||
    (state.freshdeskFieldsLoaded && requiredFieldCount > 0);

  refs.freshdeskRequiredFieldsSection.classList.toggle("is-hidden", !shouldShowSection);
  refs.loadFreshdeskFieldsBtn.disabled = state.freshdeskFieldsLoading;
  refs.loadFreshdeskFieldsBtn.classList.toggle("is-hidden", !state.freshdeskFieldsLoadFailed);
  refs.freshdeskFieldsStatusLine.textContent = getFreshdeskFieldsStatusText();

  if (state.freshdeskFieldsLoading || !state.freshdeskFieldsLoaded) {
    refs.freshdeskRequiredFieldsContainer.innerHTML = "";
    return;
  }

  const sections = [
    renderFreshdeskFieldDefaultCard("ticket", "Ticket defaults"),
    renderFreshdeskFieldDefaultCard("contact", "Contact defaults"),
  ].filter(Boolean);

  refs.freshdeskRequiredFieldsContainer.innerHTML = sections.join("");
}

function renderFreshdeskFieldDefaultCard(category, title) {
  const fields = state.freshdeskRequiredFields[category] || [];
  if (!fields.length) {
    return "";
  }

  return `
    <div class="field-card">
      <h3 class="field-card-title">${escapeHtml(title)}</h3>
      <div class="field-default-grid">
        ${fields.map((field) => renderFreshdeskFieldDefaultInput(category, field)).join("")}
      </div>
    </div>
  `;
}

function renderFreshdeskFieldDefaultInput(category, field) {
  const fieldName = field.apiName;
  const inputId = `freshdesk-${category}-${fieldName}`;
  const value = getFreshdeskFieldDefault(category, fieldName);
  const helper = field.requiredLabel ? `<div class="helper-text">${escapeHtml(field.requiredLabel)}</div>` : "";

  return `
    <div class="field">
      <label for="${escapeAttribute(inputId)}">${escapeHtml(field.label)} *</label>
      ${renderFreshdeskFieldControl(category, field, inputId, value)}
      ${helper}
    </div>
  `;
}

function renderFreshdeskFieldControl(category, field, inputId, value) {
  const fieldName = field.apiName;
  const dataAttributes = `data-freshdesk-field-category="${escapeAttribute(category)}" data-freshdesk-field-name="${escapeAttribute(fieldName)}"`;

  if (field.choices.length) {
    const options = [
      `<option value="">Select ${escapeHtml(field.label)}</option>`,
      ...field.choices.map((choice) => {
        const selected = String(choice.value) === String(value) ? " selected" : "";
        return `<option value="${escapeAttribute(choice.value)}"${selected}>${escapeHtml(choice.label)}</option>`;
      }),
    ].join("");
    return `<select id="${escapeAttribute(inputId)}" ${dataAttributes}>${options}</select>`;
  }

  if (isBooleanFreshdeskField(field)) {
    return `
      <select id="${escapeAttribute(inputId)}" ${dataAttributes}>
        <option value="">Select ${escapeHtml(field.label)}</option>
        <option value="true"${String(value) === "true" ? " selected" : ""}>Yes</option>
        <option value="false"${String(value) === "false" ? " selected" : ""}>No</option>
      </select>
    `;
  }

  if (isDateTimeFreshdeskField(field)) {
    return `<input id="${escapeAttribute(inputId)}" type="datetime-local" value="${escapeAttribute(normalizeDateTimeLocalInputValue(value))}" ${dataAttributes} />`;
  }

  if (isDateFreshdeskField(field)) {
    return `<input id="${escapeAttribute(inputId)}" type="date" value="${escapeAttribute(normalizeDateInputValue(value))}" ${dataAttributes} />`;
  }

  if (isNumberFreshdeskField(field)) {
    return `<input id="${escapeAttribute(inputId)}" type="number" value="${escapeAttribute(value)}" ${dataAttributes} />`;
  }

  if (isEmailFreshdeskField(field)) {
    return `<input id="${escapeAttribute(inputId)}" type="email" value="${escapeAttribute(value)}" ${dataAttributes} />`;
  }

  if (isUrlFreshdeskField(field)) {
    return `<input id="${escapeAttribute(inputId)}" type="url" value="${escapeAttribute(value)}" ${dataAttributes} />`;
  }

  if (isTextareaFreshdeskField(field)) {
    return `<textarea id="${escapeAttribute(inputId)}" ${dataAttributes}>${escapeHtml(value)}</textarea>`;
  }

  return `<input id="${escapeAttribute(inputId)}" type="text" value="${escapeAttribute(value)}" ${dataAttributes} />`;
}

function normalizeRequiredFreshdeskFields(fields, category) {
  const autofilledFields = category === "contact" ? FRESHDESK_CONTACT_AUTOFILLED_FIELDS : FRESHDESK_TICKET_AUTOFILLED_FIELDS;
  return (Array.isArray(fields) ? fields : [])
    .map((field) => normalizeFreshdeskField(field, category))
    .filter((field) => field && !autofilledFields.has(field.apiName) && shouldShowFreshdeskRequiredField(field, category));
}

function normalizeFreshdeskField(field, category) {
  if (!field || typeof field !== "object" || !isFreshdeskFieldRequired(field)) {
    return null;
  }

  const rawName = normalizeText(field.name || field.field_name || field.key);
  const apiName = getFreshdeskApiFieldName(rawName, category);
  if (!apiName) {
    return null;
  }

  return {
    apiName,
    label: normalizeText(field.label_for_agents || field.label || field.name || apiName),
    type: normalizeText(field.type || field.field_type || field.custom_field_type || field.fieldType),
    requiredForAgents: Boolean(field.required || field.required_for_agents),
    requiredForCustomers: Boolean(field.required_for_customers),
    requiredLabel: getFreshdeskRequiredLabel(field),
    choices: normalizeFreshdeskFieldChoices(field.choices),
  };
}

function getFreshdeskApiFieldName(fieldName, category) {
  const normalizedName = normalizeText(fieldName);
  if (!normalizedName) {
    return "";
  }

  if (category !== "ticket") {
    return normalizedName === "company" ? "company_id" : normalizedName;
  }

  const ticketFieldMap = {
    agent: "responder_id",
    company: "company_id",
    group: "group_id",
    product: "product_id",
    requester: "requester_id",
  };

  return ticketFieldMap[normalizedName] || normalizedName;
}

function shouldShowFreshdeskRequiredField(field, category) {
  if (!isFreshdeskCustomField(field.apiName)) {
    return false;
  }

  if (category === "ticket") {
    return field.requiredForAgents && !field.requiredForCustomers;
  }

  return true;
}

function isFreshdeskCustomField(fieldName) {
  return normalizeText(fieldName).toLowerCase().startsWith("cf_");
}

function isFreshdeskFieldRequired(field) {
  return Boolean(
    field.required ||
      field.required_for_agents ||
      field.required_for_customers ||
      field.required_for_closure
  );
}

function getFreshdeskRequiredLabel(field) {
  const requiredFor = [];
  if (field.required || field.required_for_agents) {
    requiredFor.push("agents");
  }
  if (field.required_for_customers) {
    requiredFor.push("customers");
  }
  if (field.required_for_closure) {
    requiredFor.push("ticket closure");
  }
  return requiredFor.length ? `Required for ${requiredFor.join(", ")}.` : "";
}

function normalizeFreshdeskFieldChoices(choices) {
  if (!choices) {
    return [];
  }

  if (Array.isArray(choices)) {
    return choices.map(normalizeFreshdeskChoice).filter(Boolean);
  }

  if (typeof choices === "object") {
    return Object.keys(choices).map((key) => {
      const value = choices[key];
      if (value && typeof value === "object") {
        return normalizeFreshdeskChoice({
          label: key,
          ...value,
        });
      }
      return normalizeFreshdeskChoice({
        label: key,
        value,
      });
    }).filter(Boolean);
  }

  return [];
}

function normalizeFreshdeskChoice(choice) {
  if (choice === null || choice === undefined) {
    return null;
  }

  if (typeof choice !== "object") {
    const value = normalizeText(choice);
    return value ? { label: value, value } : null;
  }

  const value = normalizeText(choice.value || choice.id || choice.name || choice.label);
  if (!value) {
    return null;
  }

  return {
    label: normalizeText(choice.label || choice.name || choice.value || choice.id),
    value,
  };
}

function isBooleanFreshdeskField(field) {
  return /checkbox|boolean/i.test(field.type || "");
}

function isDateTimeFreshdeskField(field) {
  return /date[_-]?time|datetime|timestamp/i.test(field.type || "");
}

function isDateFreshdeskField(field) {
  return !isDateTimeFreshdeskField(field) && /(^|[_-])date($|[_-])|custom_date/i.test(field.type || "");
}

function isNumberFreshdeskField(field) {
  return /number|decimal|integer|numeric/i.test(field.type || "");
}

function isEmailFreshdeskField(field) {
  return /email/i.test(field.type || "");
}

function isUrlFreshdeskField(field) {
  return /url|website|link/i.test(field.type || "");
}

function isTextareaFreshdeskField(field) {
  return /paragraph|textarea|description|multiline/i.test(field.type || "");
}

function normalizeDateInputValue(value) {
  const normalizedValue = normalizeText(value);
  const dateMatch = /^(\d{4}-\d{2}-\d{2})/.exec(normalizedValue);
  if (dateMatch) {
    return dateMatch[1];
  }

  const date = new Date(normalizedValue);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toISOString().slice(0, 10);
}

function normalizeDateTimeLocalInputValue(value) {
  const normalizedValue = normalizeText(value);
  const dateTimeMatch = /^(\d{4}-\d{2}-\d{2})[T\s](\d{2}:\d{2})/.exec(normalizedValue);
  if (dateTimeMatch) {
    return `${dateTimeMatch[1]}T${dateTimeMatch[2]}`;
  }

  const date = new Date(normalizedValue);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toISOString().slice(0, 16);
}

function getFreshdeskFieldsStatusText() {
  if (state.freshdeskFieldsLoading) {
    return "Checking required fields...";
  }
  if (state.freshdeskFieldsLoadFailed) {
    return "Could not check required fields";
  }
  if (!state.freshdeskFieldsLoaded) {
    return "Not checked";
  }

  const count = getFreshdeskRequiredFieldCount();
  return count ? `${count} required field${count === 1 ? "" : "s"} need defaults` : "No extra required fields";
}

function getFreshdeskRequiredFieldCount() {
  return (state.freshdeskRequiredFields.ticket || []).length + (state.freshdeskRequiredFields.contact || []).length;
}

function getFreshdeskFieldDefault(category, fieldName) {
  return normalizeText(
    state.freshdeskFieldDefaults &&
      state.freshdeskFieldDefaults[category] &&
      state.freshdeskFieldDefaults[category][fieldName]
  );
}

function normalizeFreshdeskFieldDefaults(rawDefaults) {
  const parsedDefaults = safeParseJson(rawDefaults, rawDefaults) || {};
  return {
    ticket: normalizeFreshdeskFieldDefaultGroup(parsedDefaults.ticket),
    contact: normalizeFreshdeskFieldDefaultGroup(parsedDefaults.contact),
  };
}

function normalizeFreshdeskFieldDefaultGroup(group) {
  if (!group || typeof group !== "object" || Array.isArray(group)) {
    return {};
  }

  return Object.keys(group).reduce((defaults, key) => {
    const value = normalizeText(group[key]);
    if (normalizeText(key) && value) {
      defaults[normalizeText(key)] = value;
    }
    return defaults;
  }, {});
}

function serializeFreshdeskFieldDefaults() {
  return {
    ticket: serializeFreshdeskFieldDefaultsForCategory("ticket"),
    contact: serializeFreshdeskFieldDefaultsForCategory("contact"),
  };
}

function serializeFreshdeskFieldDefaultsForCategory(category) {
  const defaults = normalizeFreshdeskFieldDefaultGroup(state.freshdeskFieldDefaults[category]);
  const allowedFields = new Set((state.freshdeskRequiredFields[category] || []).map((field) => field.apiName));

  return Object.keys(defaults).reduce((filteredDefaults, fieldName) => {
    if (allowedFields.has(fieldName)) {
      filteredDefaults[fieldName] = defaults[fieldName];
    }
    return filteredDefaults;
  }, {});
}

function serializeFreshdeskFieldTypes() {
  return {
    ticket: serializeFreshdeskFieldTypeGroup(state.freshdeskRequiredFields.ticket),
    contact: serializeFreshdeskFieldTypeGroup(state.freshdeskRequiredFields.contact),
  };
}

function serializeFreshdeskFieldTypeGroup(fields) {
  return (Array.isArray(fields) ? fields : []).reduce((types, field) => {
    if (field && field.apiName && field.type) {
      types[field.apiName] = field.type;
    }
    return types;
  }, {});
}

async function validateFreshdeskRequiredFieldDefaults() {
  if (!state.freshdeskVerified) {
    return true;
  }

  if (!getEnabledFreshdeskDefaultCategories().length) {
    return true;
  }

  if (!state.freshdeskFieldsLoaded) {
    const loaded = await loadFreshdeskRequiredFields();
    if (!loaded) {
      return false;
    }
  }

  const missingFields = getMissingFreshdeskDefaultFields();
  if (!missingFields.length) {
    return true;
  }

  showMessage(
    refs.freshdeskFieldsMessage,
    `Add defaults for required Freshdesk fields: ${missingFields.join(", ")}.`,
    "error"
  );
  return false;
}

function getMissingFreshdeskDefaultFields() {
  return getEnabledFreshdeskDefaultCategories().flatMap((category) => {
    return (state.freshdeskRequiredFields[category] || [])
      .filter((field) => !getFreshdeskFieldDefault(category, field.apiName))
      .map((field) => field.label);
  });
}

function getEnabledFreshdeskDefaultCategories() {
  const categories = [];
  if (refs.syncTicketOnCustomerCreated.checked || refs.syncTicketOnOrderCreated.checked) {
    categories.push("ticket");
  }
  if (refs.syncContactOnCustomerCreated.checked || refs.syncContactOnCustomerUpdated.checked) {
    categories.push("contact");
  }
  return categories;
}

function resetFreshdeskConnection() {
  state.freshdeskVerified = false;
  state.sessionSecrets.freshdeskAuth = "";
  state.freshdeskFieldsLoaded = false;
  state.freshdeskFieldsLoadFailed = false;
  state.freshdeskRequiredFields = {
    ticket: [],
    contact: [],
  };
  updateFreshdeskStatus();
  renderFreshdeskRequiredFields();
  clearMessage(refs.freshdeskMessage);
  clearMessage(refs.freshdeskFieldsMessage);
}

function updateFreshdeskStatus() {
  refs.freshdeskStatusLine.textContent = state.freshdeskVerified ? "Verified" : "Not verified";
}

function showMessage(element, message, type) {
  element.textContent = message;
  element.className = `message ${type}`;
}

function clearMessage(element) {
  element.textContent = "";
  element.className = "message";
}

function updateSyncActionState() {
  refs.reconnectSyncBtn.disabled = state.reconnectingSync;
}

function setStoreMessage(store, message, type) {
  store.messageText = message;
  store.messageType = type;
}

function clearStoreMessage(store) {
  store.messageText = "";
  store.messageType = "";
}

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeFreshdeskDomain(value) {
  const cleaned = String(value || "").trim().replace(/^https?:\/\//i, "").replace(/\/+$/, "");
  if (!cleaned) {
    return "";
  }
  return cleaned.includes(".") ? cleaned : `${cleaned}.freshdesk.com`;
}

function normalizeStoreBaseUrl(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function normalizeStorePathFragment(value) {
  return String(value || "").trim().replace(/^\/+/, "").replace(/\/+$/, "");
}

function normalizeAdminPath(value) {
  const cleaned = String(value || "").trim().replace(/^\/+/, "").replace(/\/+$/, "");
  return cleaned || DEFAULT_ADMIN_PATH;
}

function safeParseJson(value, fallback) {
  if (!value) {
    return fallback;
  }

  if (typeof value === "object") {
    return value;
  }

  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function hasSavedAppConfig(configs) {
  return Boolean(configs && Object.keys(configs).some((key) => key !== "__meta"));
}

function getBooleanConfig(configs, key, fallback) {
  if (configs && Object.prototype.hasOwnProperty.call(configs, key)) {
    return Boolean(configs[key]);
  }
  return Boolean(fallback);
}

function hasSavedFreshdeskConnection(configs) {
  return Boolean(configs && normalizeFreshdeskDomain(configs.domain));
}

function getSecureIparamsMask() {
  return String.fromCharCode(42).repeat(24);
}

function getMaskedSecretPlaceholder() {
  return getSecureIparamsMask();
}

function getActiveFreshdeskAuth() {
  const freshdeskKey = String(refs.apiKey.value || "").trim();
  if (freshdeskKey && freshdeskKey !== getMaskedSecretPlaceholder()) {
    return btoa(`${freshdeskKey}:X`);
  }
  // No newly-entered key: fall back to a real stored value only. Never return
  // the placeholder mask — persisting it would overwrite the saved secure
  // Freshdesk API key with junk and 401 every server-side Freshdesk call.
  return state.sessionSecrets.freshdeskAuth || state.savedConfigs.api_key || "";
}

async function verifyFreshdeskCredentials() {
  const domain = normalizeFreshdeskDomain(refs.domain.value);
  const encodedAuth = getActiveFreshdeskAuth();
  clearMessage(refs.freshdeskMessage);

  if (!domain) {
    showMessage(refs.freshdeskMessage, "Enter your Freshdesk domain before verifying.", "error");
    return;
  }

  if (!encodedAuth) {
    showMessage(refs.freshdeskMessage, "Enter a Freshdesk API key before verifying.", "error");
    return;
  }

  try {
    showMessage(refs.freshdeskMessage, "Verifying Freshdesk credentials...", "info");
    const response = await state.client.request.invokeTemplate("verify_freshdesk_credentials", {
      context: {
        domain,
        encoded_auth: encodedAuth,
      },
    });

    if (Number(response.status) !== 200) {
      throw new Error("Freshdesk credentials are not valid.");
    }

    state.freshdeskVerified = true;
    state.sessionSecrets.freshdeskAuth = encodedAuth;
    refs.domain.value = domain;
    updateFreshdeskStatus();
    showMessage(refs.freshdeskMessage, "Freshdesk verified successfully.", "success");
    void loadFreshdeskRequiredFields();
  } catch (error) {
    state.freshdeskVerified = false;
    updateFreshdeskStatus();
    console.error("Failed to verify Freshdesk credentials:", error);
    showMessage(refs.freshdeskMessage, "Could not verify Freshdesk credentials. Please check them and try again.", "error");
  }
}

function hasSavedStoreConfigs() {
  return Boolean(
    state.savedConfigs &&
      (state.savedConfigs.prestashop_stores || state.savedConfigs.prestashop_store_summaries)
  );
}

function storesContainCredentials(stores) {
  return (Array.isArray(stores) ? stores : []).some((store) => (
    String(store && store.access_token || "").trim()
  ));
}

function validateStoresForSecureActions(stores, messageSuffix, options) {
  const allowStoredCredentials = Boolean(options && options.allowStoredCredentials);

  if (!stores.length) {
    return {
      valid: false,
      message: "At least one PrestaShop store is required.",
    };
  }

  for (const store of stores) {
    const matchingStateStore = findStore(store.id);
    const validationError = getStoreValidationError(store, {
      allowStoredCredentials,
    });
    if (validationError) {
      if (matchingStateStore) {
        matchingStateStore.verified = false;
        setStoreMessage(matchingStateStore, validationError, "error");
      }
      renderStores();
      return {
        valid: false,
        message: validationError,
      };
    }

    if (!matchingStateStore || !matchingStateStore.verified) {
      if (matchingStateStore) {
        setStoreMessage(
          matchingStateStore,
          `Please validate this store before ${messageSuffix || "continuing"}.`,
          "error"
        );
      }
      renderStores();
      return {
        valid: false,
        message: `Please validate each store before ${messageSuffix || "continuing"}.`,
      };
    }
  }

  return {
    valid: true,
    message: "",
  };
}

async function persistStoresSecurely(domain, stores) {
  return await invokeServerFunction("persistPrestaShopStoresSecurely", {
    domain,
    prestashop_stores: JSON.stringify(stores),
  });
}

async function reconnectSync() {
  await ensureInitialized();

  if (state.reconnectingSync) {
    return;
  }

  const domain = normalizeFreshdeskDomain(refs.domain.value);
  const stores = serializeStores();
  const storeValidation = validateStoresForSecureActions(stores, "repairing sync", {
    allowStoredCredentials: true,
  });

  clearMessage(refs.syncMessage);

  if (!domain) {
    showMessage(refs.syncMessage, "Freshdesk domain is required before repairing sync.", "error");
    return;
  }

  if (!storeValidation.valid) {
    showMessage(refs.syncMessage, storeValidation.message || "Please validate all stores before repairing sync.", "error");
    return;
  }

  state.reconnectingSync = true;
  updateSyncActionState();

  try {
    showMessage(refs.syncMessage, "Repairing PrestaShop sync...", "info");
    if (storesContainCredentials(stores)) {
      await persistStoresSecurely(domain, stores);
    }

    const response = await invokeServerFunction("reconnectPrestaShopSync", {
      domain,
      app_settings: postConfigs(),
    });
    showMessage(refs.syncMessage, response && response.message ? response.message : "Sync repaired.", "success");
  } catch (error) {
    console.error("Failed to reconnect PrestaShop sync:", error);
    showMessage(
      refs.syncMessage,
      resolveErrorMessage(error, "Unable to repair PrestaShop sync right now."),
      "error"
    );
  } finally {
    state.reconnectingSync = false;
    updateSyncActionState();
  }
}

async function validateStore(storeId) {
  const store = findStore(storeId);
  if (!store) {
    return;
  }

  clearStoreMessage(store);

  const normalizedStore = normalizeStoreForSave(store);
  const validationError = getStoreValidationError(normalizedStore);
  if (validationError) {
    store.verified = false;
    setStoreMessage(store, validationError, "error");
    renderStores();
    return;
  }

  const storeEndpoint = resolveStoreEndpoint(normalizedStore);
  if (!storeEndpoint) {
    store.verified = false;
    setStoreMessage(store, "Enter a valid PrestaShop store URL before verifying.", "error");
    renderStores();
    return;
  }

  try {
    setStoreMessage(store, "Validating store credentials...", "info");
    renderStores();

    let apiMode = "native";
    let response = null;
    try {
      response = await state.client.request.invokeTemplate("verify_prestashop_store_live", {
        context: {
          store_host: storeEndpoint.host,
          request_path: buildPrestaShopModuleApiPath(storeEndpoint.pathPrefix, "/freshworks/ping"),
          authorization: buildPrestaShopAuthorization(normalizedStore.access_token, "extension"),
        },
      });
    } catch {
      response = null;
    }

    if (response && Number(response.status) === 200) {
      apiMode = "extension";
    } else {
      response = await state.client.request.invokeTemplate("verify_prestashop_store_live", {
        context: {
          store_host: storeEndpoint.host,
          request_path: buildPrestaShopApiPath(storeEndpoint.pathPrefix, normalizedStore.store_code, "/orders?display=full&limit=1"),
          authorization: buildPrestaShopAuthorization(normalizedStore.access_token, "native"),
        },
      });

      if (Number(response.status) !== 200) {
        throw new Error("PrestaShop credentials are not valid.");
      }
    }

    Object.assign(store, normalizedStore, {
      api_mode: apiMode,
      verified: true,
      messageType: "success",
      messageText: apiMode === "extension" ? "Store verified successfully with the Freshworks PrestaShop module token." : "Store verified successfully.",
    });
  } catch (error) {
    store.verified = false;
    setStoreMessage(store, "Could not verify the PrestaShop store. Please check the URL, store code, and access token.", "error");
    console.error("Failed to verify PrestaShop store:", storeId, error);
  }

  renderStores();
}

function getStoreValidationError(store, options) {
  const allowStoredCredentials = Boolean(options && options.allowStoredCredentials);

  if (!store.base_url) {
    return "Base URL is required.";
  }

  if (!store.access_token && !allowStoredCredentials) {
    return "Access Token is required.";
  }

  if (!store.store_name) {
    return "Store Name is required.";
  }

  return "";
}

function normalizeStoreCode(value) {
  const cleaned = String(value || "").trim().replace(/^\/+/, "").replace(/\/+$/, "");
  return cleaned || DEFAULT_STORE_CODE;
}

function buildPrestaShopApiPath(pathPrefix, storeCode, apiPath) {
  const path = `${pathPrefix || ""}/api${apiPath || "/"}`.replace(/\/{2,}/g, "/");
  const withJson = appendQueryParam(path, "output_format", "JSON");
  const normalizedStoreCode = normalizeStoreCode(storeCode);
  return normalizedStoreCode !== DEFAULT_STORE_CODE
    ? appendQueryParam(withJson, "id_shop", normalizedStoreCode)
    : withJson;
}

function buildPrestaShopModuleApiPath(pathPrefix, route) {
  return appendQueryParam(
    `${pathPrefix || ""}/module/freshdeskconnector/api`.replace(/\/{2,}/g, "/"),
    "fw_route",
    route || "/"
  );
}

function appendQueryParam(path, key, value) {
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
}

function buildPrestaShopAuthorization(accessToken, apiMode) {
  const token = String(accessToken || "").trim();
  if (apiMode === "extension") {
    return `Bearer ${token}`;
  }
  return `Basic ${btoa(`${token}:`)}`;
}

function resolveStoreEndpoint(store) {
  const rawBaseUrl = normalizeStoreBaseUrl(store.base_url);
  if (!rawBaseUrl) {
    return null;
  }

  try {
    const parsedUrl = new URL(/^https?:\/\//i.test(rawBaseUrl) ? rawBaseUrl : `https://${rawBaseUrl}`);
    const basePath = parsedUrl.pathname && parsedUrl.pathname !== "/" ? parsedUrl.pathname.replace(/\/+$/, "") : "";
    const subdomainPath = normalizeStorePathFragment(store.subdomain);
    const pathPrefix = [basePath, subdomainPath ? `/${subdomainPath}` : ""].join("").replace(/\/{2,}/g, "/");

    return {
      host: parsedUrl.host,
      pathPrefix: pathPrefix === "/" ? "" : pathPrefix,
    };
  } catch {
    return null;
  }
}

function normalizeStoreForSave(store) {
  const normalizedStore = {
    id: store.id,
    base_url: normalizeStoreBaseUrl(store.base_url),
    subdomain: normalizeStorePathFragment(store.subdomain),
    store_code: normalizeStoreCode(store.store_code),
    access_token: String(store.access_token || "").trim(),
    api_mode: String(store.api_mode || "").trim(),
    store_name: String(store.store_name || "").trim(),
    custom_admin_path: normalizeAdminPath(store.custom_admin_path),
    verified: Boolean(store.verified),
  };

  const endpoint = resolveStoreEndpoint(normalizedStore);
  if (endpoint) {
    const basePath = endpoint.pathPrefix && normalizedStore.subdomain
      ? endpoint.pathPrefix.slice(0, endpoint.pathPrefix.length - (`/${normalizedStore.subdomain}`).length)
      : endpoint.pathPrefix;
    normalizedStore.base_url = `${endpoint.host}${basePath || ""}`;
  }

  return normalizedStore;
}

function serializeStores() {
  return state.stores.map((store) => normalizeStoreForSave(store));
}

function serializeStoreSummaries() {
  return serializeStores().map((store) => ({
    id: store.id,
    base_url: store.base_url,
    subdomain: store.subdomain,
    store_code: store.store_code,
    store_name: store.store_name,
    custom_admin_path: store.custom_admin_path,
    api_mode: store.api_mode,
    verified: store.verified,
  }));
}

function postConfigs() {
  const freshdeskAuth = getActiveFreshdeskAuth();
  const storeSummaries = serializeStoreSummaries();

  const config = {
    __meta: {
      secure: ["api_key", "prestashop_stores"],
    },
    domain: normalizeFreshdeskDomain(refs.domain.value),
    freshdesk_verified: state.freshdeskVerified,
    auto_install_webhooks: true,
    [FRESHDESK_FIELD_DEFAULTS_KEY]: JSON.stringify(serializeFreshdeskFieldDefaults()),
    [FRESHDESK_FIELD_TYPES_KEY]: JSON.stringify(serializeFreshdeskFieldTypes()),
    prestashop_stores: JSON.stringify(serializeStores()),
    prestashop_store_summaries: JSON.stringify(storeSummaries),
    sync_contact_on_customer_created: refs.syncContactOnCustomerCreated.checked,
    sync_contact_on_customer_updated: refs.syncContactOnCustomerUpdated.checked,
    sync_ticket_on_customer_created: refs.syncTicketOnCustomerCreated.checked,
    sync_ticket_on_order_created: refs.syncTicketOnOrderCreated.checked,
    show_order_data_in_order_tab: refs.showOrderDataInOrderTab.checked,
    display_not_found_only_when_all_stores_empty: refs.displayNotFoundOnlyWhenAllStoresEmpty.checked,
    allow_agent_refund_orders: false,
    allow_agent_cancel_orders: refs.allowAgentCancelOrders.checked,
    allow_agent_update_shipping_address: refs.allowAgentUpdateShippingAddress.checked,
  };

  // Only persist the API key when the agent actually supplied a real one.
  // Otherwise omit it so the platform keeps the existing stored secure key
  // instead of clobbering it with a blank/placeholder value.
  if (freshdeskAuth && freshdeskAuth !== getSecureIparamsMask()) {
    config.api_key = freshdeskAuth;
  }

  return config;
}

function getConfigs(configs) {
  state.savedConfigs = configs || {};
  if (state.initialized) {
    void hydrateFromConfigs(state.savedConfigs);
  }
}

async function validate() {
  await ensureInitialized();

  const domain = normalizeFreshdeskDomain(refs.domain.value);
  const freshdeskAuth = getActiveFreshdeskAuth();
  const stores = serializeStores();
  const storeValidation = validateStoresForSecureActions(stores, "saving", {
    allowStoredCredentials: hasSavedStoreConfigs(),
  });

  if (!domain) {
    showMessage(refs.freshdeskMessage, "Freshdesk domain is required.", "error");
    return false;
  }

  if (!freshdeskAuth) {
    showMessage(refs.freshdeskMessage, "Freshdesk API key is required.", "error");
    return false;
  }

  if (!state.freshdeskVerified) {
    showMessage(refs.freshdeskMessage, "Please verify the Freshdesk credentials before saving.", "error");
    return false;
  }

  if (!storeValidation.valid) {
    return false;
  }

  if (!(await validateFreshdeskRequiredFieldDefaults())) {
    return false;
  }

  return true;
}

async function invokeServerFunction(name, body) {
  const result = await state.client.request.invoke(name, {
    body,
  });
  const payload = parseInvokeResponse(result);

  if (!payload || payload.success === false) {
    throw new Error(resolveInvokeError(payload) || "Request failed.");
  }

  return payload;
}

function parseInvokeResponse(result) {
  if (!result) {
    return null;
  }
  if (typeof result === "string") {
    try {
      return JSON.parse(result);
    } catch {
      return null;
    }
  }
  if (typeof result.response === "string") {
    try {
      return JSON.parse(result.response);
    } catch {
      return null;
    }
  }
  if (result.response && typeof result.response === "object") {
    return result.response;
  }
  return typeof result === "object" ? result : null;
}

function resolveInvokeError(payload) {
  if (!payload) {
    return "";
  }
  return payload.detail || payload.message || "";
}

function resolveErrorMessage(error, fallback) {
  if (!error) {
    return fallback;
  }
  if (typeof error === "string") {
    return error;
  }
  if (error.message) {
    return error.message;
  }
  return fallback;
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttribute(value) {
  return escapeHtml(value);
}
