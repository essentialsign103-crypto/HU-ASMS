# HU-ASMS: System Architecture Documentation

## 1. Monorepo Organization

```
hu-academic-system/
├── apps/
│   ├── bot/                # grammY Telegram Bot Application
│   │   ├── src/
│   │   │   ├── commands/   # /start, /profile, /correction, /help
│   │   │   ├── handlers/   # representative.handler.ts, student handlers
│   │   │   ├── services/   # representative.service.ts, notification.service.ts, registration.service.ts
│   │   │   ├── keyboards/  # main-menu.ts
│   │   │   └── bot.ts      # Bot assembly & middleware
│   │   └── test/           # Unit & scope authorization test suites
│   └── web/                # Next.js 14+ Administrative Management Dashboard
│
├── packages/
│   ├── database/           # Supabase client factories, university structure service, migrations
│   ├── types/              # Shared TypeScript domain interfaces
│   ├── validation/         # Zod schemas, HU ID validators, file rule validators
│   └── shared/             # Constants, Telegram UI message templates, formatters
│
├── supabase/
│   ├── migrations/         # PostgreSQL schema, RLS policies, private storage
│   └── seed.sql            # Master fixtures (colleges, departments, years, sections, courses)
└── docs/                   # Architectural & subsystem documentation
```

## 2. Authentication & Authorization Model

1. **Dashboard Users (System Owner & Representatives)**:
   - Authenticated via Supabase Auth (`auth.users`).
   - Profile records stored in `profiles` (`system_owner` vs `representative`).
   - Granular Row Level Security (RLS) policies enforce data isolation directly within PostgreSQL.

2. **Telegram Bot Users (Students & Representatives)**:
   - Identified by their unique 64-bit numeric Telegram account ID (`telegram_user_id`).
   - Students register and lock their official Haramaya University Student ID (`hu_student_id`).
   - Representatives are recognized via `representative_assignments` matching their `telegram_user_id`.

## 3. Vercel Monorepo Deployment Configuration

When deploying the Next.js administrative and representative portal (`@hu-asms/web`) on Vercel from this monorepo:

- **Vercel Project Root Directory**: Set to `apps/web`.
- **Include files outside the root directory in the Build Step**: **Enabled** (required so `apps/web/vercel.json` can install dependencies and build internal `@hu-asms/*` workspace packages from `../..`).
- **Framework Preset**: `Next.js` (matches `framework: "nextjs"` in `apps/web/vercel.json`, writing build artifacts directly to `apps/web/.next`).
- **Monorepo Install & Build Commands** (`apps/web/vercel.json`, UTF-8 without BOM):
  - `installCommand`: `cd ../.. && npm install`
  - `buildCommand`: `cd ../.. && npm run build`
- **File Tracing Root** (`apps/web/next.config.mjs`): `outputFileTracingRoot` resolves two levels up to the monorepo root so shared `@hu-asms/*` packages are bundled reliably during Vercel serverless packaging.
