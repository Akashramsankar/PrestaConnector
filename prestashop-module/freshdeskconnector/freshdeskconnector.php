<?php

if (!defined('_PS_VERSION_')) {
    exit;
}

class FreshdeskConnector extends Module
{
    public const TOKEN_CONFIG = 'FRESHDESKCONNECTOR_TOKEN';
    public const CALLBACK_CONFIG = 'FRESHDESKCONNECTOR_CALLBACK_URL';
    private static $sentCustomerCreatedEvents = [];
    private static $webhookHooks = [
        'actionCustomerAccountAdd',
        'actionObjectCustomerAddAfter',
        'actionCustomerAccountUpdate',
        'actionObjectAddressAddAfter',
        'actionObjectCustomerUpdateAfter',
        'actionValidateOrder',
    ];

    public function __construct()
    {
        $this->name = 'freshdeskconnector';
        $this->tab = 'administration';
        $this->version = '1.0.0';
        $this->author = 'Freshworks';
        $this->need_instance = 0;
        $this->bootstrap = true;

        parent::__construct();

        $this->displayName = $this->l('Freshdesk Connector');
        $this->description = $this->l('Connects PrestaShop customers and orders with Freshdesk.');
        $this->ps_versions_compliancy = ['min' => '1.7.0.0', 'max' => _PS_VERSION_];
    }

    public function install()
    {
        return parent::install()
            && Configuration::updateValue(self::TOKEN_CONFIG, Tools::passwdGen(32))
            && $this->ensureWebhookHooksRegistered();
    }

    public function uninstall()
    {
        Configuration::deleteByName(self::TOKEN_CONFIG);
        Configuration::deleteByName(self::CALLBACK_CONFIG);
        return parent::uninstall();
    }

    public function getContent()
    {
        $this->ensureWebhookHooksRegistered();

        if (Tools::isSubmit('submitFreshdeskConnector')) {
            Configuration::updateValue(self::TOKEN_CONFIG, trim((string) Tools::getValue('freshdeskconnector_token')));
            Configuration::updateValue(self::CALLBACK_CONFIG, trim((string) Tools::getValue('freshdeskconnector_callback_url')));
        }

        $token = Tools::safeOutput(Configuration::get(self::TOKEN_CONFIG));
        $callback = Tools::safeOutput(Configuration::get(self::CALLBACK_CONFIG));
        $endpoint = Tools::safeOutput($this->context->link->getModuleLink($this->name, 'api', [], true));

        return '<form method="post">'
            . '<div class="panel"><h3>'.$this->l('Freshdesk Connector').'</h3>'
            . '<p>'.$this->l('Copy this module token into the Freshdesk app store settings.').'</p>'
            . '<label>'.$this->l('Module API endpoint').'</label>'
            . '<input class="fixed-width-xxl" readonly value="'.$endpoint.'" />'
            . '<label>'.$this->l('Module token').'</label>'
            . '<input class="fixed-width-xxl" name="freshdeskconnector_token" value="'.$token.'" />'
            . '<label>'.$this->l('Freshdesk callback URL').'</label>'
            . '<input class="fixed-width-xxl" name="freshdeskconnector_callback_url" value="'.$callback.'" />'
            . '<button type="submit" name="submitFreshdeskConnector" class="btn btn-primary">'.$this->l('Save').'</button>'
            . '</div></form>';
    }

    public function ensureWebhookHooksRegistered()
    {
        foreach (self::$webhookHooks as $hookName) {
            if (!$this->registerHook($hookName)) {
                return false;
            }
        }

        return true;
    }

    public function hookActionCustomerAccountAdd($params)
    {
        if (!empty($params['newCustomer']) && $params['newCustomer'] instanceof Customer) {
            $this->sendCustomerCreatedEvent($params['newCustomer']);
        }
    }

    public function hookActionObjectCustomerAddAfter($params)
    {
        if (!empty($params['object']) && $params['object'] instanceof Customer) {
            $this->sendCustomerCreatedEvent($params['object']);
        }
    }

    public function hookActionObjectCustomerUpdateAfter($params)
    {
        if (!empty($params['object']) && $params['object'] instanceof Customer) {
            $this->sendEvent('customer.updated', ['customer' => $this->customerPayload($params['object'])]);
        }
    }

    public function hookActionCustomerAccountUpdate($params)
    {
        if (!empty($params['customer']) && $params['customer'] instanceof Customer) {
            $this->sendEvent('customer.updated', ['customer' => $this->customerPayload($params['customer'])]);
        }
    }

    public function hookActionObjectAddressAddAfter($params)
    {
        if (!empty($params['object']) && $params['object'] instanceof Address) {
            $customer = new Customer((int) $params['object']->id_customer);
            if (Validate::isLoadedObject($customer)) {
                $this->sendEvent('customer.updated', ['customer' => $this->customerPayload($customer)]);
            }
        }
    }

    public function hookActionValidateOrder($params)
    {
        if (!empty($params['order']) && $params['order'] instanceof Order) {
            $this->sendEvent('order.created', ['order' => $this->orderPayload($params['order'])]);
        }
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
            'addresses' => $customer->getAddresses((int) $this->context->language->id),
        ];
    }

    private function sendCustomerCreatedEvent(Customer $customer)
    {
        $key = (string) ((int) $customer->id ?: $customer->email);
        if ($key !== '' && isset(self::$sentCustomerCreatedEvents[$key])) {
            return;
        }

        if ($key !== '') {
            self::$sentCustomerCreatedEvents[$key] = true;
        }

        $this->sendEvent('customer.created', ['customer' => $this->customerPayload($customer)]);
    }

    private function orderPayload(Order $order)
    {
        $customer = new Customer((int) $order->id_customer);
        $currency = new Currency((int) $order->id_currency);
        $state = new OrderState((int) $order->current_state, (int) $this->context->language->id);
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

    private function sendEvent($topic, array $data)
    {
        $callbackUrl = trim((string) Configuration::get(self::CALLBACK_CONFIG));
        if ($callbackUrl === '') {
            return;
        }

        $body = json_encode([
            'topic' => $topic,
            'source' => Tools::getShopDomainSsl(true, true),
            'data' => $data,
        ]);

        $ch = curl_init($callbackUrl);
        curl_setopt($ch, CURLOPT_CUSTOMREQUEST, 'POST');
        curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_TIMEOUT, 10);
        curl_setopt($ch, CURLOPT_HTTPHEADER, [
            'Content-Type: application/json',
            'X-PrestaShop-Topic: '.$topic,
            'X-PrestaShop-Source: '.Tools::getShopDomainSsl(true, true),
        ]);
        curl_exec($ch);
        curl_close($ch);
    }
}
