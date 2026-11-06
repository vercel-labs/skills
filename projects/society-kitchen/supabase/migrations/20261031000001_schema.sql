-- Society Kitchen: core schema.
-- Times are stored as timestamptz (UTC instants). IST is a display concern; the
-- cancellation cutoff is an absolute instant (pickup_at - 1 hour), so it is the
-- same moment in every time zone.
-- Money is stored as integer paise to avoid float rounding.

create table societies (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  invite_code  text not null unique,
  timezone     text not null default 'Asia/Kolkata',
  created_at   timestamptz not null default now()
);

-- In Supabase, add: foreign key (id) references auth.users (id) on delete cascade
create table profiles (
  id            uuid primary key,
  society_id    uuid not null references societies (id),
  display_name  text not null check (length(trim(display_name)) > 0),
  flat_label    text not null check (length(trim(flat_label)) > 0),
  created_at    timestamptz not null default now()
);
create index profiles_society_idx on profiles (society_id);

create table listings (
  id               uuid primary key default gen_random_uuid(),
  society_id       uuid not null references societies (id),
  seller_id        uuid not null references profiles (id),
  title            text not null check (length(trim(title)) > 0),
  description      text,
  total_quantity   integer check (total_quantity > 0),
  -- Sum of confirmed bookings. Maintained ONLY by the functions in migration 2.
  booked_quantity  integer not null default 0 check (booked_quantity >= 0),
  quantity_unit    text not null default 'portion',
  price_paise      integer check (price_paise >= 0),
  currency         text not null default 'INR',
  pickup_at        timestamptz,
  pickup_location  text,
  status           text not null default 'draft'
                     check (status in ('draft', 'published', 'closed')),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  published_at     timestamptz,
  closed_at        timestamptz,

  -- Last line of defence against overbooking, independent of application code.
  constraint listings_capacity check (booked_quantity <= coalesce(total_quantity, 0)),

  -- Drafts may be incomplete; anything published must have every required field.
  constraint listings_published_complete check (
    status = 'draft' or (
      total_quantity is not null
      and price_paise is not null
      and pickup_at is not null
      and pickup_location is not null
      and description is not null and length(trim(description)) > 0
    )
  )
);
create index listings_browse_idx on listings (society_id, pickup_at) where status = 'published';
create index listings_seller_idx on listings (seller_id, created_at desc);

create table bookings (
  id            uuid primary key default gen_random_uuid(),
  listing_id    uuid not null references listings (id),
  buyer_id      uuid not null references profiles (id),
  quantity      integer not null check (quantity > 0),
  status        text not null default 'confirmed' check (status in ('confirmed', 'cancelled')),
  cancel_reason text check (cancel_reason in ('buyer', 'seller_closed')),
  created_at    timestamptz not null default now(),
  cancelled_at  timestamptz,
  constraint bookings_cancel_consistent check ((status = 'cancelled') = (cancelled_at is not null))
);
create index bookings_listing_idx on bookings (listing_id);
create index bookings_buyer_idx on bookings (buyer_id, created_at desc);

create table notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references profiles (id),
  type        text not null check (type in
                ('booking_received', 'listing_sold_out', 'booking_confirmed', 'listing_closed')),
  listing_id  uuid references listings (id),
  booking_id  uuid references bookings (id),
  title       text not null,
  body        text not null,
  created_at  timestamptz not null default now(),
  read_at     timestamptz
);
create index notifications_user_idx on notifications (user_id, created_at desc);

-- What the app reads. Status is derived from the clock, so listings expire and
-- go sold-out without any background job.
create view listings_with_availability with (security_invoker = true) as
select
  l.*,
  greatest(coalesce(l.total_quantity, 0) - l.booked_quantity, 0) as available_quantity,
  case
    when l.status = 'draft'  then 'draft'
    when l.status = 'closed' then 'closed'
    when l.pickup_at <= now() then 'expired'
    when l.total_quantity - l.booked_quantity <= 0 then 'sold_out'
    else 'available'
  end as display_status
from listings l;
