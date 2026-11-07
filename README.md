# CrewPay Web

Cross-border contractor payment management platform (Blaaiz Buildathon).

Next.js (App Router) · TypeScript (strict) · Tailwind CSS v4 · shadcn/ui · npm

## Getting started

Requires Node.js 22.12 or newer.

```bash
npm install
cp .env.example .env.local   # then fill in real values locally
npm run dev                  # http://localhost:3000
```

## Scripts

| Command             | Purpose                                         |
| ------------------- | ----------------------------------------------- |
| `npm run dev`       | Development server                              |
| `npm run build`     | Production build                                |
| `npm run lint`      | ESLint                                          |
| `npm run typecheck` | Generate route types, then `tsc --noEmit`       |
| `npm test`          | Unit and database tests (local, no credentials) |
| `npm run test:integration` | Tests against a real Supabase project\*\* |
| `npm run test:e2e`  | End-to-end tests (Playwright)\*                 |
| `npm run validate`  | Lint, typecheck, unit tests and build, in order |

\* Opt-in, against a running app and a LOCAL Supabase stack: install browsers
once with `npx playwright install chromium`, start the app on port 3000, then
set `CREWPAY_RUN_E2E=1` plus the Supabase URL, publishable key and secret key.
The suite seeds an organization named "Northwind Studio (local test data)"
through the app's own database functions. `CREWPAY_SCREENSHOT_DIR` saves
screenshots.

\*\* Opt-in: set `CREWPAY_RUN_INTEGRATION=1` plus the Supabase URL, publishable
key and secret key. They create users and data, so use a local or disposable
project only. Without these they are skipped.

## Application

| Route | What it does |
| --- | --- |
| `/account` | Choose an organization, accept invitations, create an organization |
| `/orgs/[id]` | Dashboard: contractors, drafts, approvals, approved-but-unpaid obligations, activity |
| `/orgs/[id]/contractors` | Search and filter contractors; add, edit, archive; set payout details (masked) |
| `/orgs/[id]/pay-runs` | Draft pay runs, add lines, review, submit, withdraw, reopen, cancel |
| `/orgs/[id]/approvals` | Submitted runs awaiting a decision |
| `/orgs/[id]/pay-runs/[runId]` | Approve or reject the exact submitted snapshot |
| `/orgs/[id]/history` | Every pay run with submission and decision details; CSV export |
| `/orgs/[id]/team` | Members and roles; admins invite, change roles, remove |

Workflow: a preparer drafts a pay run (amounts are what each contractor should
receive, in their payout currency), submits it, and the database freezes a
snapshot. A different admin or approver approves or rejects that exact
snapshot. **Approved is not paid**: payment execution through Blaaiz is not
connected, so every run's payment status is "Not sent", and fees and FX are
shown as unavailable rather than estimated.

## Deploying a demo (Vercel + hosted Supabase)

Use a **dedicated** Supabase project containing fictional data only.

1. **Database:** `supabase link --project-ref <ref>`, then `supabase db push`
   to apply all four migrations in `supabase/migrations`. Confirm with
   `supabase migration list`. Set auth settings in the dashboard, not with
   `supabase config push`: `config.toml` holds local-only values such as a
   localhost site URL.
2. **Auth settings (dashboard):**
   - Site URL `https://<app-domain>`
   - Redirect URL `https://<app-domain>/auth/confirm`
   - Email confirmations on; minimum password length 12; secure password change on
   - "Confirm signup" template linking to
     `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email`
   - Supabase's built-in email only reaches project team members (2 per hour),
     so public sign-up needs custom SMTP. Do not disable confirmations:
     invitations rely on confirmed emails.
3. **Vercel environment variables** (all public by design):
   `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_SUPABASE_URL` and
   `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. Do **not** set `SUPABASE_SECRET_KEY`
   or any `BLAAIZ_*` variable on Vercel. No request path needs them, and
   without Blaaiz variables the app shows payouts as not connected.
4. **Demo accounts:** from your own machine, run
   `npm run demo:seed -- --hosted-demo` with `CREWPAY_SEED_SUPABASE_URL`,
   `CREWPAY_SEED_PUBLISHABLE_KEY` and `CREWPAY_SEED_SECRET_KEY` set in your
   shell only. Share the preparer, approver and viewer accounts. Keep the
   admin account private.

## Database (Supabase)

Migrations live in `supabase/migrations` and are the source of truth for the
schema, Row Level Security and authorization rules.

```bash
supabase start        # local stack (needs Docker)
supabase db reset     # apply migrations to the local database
```

Key rules, all enforced in the database:

- Every organization-owned row carries `organization_id`; RLS limits reads
  to members. Composite foreign keys keep child rows in their parent's
  organization.
- Signed-in users can only `SELECT`. Every write goes through a
  `SECURITY DEFINER` function that derives the organization from the target
  row, checks the caller's role, validates input and writes an audit record.
- Roles: `admin`, `preparer`, `approver`, `viewer`.
- Submitting a pay run freezes an immutable snapshot and its SHA-256 hash.
  Approval must quote that hash, must match the run as it is now, and must
  come from someone who did not prepare the run or enter the payout details.
- Payout details are immutable versions. Raw details are never readable by
  application users, and changing them returns affected pending or approved
  runs to draft.
- `audit_logs` is append-only, even for the database owner.
- Workflow rules are also enforced by triggers, so they hold for any writer:
  status changes must follow the workflow and be backed by the matching
  submission or decision, and submissions and approvals can only be recorded
  by the authenticated user they name. Protected tables cannot be truncated.
- `service_role` has no table privileges. Code that needs it in future must
  grant specific privileges in its own migration. New tables must revoke
  Supabase's default `TRUNCATE`, `TRIGGER`, `REFERENCES` and `MAINTAIN`
  grants explicitly.
- Boundary: the table owner (`postgres`) can still disable triggers. Only
  database administrators hold that power.

`npm test` applies the same migrations to an in-process PostgreSQL (PGlite)
with a small stand-in for Supabase's `auth` schema and roles
(`tests/db/supabase-shim.sql`).

## Authentication

Supabase Auth (email and password) through `@supabase/ssr`. Session cookies
are HttpOnly, SameSite=Lax and Secure in production. There is no browser
Supabase client, which ESLint enforces. `src/proxy.ts` refreshes sessions,
and every protected page and Server Action re-verifies the user on the server.

For email confirmation, the Supabase "Confirm signup" template must link to
`{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email`
(`supabase/templates/confirmation.html` is used locally).

## Project structure

```
src/
  app/              Routes, layouts, route handlers (App Router)
  components/
    ui/             shadcn/ui primitives (managed by `npx shadcn add`)
    layout/         App shell components
  features/         Feature modules (UI + hooks + actions per feature)
  lib/
    env/            Validated environment access (server.ts / client.ts)
    validation/     Shared zod schemas
    security/       Security helpers
  services/         Server-only integrations (Blaaiz, Supabase admin, ...)
  types/            Shared TypeScript types
tests/
  unit/             Vitest
  e2e/              Playwright
```

## Server / client boundary

- `src/services/**` and `src/lib/env/server.ts` are **server-only**. Every module
  there starts with `import "server-only"`, so importing it from a Client
  Component fails the build.
- Secrets are read only through `getServerEnv()` (`src/lib/env/server.ts`).
- Public values are read only through `getClientEnv()` (`src/lib/env/client.ts`).
- ESLint rejects direct `process.env` access anywhere in `src/` outside
  `src/lib/env/`.

## Environment variables

- `.env.example` is the only tracked env file and holds placeholders only.
- Real values go in `.env.local`, which is git-ignored (all `.env*` files are).
- `NEXT_PUBLIC_*` values are embedded in the browser bundle at build time.
  **Never** give a secret that prefix.
- To add a variable: add it to the matching schema in `src/lib/env/` and add a
  placeholder to `.env.example`.

## Security headers

Configured in `next.config.ts` for every route: Content-Security-Policy,
Strict-Transport-Security, X-Content-Type-Options, X-Frame-Options,
Referrer-Policy, Permissions-Policy and Cross-Origin-Opener-Policy. The
`X-Powered-By` header is disabled. When an external service is integrated, add
its origin to the CSP `connect-src` (and any other directive it needs).
