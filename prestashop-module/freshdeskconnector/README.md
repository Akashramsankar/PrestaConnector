# Freshdesk Connector for PrestaShop

Companion module for the Freshdesk PrestaShop connector app.

## Install

Copy `freshdeskconnector` into the PrestaShop `modules/` directory, then install it from the Back Office module manager.

After install, open the module configuration page and copy the generated module token into the Freshdesk app store settings. The Freshdesk app can then verify the module endpoint and install its event callback automatically.

The app also supports native PrestaShop webservice keys for live customer and order reads. The module token is required for webhooks, order notes, cancellation, and shipping-address updates.

