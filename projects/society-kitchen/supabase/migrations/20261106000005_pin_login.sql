-- Sign-in without SMS: society invite code + name + flat + a personal PIN.
-- Accounts no longer need a phone number. The PIN is stored only as a salted
-- scrypt hash. login_key identifies a resident within a society (lower-cased
-- name and flat), so the same person can sign back in on a new phone.
alter table accounts alter column phone drop not null;
alter table accounts
  add column login_key    text unique,
  add column pin_hash     text,
  add column failed_pins  integer not null default 0,
  add column locked_until timestamptz;
