let client;
let modalData = {};
let selectedOrder = {};
let selectedMode = "";
let submitting = false;

const COUNTRY_OPTIONS = [
  ["", ""],
  ["AU", "Australia"],
  ["BR", "Brazil"],
  ["CA", "Canada"],
  ["FR", "France"],
  ["DE", "Germany"],
  ["IN", "India"],
  ["IT", "Italy"],
  ["JP", "Japan"],
  ["NL", "Netherlands"],
  ["SG", "Singapore"],
  ["AE", "United Arab Emirates"],
  ["GB", "United Kingdom"],
  ["US", "United States"],
];

document.addEventListener("DOMContentLoaded", () => {
  void initialize();
});

async function initialize() {
  try {
    client = await app.initialized();
    const context = await client.instance.context();
    modalData = context && context.data && typeof context.data === "object" ? context.data : {};
    selectedOrder = modalData.order && typeof modalData.order === "object" ? modalData.order : {};
    selectedMode = normalizeText(modalData.mode);

    bindEvents();
    renderModal();
  } catch (error) {
    console.error("Unable to initialize PrestaShop order action modal:", error);
    showMessage("Unable to load this PrestaShop action. Please close and try again.");
  }
}

function bindEvents() {
  const fullRefundBtn = document.getElementById("fullRefundBtn");
  const partialRefundBtn = document.getElementById("partialRefundBtn");
  const updateShippingBtn = document.getElementById("updateShippingBtn");
  const cancelRefundBtn = document.getElementById("cancelRefundBtn");
  const cancelShippingBtn = document.getElementById("cancelShippingBtn");

  if (fullRefundBtn) {
    fullRefundBtn.addEventListener("click", () => {
      void submitRefund(false);
    });
  }
  if (partialRefundBtn) {
    partialRefundBtn.addEventListener("click", () => {
      void submitRefund(true);
    });
  }
  if (updateShippingBtn) {
    updateShippingBtn.addEventListener("click", () => {
      void submitShipping();
    });
  }
  if (cancelRefundBtn) {
    cancelRefundBtn.addEventListener("click", closeModal);
  }
  if (cancelShippingBtn) {
    cancelShippingBtn.addEventListener("click", closeModal);
  }
}

function renderModal() {
  const refundView = document.getElementById("refundView");
  const shippingView = document.getElementById("shippingView");
  const modalTitle = document.getElementById("modalTitle");

  if (isShippingMode()) {
    if (modalTitle) {
      modalTitle.textContent = "Update Shipping Address";
    }
    if (refundView) {
      refundView.classList.add("hidden");
    }
    if (shippingView) {
      shippingView.classList.remove("hidden");
    }
    populateShippingForm();
    return;
  }

  if (modalTitle) {
    modalTitle.textContent = "Refund Order";
  }
  if (shippingView) {
    shippingView.classList.add("hidden");
  }
  if (refundView) {
    refundView.classList.remove("hidden");
  }
  populateRefundForm();
}

function populateRefundForm() {
  const refundItems = document.getElementById("refundItems");
  const items = Array.isArray(selectedOrder.items) ? selectedOrder.items : [];
  const rows = items.length ? items.map(renderRefundItemRow).join("") : renderEmptyRefundRow();
  const refundedTotal = normalizeAmount(selectedOrder.refunded_total);
  const availableTotal = normalizeAmount(selectedOrder.refundable_total || selectedOrder.grand_total);

  if (refundItems) {
    refundItems.innerHTML = rows;
  }
  setText("alreadyRefunded", `Amount already refunded: ${selectedOrder.refunded_total_formatted || formatMoney(refundedTotal)}`);
  setText("availableRefund", `Total Available: ${formatMoney(availableTotal)}`);

  if (selectedMode === "full_refund") {
    const firstAmountInput = refundItems && refundItems.querySelector("[data-refund-amount]");
    if (firstAmountInput && "value" in firstAmountInput) {
      firstAmountInput.value = String(availableTotal ? availableTotal.toFixed(2) : "");
    }
  }
}

function renderRefundItemRow(item) {
  const name = normalizeText(item && item.name) || "Product";
  const price = normalizeText(item && item.price_formatted) || formatMoney(item && item.price);
  const quantity = Number(item && item.quantity || 0);
  const total = normalizeText(item && item.total_formatted) || formatMoney(item && item.total);

  return `
    <tr>
      <td>${escapeHtml(name)}</td>
      <td>${escapeHtml(price)}</td>
      <td>x${escapeHtml(quantity || 0)}</td>
      <td>${escapeHtml(total)}</td>
      <td></td>
    </tr>
    <tr>
      <td></td>
      <td></td>
      <td class="input-cell"><input type="number" min="0" step="1" value="0" data-refund-quantity /></td>
      <td class="input-cell"><input type="number" min="0" step="0.01" value="0" data-refund-amount /></td>
      <td></td>
    </tr>
  `;
}

function renderEmptyRefundRow() {
  return `
    <tr>
      <td>Order total</td>
      <td></td>
      <td></td>
      <td>${escapeHtml(selectedOrder.grand_total_formatted || formatMoney(selectedOrder.grand_total))}</td>
      <td></td>
    </tr>
    <tr>
      <td></td>
      <td></td>
      <td class="input-cell"><input type="number" min="0" step="1" value="0" data-refund-quantity /></td>
      <td class="input-cell"><input type="number" min="0" step="0.01" value="0" data-refund-amount /></td>
      <td></td>
    </tr>
  `;
}

function populateShippingForm() {
  populateCountrySelect();

  const shipping = selectedOrder.shipping_address && typeof selectedOrder.shipping_address === "object"
    ? selectedOrder.shipping_address
    : {};

  setInputValue("shippingFirstName", shipping.first_name);
  setInputValue("shippingLastName", shipping.last_name);
  setInputValue("shippingAddress1", shipping.address_1);
  setInputValue("shippingAddress2", shipping.address_2);
  setInputValue("shippingCountry", shipping.country);
  setInputValue("shippingState", shipping.state);
  setInputValue("shippingCity", shipping.city);
  setInputValue("shippingPostcode", shipping.postcode);
  setInputValue("shippingPhone", shipping.phone);
  setInputValue("shippingCompany", shipping.company);
}

function populateCountrySelect() {
  const select = document.getElementById("shippingCountry");
  if (!select) {
    return;
  }

  const shipping = selectedOrder.shipping_address && typeof selectedOrder.shipping_address === "object"
    ? selectedOrder.shipping_address
    : {};
  const currentCountry = normalizeText(shipping.country).toUpperCase();
  const options = COUNTRY_OPTIONS.slice();
  const hasCurrentCountry = !currentCountry || options.some((option) => option[0] === currentCountry);

  if (!hasCurrentCountry) {
    options.splice(1, 0, [currentCountry, currentCountry]);
  }

  select.innerHTML = options
    .map((option) => `<option value="${escapeAttribute(option[0])}">${escapeHtml(option[1] || "Select country")}</option>`)
    .join("");
}

async function submitRefund(isPartial) {
  if (submitting) {
    return;
  }

  const amount = resolveRefundAmount(isPartial);
  if (isPartial && !(amount > 0)) {
    showMessage("Enter a refund amount before submitting a partial refund.");
    return;
  }

  await runOrderAction("refundPrestaShopOrder", {
    store_id: selectedOrder.store_id,
    order_id: selectedOrder.id,
    amount: isPartial ? amount.toFixed(2) : "",
    reason: getInputValue("refundReason"),
    api_restock: getCheckedValue("restockItems", true),
    api_refund: getCheckedValue("onlineRefund", true),
  });
}

async function submitShipping() {
  if (submitting) {
    return;
  }

  const shipping = collectShippingPayload();
  const validationMessage = validateShipping(shipping);
  if (validationMessage) {
    showMessage(validationMessage);
    return;
  }

  await runOrderAction("updatePrestaShopOrderShipping", {
    store_id: selectedOrder.store_id,
    order_id: selectedOrder.id,
    shipping,
  });
}

async function runOrderAction(functionName, payload) {
  setSubmitting(true);
  showMessage("");

  try {
    const response = await invokeServerFunction(functionName, {
      ...payload,
      app_settings: modalData.app_settings || {},
    });

    await notifySidebar(response);
    closeModal();
  } catch (error) {
    console.error("PrestaShop modal order action failed:", functionName, error);
    showMessage(resolveErrorMessage(error, "Unable to complete the PrestaShop order action."));
    setSubmitting(false);
  }
}

async function notifySidebar(response) {
  if (!client || !client.instance || typeof client.instance.send !== "function") {
    return;
  }

  try {
    await client.instance.send({
      message: {
        type: "prestashopOrderActionCompleted",
        order: response && response.order,
        message: response && response.message ? response.message : "PrestaShop action completed successfully.",
      },
    });
  } catch (error) {
    console.error("Unable to notify PrestaShop sidebar about order action:", error);
  }
}

function resolveRefundAmount(isPartial) {
  if (!isPartial) {
    return normalizeAmount(selectedOrder.refundable_total || selectedOrder.grand_total);
  }

  const amountInputs = Array.from(document.querySelectorAll("[data-refund-amount]"));
  return amountInputs.reduce((sum, input) => {
    return sum + normalizeAmount(input && "value" in input ? input.value : "");
  }, 0);
}

function collectShippingPayload() {
  return {
    first_name: getInputValue("shippingFirstName"),
    last_name: getInputValue("shippingLastName"),
    company: getInputValue("shippingCompany"),
    address_1: getInputValue("shippingAddress1"),
    address_2: getInputValue("shippingAddress2"),
    city: getInputValue("shippingCity"),
    state: getInputValue("shippingState"),
    postcode: getInputValue("shippingPostcode"),
    country: getInputValue("shippingCountry"),
    phone: getInputValue("shippingPhone"),
  };
}

function validateShipping(shipping) {
  if (!normalizeText(shipping.address_1)) {
    return "Shipping address line 1 is required.";
  }
  if (!normalizeText(shipping.city)) {
    return "Shipping city is required.";
  }
  if (!normalizeText(shipping.postcode)) {
    return "Shipping postal code is required.";
  }
  if (!normalizeText(shipping.country)) {
    return "Shipping country is required.";
  }
  if (!normalizeText(shipping.phone)) {
    return "Shipping phone is required.";
  }
  return "";
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
    return safeParseJson(result, null);
  }
  if (typeof result.response === "string") {
    return safeParseJson(result.response, null);
  }
  if (result.response && typeof result.response === "object") {
    return result.response;
  }
  return typeof result === "object" ? result : null;
}

function safeParseJson(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function resolveInvokeError(payload) {
  if (!payload) {
    return "";
  }
  return payload.detail || payload.message || "";
}

function setSubmitting(value) {
  submitting = value;
  ["fullRefundBtn", "partialRefundBtn", "updateShippingBtn", "cancelRefundBtn", "cancelShippingBtn"].forEach((id) => {
    const element = document.getElementById(id);
    if (element) {
      element.disabled = value;
    }
  });
}

function showMessage(text) {
  const message = document.getElementById("modalMessage");
  if (!message) {
    return;
  }
  message.textContent = text || "";
  message.className = text ? "message error" : "message";
}

function closeModal() {
  if (client && client.instance && typeof client.instance.close === "function") {
    client.instance.close();
  }
}

function isShippingMode() {
  return selectedMode === "edit_shipping" || selectedMode === "shipping";
}

function setText(id, value) {
  const element = document.getElementById(id);
  if (element) {
    element.textContent = value;
  }
}

function setInputValue(id, value) {
  const element = document.getElementById(id);
  if (element && "value" in element) {
    element.value = normalizeText(value);
  }
}

function getInputValue(id) {
  const element = document.getElementById(id);
  return element && "value" in element ? element.value : "";
}

function getCheckedValue(id, fallback) {
  const element = document.getElementById(id);
  return element && "checked" in element ? Boolean(element.checked) : fallback;
}

function normalizeAmount(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatMoney(value) {
  const amount = normalizeAmount(value);
  const currency = normalizeText(selectedOrder.currency) || "USD";
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

function resolveErrorMessage(error, fallback) {
  if (!error) {
    return fallback;
  }
  if (typeof error === "string") {
    return error;
  }
  return error.message || fallback;
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

function escapeAttribute(value) {
  return escapeHtml(value);
}
