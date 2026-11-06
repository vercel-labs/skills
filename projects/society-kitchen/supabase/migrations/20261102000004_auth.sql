-- Sign-in: phone number + one-time code.
-- These tables are only ever touched by the server (as the table owner). Row
-- level security is on and no policy exists, so the app's database role (and
-- Supabase's anon/authenticated roles) can read or write nothing here.
--
-- Secrets are never stored in the clear: one-time codes are kept as an HMAC and
-- session tokens as a SHA-256 hash, so a database leak does not hand out logins.

create table accounts (
  id             uuid primary key default gen_random_uuid(),
  phone          text not null unique check (phone ~ '^\+[1-9][0-9]{7,14}$'),
  created_at     timestamptz not null default now(),
  last_login_at  timestamptz
);
-- A resident's profile uses the same id as their account (profiles.id = accounts.id).

create table otp_challenges (
  id           uuid primary key default gen_random_uuid(),
  phone        text not null,
  code_hash    text not null,
  attempts     integer not null default 0,
  expires_at   timestamptz not null,
  consumed_at  timestamptz,
  created_at   timestamptz not null default now()
);
create index otp_challenges_phone_idx on otp_challenges (phone, created_at desc);

create table sessions (
  token_hash   text primary key,
  account_id   uuid not null references accounts (id) on delete cascade,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null,
  revoked_at   timestamptz,
  user_agent   text
);
create index sessions_account_idx on sessions (account_id);

alter table accounts       enable row level security;
alter table otp_challenges enable row level security;
alter table sessions       enable row level security;
revoke all on accounts, otp_challenges, sessions from anon, authenticated;
