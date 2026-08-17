# PrestaShop Freshdesk Connector Module

Companion PrestaShop module for PrestaShop Pro for Freshdesk.

This module prepares PrestaShop customer/order data for the Freshdesk connector app, provides a PrestaShop-generated module token, and sends customer/order events to the Freshdesk app's external-event callback URL. The Freshdesk app can display PrestaShop data on tickets, create or update contacts, and create tickets for new customers or orders.

## Download From GitHub

Public repository:

```text
https://github.com/Akashramsankar/PrestaConnector
```

Installable module ZIP:

```text
https://github.com/Akashramsankar/PrestaConnector/releases/latest/download/freshdeskconnector.zip
```

Module folder:

```text
https://github.com/Akashramsankar/PrestaConnector/tree/master/prestashop-module/freshdeskconnector
```

Repository ZIP:

```text
https://github.com/Akashramsankar/PrestaConnector/archive/refs/heads/master.zip
```

## Install From GitHub Release

Download `freshdeskconnector.zip` from the latest GitHub release:

```text
https://github.com/Akashramsankar/PrestaConnector/releases/latest/download/freshdeskconnector.zip
```

In PrestaShop Back Office, upload and install the ZIP from:

```text
Modules > Module Manager > Upload a module
```

Then open `Freshdesk Connector` and click `Configure`.

## Install From GitHub Source

From the PrestaShop project root, run:

```bash
git clone --depth 1 https://github.com/Akashramsankar/PrestaConnector.git /tmp/prestaconnector
cp -R /tmp/prestaconnector/prestashop-module/freshdeskconnector modules/freshdeskconnector
rm -rf /tmp/prestaconnector
```

Then install `Freshdesk Connector` from:

```text
PrestaShop Back Office > Modules > Module Manager
```

If your PrestaShop installation supports console module commands, you can install it with:

```bash
php bin/console prestashop:module install freshdeskconnector
```

## Manual Install

Download the repository ZIP, extract it, and copy:

```text
prestashop-module/freshdeskconnector
```

into:

```text
<prestashop-root>/modules/freshdeskconnector
```

Then install the module from the PrestaShop Back Office module manager.

## Configure

In PrestaShop Back Office, open the `Freshdesk Connector` module configuration page.

Copy these values for the Freshdesk app settings:

- `Module API endpoint`: used by the Freshdesk app to verify the module endpoint.
- `Module token`: paste this into the Freshdesk app's `PrestaShop API Key` field.

The Freshdesk callback URL is installed automatically when the Freshdesk app settings are saved. Use the callback URL field in PrestaShop only if you need to inspect or manually repair webhook delivery.

The Freshdesk app also supports native PrestaShop webservice keys for live customer and order reads. Use the module token for the smoothest setup. The module token is required for automatic webhook installation, order notes, order cancellation, and shipping-address updates.

## Freshdesk App Setup

In the Freshdesk app settings:

1. Add the PrestaShop store base URL.
2. Paste the module token into the `PrestaShop API Key` field.
3. Keep the default shop ID unless your PrestaShop multishop setup needs a specific `id_shop`.
4. Set the custom admin path if your Back Office does not use `admin-dev`.
5. Validate the store.
6. Enable the sync options you need:
   - Create contact when customer is created
   - Update contact when customer is updated
   - Create ticket when customer is created
   - Create ticket when order is created

When the app settings are saved, the Freshdesk app installs the callback URL into this PrestaShop module automatically. Use `Repair Sync` only if automatic installation fails, a store credential changed, or webhook delivery needs to be repaired.

## Module API Endpoints

The generated module token protects these endpoints through:

```text
/module/freshdeskconnector/api?fw_route=<route>
```

Supported routes:

- `GET /freshworks/ping`
- `GET /freshworks/customers`
- `GET /freshworks/customers/:customerId`
- `GET /freshworks/customer-groups/:groupId`
- `GET /freshworks/orders`
- `GET /freshworks/orders/:orderId`
- `GET /freshworks/orders/:orderId/comments`
- `POST /freshworks/orders/:orderId/comments`
- `GET /freshworks/orders/:orderId/shipments`
- `POST /freshworks/orders/:orderId/cancel`
- `POST /freshworks/orders/:orderId/shipping-address`
- `POST /freshworks/webhook/install`

Send the token as:

```text
Authorization: Bearer <Module Token>
```

## Events Sent

When enabled in the Freshdesk app, this module sends:

- `customer.created`
- `customer.updated`
- `order.created`

Each event is sent as a JSON `POST` request with these headers:

- `X-PrestaShop-Topic`
- `X-PrestaShop-Source`

## Test The Setup

After configuration, create a new PrestaShop customer or place a new order. Then check Freshdesk for the expected contact update or ticket.

For local testing, make sure your PrestaShop store is reachable from Freshdesk through a public HTTPS tunnel before testing hosted app webhooks.
