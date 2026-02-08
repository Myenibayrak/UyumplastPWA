# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Development
npm run dev          # Start development server
npm run build        # Production build
npm run lint         # ESLint check
npm run typecheck    # TypeScript check (no emit)
npm run test         # Run Vitest tests

# Single test file
npx vitest run tests/orders-list-fallback-route.test.ts
```

## Environment Setup

1. Copy `.env.example` to `.env.local` and configure Supabase credentials
2. Initialize database via: `curl "http://localhost:3000/api/setup-system?token=YOUR_SETUP_TOKEN"`
3. Add `&force=1` to reset database, `&adminEmail=user@example.com` to promote user to admin

## Architecture Overview

### Tech Stack
- **Next.js 14** App Router with TypeScript (strict mode)
- **Supabase** for Auth, Postgres, Realtime, and RLS
- **Tailwind CSS** + shadcn/ui for components
- **TanStack Table** for data grids
- **React Hook Form** + Zod for validation
- **PWA** via `@ducanh2912/next-pwa`

### Project Structure

```
app/
  api/                      # API routes (App Router)
    setup-system/           # One-URL database initialization
    orders/                 # Orders CRUD endpoints
    tasks/                  # Worker task feed (finance-safe)
    notifications/          # Notification management
    stock/                  # Stock management
    cutting-plans/          # Cutting plan management
    cutting-entries/        # Cutting entry logging
  (auth)/                   # Auth route group
    login/page.tsx          # Login page
  dashboard/                # Protected dashboard pages
    orders/                 # Order management
    tasks/                  # Worker task cards
    production/             # Production planning
    stock/                  # Stock management
    settings/               # Admin settings

lib/
  supabase/                # Supabase clients
    client.ts               # Browser client
    server.ts               # Next.js server client
    admin.ts                # Service role admin client
  auth/guards.ts            # Auth middleware (`requireAuth`, `requireRole`)
  rbac.ts                   # Role-based access helpers
  types.ts                  # TypeScript types and enums
  validations.ts            # Zod schemas

components/
  ui/                       # shadcn/ui primitives
  layout/                   # Dashboard shell (sidebar/header)
  orders/                   # Order form + table components
  tasks/                    # Task card components
  notifications/            # Notification bell + dropdown
  settings/                 # Settings panel components
```

## Key Architecture Patterns

### Auth & Role Guards

API routes use the `requireAuth` and `requireRole` guards:

```typescript
import { requireAuth, requireRole, isAuthError } from "@/lib/auth/guards";

export async function GET() {
  const auth = await requireAuth();  // Returns AuthResult or NextResponse
  if (isAuthError(auth)) return auth;

  const roleCheck = requireRole(auth, ["admin", "sales"]);
  if (roleCheck) return roleCheck;

  // auth.userId and auth.role available
}
```

### Supabase Client Selection

- **Browser**: `createClient()` from `@/lib/supabase/client`
- **Server (RLS)**: `createServerSupabase()` from `@/lib/supabase/server` - respects RLS
- **Admin (bypass RLS)**: `createAdminClient()` from `@/lib/supabase/admin`

Many API routes use a fallback pattern: try admin client first, fall back to server client if env missing.

### FK Disambiguation Pattern

When `order_tasks` has multiple foreign keys to `profiles`, specify the constraint:

```typescript
.select("*, assignee:profiles!order_tasks_assigned_to_fkey(full_name)")
```

### Finance Field Filtering

Worker roles (`warehouse`, `production`, `shipping`) cannot see finance fields:

```typescript
import { canViewFinance, stripFinanceFields } from "@/lib/rbac";

const orders = data.map(o =>
  canViewFinance(auth.role) ? o : stripFinanceFields(o)
);
```

### Database Functions (PostgreSQL)

Key functions are defined in `setup-system/route.ts`:
- `get_my_role()` - Get current user's role
- `has_any_role(roles[])` - Check if user has any of the roles
- `can_view_finance()` - Check finance access
- `get_my_tasks()` - Worker-safe task feed (excludes finance fields)
- `update_my_task(...)` - Update task with ownership checks
- `notify_task_event()` - Trigger for task notifications

### One-Time Database Setup

The entire database schema (enums, tables, RLS policies, triggers, functions, seed data) is defined in `app/api/setup-system/route.ts`. This is idempotent and can be run multiple times safely.

## Role-Based Access Control

| Role | Turkish | Capabilities |
|------|---------|-------------|
| admin | Yönetici | Full access, settings, user management |
| sales | Satış | Create orders, assign tasks, view finance |
| warehouse | Depo | View/update own tasks only |
| production | Üretim | View/update own tasks only |
| shipping | Sevkiyat | View/update own tasks only |
| accounting | Muhasebe | View orders + finance, close orders |

Helper functions in `lib/rbac.ts`:
- `isWorkerRole(role)` - true for warehouse/production/shipping
- `canViewFinance(role)` - true for admin/sales/accounting
- `canManageOrders(role)` - true for admin/sales
- `canAssignTasks(role)` - true for admin/sales
- `stripFinanceFields(obj)` - removes price/payment_term/currency

## Order Status Flow

```
draft → confirmed → in_production → ready → shipped → delivered → closed
                    ↓
                 cancelled
```

The `source_type` field determines order source:
- `"stock"` - From existing stock
- `"production"` - Requires manufacturing
- `"both"` - Combination (stock + production)

## Testing

Tests are located in `tests/` and use Vitest with `environment: "node"`.

Tests typically mock Supabase clients and test API route handlers directly.

## Important Notes

- **PostgREST cache reload**: After schema changes, run `NOTIFY pgrst, 'reload schema';` in SQL editor
- **Auth NULL string bug**: GoTrue requires NULL string fields in `auth.users` to be empty strings, not NULL
- **Order numbers**: Auto-generated via trigger: `{PREFIX}-{YEAR}-{SEQUENCE}`
- **Notifications**: Trigger-based via `notify_task_event()` function
- **PWA**: Manifest in `app/manifest.ts`, PWA config in `next.config.mjs`

## Language & Localization

The application is primarily in Turkish. Labels for UI elements are defined in `lib/types.ts`:
- `ROLE_LABELS` - Role display names
- `ORDER_STATUS_LABELS` - Order status display names
- `TASK_STATUS_LABELS` - Task status display names
- `PRIORITY_LABELS` - Priority level display names
