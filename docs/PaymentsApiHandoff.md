# Handoff: `client_secret` checkout for inline wallet payments (API worker)

Audience: whoever owns the closed-source API worker. The game client now
supports paying on the store tile itself — Apple Pay / Google Pay button plus
an in-page card form — instead of redirecting to Stripe Checkout. That client
is **already shipped and dormant**: it asks for the new behaviour on every
Stripe checkout and degrades to the redirect flow when it doesn't get it. This
document is everything the API must do to light it up. Until then, nothing
changes and nothing breaks.

Client-side details live in the game repo (`docs/Payments.md`); the wire
contract is pinned by `src/core/ApiSchemas.ts` and
`tests/client/PaymentsInline.test.ts` there.

## The one new behaviour on `POST /payments/checkout`

The request gains an **optional** field:

```jsonc
{
  "provider": "stripe",
  "kind": "currency_pack", // or "custom_currency" with hardAmount
  "packName": "starter_pack",
  "handoffs": ["redirect", "client_secret"],
}
```

`handoffs` is the list of handoffs this client can perform. Rules:

- **Field absent** → the client predates this feature. Behave exactly as
  today (Checkout Session → `handoff: "redirect"`).
- **Contains `"client_secret"`**, provider is `stripe`, and the kind is a
  one-time purchase (`currency_pack`, `custom_currency`) → create a
  **PaymentIntent** instead of a Checkout Session and answer:

  ```jsonc
  {
    "orderId": "…", // your internal order id, decimal string, as today
    "provider": "stripe",
    "kind": "currency_pack",
    "handoff": "client_secret",
    "redirectUrl": null,
    "clientSecret": "pi_…_secret_…",
    "expiresAt": "…",
  }
  ```

- **You may still answer `redirect` at any time** — feature flag off, a
  per-listing exception, `subscription_tier` (recurring; the client never
  asks inline for it, but don't rely on that). The client performs whatever
  handoff you name. This is the rollout lever: the field is a capability
  offer, not a demand.
- **Ignore unknown values** in the list (forward compatibility).

Invariants the client's schema enforces (a response violating them is treated
as a failed checkout): `clientSecret` non-null iff `handoff` is
`"client_secret"`; `redirectUrl` non-null iff `handoff` is `"redirect"`. The
error taxonomy is unchanged — every existing error code (`listing_stale`,
`rate_limited`, `provider_error`, …) still applies and the client already maps
them to player-facing messages.

## Creating the PaymentIntent

- **Price it from your own catalog, keyed by the listing name in the
  request. Never accept an amount from the client** — the request carries
  none. (`custom_currency.hardAmount` is a quantity: price it server-side at
  the fixed rate with the existing bounds checks, exactly as the session flow
  does.) This is the single bug in this flow that directly costs money. The
  client passes a display-derived amount to Stripe's _sheet_ only; if it
  disagrees with the intent, Stripe refuses the confirm — that's the desired
  failure.
- Currency: `usd`.
- `automatic_payment_methods: { enabled: true }` — not a hardcoded card-only
  method list.
- **`metadata` must let the webhook grant from the event alone**: `kind`,
  the listing name / hard amount, your internal order id, and the player
  identity. Assume the webhook handler has the event and nothing else.
- Keep minting the internal order row and returning its `orderId`, same as
  the session flow — order history, the sweeper, and support all key off it.
- Do not require a `return_url` server-side. The client passes
  `https://<game-origin>/#purchase-completed?type=<kind>` at confirm time;
  only redirect-based payment methods ever hit it, and the client's landing
  handler treats a missing `status` param as "pending", which is correct.

## Entitlement granting

- Grant from the **`payment_intent.succeeded` webhook**, keyed off the
  metadata. Never from any client-initiated call — client-side grants are the
  standard way game economies get drained.
- The handler must be **idempotent** (unique constraint on the payment intent
  id or order id). Stripe retries and replays; a non-idempotent handler
  double-grants plutonium.
- Handle `payment_intent.payment_failed` / `payment_intent.canceled` by
  moving the order row to a terminal state, so order history is honest.
- Grant promptly but don't sweat webhook lag: the client re-reads
  `/users/@me` immediately after the confirm and once more ~2.5s later, and
  its "purchase pending" messaging covers anything slower.

## Buyer email (guest account recovery)

The redirect flow attached the Stripe-Checkout-collected email to the
purchasing player's account post-fulfillment (`handlePlayerAccount`), which
is what made a guest's purchase recoverable. The inline path currently skips
this — `applyInlineIntentSettled` passes `buyerEmail: undefined` and runs no
after-commit side effects.

The client now closes the collection half: when the account has **no login
email**, the wallet sheet requires one (`emailRequired`) and the card modal
shows an email field, and either way the address rides on the PaymentIntent
as **`receipt_email`** at confirm time. Accounts that already have a login
email are not asked, and no `receipt_email` is set.

API side: in the `payment_intent.succeeded` fulfillment, read
`pi.receipt_email` and, when present, run the same post-fulfillment as the
session path — `handlePlayerAccount` (same conflict rules), confirmation
email, marketing-consent write. Absent `receipt_email` means the buyer
already had a linked email; no attach needed. No extra Stripe fetch is
required — the field is first-class on the intent object in the event.

## Intent lifecycle and the rate limit

Two client behaviours matter here:

- The client **caches the client secret per tile and reuses it across
  retries** of the same purchase — a declined card confirms the same intent
  again. Mint one intent per checkout call; don't try to dedupe across calls.
- Changing the purchase (the custom-amount slider) drops the client's cache,
  so the next attempt is a **fresh checkout call**, and the old intent is
  abandoned. Abandoned inline intents need the same sweeping as abandoned
  Checkout Sessions — cancel the PaymentIntent when its order expires, or
  they accumulate as `requires_payment_method` clutter.
- The 1-checkout-per-60s-per-player limit now bites a legitimate flow: slider
  moved → new intent needed → 429 for up to a minute. The client shows the
  existing rate-limit message, so this is a UX decision, not a correctness
  one — but consider scoping the limit (e.g. counting only distinct listings,
  or a shorter window for `client_secret` checkouts).

## Stripe dashboard / domain setup

0. Add the PaymentIntent events to the webhook endpoint's **enabled events**
   (Developers → Webhooks, per environment): `payment_intent.succeeded`,
   `payment_intent.payment_failed`, `payment_intent.canceled`. The redirect
   flow only ever needed `checkout.session.*`, so an existing endpoint will
   not receive the inline events until these are added — the symptom is a
   payment that succeeds on Stripe but never credits (this exact miss cost a
   debugging session on staging, Sep 2026).
1. Enable Apple Pay and Google Pay under Settings → Payment methods.
2. Register the production and staging **game** domains for Apple Pay — the
   payment now happens on the game origin, not checkout.stripe.com.
3. Verify the association file is served raw on each registered domain:

   ```
   curl https://<domain>/.well-known/apple-developer-merchantid-domain-association
   ```

   Expect ~9 KB of hex as `text/plain`, not HTML. The game server already
   serves it (vendored file + explicit route, shipped with the client work).
   This is the most common silent Apple Pay failure — check it before
   debugging anything else.

4. The game repo's deploy needs the `STRIPE_PUBLISHABLE_KEY` Actions
   variable set — repo-level with the test-mode key, overridden in the
   `prod` environment with the live-mode key (game repo's concern, listed
   here for completeness — a keyless build keeps the inline flow off). Use
   the publishable key from the same Stripe mode the API mints intents in
   for that environment.

## Rollout order

1. Ship the API accepting `handoffs` behind a flag, answering `redirect` —
   a no-op; the deployed client already handles both.
2. Do the dashboard/domain setup on staging; flip the flag for staging.
3. Test per the checklist below on staging domains.
4. Flip production. Rollback at any point = answer `redirect` again; no
   client change needed in either direction.

## Test checklist

- Request **without** `handoffs` → byte-identical behaviour to today (old
  clients must be unaffected).
- With `handoffs` → `client_secret` response; pay with Stripe test cards
  through the client's card modal; wallet on a real device (Apple Pay:
  Safari, real card in Wallet, registered HTTPS domain — never localhost).
- Replay the `payment_intent.succeeded` webhook → exactly one grant.
- Declined test card, then retry → same PaymentIntent confirmed, no second
  order row.
- `subscription_tier` with `handoffs` present → still `redirect`.
- Steam rail requests → untouched.

## Out of scope

- Subscriptions inline (recurring — a different Stripe integration).
- The Steam rail (unchanged).
- Tax (already handled) — do not add tax logic.
- Refund/dispute handling changes — existing paths apply to PaymentIntents
  the same way.
