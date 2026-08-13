let client;

const state = {
  loading: true,
  iparams: {},
  contextData: {},
  payload: {
    summary: {
      connected_stores: 0,
      verified_stores: 0,
    },
    stores: [],
    features: [],
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
  bindRefs();
  bindEvents();

  try {
    const context = await client.instance.context();
    state.contextData = (context && context.data) || {};
  } catch (error) {
    console.error("Failed to load PrestaShop modal context:", error);
    state.contextData = {};
  }

  try {
    const iparams = await client.iparams.get();
    state.iparams = iparams && typeof iparams === "object" ? iparams : {};
  } catch (error) {
    console.error("Failed to load PrestaShop modal settings:", error);
    state.iparams = {};
  }

  await client.instance.resize({ height: "640px" });
  await loadDetails();
}

function bindRefs() {
  refs.modalTitle = document.getElementById("modalTitle");
  refs.modalCopy = document.getElementById("modalCopy");
  refs.ticketSummary = document.getElementById("ticketSummary");
  refs.modalMessage = document.getElementById("modalMessage");
  refs.storesList = document.getElementById("storesList");
  refs.storesEmptyState = document.getElementById("storesEmptyState");
  refs.featuresList = document.getElementById("featuresList");
  refs.closeBtn = document.getElementById("closeBtn");
  refs.refreshBtn = document.getElementById("refreshBtn");
}

function bindEvents() {
  refs.closeBtn.addEventListener("click", () => {
    client.instance.close();
  });

  refs.refreshBtn.addEventListener("click", () => {
    void loadDetails();
  });
}

async function loadDetails() {
  state.loading = true;
  clearMessage();
  render();

  try {
    state.payload = await invokeServerFunction("getDashboardData", {
      app_settings: state.iparams,
    });
  } catch (error) {
    console.error("Failed to load PrestaShop modal details:", error);
    showMessage(resolveErrorMessage(error, "Unable to load PrestaShop store details."), "error");
  } finally {
    state.loading = false;
    render();
  }
}

function render() {
  const ticket = state.contextData.ticket || {};
  const summary = state.payload.summary || {};
  const stores = Array.isArray(state.payload.stores) ? state.payload.stores : [];
  const features = Array.isArray(state.payload.features) ? state.payload.features : [];

  refs.modalTitle.textContent = "Store Details";
  refs.modalCopy.textContent = "Review the stores and feature toggles currently configured for this Freshdesk installation.";
  refs.ticketSummary.textContent = ticket && ticket.id
    ? `Opened from ticket #${normalizeText(ticket.id)}${ticket.subject ? `: ${normalizeText(ticket.subject)}` : ""}`
    : "This view is shared across tickets and shows the current app configuration.";
  refs.refreshBtn.disabled = state.loading;

  renderMessage();
  renderStores(stores);
  renderFeatures(features, summary);
}

function renderStores(stores) {
  if (!stores.length) {
    refs.storesList.innerHTML = "";
    refs.storesEmptyState.style.display = "block";
    return;
  }

  refs.storesEmptyState.style.display = "none";
  refs.storesList.innerHTML = stores.map((store) => {
    return `
      <article class="row">
        <div class="row-head">
          <div class="row-title">${escapeHtml(store.store_name || "Unnamed store")}</div>
          <span class="pill ${store.verified ? "pill-success" : "pill-muted"}">${store.verified ? "Verified" : "Needs review"}</span>
        </div>
        <div class="row-copy">
          URL: ${escapeHtml(store.display_url || store.base_url || "Not set")}<br />
          Admin path: ${escapeHtml(store.custom_admin_path || "admin-dev")}
        </div>
      </article>
    `;
  }).join("");
}

function renderFeatures(features, summary) {
  refs.featuresList.innerHTML = features
    .concat([
      {
        label: "Store coverage",
        enabled: Boolean((summary && summary.connected_stores) || 0),
        description: `${summary.connected_stores || 0} store(s) configured, ${summary.verified_stores || 0} verified.`,
      },
    ])
    .map((feature) => {
      return `
        <article class="row">
          <div class="row-head">
            <div class="row-title">${escapeHtml(feature.label || feature.key || "Feature")}</div>
            <span class="pill ${feature.enabled ? "pill-success" : "pill-muted"}">${feature.enabled ? "Enabled" : "Disabled"}</span>
          </div>
          <div class="row-copy">${escapeHtml(feature.description || "")}</div>
        </article>
      `;
    })
    .join("");
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
  state.message = {
    text,
    type,
  };
  renderMessage();
}

function clearMessage() {
  state.message = {
    text: "",
    type: "",
  };
}

function renderMessage() {
  if (!state.message.text) {
    refs.modalMessage.textContent = "";
    refs.modalMessage.className = "message";
    return;
  }

  refs.modalMessage.textContent = state.message.text;
  refs.modalMessage.className = `message ${state.message.type || "info"}`;
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

function normalizeText(value) {
  return String(value || "").trim();
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
