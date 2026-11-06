-- DEMO DATA, for development only. Times are relative to "now" so the demo is
-- always live. Bookings go through the real functions, so counts and
-- notifications are consistent.

create function pg_temp.ist(days int, hh int, mm int) returns timestamptz language sql as $$
  select (date_trunc('day', now() at time zone 'Asia/Kolkata') + make_interval(days => days, hours => hh, mins => mm))
         at time zone 'Asia/Kolkata'
$$;
create function pg_temp.as_user(u uuid) returns text language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', u)::text, false)
$$;

insert into societies (id, name, invite_code) values
  ('11111111-1111-1111-1111-111111111111', 'Harmony Residency',  'HARMONY-123'),
  ('22222222-2222-2222-2222-222222222222', 'Lakeview Heights', 'LAKE-456');

-- Sign-in accounts for the demo residents (phone +91 90000 0000N, N = 1..8)
insert into accounts (id, phone)
select ('a0000000-0000-0000-0000-00000000000' || n)::uuid, '+9190000000' || lpad(n::text, 2, '0')
  from generate_series(1, 8) n;

insert into profiles (id, society_id, display_name, flat_label) values
  ('a0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Meera Iyer',     'B-402'),
  ('a0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Harpreet Kaur',  'C-203'),
  ('a0000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Sunita Rao',     'A-1105'),
  ('a0000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'Farah Khan',     'B-1201'),
  ('a0000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'Rohan Mehta',    'C-807'),
  ('a0000000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', 'Anita Desai',    'A-304'),
  ('a0000000-0000-0000-0000-000000000007', '11111111-1111-1111-1111-111111111111', 'Kabir Shah',     'B-1102'),
  ('a0000000-0000-0000-0000-000000000008', '22222222-2222-2222-2222-222222222222', 'Vikram Nair',    'T2-901');

insert into listings (id, society_id, seller_id, title, description, total_quantity, price_paise,
                      pickup_at, pickup_location, status, published_at) values
  ('b0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'a0000000-0000-0000-0000-000000000001',
   'Creamy pasta Alfredo', 'Penne in a white sauce with sautéed mushrooms and herbs. Vegetarian. One portion is one person''s serving.',
   6, 15000, pg_temp.ist(1, 18, 0), 'Clubhouse, ground floor', 'published', now()),
  ('b0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'a0000000-0000-0000-0000-000000000002',
   'Aloo paratha with curd', 'Two stuffed parathas with fresh curd and pickle. Vegetarian.',
   4, 9000, pg_temp.ist(1, 8, 30), 'Main gate lobby', 'published', now()),
  ('b0000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'a0000000-0000-0000-0000-000000000003',
   'Rajma chawal bowl', 'Slow-cooked rajma with steamed rice and a small salad. Vegetarian.',
   5, 12000, pg_temp.ist(1, 13, 0), 'Tower A lobby', 'published', now()),
  ('b0000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'a0000000-0000-0000-0000-000000000004',
   'Gulab jamun, box of 4', 'Warm gulab jamun in a box of four. Contains milk and nuts.',
   10, 18000, pg_temp.ist(1, 17, 0), 'Clubhouse', 'published', now()),
  ('b0000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'a0000000-0000-0000-0000-000000000004',
   'Evening samosas', 'Crisp potato-pea samosas with mint chutney. Vegetarian.',
   8, 6000, now() + interval '3 hours', 'Clubhouse', 'published', now()),
  ('b0000000-0000-0000-0000-000000000006', '22222222-2222-2222-2222-222222222222', 'a0000000-0000-0000-0000-000000000008',
   'Lakeview poha', 'Kanda poha with sev.', 6, 5000, pg_temp.ist(1, 9, 0), 'Tower 2 lobby', 'published', now());

-- A half-finished draft for Meera
insert into listings (id, society_id, seller_id, title, total_quantity)
values ('b0000000-0000-0000-0000-000000000007', '11111111-1111-1111-1111-111111111111',
        'a0000000-0000-0000-0000-000000000001', 'Veg biryani', 8);

-- Bookings, made the real way
select pg_temp.as_user('a0000000-0000-0000-0000-000000000006');  -- Anita
select book_listing('b0000000-0000-0000-0000-000000000001', 2);   -- pasta: 4 of 6 left
select book_listing('b0000000-0000-0000-0000-000000000003', 2);   -- rajma
select book_listing('b0000000-0000-0000-0000-000000000005', 2);   -- samosas
select pg_temp.as_user('a0000000-0000-0000-0000-000000000005');  -- Rohan
select book_listing('b0000000-0000-0000-0000-000000000002', 2);   -- paratha
select book_listing('b0000000-0000-0000-0000-000000000003', 1);   -- rajma: 2 of 5 left
select book_listing('b0000000-0000-0000-0000-000000000005', 1);   -- samosas
select pg_temp.as_user('a0000000-0000-0000-0000-000000000007');  -- Kabir
select book_listing('b0000000-0000-0000-0000-000000000002', 2);   -- paratha: sold out
select book_listing('b0000000-0000-0000-0000-000000000004', 2);   -- gulab jamun: 8 of 10 left

-- Samosas are now inside the final hour before pickup: cancellation is closed.
update listings set pickup_at = now() + interval '45 minutes' where id = 'b0000000-0000-0000-0000-000000000005';
