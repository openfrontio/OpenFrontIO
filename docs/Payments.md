# Inline Stripe payments (wallet buttons on store tiles)

How the web store checks out without leaving the page: an Apple Pay / Google
Pay button on each dollar-priced tile, and a "pay with card" form in a modal.
The pre-existing flow — redirect to Stripe Checkout — remains the fallback at
every level, and the Steam rail is untouched.

## What ships in this repo vs. the API

This repo contains the client (tiles, wallet button, card modal, confirm flow)
and the game server's Apple Pay domain-verification route. The API worker
(closed source) owns minting PaymentIntents and granting entitlements; its
requirements are listed below and **the inline flow stays dormant until it
implements them** — until then every purchase degrades to the redirect flow
automatically.

## Client architecture

| Piece                                     | Role                                                                          |
| ----------------------------------------- | ----------------------------------------------------------------------------- |
| `src/client/StripeInline.ts`              | Stripe.js loading, per-tile `InlineCheckoutSession` (Elements + confirm flow) |
| `src/client/components/InlineCheckout.ts` | The tile's dollar line: wallet button, price button, card modal               |
| `src/client/Payments.ts`                  | `createInlinePaymentIntent()` — mints the intent via `/payments/checkout`     |
| `src/core/ApiSchemas.ts`                  | The `client_secret` handoff / `clientSecret` response field                   |

Flow (deferred-intent, per current Stripe docs for `@stripe/stripe-js` v9):

1. A dollar-priced tile renders `<inline-checkout>`; it creates an Elements
   group in deferred mode (`mode: "payment"`, amount, `usd`) and mounts an
   Express Checkout Element. Where no wallet is available (desktop Firefox)
   the element renders nothing and the row stays collapsed — the price button
   below it is the load-bearing path and opens the card modal.
2. **No PaymentIntent exists yet.** On the first confirm (wallet sheet
   confirmed, or card form submitted), the client calls
   `POST /payments/checkout` with `handoffs: ["redirect", "client_secret"]`,
   gets a client secret back, and calls
   `stripe.confirmPayment({ elements, clientSecret, redirect: "if_required" })`.
3. The client secret is cached per tile for retries (a declined card leaves
   the intent reusable, and checkout is rate-limited). Changing the purchase —
   the custom-amount slider — drops the cache.
4. The browser success callback is UI only: close the modal, thank the player,
   re-read `/users/@me` (immediately and once again ~2.5s later for webhook
   lag). **The webhook grants the entitlement, never the client.**

What checks out inline: currency packs and the custom plutonium amount.
Subscriptions are recurring — not a PaymentIntent — and keep the redirect
flow, as do dollar-priced tiles whose display price the client can't parse
(`priceStringToCents`).

The amount passed to Stripe's sheet is display-only; the server prices the
real intent. If they disagree (stale catalog), Stripe refuses the confirm.

The store only opens from the main menu, so no game is running under the
wallet sheet; there is no game-loop pause to manage.

## Wire contract (what the API must implement)

`POST /payments/checkout` request gains an optional field:

```jsonc
{
  "provider": "stripe",
  "kind": "currency_pack",
  "packName": "starter_pack",
  "handoffs": ["redirect", "client_secret"],
}
```

`handoffs` lists what the client can perform. A server that predates the field
ignores it and answers `redirect` — which the client still handles, so either
side can deploy first. When the server supports it, it answers:

```jsonc
{
  "orderId": "…",
  "provider": "stripe",
  "kind": "currency_pack",
  "handoff": "client_secret",
  "redirectUrl": null,
  "clientSecret": "pi_…_secret_…",
  "expiresAt": "…",
}
```

Server-side requirements for the PaymentIntent:

- **Price from the server's own catalog, keyed by the listing name in the
  request. Never accept an amount from the client** (the request carries none,
  except `custom_currency.hardAmount`, which is a quantity priced
  server-side at the fixed rate, bounds-checked as today).
- Put the listing identity (`kind` + name / amount) in PaymentIntent
  `metadata`, so the webhook can grant from the event alone.
- Use `automatic_payment_methods`, not a hardcoded card-only list.
- Grant from `payment_intent.succeeded` **webhook**, keyed off that metadata,
  **idempotently** — Stripe retries and replays, and a non-idempotent handler
  double-grants plutonium.
- Consider the rate limit: the client re-uses one intent per tile per
  purchase, but a player moving the custom-amount slider between attempts
  mints a fresh intent; abandoned inline intents need the same sweeping as
  abandoned Checkout sessions.

## Stripe dashboard / domain setup

1. Enable Apple Pay and Google Pay under Settings → Payment methods.
2. Register the production and staging **game** domains for Apple Pay (the
   payment happens on the game origin now, not checkout.stripe.com).
3. Verify the association file is served raw:

   ```
   curl https://<domain>/.well-known/apple-developer-merchantid-domain-association
   ```

   The game server serves it from
   `resources/.well-known/apple-developer-merchantid-domain-association`
   (Stripe's universal file, vendored; route in `src/server/Master.ts` — the
   SPA fallback would otherwise swallow the path and Apple Pay would fail
   silently). Check this against the deployed domain before debugging
   anything else.

4. Set `STRIPE_PUBLISHABLE_KEY` in the client build environment. A build
   without it disables the inline flow entirely (redirect fallback).

## Testing

- Apple Pay: Safari only, real card in Wallet, HTTPS on a registered domain —
  never localhost. Use staging or a tunnel on a registered domain.
- Google Pay: Chrome.
- Firefox desktop: the tile must show no wallet row and the price button must
  open the card modal.
- Replay the `payment_intent.succeeded` webhook and confirm exactly one grant.
- Steam (desktop shell): tiles must behave exactly as before (overlay flow).
