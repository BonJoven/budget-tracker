-- ============================================================
-- Budget Tracker Database Schema
-- Run this ONCE in Supabase: Project -> SQL Editor -> New Query
-- Paste this whole file, click "Run"
-- ============================================================

-- Credit cards (Eastwest, Unionbank, RCBC, Metrobank, BPI, etc.)
create table credit_cards (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  color text not null default '#3b82f6',
  statement_day text,          -- e.g. "27th" just for reference
  sort_order int not null default 0,
  archived boolean not null default false
);

-- Each pay period: the 15th or the 30th of a given month
create table periods (
  id uuid primary key default gen_random_uuid(),
  period_date date not null,          -- actual calendar date
  period_type text not null check (period_type in ('15th','30th')),
  salary numeric not null default 0,
  previous_savings numeric not null default 0,
  wifey numeric not null default 0,
  spaylater numeric not null default 0,
  accent numeric not null default 0,  -- car amortization
  notes text,
  created_at timestamptz not null default now(),
  unique (period_date, period_type)
);

-- Every line-item charge against a credit card, tied to a period
create table transactions (
  id uuid primary key default gen_random_uuid(),
  period_id uuid not null references periods(id) on delete cascade,
  card_id uuid not null references credit_cards(id) on delete cascade,
  description text not null,
  amount numeric not null,
  kind text not null check (kind in ('bill','payment_plan')),  -- red = bill, green = payment plan
  installment_id uuid,   -- optional link to installments table
  created_at timestamptz not null default now()
);

-- Installment / payment plans (the green rows), so we can project when they end
create table installments (
  id uuid primary key default gen_random_uuid(),
  card_id uuid not null references credit_cards(id) on delete cascade,
  name text not null,
  principal numeric,             -- original amount financed
  fee numeric default 0,         -- PF / processing fee
  monthly_amount numeric not null,
  start_date date not null,
  num_months int not null,
  payer text,                    -- e.g. "Justine" / "Joven" / shared note
  notes text,
  archived boolean not null default false
);

-- App password (hashed) + any future settings, kept in DB so it can be
-- changed from Supabase directly without redeploying the site.
create table app_settings (
  key text primary key,
  value text not null
);

-- Default cards matching your current tracker (edit/add more anytime from the app)
insert into credit_cards (name, color, statement_day, sort_order) values
  ('Eastwest', '#7c3aed', '27th', 1),
  ('Unionbank', '#f59e0b', '23rd', 2),
  ('RCBC', '#0ea5e9', '19th', 3),
  ('Metrobank', '#1d4ed8', '21st', 4),
  ('BPI', '#dc2626', '12th', 5);

-- ============================================================
-- Row Level Security: allow the app (using the public anon key)
-- to read/write. Access to the app itself is protected by the
-- password screen. This keeps setup simple for a 2-person app.
-- ============================================================
alter table credit_cards enable row level security;
alter table periods enable row level security;
alter table transactions enable row level security;
alter table installments enable row level security;
alter table app_settings enable row level security;

create policy "allow all - credit_cards" on credit_cards for all using (true) with check (true);
create policy "allow all - periods" on periods for all using (true) with check (true);
create policy "allow all - transactions" on transactions for all using (true) with check (true);
create policy "allow all - installments" on installments for all using (true) with check (true);
create policy "allow all - app_settings" on app_settings for all using (true) with check (true);
