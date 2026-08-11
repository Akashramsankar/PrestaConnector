<?php

class FreshdeskConnectorApiModuleFrontController extends ModuleFrontController
{
    public $ajax = true;
    public $ssl = true;
    protected $routeParams = [];

    public function initContent()
    {
        parent::initContent();

        if (!$this->isAuthorized()) {
            $this->json(['message' => 'Unauthorized'], 401);
        }

        $route = (string) Tools::getValue('fw_route', '/freshworks/ping');
        $query = parse_url($route, PHP_URL_QUERY);
        if ($query) {
            parse_str($query, $this->routeParams);
            $route = (string) parse_url($route, PHP_URL_PATH);
        }
        $method = strtoupper((string) $_SERVER['REQUEST_METHOD']);

        try {
            if ($method === 'GET' && $route === '/freshworks/ping') {
                $this->json(['success' => true, 'module' => 'freshdeskconnector']);
            }
            if ($method === 'POST' && $route === '/freshworks/webhook/install') {
                $payload = $this->jsonBody();
                Configuration::updateValue(FreshdeskConnector::CALLBACK_CONFIG, trim((string) ($payload['deliveryUrl'] ?? '')));
                if ($this->module && method_exists($this->module, 'ensureWebhookHooksRegistered')) {
                    $this->module->ensureWebhookHooksRegistered();
                }
                $this->json(true);
            }
            if ($method === 'GET' && preg_match('#^/freshworks/customers/(\d+)$#', $route, $match)) {
                $this->json($this->customerPayload(new Customer((int) $match[1])));
            }
            if ($method === 'GET' && strpos($route, '/freshworks/customers') === 0) {
                $this->json($this->listCustomers());
            }
            if ($method === 'GET' && preg_match('#^/freshworks/customer-groups/(\d+)$#', $route, $match)) {
                $group = new Group((int) $match[1], (int) $this->context->language->id);
                $this->json(['id' => (int) $group->id, 'name' => $group->name]);
            }
            if ($method === 'GET' && preg_match('#^/freshworks/orders/(\d+)/comments$#', $route, $match)) {
                $this->json($this->listOrderMessages((int) $match[1]));
            }
            if ($method === 'POST' && preg_match('#^/freshworks/orders/(\d+)/comments$#', $route, $match)) {
                $this->addOrderMessage((int) $match[1], $this->jsonBody());
                $this->json($this->listOrderMessages((int) $match[1]));
            }
            if ($method === 'POST' && preg_match('#^/freshworks/orders/(\d+)/cancel$#', $route, $match)) {
                $this->cancelOrder((int) $match[1]);
                $this->json(self::orderPayload(new Order((int) $match[1])));
            }
            if ($method === 'POST' && preg_match('#^/freshworks/orders/(\d+)/shipping-address$#', $route, $match)) {
                $this->updateShippingAddress((int) $match[1], $this->jsonBody());
                $this->json(self::orderPayload(new Order((int) $match[1])));
            }
            if ($method === 'GET' && preg_match('#^/freshworks/orders/(\d+)/shipments$#', $route, $match)) {
                $this->json($this->listOrderCarriers((int) $match[1]));
            }
            if ($method === 'GET' && preg_match('#^/freshworks/orders/(\d+)$#', $route, $match)) {
                $this->json(self::orderPayload(new Order((int) $match[1])));
            }
            if ($method === 'GET' && strpos($route, '/freshworks/orders') === 0) {
                $this->json($this->listOrders());
            }

            $this->json(['message' => 'Route not found'], 404);
        } catch (Exception $exception) {
            $this->json(['message' => $exception->getMessage()], 500);
        }
    }

    private function isAuthorized()
    {
        $header = $this->authorizationHeader();
        if (stripos($header, 'Bearer ') !== 0) {
            return false;
        }
        return hash_equals((string) Configuration::get(FreshdeskConnector::TOKEN_CONFIG), trim(substr($header, 7)));
    }

    private function authorizationHeader()
    {
        $candidates = [
            'HTTP_AUTHORIZATION',
            'REDIRECT_HTTP_AUTHORIZATION',
            'Authorization',
        ];

        foreach ($candidates as $key) {
            if (!empty($_SERVER[$key])) {
                return (string) $_SERVER[$key];
            }
        }

        if (function_exists('apache_request_headers')) {
            $headers = apache_request_headers();
            if (isset($headers['Authorization'])) {
                return (string) $headers['Authorization'];
            }
            if (isset($headers['authorization'])) {
                return (string) $headers['authorization'];
            }
        }

        if (function_exists('getallheaders')) {
            $headers = getallheaders();
            if (isset($headers['Authorization'])) {
                return (string) $headers['Authorization'];
            }
            if (isset($headers['authorization'])) {
                return (string) $headers['authorization'];
            }
        }

        return '';
    }

    private function jsonBody()
    {
        $raw = file_get_contents('php://input');
        $payload = json_decode($raw, true);
        return is_array($payload) ? $payload : [];
    }

    private function json($payload, $status = 200)
    {
        http_response_code($status);
        header('Content-Type: application/json');
        echo json_encode($payload);
        exit;
    }

    private function listCustomers()
    {
        $email = trim((string) $this->routeValue('email'));
        $sql = 'SELECT id_customer FROM '._DB_PREFIX_.'customer WHERE deleted = 0';
        if ($email !== '') {
            $sql .= ' AND email = "'.pSQL($email).'"';
        }
        $sql .= ' ORDER BY date_add DESC LIMIT '.(int) $this->routeValue('pageSize', 20);
        $ids = Db::getInstance()->executeS($sql);
        $items = [];
        foreach ($ids as $row) {
            $items[] = $this->customerPayload(new Customer((int) $row['id_customer']));
        }
        return ['items' => $items, 'total_count' => count($items)];
    }

    private function customerPayload(Customer $customer)
    {
        return [
            'id' => (int) $customer->id,
            'email' => $customer->email,
            'firstname' => $customer->firstname,
            'lastname' => $customer->lastname,
            'id_default_group' => (int) $customer->id_default_group,
            'date_add' => $customer->date_add,
            'addresses' => $this->customerAddresses((int) $customer->id),
        ];
    }

    private function customerAddresses($customerId)
    {
        $rows = Db::getInstance()->executeS('SELECT * FROM '._DB_PREFIX_.'address WHERE deleted = 0 AND id_customer = '.(int) $customerId);
        return is_array($rows) ? $rows : [];
    }

    private function listOrders()
    {
        $conditions = [];
        if (($id = (int) $this->routeValue('orderId')) > 0) {
            $conditions[] = 'o.id_order = '.$id;
        }
        if (($reference = trim((string) $this->routeValue('orderNumber'))) !== '') {
            $conditions[] = 'o.reference = "'.pSQL($reference).'"';
        }
        if (($customerId = (int) $this->routeValue('customerId')) > 0) {
            $conditions[] = 'o.id_customer = '.$customerId;
        }
        if (($email = trim((string) $this->routeValue('email'))) !== '') {
            $conditions[] = 'c.email = "'.pSQL($email).'"';
        }

        $sql = 'SELECT o.id_order FROM '._DB_PREFIX_.'orders o LEFT JOIN '._DB_PREFIX_.'customer c ON c.id_customer = o.id_customer';
        if ($conditions) {
            $sql .= ' WHERE '.implode(' AND ', $conditions);
        }
        $sql .= ' ORDER BY o.date_add DESC LIMIT '.(int) $this->routeValue('pageSize', 50);
        $rows = Db::getInstance()->executeS($sql);
        $items = [];
        foreach ($rows as $row) {
            $items[] = self::orderPayload(new Order((int) $row['id_order']));
        }
        return ['items' => $items, 'total_count' => count($items)];
    }

    public static function orderPayload(Order $order)
    {
        $customer = new Customer((int) $order->id_customer);
        $currency = new Currency((int) $order->id_currency);
        $state = new OrderState((int) $order->current_state, (int) Context::getContext()->language->id);
        $delivery = new Address((int) $order->id_address_delivery);
        $invoice = new Address((int) $order->id_address_invoice);

        return [
            'id' => (int) $order->id,
            'reference' => $order->reference,
            'current_state' => (int) $order->current_state,
            'status_label' => $state->name,
            'date_add' => $order->date_add,
            'id_customer' => (int) $order->id_customer,
            'customer_email' => $customer->email,
            'currency_code' => $currency->iso_code,
            'total_products_wt' => $order->total_products_wt,
            'total_shipping_tax_incl' => $order->total_shipping_tax_incl,
            'total_discounts_tax_incl' => $order->total_discounts_tax_incl,
            'total_paid_tax_incl' => $order->total_paid_tax_incl,
            'payment' => $order->payment,
            'shipping_address' => (array) $delivery,
            'billing_address' => (array) $invoice,
            'items' => $order->getProducts(),
        ];
    }

    private function listOrderMessages($orderId)
    {
        return Db::getInstance()->executeS('SELECT id_message AS id, message AS comment, date_add AS created_at FROM '._DB_PREFIX_.'message WHERE id_order = '.(int) $orderId.' ORDER BY date_add DESC');
    }

    private function addOrderMessage($orderId, array $payload)
    {
        $statusHistory = isset($payload['statusHistory']) && is_array($payload['statusHistory']) ? $payload['statusHistory'] : [];
        $message = trim((string) ($statusHistory['comment'] ?? $payload['comment'] ?? ''));
        if ($message === '') {
            throw new Exception('Order note text is required.');
        }
        $order = new Order((int) $orderId);
        $msg = new Message();
        $msg->id_cart = (int) $order->id_cart;
        $msg->id_customer = (int) $order->id_customer;
        $msg->id_order = (int) $order->id;
        $msg->message = $message;
        $msg->private = empty($statusHistory['is_visible_on_front']);
        $msg->add();
    }

    private function cancelOrder($orderId)
    {
        $order = new Order((int) $orderId);
        if (!Validate::isLoadedObject($order)) {
            throw new Exception('Order not found.');
        }
        $history = new OrderHistory();
        $history->id_order = (int) $order->id;
        $history->changeIdOrderState((int) Configuration::get('PS_OS_CANCELED'), $order);
        $history->addWithemail();
    }

    private function updateShippingAddress($orderId, array $payload)
    {
        $order = new Order((int) $orderId);
        $address = new Address((int) $order->id_address_delivery);
        if (!Validate::isLoadedObject($address)) {
            throw new Exception('Shipping address not found.');
        }
        $address->firstname = (string) ($payload['firstname'] ?? $address->firstname);
        $address->lastname = (string) ($payload['lastname'] ?? $address->lastname);
        $address->company = (string) ($payload['company'] ?? $address->company);
        $address->address1 = (string) ($payload['street1'] ?? $address->address1);
        $address->address2 = (string) ($payload['street2'] ?? $address->address2);
        $address->city = (string) ($payload['city'] ?? $address->city);
        $address->postcode = (string) ($payload['postcode'] ?? $address->postcode);
        $address->phone = (string) ($payload['telephone'] ?? $address->phone);
        $address->id_country = (int) ($payload['countryId'] ?? $address->id_country);
        $address->update();
    }

    private function listOrderCarriers($orderId)
    {
        return Db::getInstance()->executeS('SELECT id_order_carrier AS id, tracking_number, date_add FROM '._DB_PREFIX_.'order_carrier WHERE id_order = '.(int) $orderId);
    }

    private function routeValue($key, $default = '')
    {
        return array_key_exists($key, $this->routeParams) ? $this->routeParams[$key] : Tools::getValue($key, $default);
    }
}
