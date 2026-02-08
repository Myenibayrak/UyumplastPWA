# MyPlast OMS — Sipariş Yönetim Sistemi

Production-ready Order Management System (PWA) for MyPlast.

## Tech Stack

- **Next.js 14** App Router + TypeScript (strict)
- **Supabase** (Auth, Postgres, Realtime, RLS)
- **Tailwind CSS** + shadcn/ui
- **TanStack Table** for data grids
- **React Hook Form** + Zod validation
- **PWA** installable via next-pwa

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Copy and configure environment
cp .env.example .env.local
# Fill in your Supabase credentials

# 3. Initialize database (one-URL setup)
curl "http://localhost:3000/api/setup-system?token=YOUR_SETUP_TOKEN"

# 4. Run development server
npm run dev

# 5. (Optional) Promote a user to admin
curl "http://localhost:3000/api/setup-system?token=YOUR_SETUP_TOKEN&adminEmail=admin@myplast.com"
```

## Roles

| Role | Turkish | Capabilities |
|------|---------|-------------|
| admin | Yönetici | Full access, settings, user management |
| sales | Satış | Create orders, assign tasks, view finance |
| warehouse | Depo | View/update own tasks only |
| production | Üretim | View/update own tasks only |
| shipping | Sevkiyat | View/update own tasks only |
| accounting | Muhasebe | View orders + finance data |

## Database Setup

Visit `/api/setup-system?token=YOUR_TOKEN` to initialize:
- All tables, enums, indexes
- RLS policies (role-based)
- Triggers (updated_at, order number, notifications)
- Functions (get_my_tasks, update_my_task, can_view_finance)
- Seed data (definitions, settings, permissions)

Use `&force=1` to reset and re-initialize.
Use `&adminEmail=user@example.com` to promote a user to admin.

## Security

- RLS enforced on all tables
- Workers cannot access finance fields (price, payment_term, currency) via DB functions
- All API endpoints validate auth + role server-side
- Zod validation on all mutable endpoints
- Unauthorized returns 401/403 JSON

## Project Structure

```
app/
  api/
    setup-system/route.ts   # One-URL DB init
    orders/route.ts          # Orders CRUD
    orders/[id]/route.ts     # Order detail + task assignment
    tasks/my/route.ts        # Worker task feed (finance-safe)
    tasks/[id]/progress/     # Task progress update
    notifications/route.ts   # Notifications
  (auth)/login/page.tsx      # Login
  dashboard/
    page.tsx                 # Dashboard summary
    orders/page.tsx          # Orders management
    tasks/page.tsx           # Worker task cards
    settings/page.tsx        # Admin settings
components/
  ui/                        # shadcn/ui components
  layout/dashboard-shell.tsx # Sidebar + header
  orders/                    # Order form + table
  tasks/task-view.tsx        # Mobile task cards
  notifications/             # Notification bell
  settings/settings-panel.tsx # Admin settings tabs
lib/
  supabase/                  # Client/server/admin clients
  auth/guards.ts             # Auth + role guards
  rbac.ts                    # Role-based helpers
  types.ts                   # TypeScript types
  validations.ts             # Zod schemas
tests/                       # Vitest tests
```

## Commands

```bash
npm run dev        # Development server
npm run build      # Production build
npm run lint       # ESLint
npm run typecheck  # TypeScript check
npm run test       # Vitest tests
```
