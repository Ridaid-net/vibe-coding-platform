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

### Auth / admin RBAC

There is no root `middleware.ts`. Admin route protection is enforced at the edge by `netlify/edge-functions/auth-admin.ts`, bound in `netlify.toml` via `[[edge_functions]]` to `path = "/api/v1/admin/*"` — it runs before any redirect or the origin function (defense in depth), in addition to in-route `requireUser`/`requireRole` checks.

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
