let client;

const state = {
  loading: false,
  ticket: null,
  iparams: {},
  payload: {
    summary: {
      matched_customers: 0,
      matched_orders: 0,
      stores_scanned: 0,
    },
    stores: [],
    customers: [],
    orders: [],
    store_errors: [],
    requester_email: "",
    flags: {},
  },
  filters: {
    store: "",
    status: "",
    sort: "date_desc",
    orderQuery: "",
  },
  message: {
    text: "",
    type: "",
  },
  activeOrderPanel: {
    key: "",
    type: "",
  },
  actionLoadingKey: "",
  notesLoadingKey: "",
  orderNotesByKey: {},
  orderActionMessagesByKey: {},
  expandedOrders: {},
  expandedCustomers: {},
};

const refs = {};

document.addEventListener("DOMContentLoaded", () => {
  void initialize();
});

async function initialize() {
  client = await app.initialized();
  await client.instance.resize({ height: "800px" });

  if (client.instance && typeof client.instance.receive === "function") {
    client.instance.receive(handleInstanceMessages);
  }

  try {
    const iparams = await client.iparams.get();
    state.iparams = iparams && typeof iparams === "object" ? iparams : {};
  } catch (error) {
    console.error("Failed to load PrestaShop connector iparams:", error);
    state.iparams = {};
  }

  bindRefs();
  bindEvents();
  render();

  client.events.on("app.activated", () => {
    void loadSidebar({ mode: "auto" });
  });

  await loadSidebar({ mode: "auto" });
}

function bindRefs() {
  refs.matchCountBadge = document.getElementById("matchCountBadge");
  refs.ticketSummary = document.getElementById("ticketSummary");
  refs.headerCustomer = document.getElementById("headerCustomer");
  refs.refreshBtn = document.getElementById("refreshBtn");
  refs.globalSearchInput = document.getElementById("globalSearchInput");
  refs.globalSearchBtn = document.getElementById("globalSearchBtn");
  refs.orderSearchInput = document.getElementById("orderSearchInput");
  refs.orderSearchBtn = document.getElementById("orderSearchBtn");
  refs.orderSearchSection = document.getElementById("orderSearchSection");
  refs.filtersSection = document.getElementById("filtersSection");
  refs.customerSection = document.getElementById("customerSection");
  refs.orderSection = document.getElementById("orderSection");
  refs.pageMessage = document.getElementById("pageMessage");
  refs.storeFilter = document.getElementById("storeFilter");
  refs.statusFilter = document.getElementById("statusFilter");
  refs.sortOrder = document.getElementById("sortOrder");
  refs.customerState = document.getElementById("customerState");
  refs.customerList = document.getElementById("customerList");
  refs.orderState = document.getElementById("orderState");
  refs.orderList = document.getElementById("orderList");
  refs.scanSummary = document.getElementById("scanSummary");
  refs.storeErrors = document.getElementById("storeErrors");
}

function bindEvents() {
  refs.refreshBtn.addEventListener("click", () => {
    void loadSidebar({ mode: "refresh" });
  });

  // Top search: all stores, any customer (not limited to the ticket contact).
  const runGlobalSearch = () => {
    void loadSidebar({
      mode: "global",
      searchScope: "global",
      searchQuery: refs.globalSearchInput.value,
    });
  };
  refs.globalSearchBtn.addEventListener("click", runGlobalSearch);
  refs.globalSearchInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      runGlobalSearch();
    }
  });

  // Order search filters the already-loaded orders on the client, so it is instant
  // and never hits the backend.
  const runOrderSearch = () => {
    state.filters.orderQuery = refs.orderSearchInput.value;
    renderOrders();
  };
  refs.orderSearchBtn.addEventListener("click", runOrderSearch);
  refs.orderSearchInput.addEventListener("input", runOrderSearch);
  refs.orderSearchInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      runOrderSearch();
    }
  });
  refs.storeFilter.addEventListener("change", () => {
    state.filters.store = refs.storeFilter.value;
    renderOrders();
  });
  refs.statusFilter.addEventListener("change", () => {
    state.filters.status = refs.statusFilter.value;
    renderOrders();
  });
  refs.sortOrder.addEventListener("change", () => {
    state.filters.sort = refs.sortOrder.value;
    renderOrders();
  });
  refs.orderList.addEventListener("click", (event) => {
    void handleOrderActionClick(event);
  });
  refs.customerList.addEventListener("click", handleCustomerToggle);
}

function handleCustomerToggle(event) {
  const target = event.target;
  if (!(target instanceof HTMLElement) || target.closest("a")) {
    return;
  }
  const head = target.closest("[data-action='toggle-customer']");
  if (!(head instanceof HTMLElement)) {
    return;
  }
  const key = normalizeText(head.dataset.customerKey);
  if (!key) {
    return;
  }
  state.expandedCustomers[key] = !state.expandedCustomers[key];
  renderCustomers();
}

async function loadSidebar(options) {
  if (state.loading) {
    return;
  }

  state.loading = true;
  state.activeOrderPanel = { key: "", type: "" };
  state.notesLoadingKey = "";
  state.orderNotesByKey = {};
  state.orderActionMessagesByKey = {};
  state.expandedOrders = {};
  state.expandedCustomers = {};
  // A fresh load brings a new set of orders; drop any client-side order filter so
  // the new results aren't hidden by a stale term.
  state.filters.orderQuery = "";
  if (refs.orderSearchInput) {
    refs.orderSearchInput.value = "";
  }
  clearPageMessage();
  render();

  try {
    state.ticket = await loadTicketContext();

    const orderDataVisible = isOrderDataVisible();
    const searchScope = normalizeText(options && options.searchScope) || "contact";
    const searchQuery = normalizeText(options && options.searchQuery);
    const searchType = searchScope === "global"
      ? "all"
      : orderDataVisible
        ? normalizeText(options && options.searchType) || "all"
        : "email";

    state.payload = await invokeServerFunction("getSidebarData", {
      ticket_id: state.ticket && state.ticket.id,
      requester_id: state.ticket && state.ticket.requesterId,
      requester_email: state.ticket && state.ticket.requesterEmail,
      search_query: searchQuery,
      search_type: searchType,
      search_scope: searchScope,
      app_settings: state.iparams,
    });
    applyDefaultExpansion();
  } catch (error) {
    console.error("Failed to load PrestaShop sidebar data:", error);
    showPageMessage(resolveErrorMessage(error, "Unable to load PrestaShop customer and order data."), "error");
  } finally {
    state.loading = false;
    render();
  }
}

async function loadTicketContext() {
  const ticketData = await client.data.get("ticket");
  const ticket = normalizeTicket(ticketData);

  if (ticket.requesterEmail) {
    return ticket;
  }

  const contactData = await getOptionalClientData("contact");
  const requesterData = await getOptionalClientData("requester");
  const requester = mergeRequesterData(
    normalizeRequesterData(contactData),
    normalizeRequesterData(requesterData)
  );

  return {
    ...ticket,
    requesterId: ticket.requesterId || requester.requesterId,
    requesterEmail: requester.requesterEmail || ticket.requesterEmail,
  };
}

async function getOptionalClientData(key) {
  try {
    return await client.data.get(key);
  } catch {
    return null;
  }
}

function normalizeTicket(payload) {
  const ticket = payload && payload.ticket ? payload.ticket : payload;
  const requester = ticket && ticket.requester && typeof ticket.requester === "object" ? ticket.requester : {};
  const contact = ticket && ticket.contact && typeof ticket.contact === "object" ? ticket.contact : {};
  const requesterValue = ticket && typeof ticket.requester !== "object" ? ticket.requester : "";
  const contactValue = ticket && typeof ticket.contact !== "object" ? ticket.contact : "";

  return {
    id: normalizeText(ticket && (ticket.id || ticket.ticket_id || ticket.ticketId || ticket.display_id || ticket.displayId)),
    subject: normalizeText(ticket && (ticket.subject || ticket.title)),
    requesterId: normalizeText(
      ticket && (
        ticket.requester_id ||
        ticket.requesterId ||
        ticket.requesterID ||
        requesterValue ||
        requester.id ||
        requester.requester_id ||
        requester.requesterId ||
        requester.requesterID ||
        contactValue ||
        contact.id
      )
    ),
    requesterEmail: normalizeText(
      (ticket && ticket.email) ||
      (ticket && ticket.requester_email) ||
      (ticket && ticket.requesterEmail) ||
      requester.email ||
      requester.primary_email ||
      requester.primaryEmail ||
      contact.email ||
      contact.primary_email ||
      contact.primaryEmail
    ),
  };
}

function normalizeRequesterData(payload) {
  const record = payload && payload.contact
    ? payload.contact
    : payload && payload.requester
    ? payload.requester
    : payload && payload.user
    ? payload.user
    : payload;

  return {
    requesterId: normalizeText(record && (record.id || record.requester_id || record.requesterId || record.contact_id || record.contactId)),
    requesterEmail: normalizeText(
      (record && record.email) ||
      (record && record.primary_email) ||
      (record && record.primaryEmail) ||
      (record && Array.isArray(record.emails) && record.emails[0])
    ),
  };
}

function mergeRequesterData() {
  return Array.from(arguments).reduce((merged, item) => ({
    requesterId: merged.requesterId || normalizeText(item && item.requesterId),
    requesterEmail: merged.requesterEmail || normalizeText(item && item.requesterEmail),
  }), {
    requesterId: "",
    requesterEmail: "",
  });
}

function render() {
  const summary = state.payload.summary || {};
  const orderDataVisible = isOrderDataVisible();
  const matchedCustomers = Number(summary.matched_customers) || 0;
  const matchedOrders = orderDataVisible ? Number(summary.matched_orders) || 0 : 0;
  refs.matchCountBadge.textContent = String(matchedCustomers + matchedOrders);
  if (refs.ticketSummary) {
    refs.ticketSummary.textContent = buildTicketSummary();
  }
  refs.refreshBtn.disabled = state.loading;
  refs.globalSearchBtn.disabled = state.loading;
  refs.globalSearchInput.disabled = state.loading;
  refs.orderSearchBtn.disabled = state.loading;
  refs.orderSearchInput.disabled = state.loading;
  renderMessage();
  populateFilters();
  renderHeaderCustomer();
  renderCustomers();
  renderOrders();
  renderStoreScan();
  renderSectionVisibility();
}

function buildTicketSummary() {
  if (state.loading && !state.ticket) {
    return "Loading order details…";
  }
  if (!state.ticket || !state.ticket.id) {
    return "Open the app to load PrestaShop data.";
  }

  // Keep it to the essentials: ticket # + requester email (one line).
  const email = normalizeText(state.payload.requester_email) || normalizeText(state.ticket.requesterEmail);
  return `Ticket #${state.ticket.id}${email ? ` · ${email}` : ""}`;
}

function populateFilters() {
  if (!isOrderDataVisible()) {
    refs.storeFilter.innerHTML = '<option value="">All stores</option>';
    refs.statusFilter.innerHTML = '<option value="">All statuses</option>';
    refs.storeFilter.value = "";
    refs.statusFilter.value = "";
    refs.sortOrder.value = state.filters.sort;
    return;
  }

  const orders = Array.isArray(state.payload.orders) ? state.payload.orders : [];
  const stores = Array.from(new Set(orders.map((order) => normalizeText(order.store_name)).filter(Boolean)));
  const statuses = Array.from(new Set(orders.map((order) => normalizeText(order.status_label || order.status)).filter(Boolean)));

  refs.storeFilter.innerHTML = ['<option value="">All stores</option>']
    .concat(stores.map((store) => `<option value="${escapeAttribute(store)}">${escapeHtml(store)}</option>`))
    .join("");
  refs.statusFilter.innerHTML = ['<option value="">All statuses</option>']
    .concat(statuses.map((status) => `<option value="${escapeAttribute(status)}">${escapeHtml(status)}</option>`))
    .join("");

  refs.storeFilter.value = stores.includes(state.filters.store) ? state.filters.store : "";
  refs.statusFilter.value = statuses.includes(state.filters.status) ? state.filters.status : "";
  refs.sortOrder.value = state.filters.sort;
}

function renderCustomers() {
  const customers = Array.isArray(state.payload.customers) ? state.payload.customers : [];
  if (!customers.length) {
    refs.customerState.classList.remove("hidden");
    refs.customerList.classList.add("hidden");
    refs.customerList.innerHTML = "";
    refs.customerState.textContent = state.loading
      ? "Searching customer data across PrestaShop stores..."
      : buildCustomerEmptyState();
    return;
  }

  refs.customerState.classList.add("hidden");
  refs.customerList.classList.remove("hidden");
  refs.customerList.innerHTML = customers.map((customer, index) => renderCustomerCard(customer, index)).join("");
}

function buildCustomerEmptyState() {
  const email = normalizeText(state.payload.requester_email) || normalizeText(state.ticket && state.ticket.requesterEmail);
  const summary = state.payload.summary || {};
  const storesScanned = Number(summary.stores_scanned) || 0;
  const storeErrors = Array.isArray(state.payload.store_errors) ? state.payload.store_errors : [];

  if (!email) {
    return "No requester email found for this ticket.";
  }
  if (storesScanned && storeErrors.length >= storesScanned) {
    return `Could not search PrestaShop for ${email}. Check the store scan details below.`;
  }
  return `No PrestaShop customer found for ${email}.`;
}

// Render the primary customer's summary inside the brand header, plus a
// collapsible white details panel (email, registration, addresses, …).
// Static customer summary in the brand header — name, role and total sales,
// read-only (no dropdown). Full details live in the collapsible card below.
function renderHeaderCustomer() {
  if (!refs.headerCustomer) {
    return;
  }

  const customers = Array.isArray(state.payload.customers) ? state.payload.customers : [];
  const primary = customers[0];

  if (!primary) {
    refs.headerCustomer.innerHTML = "";
    refs.headerCustomer.classList.add("hidden");
    return;
  }

  const name = normalizeText(primary.name) || "Unnamed Customer";
  const nameHtml = primary.admin_url
    ? `<a href="${escapeAttribute(primary.admin_url)}" target="_blank" rel="noreferrer">${escapeHtml(name)}</a>`
    : escapeHtml(name);
  const role = titleCase(normalizeText(primary.role) || "Customer");

  refs.headerCustomer.classList.remove("hidden");
  refs.headerCustomer.innerHTML = `
    <div class="hc-head">
      <span class="hc-name">${nameHtml}</span>
    </div>
    <div class="hc-rows">
      <div class="hc-row"><span class="hc-k">Group</span><span class="hc-v">${escapeHtml(role)}</span></div>
      <div class="hc-row"><span class="hc-k">Total Sales</span><span class="hc-v hc-amount">${escapeHtml(primary.total_sales || "—")}</span></div>
    </div>
  `;
}

function renderCustomerCard(customer, index) {
  const customerKey = getCustomerKey(customer, index);
  const isOpen = Boolean(state.expandedCustomers[customerKey]);
  const name = normalizeText(customer.name) || "Unnamed Customer";
  const nameHtml = customer.admin_url
    ? `<a href="${escapeAttribute(customer.admin_url)}" target="_blank" rel="noreferrer">${escapeHtml(name)}</a>`
    : escapeHtml(name);

  return `
    <article class="card customer-card ${isOpen ? "is-open" : ""}">
      <div class="disc-head" data-action="toggle-customer" data-customer-key="${escapeAttribute(customerKey)}">
        <div class="disc-main">
          <div class="disc-title">${nameHtml}</div>
          <div class="disc-sub">
            <span class="pill pill-info pill-plain">${escapeHtml(titleCase(customer.role || "customer"))}</span>
            <span class="disc-sub-txt">${escapeHtml(customer.email || "No email")} · ${escapeHtml(customer.store_name || "Store")}</span>
          </div>
        </div>
        <div class="disc-side">
          ${customer.total_sales ? `<span class="disc-amount">${escapeHtml(customer.total_sales)}</span>` : ""}
          ${chevronSvg()}
        </div>
      </div>
      <div class="card-body">
        <div class="card-grid">
          <div class="meta-block">
            <div class="meta-label">Registration Date</div>
            <div class="meta-value">${escapeHtml(formatDate(customer.registration_date) || "Not available")}</div>
          </div>
          <div class="meta-block">
            <div class="meta-label">Total Sales</div>
            <div class="meta-value">${escapeHtml(customer.total_sales || "Not available")}</div>
          </div>
          <div class="meta-block">
            <div class="meta-label">Country</div>
            <div class="meta-value">${escapeHtml(customer.country || "Not available")}</div>
          </div>
          <div class="meta-block">
            <div class="meta-label">Store</div>
            <div class="meta-value">${escapeHtml(customer.store_name || "Not available")}</div>
          </div>
        </div>
        <div class="body-block">
          <div class="meta-label">Addresses</div>
          ${renderAddressField("Billing", customer.billing_address && customer.billing_address.formatted)}
          ${renderAddressField("Shipping", customer.shipping_address && customer.shipping_address.formatted)}
        </div>
      </div>
    </article>
  `;
}

function titleCase(value) {
  return normalizeText(value).replace(/\b\w/g, (char) => char.toUpperCase());
}

function renderOrders() {
  if (!isOrderDataVisible()) {
    refs.orderState.classList.add("hidden");
    refs.orderList.classList.add("hidden");
    refs.orderList.innerHTML = "";
    return;
  }

  const orders = getFilteredOrders();
  if (!orders.length) {
    refs.orderState.classList.remove("hidden");
    refs.orderList.classList.add("hidden");
    refs.orderList.innerHTML = "";
    refs.orderState.textContent = state.loading
      ? "Searching PrestaShop orders across stores..."
      : "No orders found.";
    return;
  }

  refs.orderState.classList.add("hidden");
  refs.orderList.classList.remove("hidden");
  refs.orderList.innerHTML = orders.map(renderOrderCard).join("");
}

function getFilteredOrders() {
  const orders = Array.isArray(state.payload.orders) ? state.payload.orders.slice() : [];
  const orderQuery = normalizeText(state.filters.orderQuery).toLowerCase();
  const filtered = orders.filter((order) => {
    if (state.filters.store && normalizeText(order.store_name) !== state.filters.store) {
      return false;
    }
    if (state.filters.status && normalizeText(order.status_label || order.status) !== state.filters.status) {
      return false;
    }
    // Order-ID search is done here on already-loaded orders, so it is instant.
    if (orderQuery) {
      const orderNumber = normalizeText(order.order_number).toLowerCase();
      const orderId = normalizeText(order.id).toLowerCase();
      if (!orderNumber.includes(orderQuery) && !orderId.includes(orderQuery)) {
        return false;
      }
    }
    return true;
  });

  filtered.sort((left, right) => {
    if (state.filters.sort === "date_asc") {
      return new Date(left.created_at || 0).getTime() - new Date(right.created_at || 0).getTime();
    }
    if (state.filters.sort === "total_desc") {
      return Number(right.grand_total || 0) - Number(left.grand_total || 0);
    }
    if (state.filters.sort === "total_asc") {
      return Number(left.grand_total || 0) - Number(right.grand_total || 0);
    }
    return new Date(right.created_at || 0).getTime() - new Date(left.created_at || 0).getTime();
  });

  return filtered;
}

function renderOrderCard(order) {
  const orderKey = getOrderKey(order);
  const isOpen = Boolean(state.expandedOrders[orderKey]);
  const isActionLoading = state.actionLoadingKey === orderKey;
  const hasTracking = Array.isArray(order.tracking_items) && order.tracking_items.length;
  const extensionBadges = renderExtensionBadges(order);
  const statusNote = normalizeText(order.status_note);
  const items = Array.isArray(order.items) ? order.items : [];
  const itemCount = items.reduce((total, item) => total + (Number(item.quantity) || 0), 0);
  const orderTitle = order.admin_url
    ? `<a href="${escapeAttribute(order.admin_url)}" target="_blank" rel="noreferrer">Order #${escapeHtml(order.order_number)}</a>`
    : `Order #${escapeHtml(order.order_number)}`;

  return `
    <article class="card order-card ${isOpen ? "is-open" : ""}">
      <div class="disc-head" data-action="toggle-order" data-order-key="${escapeAttribute(orderKey)}">
        <div class="disc-title">${orderTitle}</div>
        <div class="disc-sub"><span class="disc-sub-txt">${escapeHtml(order.store_name || "Store")} · ${escapeHtml(formatDate(order.created_at) || "Unknown date")}</span></div>
        <div class="disc-side">
          <span class="disc-amount">${escapeHtml(order.grand_total_formatted || "—")}</span>
          ${chevronSvg()}
        </div>
      </div>

      <div class="disc-strip">
        <span class="pill ${resolveStatusPillClass(order.status)}">${escapeHtml(order.status_label || order.status || "unknown")}</span>
        ${itemCount ? `<span class="items-count">${escapeHtml(String(itemCount))} item(s)</span>` : ""}
        ${statusNote ? `<span class="items-count">· ${escapeHtml(statusNote)}</span>` : ""}
      </div>

      <div class="card-body">
        ${extensionBadges}

        <div class="body-block">
          <div class="meta-label">Totals</div>
          <div class="kv">
            <div class="kv-row"><span class="k">Subtotal</span><span class="v">${escapeHtml(order.subtotal_formatted || "N/A")}</span></div>
            <div class="kv-row"><span class="k">Tax</span><span class="v">${escapeHtml(order.tax_formatted || "N/A")}</span></div>
            <div class="kv-row"><span class="k">Shipping</span><span class="v">${escapeHtml(order.shipping_total_formatted || "N/A")}</span></div>
            <div class="kv-row"><span class="k">Discount</span><span class="v">${escapeHtml(order.discount_total_formatted || "N/A")}</span></div>
            <div class="kv-row total"><span class="k">Grand Total</span><span class="v">${escapeHtml(order.grand_total_formatted || "N/A")}</span></div>
          </div>
        </div>

        <div class="body-block">
          <div class="meta-label">Payment &amp; Shipping</div>
          <div class="info-row"><span class="info-k">Payment</span><span class="info-v">${escapeHtml(order.payment_method || "Not available")}</span></div>
          <div class="info-row"><span class="info-k">Shipping</span><span class="info-v">${escapeHtml(order.shipping_method || "Not available")}</span></div>
        </div>

        <div class="body-block">
          <div class="meta-label">Addresses</div>
          ${renderAddressField("Billing", order.billing_address && order.billing_address.formatted)}
          ${renderAddressField("Shipping", order.shipping_address && order.shipping_address.formatted)}
        </div>

        ${hasTracking ? renderTrackingBlock(order) : ""}

        ${renderCouponsBlock(order)}

        <div class="body-block">
          <div class="meta-label">Products</div>
          <div class="product-list">
            ${items.map(renderLineItemCard).join("")}
          </div>
        </div>

        ${renderOrderActions(order, isActionLoading)}
      </div>
    </article>
  `;
}

function renderCouponsBlock(order) {
  const couponLines = Array.isArray(order.coupon_lines) ? order.coupon_lines : [];
  if (!couponLines.length) {
    return "";
  }

  return `
    <div class="body-block">
      <div class="meta-label">Coupons</div>
      <div class="meta-value">
        ${couponLines.map((item) => {
          return `${escapeHtml(item.code || "Coupon")}: ${escapeHtml(item.discount_formatted || item.discount || "Applied")}`;
        }).join("<br />")}
      </div>
    </div>
  `;
}

function renderExtensionBadges(order) {
  const supported = Array.isArray(order.supported_extensions) ? order.supported_extensions : [];
  const badges = [];

  if (supported.includes("shipment_tracking")) {
    badges.push('<span class="pill pill-muted">Shipment Tracking</span>');
  }
  if (supported.includes("custom_order_statuses") || order.is_custom_status) {
    badges.push('<span class="pill pill-muted">Custom Status</span>');
  }

  if (!badges.length) {
    return "";
  }

  return `<div class="inline-meta">${badges.join("")}</div>`;
}

function renderTrackingBlock(order) {
  const items = Array.isArray(order.tracking_items) ? order.tracking_items : [];
  if (!items.length) {
    return "";
  }

  return `
    <div class="body-block">
      <div class="meta-label">Shipment Tracking</div>
      <div class="meta-value">
        ${items.map((item) => {
          const provider = escapeHtml(item.tracking_provider || "Carrier");
          const number = escapeHtml(item.tracking_number || "Unknown");
          const dateShipped = escapeHtml(formatDate(item.date_shipped) || "Not available");
          const link = item.tracking_link
            ? `<a href="${escapeAttribute(item.tracking_link)}" target="_blank" rel="noreferrer">Open tracking link</a>`
            : "No tracking link";
          return `${provider}: ${number}<br />Shipped: ${dateShipped}<br />${link}`;
        }).join("<br /><br />")}
      </div>
    </div>
  `;
}

function renderOrderActions(order, isActionLoading) {
  const actionButtons = [];
  const actionMessages = [];
  const flags = state.payload.flags || {};
  const orderKey = getOrderKey(order);
  const actionResult = state.orderActionMessagesByKey[orderKey];

  if (order.allowed_actions && order.allowed_actions.can_add_note) {
    actionButtons.push(
      `<button type="button" class="btn" data-action="open-order-panel" data-order-key="${escapeAttribute(orderKey)}" data-panel="order_notes" ${isActionLoading ? "disabled" : ""}>Notes</button>`
    );
  }

  if (order.allowed_actions && order.allowed_actions.can_apply_coupon) {
    actionButtons.push(
      `<button type="button" class="btn" data-action="open-order-panel" data-order-key="${escapeAttribute(orderKey)}" data-panel="apply_coupon" ${isActionLoading ? "disabled" : ""}>Apply Coupon</button>`
    );
  }

  if (Boolean(flags.allow_agent_refund_orders) && order.allowed_actions) {
    if (order.allowed_actions.can_refund) {
      actionButtons.push(
        `<button type="button" class="btn" data-action="open-order-panel" data-order-key="${escapeAttribute(orderKey)}" data-panel="full_refund" ${isActionLoading ? "disabled" : ""}>Full Refund</button>`,
        `<button type="button" class="btn" data-action="open-order-panel" data-order-key="${escapeAttribute(orderKey)}" data-panel="partial_refund" ${isActionLoading ? "disabled" : ""}>Partial Refund</button>`
      );
    } else if (!actionResult && order.allowed_actions.refund_unavailable_reason) {
      actionMessages.push(order.allowed_actions.refund_unavailable_reason);
    }
  }

  if (Boolean(flags.allow_agent_cancel_orders) && order.allowed_actions && order.allowed_actions.can_cancel) {
    actionButtons.push(
      `<button type="button" class="btn" data-action="open-order-panel" data-order-key="${escapeAttribute(orderKey)}" data-panel="cancel_order" ${isActionLoading ? "disabled" : ""}>Cancel Order</button>`
    );
  }

  if (Boolean(flags.allow_agent_update_shipping_address) && order.allowed_actions && order.allowed_actions.can_update_shipping) {
    actionButtons.push(
      `<button type="button" class="btn" data-action="open-order-panel" data-order-key="${escapeAttribute(orderKey)}" data-panel="edit_shipping" ${isActionLoading ? "disabled" : ""}>Edit Shipping</button>`
    );
  }

  if (!actionButtons.length && !actionMessages.length && !actionResult) {
    return "";
  }

  return `
    <div class="body-block" data-order-actions="${escapeAttribute(orderKey)}">
      <div class="meta-label">Order Actions</div>
      ${actionResult ? `<div class="message ${escapeAttribute(actionResult.type || "info")}" data-order-action-result="${escapeAttribute(orderKey)}">${escapeHtml(actionResult.text)}</div>` : ""}
      <div class="action-row" style="margin-top: 8px;">${actionButtons.join("")}</div>
      ${actionMessages.map((message) => `<div class="meta-copy" style="margin-top: 6px;">${escapeHtml(message)}</div>`).join("")}
      ${renderActiveOrderPanel(order, isActionLoading)}
    </div>
  `;
}

function renderActiveOrderPanel(order, isActionLoading) {
  const orderKey = getOrderKey(order);
  if (state.activeOrderPanel.key !== orderKey) {
    return "";
  }

  const type = state.activeOrderPanel.type;
  if (type === "order_notes") {
    const noteState = getOrderNotesState(orderKey);
    const notes = Array.isArray(noteState.notes) ? noteState.notes : [];
    const loadingNotes = state.notesLoadingKey === orderKey;
    return `
      <div class="meta-block" data-order-panel="${escapeAttribute(orderKey)}" style="margin-top: 10px;">
        <div class="meta-label">Order Notes</div>
        <div class="meta-value">
          ${loadingNotes ? "Loading order notes..." : notes.length ? notes.map(renderOrderNote).join("<br /><br />") : "No order notes found yet."}
        </div>
        <div class="field" style="margin-top: 8px;">
          <label for="order-note-${escapeAttribute(orderKey)}">Add Note</label>
          <input id="order-note-${escapeAttribute(orderKey)}" data-field="order-note" type="text" placeholder="Add an order note" />
        </div>
        <div class="field" style="margin-top: 8px;">
          <label for="order-note-customer-${escapeAttribute(orderKey)}">Note Visibility</label>
          <select id="order-note-customer-${escapeAttribute(orderKey)}" data-field="order-note-customer">
            <option value="false">Internal note</option>
            <option value="true">Customer note</option>
          </select>
        </div>
        <div class="action-row" style="margin-top: 8px;">
          <button type="button" class="btn btn-primary" data-action="submit-order-note" data-order-key="${escapeAttribute(orderKey)}" ${isActionLoading ? "disabled" : ""}>Add Note</button>
          <button type="button" class="btn" data-action="close-order-panel" data-order-key="${escapeAttribute(orderKey)}" ${isActionLoading ? "disabled" : ""}>Close</button>
        </div>
      </div>
    `;
  }

  if (type === "apply_coupon") {
    const coupons = Array.isArray(order.coupon_lines) ? order.coupon_lines : [];
    return `
      <div class="meta-block" data-order-panel="${escapeAttribute(orderKey)}" style="margin-top: 10px;">
        <div class="meta-label">Apply Coupon</div>
        <div class="meta-value">
          ${coupons.length
            ? `Currently applied: ${coupons.map((item) => escapeHtml(item.code || "Coupon")).join(", ")}`
            : "No coupons are currently applied to this order."}
        </div>
        <div class="field" style="margin-top: 8px;">
          <label for="coupon-code-${escapeAttribute(orderKey)}">Coupon Code</label>
          <input id="coupon-code-${escapeAttribute(orderKey)}" data-field="coupon-code" type="text" placeholder="SUMMER10" />
        </div>
        <div class="action-row" style="margin-top: 8px;">
          <button type="button" class="btn btn-primary" data-action="submit-apply-coupon" data-order-key="${escapeAttribute(orderKey)}" ${isActionLoading ? "disabled" : ""}>Apply Coupon</button>
          <button type="button" class="btn" data-action="close-order-panel" data-order-key="${escapeAttribute(orderKey)}" ${isActionLoading ? "disabled" : ""}>Close</button>
        </div>
      </div>
    `;
  }

  if (type === "full_refund") {
    return `
      <div class="meta-block" data-order-panel="${escapeAttribute(orderKey)}" style="margin-top: 10px;">
        <div class="meta-label">Confirm Full Refund</div>
        <div class="meta-value">This will attempt to refund the full remaining amount for order #${escapeHtml(order.order_number)}.</div>
        <div class="action-row" style="margin-top: 8px;">
          <button type="button" class="btn btn-primary" data-action="submit-full-refund" data-order-key="${escapeAttribute(orderKey)}" ${isActionLoading ? "disabled" : ""}>Run Full Refund</button>
          <button type="button" class="btn" data-action="close-order-panel" data-order-key="${escapeAttribute(orderKey)}" ${isActionLoading ? "disabled" : ""}>Close</button>
        </div>
      </div>
    `;
  }

  if (type === "cancel_order") {
    return `
      <div class="meta-block" data-order-panel="${escapeAttribute(orderKey)}" style="margin-top: 10px;">
        <div class="meta-label">Confirm Cancellation</div>
        <div class="meta-value">This will set order #${escapeHtml(order.order_number)} to Cancelled.</div>
        <div class="action-row" style="margin-top: 8px;">
          <button type="button" class="btn btn-primary" data-action="submit-cancel-order" data-order-key="${escapeAttribute(orderKey)}" ${isActionLoading ? "disabled" : ""}>Cancel Order</button>
          <button type="button" class="btn" data-action="close-order-panel" data-order-key="${escapeAttribute(orderKey)}" ${isActionLoading ? "disabled" : ""}>Close</button>
        </div>
      </div>
    `;
  }

  if (type === "partial_refund") {
    return `
      <div class="meta-block" data-order-panel="${escapeAttribute(orderKey)}" style="margin-top: 10px;">
        <div class="meta-label">Partial Refund</div>
        <div class="field" style="margin-top: 8px;">
          <label for="refund-amount-${escapeAttribute(orderKey)}">Amount</label>
          <input id="refund-amount-${escapeAttribute(orderKey)}" data-field="refund-amount" type="number" min="0" step="0.01" placeholder="10.00" />
        </div>
        <div class="field" style="margin-top: 8px;">
          <label for="refund-reason-${escapeAttribute(orderKey)}">Reason</label>
          <input id="refund-reason-${escapeAttribute(orderKey)}" data-field="refund-reason" type="text" placeholder="Refund reason" />
        </div>
        <div class="action-row" style="margin-top: 8px;">
          <button type="button" class="btn btn-primary" data-action="submit-partial-refund" data-order-key="${escapeAttribute(orderKey)}" ${isActionLoading ? "disabled" : ""}>Refund Amount</button>
          <button type="button" class="btn" data-action="close-order-panel" data-order-key="${escapeAttribute(orderKey)}" ${isActionLoading ? "disabled" : ""}>Close</button>
        </div>
      </div>
    `;
  }

  if (type === "edit_shipping") {
    const shipping = order.shipping_address || {};
    return `
      <div class="meta-block" data-order-panel="${escapeAttribute(orderKey)}" style="margin-top: 10px;">
        <div class="card-grid" style="margin-top: 8px;">
          <div class="field">
            <label for="shipping-first-name-${escapeAttribute(orderKey)}">First Name</label>
            <input id="shipping-first-name-${escapeAttribute(orderKey)}" data-field="shipping-first_name" type="text" value="${escapeAttribute(shipping.first_name || "")}" />
          </div>
          <div class="field">
            <label for="shipping-last-name-${escapeAttribute(orderKey)}">Last Name</label>
            <input id="shipping-last-name-${escapeAttribute(orderKey)}" data-field="shipping-last_name" type="text" value="${escapeAttribute(shipping.last_name || "")}" />
          </div>
          <div class="field">
            <label for="shipping-company-${escapeAttribute(orderKey)}">Company</label>
            <input id="shipping-company-${escapeAttribute(orderKey)}" data-field="shipping-company" type="text" value="${escapeAttribute(shipping.company || "")}" />
          </div>
          <div class="field">
            <label for="shipping-country-${escapeAttribute(orderKey)}">Country *</label>
            <input id="shipping-country-${escapeAttribute(orderKey)}" data-field="shipping-country" type="text" value="${escapeAttribute(shipping.country || "")}" />
          </div>
          <div class="field">
            <label for="shipping-address1-${escapeAttribute(orderKey)}">Address Line 1 *</label>
            <input id="shipping-address1-${escapeAttribute(orderKey)}" data-field="shipping-address_1" type="text" value="${escapeAttribute(shipping.address_1 || "")}" />
          </div>
          <div class="field">
            <label for="shipping-address2-${escapeAttribute(orderKey)}">Address Line 2</label>
            <input id="shipping-address2-${escapeAttribute(orderKey)}" data-field="shipping-address_2" type="text" value="${escapeAttribute(shipping.address_2 || "")}" />
          </div>
          <div class="field">
            <label for="shipping-city-${escapeAttribute(orderKey)}">City *</label>
            <input id="shipping-city-${escapeAttribute(orderKey)}" data-field="shipping-city" type="text" value="${escapeAttribute(shipping.city || "")}" />
          </div>
          <div class="field">
            <label for="shipping-state-${escapeAttribute(orderKey)}">State</label>
            <input id="shipping-state-${escapeAttribute(orderKey)}" data-field="shipping-state" type="text" value="${escapeAttribute(shipping.state || "")}" />
          </div>
          <div class="field">
            <label for="shipping-postcode-${escapeAttribute(orderKey)}">Postal Code *</label>
            <input id="shipping-postcode-${escapeAttribute(orderKey)}" data-field="shipping-postcode" type="text" value="${escapeAttribute(shipping.postcode || "")}" />
          </div>
          <div class="field">
            <label for="shipping-phone-${escapeAttribute(orderKey)}">Phone *</label>
            <input id="shipping-phone-${escapeAttribute(orderKey)}" data-field="shipping-phone" type="text" value="${escapeAttribute(shipping.phone || "")}" />
          </div>
        </div>
        <div class="action-row" style="margin-top: 8px;">
          <button type="button" class="btn btn-primary" data-action="submit-edit-shipping" data-order-key="${escapeAttribute(orderKey)}" ${isActionLoading ? "disabled" : ""}>Save Shipping</button>
          <button type="button" class="btn" data-action="close-order-panel" data-order-key="${escapeAttribute(orderKey)}" ${isActionLoading ? "disabled" : ""}>Close</button>
        </div>
      </div>
    `;
  }

  return "";
}

function renderOrderNote(note) {
  const author = escapeHtml(note && note.author || "PrestaShop");
  const createdAt = escapeHtml(formatDate(note && note.created_at) || "Unknown date");
  const body = escapeHtml(note && note.note || "");
  const visibility = note && note.customer_note ? "Customer note" : "Internal note";
  return `<strong>${author}</strong> · ${createdAt}<br />${escapeHtml(visibility)}<br />${body}`;
}

function getOrderNotesState(orderKey) {
  return state.orderNotesByKey[orderKey] || { notes: [] };
}

function renderLineItemCard(item) {
  const options = (Array.isArray(item.options) ? item.options : []).join(", ") || "None";
  return `
    <div class="product-card">
      <div class="card-head">
        <div class="card-title">
          ${item.admin_url ? `<a href="${escapeAttribute(item.admin_url)}" target="_blank" rel="noreferrer">${escapeHtml(item.name || "Product")}</a>` : escapeHtml(item.name || "Product")}
        </div>
        <span class="pill pill-muted pill-plain">Qty ${escapeHtml(String(item.quantity || 0))}</span>
      </div>
      <div class="product-meta">
        <div class="info-row"><span class="info-k">Price</span><span class="info-v">${escapeHtml(item.price_formatted || "N/A")}</span></div>
        <div class="info-row"><span class="info-k">SKU</span><span class="info-v">${escapeHtml(item.sku || "N/A")}</span></div>
        <div class="info-row"><span class="info-k">Options</span><span class="info-v">${escapeHtml(options)}</span></div>
        <div class="info-row"><span class="info-k">Total</span><span class="info-v">${escapeHtml(item.total_formatted || "N/A")}</span></div>
      </div>
    </div>
  `;
}

function renderStoreScan() {
  const summary = state.payload.summary || {};
  refs.scanSummary.textContent = `${summary.stores_scanned || 0} store(s) scanned, ${summary.matched_customers || 0} customer match(es), ${summary.matched_orders || 0} order match(es).`;
  const errors = Array.isArray(state.payload.store_errors) ? state.payload.store_errors : [];
  refs.storeErrors.innerHTML = errors.map((item) => {
    return `
      <article class="scan-card">
        <div class="card-title">${escapeHtml(item.store_name || "Store")}</div>
        <div class="meta-copy">${escapeHtml(item.message || "Unknown error")}</div>
      </article>
    `;
  }).join("");
}

function renderSectionVisibility() {
  const orderDataVisible = isOrderDataVisible();
  refs.filtersSection.classList.toggle("hidden", !orderDataVisible);
  // The order search bar is only meaningful when order data is enabled; unlike the
  // Orders list it stays visible even when there are no current matches, so agents
  // can still run a lookup.
  refs.orderSearchSection.classList.toggle("hidden", !orderDataVisible);
  refs.orderSection.classList.toggle("hidden", !orderDataVisible || shouldCollapseEmptySection("orders"));
  refs.customerSection.classList.toggle("hidden", shouldCollapseEmptySection("customers"));
}

function shouldCollapseEmptySection(sectionName) {
  if (state.loading || !shouldSuppressPartialEmptyStates()) {
    return false;
  }

  const customers = Array.isArray(state.payload.customers) ? state.payload.customers : [];
  const orders = Array.isArray(state.payload.orders) ? state.payload.orders : [];
  const hasCustomers = customers.length > 0;
  const hasOrders = isOrderDataVisible() && orders.length > 0;

  if (!hasCustomers && !hasOrders) {
    return false;
  }

  if (sectionName === "customers") {
    return !hasCustomers && hasOrders;
  }

  if (sectionName === "orders") {
    return !hasOrders && hasCustomers;
  }

  return false;
}

function shouldSuppressPartialEmptyStates() {
  return resolveFlag("display_not_found_only_when_all_stores_empty", false);
}

function isOrderDataVisible() {
  return resolveFlag("show_order_data_in_order_tab", true);
}

function resolveFlag(flagName, fallback) {
  const payloadFlags = state.payload && state.payload.flags;
  if (payloadFlags && Object.prototype.hasOwnProperty.call(payloadFlags, flagName)) {
    return normalizeBoolean(payloadFlags[flagName], fallback);
  }

  if (state.iparams && Object.prototype.hasOwnProperty.call(state.iparams, flagName)) {
    return normalizeBoolean(state.iparams[flagName], fallback);
  }

  return fallback;
}

async function handleOrderActionClick(event) {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }

  // Let links inside a collapsible header navigate without toggling.
  if (target.closest("a")) {
    return;
  }

  const button = target.closest("[data-action]");
  if (!(button instanceof HTMLElement)) {
    return;
  }

  const action = normalizeText(button.dataset.action);
  const orderKey = normalizeText(button.dataset.orderKey);

  if (action === "toggle-order" && orderKey) {
    state.expandedOrders[orderKey] = !state.expandedOrders[orderKey];
    renderOrders();
    return;
  }

  if (!action || !orderKey) {
    return;
  }

  if (action === "open-order-panel") {
    const panelType = normalizeText(button.dataset.panel);
    if (["full_refund", "partial_refund", "edit_shipping"].includes(panelType)) {
      await openOrderActionModal(findOrderByKey(orderKey), panelType);
      return;
    }

    clearOrderActionMessage(orderKey);
    state.activeOrderPanel = {
      key: orderKey,
      type: panelType,
    };
    if (state.activeOrderPanel.type === "order_notes") {
      void loadOrderNotes(findOrderByKey(orderKey));
    }
    renderOrders();
    scrollToOrderActionArea(orderKey);
    return;
  }

  if (action === "close-order-panel") {
    state.activeOrderPanel = { key: "", type: "" };
    renderOrders();
    return;
  }

  const order = findOrderByKey(orderKey);
  if (!order || state.actionLoadingKey) {
    return;
  }

  if (action === "submit-full-refund") {
    await runOrderAction(order, "refundPrestaShopOrder", {
      store_id: order.store_id,
      order_id: order.id,
    });
    return;
  }

  if (action === "submit-cancel-order") {
    await runOrderAction(order, "cancelPrestaShopOrder", {
      store_id: order.store_id,
      order_id: order.id,
    });
    return;
  }

  if (action === "submit-partial-refund") {
    const panel = button.closest("[data-order-panel]");
    const amountInput = panel && panel.querySelector("[data-field='refund-amount']");
    const reasonInput = panel && panel.querySelector("[data-field='refund-reason']");
    const amount = amountInput && "value" in amountInput ? amountInput.value : "";
    if (!normalizeText(amount)) {
      showPageMessage("Enter a refund amount before submitting a partial refund.", "error");
      return;
    }
    await runOrderAction(order, "refundPrestaShopOrder", {
      store_id: order.store_id,
      order_id: order.id,
      amount,
      reason: reasonInput && "value" in reasonInput ? reasonInput.value : "",
    });
    return;
  }

  if (action === "submit-edit-shipping") {
    const panel = button.closest("[data-order-panel]");
    await runOrderAction(order, "updatePrestaShopOrderShipping", {
      store_id: order.store_id,
      order_id: order.id,
      shipping: collectShippingPayloadFromPanel(panel),
    });
    return;
  }

  if (action === "submit-order-note") {
    const panel = button.closest("[data-order-panel]");
    const noteInput = panel && panel.querySelector("[data-field='order-note']");
    const customerNoteInput = panel && panel.querySelector("[data-field='order-note-customer']");
    const note = noteInput && "value" in noteInput ? noteInput.value : "";
    if (!normalizeText(note)) {
      showPageMessage("Enter a note before submitting.", "error");
      return;
    }

    await runOrderNoteAction(order, {
      store_id: order.store_id,
      order_id: order.id,
      note,
      customer_note: customerNoteInput && "value" in customerNoteInput ? customerNoteInput.value : "false",
    });
    return;
  }

  if (action === "submit-apply-coupon") {
    const panel = button.closest("[data-order-panel]");
    const couponInput = panel && panel.querySelector("[data-field='coupon-code']");
    const couponCode = couponInput && "value" in couponInput ? couponInput.value : "";
    if (!normalizeText(couponCode)) {
      showPageMessage("Enter a coupon code before submitting.", "error");
      return;
    }

    await runOrderAction(order, "applyPrestaShopOrderCoupon", {
      store_id: order.store_id,
      order_id: order.id,
      coupon_code: couponCode,
    });
  }
}

async function openOrderActionModal(order, mode) {
  if (!order) {
    showPageMessage("Unable to open this PrestaShop order action because the order data is not loaded.", "error");
    return;
  }

  const orderKey = getOrderKey(order);
  clearOrderActionMessage(orderKey);
  clearPageMessage();

  try {
    await client.interface.trigger("showModal", {
      title: mode === "edit_shipping" ? "Update Shipping Address" : "Refund Order",
      template: "order_action_modal.html",
      data: {
        mode,
        order,
        app_settings: state.iparams,
      },
    });
  } catch (error) {
    console.error("Unable to open PrestaShop order action modal:", error);
    showPageMessage(resolveErrorMessage(error, "Could not open the PrestaShop order action window."), "error");
  }
}

function handleInstanceMessages(event) {
  const candidate = event && (event.message || event.data || event);
  const payload = candidate && candidate.message ? candidate.message : candidate;

  if (!payload || payload.type !== "prestashopOrderActionCompleted") {
    return;
  }

  const updatedOrder = payload.order && typeof payload.order === "object" ? payload.order : null;
  const orderKey = updatedOrder ? getOrderKey(updatedOrder) : "";
  const message = payload.message || "PrestaShop action completed successfully.";

  if (updatedOrder) {
    upsertOrder(updatedOrder);
  }

  state.activeOrderPanel = { key: "", type: "" };
  if (orderKey) {
    showOrderActionMessage(orderKey, message, "success");
  } else {
    // No order context to anchor the message to — fall back to the page banner.
    showPageMessage(message, "success");
  }
  render();
  scrollToOrderActionArea(orderKey);
}

async function loadOrderNotes(order) {
  if (!order) {
    return;
  }

  const orderKey = getOrderKey(order);
  state.notesLoadingKey = orderKey;
  renderOrders();
  scrollToOrderActionArea(orderKey);

  try {
    const response = await invokeServerFunction("getPrestaShopOrderNotes", {
      store_id: order.store_id,
      order_id: order.id,
      app_settings: state.iparams,
    });

    state.orderNotesByKey[orderKey] = {
      notes: Array.isArray(response && response.notes) ? response.notes : [],
    };
  } catch (error) {
    console.error("PrestaShop order notes load failed:", error);
    showPageMessage(resolveErrorMessage(error, "Unable to load PrestaShop order notes."), "error");
  } finally {
    state.notesLoadingKey = "";
    render();
    scrollToOrderActionArea(orderKey);
  }
}

function collectShippingPayloadFromPanel(panel) {
  const safePanel = panel || document.createElement("div");
  return {
    first_name: readPanelInputValue(safePanel, "shipping-first_name"),
    last_name: readPanelInputValue(safePanel, "shipping-last_name"),
    company: readPanelInputValue(safePanel, "shipping-company"),
    address_1: readPanelInputValue(safePanel, "shipping-address_1"),
    address_2: readPanelInputValue(safePanel, "shipping-address_2"),
    city: readPanelInputValue(safePanel, "shipping-city"),
    state: readPanelInputValue(safePanel, "shipping-state"),
    postcode: readPanelInputValue(safePanel, "shipping-postcode"),
    phone: readPanelInputValue(safePanel, "shipping-phone"),
    country: readPanelInputValue(safePanel, "shipping-country"),
  };
}

function readPanelInputValue(panel, fieldName) {
  const element = panel.querySelector(`[data-field='${fieldName}']`);
  return element && "value" in element ? element.value : "";
}

async function runOrderAction(order, functionName, payload) {
  const orderKey = getOrderKey(order);
  state.actionLoadingKey = orderKey;
  clearOrderActionMessage(orderKey);
  clearPageMessage();
  renderOrders();
  scrollToOrderActionArea(orderKey);

  try {
    const response = await invokeServerFunction(functionName, {
      ...payload,
      app_settings: state.iparams,
    });

    if (response && response.order) {
      upsertOrder(response.order);
    }

    state.activeOrderPanel = { key: "", type: "" };
    const successMessage = response && response.message ? response.message : "PrestaShop action completed successfully.";
    showOrderActionMessage(orderKey, successMessage, "success");
  } catch (error) {
    console.error("PrestaShop order action failed:", functionName, error);
    const errorMessage = resolveErrorMessage(error, "Unable to complete the PrestaShop order action.");
    showOrderActionMessage(orderKey, errorMessage, "error");
  } finally {
    state.actionLoadingKey = "";
    render();
    scrollToOrderActionArea(orderKey);
  }
}

async function runOrderNoteAction(order, payload) {
  const orderKey = getOrderKey(order);
  state.actionLoadingKey = orderKey;
  clearOrderActionMessage(orderKey);
  clearPageMessage();
  renderOrders();
  scrollToOrderActionArea(orderKey);

  try {
    const response = await invokeServerFunction("addPrestaShopOrderNote", {
      ...payload,
      app_settings: state.iparams,
    });

    state.orderNotesByKey[orderKey] = {
      notes: Array.isArray(response && response.notes) ? response.notes : [],
    };
    const successMessage = response && response.message ? response.message : "Order note added successfully.";
    showOrderActionMessage(orderKey, successMessage, "success");
  } catch (error) {
    console.error("PrestaShop order note action failed:", error);
    const errorMessage = resolveErrorMessage(error, "Unable to add the PrestaShop order note.");
    showOrderActionMessage(orderKey, errorMessage, "error");
  } finally {
    state.actionLoadingKey = "";
    render();
    scrollToOrderActionArea(orderKey);
  }
}

function scrollToOrderActionArea(orderKey) {
  if (!orderKey || !refs.orderList) {
    return;
  }

  requestAnimationFrame(() => {
    // A result message always wins focus when present: after an action it is the
    // thing the agent needs to see, and it renders above a still-open panel (e.g.
    // notes, or an inline panel left open on error). When opening a panel there is
    // no result message (it is cleared first), so we fall back to the panel.
    const target =
      findOrderActionElement("[data-order-action-result]", "orderActionResult", orderKey) ||
      findOrderActionElement("[data-order-panel]", "orderPanel", orderKey) ||
      findOrderActionElement("[data-order-actions]", "orderActions", orderKey);

    if (target && typeof target.scrollIntoView === "function") {
      target.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  });
}

function findOrderActionElement(selector, dataKey, orderKey) {
  return Array.from(refs.orderList.querySelectorAll(selector))
    .find((element) => element instanceof HTMLElement && element.dataset[dataKey] === orderKey);
}

function findOrderByKey(orderKey) {
  return (Array.isArray(state.payload.orders) ? state.payload.orders : []).find((order) => getOrderKey(order) === orderKey) || null;
}

function upsertOrder(updatedOrder) {
  const orders = Array.isArray(state.payload.orders) ? state.payload.orders.slice() : [];
  const updatedKey = getOrderKey(updatedOrder);
  const nextOrders = orders.map((order) => getOrderKey(order) === updatedKey ? updatedOrder : order);
  state.payload.orders = nextOrders;
}

function getOrderKey(order) {
  return `${normalizeText(order && order.store_id)}:${normalizeText(order && order.id)}`;
}

function getCustomerKey(customer, index) {
  const store = normalizeText(customer && (customer.store_id || customer.store_name));
  const ident = normalizeText(customer && (customer.id || customer.email || customer.name));
  return `${store}:${ident || `idx-${index}`}`;
}

// Everything starts collapsed: the sidebar shows only compact summary rows
// on open, and the agent expands a card (via its chevron) to reveal details.
function applyDefaultExpansion() {
  state.expandedOrders = {};
  state.expandedCustomers = {};
}

function chevronSvg(className) {
  return `<svg class="${className || "chevron"}" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M6 8l4 4 4-4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

// Long fields (addresses) collapse to a single truncated line and expand on
// click via native <details> — no JS state needed. Short values render inline.
function renderAddressField(label, formatted) {
  const text = normalizeText(formatted) || "Not available";
  const oneLine = text.replace(/\s*\n\s*/g, ", ");
  const isLong = /\n/.test(text) || oneLine.length > 30;

  if (!isLong) {
    return `<div class="info-row"><span class="info-k">${escapeHtml(label)}</span><span class="info-v">${escapeHtml(oneLine)}</span></div>`;
  }

  return `
    <details class="addr">
      <summary class="addr-sum">
        <span class="info-k">${escapeHtml(label)}</span>
        <span class="addr-oneline">${escapeHtml(oneLine)}</span>
        <svg class="addr-chevron" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M6 8l4 4 4-4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </summary>
      <div class="addr-full">${escapeHtml(text)}</div>
    </details>
  `;
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
  return payload.detail || payload.message || "";
}

function showPageMessage(text, type) {
  state.message = {
    text,
    type,
  };
  renderMessage();
}

function showOrderActionMessage(orderKey, text, type) {
  if (!orderKey || !text) {
    return;
  }

  state.orderActionMessagesByKey[orderKey] = {
    text,
    type,
  };
}

function clearOrderActionMessage(orderKey) {
  if (!orderKey) {
    return;
  }

  delete state.orderActionMessagesByKey[orderKey];
}

function clearPageMessage() {
  state.message = {
    text: "",
    type: "",
  };
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

function formatDate(value) {
  const normalized = normalizeText(value);
  if (!normalized) {
    return "";
  }
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) {
    return normalized;
  }
  return date.toLocaleString();
}

function resolveStatusPillClass(status) {
  const normalized = normalizeText(status).replace(/^wc-/, "").toLowerCase();
  if (["completed", "processing", "refunded", "shipped"].includes(normalized)) {
    return "pill-success";
  }
  if (["cancelled", "failed"].includes(normalized)) {
    return "pill-muted";
  }
  return "pill-info";
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
