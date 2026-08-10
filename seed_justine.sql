-- ============================================================
-- SEED: Justine's August data + her installment plans
-- Run AFTER migration_income_items.sql (which now includes the
-- justine_months / justine_bills tables and installments.owner column)
-- ============================================================

-- Tag your existing (Joven's) installments explicitly, just in case
update installments set owner = 'joven' where owner is null;

-- August month row for Justine
insert into justine_months (id, month_date, paycheck_budget, previous_savings, joven_cc_total, bpi_total, eastwest_total)
values ('22222222-2222-2222-2222-222222222208', '2026-08-01', 52000.00, -26494.84, 19184.17, 19959.59, 11937.41);

-- Her fixed monthly bills for August
insert into justine_bills (month_id, label, amount) values
('22222222-2222-2222-2222-222222222208', 'Papa', 0),
('22222222-2222-2222-2222-222222222208', 'Cat Food', 1500.0),
('22222222-2222-2222-2222-222222222208', 'PLDT', 1400.0),
('22222222-2222-2222-2222-222222222208', 'St. Peter', 910.0),
('22222222-2222-2222-2222-222222222208', 'Transpo', 2000.0);

-- Her installment plans (owner = 'justine')
insert into installments (card_id, name, principal, fee, monthly_amount, start_date, num_months, payer, owner) values
((select id from credit_cards where name = 'Eastwest'), 'REF', 18725.0, 0, 958.33, '2025-07-15', 24, 'Justine', 'justine'),
((select id from credit_cards where name = 'Eastwest'), 'S&R', 37361.08, 0, 1237.15, '2026-01-15', 18, 'Justine', 'justine'),
((select id from credit_cards where name = 'Eastwest'), 'S&R (2nd)', 12460.19, 0, 2176.38, '2026-06-15', 6, 'Justine', 'justine'),
((select id from credit_cards where name = 'Unionbank'), 'Shori UB', 13262.6, 0, 1094.8, '2025-07-30', 18, 'Justine', 'justine'),
((select id from credit_cards where name = 'Unionbank'), 'Tanie Tablet', 17998.64, 0, 1499.88, '2025-12-30', 18, 'Babe/Tanie', 'justine'),
((select id from credit_cards where name = 'RCBC'), 'Mustafa', 1848.56, 0, 360.86, '2025-12-30', 6, 'Justine', 'justine'),
((select id from credit_cards where name = 'Metrobank'), 'CA 1', 21199.98, 0, 3533.33, '2026-03-30', 6, 'Justine', 'justine'),
((select id from credit_cards where name = 'Metrobank'), 'CA 2', 21199.98, 0, 3533.33, '2026-04-30', 6, 'Justine', 'justine'),
((select id from credit_cards where name = 'BPI'), 'CA', 21450.0, 0, 3783.33, '2026-03-30', 6, 'Justine', 'justine'),
((select id from credit_cards where name = 'BPI'), 'CA (10,000)', 10000.0, 0, 1745.67, '2026-05-01', 6, 'Justine', 'justine'),
((select id from credit_cards where name = 'BPI'), 'CA (40,000)', 40000.0, 500, 1824.67, '2026-07-30', 24, 'Justine/Joven', 'justine');
