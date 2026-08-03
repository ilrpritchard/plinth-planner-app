-- SUPABASE_TRADE.sql — run this ONCE in Supabase → SQL Editor.
-- Adds cloud trade projects + read-only share links for the Trade tab.
-- (The existing `designs` and `leads` tables are untouched except for one
--  insert-only policy on `leads` so share-link viewers can record approvals.)

-- ---------- 1. the table ----------
create table public.trade_projects (
  id          uuid primary key default gen_random_uuid(),
  owner       uuid not null references auth.users (id) on delete cascade default auth.uid(),
  name        text,
  data        jsonb not null,
  share_token text unique,
  updated_at  timestamptz default now()
);

-- ---------- 2. row level security: owner-only CRUD ----------
alter table public.trade_projects enable row level security;

create policy "trade projects are private to their owner"
  on public.trade_projects for all
  using (auth.uid() = owner)
  with check (auth.uid() = owner);

create index trade_projects_owner_idx on public.trade_projects (owner, updated_at desc);

-- ---------- 3. read-only share links ----------
-- No table-wide read policy for anon. Instead, a SECURITY DEFINER function
-- returns ONE project's data for an exact share_token match — so a viewer with
-- the link can read exactly that project and nothing else.
create or replace function public.get_shared_project(tok text)
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  select data from public.trade_projects where share_token = tok limit 1;
$$;

revoke all on function public.get_shared_project(text) from public;
grant execute on function public.get_shared_project(text) to anon, authenticated;

-- ---------- 4. approvals land in the existing leads table ----------
-- Share-link viewers are anonymous, so let them INSERT an approval lead
-- (kind 'trade-approval' in the design column). Insert-only: they still
-- cannot read, change, or delete anything in leads.
create policy "anyone can record a trade approval"
  on public.leads for insert
  to anon, authenticated
  with check (true);
