-- TEST-ONLY stand-in for the parts of a Supabase database that CrewPay's
-- migrations depend on. Never applied to a real project.
--
-- Mirrors Supabase behaviour that matters for security tests:
-- * the anon / authenticated / service_role roles (service_role bypasses RLS;
--   none of them is a member of another, so grants are not inherited);
-- * auth.users and auth.uid() / auth.jwt() reading `request.jwt.claims`;
-- * the HOSTED project's default privileges for objects `postgres` creates in
--   `public`, as read from pg_default_acl on project qwfjrwamkytttzsecfij
--   (Postgres 17.11) on 2026-11-07: tables ALL (arwdDxtm), sequences ALL (rwU)
--   and functions EXECUTE, each to anon, authenticated and service_role. There
--   is no global default ACL there, so PUBLIC also keeps EXECUTE on new
--   functions in every schema. Local Supabase (CLI 2.114) grants far less;
--   mirroring the more permissive hosted defaults means a missing REVOKE in a
--   migration fails these tests instead of reaching production.
--
-- Known difference: PGlite's `postgres` is a superuser; on Supabase it is
-- not, but it has BYPASSRLS and owns the tables, so RLS and triggers behave
-- the same for the cases tested here.

create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;

create schema auth;

create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  email_confirmed_at timestamptz,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create function auth.jwt() returns jsonb
language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;

create function auth.uid() returns uuid
language sql stable as $$
  select nullif(auth.jwt() ->> 'sub', '')::uuid
$$;

create function auth.role() returns text
language sql stable as $$
  select auth.jwt() ->> 'role'
$$;

grant usage on schema auth to anon, authenticated, service_role;
grant execute on all functions in schema auth to anon, authenticated, service_role;

grant usage on schema public to anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  grant all on tables to anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  grant all on sequences to anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  grant execute on functions to anon, authenticated, service_role;
grant anon, authenticated, service_role to postgres;
