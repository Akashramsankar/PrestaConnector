const SECURE_STORE_KEY_PREFIX = "pss:";
const WEBHOOK_REGISTRY_KEY_PREFIX = "psw:";
const CONTACT_LINK_KEY_PREFIX = "pscl:";
const CUSTOMER_TICKET_LINK_KEY_PREFIX = "psct:";
const ORDER_TICKET_LINK_KEY_PREFIX = "psot:";
const WEBHOOK_AUTOINSTALL_SCHEDULE_NAME = "prestashop_webhook_autoinstall";
const APP_BUILD_MARKER = "2026-08-03 prestashop-v1";
const ORDER_TICKET_RETRY_SCHEDULE_PREFIX = "psotr_";
const ORDER_TICKET_RETRY_MAX_ATTEMPTS = 5;
const ORDER_TICKET_RETRY_DELAY_MS = 2 * 60 * 1000;
const FRESHDESK_FIELD_DEFAULTS_KEY = "freshdesk_required_field_defaults";
const FRESHDESK_FIELD_TYPES_KEY = "freshdesk_required_field_types";

const DEFAULT_STORE_CODE = "default";
const DEFAULT_ADMIN_PATH = "admin";
const REFUNDABLE_ORDER_STATUSES = new Set(["processing", "complete", "closed"]);
const SALES_ORDER_STATES = new Set(["processing", "complete", "closed"]);

function parseArgs(args) {
  if (!args) {
    return {};
  }

  let parsedArgs;
  if (typeof args.body === "string") {
    parsedArgs = safeParseJson(args.body, {});
  } else if (args.body && typeof args.body === "object") {
    parsedArgs = args.body;
  } else {
    parsedArgs = args;
  }

  if (args.iparams && typeof args.iparams === "object" && parsedArgs && typeof parsedArgs === "object" && !parsedArgs.iparams) {
    return {
      ...parsedArgs,
      iparams: args.iparams,
    };
  }

  return parsedArgs;
}

function safeParseJson(value, fallback) {
  if (value === undefined || value === null || value === "") {
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

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeBoolean(value, fallback) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  if (typeof value === "boolean") {
    return value;
  }

  const normalized = normalizeText(value).toLowerCase();
  if (normalized === "true") {
    return true;
  }
  if (normalized === "false") {
    return false;
  }

  return fallback;
}

function normalizeNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeDomain(value) {
  return normalizeText(value).replace(/^https?:\/\//i, "").replace(/\/+$/, "");
}

function normalizeStorePath(value) {
  return normalizeText(value).replace(/^\/+/, "").replace(/\/+$/, "");
}

function normalizeStoreCode(value) {
  return normalizeStorePath(value) || DEFAULT_STORE_CODE;
}

function normalizeHeaders(headers) {
  const source = headers && typeof headers === "object" ? headers : {};
  const normalized = {};
  Object.keys(source).forEach((key) => {
    normalized[String(key).toLowerCase()] = source[key];
  });
  return normalized;
}

function normalizeDateString(value) {
  const normalized = normalizeText(value);
  if (!normalized) {
    return "";
  }

  const timestamp = new Date(normalized.replace(" ", "T")).getTime();
  return Number.isNaN(timestamp) ? "" : new Date(timestamp).toISOString();
}

function escapeTicketHtml(value) {
  return normalizeText(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatTicketDateTime(value) {
  const normalized = normalizeDateString(value);
  if (!normalized) {
    return "";
  }

  return new Date(normalized).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function resolveSettings(payload) {
  if (payload && payload.iparams && typeof payload.iparams === "object") {
    return payload.iparams;
  }

  if (payload && payload.app_settings && typeof payload.app_settings === "object") {
    return payload.app_settings;
  }

  return {};
}

function extractErrorMessage(error, fallback) {
  if (!error) {
    return fallback || "Unknown error.";
  }
  if (typeof error === "string") {
    return error;
  }
  if (error.message) {
    return error.message;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return fallback || "Unknown error.";
  }
}

function formatApiErrorDetail(payload) {
  if (!payload || typeof payload !== "object") {
    return "";
  }

  const summary =
    normalizeText(payload.message) ||
    normalizeText(payload.error) ||
    normalizeText(payload.description) ||
    normalizeText(payload.code);
  const errors = Array.isArray(payload.errors) ? payload.errors : [];
  const errorDetails = errors.map((item) => {
    if (!item || typeof item !== "object") {
      return normalizeText(item);
    }

    const field = normalizeText(item.field || item.name || item.attribute);
    const message = normalizeText(item.message || item.error || item.code || item.description);
    const code = normalizeText(item.code);
    const detail = [message, code && code !== message ? `code=${code}` : ""].filter(Boolean).join(" ");
    return [field, detail].filter(Boolean).join(": ");
  }).filter(Boolean);

  if (summary && errorDetails.length) {
    return `${summary}: ${errorDetails.join("; ")}`;
  }
  return summary || (errorDetails.length ? errorDetails.join("; ") : "");
}

function buildSuccess(data) {
  return renderData(null, {
    success: true,
    ...(data || {}),
  });
}

function buildFailure(message, error) {
  return renderData(null, {
    success: false,
    message,
    detail: extractErrorMessage(error, message),
  });
}

async function invokeTemplate(name, context, body) {
  const requestOptions = {
    context: context || {},
  };

  if (body !== undefined) {
    requestOptions.body = JSON.stringify(body);
  }

  let response;
  try {
    response = await $request.invokeTemplate(name, requestOptions);
  } catch (error) {
    const requestError = error && error.status ? error : safeParseJson(error && error.message, null);
    if (requestError && requestError.status) {
      const raw = requestError.response || requestError.raw || "";
      return {
        status: Number(requestError.status) || 0,
        headers: requestError.headers || {},
        data: safeParseJson(raw, raw),
        raw,
      };
    }
    throw error;
  }

  return {
    status: Number(response && response.status) || 0,
    headers: (response && response.headers) || {},
    data: safeParseJson(response && response.response, response && response.response),
    raw: response && response.response,
  };
}

function ensureSuccess(response, fallbackMessage) {
  if (response.status >= 200 && response.status < 300) {
    return response.data;
  }

  const parsed = safeParseJson(response.raw, {});
  const detail =
    formatApiErrorDetail(parsed) ||
    fallbackMessage ||
    "Request failed.";

  const error = new Error(detail);
  error.status = response.status;
  error.body = parsed;
  throw error;
}

function getPrestaShopItems(payload) {
  const normalizedPayload = normalizePrestaShopPayload(payload);
  if (Array.isArray(payload)) {
    return Array.isArray(payload[0]) ? payload[0] : payload;
  }

  if (Array.isArray(normalizedPayload && normalizedPayload.items)) {
    return normalizedPayload.items;
  }

  const listKeys = [
    "customers",
    "orders",
    "order_states",
    "order_carriers",
    "order_histories",
    "messages",
    "addresses",
    "currencies",
    "groups",
    "shipments",
  ];
  const key = listKeys.find((item) => Array.isArray(normalizedPayload && normalizedPayload[item]));
  return key ? normalizedPayload[key] : [];
}

function getPrestaShopTotalCount(payload, fallbackCount) {
  if (Array.isArray(payload) && payload.length > 1) {
    return normalizeNumber(payload[1], fallbackCount || 0);
  }

  return normalizeNumber(payload && payload.total_count, fallbackCount || getPrestaShopItems(payload).length || 0);
}

function normalizePrestaShopPayload(payload) {
  if (payload && payload.prestashop && typeof payload.prestashop === "object") {
    return payload.prestashop;
  }
  return payload;
}

function unwrapPrestaShopResource(payload, resourceName) {
  const normalizedPayload = normalizePrestaShopPayload(payload);
  if (
    normalizedPayload &&
    resourceName &&
    normalizedPayload[resourceName] &&
    typeof normalizedPayload[resourceName] === "object" &&
    !Array.isArray(normalizedPayload[resourceName])
  ) {
    return normalizedPayload[resourceName];
  }
  return normalizedPayload;
}

function hashToken(value) {
  const input = normalizeText(value);
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function compactDomainToken(domain) {
  const normalizedDomain = normalizeDomain(domain);
  const readable = normalizedDomain.replace(/[^a-z0-9]/gi, "").slice(0, 18) || "domain";
  return `${readable}_${hashToken(normalizedDomain)}`;
}

function buildDbKey(prefix, domain) {
  return `${prefix}${compactDomainToken(domain)}`;
}

function isDbMissingError(error) {
  return Boolean(error && error.status === 404);
}

function getAppDb() {
  if (typeof $db !== "undefined" && $db) {
    return $db;
  }
  if (typeof db !== "undefined" && db) {
    return db;
  }
  return null;
}

async function readDb(key, fallback) {
  const appDb = getAppDb();
  if (!appDb) {
    return fallback;
  }

  try {
    return await appDb.get(key);
  } catch (error) {
    if (!isDbMissingError(error)) {
      throw error;
    }
    return fallback;
  }
}

async function writeDb(key, value) {
  const appDb = getAppDb();
  if (!appDb) {
    console.log(`[PrestaShopConnector] App data storage is unavailable; skipped writing ${key}.`);
    return false;
  }

  await appDb.set(key, value);
  return true;
}

async function deleteDbKeyIfPresent(key) {
  const appDb = getAppDb();
  if (!appDb) {
    return;
  }

  try {
    await appDb.delete(key);
  } catch (error) {
    if (!isDbMissingError(error)) {
      throw error;
    }
  }
}

function buildPrestaShopStoreDisplayUrl(baseUrl, subdomain) {
  const normalizedBaseUrl = normalizeDomain(baseUrl);
  const normalizedSubdomain = normalizeStorePath(subdomain);

  if (!normalizedBaseUrl) {
    return "";
  }

  return normalizedSubdomain ? `${normalizedBaseUrl}/${normalizedSubdomain}` : normalizedBaseUrl;
}

function normalizePrestaShopStoreRecord(store, fallbackId, includeSecret) {
  if (!store || typeof store !== "object") {
    return null;
  }

  const baseUrl = normalizeDomain(store.base_url || store.baseUrl);
  const subdomain = normalizeStorePath(store.subdomain || store.path);
  const accessToken = normalizeText(store.access_token || store.accessToken);
  const storeName = normalizeText(store.store_name || store.storeName) || `Store ${fallbackId}`;
  const storeCode = normalizeStoreCode(store.store_code || store.storeCode);
  const customAdminPath = normalizeStorePath(store.custom_admin_path || store.customAdminPath) || DEFAULT_ADMIN_PATH;
  const apiMode = normalizeText(store.api_mode || store.apiMode).toLowerCase() === "extension" ? "extension" : "native";
  const hasCredentials = Boolean(baseUrl && accessToken);

  if (includeSecret && !hasCredentials) {
    return null;
  }

  const normalized = {
    id: normalizeText(store.id || fallbackId),
    store_name: storeName,
    base_url: baseUrl,
    subdomain,
    store_code: storeCode,
    custom_admin_path: customAdminPath,
    api_mode: apiMode,
    display_url: buildPrestaShopStoreDisplayUrl(baseUrl, subdomain),
    verified: normalizeBoolean(store.verified, hasCredentials),
    has_credentials: hasCredentials,
    has_custom_admin_path: customAdminPath !== DEFAULT_ADMIN_PATH,
  };

  if (includeSecret) {
    normalized.access_token = accessToken;
  }

  return normalized;
}

function getPrestaShopStores(settings) {
  const rawStores =
    safeParseJson(settings && settings.prestashop_stores, null) ||
    safeParseJson(settings && settings.prestashop_store_summaries, []);

  if (!Array.isArray(rawStores)) {
    return [];
  }

  return rawStores
    .map((store, index) => normalizePrestaShopStoreRecord(store, index + 1, false))
    .filter(Boolean);
}

function getPrestaShopFeatureFlags(settings) {
  return {
    auto_install_webhooks: normalizeBoolean(settings && settings.auto_install_webhooks, true),
    sync_contact_on_customer_created: normalizeBoolean(settings && settings.sync_contact_on_customer_created, false),
    sync_contact_on_customer_updated: normalizeBoolean(settings && settings.sync_contact_on_customer_updated, false),
    sync_ticket_on_customer_created: normalizeBoolean(settings && settings.sync_ticket_on_customer_created, false),
    sync_ticket_on_order_created: normalizeBoolean(settings && settings.sync_ticket_on_order_created, false),
    show_order_data_in_order_tab: normalizeBoolean(settings && settings.show_order_data_in_order_tab, true),
    display_not_found_only_when_all_stores_empty: normalizeBoolean(
      settings && settings.display_not_found_only_when_all_stores_empty,
      false
    ),
    allow_agent_refund_orders: false,
    allow_agent_cancel_orders: normalizeBoolean(settings && settings.allow_agent_cancel_orders, false),
    allow_agent_update_shipping_address: normalizeBoolean(settings && settings.allow_agent_update_shipping_address, false),
  };
}

function buildPrestaShopFeatureItems(flags) {
  const safeFlags = flags || getPrestaShopFeatureFlags({});

  return [
    {
      key: "auto_install_webhooks",
      label: "Webhook support",
      enabled: safeFlags.auto_install_webhooks,
      description: safeFlags.auto_install_webhooks
        ? "External PrestaShop events can create Freshdesk contacts and tickets when pointed at this app callback."
        : "PrestaShop event sync is disabled.",
    },
    {
      key: "sync_contact_on_customer_created",
      label: "Create contact on customer create",
      enabled: safeFlags.sync_contact_on_customer_created,
      description: safeFlags.sync_contact_on_customer_created
        ? "A Freshdesk contact will be created when a PrestaShop customer is created."
        : "Customer creation does not automatically create a Freshdesk contact.",
    },
    {
      key: "sync_contact_on_customer_updated",
      label: "Update contact on customer update",
      enabled: safeFlags.sync_contact_on_customer_updated,
      description: safeFlags.sync_contact_on_customer_updated
        ? "A linked Freshdesk contact will be updated when a PrestaShop customer changes."
        : "Customer updates do not automatically update a Freshdesk contact.",
    },
    {
      key: "sync_ticket_on_customer_created",
      label: "Create ticket on customer create",
      enabled: safeFlags.sync_ticket_on_customer_created,
      description: safeFlags.sync_ticket_on_customer_created
        ? "A Freshdesk ticket will be created when a PrestaShop customer is created."
        : "Customer creation does not automatically create a Freshdesk ticket.",
    },
    {
      key: "sync_ticket_on_order_created",
      label: "Create ticket on order create",
      enabled: safeFlags.sync_ticket_on_order_created,
      description: safeFlags.sync_ticket_on_order_created
        ? "A Freshdesk ticket will be created when a PrestaShop order is created."
        : "Order creation does not automatically create a Freshdesk ticket.",
    },
    {
      key: "show_order_data_in_order_tab",
      label: "Order tab visibility",
      enabled: safeFlags.show_order_data_in_order_tab,
      description: safeFlags.show_order_data_in_order_tab
        ? "Order data is enabled for the ticket order tab."
        : "Order data is hidden from the ticket order tab.",
    },
    {
      key: "display_not_found_only_when_all_stores_empty",
      label: "Empty-state behavior",
      enabled: safeFlags.display_not_found_only_when_all_stores_empty,
      description: safeFlags.display_not_found_only_when_all_stores_empty
        ? "The not-found message appears only after every store returns no data."
        : "A not-found response can surface as soon as an individual store returns no data.",
    },
    {
      key: "allow_agent_cancel_orders",
      label: "Cancel orders",
      enabled: safeFlags.allow_agent_cancel_orders,
      description: safeFlags.allow_agent_cancel_orders
        ? "Agents are allowed to cancel PrestaShop orders."
        : "Order cancellation is disabled for agents.",
    },
    {
      key: "allow_agent_update_shipping_address",
      label: "Update shipping address",
      enabled: safeFlags.allow_agent_update_shipping_address,
      description: safeFlags.allow_agent_update_shipping_address
        ? "Agents can request shipping-address updates for eligible orders."
        : "Shipping address updates are disabled for agents.",
    },
  ];
}

function buildPrestaShopConnectorSummary(settings) {
  const stores = getPrestaShopStores(settings);
  const flags = getPrestaShopFeatureFlags(settings);
  const features = buildPrestaShopFeatureItems(flags);
  const enabledActions = features.filter((feature) => {
    return feature.enabled && ["allow_agent_cancel_orders", "allow_agent_update_shipping_address"].includes(feature.key);
  });

  return {
    summary: {
      freshdesk_domain: normalizeDomain(settings && settings.domain),
      freshdesk_connected: normalizeBoolean(
        settings && settings.freshdesk_verified,
        Boolean(normalizeDomain(settings && settings.domain) && normalizeText(settings && settings.api_key))
      ),
      connected_stores: stores.length,
      verified_stores: stores.filter((store) => store.verified).length,
      enabled_actions_count: enabledActions.length,
      custom_admin_paths_count: stores.filter((store) => store.has_custom_admin_path).length,
    },
    stores,
    flags,
    features,
  };
}

async function writeSecurePrestaShopStores(domain, stores) {
  const normalizedDomain = normalizeDomain(domain);
  if (!normalizedDomain) {
    throw new Error("Freshdesk domain is required before storing PrestaShop credentials.");
  }

  const normalizedStores = (Array.isArray(stores) ? stores : [])
    .map((store, index) => normalizePrestaShopStoreRecord(store, index + 1, true))
    .filter(Boolean);

  if (!normalizedStores.length) {
    throw new Error("PrestaShop access tokens are required before storing connector settings.");
  }

  await writeDb(buildDbKey(SECURE_STORE_KEY_PREFIX, normalizedDomain), {
    domain: normalizedDomain,
    stores: normalizedStores,
    updated_at: new Date().toISOString(),
  });

  return normalizedStores;
}

async function writeSecurePrestaShopStoresFromSettings(settings) {
  const domain = normalizeDomain(settings && settings.domain);
  const stores = safeParseJson(settings && settings.prestashop_stores, []);

  if (!domain || !Array.isArray(stores) || !stores.length) {
    return [];
  }

  return await writeSecurePrestaShopStores(domain, stores);
}

async function readSecurePrestaShopStores(domain) {
  const normalizedDomain = normalizeDomain(domain);
  if (!normalizedDomain) {
    return [];
  }

  const stored = await readDb(buildDbKey(SECURE_STORE_KEY_PREFIX, normalizedDomain), { stores: [] });
  return (Array.isArray(stored && stored.stores) ? stored.stores : [])
    .map((store, index) => normalizePrestaShopStoreRecord(store, index + 1, true))
    .filter(Boolean);
}

async function getSecurePrestaShopStores(settings) {
  const secureStores = await readSecurePrestaShopStores(settings && settings.domain);
  if (secureStores.length) {
    return secureStores;
  }

  const fallbackStores = safeParseJson(settings && settings.prestashop_stores, []);
  return (Array.isArray(fallbackStores) ? fallbackStores : [])
    .map((store, index) => normalizePrestaShopStoreRecord(store, index + 1, true))
    .filter(Boolean);
}

async function clearSecurePrestaShopStores(domain) {
  if (!normalizeDomain(domain)) {
    return;
  }
  await deleteDbKeyIfPresent(buildDbKey(SECURE_STORE_KEY_PREFIX, domain));
}

async function readWebhookRegistry(domain) {
  if (!normalizeDomain(domain)) {
    return {
      domain: "",
      target_url: "",
      auto_install_pending: false,
      auto_install_error: "",
      auto_install_attempted_at: "",
    };
  }

  return await readDb(buildDbKey(WEBHOOK_REGISTRY_KEY_PREFIX, domain), {
    domain: normalizeDomain(domain),
    target_url: "",
    auto_install_pending: false,
    auto_install_error: "",
    auto_install_attempted_at: "",
  });
}

async function writeWebhookRegistry(domain, registry) {
  if (!normalizeDomain(domain)) {
    return;
  }

  await writeDb(buildDbKey(WEBHOOK_REGISTRY_KEY_PREFIX, domain), {
    domain: normalizeDomain(domain),
    target_url: normalizeText(registry && registry.target_url),
    auto_install_pending: normalizeBoolean(registry && registry.auto_install_pending, false),
    auto_install_error: normalizeText(registry && registry.auto_install_error),
    auto_install_attempted_at: normalizeText(registry && registry.auto_install_attempted_at),
    updated_at: new Date().toISOString(),
  });
}

async function ensurePrestaShopWebhookTargetRegistry(domain) {
  const normalizedDomain = normalizeDomain(domain);
  if (!normalizedDomain) {
    return {
      domain: "",
      target_url: "",
      auto_install_pending: false,
      auto_install_error: "",
      auto_install_attempted_at: "",
    };
  }

  const registry = await readWebhookRegistry(normalizedDomain);
  if (normalizeText(registry && registry.target_url)) {
    return {
      ...registry,
      domain: normalizedDomain,
      target_url: normalizeText(registry.target_url),
    };
  }

  const targetUrl = await generateTargetUrl();
  await writeWebhookRegistry(normalizedDomain, {
    ...registry,
    target_url: targetUrl,
    auto_install_pending: true,
    auto_install_error: "",
    auto_install_attempted_at: "",
  });
  return {
    ...registry,
    domain: normalizedDomain,
    target_url: targetUrl,
    auto_install_pending: true,
    auto_install_error: "",
    auto_install_attempted_at: "",
  };
}

async function ensurePrestaShopEventCallbackUrl(domain) {
  const registry = await ensurePrestaShopWebhookTargetRegistry(domain);
  return normalizeText(registry && registry.target_url);
}

function hasPrestaShopWebhookEventsEnabled(flags) {
  const safeFlags = flags || getPrestaShopFeatureFlags({});
  return Boolean(
    safeFlags.sync_contact_on_customer_created ||
      safeFlags.sync_contact_on_customer_updated ||
      safeFlags.sync_ticket_on_customer_created ||
      safeFlags.sync_ticket_on_order_created
  );
}

function shouldPrepareAutoPrestaShopWebhooks(settings) {
  const flags = getPrestaShopFeatureFlags(settings);
  return Boolean(flags.auto_install_webhooks && normalizeDomain(settings && settings.domain) && hasPrestaShopWebhookEventsEnabled(flags));
}

function describePrestaShopWebhookCallbackStatus(settings, registry) {
  const flags = getPrestaShopFeatureFlags(settings);
  if (!flags.auto_install_webhooks) {
    return "disabled";
  }
  if (!hasPrestaShopWebhookEventsEnabled(flags)) {
    return "not needed because no sync events are enabled";
  }
  return normalizeText(registry && registry.target_url) ? "prepared for deferred install" : "not generated";
}

async function preparePrestaShopWebhookAutoInstall(settings) {
  const shouldPrepareWebhooks = shouldPrepareAutoPrestaShopWebhooks(settings);
  if (!shouldPrepareWebhooks) {
    await removePrestaShopWebhookAutoInstallSchedule();
    return { target_url: "" };
  }

  const domain = normalizeDomain(settings && settings.domain);
  try {
    const registry = await markPrestaShopWebhookAutoInstallPending(domain);
    await ensurePrestaShopWebhookAutoInstallSchedule(settings);
    return registry;
  } catch (error) {
    console.error("[PrestaShopConnector] Unable to prepare deferred webhook installation:", error);
    if (domain) {
      await recordPrestaShopWebhookAutoInstallFailure(domain, { target_url: "" }, error);
    }
    return {
      target_url: "",
      auto_install_pending: true,
      auto_install_error: extractErrorMessage(error, "Unable to prepare PrestaShop webhook callback."),
      auto_install_attempted_at: new Date().toISOString(),
    };
  }
}

async function markPrestaShopWebhookAutoInstallPending(domain) {
  const registry = await ensurePrestaShopWebhookTargetRegistry(domain);
  await writeWebhookRegistry(domain, {
    ...registry,
    target_url: normalizeText(registry && registry.target_url),
    auto_install_pending: true,
    auto_install_error: "",
  });

  return {
    ...registry,
    auto_install_pending: true,
    auto_install_error: "",
  };
}

function shouldRunAutoPrestaShopWebhookInstall(domain, flags) {
  return Boolean(flags && flags.auto_install_webhooks && normalizeDomain(domain) && hasPrestaShopWebhookEventsEnabled(flags));
}

function isPrestaShopWebhookAutoInstallPending(registry) {
  return normalizeBoolean(registry && registry.auto_install_pending, false);
}

function buildPrestaShopWebhookInstallErrorMessage(errors) {
  return (Array.isArray(errors) ? errors : [])
    .map((error) => `${normalizeText(error.store_name) || "Store"}: ${normalizeText(error.message)}`)
    .filter(Boolean)
    .join("; ");
}

async function recordPrestaShopWebhookAutoInstallResult(domain, registry, targetUrl, installResult) {
  await writeWebhookRegistry(domain, {
    ...registry,
    target_url: targetUrl,
    auto_install_pending: Boolean(installResult && installResult.errors && installResult.errors.length),
    auto_install_error: buildPrestaShopWebhookInstallErrorMessage(installResult && installResult.errors),
    auto_install_attempted_at: new Date().toISOString(),
  });
}

async function recordPrestaShopWebhookAutoInstallFailure(domain, registry, error) {
  await writeWebhookRegistry(domain, {
    ...registry,
    auto_install_pending: true,
    auto_install_error: extractErrorMessage(error, "Unable to auto-install PrestaShop webhook callback."),
    auto_install_attempted_at: new Date().toISOString(),
  });
}

// Scheduled auto-install runs without an interactive request, so capture only
// the settings needed to resolve enabled topics and load secure stores by domain.
function buildPrestaShopWebhookScheduleData(settings) {
  return {
    ...getPrestaShopFeatureFlags(settings),
    domain: normalizeDomain(settings && settings.domain),
  };
}

async function ensurePrestaShopWebhookAutoInstallSchedule(settings) {
  if (typeof $schedule === "undefined" || !$schedule) {
    return;
  }

  const data = buildPrestaShopWebhookScheduleData(settings);
  if (!data.domain) {
    return;
  }

  const scheduleConfig = {
    name: WEBHOOK_AUTOINSTALL_SCHEDULE_NAME,
    data,
    schedule_at: new Date(Date.now() + 60 * 1000).toISOString(),
    repeat: { time_unit: "minutes", frequency: 30 },
  };

  try {
    await $schedule.create(scheduleConfig);
  } catch {
    try {
      await $schedule.update(scheduleConfig);
    } catch (updateError) {
      console.error("[PrestaShopConnector] Unable to (re)create webhook auto-install schedule:", updateError);
    }
  }
}

async function removePrestaShopWebhookAutoInstallSchedule() {
  if (typeof $schedule === "undefined" || !$schedule) {
    return;
  }

  try {
    await $schedule.delete({ name: WEBHOOK_AUTOINSTALL_SCHEDULE_NAME });
  } catch {
    // No active schedule to remove; safe to ignore.
  }
}

function buildPrestaShopOrderTicketRetryScheduleName(storeId, orderId) {
  return `${ORDER_TICKET_RETRY_SCHEDULE_PREFIX}${normalizeText(storeId) || "store"}_${normalizeText(orderId) || "order"}`;
}

function buildPrestaShopOrderTicketRetryScheduleData(settings, store, orderId, attempt) {
  return {
    job_type: "prestashop_order_ticket_retry",
    domain: normalizeDomain(settings && settings.domain),
    ...getPrestaShopFeatureFlags(settings),
    store_id: normalizeText(store && store.id),
    order_id: normalizeText(orderId),
    attempt: Math.max(1, Math.trunc(normalizeNumber(attempt, 1))),
  };
}

async function schedulePrestaShopOrderTicketRetry(settings, store, orderId, attempt, reason) {
  if (typeof $schedule === "undefined" || !$schedule) {
    return false;
  }

  const normalizedOrderId = normalizeText(orderId);
  const normalizedStoreId = normalizeText(store && store.id);
  const data = buildPrestaShopOrderTicketRetryScheduleData(settings, store, normalizedOrderId, attempt);
  if (!data.domain || !normalizedStoreId || !normalizedOrderId) {
    return false;
  }

  const scheduleConfig = {
    name: buildPrestaShopOrderTicketRetryScheduleName(normalizedStoreId, normalizedOrderId),
    data,
    schedule_at: new Date(Date.now() + ORDER_TICKET_RETRY_DELAY_MS).toISOString(),
  };

  try {
    await $schedule.create(scheduleConfig);
  } catch {
    await $schedule.update(scheduleConfig);
  }

  console.log(
    `[PrestaShopConnector] Scheduled order-created ticket retry ${data.attempt}/${ORDER_TICKET_RETRY_MAX_ATTEMPTS} for order ${normalizedOrderId} in store ${normalizedStoreId}${reason ? ` (${reason})` : ""}.`
  );
  return true;
}

async function removePrestaShopOrderTicketRetrySchedule(storeId, orderId) {
  if (typeof $schedule === "undefined" || !$schedule) {
    return;
  }

  const normalizedOrderId = normalizeText(orderId);
  const normalizedStoreId = normalizeText(storeId);
  if (!normalizedStoreId || !normalizedOrderId) {
    return;
  }

  try {
    await $schedule.delete({ name: buildPrestaShopOrderTicketRetryScheduleName(normalizedStoreId, normalizedOrderId) });
  } catch {
    // The retry schedule may not exist yet; safe to ignore.
  }
}

async function readLinkMap(domain, prefix) {
  if (!normalizeDomain(domain)) {
    return {};
  }
  const stored = await readDb(buildDbKey(prefix, domain), { map: {} });
  return stored && typeof stored.map === "object" ? stored.map : {};
}

async function writeLinkMap(domain, prefix, linkMap) {
  if (!normalizeDomain(domain)) {
    return;
  }
  await writeDb(buildDbKey(prefix, domain), {
    domain: normalizeDomain(domain),
    map: linkMap && typeof linkMap === "object" ? linkMap : {},
    updated_at: new Date().toISOString(),
  });
}

function buildMapKey(storeId, id) {
  return `${normalizeText(storeId)}:${normalizeText(id)}`;
}

async function getMappedFreshdeskContactId(domain, storeId, customerId) {
  const linkMap = await readLinkMap(domain, CONTACT_LINK_KEY_PREFIX);
  return normalizeText(linkMap[buildMapKey(storeId, customerId)]);
}

async function setMappedFreshdeskContactId(domain, storeId, customerId, contactId) {
  const normalizedContactId = normalizeText(contactId);
  if (!normalizedContactId) {
    return;
  }

  const linkMap = await readLinkMap(domain, CONTACT_LINK_KEY_PREFIX);
  linkMap[buildMapKey(storeId, customerId)] = normalizedContactId;
  await writeLinkMap(domain, CONTACT_LINK_KEY_PREFIX, linkMap);
}

async function setMappedTicket(domain, prefix, storeId, id, ticket) {
  const normalizedId = normalizeText(id);
  if (!normalizedId) {
    return;
  }

  const linkMap = await readLinkMap(domain, prefix);
  linkMap[buildMapKey(storeId, normalizedId)] = {
    ticket_id: normalizeText(ticket && ticket.id),
    subject: normalizeText(ticket && ticket.subject),
    created_at: new Date().toISOString(),
  };
  await writeLinkMap(domain, prefix, linkMap);
}

async function getMappedTicket(domain, prefix, storeId, id) {
  const normalizedId = normalizeText(id);
  if (!normalizedId) {
    return null;
  }

  const linkMap = await readLinkMap(domain, prefix);
  const ticket = linkMap[buildMapKey(storeId, normalizedId)];
  return ticket && typeof ticket === "object" ? ticket : null;
}

async function clearMappedTicket(domain, prefix, storeId, id) {
  const normalizedId = normalizeText(id);
  if (!normalizedId) {
    return;
  }

  const linkMap = await readLinkMap(domain, prefix);
  delete linkMap[buildMapKey(storeId, normalizedId)];
  await writeLinkMap(domain, prefix, linkMap);
}

function resolvePrestaShopStoreEndpoint(store) {
  const baseUrl = normalizeDomain(store && store.base_url);
  if (!baseUrl) {
    return null;
  }

  const host = baseUrl.split("/")[0];
  const basePath = baseUrl.includes("/") ? `/${baseUrl.split("/").slice(1).join("/")}` : "";
  const subdomain = normalizeStorePath(store && store.subdomain);
  const pathPrefix = `${basePath}${subdomain ? `/${subdomain}` : ""}`.replace(/\/{2,}/g, "/");

  return {
    host,
    pathPrefix: pathPrefix === "/" ? "" : pathPrefix,
  };
}

function buildPrestaShopApiPath(store, requestPath) {
  const endpoint = resolvePrestaShopStoreEndpoint(store);
  if (!endpoint) {
    throw new Error(`Store endpoint is not configured for ${normalizeText(store && store.store_name) || "this store"}.`);
  }

  const rawPath = normalizeText(requestPath) || "/";
  if (rawPath.startsWith("/freshworks/")) {
    return appendQueryParam(
      `${endpoint.pathPrefix}/module/freshdeskconnector/api`.replace(/\/{2,}/g, "/"),
      "fw_route",
      rawPath
    );
  }

  const nativePath = `${endpoint.pathPrefix}/api${rawPath}`.replace(/\/{2,}/g, "/");
  const withJson = appendQueryParam(nativePath, "output_format", "JSON");
  const storeCode = normalizeStoreCode(store && store.store_code);
  return storeCode !== DEFAULT_STORE_CODE ? appendQueryParam(withJson, "id_shop", storeCode) : withJson;
}

function appendQueryParam(path, key, value) {
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
}

function buildPrestaShopAuthorization(store) {
  const token = normalizeText(store && store.access_token);
  if (isPrestaShopExtensionApiStore(store)) {
    return `Bearer ${token}`;
  }
  return `Basic ${Buffer.from(`${token}:`).toString("base64")}`;
}

function buildPrestaShopRequestContext(store, requestPath) {
  const endpoint = resolvePrestaShopStoreEndpoint(store);
  if (!endpoint) {
    throw new Error(`Store endpoint is not configured for ${normalizeText(store && store.store_name) || "this store"}.`);
  }

  return {
    store_host: endpoint.host,
    request_path: buildPrestaShopApiPath(store, requestPath),
    authorization: buildPrestaShopAuthorization(store),
  };
}

function isPrestaShopExtensionApiStore(store) {
  return normalizeText(store && store.api_mode).toLowerCase() === "extension";
}

function requestPrestaShop(templateName, store, requestPath, body) {
  return invokeTemplate(templateName, buildPrestaShopRequestContext(store, requestPath), body);
}

async function fetchPrestaShop(store, requestPath) {
  return normalizePrestaShopPayload(
    ensureSuccess(await requestPrestaShop("prestashop_get_live", store, requestPath), "Could not load PrestaShop data.")
  );
}

async function postPrestaShop(store, requestPath, body) {
  return normalizePrestaShopPayload(
    ensureSuccess(await requestPrestaShop("prestashop_post_live", store, requestPath, body), "Could not send data to PrestaShop.")
  );
}

async function installPrestaShopExtensionWebhook(store, targetUrl) {
  if (!isPrestaShopExtensionApiStore(store) || !normalizeText(targetUrl)) {
    return false;
  }

  const result = await postPrestaShop(store, "/freshworks/webhook/install", {
    deliveryUrl: normalizeText(targetUrl),
  });
  return result === true || result === "true" || result === 1 || result === "1";
}

async function installPrestaShopExtensionWebhooksForStores(stores, targetUrl) {
  let installedCount = 0;
  const errors = [];

  for (const store of Array.isArray(stores) ? stores : []) {
    if (!isPrestaShopExtensionApiStore(store)) {
      continue;
    }

    try {
      if (await installPrestaShopExtensionWebhook(store, targetUrl)) {
        installedCount += 1;
      }
    } catch (error) {
      errors.push({
        store_id: normalizeText(store && store.id),
        store_name: normalizeText(store && store.store_name),
        message: extractErrorMessage(error, "Unable to install PrestaShop webhook callback."),
      });
    }
  }

  return {
    installed_count: installedCount,
    errors,
  };
}

async function ensureAutoPrestaShopWebhooksInstalled(settings) {
  const flags = getPrestaShopFeatureFlags(settings);
  const domain = normalizeDomain(settings && settings.domain);

  if (!shouldRunAutoPrestaShopWebhookInstall(domain, flags)) {
    return;
  }

  const registry = await readWebhookRegistry(domain);
  if (!isPrestaShopWebhookAutoInstallPending(registry)) {
    return;
  }

  try {
    const stores = await getSecurePrestaShopStores(settings);
    const targetUrl = normalizeText(registry && registry.target_url) || await ensurePrestaShopEventCallbackUrl(domain);
    const installResult = await installPrestaShopExtensionWebhooksForStores(stores, targetUrl);
    await recordPrestaShopWebhookAutoInstallResult(domain, registry, targetUrl, installResult);

    console.log(
      `[PrestaShopConnector] Auto-installed ${installResult.installed_count} PrestaShop webhook callback(s) for ${domain}.`
    );
  } catch (error) {
    await recordPrestaShopWebhookAutoInstallFailure(domain, registry, error);
    console.error("[PrestaShopConnector] Auto webhook installation failed:", error);
  }
}

function buildFreshdeskRequestContext(settings, requestPath) {
  const domain = normalizeDomain(settings && settings.domain);
  const encodedAuth = normalizeText(settings && settings.api_key);
  if (!domain || !encodedAuth) {
    throw new Error("Freshdesk credentials are not configured.");
  }
  return {
    domain,
    encoded_auth: encodedAuth,
    request_path: requestPath,
  };
}

function requestFreshdesk(templateName, settings, requestPath, body) {
  return invokeTemplate(templateName, buildFreshdeskRequestContext(settings, requestPath), body);
}

async function fetchFreshdesk(settings, requestPath) {
  return ensureSuccess(await requestFreshdesk("freshdesk_get_live", settings, requestPath), "Could not load Freshdesk data.");
}

async function postFreshdesk(settings, requestPath, body) {
  return ensureSuccess(await requestFreshdesk("freshdesk_post_live", settings, requestPath, body), "Could not send data to Freshdesk.");
}

async function putFreshdesk(settings, requestPath, body) {
  return ensureSuccess(await requestFreshdesk("freshdesk_put_live", settings, requestPath, body), "Could not update Freshdesk data.");
}

async function fetchFreshdeskRequesterEmail(settings, requesterId) {
  const normalizedRequesterId = normalizeText(requesterId);
  if (!normalizedRequesterId || !normalizeText(settings && settings.api_key) || !normalizeDomain(settings && settings.domain)) {
    return "";
  }

  const response = await fetchFreshdesk(settings, `/api/v2/contacts/${normalizedRequesterId}`);
  const contact = response && response.contact ? response.contact : response;
  return normalizeText((contact && contact.email) || (contact && contact.primary_email) || (contact && contact.primaryEmail));
}

async function fetchFreshdeskTicketRequesterEmail(settings, ticketId) {
  const normalizedTicketId = normalizeText(ticketId);
  if (!normalizedTicketId || !normalizeText(settings && settings.api_key) || !normalizeDomain(settings && settings.domain)) {
    return "";
  }

  const response = await fetchFreshdesk(settings, `/api/v2/tickets/${encodeURIComponent(normalizedTicketId)}`);
  const ticket = response && response.ticket ? response.ticket : response;
  const requester = ticket && ticket.requester ? ticket.requester : {};
  const contact = ticket && ticket.contact ? ticket.contact : {};
  const directEmail = normalizeText(
    (ticket && ticket.email) ||
      (ticket && ticket.requester_email) ||
      (ticket && ticket.requesterEmail) ||
      requester.email ||
      requester.primary_email ||
      requester.primaryEmail ||
      contact.email ||
      contact.primary_email ||
      contact.primaryEmail
  );

  if (directEmail) {
    return directEmail;
  }

  const requesterId = normalizeText(
    ticket && (
      ticket.requester_id ||
      ticket.requesterId ||
      requester.id ||
      requester.requester_id ||
      requester.requesterId ||
      contact.id
    )
  );

  return requesterId ? await fetchFreshdeskRequesterEmail(settings, requesterId) : "";
}

async function resolveRequesterEmailFromFreshdesk(settings, requesterId, ticketId) {
  try {
    const requesterEmail = await fetchFreshdeskRequesterEmail(settings, requesterId);
    if (requesterEmail) {
      return requesterEmail;
    }
  } catch {
    // Fall through to the ticket lookup; some Freshdesk contexts expose only the
    // ticket id or restrict direct requester reads.
  }

  try {
    return await fetchFreshdeskTicketRequesterEmail(settings, ticketId);
  } catch {
    return "";
  }
}

async function findFreshdeskContactByEmail(settings, email) {
  const normalizedEmail = normalizeText(email);
  if (!normalizedEmail) {
    return null;
  }

  const query = encodeURIComponent(`"email:'${normalizedEmail.replace(/'/g, "\\'")}'"`);
  const response = await fetchFreshdesk(settings, `/api/v2/search/contacts?query=${query}`);
  const results = Array.isArray(response && response.results) ? response.results : [];
  return results.length ? results[0] : null;
}

function unwrapFreshdeskContact(response) {
  return response && response.contact ? response.contact : response;
}

function unwrapFreshdeskTicket(response) {
  return response && response.ticket ? response.ticket : response;
}

function normalizeFreshdeskRequesterId(value) {
  const normalized = normalizeText(value);
  if (!normalized) {
    return null;
  }

  const parsed = Number(normalized);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function formatMoney(value, currency) {
  const amount = Number(value || 0);
  const code = normalizeText(currency) || "USD";
  if (Number.isNaN(amount)) {
    return normalizeText(value);
  }

  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: code,
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${code}`;
  }
}

function normalizeAddress(address) {
  const safe = address && typeof address === "object" ? address : {};
  const street = Array.isArray(safe.street) ? safe.street : [safe.address_1 || safe.address1 || safe.address1, safe.address_2 || safe.address2 || safe.address2].filter(Boolean);
  const firstName = normalizeText(safe.firstname || safe.first_name || safe.firstName);
  const lastName = normalizeText(safe.lastname || safe.last_name || safe.lastName);
  const region = normalizeText(safe.region || safe.region_code || safe.state || safe.id_state);
  const postcode = normalizeText(safe.postcode || safe.zip);
  const country = normalizeText(safe.country_id || safe.country || safe.id_country);
  const lines = [
    [firstName, lastName].filter(Boolean).join(" "),
    normalizeText(safe.company),
    ...street.map((line) => normalizeText(line)).filter(Boolean),
    [normalizeText(safe.city), region].filter(Boolean).join(", "),
    [postcode, country].filter(Boolean).join(" "),
  ].filter(Boolean);

  return {
    first_name: firstName,
    last_name: lastName,
    company: normalizeText(safe.company),
    address_1: normalizeText(street[0]),
    address_2: normalizeText(street[1]),
    city: normalizeText(safe.city),
    state: region,
    postcode,
    country,
    phone: normalizeText(safe.telephone || safe.phone || safe.phone_mobile),
    email: normalizeText(safe.email),
    formatted: lines.join("\n"),
  };
}

function hasMeaningfulPrestaShopValue(value) {
  if (value === undefined || value === null) {
    return false;
  }
  if (typeof value === "string") {
    return normalizeText(value) !== "";
  }
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  return true;
}

function mergePrestaShopOrderPayload(preferred, fallback) {
  if (Array.isArray(preferred)) {
    if (fallback && typeof fallback === "object" && !Array.isArray(fallback)) {
      return fallback;
    }
    return preferred.length ? preferred[0] : fallback;
  }

  if (!preferred || typeof preferred !== "object") {
    return hasMeaningfulPrestaShopValue(preferred) ? preferred : fallback;
  }

  const fallbackObject = fallback && typeof fallback === "object" && !Array.isArray(fallback) ? fallback : {};
  const merged = { ...fallbackObject };

  Object.keys(preferred).forEach((key) => {
    const preferredValue = preferred[key];
    const fallbackValue = fallbackObject[key];

    if (
      preferredValue &&
      typeof preferredValue === "object" &&
      !Array.isArray(preferredValue) &&
      fallbackValue &&
      typeof fallbackValue === "object" &&
      !Array.isArray(fallbackValue)
    ) {
      merged[key] = mergePrestaShopOrderPayload(preferredValue, fallbackValue);
      return;
    }

    if (Array.isArray(preferredValue) && Array.isArray(fallbackValue)) {
      merged[key] = preferredValue.length ? preferredValue : fallbackValue;
      return;
    }

    merged[key] = hasMeaningfulPrestaShopValue(preferredValue) ? preferredValue : fallbackValue;
  });

  return merged;
}

function buildStoreAdminBasePath(store) {
  const endpoint = resolvePrestaShopStoreEndpoint(store);
  if (!endpoint) {
    return "";
  }

  return `${endpoint.pathPrefix}/${normalizeStorePath(store && store.custom_admin_path) || DEFAULT_ADMIN_PATH}`.replace(/\/{2,}/g, "/");
}

function buildCustomerAdminLink(store, customerId) {
  const id = normalizeText(customerId);
  const endpoint = resolvePrestaShopStoreEndpoint(store);
  return id && endpoint ? `https://${endpoint.host}${buildStoreAdminBasePath(store)}/index.php/sell/customers/${encodeURIComponent(id)}/view` : "";
}

function buildOrderAdminLink(store, orderId) {
  const id = normalizeText(orderId);
  const endpoint = resolvePrestaShopStoreEndpoint(store);
  return id && endpoint ? `https://${endpoint.host}${buildStoreAdminBasePath(store)}/index.php/sell/orders/${encodeURIComponent(id)}/view` : "";
}

function buildProductAdminLink(store, productId) {
  const id = normalizeText(productId);
  const endpoint = resolvePrestaShopStoreEndpoint(store);
  return id && endpoint ? `https://${endpoint.host}${buildStoreAdminBasePath(store)}/index.php/sell/catalog/products/${encodeURIComponent(id)}` : "";
}

function getCustomerDefaultAddress(customer, key) {
  const id = normalizeText(customer && customer[key]);
  const addresses = Array.isArray(customer && customer.addresses) ? customer.addresses : [];
  return addresses.find((address) => normalizeText(address && address.id) === id) || addresses[0] || {};
}

function normalizePrestaShopGroupName(group) {
  return normalizeText(
    (group && group.code) ||
      (group && group.name) ||
      (group && group.customer_group_code) ||
      (group && group.customerGroupCode)
  );
}

function getPrestaShopCustomerTotalSpent(customer) {
  const safe = customer && typeof customer === "object" ? customer : {};
  const value = safe.total_spent !== undefined
    ? safe.total_spent
    : safe.totalSpent !== undefined
    ? safe.totalSpent
    : safe.total_sales !== undefined
    ? safe.total_sales
    : safe.totalSales;

  return {
    has_value: hasMeaningfulPrestaShopValue(value),
    amount: normalizeNumber(value, 0),
    currency: normalizeText(
      safe.total_spent_currency ||
        safe.totalSpentCurrency ||
        safe.currency ||
        safe.order_currency_code ||
        safe.base_currency_code
    ) || "USD",
  };
}

function normalizeCustomerRecord(store, customer) {
  const safe = unwrapPrestaShopResource(customer, "customer") || {};
  const billing = getCustomerDefaultAddress(safe, "default_billing");
  const shipping = getCustomerDefaultAddress(safe, "default_shipping");
  const customerId = normalizeText(safe.id || safe.entity_id || safe.entityId || safe.customer_id || safe.customerId);
  const email = normalizeText(safe.email || safe.email_address || safe.emailAddress || safe.primary_email || safe.primaryEmail);
  const firstName = normalizeText(safe.firstname || safe.first_name || safe.firstName || safe.customer_firstname || safe.customerFirstName);
  const lastName = normalizeText(safe.lastname || safe.last_name || safe.lastName || safe.customer_lastname || safe.customerLastName);
  const fullName = [firstName, lastName].filter(Boolean).join(" ");
  const totalSpent = getPrestaShopCustomerTotalSpent(safe);

  return {
    store_id: normalizeText(store.id),
    store_name: normalizeText(store.store_name),
    id: customerId,
    name: fullName || email || "Customer",
    email,
    phone: normalizeText((billing && billing.telephone) || (shipping && shipping.telephone)),
    admin_url: buildCustomerAdminLink(store, customerId),
    registration_date: normalizeDateString(safe.created_at || safe.createdAt || safe.date_add),
    total_sales: totalSpent.has_value ? formatMoney(totalSpent.amount, totalSpent.currency) : "",
    total_sales_raw: totalSpent.has_value ? totalSpent.amount : 0,
    total_sales_source: totalSpent.has_value ? "prestashop_customer_total_spent" : "",
    role: normalizeText(safe.group_name || safe.groupName) || (normalizeText(safe.group_id || safe.groupId || safe.id_default_group) ? `Group ${normalizeText(safe.group_id || safe.groupId || safe.id_default_group)}` : "Customer"),
    group_id: normalizeText(safe.group_id || safe.groupId || safe.id_default_group),
    country: normalizeText((shipping && shipping.country_id) || (billing && billing.country_id)),
    billing_address: normalizeAddress(billing),
    shipping_address: normalizeAddress(shipping),
  };
}

function hasPrestaShopCustomerIdentity(customer) {
  return Boolean(normalizeText(customer && customer.id) || normalizeText(customer && customer.email));
}

async function fetchPrestaShopCustomerDetail(store, customer) {
  const customerId = normalizeText(customer && customer.id);
  if (!customerId || customerId.toLowerCase().startsWith("guest:")) {
    return customer;
  }

  try {
    const detail = await fetchPrestaShop(store, isPrestaShopExtensionApiStore(store) ? `/freshworks/customers/${encodeURIComponent(customerId)}` : `/customers/${encodeURIComponent(customerId)}`);
    return normalizeCustomerRecord(store, detail) || customer;
  } catch {
    return customer;
  }
}

async function fetchPrestaShopCustomerGroupName(store, groupId, groupCache) {
  const normalizedGroupId = normalizeText(groupId);
  if (!normalizedGroupId) {
    return "";
  }

  const cacheKey = `${normalizeText(store && store.id)}:${normalizedGroupId}`;
  if (groupCache && Object.prototype.hasOwnProperty.call(groupCache, cacheKey)) {
    return groupCache[cacheKey];
  }

  let groupName = "";
  try {
    const group = await fetchPrestaShop(store, isPrestaShopExtensionApiStore(store) ? `/freshworks/customer-groups/${encodeURIComponent(normalizedGroupId)}` : `/groups/${encodeURIComponent(normalizedGroupId)}`);
    groupName = normalizePrestaShopGroupName(group);
  } catch {
    groupName = "";
  }

  if (groupCache) {
    groupCache[cacheKey] = groupName;
  }
  return groupName;
}

async function enrichPrestaShopCustomers(store, customers, groupCache) {
  const enrichedCustomers = [];
  for (const customer of Array.isArray(customers) ? customers : []) {
    const detailedCustomer = await fetchPrestaShopCustomerDetail(store, customer);
    if (!hasPrestaShopCustomerIdentity(detailedCustomer)) {
      continue;
    }
    const groupName = await fetchPrestaShopCustomerGroupName(store, detailedCustomer.group_id, groupCache);
    enrichedCustomers.push({
      ...detailedCustomer,
      role: groupName || detailedCustomer.role || "Customer",
    });
  }
  return enrichedCustomers;
}

function getOrderShippingAddress(order) {
  const assignments = order && order.extension_attributes && Array.isArray(order.extension_attributes.shipping_assignments)
    ? order.extension_attributes.shipping_assignments
    : [];
  const shipping = assignments[0] && assignments[0].shipping ? assignments[0].shipping : {};
  return shipping.address || order.shipping_address || order.delivery_address || {};
}

function getOrderShippingMethod(order) {
  const assignments = order && order.extension_attributes && Array.isArray(order.extension_attributes.shipping_assignments)
    ? order.extension_attributes.shipping_assignments
    : [];
  const shipping = assignments[0] && assignments[0].shipping ? assignments[0].shipping : {};
  return normalizeText(shipping.method || order.shipping_description || order.shipping_method || order.carrier_name);
}

function normalizeProductOptionValue(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (item && typeof item === "object") {
          return normalizeText(item.title || item.label || item.value || item.option_value);
        }
        return normalizeText(item);
      })
      .filter(Boolean)
      .join(", ");
  }

  return normalizeText(value);
}

function normalizeProductOptionRecord(option) {
  if (!option || typeof option !== "object") {
    return "";
  }

  const label = normalizeText(option.label || option.option_title || option.option_id || option.title);
  const value = normalizeProductOptionValue(option.value || option.print_value || option.option_value);
  return label && value ? `${label}: ${value}` : "";
}

function normalizeProductOption(item) {
  const safe = item && typeof item === "object" ? item : {};
  const productOptions = Array.isArray(safe.product_options || safe.productOptions)
    ? (safe.product_options || safe.productOptions)
    : [];
  if (productOptions.length) {
    return productOptions.map((option) => normalizeProductOptionRecord(option)).filter(Boolean);
  }

  const customOptions = safe.product_option &&
    safe.product_option.extension_attributes &&
    Array.isArray(safe.product_option.extension_attributes.custom_options)
    ? safe.product_option.extension_attributes.custom_options
    : [];

  return customOptions.map((option) => normalizeProductOptionRecord(option)).filter(Boolean);
}

function normalizeOrderLineItem(store, item, currency) {
  const safe = item && typeof item === "object" ? item : {};
  const productId = normalizeText(safe.product_id || safe.productId || safe.id_product);
  const quantity = normalizeNumber(safe.qty_ordered || safe.quantity || safe.qty || safe.product_quantity, 0);
  const price = normalizeNumber(safe.price || safe.base_price || safe.product_price || safe.unit_price_tax_incl || safe.unit_price_tax_excl, 0);
  const rowTotal = normalizeNumber(safe.row_total || safe.base_row_total || safe.total_price_tax_incl || price * quantity, 0);

  return {
    id: normalizeText(safe.item_id || safe.id || safe.id_order_detail),
    name: normalizeText(safe.name || safe.product_name),
    admin_url: buildProductAdminLink(store, productId),
    product_id: productId,
    price: String(price),
    price_formatted: formatMoney(price, currency),
    quantity,
    sku: normalizeText(safe.sku || safe.product_reference),
    options: normalizeProductOption(safe),
    total: String(rowTotal),
    total_formatted: formatMoney(rowTotal, currency),
  };
}

function normalizeCouponLine(order, currency) {
  const code = normalizeText(order && order.coupon_code);
  if (!code) {
    return [];
  }

  const discount = Math.abs(normalizeNumber(order.discount_amount || order.base_discount_amount, 0));
  return [{
    id: code,
    code,
    discount: String(discount),
    discount_formatted: formatMoney(discount, currency),
  }];
}

function buildCarrierTrackingUrl(track) {
  const number = normalizeText(track && (track.track_number || track.tracking_number || track.number));
  if (!number) {
    return "";
  }

  const carrier = normalizeText(track && (track.carrier_code || track.carrier || track.title)).toLowerCase();
  const encodedNumber = encodeURIComponent(number);
  if (carrier.includes("ups")) {
    return `https://www.ups.com/track?tracknum=${encodedNumber}`;
  }
  if (carrier.includes("fedex") || carrier.includes("fdx")) {
    return `https://www.fedex.com/fedextrack/?trknbr=${encodedNumber}`;
  }
  if (carrier.includes("usps")) {
    return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${encodedNumber}`;
  }
  if (carrier.includes("dhl")) {
    return `https://www.dhl.com/global-en/home/tracking/tracking-express.html?submit=1&tracking-id=${encodedNumber}`;
  }
  return "";
}

function normalizeShipmentTrack(track, shipment) {
  const safe = track && typeof track === "object" ? track : {};
  const trackingNumber = normalizeText(safe.track_number || safe.tracking_number || safe.number);
  const provider = normalizeText(safe.title || safe.carrier_title || safe.carrier_code || safe.carrier);
  const link = normalizeText(
    safe.tracking_url ||
      safe.tracking_link ||
      safe.url ||
      safe.extension_attributes && (safe.extension_attributes.tracking_url || safe.extension_attributes.tracking_link)
  ) || buildCarrierTrackingUrl(safe);

  if (!trackingNumber && !provider && !link) {
    return null;
  }

  return {
    tracking_id: normalizeText(safe.entity_id || safe.id || safe.track_id),
    tracking_number: trackingNumber,
    tracking_provider: provider || "Carrier",
    tracking_link: link,
    date_shipped: normalizeDateString((shipment && (shipment.created_at || shipment.date_add)) || safe.created_at || safe.createdAt || safe.date_add),
    custom_tracking_provider: normalizeText(safe.carrier_code),
  };
}

async function fetchPrestaShopShipmentTracking(store, orderId) {
  const normalizedOrderId = normalizeText(orderId);
  if (!normalizedOrderId) {
    return [];
  }

  const query = buildSearchQuery([{ field: "order_id", value: normalizedOrderId }], 20, "created_at", "DESC");
  const response = await fetchPrestaShop(store, isPrestaShopExtensionApiStore(store) ? `/freshworks/orders/${encodeURIComponent(normalizedOrderId)}/shipments` : `/order_carriers?${query}`);
  const shipments = getPrestaShopItems(response);
  const trackingItems = [];

  shipments.forEach((shipment) => {
    const tracks = Array.isArray(shipment && shipment.tracks) ? shipment.tracks : [shipment];
    tracks.forEach((track) => {
      const normalizedTrack = normalizeShipmentTrack(track, shipment);
      if (normalizedTrack) {
        trackingItems.push(normalizedTrack);
      }
    });
  });

  return trackingItems;
}

function normalizeStatusSlug(status) {
  return normalizeText(status).toLowerCase().replace(/\s+/g, "_");
}

function formatStatusLabel(status) {
  const normalized = normalizeStatusSlug(status);
  if (!normalized) {
    return "";
  }
  return normalized.split(/[-_]/g).filter(Boolean).map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1)).join(" ");
}

function resolveRefundUnavailableReason(status, total) {
  const normalizedStatus = normalizeStatusSlug(status);
  const totalValue = normalizeNumber(total, 0);
  if (["canceled", "cancelled", "closed"].includes(normalizedStatus)) {
    return "This order cannot be refunded from the connector.";
  }
  if (totalValue <= 0) {
    return "This order does not have any refundable amount remaining.";
  }
  if (!REFUNDABLE_ORDER_STATUSES.has(normalizedStatus)) {
    return "Refunds are available after PrestaShop marks payment as received.";
  }
  return "";
}

function buildOrderActionAvailability(status, total, store, hasShippingAddress = true) {
  const normalizedStatus = normalizeStatusSlug(status);
  const refundUnavailableReason = resolveRefundUnavailableReason(normalizedStatus, total);
  const canUseModuleActions = isPrestaShopExtensionApiStore(store);
  const refundActionUnavailableReason = refundUnavailableReason || "Refund actions require handling in PrestaShop Back Office.";
  const shippingUnavailableReason = !hasShippingAddress
    ? "This order does not have a shipping address."
    : !canUseModuleActions
    ? "Shipping address updates require the Freshworks PrestaShop module token."
    : "This order cannot have its shipping address updated from the connector.";
  const canUpdateShipping = hasShippingAddress &&
    canUseModuleActions &&
    !["complete", "closed", "canceled", "cancelled"].includes(normalizedStatus);
  return {
    can_add_note: canUseModuleActions,
    can_apply_coupon: false,
    coupon_unavailable_reason: "PrestaShop REST does not support applying coupons to orders after checkout.",
    can_refund: false,
    refund_unavailable_reason: refundActionUnavailableReason,
    can_cancel: canUseModuleActions && ["pending", "processing", "new", "awaiting_payment", "1", "2"].includes(normalizedStatus),
    can_update_shipping: canUpdateShipping,
    shipping_unavailable_reason: canUpdateShipping ? "" : shippingUnavailableReason,
  };
}

function normalizePrestaShopExtensionOrderPayload(order) {
  const payload = unwrapPrestaShopResource(order, "order");
  if (!Array.isArray(order)) {
    return payload && typeof payload === "object" ? payload : {};
  }

  return {
    entity_id: order[0],
    increment_id: order[1],
    state: order[2],
    status: order[3],
    created_at: order[4],
    updated_at: order[5],
    customer_id: order[6],
    customer_email: order[7],
    customer_firstname: order[8],
    customer_lastname: order[9],
    store_id: order[10],
    base_currency_code: order[11],
    order_currency_code: order[12],
    subtotal: order[13],
    tax_amount: order[14],
    shipping_amount: order[15],
    discount_amount: order[16],
    grand_total: order[17],
    total_refunded: order[18],
    shipping_description: order[19],
    billing_address: order[20],
    extension_attributes: order[21],
    payment: order[22],
    items: order[23],
  };
}

function hasPrestaShopShippingAddress(address) {
  return Boolean(
    normalizeText(address && address.address_1) ||
      normalizeText(address && address.city) ||
      normalizeText(address && address.postcode) ||
      normalizeText(address && address.country)
  );
}

function normalizeOrderRecord(store, order) {
  const safe = normalizePrestaShopExtensionOrderPayload(order);
  const currency = normalizeText(safe.order_currency_code || safe.base_currency_code || safe.global_currency_code || safe.currency || safe.currency_code || safe.id_currency) || "USD";
  const prestashopRows = safe.associations &&
    safe.associations.order_rows &&
    (Array.isArray(safe.associations.order_rows) || Array.isArray(safe.associations.order_rows.order_row))
    ? (Array.isArray(safe.associations.order_rows) ? safe.associations.order_rows : safe.associations.order_rows.order_row)
    : [];
  const items = (Array.isArray(safe.items) && safe.items.length ? safe.items : prestashopRows)
    .filter((item) => !normalizeText(item && item.parent_item_id))
    .map((item) => normalizeOrderLineItem(store, item, currency));
  const grandTotal = normalizeNumber(safe.grand_total || safe.base_grand_total || safe.total_paid_tax_incl || safe.total_paid, 0);
  const refundedTotal = Math.abs(normalizeNumber(safe.total_refunded || safe.base_total_refunded || safe.total_slip, 0));
  const refundableTotal = Math.max(0, grandTotal - refundedTotal);
  const billingAddress = normalizeAddress(safe.billing_address);
  const shippingAddress = normalizeAddress(getOrderShippingAddress(safe));
  const statusValue = normalizeText(safe.status || safe.state || safe.current_state || safe.id_order_state);
  const orderId = normalizeText(safe.entity_id || safe.id);

  return {
    store_id: normalizeText(store.id),
    store_name: normalizeText(store.store_name),
    id: orderId,
    order_number: normalizeText(safe.increment_id || safe.reference || safe.entity_id || safe.id),
    admin_url: buildOrderAdminLink(store, orderId),
    status: statusValue,
    state: normalizeText(safe.state || safe.current_state || safe.id_order_state),
    status_slug: normalizeStatusSlug(statusValue),
    status_label: normalizeText(safe.status_label || safe.order_state_name) || formatStatusLabel(statusValue) || "Unknown",
    is_custom_status: false,
    status_note: "",
    created_at: normalizeDateString(safe.created_at || safe.createdAt || safe.date_add),
    currency,
    subtotal: String(normalizeNumber(safe.subtotal || safe.base_subtotal || safe.total_products_wt || safe.total_products, 0)),
    subtotal_formatted: formatMoney(safe.subtotal || safe.base_subtotal || safe.total_products_wt || safe.total_products, currency),
    tax: String(normalizeNumber(safe.tax_amount || safe.base_tax_amount || (normalizeNumber(safe.total_paid_tax_incl, 0) - normalizeNumber(safe.total_paid_tax_excl, 0)), 0)),
    tax_formatted: formatMoney(safe.tax_amount || safe.base_tax_amount || (normalizeNumber(safe.total_paid_tax_incl, 0) - normalizeNumber(safe.total_paid_tax_excl, 0)), currency),
    shipping_total: String(normalizeNumber(safe.shipping_amount || safe.base_shipping_amount || safe.total_shipping_tax_incl || safe.total_shipping, 0)),
    shipping_total_formatted: formatMoney(safe.shipping_amount || safe.base_shipping_amount || safe.total_shipping_tax_incl || safe.total_shipping, currency),
    discount_total: String(Math.abs(normalizeNumber(safe.discount_amount || safe.base_discount_amount || safe.total_discounts_tax_incl || safe.total_discounts, 0))),
    discount_total_formatted: formatMoney(Math.abs(normalizeNumber(safe.discount_amount || safe.base_discount_amount || safe.total_discounts_tax_incl || safe.total_discounts, 0)), currency),
    grand_total: String(grandTotal),
    grand_total_formatted: formatMoney(grandTotal, currency),
    refunded_total: String(refundedTotal),
    refunded_total_formatted: formatMoney(refundedTotal, currency),
    refundable_total: String(refundableTotal),
    refundable_total_formatted: formatMoney(refundableTotal, currency),
    payment_method: normalizeText((safe.payment && safe.payment.method) || safe.payment || safe.module),
    shipping_method: getOrderShippingMethod(safe),
    billing_address: billingAddress,
    shipping_address: shippingAddress,
    customer_id: normalizeText(safe.customer_id || safe.id_customer),
    customer_email: normalizeText(safe.customer_email || billingAddress.email || shippingAddress.email),
    items,
    coupon_lines: normalizeCouponLine(safe, currency),
    tracking_items: [],
    supported_extensions: [],
    allowed_actions: buildOrderActionAvailability(statusValue, refundableTotal, store, hasPrestaShopShippingAddress(shippingAddress)),
  };
}

function getOrderNetSalesAmount(order) {
  const normalizedState = normalizeStatusSlug(order && (order.state || order.status));
  if (!SALES_ORDER_STATES.has(normalizedState)) {
    return 0;
  }

  const grandTotal = normalizeNumber(order && order.grand_total, 0);
  const refundedTotal = Math.abs(normalizeNumber(order && order.refunded_total, 0));
  return Math.max(0, grandTotal - refundedTotal);
}

function normalizeGuestCustomerFromOrder(store, order) {
  const email = normalizeText(order && order.customer_email);
  if (!email) {
    return null;
  }

  const billing = order.billing_address || {};
  const firstName = normalizeText(billing.first_name);
  const lastName = normalizeText(billing.last_name);
  const fullName = [firstName, lastName].filter(Boolean).join(" ");
  const netSalesAmount = getOrderNetSalesAmount(order);

  return {
    store_id: normalizeText(store.id),
    store_name: normalizeText(store.store_name),
    id: `guest:${email.toLowerCase()}`,
    name: fullName || email,
    email,
    phone: normalizeText(billing.phone || order.shipping_address && order.shipping_address.phone),
    admin_url: "",
    registration_date: "",
    total_sales: formatMoney(netSalesAmount, order.currency),
    total_sales_raw: netSalesAmount,
    role: "guest",
    country: normalizeText(order.shipping_address && order.shipping_address.country || billing.country),
    billing_address: billing,
    shipping_address: order.shipping_address || {},
  };
}

function buildSearchQuery(filters, pageSize, sortField, sortDirection, currentPage) {
  const parts = [];
  (Array.isArray(filters) ? filters : []).forEach((filter) => {
    const field = mapPrestaShopFilterField(filter && filter.field);
    const value = normalizeText(filter && filter.value);
    if (field && value) {
      parts.push(`filter[${encodeURIComponent(field)}]=[${encodeURIComponent(value)}]`);
    }
  });
  parts.push("display=full");
  parts.push(`limit=${encodeURIComponent(String(currentPage ? `${(Math.max(1, currentPage) - 1) * (pageSize || 20)},${pageSize || 20}` : pageSize || 20))}`);
  if (currentPage) {
    parts.push(`page=${encodeURIComponent(String(currentPage))}`);
  }
  if (sortField) {
    parts.push(`sort=[${encodeURIComponent(mapPrestaShopFilterField(sortField))}_${encodeURIComponent(sortDirection || "DESC")}]`);
  }
  return parts.join("&");
}

function mapPrestaShopFilterField(field) {
  const normalizedField = normalizeText(field);
  const fieldMap = {
    customer_id: "id_customer",
    entity_id: "id",
    increment_id: "reference",
    created_at: "date_add",
    order_id: "id_order",
  };
  return fieldMap[normalizedField] || normalizedField;
}

async function searchStoreCustomersByEmail(store, email) {
  const normalizedEmail = normalizeText(email);
  if (!normalizedEmail) {
    return [];
  }

  const query = buildSearchQuery([{ field: "email", value: normalizedEmail }], 20);
  const response = await fetchPrestaShop(store, isPrestaShopExtensionApiStore(store) ? `/freshworks/customers?email=${encodeURIComponent(normalizedEmail)}&pageSize=20` : `/customers?${query}`);
  const records = getPrestaShopItems(response);
  return records.map((customer) => normalizeCustomerRecord(store, customer)).filter(hasPrestaShopCustomerIdentity);
}

function buildOrderSearchText(order) {
  return [
    normalizeText(order && order.order_number),
    normalizeText(order && order.id),
    normalizeText(order && order.customer_email),
    normalizeText(order && order.status),
    normalizeText(order && order.status_slug),
    normalizeText(order && order.status_label),
    normalizeDateString(order && order.created_at),
  ].join(" ").toLowerCase();
}

function buildSearchTargets(query) {
  const normalized = normalizeText(query).toLowerCase();
  if (!normalized) {
    return [];
  }
  return Array.from(new Set([normalized, normalized.replace(/^#/, ""), normalized.replace(/\s+/g, "")].filter(Boolean)));
}

function orderMatchesSearchQuery(order, query) {
  const targets = buildSearchTargets(query);
  if (!targets.length) {
    return true;
  }
  const orderText = buildOrderSearchText(order);
  return targets.some((item) => orderText.includes(item));
}

function normalizeOrderLookupValue(value) {
  return normalizeText(value).toLowerCase().replace(/^#/, "").replace(/\s+/g, "");
}

function orderMatchesOrderIdentifier(order, query) {
  const targets = buildSearchTargets(query).map((item) => normalizeOrderLookupValue(item)).filter(Boolean);
  const identifiers = [normalizeOrderLookupValue(order && order.order_number), normalizeOrderLookupValue(order && order.id)].filter(Boolean);
  return identifiers.some((identifier) => targets.includes(identifier));
}

async function searchPrestaShopOrdersByFilter(store, filter) {
  if (isPrestaShopExtensionApiStore(store)) {
    const fieldMap = {
      customer_email: "email",
      customer_id: "customerId",
      entity_id: "orderId",
      increment_id: "orderNumber",
    };
    const extensionField = fieldMap[normalizeText(filter && filter.field)];
    const parts = ["pageSize=50", "sortField=created_at", "sortDirection=DESC"];
    if (extensionField) {
      parts.push(`${extensionField}=${encodeURIComponent(normalizeText(filter && filter.value))}`);
    }
    const response = await fetchPrestaShop(store, `/freshworks/orders?${parts.join("&")}`);
    return getPrestaShopItems(response).map((order) => normalizeOrderRecord(store, order));
  }

  const query = buildSearchQuery([filter], 50, "created_at", "DESC");
  const response = await fetchPrestaShop(store, `/orders?${query}`);
  return getPrestaShopItems(response).map((order) => normalizeOrderRecord(store, order));
}

async function searchStoreOrders(store, query) {
  const normalizedQuery = normalizeText(query);
  if (!normalizedQuery) {
    return [];
  }

  const ordersMap = new Map();
  if (normalizedQuery.includes("@") && !isPrestaShopExtensionApiStore(store)) {
    const customers = await searchStoreCustomersByEmail(store, normalizedQuery);
    for (const customer of customers) {
      const customerOrders = await searchPrestaShopOrdersByFilter(store, {
        field: "customer_id",
        value: customer.id,
      });
      customerOrders.forEach((order) => {
        if (order.id) {
          ordersMap.set(`${store.id}:${order.id}`, {
            ...order,
            customer_email: order.customer_email || customer.email,
          });
        }
      });
    }
    return Array.from(ordersMap.values());
  }

  const filters = normalizedQuery.includes("@")
    ? [{ field: "customer_email", value: normalizedQuery }]
    : [
        { field: "increment_id", value: normalizedQuery },
        { field: "entity_id", value: normalizedQuery },
      ];

  for (const filter of filters) {
    try {
      const orders = await searchPrestaShopOrdersByFilter(store, filter);
      orders.forEach((order) => {
        if (order.id && orderMatchesSearchQuery(order, normalizedQuery)) {
          ordersMap.set(`${store.id}:${order.id}`, order);
        }
      });
    } catch (error) {
      if (filters.length === 1) {
        throw error;
      }
    }
  }

  return Array.from(ordersMap.values());
}

async function loadStoreOrdersForCustomer(store, customer) {
  const ordersMap = new Map();
  const customerId = normalizeText(customer && customer.id);
  const email = normalizeText(customer && customer.email);

  if (customerId) {
    const orders = await searchPrestaShopOrdersByFilter(store, { field: "customer_id", value: customerId });
    orders.forEach((order) => {
      if (order.id) {
        ordersMap.set(`${store.id}:${order.id}`, order);
      }
    });
  }

  if (email) {
    for (const searchEmail of getRelatedWebhookEmails(email)) {
      const orders = await searchStoreOrders(store, searchEmail);
      orders.forEach((order) => {
        if (order.id) {
          ordersMap.set(`${store.id}:${order.id}`, order);
        }
      });
    }
  }

  return Array.from(ordersMap.values());
}

function getRelatedWebhookEmails(email) {
  const normalizedEmail = normalizeText(email).toLowerCase();
  const match = normalizedEmail.match(/^freshdesk\.webhook\.(customer|order)\.([^@]+)@(.+)$/);
  if (!match) {
    return normalizedEmail ? [normalizedEmail] : [];
  }

  const token = match[2];
  const domain = match[3];
  return [
    `freshdesk.webhook.customer.${token}@${domain}`,
    `freshdesk.webhook.order.${token}@${domain}`,
  ];
}

function contactEmailsAreRelated(leftEmail, rightEmail) {
  const left = normalizeText(leftEmail).toLowerCase();
  const right = normalizeText(rightEmail).toLowerCase();
  if (!left || !right) {
    return false;
  }
  return getRelatedWebhookEmails(left).includes(right) || getRelatedWebhookEmails(right).includes(left);
}

function getContactScopeEmails(requesterEmail, customers) {
  const emails = new Set();
  const normalizedRequesterEmail = normalizeText(requesterEmail).toLowerCase();
  getRelatedWebhookEmails(normalizedRequesterEmail).forEach((email) => emails.add(email));
  (Array.isArray(customers) ? customers : []).forEach((customer) => {
    const email = normalizeText(customer && customer.email).toLowerCase();
    getRelatedWebhookEmails(email).forEach((relatedEmail) => emails.add(relatedEmail));
  });
  return emails;
}

function getContactScopeCustomerIds(customers) {
  const customerIds = new Set();
  (Array.isArray(customers) ? customers : []).forEach((customer) => {
    const id = normalizeText(customer && customer.id);
    if (id && !id.toLowerCase().startsWith("guest:")) {
      customerIds.add(id);
    }
  });
  return customerIds;
}

function orderBelongsToContactScope(order, requesterEmail, customers) {
  const scopedEmails = getContactScopeEmails(requesterEmail, customers);
  const scopedCustomerIds = getContactScopeCustomerIds(customers);
  const orderEmail = normalizeText(order && order.customer_email).toLowerCase();
  const orderCustomerId = normalizeText(order && order.customer_id);
  return Boolean((orderEmail && scopedEmails.has(orderEmail)) || (orderCustomerId && scopedCustomerIds.has(orderCustomerId)));
}

function storeHasRegisteredCustomerEmail(customersMap, storeId, email) {
  const normalizedStore = normalizeText(storeId);
  const normalizedEmail = normalizeText(email).toLowerCase();
  if (!normalizedEmail) {
    return false;
  }

  for (const customer of customersMap.values()) {
    if (
      normalizeText(customer && customer.store_id) === normalizedStore &&
      normalizeText(customer && customer.role).toLowerCase() !== "guest" &&
      normalizeText(customer && customer.email).toLowerCase() === normalizedEmail
    ) {
      return true;
    }
  }

  return false;
}

function sortByDateDescending(items, selector) {
  return (Array.isArray(items) ? items : []).slice().sort((left, right) => {
    const leftValue = new Date(selector(left) || 0).getTime();
    const rightValue = new Date(selector(right) || 0).getTime();
    return rightValue - leftValue;
  });
}

async function enrichPrestaShopOrder(store, order) {
  if (!store || !order || !order.id) {
    return order;
  }

  try {
    const trackingItems = await fetchPrestaShopShipmentTracking(store, order.id);
    return {
      ...order,
      tracking_items: trackingItems,
      tracking_source: trackingItems.length ? "prestashop_shipments" : "",
      supported_extensions: trackingItems.length ? ["shipment_tracking"] : [],
    };
  } catch {
    return order;
  }
}

function applyOrderTotalsToCustomers(customers, orders) {
  const totalsByCustomerKey = {};

  (Array.isArray(orders) ? orders : []).forEach((order) => {
    const amount = getOrderNetSalesAmount(order);
    const currency = normalizeText(order && order.currency) || "USD";
    const storeId = normalizeText(order && order.store_id);
    const customerId = normalizeText(order && order.customer_id);
    const email = normalizeText(order && order.customer_email).toLowerCase();
    const keys = [];

    if (storeId && customerId) {
      keys.push(`${storeId}:id:${customerId}`);
    }
    if (storeId && email) {
      keys.push(`${storeId}:email:${email}`);
    }

    keys.forEach((key) => {
      if (!totalsByCustomerKey[key]) {
        totalsByCustomerKey[key] = {
          amount: 0,
          currency,
        };
      }
      totalsByCustomerKey[key].amount += amount;
      totalsByCustomerKey[key].currency = totalsByCustomerKey[key].currency || currency;
    });
  });

  return (Array.isArray(customers) ? customers : []).map((customer) => {
    if (normalizeText(customer && customer.total_sales_source) === "prestashop_customer_total_spent") {
      return customer;
    }

    const storeId = normalizeText(customer && customer.store_id);
    const customerId = normalizeText(customer && customer.id);
    const email = normalizeText(customer && customer.email).toLowerCase();
    const byId = storeId && customerId ? totalsByCustomerKey[`${storeId}:id:${customerId}`] : null;
    const byEmail = storeId && email ? totalsByCustomerKey[`${storeId}:email:${email}`] : null;
    const total = byId || byEmail;

    if (!total) {
      return customer;
    }

    return {
      ...customer,
      total_sales: formatMoney(total.amount, total.currency),
      total_sales_raw: total.amount,
    };
  });
}

async function finalizePrestaShopSidebarData(context) {
  const { customersMap, ordersMap, storeErrors, stores, includeOrderData, groupCache } = context;
  const storeMap = {};
  stores.forEach((store) => {
    storeMap[normalizeText(store.id)] = store;
  });

  const customersByStore = {};
  Array.from(customersMap.values()).filter(hasPrestaShopCustomerIdentity).forEach((customer) => {
    const storeId = normalizeText(customer && customer.store_id);
    if (!customersByStore[storeId]) {
      customersByStore[storeId] = [];
    }
    customersByStore[storeId].push(customer);
  });

  let customers = [];
  for (const storeId of Object.keys(customersByStore)) {
    const store = storeMap[storeId];
    customers = customers.concat(store ? await enrichPrestaShopCustomers(store, customersByStore[storeId], groupCache) : customersByStore[storeId]);
  }

  const enrichedOrders = [];
  if (includeOrderData) {
    for (const order of Array.from(ordersMap.values())) {
      const store = storeMap[normalizeText(order && order.store_id)];
      enrichedOrders.push(store ? await enrichPrestaShopOrder(store, order) : order);
    }
  }

  customers = applyOrderTotalsToCustomers(customers, enrichedOrders);

  return {
    customers,
    orders: includeOrderData ? sortByDateDescending(enrichedOrders, (item) => item.created_at) : [],
    store_errors: storeErrors,
    stores_scanned: stores.length,
  };
}

async function collectGlobalPrestaShopSearchData(settings, options) {
  const stores = await getSecurePrestaShopStores(settings);
  const flags = getPrestaShopFeatureFlags(settings);
  const includeOrderData = flags.show_order_data_in_order_tab;
  const query = normalizeText(options && options.search_query);
  const customersMap = new Map();
  const ordersMap = new Map();
  const storeErrors = [];
  const groupCache = {};

  if (!query) {
    return await finalizePrestaShopSidebarData({ customersMap, ordersMap, storeErrors, stores, includeOrderData, groupCache });
  }

  const looksLikeEmail = query.includes("@");
  for (const store of stores) {
    try {
      if (looksLikeEmail) {
        const customers = await searchStoreCustomersByEmail(store, query);
        customers.forEach((customer) => {
          const key = normalizeText(customer.id) || normalizeText(customer.email).toLowerCase();
          if (key) {
            customersMap.set(`${store.id}:${key}`, customer);
          }
        });
      }

      if (includeOrderData) {
        const searchQueries = looksLikeEmail ? getRelatedWebhookEmails(query) : [query];
        for (const searchQuery of searchQueries) {
          const orders = await searchStoreOrders(store, searchQuery);
          orders.forEach((order) => {
            const matchesQuery = looksLikeEmail ? orderBelongsToContactScope(order, query, []) : orderMatchesOrderIdentifier(order, query);
            if (!order.id || !matchesQuery) {
              return;
            }
            ordersMap.set(`${store.id}:${order.id}`, order);
            const guestCustomer = normalizeGuestCustomerFromOrder(store, order);
            if (guestCustomer && !storeHasRegisteredCustomerEmail(customersMap, store.id, guestCustomer.email)) {
              customersMap.set(`${store.id}:${guestCustomer.id}`, guestCustomer);
            }
          });
        }
      }
    } catch (error) {
      storeErrors.push({
        store_id: normalizeText(store.id),
        store_name: normalizeText(store.store_name),
        message: extractErrorMessage(error, "Unable to load data from this store."),
      });
    }
  }

  return await finalizePrestaShopSidebarData({ customersMap, ordersMap, storeErrors, stores, includeOrderData, groupCache });
}

async function collectPrestaShopSidebarData(settings, options) {
  if (normalizeText(options && options.search_scope) === "global") {
    return collectGlobalPrestaShopSearchData(settings, options);
  }

  const stores = await getSecurePrestaShopStores(settings);
  const flags = getPrestaShopFeatureFlags(settings);
  const includeOrderData = flags.show_order_data_in_order_tab;
  const requesterEmail = normalizeText(options && options.requester_email);
  const manualQuery = normalizeText(options && options.search_query);
  const queryType = normalizeText(options && options.search_type) || "auto";
  const customersMap = new Map();
  const ordersMap = new Map();
  const storeErrors = [];
  const groupCache = {};

  for (const store of stores) {
    try {
      let customerResults = [];
      const orderResults = [];

      if (requesterEmail) {
        customerResults = customerResults.concat(await searchStoreCustomersByEmail(store, requesterEmail));
      }

      if (manualQuery && queryType === "email" && requesterEmail && manualQuery.toLowerCase() === requesterEmail.toLowerCase()) {
        customerResults = customerResults.concat(await searchStoreCustomersByEmail(store, manualQuery));
      }

      customerResults.forEach((customer) => {
        const key = normalizeText(customer.id) || normalizeText(customer.email).toLowerCase();
        if (key) {
          customersMap.set(`${store.id}:${key}`, customer);
        }
      });
      const storeScopedCustomers = Array.from(customersMap.values()).filter((customer) => normalizeText(customer && customer.store_id) === normalizeText(store.id));

      if (includeOrderData && requesterEmail) {
        for (const customer of storeScopedCustomers) {
          const customerOrders = await loadStoreOrdersForCustomer(store, customer);
          customerOrders.forEach((order) => {
            if (orderBelongsToContactScope(order, requesterEmail, storeScopedCustomers)) {
              orderResults.push(order);
            }
          });
        }

        for (const searchEmail of getRelatedWebhookEmails(requesterEmail)) {
          const requesterEmailOrders = await searchStoreOrders(store, searchEmail);
          requesterEmailOrders.forEach((order) => {
            if (orderBelongsToContactScope(order, requesterEmail, storeScopedCustomers)) {
              orderResults.push(order);
            }
          });
        }

        if (manualQuery && queryType !== "email") {
          const manualOrderResults = await searchStoreOrders(store, manualQuery);
          manualOrderResults.forEach((order) => {
            if (orderBelongsToContactScope(order, requesterEmail, storeScopedCustomers) && orderMatchesSearchQuery(order, manualQuery)) {
              orderResults.push(order);
            }
          });
        }
      }

      if (includeOrderData) {
        let scopedOrderResults = orderResults;
        if (manualQuery && queryType === "email" && !contactEmailsAreRelated(manualQuery, requesterEmail)) {
          scopedOrderResults = [];
        } else if (manualQuery && queryType !== "email") {
          scopedOrderResults = orderResults.filter((order) => orderMatchesSearchQuery(order, manualQuery));
        }

        scopedOrderResults.forEach((order) => {
          if (!order.id || !orderBelongsToContactScope(order, requesterEmail, storeScopedCustomers)) {
            return;
          }
          ordersMap.set(`${store.id}:${order.id}`, order);
          const guestCustomer = normalizeGuestCustomerFromOrder(store, order);
          if (guestCustomer && !storeHasRegisteredCustomerEmail(customersMap, store.id, guestCustomer.email)) {
            customersMap.set(`${store.id}:${guestCustomer.id}`, guestCustomer);
          }
        });
      }
    } catch (error) {
      storeErrors.push({
        store_id: normalizeText(store.id),
        store_name: normalizeText(store.store_name),
        message: extractErrorMessage(error, "Unable to load data from this store."),
      });
    }
  }

  return await finalizePrestaShopSidebarData({ customersMap, ordersMap, storeErrors, stores, includeOrderData, groupCache });
}

async function fetchPrestaShopOrdersPage(store, pageSize, currentPage) {
  const safePageSize = Math.max(1, Math.min(100, Math.trunc(normalizeNumber(pageSize, 100))));
  const safeCurrentPage = Math.max(1, Math.trunc(normalizeNumber(currentPage, 1)));
  const response = await fetchPrestaShop(
    store,
    isPrestaShopExtensionApiStore(store)
      ? `/freshworks/orders?pageSize=${encodeURIComponent(String(safePageSize))}&currentPage=${encodeURIComponent(String(safeCurrentPage))}&sortField=created_at&sortDirection=DESC`
      : `/orders?${buildSearchQuery([], safePageSize, "created_at", "DESC", safeCurrentPage)}`
  );
  const orders = getPrestaShopItems(response).map((item) => normalizeOrderRecord(store, item)).filter(Boolean);
  return {
    orders,
    total_count: getPrestaShopTotalCount(response, orders.length),
  };
}

async function fetchPrestaShopDashboardOrders(store) {
  const pageSize = 100;
  const maxPages = 100;
  const firstPage = await fetchPrestaShopOrdersPage(store, pageSize, 1);
  const orders = firstPage.orders.slice();
  const totalCount = firstPage.total_count;
  const pageCount = Math.min(maxPages, Math.ceil(totalCount / pageSize));

  for (let currentPage = 2; currentPage <= pageCount; currentPage++) {
    const page = await fetchPrestaShopOrdersPage(store, pageSize, currentPage);
    orders.push(...page.orders);
  }

  return {
    orders,
    total_count: totalCount,
    complete: orders.length >= totalCount,
  };
}

function addPrestaShopDashboardRevenue(revenueByCurrency, order) {
  const currency = normalizeText(order && order.currency) || "USD";
  revenueByCurrency[currency] = (revenueByCurrency[currency] || 0) + normalizeNumber(order && order.grand_total, 0);
}

function formatPrestaShopRevenueTotals(revenueByCurrency) {
  const entries = Object.keys(revenueByCurrency || {}).sort();
  if (!entries.length) {
    return formatMoney(0, "USD");
  }

  return entries
    .map((currency) => formatMoney(revenueByCurrency[currency], currency))
    .join(" + ");
}

async function buildPrestaShopDashboardInsights(settings) {
  const stores = await getSecurePrestaShopStores(settings);
  const totals = {
    total_orders: 0,
    total_customers: 0,
    revenue_by_currency: {},
  };
  const statusCounts = {};
  const recentOrders = [];
  const storeInsights = [];

  for (const store of stores) {
    try {
      const customersPayload = await fetchPrestaShop(store, isPrestaShopExtensionApiStore(store) ? "/freshworks/customers?pageSize=20" : `/customers?${buildSearchQuery([], 20)}`);
      const customerItems = getPrestaShopItems(customersPayload);
      const customers = customerItems.map((item) => normalizeCustomerRecord(store, item)).filter(Boolean);
      const orderResult = await fetchPrestaShopDashboardOrders(store);
      const orders = orderResult.orders;
      const storeRevenueByCurrency = {};

      totals.total_customers += getPrestaShopTotalCount(customersPayload, customers.length);
      totals.total_orders += orderResult.total_count;

      orders.forEach((order) => {
        const status = normalizeText(order.status_label || order.status) || "Unknown";
        statusCounts[status] = (statusCounts[status] || 0) + 1;
        addPrestaShopDashboardRevenue(totals.revenue_by_currency, order);
        addPrestaShopDashboardRevenue(storeRevenueByCurrency, order);
        recentOrders.push(order);
      });

      storeInsights.push({
        store_id: normalizeText(store.id),
        store_name: normalizeText(store.store_name),
        orders_count: orderResult.total_count,
        customers_count: getPrestaShopTotalCount(customersPayload, customers.length),
        revenue_formatted: formatPrestaShopRevenueTotals(storeRevenueByCurrency),
        revenue_complete: orderResult.complete,
        shipment_tracking_enabled: false,
        custom_statuses_enabled: false,
      });
    } catch (error) {
      storeInsights.push({
        store_id: normalizeText(store.id),
        store_name: normalizeText(store.store_name),
        orders_count: 0,
        customers_count: 0,
        revenue_formatted: "",
        shipment_tracking_enabled: false,
        custom_statuses_enabled: false,
        error: extractErrorMessage(error, "Unable to load live store insights."),
      });
    }
  }

  return {
    totals: {
      total_orders: totals.total_orders,
      total_customers: totals.total_customers,
      total_revenue_formatted: formatPrestaShopRevenueTotals(totals.revenue_by_currency),
      shipment_tracking_enabled_stores: 0,
      custom_status_enabled_stores: 0,
    },
    status_counts: Object.keys(statusCounts).sort().map((status) => ({ status, count: statusCounts[status] })),
    recent_orders: sortByDateDescending(recentOrders, (item) => item.created_at).slice(0, 12),
    stores: storeInsights,
  };
}

function buildEventSummary(settings) {
  const connector = buildPrestaShopConnectorSummary(settings);
  return {
    freshdesk_domain: connector.summary.freshdesk_domain || "unknown",
    connected_stores: connector.summary.connected_stores,
    verified_stores: connector.summary.verified_stores,
    enabled_actions_count: connector.summary.enabled_actions_count,
    auto_install_webhooks: connector.flags.auto_install_webhooks,
  };
}

function buildFreshdeskContactPayloadFromPrestaShopCustomer(customer, store) {
  const safe = customer && typeof customer === "object" ? customer : {};
  const normalizedCustomer = normalizeCustomerRecord(store, safe);
  return {
    name: normalizedCustomer.name || "PrestaShop Customer",
    email: normalizedCustomer.email,
    phone: normalizedCustomer.phone,
    address: normalizedCustomer.shipping_address.formatted || normalizedCustomer.billing_address.formatted || "",
    description: [
      `PrestaShop store: ${normalizeText(store && store.store_name) || "Store"}`,
      `PrestaShop customer ID: ${normalizeText(safe.id || safe.entity_id) || "unknown"}`,
    ].join("\n"),
  };
}

function getFreshdeskFieldDefaults(settings, category) {
  const defaults = safeParseJson(settings && settings[FRESHDESK_FIELD_DEFAULTS_KEY], {});
  const group = defaults && defaults[category];
  return filterFreshdeskDefaultGroup(category, group);
}

function getFreshdeskFieldTypes(settings, category) {
  const types = safeParseJson(settings && settings[FRESHDESK_FIELD_TYPES_KEY], {});
  const group = types && types[category];
  return filterFreshdeskDefaultGroup(category, group);
}

function filterFreshdeskDefaultGroup(category, group) {
  if (!["ticket", "contact"].includes(category) || !group || typeof group !== "object" || Array.isArray(group)) {
    return {};
  }

  return Object.keys(group).reduce((filteredGroup, rawFieldName) => {
    const fieldName = normalizeText(rawFieldName);
    if (isFreshdeskCustomField(fieldName)) {
      filteredGroup[fieldName] = group[rawFieldName];
    }
    return filteredGroup;
  }, {});
}

function isFreshdeskCustomField(fieldName) {
  return normalizeText(fieldName).toLowerCase().startsWith("cf_");
}

function shouldApplyFreshdeskDefault(value) {
  return value === undefined || value === null || normalizeText(value) === "";
}

function normalizeFreshdeskDefaultPayloadValue(fieldName, value, fieldType) {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value === "boolean") {
    return value;
  }

  const textValue = normalizeText(value);
  if (!textValue) {
    return undefined;
  }

  if (textValue.toLowerCase() === "true") {
    return true;
  }
  if (textValue.toLowerCase() === "false") {
    return false;
  }

  if (isFreshdeskNumericField(fieldName, fieldType)) {
    const numericValue = Number(textValue);
    if (Number.isFinite(numericValue)) {
      return numericValue;
    }
  }

  return textValue;
}

function isFreshdeskNumericField(fieldName, fieldType) {
  const normalizedFieldName = normalizeText(fieldName);
  if (normalizedFieldName.startsWith("cf_")) {
    return /number|decimal|integer|numeric/i.test(fieldType || "");
  }
  return /(^|_)(id|status|priority|source)$/.test(normalizedFieldName);
}

function applyFreshdeskFieldDefaults(settings, category, payload) {
  const defaults = getFreshdeskFieldDefaults(settings, category);
  const types = getFreshdeskFieldTypes(settings, category);
  const targetPayload = payload && typeof payload === "object" ? payload : {};

  Object.keys(defaults).forEach((rawFieldName) => {
    const fieldName = normalizeText(rawFieldName);
    const value = normalizeFreshdeskDefaultPayloadValue(fieldName, defaults[rawFieldName], types[fieldName]);
    if (!fieldName || value === undefined) {
      return;
    }

    if (fieldName.startsWith("cf_")) {
      if (!targetPayload.custom_fields || typeof targetPayload.custom_fields !== "object") {
        targetPayload.custom_fields = {};
      }
      if (shouldApplyFreshdeskDefault(targetPayload.custom_fields[fieldName])) {
        targetPayload.custom_fields[fieldName] = value;
      }
      return;
    }

    if (shouldApplyFreshdeskDefault(targetPayload[fieldName])) {
      targetPayload[fieldName] = value;
    }
  });

  return targetPayload;
}

function cloneFreshdeskTicketPayload(payload) {
  const safePayload = payload && typeof payload === "object" ? payload : {};
  return {
    ...safePayload,
    custom_fields: {
      ...(safePayload.custom_fields && typeof safePayload.custom_fields === "object" ? safePayload.custom_fields : {}),
    },
  };
}

function getFreshdeskMissingCustomFieldFallback(errorItem) {
  const message = normalizeText(errorItem && (errorItem.message || errorItem.description || errorItem.error)).toLowerCase();

  if (/valid date|yyyy-mm-dd|date/.test(message)) {
    return new Date().toISOString().slice(0, 10);
  }

  if (/integer|number|numeric|decimal/.test(message)) {
    return 0;
  }

  if (/boolean|true|false/.test(message)) {
    return false;
  }

  if (/string|text/.test(message)) {
    return "PrestaShop event";
  }

  return undefined;
}

function applyFreshdeskMissingFieldFallbacks(payload, error) {
  const errors = error && error.body && Array.isArray(error.body.errors) ? error.body.errors : [];
  const retryPayload = cloneFreshdeskTicketPayload(payload);
  const filledFields = [];

  errors.forEach((errorItem) => {
    const fieldPath = normalizeText(errorItem && (errorItem.field || errorItem.name || errorItem.attribute));
    const fieldMatch = /^custom_fields\.(cf_[a-z0-9_]+)$/i.exec(fieldPath);
    const isMissingField = normalizeText(errorItem && errorItem.code).toLowerCase() === "missing_field";
    if (!fieldMatch || !isMissingField) {
      return;
    }

    const fieldName = fieldMatch[1];
    if (!shouldApplyFreshdeskDefault(retryPayload.custom_fields[fieldName])) {
      return;
    }

    const fallbackValue = getFreshdeskMissingCustomFieldFallback(errorItem);
    if (fallbackValue === undefined) {
      return;
    }

    retryPayload.custom_fields[fieldName] = fallbackValue;
    filledFields.push(fieldName);
  });

  return filledFields.length ? { payload: retryPayload, fields: filledFields } : null;
}

async function postFreshdeskTicketWithRequiredFieldFallbacks(settings, payload) {
  const defaultedPayload = applyFreshdeskFieldDefaults(settings, "ticket", payload);

  try {
    return await postFreshdesk(settings, "/api/v2/tickets", defaultedPayload);
  } catch (error) {
    const fallback = applyFreshdeskMissingFieldFallbacks(defaultedPayload, error);
    if (!fallback) {
      throw error;
    }

    console.log(`[PrestaShopConnector] Retrying Freshdesk ticket creation with fallback defaults for hidden required fields: ${fallback.fields.join(", ")}.`);
    return await postFreshdesk(settings, "/api/v2/tickets", fallback.payload);
  }
}

async function syncFreshdeskContactForPrestaShopCustomer(settings, store, customer) {
  const domain = normalizeDomain(settings && settings.domain);
  const customerId = normalizeText(customer && (customer.id || customer.entity_id));
  const payload = applyFreshdeskFieldDefaults(
    settings,
    "contact",
    buildFreshdeskContactPayloadFromPrestaShopCustomer(customer, store)
  );

  if (!payload.email) {
    throw new Error("Customer email is required to sync a Freshdesk contact.");
  }

  const mappedContactId = customerId ? await getMappedFreshdeskContactId(domain, store.id, customerId) : "";
  if (mappedContactId) {
    try {
      const updatedContact = unwrapFreshdeskContact(await putFreshdesk(settings, `/api/v2/contacts/${encodeURIComponent(mappedContactId)}`, payload));
      await setMappedFreshdeskContactId(domain, store.id, customerId, updatedContact && updatedContact.id ? updatedContact.id : mappedContactId);
      return { action: "updated", contact: updatedContact };
    } catch {
      // Fall through to lookup by email.
    }
  }

  const existingContact = await findFreshdeskContactByEmail(settings, payload.email);
  if (existingContact && existingContact.id) {
    const updatedContact = unwrapFreshdeskContact(await putFreshdesk(settings, `/api/v2/contacts/${encodeURIComponent(existingContact.id)}`, payload));
    if (customerId) {
      await setMappedFreshdeskContactId(domain, store.id, customerId, existingContact.id);
    }
    return { action: "updated", contact: updatedContact };
  }

  const createdContact = unwrapFreshdeskContact(await postFreshdesk(settings, "/api/v2/contacts", payload));
  if (customerId && createdContact && createdContact.id) {
    await setMappedFreshdeskContactId(domain, store.id, customerId, createdContact.id);
  }
  return { action: "created", contact: createdContact };
}

function getPrestaShopCustomerEmail(customer) {
  return normalizeText(customer && customer.email);
}

function getPrestaShopCustomerName(customer) {
  return [normalizeText(customer && (customer.firstname || customer.first_name)), normalizeText(customer && (customer.lastname || customer.last_name))].filter(Boolean).join(" ");
}

function buildCustomerCreatedTicketDescription(customer, store) {
  const normalizedCustomer = normalizeCustomerRecord(store, customer);
  const registered = formatTicketDateTime(normalizedCustomer.registration_date);
  const billingAddress = escapeTicketHtml(normalizedCustomer.billing_address.formatted || "Not available").replace(/\n/g, "<br>");
  const shippingAddress = escapeTicketHtml(normalizedCustomer.shipping_address.formatted || "Not available").replace(/\n/g, "<br>");

  return [
    `A new PrestaShop customer was created in ${escapeTicketHtml(normalizedCustomer.store_name)}.`,
    "",
    `<strong>Customer:</strong> ${escapeTicketHtml(normalizedCustomer.name)}`,
    `<strong>Email:</strong> ${escapeTicketHtml(normalizedCustomer.email || "Not available")}`,
    `<strong>Registered:</strong> ${escapeTicketHtml(registered || "Not available")}`,
    `<strong>Country:</strong> ${escapeTicketHtml(normalizedCustomer.country || "Not available")}`,
    "",
    `<strong>Billing address:</strong>`,
    billingAddress,
    "",
    `<strong>Shipping address:</strong>`,
    shippingAddress,
  ].join("<br>");
}

function buildOrderCreatedTicketDescription(order, store) {
  const normalizedOrder = normalizeOrderRecord(store, order);
  const created = formatTicketDateTime(normalizedOrder.created_at);
  const productLines = normalizedOrder.items.length
    ? normalizedOrder.items.map((item) => `&bull; ${escapeTicketHtml(item.name)} x${escapeTicketHtml(item.quantity)} (${escapeTicketHtml(item.total_formatted || item.total || "N/A")})`)
    : ["No products returned"];
  const shippingAddress = escapeTicketHtml(normalizedOrder.shipping_address.formatted || "Not available").replace(/\n/g, "<br>");

  return [
    `A new PrestaShop order was created in ${escapeTicketHtml(normalizedOrder.store_name)}.`,
    "",
    `<strong>Order:</strong> #${escapeTicketHtml(normalizedOrder.order_number)}`,
    `<strong>Status:</strong> ${escapeTicketHtml(normalizedOrder.status_label || normalizedOrder.status || "Unknown")}`,
    `<strong>Created:</strong> ${escapeTicketHtml(created || "Not available")}`,
    `<strong>Total:</strong> ${escapeTicketHtml(normalizedOrder.grand_total_formatted || "Not available")}`,
    `<strong>Payment:</strong> ${escapeTicketHtml(normalizedOrder.payment_method || "Not available")}`,
    `<strong>Shipping:</strong> ${escapeTicketHtml(normalizedOrder.shipping_method || "Not available")}`,
    "",
    "<strong>Products:</strong>",
    ...productLines,
    "",
    "<strong>Shipping address:</strong>",
    shippingAddress,
  ].join("<br>");
}

async function createFreshdeskTicketForPrestaShopEvent(settings, options) {
  const requesterId = normalizeFreshdeskRequesterId(options && options.requester_id);
  const email = normalizeText(options && options.email);
  const name = normalizeText(options && options.name).slice(0, 30);

  if (!requesterId && !email) {
    throw new Error("Freshdesk ticket creation requires a requester or email.");
  }

  const payload = {
    subject: normalizeText(options && options.subject) || "PrestaShop event",
    description: normalizeText(options && options.description) || "PrestaShop event received.",
    status: 2,
    priority: 1,
  };

  if (requesterId) {
    payload.requester_id = requesterId;
  } else {
    payload.email = email;
    if (name) {
      payload.name = name;
    }
  }

  return unwrapFreshdeskTicket(
    await postFreshdeskTicketWithRequiredFieldFallbacks(settings, payload)
  );
}

async function processPrestaShopCustomerEvent(settings, store, customer, topic) {
  const flags = getPrestaShopFeatureFlags(settings);
  const shouldSyncContact = topic === "customer.created"
    ? flags.sync_contact_on_customer_created
    : flags.sync_contact_on_customer_updated;
  const shouldCreateTicket = topic === "customer.created" && flags.sync_ticket_on_customer_created;

  let syncedContact = null;
  if (shouldSyncContact) {
    syncedContact = await syncFreshdeskContactForPrestaShopCustomer(settings, store, customer);
  }

  if (shouldCreateTicket) {
    const customerId = normalizeText(customer && (customer.id || customer.entity_id));
    const contactId = syncedContact && syncedContact.contact && syncedContact.contact.id ? normalizeText(syncedContact.contact.id) : "";
    const ticket = await createFreshdeskTicketForPrestaShopEvent(settings, {
      requester_id: contactId,
      email: getPrestaShopCustomerEmail(customer),
      name: getPrestaShopCustomerName(customer),
      subject: `New PrestaShop customer in ${normalizeText(store && store.store_name) || "Store"}`,
      description: buildCustomerCreatedTicketDescription(customer, store),
    });
    await setMappedTicket(settings && settings.domain, CUSTOMER_TICKET_LINK_KEY_PREFIX, store.id, customerId, ticket);
  }
}

async function processPrestaShopOrderCreatedEvent(settings, store, order, options) {
  const flags = getPrestaShopFeatureFlags(settings);
  if (!flags.sync_ticket_on_order_created) {
    console.log("[PrestaShopConnector] Skipped order-created ticket sync because the feature is disabled.");
    return;
  }

  const attempt = Math.max(0, Math.trunc(normalizeNumber(options && options.attempt, 0)));

  const orderId = normalizeText(order && (order.entity_id || order.id));
  if (!orderId) {
    console.log("[PrestaShopConnector] Skipped order-created ticket sync because the PrestaShop order id was missing.");
    return;
  }

  let fullOrder = order;
  try {
    const reloadedOrder = await fetchPrestaShop(
      store,
      isPrestaShopExtensionApiStore(store) ? `/freshworks/orders/${encodeURIComponent(orderId)}` : `/orders/${encodeURIComponent(orderId)}`
    );
    fullOrder = mergePrestaShopOrderPayload(reloadedOrder, order);
  } catch (error) {
    console.error(`[PrestaShopConnector] Could not reload PrestaShop order ${orderId} before ticket creation; using event payload:`, error);
  }

  const normalizedOrder = normalizeOrderRecord(store, fullOrder);
  const ticketSubject = `New PrestaShop order #${normalizeText(normalizedOrder.order_number)} in ${normalizeText(store && store.store_name) || "Store"}`;
  console.log(
    `[PrestaShopConnector] Processing order.created for store=${normalizeText(store && store.id) || "(missing)"} order_id=${orderId || "(missing)"} order_number=${normalizeText(normalizedOrder.order_number) || "(missing)"} customer_id=${normalizeText(normalizedOrder.customer_id) || "(missing)"} email=${normalizeText(normalizedOrder.customer_email) || "(missing)"}`
  );
  const existingMappedTicket = await getMappedTicket(settings && settings.domain, ORDER_TICKET_LINK_KEY_PREFIX, store.id, orderId);
  if (existingMappedTicket) {
    await removePrestaShopOrderTicketRetrySchedule(store && store.id, orderId);
    console.log(`[PrestaShopConnector] Skipped order-created ticket sync because order ${orderId} is already mapped to ticket ${normalizeText(existingMappedTicket.ticket_id) || "(unknown)"}.`);
    return;
  }

  const requesterId = normalizedOrder.customer_id
    ? await getMappedFreshdeskContactId(settings && settings.domain, store.id, normalizedOrder.customer_id)
    : "";
  const email = normalizedOrder.customer_email;

  if (!requesterId && !email) {
    await clearMappedTicket(settings && settings.domain, ORDER_TICKET_LINK_KEY_PREFIX, store.id, orderId);
    if (attempt < ORDER_TICKET_RETRY_MAX_ATTEMPTS) {
      await schedulePrestaShopOrderTicketRetry(
        settings,
        store,
        orderId,
        attempt + 1,
        "no requester email/contact was available yet"
      );
      console.log(
        `[PrestaShopConnector] Deferred order-created ticket sync for order ${orderId} because no requester email/contact was available on attempt ${attempt + 1}.`
      );
      return;
    }

    await removePrestaShopOrderTicketRetrySchedule(store && store.id, orderId);
    console.log(
      `[PrestaShopConnector] Skipped order-created ticket sync for order ${orderId} after ${ORDER_TICKET_RETRY_MAX_ATTEMPTS} attempts because no requester email/contact was available.`
    );
    return;
  }

  console.log(
    `[PrestaShopConnector] Creating Freshdesk ticket for PrestaShop order ${orderId} using requester_id=${requesterId || "(none)"} email=${email || "(none)"}`
  );

  let ticket;
  try {
    ticket = await createFreshdeskTicketForPrestaShopEvent(settings, {
      requester_id: requesterId,
      email,
      name: normalizeText(normalizedOrder.billing_address && `${normalizedOrder.billing_address.first_name} ${normalizedOrder.billing_address.last_name}`),
      subject: ticketSubject,
      description: buildOrderCreatedTicketDescription(fullOrder, store),
    });
  } catch (error) {
    console.error(
      `[PrestaShopConnector] Freshdesk ticket creation failed for PrestaShop order ${orderId}: ${extractErrorMessage(error, "Unknown error.")}`
    );
    throw error;
  }

  await setMappedTicket(settings && settings.domain, ORDER_TICKET_LINK_KEY_PREFIX, store.id, orderId, ticket);
  await removePrestaShopOrderTicketRetrySchedule(store && store.id, orderId);
  console.log(`[PrestaShopConnector] Created Freshdesk ticket ${normalizeText(ticket && ticket.id) || "(unknown)"} for PrestaShop order ${orderId}.`);
}

function normalizePrestaShopSourceUrl(value) {
  const rawValue = normalizeText(value);
  if (!rawValue) {
    return "";
  }

  try {
    const parsed = new URL(rawValue);
    return `${parsed.host}${parsed.pathname}`.replace(/\/+$/, "");
  } catch {
    return normalizeDomain(rawValue);
  }
}

function findStoreByEventSource(stores, sourceUrl) {
  const safeStores = Array.isArray(stores) ? stores : [];
  const normalizedSource = normalizePrestaShopSourceUrl(sourceUrl);
  if (!normalizedSource) {
    return safeStores[0] || null;
  }

  const matchedStore = safeStores.find((store) => {
    const endpoint = resolvePrestaShopStoreEndpoint(store);
    if (!endpoint) {
      return false;
    }

    const storeSource = `${endpoint.host}${endpoint.pathPrefix || ""}`.replace(/\/+$/, "");
    return normalizedSource === storeSource || normalizedSource.startsWith(storeSource);
  });

  if (matchedStore) {
    return matchedStore;
  }

  if (safeStores.length === 1) {
    console.log(`[PrestaShopConnector] Event source ${normalizedSource} did not match the saved store URL; using the only configured PrestaShop store.`);
    return safeStores[0];
  }

  return null;
}

function getExternalEventBody(payload) {
  const body = payload && payload.data;
  return body && typeof body === "object" ? body : {};
}

function getExternalEventData(eventBody) {
  return eventBody && eventBody.data && typeof eventBody.data === "object" ? eventBody.data : eventBody;
}

function listObjectKeys(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? Object.keys(value).slice(0, 20) : [];
}

function parseExternalEventBodyCandidate(value) {
  if (value && typeof value === "object") {
    return value;
  }
  if (typeof value === "string") {
    return safeParseJson(value, null);
  }
  return null;
}

function buildExternalEventPayloadDiagnostics(payload) {
  const payloadObject = payload && typeof payload === "object" ? payload : {};
  const dataCandidate = parseExternalEventBodyCandidate(payloadObject.data);
  const bodyCandidate = parseExternalEventBodyCandidate(payloadObject.body);

  return {
    payload_keys: listObjectKeys(payloadObject),
    payload_topic: normalizeText(payloadObject.topic),
    data_type: Array.isArray(payloadObject.data) ? "array" : typeof payloadObject.data,
    data_keys: listObjectKeys(payloadObject.data),
    data_topic: normalizeText(dataCandidate && dataCandidate.topic),
    data_data_keys: listObjectKeys(dataCandidate && dataCandidate.data),
    data_order_keys: listObjectKeys((dataCandidate && dataCandidate.data && dataCandidate.data.order) || (dataCandidate && dataCandidate.order)),
    body_type: Array.isArray(payloadObject.body) ? "array" : typeof payloadObject.body,
    body_keys: listObjectKeys(payloadObject.body),
    body_topic: normalizeText(bodyCandidate && bodyCandidate.topic),
    body_data_keys: listObjectKeys(bodyCandidate && bodyCandidate.data),
    body_order_keys: listObjectKeys((bodyCandidate && bodyCandidate.data && bodyCandidate.data.order) || (bodyCandidate && bodyCandidate.order)),
  };
}

async function findSecureStoreById(settings, storeId) {
  const stores = await getSecurePrestaShopStores(settings);
  const normalizedStoreId = normalizeText(storeId);
  const store = stores.find((item) => normalizeText(item.id) === normalizedStoreId);
  if (!store) {
    const availableStoreIds = stores.map((item) => normalizeText(item.id)).filter(Boolean).join(", ") || "none";
    throw new Error(`PrestaShop store ${normalizedStoreId || "(missing)"} could not be found. Available stores: ${availableStoreIds}.`);
  }
  return store;
}

async function loadPrestaShopOrder(store, orderId) {
  const orderPayload = await fetchPrestaShop(store, isPrestaShopExtensionApiStore(store) ? `/freshworks/orders/${encodeURIComponent(normalizeText(orderId))}` : `/orders/${encodeURIComponent(normalizeText(orderId))}`);
  return normalizeOrderRecord(store, orderPayload);
}

function normalizeOrderNote(note) {
  const safe = note && typeof note === "object" ? note : {};
  return {
    id: normalizeText(safe.entity_id || safe.id),
    author: normalizeText(safe.author) || "PrestaShop",
    note: normalizeText(safe.comment),
    customer_note: normalizeBoolean(safe.is_visible_on_front, false),
    created_at: normalizeDateString(safe.created_at || safe.createdAt),
  };
}

async function listPrestaShopOrderNotes(store, orderId) {
  if (!isPrestaShopExtensionApiStore(store)) {
    return [];
  }
  const response = await fetchPrestaShop(store, `/freshworks/orders/${encodeURIComponent(normalizeText(orderId))}/comments`);
  const items = getPrestaShopItems(response);
  return items.map((note) => normalizeOrderNote(note)).filter((note) => note.id || note.note);
}

function normalizeShippingPayload(input) {
  const safe = input && typeof input === "object" ? input : {};
  return {
    firstname: normalizeText(safe.first_name),
    lastname: normalizeText(safe.last_name),
    company: normalizeText(safe.company),
    street: [normalizeText(safe.address_1), normalizeText(safe.address_2)].filter(Boolean),
    city: normalizeText(safe.city),
    region: normalizeText(safe.state),
    postcode: normalizeText(safe.postcode),
    country_id: normalizeText(safe.country),
    telephone: normalizeText(safe.phone),
  };
}

function validateShippingPayload(shipping) {
  if (!normalizeText(shipping.street && shipping.street[0])) {
    return "Shipping address line 1 is required.";
  }
  if (!normalizeText(shipping.city)) {
    return "Shipping city is required.";
  }
  if (!normalizeText(shipping.postcode)) {
    return "Shipping postal code is required.";
  }
  if (!normalizeText(shipping.country_id)) {
    return "Shipping country is required.";
  }
  if (!normalizeText(shipping.telephone)) {
    return "Shipping phone is required.";
  }
  return "";
}

function buildPrestaShopExtensionShippingPayload(shipping) {
  const street = Array.isArray(shipping && shipping.street) ? shipping.street : [];
  return {
    firstname: normalizeText(shipping && shipping.firstname),
    lastname: normalizeText(shipping && shipping.lastname),
    company: normalizeText(shipping && shipping.company),
    street1: normalizeText(street[0]),
    street2: normalizeText(street[1]),
    city: normalizeText(shipping && shipping.city),
    region: normalizeText(shipping && shipping.region),
    regionId: normalizeText(shipping && shipping.region_id),
    postcode: normalizeText(shipping && shipping.postcode),
    countryId: normalizeText(shipping && shipping.country_id),
    telephone: normalizeText(shipping && shipping.telephone),
  };
}

exports = {
  async onAppInstall(payload) {
    try {
      const settings = resolveSettings(payload);
      const summary = buildEventSummary(settings);
      console.log(`[PrestaShopConnector] Build marker ${APP_BUILD_MARKER}`);
      await writeSecurePrestaShopStoresFromSettings(settings);
      const registry = await preparePrestaShopWebhookAutoInstall(settings);
      console.log(
        `[PrestaShopConnector] Installed for ${summary.connected_stores} configured store(s); webhook callback ${describePrestaShopWebhookCallbackStatus(settings, registry)}.`
      );
      return renderData();
    } catch (error) {
      console.error("PrestaShopConnector install initialization failed:", error);
      return renderData({ message: extractErrorMessage(error, "PrestaShopConnector install setup failed.").slice(0, 60) });
    }
  },

  async afterAppUpdate(payload) {
    try {
      const settings = resolveSettings(payload);
      const summary = buildEventSummary(settings);
      console.log(`[PrestaShopConnector] Build marker ${APP_BUILD_MARKER}`);
      await writeSecurePrestaShopStoresFromSettings(settings);
      const registry = await preparePrestaShopWebhookAutoInstall(settings);
      console.log(
        `[PrestaShopConnector] Updated with ${summary.connected_stores} configured store(s); webhook callback ${describePrestaShopWebhookCallbackStatus(settings, registry)}.`
      );
      return renderData();
    } catch (error) {
      console.error("PrestaShopConnector update initialization failed:", error);
      return renderData({ message: extractErrorMessage(error, "PrestaShopConnector update setup failed.").slice(0, 60) });
    }
  },

  async onAppUninstall(payload) {
    try {
      const settings = resolveSettings(payload);
      const domain = settings && settings.domain;
      await removePrestaShopWebhookAutoInstallSchedule();
      await clearSecurePrestaShopStores(domain);
      await deleteDbKeyIfPresent(buildDbKey(WEBHOOK_REGISTRY_KEY_PREFIX, domain));
      await deleteDbKeyIfPresent(buildDbKey(CONTACT_LINK_KEY_PREFIX, domain));
      await deleteDbKeyIfPresent(buildDbKey(CUSTOMER_TICKET_LINK_KEY_PREFIX, domain));
      await deleteDbKeyIfPresent(buildDbKey(ORDER_TICKET_LINK_KEY_PREFIX, domain));
      return renderData();
    } catch (error) {
      console.error("PrestaShopConnector uninstall cleanup failed:", error);
      return renderData();
    }
  },

  async onExternalEvent(payload) {
    try {
      const settings = resolveSettings(payload);
      const headers = normalizeHeaders(payload && payload.headers);
      console.log(`[PrestaShopConnector] Build marker ${APP_BUILD_MARKER}`);
      console.log(
        `[PrestaShopConnector] External event payload diagnostics ${JSON.stringify(buildExternalEventPayloadDiagnostics(payload))}`
      );
      const eventBody = getExternalEventBody(payload);
      const rawTopic = normalizeText(
        headers["x-prestashop-topic"] ||
          headers["x-adobe-commerce-event-code"] ||
          headers["x-event-topic"] ||
          headers["x-event-name"] ||
          eventBody.topic ||
          eventBody.scope ||
          eventBody.data && eventBody.data.scope ||
          payload && payload.topic
      ).toLowerCase();
      const topic = rawTopic
        .replace(/^prestashop\./, "")
        .replace(/^commerce\./, "")
        .replace("customer.save.after", "customer.updated")
        .replace("customer.created", "customer.created")
        .replace("sales_order_place_after", "order.created");
      const source = normalizeText(headers["x-prestashop-source"] || headers["x-adobe-commerce-source"] || eventBody.source || payload && payload.source);
      const eventData = getExternalEventData(eventBody);
      const stores = await getSecurePrestaShopStores(settings);
      const store = findStoreByEventSource(stores, source);
      const eventOrder = eventData && eventData.order ? eventData.order : eventData;
      const eventCustomer = eventData && eventData.customer ? eventData.customer : eventData;

      console.log(
        `[PrestaShopConnector] External event received topic=${topic || "(missing)"} source=${source || "(missing)"} store=${normalizeText(store && store.id) || "(unresolved)"} order_id=${normalizeText(eventOrder && (eventOrder.entity_id || eventOrder.id)) || "(missing)"} customer_id=${normalizeText(eventCustomer && (eventCustomer.id || eventCustomer.entity_id || eventCustomer.customer_id)) || "(missing)"}`
      );

      if (!topic || !store) {
        console.log(`[PrestaShopConnector] Received external event but could not resolve topic/store. topic=${topic || "(missing)"} source=${source || "(missing)"} stores=${stores.length}`);
        return renderData();
      }

      if (topic === "customer.created" || topic === "customer.updated") {
        await processPrestaShopCustomerEvent(settings, store, eventData.customer || eventData, topic);
      } else if (topic === "order.created") {
        await processPrestaShopOrderCreatedEvent(settings, store, eventData.order || eventData);
      } else {
        console.log(`[PrestaShopConnector] Ignored unsupported event topic: ${topic}`);
      }

      return renderData();
    } catch (error) {
      console.error("PrestaShopConnector external event handling failed:", error);
      return renderData();
    }
  },

  async onScheduledEvent(payload) {
    try {
      const settings = resolveSettings(payload);
      const scheduleData = payload && payload.data && typeof payload.data === "object" ? payload.data : {};
      const effectiveSettings = normalizeDomain(settings && settings.domain)
        ? settings
        : scheduleData;

      if (normalizeText(scheduleData.job_type) === "prestashop_order_ticket_retry") {
        const retryStore = await findSecureStoreById(effectiveSettings, scheduleData.store_id);
        await processPrestaShopOrderCreatedEvent(
          effectiveSettings,
          retryStore,
          { entity_id: scheduleData.order_id },
          { attempt: scheduleData.attempt }
        );
        return;
      }

      await ensureAutoPrestaShopWebhooksInstalled(effectiveSettings);
    } catch (error) {
      console.error("PrestaShopConnector scheduled webhook auto-install failed:", error);
    }
  },

  async getDashboardData(args) {
    try {
      const requestArgs = parseArgs(args);
      const settings = resolveSettings(requestArgs);
      // Fast path when an admin opens the dashboard; the scheduled event is the
      // navigation-independent fallback and no-ops once pending is cleared.
      await ensureAutoPrestaShopWebhooksInstalled(settings);
      const connector = buildPrestaShopConnectorSummary(settings);
      const liveInsights = await buildPrestaShopDashboardInsights(settings);
      return buildSuccess({
        summary: connector.summary,
        stores: connector.stores,
        features: connector.features,
        flags: connector.flags,
        live_insights: liveInsights,
      });
    } catch (error) {
      return buildFailure("Unable to load connector dashboard data.", error);
    }
  },

  async getSidebarData(args) {
    try {
      const requestArgs = parseArgs(args);
      const ticketId = normalizeText(requestArgs.ticket_id);
      const settings = resolveSettings(requestArgs);
      const connector = buildPrestaShopConnectorSummary(settings);
      const requesterEmail =
        normalizeText(requestArgs.requester_email) ||
        await resolveRequesterEmailFromFreshdesk(settings, requestArgs.requester_id, ticketId);
      const sidebarData = await collectPrestaShopSidebarData(settings, {
        requester_email: requesterEmail,
        search_query: requestArgs.search_query,
        search_type: requestArgs.search_type,
        search_scope: requestArgs.search_scope,
      });

      return buildSuccess({
        ticket_id: ticketId,
        requester_email: requesterEmail,
        summary: {
          ...connector.summary,
          stores_scanned: sidebarData.stores_scanned,
          matched_customers: sidebarData.customers.length,
          matched_orders: sidebarData.orders.length,
        },
        stores: connector.stores,
        features: connector.features,
        flags: connector.flags,
        customers: sidebarData.customers,
        orders: sidebarData.orders,
        store_errors: sidebarData.store_errors,
      });
    } catch (error) {
      return buildFailure("Unable to load PrestaShop connector details.", error);
    }
  },

  async persistPrestaShopStoresSecurely(args) {
    try {
      const requestArgs = parseArgs(args);
      const domain = normalizeDomain(requestArgs.domain);
      const stores = safeParseJson(requestArgs.prestashop_stores, requestArgs.prestashop_stores);
      if (!domain) {
        return buildFailure("Freshdesk domain is required.");
      }
      if (!Array.isArray(stores) || !stores.length) {
        return buildFailure("At least one PrestaShop store is required.");
      }
      const normalizedStores = await writeSecurePrestaShopStores(domain, stores);
      return buildSuccess({
        stored_count: normalizedStores.length,
      });
    } catch (error) {
      return buildFailure("Unable to securely store PrestaShop credentials.", error);
    }
  },

  async reconnectPrestaShopSync(args) {
    try {
      const requestArgs = parseArgs(args);
      const settings = resolveSettings(requestArgs);
      const domain = normalizeDomain(requestArgs.domain || settings.domain);
      if (!domain) {
        return buildFailure("Freshdesk domain is required.");
      }
      const secureStores = await readSecurePrestaShopStores(domain);
      if (!secureStores.length) {
        return buildFailure("PrestaShop credentials are not saved yet. Save the app settings with validated PrestaShop credentials, then repair sync.");
      }
      const targetUrl = await ensurePrestaShopEventCallbackUrl(domain);
      const installResult = await installPrestaShopExtensionWebhooksForStores(secureStores, targetUrl);
      await recordPrestaShopWebhookAutoInstallResult(domain, {}, targetUrl, installResult);
      const failedCount = installResult.errors.length;
      const installText = installResult.installed_count
        ? ` Installed callback automatically for ${installResult.installed_count} PrestaShop extension store(s).`
        : " Copy the callback URL into PrestaShop if automatic installation is not available for this store.";
      return buildSuccess({
        message: `PrestaShop sync settings repaired successfully.${installText}${failedCount ? ` ${failedCount} store(s) could not be auto-configured.` : ""} Callback URL: ${targetUrl}`,
        target_url: targetUrl,
        installed_count: installResult.installed_count,
        install_errors: installResult.errors,
        enabled_topic_count: 3,
        store_count: secureStores.length,
      });
    } catch (error) {
      return buildFailure("Unable to reconnect PrestaShop sync.", error);
    }
  },

  async getPrestaShopOrderNotes(args) {
    try {
      const requestArgs = parseArgs(args);
      const settings = resolveSettings(requestArgs);
      const store = await findSecureStoreById(settings, requestArgs.store_id);
      const orderId = normalizeText(requestArgs.order_id);
      if (!orderId) {
        return buildFailure("PrestaShop order ID is required.");
      }
      const notes = await listPrestaShopOrderNotes(store, orderId);
      return buildSuccess({ notes });
    } catch (error) {
      return buildFailure("Unable to load PrestaShop order notes.", error);
    }
  },

  async addPrestaShopOrderNote(args) {
    try {
      const requestArgs = parseArgs(args);
      const settings = resolveSettings(requestArgs);
      const store = await findSecureStoreById(settings, requestArgs.store_id);
      const orderId = normalizeText(requestArgs.order_id);
      const note = normalizeText(requestArgs.note);
      const customerNote = normalizeBoolean(requestArgs.customer_note, false);
      if (!orderId) {
        return buildFailure("PrestaShop order ID is required.");
      }
      if (!note) {
        return buildFailure("Order note text is required.");
      }
      if (!isPrestaShopExtensionApiStore(store)) {
        return buildFailure("Order notes require the Freshworks PrestaShop module token.");
      }
      await postPrestaShop(store, `/freshworks/orders/${encodeURIComponent(orderId)}/comments`, {
        statusHistory: {
          comment: note,
          is_customer_notified: customerNote,
          is_visible_on_front: customerNote,
        },
      });
      const notes = await listPrestaShopOrderNotes(store, orderId);
      return buildSuccess({
        message: customerNote ? "Customer note added successfully." : "Order note added successfully.",
        notes,
      });
    } catch (error) {
      return buildFailure("Unable to add the PrestaShop order note.", error);
    }
  },

  applyPrestaShopOrderCoupon() {
    return buildFailure("PrestaShop REST does not support applying a coupon to a placed order. Coupons must be applied before checkout.");
  },

  refundPrestaShopOrder(args) {
    try {
      const requestArgs = parseArgs(args);
      const settings = resolveSettings(requestArgs);
      const flags = getPrestaShopFeatureFlags(settings);
      const orderId = normalizeText(requestArgs.order_id);
      if (!flags.allow_agent_refund_orders) {
        return buildFailure("Refund actions are disabled in the app settings.");
      }
      if (!orderId) {
        return buildFailure("PrestaShop order ID is required.");
      }
      return buildFailure("Refund actions must be completed in PrestaShop Back Office.");
    } catch (error) {
      return buildFailure("Unable to refund the PrestaShop order.", error);
    }
  },

  async cancelPrestaShopOrder(args) {
    try {
      const requestArgs = parseArgs(args);
      const settings = resolveSettings(requestArgs);
      const flags = getPrestaShopFeatureFlags(settings);
      const store = await findSecureStoreById(settings, requestArgs.store_id);
      const orderId = normalizeText(requestArgs.order_id);
      if (!flags.allow_agent_cancel_orders) {
        return buildFailure("Order cancellation is disabled in the app settings.");
      }
      if (!orderId) {
        return buildFailure("PrestaShop order ID is required.");
      }
      if (!isPrestaShopExtensionApiStore(store)) {
        return buildFailure("Order cancellation requires the Freshworks PrestaShop module token.");
      }
      const orderPayload = await fetchPrestaShop(store, `/orders/${encodeURIComponent(orderId)}`);
      const normalizedOrder = normalizeOrderRecord(store, orderPayload);
      const allowedActions = buildOrderActionAvailability(normalizedOrder.status, normalizedOrder.grand_total, store);
      if (!allowedActions.can_cancel) {
        return buildFailure("This order cannot be cancelled from the connector.");
      }
      await postPrestaShop(store, `/freshworks/orders/${encodeURIComponent(orderId)}/cancel`, {});
      const order = await loadPrestaShopOrder(store, orderId);
      return buildSuccess({ message: "Order cancelled successfully.", order });
    } catch (error) {
      return buildFailure("Unable to cancel the PrestaShop order.", error);
    }
  },

  async updatePrestaShopOrderShipping(args) {
    try {
      const requestArgs = parseArgs(args);
      const settings = resolveSettings(requestArgs);
      const flags = getPrestaShopFeatureFlags(settings);
      const store = await findSecureStoreById(settings, requestArgs.store_id);
      const orderId = normalizeText(requestArgs.order_id);
      if (!flags.allow_agent_update_shipping_address) {
        return buildFailure("Shipping address updates are disabled in the app settings.");
      }
      if (!orderId) {
        return buildFailure("PrestaShop order ID is required.");
      }
      if (!isPrestaShopExtensionApiStore(store)) {
        return buildFailure("Shipping address updates require the Freshworks PrestaShop module token.");
      }
      const shipping = normalizeShippingPayload(requestArgs.shipping);
      const validationError = validateShippingPayload(shipping);
      if (validationError) {
        return buildFailure(validationError);
      }
      const order = await postPrestaShop(
        store,
        `/freshworks/orders/${encodeURIComponent(orderId)}/shipping-address`,
        buildPrestaShopExtensionShippingPayload(shipping)
      );
      return buildSuccess({
        message: "Shipping address updated successfully.",
        order: normalizeOrderRecord(store, order),
      });
    } catch (error) {
      return buildFailure("Unable to update the PrestaShop shipping address.", error);
    }
  },

  handleTicketUpdate(payload) {
    try {
      const summary = buildEventSummary(resolveSettings(payload));
      console.log(`[PrestaShopConnector] Ticket update received for Freshdesk ${summary.freshdesk_domain} with ${summary.connected_stores} configured store(s).`);
    } catch (error) {
      console.error("PrestaShopConnector ticket update handling failed:", error);
    }
  },

  handleConversationCreate(payload) {
    try {
      const summary = buildEventSummary(resolveSettings(payload));
      console.log(`[PrestaShopConnector] Conversation event received for Freshdesk ${summary.freshdesk_domain} with ${summary.connected_stores} configured store(s).`);
    } catch (error) {
      console.error("PrestaShopConnector conversation handling failed:", error);
    }
  },
};
