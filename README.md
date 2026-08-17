# PrestaShop Pro for Freshdesk

Freshdesk app and companion PrestaShop module for connecting PrestaShop customer and order data to Freshdesk.

## Public PrestaShop Module

The PrestaShop webhook/API companion module is available publicly on GitHub:

- Repository: https://github.com/Akashramsankar/PrestaConnector
- Installable module ZIP: https://github.com/Akashramsankar/PrestaConnector/releases/latest/download/freshdeskconnector.zip
- Module folder: https://github.com/Akashramsankar/PrestaConnector/tree/master/prestashop-module/freshdeskconnector
- Download ZIP: https://github.com/Akashramsankar/PrestaConnector/archive/refs/heads/master.zip

Upload `freshdeskconnector.zip` from the latest GitHub release in PrestaShop Back Office, or install the `prestashop-module/freshdeskconnector` folder into the PrestaShop `modules/` directory. Then install and configure the module from the PrestaShop Back Office.

## Freshdesk App Package

The Freshdesk app package is generated as:

```bash
dist/PrestaConnector.zip
```

Run validation and packaging with:

```bash
fdk validate --errors-only
fdk pack
```

## Companion Module Docs

See `prestashop-module/freshdeskconnector/README.md` for merchant installation, Freshdesk setup, supported endpoints, webhook events, and test steps.
