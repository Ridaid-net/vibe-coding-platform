# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo actually is

The `package.json` name (`vibe-coding-agent`) and `README.md` describe a generic Vercel "AI sandbox" template. That's the repo's origin, not its current product. The live application built here is **RODAID**: a bicycle registration / anti-theft civic-tech platform for Mendoza, Argentina (`rodaid.net`), used by citizens, partner workshops ("aliados"), and government entities (Ministerio de Seguridad, MPF Mendoza, several municipalities) as a multi-tenant system.

The original AI-sandbox scaffold (`ai/`, `app/api/chat`, `app/api/sandboxes`, `app/chat.tsx`, `app/file-explorer.tsx`, `app/preview.tsx`, `app/logs.tsx`, `app/state.ts`, `app/actions.ts`, and the `components/chat`, `components/ai-elements`, `components/panels`, `components/commands-logs`, `components/error-monitor`, `components/file-explorer`, `components/model-selector`, `components/tabs` UI) is still present in the tree but is **not wired into the live product** — `app/page.tsx` (the real homepage) only renders `components/rodaid/*`. Don't assume changes to the sandbox/chat scaffold affect anything a user sees; conversely, don't try to bolt new RODAID features onto it.

Deployment is **Netlify**, not Vercel, despite leftover Vercel-flavored deps (`@vercel/sandbox`) and README copy: see `netlify.toml`, `netlify/functions/*.mts` (scheduled/background jobs), and `netlify/edge-functions/auth-admin.ts`.

Code, identifiers, comments, and DB columns are predominantly in **Spanish** — match that convention in new code.

## Commands

Package manager is **pnpm** (`pnpm-lock.yaml`, `engines.node: 22.x`).

```bash
pnpm install
pnpm dev          # next dev --turbopack
pnpm build        # next build
pnpm start        # next start
pnpm lint         # next lint
pnpm type-check   # tsc --noEmit
```

There is no test framework configured (no jest/vitest, no `*.test.*` files, no CI workflow). Verify changes with `pnpm type-check` + `pnpm lint` plus manually exercising the affected flow — many integrations have a documented DEV/STUB fallback (see below) that makes this possible without real credentials.

## Architecture

### Layering convention

- `app/api/v1/**` — the versioned, current API surface. A typical route: authenticate with `requireUser`/`requireRole`, delegate to a `src/services/*.service.ts` function, and on failure return `jsonError(error)`.
- `app/api/**` (non-`v1`) — older or special-purpose endpoints (chat/gpt/faq/legal assistants, sandboxes, admin bootstrap) that predate or sit outside the `v1` convention.
- `src/services/*.service.ts` — business logic and external integrations (MercadoPago, blockchain/BFA anchoring, PDF/PKCS7/PKCS12 signing, IoT, Strava/Garmin, notifications, etc).
- `lib/*.ts` — shared helpers. Note `lib/marketplace.ts` is the de facto cross-cutting kernel despite its name: it defines `getPool()` (the Postgres pool), the `ApiError` class, `jsonError()`, and is where many unrelated routes import auth/db primitives from — check it first when tracing how a route gets its DB client or error shape.
- `lib/auth.ts` / `lib/session.ts` — JWT-based session and role model.
- `lib/tenant.ts` — multi-tenant resolution and RLS-scoped query helpers (`withTenant`, `withBypassRLS`, `auditTenant`). Tenants are resolved by slug (`rodaid`, `ministerio_seguridad`, `mpf_mendoza`, `municipio_*`) to a UUID, then every query in that scope runs inside a transaction with `SET LOCAL app.current_tenant_id` for Postgres RLS isolation. Government-facing APIs pick the tenant from the `X-Tenant-ID` header (`getTenantFromHeader`).

### Data layer

No ORM — raw SQL via `pg`, database provisioned through `@netlify/database` (Neon). Schema lives entirely in sequentially timestamped SQL files under `netlify/database/migrations/`; read recent migrations to understand current table shape rather than assuming `src/types/database.ts` is exhaustive.

### Migrations: a new enum value and its first use need separate deploys

Postgres refuses to use a value added by `ALTER TYPE ... ADD VALUE` until that addition has committed (`unsafe use of new value ... (55P04)`). Splitting the `ADD VALUE` and its first use into two separate **migration files** is not enough by itself — Netlify's migration runner does not commit between files within the same deploy, only between separate deploys. A migration that adds an enum value and a later migration that uses it must land in two different deploys, not just two different files of the same deploy/PR.

This was confirmed empirically (2026-07-08) while building the CIT Completo marketplace/escrow state machine: `20260708000003_extend_marketplace_escrow_cit_completo.sql` (`ALTER TYPE marketplace_publicacion_estado ADD VALUE 'PUBLICADO_PENDIENTE_CERTIFICACION'`, ...) and `20260708000004_backfill_marketplace_estado_cit_completo.sql` (an `UPDATE` that sets rows to that same new value) were pushed together in one PR/deploy and failed with exactly that `55P04` error. Splitting them across two separate deploys on the same branch — deploy `6a4eb7750949730008700e93` (only `...003`, state `ready`) followed by a second, later deploy `6a4eb8ca70cab3000845f0b2` (`...004` alone, state `ready`) — confirmed the fix: same two files, same SQL, no code change, just delivered as two deploys instead of one.

Practical rule: when a migration adds an enum value that a later migration will read/write/filter on, merge the `ADD VALUE` migration to `main` on its own, confirm its production deploy is `ready`, and only then merge the migration that uses the new value.

**Two separate migration files are not the mechanism — two separate deploys are.** It's easy to do the file-splitting correctly and still ship the bug by putting both files in the same commit/PR, which still lands them in one deploy together. This happened a second time (2026-07-09, PR #32, building the Fase 6 escrow states): `20260709000001_escrow_estados_reserva_cit_completo.sql` (`ALTER TYPE escrow_transaccion_estado ADD VALUE 'RESERVA_PENDIENTE'`, ...) and `20260709000002_reindex_escrow_reserva_cit_completo.sql` (an index predicate referencing that same value) were correctly split into two files, but both were committed and pushed together — the PR's deploy failed with the identical `55P04` error (`unsafe use of new value "RESERVA_PENDIENTE"`). Before merging any migration PR, check whether it contains an `ADD VALUE` alongside anything that references the new value — if so, split the PR itself in two, not just the files inside it.

### Known gap: the CIT Completo 20-point checklist isn't persisted yet

`components/rodaid/ChecklistCIT.tsx` (built on `lib/puntos-inspeccion.ts`'s `PUNTOS_INSPECCION`/`ChecklistInspeccion`/`calcularResultadoChecklist`) is a fully-built UI for the 20-point inspection checklist, but it's imported and never rendered in `components/rodaid/inspecciones.tsx` — no `<ChecklistCIT>` JSX usage exists anywhere. The approval flow that's actually wired (`aprobarInspeccion()` client helper → `POST /api/v1/inspecciones/[citId]/aprobar` / `POST /api/inspector/cit` → `aprobarInspeccionFisica()` in `inspeccion.service.ts`) only sends/persists a single verdict (`APROBADA`/`DISCREPANCIA`) plus free-text notes, signed as one acta — never point-by-point results. Treat `resultado = 'APROBADA'` as the real, working seal event (atomic, signed, accelerates the CIT pipeline, and — as of Fase 4 — seals a waiting Marketplace listing) — don't assume per-point checklist data exists anywhere in the DB until this gap is closed in its own pass.

### Fase 6 (CIT Completo): reserve/pay endpoints + a money-integrity audit that found and fixed 4 real bugs (2026-07-09)

`POST /api/v1/marketplace/[id]/reservar` and `POST /api/v1/marketplace/[id]/confirmar-pago` (delegating to `iniciarReservaCitCompleto()` / `confirmarPagoCitCompleto()` in `escrow.service.ts`) close the buyer-facing side of the CIT Completo escrow flow. Two paths:
- Bici not yet certified (`PUBLICADO_PENDIENTE_CERTIFICACION`): `/reservar` charges a **sena** (funds the Taller's 20-point verification), publicación → `RESERVADO`, escrow → `RESERVA_PENDIENTE` → (webhook) `RESERVADA`. Once `aprobarInspeccionFisica()` seals the checklist (publicación → `EJECUTANDO_LOGISTICA`), `/confirmar-pago` charges the **saldo** (precio + logística), escrow → `SALDO_PENDIENTE` → (webhook) `FONDOS_RETENIDOS`.
- Bici already certified (`PUBLICADO_CERTIFICADO`, from a prior expired reservation): `/reservar` skips the sena entirely — no second verification, the Taller already got paid once — and charges the full saldo in one payment, escrow → `SALDO_PENDIENTE` directly, publicación → `EJECUTANDO_LOGISTICA` directly. `/confirmar-pago` never applies to this path (no `RESERVADA` row ever exists for it).

`webhookPago()` now branches on a `TRANSICIONES_APROBADO` map keyed by the escrow row's **current `estado`** (never on `mp_pagos.concepto`, which is purely a bookkeeping label): `DEPOSITO_PENDIENTE→FONDOS_RETENIDOS` (generic flow, unchanged), `RESERVA_PENDIENTE→RESERVADA` (fires the `escrow.verificacion_solicitada` notification to the Taller), `SALDO_PENDIENTE→FONDOS_RETENIDOS` (both origins above land here identically).

**A dedicated money-integrity audit of this whole area (same date, prompted explicitly: "no otro bug puntual, una auditoría completa") found and fixed four real bugs before this shipped** — the kind of "automatic system action decided against stale information" class of bug, checked systematically across every expiry clock, every scheduled worker, and every notification path:
1. **`reserva_vence_en` was never cleared once a transaction reached `FONDOS_RETENIDOS`.** Any CIT Completo sale taking longer than 48h end-to-end (a normal timeline, not an edge case) would get caught by the next `procesarReservasVencidas()` sweep and **downgraded from `FONDOS_RETENIDOS` back to `CANCELADA`** — a fully-paid transaction silently un-paid, publicación reopened for a different buyer. Fixed by clearing `reserva_vence_en = NULL` in the same `UPDATE` that sets `FONDOS_RETENIDOS` in `webhookPago()`'s `SALDO_PENDIENTE` branch.
2. **No reconciliation against MercadoPago before reverting an expired reservation.** A lost or late-arriving webhook meant `procesarReservasVencidas()` would cancel a reservation that MercadoPago had already actually approved, with no trace left anywhere. Fixed: the sweep now calls a new `buscarPagosPorExternalReference()` (searches MP's `/v1/payments/search` by `external_reference`, i.e. the escrow transaction id) for any row with a still-`PENDIENTE` `mp_pagos` entry, excludes payment_ids already known locally, and — if MP reports a genuinely new approval — delegates to the normal `webhookPago()` instead of reverting. If the MP lookup itself errors, the row is **not** reverted that pass (retried next run) — erring toward not cancelling over erring toward cancelling a possibly-paid reservation.
3. **A pago-aprobado-arrives-for-an-already-terminal-row event logged nothing.** Even after fix #2, a narrow (seconds-wide) race remains where MercadoPago approves a payment in the exact window between the reconciliation check and the revert's commit. `webhookPago()` now `console.error`s explicitly (with transaccionId/paymentId/monto) whenever an `approved` payment lands on a `CANCELADA`/`RESERVA_VENCIDA` row, so this can never fail 100% silently even though it can't be fully eliminated without holding a DB lock across an HTTP call (impractical).
4. **`procesarReservasVencidas()`'s SQL only filtered on the `reserva_vence_en` timestamp, not on `estado`** — unlike `procesarAutoReleases()`, whose `SELECT` filters `WHERE estado = 'EN_CAMINO'` directly, which is exactly why that function turned out NOT to share bug #1's failure mode (confirmed by tracing `abrirDisputa()` moving `EN_CAMINO→DISPUTADA` without clearing `auto_release_en` — harmless there only because the outer query already excludes non-`EN_CAMINO` rows). Added the equivalent `AND estado IN ('RESERVA_PENDIENTE', 'RESERVADA', 'SALDO_PENDIENTE')` to `procesarReservasVencidas()`'s query as defense-in-depth, so a future code path that forgets to clear the timestamp can't repeat bug #1 either.

Confirmed live in production via `getDeploy` (`6a500438bb7c68000803b3cd`, `state: ready`, `error_message: null`, `database_migrations.files: []` — this piece needed no schema changes, every column/enum it uses already existed from earlier Fase 3/6 migrations).

**Known gap, still open, documented with an explicit TODO in both `webhookPago()` and the state-machine doc comment at the top of `escrow.service.ts`:** there is no "confirm sale/delivery" closing endpoint for CIT Completo yet. A transaction that reaches `FONDOS_RETENIDOS` via `SALDO_PENDIENTE` sits there **forever** — nobody gets paid (not the vendedor, not the Taller for logística/éxito). The generic `confirmarEnvio`/`confirmarEntrega` endpoints are not a substitute: they model postal shipping by the vendedor, not the Taller-coordinated logística CIT Completo actually needs, and they would only ever pay out the vendedor (no `registrarLiquidacionAliadoFeeLogistica`/`...FeeExito` exist yet, unlike `registrarLiquidacionAliadoFeeVerificacion`, which already fires correctly at `aprobarInspeccionFisica()` seal time). Building this closing endpoint is real, scoped-out future work — not a minor detail.

### Auth / admin RBAC

There is no root `middleware.ts`. Admin route protection is enforced at the edge by `netlify/edge-functions/auth-admin.ts`, bound in `netlify.toml` via `[[edge_functions]]` to `path = "/api/v1/admin/*"` — it runs before any redirect or the origin function (defense in depth), in addition to in-route `requireUser`/`requireRole` checks.

### Security incident: demo-session allowed unauthenticated privilege escalation to admin (2026-07-08/09)

**What was found.** `POST /api/v1/auth/demo-session` had zero authentication and read `rol` straight from the request body: `rolPedido && ROLES_DEMO.has(rolPedido) ? rolPedido : 'ciclista'`, where `ROLES_DEMO` included `admin`. Any unauthenticated caller could `POST {"rol":"admin"}` and receive a real, validly-signed AccessToken with `rol: admin` — a complete bypass of the assumption that only `contactoarribaeleste@gmail.com` and `federicodegeaceo@rodaid.net` hold admin privileges. That token satisfied `requireRole('admin')` / `requireStaff(req, 'admin')` everywhere, including every route under `/api/v1/admin/*`.

**How it was found.** While building and manually verifying the session-invalidation feature (the `sesion_invalidada_desde` watermark, see below), the verification script itself needed an admin Bearer token to call the new admin endpoint — it got one by calling `demo-session` with `{"rol":"admin"}`, which is when it became apparent this worked with no login at all.

**Confirmed exposure window:** 2026-06-30 to 2026-07-09 (~10 days), **18 illegitimate admin accounts** generated (`usuarios` rows with `email LIKE 'demo-%@rodaid.test'` and `rol = 'admin'`, counted via a read-only query against the production Neon branch).

**Two fix attempts — the first shipped broken, the second is what's live:**
1. `705e839` gated the endpoint on `process.env.CONTEXT === 'production'`. This looked right (`CONTEXT` is the value Netlify's own deploy API reports, confirmed via `getDeploy` all session as `"context": "production"`) but **does not propagate to this route's runtime**: Next.js App Router routes run through `@netlify/plugin-nextjs`, a different runtime path than raw `netlify/functions/*.mts` (which do successfully read `process.env.URL`/`RODAID_ADMIN_TOKEN`). Confirmed broken by exploiting it live in production immediately after deploy `6a4efa3a5838480008e49d81` went `ready`: `POST https://rodaid.net/api/v1/auth/demo-session {"rol":"admin"}` still returned `200`, not `403` (the role itself was correctly forced to `'ciclista'` by a separate, working part of the same fix — only the production-gate layer was silently inert).
2. `67c3232` replaced the check with `req.headers.get('host')` against the site's real domains (`rodaid.net`, `www.betarodaid.net`, `rodaid.netlify.app`, `main--rodaid.netlify.app`, confirmed via `netlify api getSite`). Verified empirically before trusting it: a request to `https://rodaid.net` with a spoofed `Host` header (TLS SNI still genuinely targeting rodaid.net) got a `404` **from Netlify's edge**, never reaching application code — proving Netlify validates `Host` for routing and a request that reaches this route necessarily carried a real, registered `Host`. Confirmed fixed live in production after deploy `6a4f01eac78e7500089bf32f`: same exploit attempt returned `403 {"error":"DEMO_DESHABILITADO"}`.

**Permanent rule:** never read a role, permission, or any other authorization-affecting field from the body of an endpoint that has no authentication check. If an endpoint is meant to be unauthenticated (demo/onboarding flows, public forms), any privilege-bearing field it might otherwise accept from the caller must be hardcoded server-side instead, with no path for the request body to influence it.

**Related cleanup (2026-07-09):** while investigating the incident above, found and deleted three more unauthenticated debug/bootstrap endpoints that had no reason to still exist in a production system:
- `netlify/functions/set-admin.mts` and `app/api/set-admin/route.ts` — two duplicate, unauthenticated endpoints (one a raw Netlify Function, one a Next.js route) that ran a hardcoded `UPDATE usuarios SET rol = 'admin' WHERE lower(email) = 'federicodegeaceo@rodaid.net'` via a raw fetch to Neon's HTTP SQL API (bypassing `getPool()`/`@netlify/database` entirely, using `DATABASE_URL`/`NETLIFY_DB_URL` directly). One-time admin-bootstrap scripts that outlived their purpose — same underlying pattern as the demo-session incident (privileged DB mutation behind an endpoint with zero auth), just not exploitable for arbitrary accounts since the target email was hardcoded.
- `app/api/debug-db/route.ts` — unauthenticated endpoint that leaked `NETLIFY_DB_URL`'s parsed hostname/protocol/pathname and whether user/password were set (not the values themselves, but still internal infra detail with no auth gate).

None of the three were the cause of two `usuarios` rows disappearing from production overnight during this same investigation — that was ruled out separately (no `DELETE` targeting `usuarios` exists anywhere in this codebase's routes, services, or migrations, and Postgres FK `ON DELETE CASCADE` only cascades parent→child, never child→parent, so no other table's row deletion could have removed a `usuarios` row). All three were deleted outright rather than gated behind `requireAdmin`, since none had any ongoing purpose once the admin accounts they bootstrapped already exist.

### Background jobs

`netlify/functions/*.mts` — scheduled/background work: BFA (Blockchain Federal Argentina) anchoring worker and cron, CIT pipeline cron, IoT anonymization worker, validation worker, public CIT verification function.

### DEV/STUB fallback pattern

Most institutional integrations (BFA blockchain anchoring, PDF certificate signing authority, acta PKCS12 signing, Web Push VAPID keys, MxM/Mendoza gov OIDC login, Ministerio de Seguridad mTLS cross-reference) are designed to run in a deterministic **simulated/DEV mode** when their env vars are absent, so the full flow is exercisable in preview without real government/blockchain credentials. Read the relevant block in `.env.example` before concluding a feature "requires production secrets to test" — it usually doesn't.

### Privacy-by-design analytics

Location-based features (security heatmap, personal "Garaje Digital" heatmap) clip coordinates to a coarse grid (`ANALITICA_GRID_DEG`, ~500m cells) before persisting, and only surface aggregates above a k-anonymity threshold — never raw points. Preserve this clipping if touching those code paths.

### Mobile

`android/` and `ios/` are Capacitor shells (`capacitor.config.ts`, appId `net.rodaid.app`). `server.url` points at `https://rodaid.net` — the native apps are thin WebView wrappers loading the live deployment, not bundlers of a local static `webDir` build.

### UI

`components/ui/*` — shadcn/ui primitives (`new-york` style, see `components.json`). `components/rodaid/*` — the actual product UI (marketing site sections, dashboards, forms).
