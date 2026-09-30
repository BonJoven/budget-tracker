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
  due_day text,                -- e.g. "15th" - shown beside the "statement in" badge
  pay_period text check (pay_period is null or pay_period in ('15th','30th','both')),  -- which period this card appears under on the Transactions tab
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
  wifey numeric not null default 0,          -- unused (kept for backward compatibility)
  spaylater numeric not null default 0,      -- unused (kept for backward compatibility)
  accent numeric not null default 0,         -- unused (kept for backward compatibility)
  archived boolean not null default false,
  notes text,
  created_at timestamptz not null default now(),
  unique (period_date, period_type)
);

-- Flexible extra income lines per period (e.g. "Part Time", "JP", bonuses)
-- Salary / Previous Savings / Wifey stay as fixed fields on periods since
-- those repeat every cycle; anything else goes here.
create table income_items (
  id uuid primary key default gen_random_uuid(),
  period_id uuid not null references periods(id) on delete cascade,
  label text not null,
  amount numeric not null default 0
);

-- Every line-item charge against a credit card, tied to a period
create table transactions (
  id uuid primary key default gen_random_uuid(),
  period_id uuid not null references periods(id) on delete cascade,
  card_id uuid not null references credit_cards(id) on delete cascade,
  description text not null,
  amount numeric not null,
  kind text not null check (kind in ('bill','payment_plan')),  -- red = bill, green = payment plan
  wifey_share numeric not null default 0,  -- portion of `amount` that's hers (0 = all yours, = amount means all hers)
  installment_id uuid,   -- optional link to installments table
  created_at timestamptz not null default now()
);

-- Tag installments as belonging to Joven's or Justine's side (same 5 card brands, separate accounts)
create table installments (
  id uuid primary key default gen_random_uuid(),
  card_id uuid references credit_cards(id) on delete cascade,  -- NULL = assigned to "General Ledger" instead of a specific card
  name text not null,
  principal numeric,             -- original amount financed
  fee numeric default 0,         -- PF / processing fee (falls on the 1st payment)
  monthly_amount numeric not null,
  start_date date not null,
  num_months int not null,
  payer text,                    -- e.g. "Justine" / "Joven" / shared note
  owner text not null default 'joven',       -- 'joven' or 'justine' - whose tracker this belongs to
  wifey_monthly_share numeric not null default 0,  -- portion of EACH monthly payment that's the other spouse's
  wifey_fee_share numeric not null default 0,      -- portion of the fee (1st payment only) that's the other spouse's
  billed_to_card_id uuid references credit_cards(id),  -- unused (kept for backward compatibility)
  notes text,
  archived boolean not null default false
);

-- One row per due date for an installment, so real-world schedule changes
-- (restructures, amount changes mid-plan) can be edited individually
-- instead of forcing one fixed formula for the whole plan.
create table installment_schedule (
  id uuid primary key default gen_random_uuid(),
  installment_id uuid not null references installments(id) on delete cascade,
  due_date date not null,
  amount numeric not null,
  wifey_share numeric not null default 0,
  is_fee_row boolean not null default false,   -- the fee is added on top of this row at display time
  paid boolean,                                -- NULL = paid once the date passes; true/false = set by hand
  unique (installment_id, due_date)
);

-- Justine's simpler monthly budget: one row per calendar month
create table justine_months (
  id uuid primary key default gen_random_uuid(),
  month_date date not null unique,       -- always the 1st of the month, e.g. 2026-08-01
  paycheck_budget numeric not null default 0,
  previous_savings numeric not null default 0,  -- unused (kept for backward compatibility)
  joven_cc_total numeric not null default 0,    -- unused (kept for backward compatibility, now auto-synced from Joven's periods)
  bpi_total numeric not null default 0,
  eastwest_total numeric not null default 0,
  notes text,
  archived boolean not null default false
);

-- Her flexible list of fixed monthly bills (Papa, Cat Food, PLDT, St. Peter, Transpo, etc.)
create table justine_bills (
  id uuid primary key default gen_random_uuid(),
  month_id uuid not null references justine_months(id) on delete cascade,
  label text not null,
  amount numeric not null default 0
);

-- App password (hashed) + any future settings, kept in DB so it can be
-- changed from Supabase directly without redeploying the site.
create table app_settings (
  key text primary key,
  value text not null
);

-- General ledger for what Justine owes Joven that isn't tied to any card -
-- cash lent, cash he covered for her, etc. Positive = adds to what she owes.
create table wifey_adjustments (
  id uuid primary key default gen_random_uuid(),
  period_id uuid not null references periods(id) on delete cascade,
  description text not null,
  amount numeric not null,
  created_at timestamptz not null default now()
);

-- Default cards matching your current tracker (edit/add more anytime from the app)
insert into credit_cards (name, color, statement_day, sort_order, pay_period) values
  ('Eastwest', '#7c3aed', '27th', 1, '15th'),
  ('Unionbank', '#f59e0b', '23rd', 2, '30th'),
  ('RCBC', '#0ea5e9', '19th', 3, '30th'),
  ('Metrobank', '#1d4ed8', '21st', 4, '30th'),
  ('BPI', '#dc2626', '12th', 5, '30th');

-- ============================================================
-- Row Level Security: allow the app (using the public anon key)
-- to read/write. Access to the app itself is protected by the
-- password screen. This keeps setup simple for a 2-person app.
-- ============================================================
alter table credit_cards enable row level security;
alter table periods enable row level security;
alter table income_items enable row level security;
alter table transactions enable row level security;
alter table installments enable row level security;
alter table app_settings enable row level security;
alter table justine_months enable row level security;
alter table justine_bills enable row level security;
alter table installment_schedule enable row level security;
alter table wifey_adjustments enable row level security;

create policy "allow all - credit_cards" on credit_cards for all using (true) with check (true);
create policy "allow all - periods" on periods for all using (true) with check (true);
create policy "allow all - income_items" on income_items for all using (true) with check (true);
create policy "allow all - transactions" on transactions for all using (true) with check (true);
create policy "allow all - installments" on installments for all using (true) with check (true);
create policy "allow all - app_settings" on app_settings for all using (true) with check (true);
create policy "allow all - justine_months" on justine_months for all using (true) with check (true);
create policy "allow all - justine_bills" on justine_bills for all using (true) with check (true);
create policy "allow all - wifey_adjustments" on wifey_adjustments for all using (true) with check (true);
create policy "allow all - installment_schedule" on installment_schedule for all using (true) with check (true);

-- Vision Board: a shared, general area outside either profile for
-- planning future goals (trips, purchases, etc.)
create table vision_boards (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  emoji text not null default '🎯',
  color text not null default '#e3b158',
  target_date date,
  notes text,
  archived boolean not null default false,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);
create table vision_board_checklist (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references vision_boards(id) on delete cascade,
  label text not null,
  done boolean not null default false,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);
create table vision_board_images (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references vision_boards(id) on delete cascade,
  data_url text not null,
  caption text,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);
alter table vision_boards enable row level security;
alter table vision_board_checklist enable row level security;
alter table vision_board_images enable row level security;
create policy "allow all - vision_boards" on vision_boards for all using (true) with check (true);
create policy "allow all - vision_board_checklist" on vision_board_checklist for all using (true) with check (true);
create policy "allow all - vision_board_images" on vision_board_images for all using (true) with check (true);
