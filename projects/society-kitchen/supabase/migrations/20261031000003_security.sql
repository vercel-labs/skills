-- Row-level security and grants.
-- Clients may READ what their society is allowed to see. They may NOT write to
-- listings or bookings at all; every change goes through the functions in
-- migration 2 (which run as the table owner).

alter table societies     enable row level security;
alter table profiles      enable row level security;
alter table listings      enable row level security;
alter table bookings      enable row level security;
alter table notifications enable row level security;

create policy societies_read on societies for select
  using (id = my_society_id());

create policy profiles_read on profiles for select
  using (society_id = my_society_id());

-- Drafts are visible only to their seller.
create policy listings_read on listings for select
  using (society_id = my_society_id() and (status <> 'draft' or seller_id = app_uid()));

-- Buyers see their own bookings; sellers see bookings on their listings.
create policy bookings_read on bookings for select
  using (buyer_id = app_uid()
         or exists (select 1 from listings l where l.id = bookings.listing_id and l.seller_id = app_uid()));

create policy notifications_read on notifications for select
  using (user_id = app_uid());
create policy notifications_mark_read on notifications for update
  using (user_id = app_uid()) with check (user_id = app_uid());

revoke all on all tables    in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;

grant usage on schema public to authenticated;
grant select on societies, profiles, listings, bookings, notifications,
                listings_with_availability to authenticated;
grant update (read_at) on notifications to authenticated;

grant execute on function
  app_uid(), my_society_id(),
  join_society(text, text, text),
  create_listing_draft(jsonb),
  update_listing(uuid, jsonb),
  publish_listing(uuid),
  discard_draft(uuid),
  book_listing(uuid, integer),
  cancel_booking(uuid),
  close_listing(uuid)
to authenticated;
