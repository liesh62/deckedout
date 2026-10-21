# Decked Out store

A responsive storefront and Node.js backend featuring all three supplied games: Never Have I Ever, Truth or Dare, and Bestie Bucketlist. Sample sheets for all three decks are rendered from the supplied PDF and included in `public/assets/`.

## Run locally

Requires Node.js 20 or newer. There are no package dependencies.

1. Copy `.env.example` to `.env` and set a strong, unique `ADMIN_TOKEN`.
2. Start the server with the environment variables loaded: `node --env-file=.env server.mjs`.
3. Open `http://localhost:4173`.
4. Choose **store owner setup** from checkout, enter the admin token, and configure confirmed prices, stock, shipping, tax, contact email, and policy review.

On Windows PowerShell, for a local session:

```powershell
$env:ADMIN_TOKEN = 'replace-with-a-long-random-secret'
node --env-file=.env .\server.mjs
```

The app creates JSON data files on first run. `data/*.json` is intentionally excluded from Git because order files may contain customer addresses and must not be published. Back up the data directory securely. Do not use the JSON store for a multi-instance or high-volume production deployment; replace it with PostgreSQL or a managed database before scaling.

## Razorpay setup

1. Create and verify the merchant's Razorpay account, then use test-mode credentials first.
2. Set `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, and a separate `RAZORPAY_WEBHOOK_SECRET` as server environment variables.
3. Configure a webhook URL ending in `/api/payment/webhook` and subscribe to `payment.captured` and `order.paid`.
4. Set shipping, tax, product prices and stock in the admin dashboard. Complete the actual policies, then mark policy review in settings.
5. Test success, cancellation, failure, inventory edge cases, and webhook delivery using test credentials. Switch to live credentials only after the merchant account and required business/policy details are approved.

The server creates Razorpay orders using server-computed amounts, verifies the checkout signature, and never receives card numbers or UPI PINs. Payment credentials are not included in the browser bundle. Razorpay transaction and payment pricing depends on the merchant's current account terms; verify the applicable charges in the Razorpay dashboard. There are no paid software dependencies in this project.

## Admin and API

The store owner setup modal calls these bearer-token protected endpoints:

- `GET /api/admin/products`, `PATCH /api/admin/products/:id`
- `GET /api/admin/settings`, `PUT /api/admin/settings`
- `GET /api/admin/orders`, `PATCH /api/admin/orders/:id`

Public API routes include `GET /api/products`, `GET /api/public-config`, `POST /api/checkout`, `POST /api/payment/verify`, and `POST /api/payment/webhook`.

## Launch requirements and current limits

The project files are in the GitHub repository, but the site has **not been deployed** and no public URL exists yet. Deployment requires a Node-capable host with persistent storage; GitHub Pages alone cannot run this backend.

Before accepting real orders, the owner still needs to provide or configure:

- Actual prices, inventory, packaging/card-count details, and approved product descriptions.
- Confirm product prices, inventory, packaging, and shipping details for all three games.
- Merchant identity, Razorpay account approval and credentials, shipping regions/rates, applicable tax rules, and completed legal policies.
- A domain and a persistent, backed-up database. This JSON-file backend is a single-instance starter, not a production database.
- A transactional email service, if order emails are required.

Customer accounts/password reset, coupons, automated newsletters, contact email forwarding, a full content editor/media library, and refunds through the gateway are not implemented. The contact form and order records need a configured delivery/service workflow before public launch. Do not describe those features as active. Run deployment and payment-flow testing with sandbox credentials before switching to live mode.

