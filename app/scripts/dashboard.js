let client;

const state = {
  loading: true,
  iparams: {},
  dashboard: {
    summary: {},
    stores: [],
    features: [],
    flags: {},
    live_insights: {
      totals: {
        total_orders: 0,
        total_customers: 0,
        total_revenue_formatted: "0",
      },
      status_counts: [],
      recent_orders: [],
      stores: [],
    },
  },
  message: {
    text: "",
    type: "",
  },
};

const refs = {};

document.addEventListener("DOMContentLoaded", () => {
  void initialize();
});

async function initialize() {
  client = await app.initialized();

  try {
    const iparams = await client.iparams.get();
    state.iparams = iparams && typeof iparams === "object" ? iparams : {};
  } catch (error) {
    console.error("Failed to load dashboard installation parameters:", error);
    state.iparams = {};
  }

  bindRefs();
  bindEvents();
  render();

  client.events.on("app.activated", () => {
    void loadDashboard({ silent: true });
  });

  await loadDashboard();
}

function bindRefs() {
  refs.refreshBtn = document.getElementById("refreshBtn");
  refs.statusLine = document.getElementById("statusLine");
  refs.pageMessage = document.getElementById("pageMessage");
  refs.freshdeskValue = document.getElementById("freshdeskValue");
  refs.connectedStoresValue = document.getElementById("connectedStoresValue");
  refs.verifiedStoresValue = document.getElementById("verifiedStoresValue");
  refs.customersValue = document.getElementById("customersValue");
  refs.ordersValue = document.getElementById("ordersValue");
  refs.revenueValue = document.getElementById("revenueValue");
  refs.statusList = document.getElementById("statusList");
  refs.statusEmptyState = document.getElementById("statusEmptyState");
  refs.storeInsightsList = document.getElementById("storeInsightsList");
  refs.storeInsightsEmptyState = document.getElementById("storeInsightsEmptyState");
  refs.recentOrdersList = document.getElementById("recentOrdersList");
  refs.recentOrdersEmptyState = document.getElementById("recentOrdersEmptyState");
  refs.featuresList = document.getElementById("featuresList");
}

function bindEvents() {
  refs.refreshBtn.addEventListener("click", () => {
    void loadDashboard();
  });
}

async function loadDashboard(options) {
  const silent = Boolean(options && options.silent);
  state.loading = true;
  if (!silent) {
    clearMessage();
  }
  render();

  try {
    state.dashboard = await invokeServerFunction("getDashboardData", {
      app_settings: state.iparams,
    });
  } catch (error) {
    console.error("Failed to load PrestaShop connector dashboard:", error);
    showMessage(resolveErrorMessage(error, "Unable to load connector dashboard data."), "error");
  } finally {
    state.loading = false;
    render();
  }
}

function render() {
  const summary = state.dashboard.summary || {};
  const liveInsights = state.dashboard.live_insights || { totals: {}, status_counts: [], recent_orders: [], stores: [] };

  refs.refreshBtn.disabled = state.loading;
  refs.statusLine.textContent = state.loading ? "Refreshing dashboard..." : "Ready";
  refs.freshdeskValue.textContent = summary.freshdesk_connected ? "Connected" : "Needs setup";
  refs.connectedStoresValue.textContent = String(summary.connected_stores || 0);
  refs.verifiedStoresValue.textContent = String(summary.verified_stores || 0);
  refs.customersValue.textContent = String((liveInsights.totals && liveInsights.totals.total_customers) || 0);
  refs.ordersValue.textContent = String((liveInsights.totals && liveInsights.totals.total_orders) || 0);
  refs.revenueValue.textContent = (liveInsights.totals && liveInsights.totals.total_revenue_formatted) || "0";

  renderMessage();
  renderStatusCounts(liveInsights.status_counts || []);
  renderStoreInsights(liveInsights.stores || []);
  renderRecentOrders(liveInsights.recent_orders || []);
  renderFeatures(state.dashboard.features || []);
}

function renderStatusCounts(items) {
  if (!items.length) {
    refs.statusList.innerHTML = "";
    refs.statusEmptyState.style.display = "block";
    return;
  }

  refs.statusEmptyState.style.display = "none";
  refs.statusList.innerHTML = items.map((item) => {
    return `
      <article class="row">
        <div class="row-head">
          <div class="row-title">${escapeHtml(item.status || "unknown")}</div>
          <span class="pill pill-muted">${escapeHtml(String(item.count || 0))}</span>
        </div>
        <div class="row-copy">Orders currently sampled in this status across all connected stores.</div>
      </article>
    `;
  }).join("");
}

function renderStoreInsights(items) {
  if (!items.length) {
    refs.storeInsightsList.innerHTML = "";
    refs.storeInsightsEmptyState.style.display = "block";
    return;
  }

  refs.storeInsightsEmptyState.style.display = "none";
  refs.storeInsightsList.innerHTML = items.map((item) => {
    return `
      <article class="row">
        <div class="row-head">
          <div class="row-title">${escapeHtml(item.store_name || "Store")}</div>
          <span class="pill ${item.error ? "pill-muted" : "pill-success"}">${item.error ? "Needs review" : "Live"}</span>
        </div>
        <div class="row-copy">
          Customers: ${escapeHtml(String(item.customers_count || 0))}<br />
          Orders: ${escapeHtml(String(item.orders_count || 0))}<br />
          Revenue: ${escapeHtml(item.revenue_formatted || "N/A")}
          ${item.error ? `<br />Issue: ${escapeHtml(item.error)}` : ""}
        </div>
      </article>
    `;
  }).join("");
}

function renderRecentOrders(items) {
  if (!items.length) {
    refs.recentOrdersList.innerHTML = "";
    refs.recentOrdersEmptyState.style.display = "block";
    return;
  }

  refs.recentOrdersEmptyState.style.display = "none";
  refs.recentOrdersList.innerHTML = items.map((item) => {
    return `
      <article class="row">
        <div class="row-head">
          <div class="row-title">
            ${item.admin_url ? `<a href="${escapeAttribute(item.admin_url)}" target="_blank" rel="noreferrer">Order #${escapeHtml(item.order_number || item.id)}</a>` : `Order #${escapeHtml(item.order_number || item.id)}`}
          </div>
          <span class="pill pill-muted">${escapeHtml(item.status || "unknown")}</span>
        </div>
        <div class="row-copy">
          Store: ${escapeHtml(item.store_name || "Store")}<br />
          Customer: ${escapeHtml(item.customer_email || "Unknown")}<br />
          Date: ${escapeHtml(formatDate(item.created_at) || "Unknown")}<br />
          Total: ${escapeHtml(item.grand_total_formatted || "N/A")}
          ${item.freshdesk_ticket_url && item.freshdesk_ticket_id ? `<br />Ticket: <a href="${escapeAttribute(item.freshdesk_ticket_url)}" target="_blank" rel="noreferrer">#${escapeHtml(item.freshdesk_ticket_id)}</a>` : ""}
        </div>
      </article>
    `;
  }).join("");
}

function renderFeatures(items) {
  refs.featuresList.innerHTML = (Array.isArray(items) ? items : []).map((feature) => {
    return `
      <article class="row">
        <div class="row-head">
          <div class="row-title">${escapeHtml(feature.label || feature.key || "Feature")}</div>
          <span class="pill ${feature.enabled ? "pill-success" : "pill-muted"}">${feature.enabled ? "Enabled" : "Disabled"}</span>
        </div>
        <div class="row-copy">${escapeHtml(feature.description || "")}</div>
      </article>
    `;
  }).join("");
}

async function invokeServerFunction(name, body) {
  const result = await client.request.invoke(name, {
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
  return payload.message || payload.detail || "";
}

function showMessage(text, type) {
  state.message = { text, type };
  renderMessage();
}

function clearMessage() {
  state.message = { text: "", type: "" };
}

function renderMessage() {
  if (!state.message.text) {
    refs.pageMessage.textContent = "";
    refs.pageMessage.className = "message";
    return;
  }

  refs.pageMessage.textContent = state.message.text;
  refs.pageMessage.className = `message ${state.message.type || "info"}`;
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

function formatDate(value) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return "";
  }
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return date.toLocaleString();
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
