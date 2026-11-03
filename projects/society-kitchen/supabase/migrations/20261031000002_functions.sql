-- Booking core. Every state change goes through these functions; clients never
-- write to listings or bookings directly (see migration 3).
--
-- Errors: each function raises P0001 with message = a stable error code and
-- DETAIL = JSON the client can use (e.g. {"available": 1}).
--
-- Concurrency: book_listing, cancel_booking, update_listing, close_listing and
-- publish_listing all take a row lock on the listing (SELECT ... FOR UPDATE), so
-- operations on one listing run one at a time and always see committed state.

create or replace function app_uid() returns uuid
language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::json ->> 'sub',
    nullif(current_setting('request.jwt.claim.sub', true), '')
  )::uuid
$$;

create or replace function app_error(p_code text, p_detail jsonb default '{}'::jsonb)
returns void language plpgsql as $$
begin
  raise exception '%', p_code using errcode = 'P0001', detail = p_detail::text;
end $$;

create or replace function plural(n integer, unit text) returns text
language sql immutable as $$
  select n || ' ' || unit || case when n = 1 then '' else 's' end
$$;

create or replace function current_profile() returns profiles
language plpgsql stable security definer set search_path = public as $$
declare p profiles;
begin
  if app_uid() is null then perform app_error('not_authenticated'); end if;
  select * into p from profiles where id = app_uid();
  if not found then perform app_error('profile_required'); end if;
  return p;
end $$;

create or replace function my_society_id() returns uuid
language sql stable security definer set search_path = public as $$
  select society_id from profiles where id = app_uid()
$$;

-- Joining a society (invite code)
create or replace function join_society(p_invite_code text, p_display_name text, p_flat_label text)
returns profiles language plpgsql security definer set search_path = public as $$
declare uid uuid := app_uid(); s societies; p profiles;
begin
  if uid is null then perform app_error('not_authenticated'); end if;
  if exists (select 1 from profiles where id = uid) then perform app_error('already_member'); end if;
  select * into s from societies where lower(invite_code) = lower(trim(p_invite_code));
  if not found then perform app_error('invalid_invite_code'); end if;
  insert into profiles (id, society_id, display_name, flat_label)
  values (uid, s.id, trim(p_display_name), trim(p_flat_label))
  returning * into p;
  return p;
end $$;

-- Drafts: may be incomplete. Only the title is required up front.
create or replace function create_listing_draft(p_fields jsonb)
returns listings language plpgsql security definer set search_path = public as $$
declare me profiles := current_profile(); l listings;
begin
  if nullif(trim(p_fields ->> 'title'), '') is null then
    perform app_error('missing_fields', jsonb_build_object('fields', jsonb_build_array('title')));
  end if;
  insert into listings (society_id, seller_id, title, description, total_quantity,
                        price_paise, pickup_at, pickup_location)
  values (me.society_id, me.id, trim(p_fields ->> 'title'),
          nullif(trim(p_fields ->> 'description'), ''),
          (p_fields ->> 'total_quantity')::integer,
          (p_fields ->> 'price_paise')::integer,
          (p_fields ->> 'pickup_at')::timestamptz,
          nullif(trim(p_fields ->> 'pickup_location'), ''))
  returning * into l;
  return l;
end $$;

-- Edit a draft or a live listing.
--  * Drafts: any field.
--  * Live, no bookings yet: any field.
--  * Live, with bookings: only description and total_quantity. Price, pickup time,
--    place and title are what buyers agreed to, so they are frozen.
--  * total_quantity can never drop below the quantity already booked.
create or replace function update_listing(p_listing_id uuid, p_changes jsonb)
returns listings language plpgsql security definer set search_path = public as $$
declare
  me profiles := current_profile();
  l listings;
  bad text[];
  new_total integer;
begin
  select * into l from listings where id = p_listing_id and seller_id = me.id for update;
  if not found then perform app_error('listing_not_found'); end if;
  if l.status = 'closed' then perform app_error('listing_closed'); end if;
  if l.status = 'published' and l.pickup_at <= now() then perform app_error('listing_expired'); end if;

  select array_agg(k) into bad from jsonb_object_keys(p_changes) k
   where k not in ('title', 'description', 'total_quantity', 'price_paise', 'pickup_at', 'pickup_location');
  if bad is not null then
    perform app_error('unknown_fields', jsonb_build_object('fields', to_jsonb(bad)));
  end if;

  if l.status = 'published' and l.booked_quantity > 0 then
    select array_agg(k) into bad from jsonb_object_keys(p_changes) k
     where k not in ('description', 'total_quantity');
    if bad is not null then
      perform app_error('locked_after_booking', jsonb_build_object('fields', to_jsonb(bad)));
    end if;
  end if;

  if p_changes ? 'total_quantity' then
    new_total := (p_changes ->> 'total_quantity')::integer;
    if new_total is null or new_total < 1 then perform app_error('invalid_quantity'); end if;
    if new_total < l.booked_quantity then
      perform app_error('quantity_below_booked',
        jsonb_build_object('booked', l.booked_quantity, 'requested', new_total));
    end if;
  end if;

  if l.status = 'published' and p_changes ? 'pickup_at'
     and (p_changes ->> 'pickup_at')::timestamptz <= now() then
    perform app_error('pickup_in_past');
  end if;

  update listings set
    title           = case when p_changes ? 'title' then trim(p_changes ->> 'title') else title end,
    description     = case when p_changes ? 'description' then nullif(trim(p_changes ->> 'description'), '') else description end,
    total_quantity  = case when p_changes ? 'total_quantity' then new_total else total_quantity end,
    price_paise     = case when p_changes ? 'price_paise' then (p_changes ->> 'price_paise')::integer else price_paise end,
    pickup_at       = case when p_changes ? 'pickup_at' then (p_changes ->> 'pickup_at')::timestamptz else pickup_at end,
    pickup_location = case when p_changes ? 'pickup_location' then nullif(trim(p_changes ->> 'pickup_location'), '') else pickup_location end,
    updated_at      = now()
  where id = l.id
  returning * into l;
  return l;
end $$;

-- Publishing never guesses: every required field must already be present.
create or replace function publish_listing(p_listing_id uuid)
returns listings language plpgsql security definer set search_path = public as $$
declare me profiles := current_profile(); l listings; missing text[];
begin
  select * into l from listings where id = p_listing_id and seller_id = me.id for update;
  if not found then perform app_error('listing_not_found'); end if;
  if l.status <> 'draft' then perform app_error('not_a_draft'); end if;

  select array_agg(f order by n) into missing from (values
    (1, 'title',           l.title is null or trim(l.title) = ''),
    (2, 'description',     l.description is null or trim(l.description) = ''),
    (3, 'total_quantity',  l.total_quantity is null),
    (4, 'price_paise',     l.price_paise is null),
    (5, 'pickup_at',       l.pickup_at is null),
    (6, 'pickup_location', l.pickup_location is null)
  ) v (n, f, is_missing) where is_missing;
  if missing is not null then
    perform app_error('missing_fields', jsonb_build_object('fields', to_jsonb(missing)));
  end if;
  if l.pickup_at <= now() then perform app_error('pickup_in_past'); end if;

  update listings set status = 'published', published_at = now(), updated_at = now()
  where id = l.id returning * into l;
  return l;
end $$;

create or replace function discard_draft(p_listing_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare me profiles := current_profile();
begin
  delete from listings where id = p_listing_id and seller_id = me.id and status = 'draft';
  if not found then perform app_error('listing_not_found'); end if;
end $$;

-- Book portions. Check + reserve happen under one row lock, so two buyers can
-- never both take the last portions. On failure everything rolls back and the
-- error detail carries the current availability.
create or replace function book_listing(p_listing_id uuid, p_quantity integer)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me profiles := current_profile();
  l listings; b bookings; avail integer; remaining integer;
begin
  if p_quantity is null or p_quantity < 1 then perform app_error('invalid_quantity'); end if;

  -- Same society only; drafts are invisible to everyone but their seller (who
  -- cannot book their own listing anyway).
  select * into l from listings
   where id = p_listing_id and society_id = me.society_id and status <> 'draft'
   for update;
  if not found then perform app_error('listing_not_found'); end if;
  if l.seller_id = me.id then perform app_error('cannot_book_own_listing'); end if;
  if l.status = 'closed' then perform app_error('listing_closed'); end if;
  if l.pickup_at <= now() then perform app_error('listing_expired'); end if;

  avail := l.total_quantity - l.booked_quantity;
  if avail < 1 then perform app_error('sold_out', jsonb_build_object('available', 0)); end if;
  if p_quantity > avail then
    perform app_error('insufficient_capacity',
      jsonb_build_object('available', avail, 'requested', p_quantity));
  end if;

  insert into bookings (listing_id, buyer_id, quantity)
  values (l.id, me.id, p_quantity) returning * into b;
  update listings set booked_quantity = booked_quantity + p_quantity, updated_at = now()
   where id = l.id;
  remaining := avail - p_quantity;

  insert into notifications (user_id, type, listing_id, booking_id, title, body) values
    (l.seller_id, 'booking_received', l.id, b.id, 'New booking',
     format('%s booked %s of %s. %s left.', me.display_name,
            plural(p_quantity, l.quantity_unit), l.title, plural(remaining, l.quantity_unit))),
    (me.id, 'booking_confirmed', l.id, b.id, 'Your booking is confirmed',
     format('%s of %s. Pickup %s.', plural(p_quantity, l.quantity_unit), l.title, l.pickup_location));
  if remaining = 0 then
    insert into notifications (user_id, type, listing_id, booking_id, title, body)
    values (l.seller_id, 'listing_sold_out', l.id, b.id, format('%s is fully booked', l.title),
            format('All %s are taken. New bookings are closed.', plural(l.total_quantity, l.quantity_unit)));
  end if;

  return jsonb_build_object('booking', to_jsonb(b), 'available_quantity', remaining,
                            'sold_out', remaining = 0);
end $$;

-- Cancel a booking. Allowed only strictly BEFORE (pickup_at - 1 hour); at the
-- cutoff instant and later it is refused. Idempotent: repeating a cancellation
-- returns already_cancelled = true and never restores quantity a second time.
create or replace function cancel_booking(p_booking_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me profiles := current_profile();
  lid uuid; l listings; b bookings; cutoff timestamptz;
begin
  select listing_id into lid from bookings where id = p_booking_id and buyer_id = me.id;
  if not found then perform app_error('booking_not_found'); end if;

  -- Lock order is always listing, then booking (matches book/close; no deadlocks).
  select * into l from listings where id = lid for update;
  select * into b from bookings where id = p_booking_id for update;

  if b.status = 'cancelled' then
    return jsonb_build_object('booking', to_jsonb(b), 'already_cancelled', true,
                              'available_quantity', l.total_quantity - l.booked_quantity);
  end if;

  cutoff := l.pickup_at - interval '1 hour';
  if now() >= cutoff then
    perform app_error('cancellation_closed', jsonb_build_object('cutoff', cutoff));
  end if;

  update bookings set status = 'cancelled', cancelled_at = now(), cancel_reason = 'buyer'
   where id = b.id returning * into b;
  update listings set booked_quantity = booked_quantity - b.quantity, updated_at = now()
   where id = l.id returning * into l;

  return jsonb_build_object('booking', to_jsonb(b), 'already_cancelled', false,
                            'available_quantity', l.total_quantity - l.booked_quantity);
end $$;

-- Seller closes a live listing. Existing bookings are cancelled and every
-- affected buyer is notified. Not allowed once pickup time has passed.
create or replace function close_listing(p_listing_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me profiles := current_profile(); l listings; n integer;
begin
  select * into l from listings where id = p_listing_id and seller_id = me.id for update;
  if not found then perform app_error('listing_not_found'); end if;
  if l.status = 'closed' then
    return jsonb_build_object('listing', to_jsonb(l), 'cancelled_bookings', 0);
  end if;
  if l.status = 'draft' then perform app_error('not_published'); end if;
  if l.pickup_at <= now() then perform app_error('listing_expired'); end if;

  with cancelled as (
    update bookings set status = 'cancelled', cancelled_at = now(), cancel_reason = 'seller_closed'
     where listing_id = l.id and status = 'confirmed'
    returning id, buyer_id, quantity
  )
  insert into notifications (user_id, type, listing_id, booking_id, title, body)
  select buyer_id, 'listing_closed', l.id, id, 'Offer cancelled by seller',
         format('%s was closed by the seller. Your booking of %s is cancelled.',
                l.title, plural(quantity, l.quantity_unit))
    from cancelled;
  get diagnostics n = row_count;

  update listings set status = 'closed', closed_at = now(), booked_quantity = 0, updated_at = now()
   where id = l.id returning * into l;
  return jsonb_build_object('listing', to_jsonb(l), 'cancelled_bookings', n);
end $$;
