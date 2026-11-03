-- Stand-ins for roles Supabase provides, so migrations run on plain Postgres.
-- Idempotent: roles are cluster-wide and survive the per-run database drop.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
end $$;
