-- ============================================================
-- MIGRATION 2: Justine's simpler monthly budget page
-- Run this once in Supabase SQL Editor -> New Query -> Run.
-- (Run this AFTER schema.sql and migration_income_items.sql)
-- ============================================================

-- One row per calendar month for her tracker
create table if not exists justine_months (
  id uuid primary key default gen_random_uuid(),
  month_date date not null unique,       -- always store as the 1st of the month, e.g. 2026-08-01
  paycheck_budget numeric not null default 0,
  previous_savings numeric not null default 0,
  joven_cc_total numeric not null default 0,
  bpi_total numeric not null default 0,
  eastwest_total numeric not null default 0
);

-- Her flexible list of fixed monthly bills (Papa, Cat Food, PLDT, St. Peter, Transpo, etc.)
create table if not exists justine_bills (
  id uuid primary key default gen_random_uuid(),
  month_id uuid not null references justine_months(id) on delete cascade,
  label text not null,
  amount numeric not null default 0
);

-- Tag installments as belonging to Joven's or Justine's side (same 5 card brands, separate accounts)
alter table installments add column if not exists owner text not null default 'joven';

alter table justine_months enable row level security;
alter table justine_bills enable row level security;

create policy "allow all - justine_months" on justine_months for all using (true) with check (true);
create policy "allow all - justine_bills" on justine_bills for all using (true) with check (true);

