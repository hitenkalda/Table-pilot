# TablePilot — Restaurant AI Menu & Ordering Platform

A zero-budget, QR-based restaurant platform: guests scan a table QR, browse the
menu, understand dishes with the AI assistant, order, and track their food
live — while managers run menus, orders, the kitchen, tables, payments, and
analytics from one dashboard.

**Runs with no API keys.** The menu, ordering, kitchen workflow, and the
deterministic AI chat all work offline. An AI provider key only upgrades the
chat phrasing; it is never a dependency.

## The core loop (MVP, all working)

```text
QR (restaurant + table) → menu → dish details + AI chat → cart → checkout
→ order (server-validated prices) → manager accepts → kitchen prepares
→ ready → guest sees live status → pay at counter or via UPI
```

## Routes

Guest:
- `/r/:slug` — public menu (search, categories, add to cart, Ask AI)
- `/r/:slug/t/:table` — table QR entry (table is auto-known, never typed)
- `/r/:slug/dish/:dishId` — full dish page (details, voice, notes, quantity)
- `/r/:slug/cart` → `/r/:slug/checkout` — cart and checkout (cash / UPI)
- `/r/:slug/order/:orderNumber` — live order tracking

Manager (`/dashboard`, or `/dashboard?section=…`):
- Overview (today's revenue/orders/live counters), Orders (accept/reject),
  Kitchen board (preparing/ready/served), Menu (publish, availability,
  completeness score, dish editor), Tables, per-table QR codes, Payments
  (manual verification), Analytics (derived from real orders), Settings (UPI
  ID, open/closed).

## Safety & security rules implemented

- **Prices are never trusted from the browser** — `placeOrder` re-validates
  dish availability and re-prices from the current menu; order items are
  immutable name/price snapshots.
- **Payment is never client-confirmed** — cash stays UNPAID until the manager
  verifies; UPI orders go to PAYMENT_PENDING with a `upi://pay` deep link and
  the restaurant marks them paid. A gateway slots in behind the
  `PaymentProvider` adapter later.
- **AI never invents menu facts** — deterministic chat answers only from
  restaurant-approved dish fields; allergy questions always add the
  cross-contact warning; unknown means unknown.
- **Rate limits** — per-IP and per-restaurant caps in the chat proxy.

## Voice

Explanations and chat answers are spoken aloud (`SpeechSynthesis`), and
questions can be dictated (`SpeechRecognition` in Chromium browsers) with
auto-submit for a real voice conversation. Voice controls hide gracefully
when unsupported.

## Repository layout

```text
restaurant-ai-menu/
├── apps/web/src/
│   ├── pages/            # Menu, Cart, Checkout, OrderStatus, Dashboard
│   ├── components/       # DishSheet, DishPage, DishChat, ExplanationSections
│   ├── lib/              # menuSource, cart, orders, payments, explain,
│   │                     # deterministicChat, chatClient, voice, localStore
│   └── data/             # demo restaurant (prototype "database")
├── functions/api/chat.ts         # Cloudflare Pages Function chat proxy
├── supabase/migrations/
│   ├── 0001_init.sql             # restaurants, categories, dishes + RLS
│   └── 0002_orders.sql           # staff, tables, orders, payments, snapshots
│                                 # + place_order() server-side pricing fn
├── .github/workflows/ci.yml      # typecheck + tests + build (+ deploy)
└── .env.example
```

## Run locally

```bash
cd apps/web
npm install
npm run dev          # http://localhost:5173
npm test -- --run    # 23 unit tests
npm run typecheck
```

Demo: menu at `/r/cedar-table`, table 7 at `/r/cedar-table/t/7`,
dashboard at `/dashboard`.

**Try the full loop in two tabs:** open `/r/cedar-table/t/7` in one tab and
`/dashboard?section=kitchen` in another. Add dishes → checkout → place order
→ accept it in the dashboard Orders tab → watch the guest tracking page and
the kitchen board update live (localStorage events act as realtime).

## Deploying (zero-budget default)

1. Push to a public GitHub repo.
2. Supabase free project → apply both migrations, create an auth user, and
   grant it an `OWNER` staff row.
3. Cloudflare Pages → connect the repo (build: `npm --prefix apps/web run
   build`, output: `apps/web/dist`); `functions/api/chat.ts` deploys with it.
4. Optional: set `AI_PROVIDER_API_KEY` + `AI_PROVIDER_URL` as Cloudflare
   secrets for natural chat phrasing. Everything works without them.
5. Print per-table QR codes from the dashboard.

Never commit `.env`. Never put an AI key in the frontend.
