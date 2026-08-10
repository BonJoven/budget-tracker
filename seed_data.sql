-- ============================================================
-- SEED DATA: your actual August 2026 numbers
-- Run AFTER schema.sql (and migration_income_items.sql if needed)
-- Safe to run once. Re-running will create duplicate periods.
-- ============================================================

-- 15TH period
insert into periods (id, period_date, period_type, salary, previous_savings, wifey, spaylater, accent)
values ('11111111-1111-1111-1111-111111111115', '2026-08-15', '15th', 20000.00, 32228.47, 6010.28, 2084.58, 4583.33);

-- 30TH period
insert into periods (id, period_date, period_type, salary, previous_savings, wifey, spaylater, accent)
values ('11111111-1111-1111-1111-111111111130', '2026-08-30', '30th', 20000.00, 3659.29, 11861.51, 0, 4583.33);

-- Extra income lines
insert into income_items (period_id, label, amount) values
('11111111-1111-1111-1111-111111111115', 'Part Time', 13000.00),
('11111111-1111-1111-1111-111111111130', 'JP', 999.33),
('11111111-1111-1111-1111-111111111130', 'Other', 17000.00);

-- EASTWEST transactions (15th)
insert into transactions (card_id, period_id, description, amount, kind) values
((select id from credit_cards where name = 'Eastwest'), '11111111-1111-1111-1111-111111111115', 'REF', 1916.67, 'bill'),
((select id from credit_cards where name = 'Eastwest'), '11111111-1111-1111-1111-111111111115', 'S&R', 1916.67, 'bill'),
((select id from credit_cards where name = 'Eastwest'), '11111111-1111-1111-1111-111111111115', 'Mcdo', 160.0, 'bill'),
((select id from credit_cards where name = 'Eastwest'), '11111111-1111-1111-1111-111111111115', 'Marugame', 275.0, 'bill'),
((select id from credit_cards where name = 'Eastwest'), '11111111-1111-1111-1111-111111111115', 'SB', 230.0, 'bill'),
((select id from credit_cards where name = 'Eastwest'), '11111111-1111-1111-1111-111111111115', 'Travel Tax', 3312.9, 'bill'),
((select id from credit_cards where name = 'Eastwest'), '11111111-1111-1111-1111-111111111115', 'Hostel', 717.13, 'bill'),
((select id from credit_cards where name = 'Eastwest'), '11111111-1111-1111-1111-111111111115', 'Boat', 2886.32, 'bill'),
((select id from credit_cards where name = 'Eastwest'), '11111111-1111-1111-1111-111111111115', 'Klook', 923.1, 'bill'),
((select id from credit_cards where name = 'Eastwest'), '11111111-1111-1111-1111-111111111115', 'Smart', 399.0, 'bill'),
((select id from credit_cards where name = 'Eastwest'), '11111111-1111-1111-1111-111111111115', 'Klook', 501.6, 'bill'),
((select id from credit_cards where name = 'Eastwest'), '11111111-1111-1111-1111-111111111115', 'SB', 520.0, 'bill'),
((select id from credit_cards where name = 'Eastwest'), '11111111-1111-1111-1111-111111111115', 'Whiskey', 112.0, 'bill'),
((select id from credit_cards where name = 'Eastwest'), '11111111-1111-1111-1111-111111111115', 'Saigon', 1684.0, 'bill'),
((select id from credit_cards where name = 'Eastwest'), '11111111-1111-1111-1111-111111111115', 'Watsons', 1424.25, 'bill'),
((select id from credit_cards where name = 'Eastwest'), '11111111-1111-1111-1111-111111111115', 'SB', 600.0, 'bill'),
((select id from credit_cards where name = 'Eastwest'), '11111111-1111-1111-1111-111111111115', 'Mcdo Hana', 254.0, 'bill'),
((select id from credit_cards where name = 'Eastwest'), '11111111-1111-1111-1111-111111111115', 'Subway', 535.0, 'bill'),
((select id from credit_cards where name = 'Eastwest'), '11111111-1111-1111-1111-111111111115', 'Illy', 460.0, 'bill'),
((select id from credit_cards where name = 'Eastwest'), '11111111-1111-1111-1111-111111111115', 'Resto Gabah', 2416.42, 'bill'),
((select id from credit_cards where name = 'Eastwest'), '11111111-1111-1111-1111-111111111115', 'Finns', 2052.47, 'bill'),
((select id from credit_cards where name = 'Eastwest'), '11111111-1111-1111-1111-111111111115', 'Crumb & Coaster', 1883.27, 'bill'),
((select id from credit_cards where name = 'Eastwest'), '11111111-1111-1111-1111-111111111115', 'BRUNCH', 1794.32, 'bill'),
((select id from credit_cards where name = 'Eastwest'), '11111111-1111-1111-1111-111111111115', 'FORK', 1661.99, 'bill'),
((select id from credit_cards where name = 'Eastwest'), '11111111-1111-1111-1111-111111111115', 'Milk Madu', 1603.64, 'bill'),
((select id from credit_cards where name = 'Eastwest'), '11111111-1111-1111-1111-111111111115', 'Massage', 5495.36, 'bill'),
((select id from credit_cards where name = 'Eastwest'), '11111111-1111-1111-1111-111111111115', 'Penida Colada', 2656.22, 'bill'),
((select id from credit_cards where name = 'Eastwest'), '11111111-1111-1111-1111-111111111115', 'Nuansa', 1995.52, 'bill'),
((select id from credit_cards where name = 'Eastwest'), '11111111-1111-1111-1111-111111111115', 'Space', 1172.09, 'bill'),
((select id from credit_cards where name = 'Eastwest'), '11111111-1111-1111-1111-111111111115', 'Nusa Levy', 174.68, 'bill'),
((select id from credit_cards where name = 'Eastwest'), '11111111-1111-1111-1111-111111111115', 'Secret Penida', 2024.44, 'bill'),
((select id from credit_cards where name = 'Eastwest'), '11111111-1111-1111-1111-111111111115', 'Little Finger', 1048.06, 'bill'),
((select id from credit_cards where name = 'Eastwest'), '11111111-1111-1111-1111-111111111115', 'Lotte', 184.59, 'bill'),
((select id from credit_cards where name = 'Eastwest'), '11111111-1111-1111-1111-111111111115', 'Croissant', 244.26, 'bill'),
((select id from credit_cards where name = 'Eastwest'), '11111111-1111-1111-1111-111111111115', 'Azure', 3265.14, 'bill'),
((select id from credit_cards where name = 'Eastwest'), '11111111-1111-1111-1111-111111111115', 'Lacoste', 6130.96, 'bill'),
((select id from credit_cards where name = 'Eastwest'), '11111111-1111-1111-1111-111111111115', 'DTF', 2924.35, 'bill'),
((select id from credit_cards where name = 'Eastwest'), '11111111-1111-1111-1111-111111111115', 'Harlan', 1175.0, 'bill'),
((select id from credit_cards where name = 'Eastwest'), '11111111-1111-1111-1111-111111111115', 'Harlan', 500.0, 'bill'),
((select id from credit_cards where name = 'Eastwest'), '11111111-1111-1111-1111-111111111115', 'Harlan', 210.0, 'bill'),
((select id from credit_cards where name = 'Eastwest'), '11111111-1111-1111-1111-111111111115', 'Shell', 871.42, 'bill'),
((select id from credit_cards where name = 'Eastwest'), '11111111-1111-1111-1111-111111111115', 'Starbucks', 340.0, 'bill'),
((select id from credit_cards where name = 'Eastwest'), '11111111-1111-1111-1111-111111111115', '[check] gap vs statement total', 259.71, 'bill');

-- UNIONBANK transactions (30th)
insert into transactions (card_id, period_id, description, amount, kind) values
((select id from credit_cards where name = 'Unionbank'), '11111111-1111-1111-1111-111111111130', 'Tanie Tablet', 1499.88, 'payment_plan'),
((select id from credit_cards where name = 'Unionbank'), '11111111-1111-1111-1111-111111111130', 'Convert Bal', 3154.67, 'payment_plan'),
((select id from credit_cards where name = 'Unionbank'), '11111111-1111-1111-1111-111111111130', 'Toll', 500.0, 'bill'),
((select id from credit_cards where name = 'Unionbank'), '11111111-1111-1111-1111-111111111130', 'Wine', 1198.21, 'bill'),
((select id from credit_cards where name = 'Unionbank'), '11111111-1111-1111-1111-111111111130', 'Toll', 500.0, 'bill'),
((select id from credit_cards where name = 'Unionbank'), '11111111-1111-1111-1111-111111111130', 'Muji', 120.0, 'bill'),
((select id from credit_cards where name = 'Unionbank'), '11111111-1111-1111-1111-111111111130', 'Chilis', 2958.44, 'bill'),
((select id from credit_cards where name = 'Unionbank'), '11111111-1111-1111-1111-111111111130', 'Mcdo', 154.0, 'bill'),
((select id from credit_cards where name = 'Unionbank'), '11111111-1111-1111-1111-111111111130', 'Gas', 500.0, 'bill'),
((select id from credit_cards where name = 'Unionbank'), '11111111-1111-1111-1111-111111111130', 'Jollibee', 872.0, 'bill');

-- RCBC transactions (30th)
insert into transactions (card_id, period_id, description, amount, kind) values
((select id from credit_cards where name = 'RCBC'), '11111111-1111-1111-1111-111111111130', 'CA', 3734.03, 'payment_plan'),
((select id from credit_cards where name = 'RCBC'), '11111111-1111-1111-1111-111111111130', 'PLDT', 1399.0, 'bill');

-- METROBANK transactions (30th)
insert into transactions (card_id, period_id, description, amount, kind) values
((select id from credit_cards where name = 'Metrobank'), '11111111-1111-1111-1111-111111111130', 'JP - Motoworld', 999.33, 'payment_plan'),
((select id from credit_cards where name = 'Metrobank'), '11111111-1111-1111-1111-111111111130', 'CA', 7066.66, 'payment_plan'),
((select id from credit_cards where name = 'Metrobank'), '11111111-1111-1111-1111-111111111130', 'CA', 3533.33, 'payment_plan'),
((select id from credit_cards where name = 'Metrobank'), '11111111-1111-1111-1111-111111111130', 'CA', 1824.67, 'payment_plan');

-- BPI transactions (30th)
insert into transactions (card_id, period_id, description, amount, kind) values
((select id from credit_cards where name = 'BPI'), '11111111-1111-1111-1111-111111111130', 'CA', 10599.21, 'payment_plan'),
((select id from credit_cards where name = 'BPI'), '11111111-1111-1111-1111-111111111130', 'Wink', 3750.0, 'payment_plan'),
((select id from credit_cards where name = 'BPI'), '11111111-1111-1111-1111-111111111130', 'CA', 5300.0, 'payment_plan'),
((select id from credit_cards where name = 'BPI'), '11111111-1111-1111-1111-111111111130', 'Grab', 453.63, 'bill'),
((select id from credit_cards where name = 'BPI'), '11111111-1111-1111-1111-111111111130', 'Grab', 43.17, 'bill'),
((select id from credit_cards where name = 'BPI'), '11111111-1111-1111-1111-111111111130', 'Finns', 379.13, 'bill'),
((select id from credit_cards where name = 'BPI'), '11111111-1111-1111-1111-111111111130', 'Grab', 251.0, 'bill'),
((select id from credit_cards where name = 'BPI'), '11111111-1111-1111-1111-111111111130', 'Grab', 266.66, 'bill'),
((select id from credit_cards where name = 'BPI'), '11111111-1111-1111-1111-111111111130', 'Grab', 706.0, 'bill'),
((select id from credit_cards where name = 'BPI'), '11111111-1111-1111-1111-111111111130', 'Grab', 88.02, 'bill'),
((select id from credit_cards where name = 'BPI'), '11111111-1111-1111-1111-111111111130', 'Grab', 251.09, 'bill'),
((select id from credit_cards where name = 'BPI'), '11111111-1111-1111-1111-111111111130', 'Grab', 437.35, 'bill'),
((select id from credit_cards where name = 'BPI'), '11111111-1111-1111-1111-111111111130', 'Grab', 41.96, 'bill');

-- Installment plans (from your Installments tab)
insert into installments (card_id, name, principal, fee, monthly_amount, start_date, num_months, payer) values
((select id from credit_cards where name = 'Eastwest'), 'REF', null, 0, 958.33, '2025-03-15', 12, 'Justine'),
((select id from credit_cards where name = 'Eastwest'), 'S&R', null, 0, 1916.67, '2025-06-15', 12, 'Justine'),
((select id from credit_cards where name = 'Unionbank'), 'Tanie Tablet', 17999.0, 750, 1499.88, '2025-12-30', 12, 'Justine/Joven'),
((select id from credit_cards where name = 'Unionbank'), 'Convert Bal', 35000.0, 0, 4801.89, '2025-06-30', 13, 'Joven'),
((select id from credit_cards where name = 'RCBC'), 'Balance', 40000.0, 350, 3734.03, '2025-12-30', 12, 'Joven'),
((select id from credit_cards where name = 'Metrobank'), 'Motoworld', 11992.0, 0, 999.33, '2025-12-30', 12, 'Justine'),
((select id from credit_cards where name = 'Metrobank'), 'CA (2,400 int)', 40000.0, 350, 3533.33, '2026-03-30', 12, 'Justine'),
((select id from credit_cards where name = 'Metrobank'), 'CA (1,199 int)', 20000.0, 350, 3533.33, '2026-04-30', 6, 'Justine'),
((select id from credit_cards where name = 'Metrobank'), 'CA (1,824 int)', 20000.0, 350, 3533.33, '2026-07-30', 12, 'Joven'),
((select id from credit_cards where name = 'BPI'), 'CA', 60000.0, 500, 3783.33, '2025-03-30', 16, 'Justine'),
((select id from credit_cards where name = 'BPI'), 'UNIQLO', 5342.0, 0, 1780.67, '2025-07-30', 3, 'Justine'),
((select id from credit_cards where name = 'BPI'), 'WINK', 22500.0, 0, 3750.0, '2025-08-30', 6, 'Justine'),
((select id from credit_cards where name = 'BPI'), 'CA (1,800 int)', 30000.0, 500, 5300.0, '2025-08-30', 6, 'Joven');
