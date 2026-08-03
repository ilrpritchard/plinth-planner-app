-- SUPABASE_ORDERS.sql — run this ONCE in Supabase → SQL Editor
-- (after SUPABASE_TRADE.sql). Adds REAL trade orders + status tracking.
--
-- The model: buyers place orders (insert) and can read their own; nobody can
-- edit an order once placed. Status is PL/NTH's side of the ledger — it moves
-- only through set_order_status(), which is restricted to admin_users. The
-- one thing an owner can still do is cancel_order() while the order is still
-- 'submitted'.

-- ---------- 1. the orders table ----------
create table if not exists public.trade_orders (
  id           uuid primary key default gen_random_uuid(),
  owner        uuid not null default auth.uid() references auth.users (id) on delete cascade,
  order_no     text unique not null,
  project      text,
  data         jsonb not null,                       -- the full order snapshot
  status       text not null default 'submitted',
  phase_status jsonb not null default '{}'::jsonb,   -- { "P1": "shipped", ... }
  placed_at    timestamptz default now(),
  updated_at   timestamptz default now()
);

create index if not exists trade_orders_owner_idx
  on public.trade_orders (owner, placed_at desc);

-- ---------- 2. row level security: owner reads + inserts, NEVER updates ----------
alter table public.trade_orders enable row level security;

drop policy if exists "orders: owner can read their own" on public.trade_orders;
create policy "orders: owner can read their own"
  on public.trade_orders for select
  using (auth.uid() = owner);

drop policy if exists "orders: owner can place an order" on public.trade_orders;
create policy "orders: owner can place an order"
  on public.trade_orders for insert
  with check (auth.uid() = owner);

-- Deliberately NO update or delete policy: once placed, an order is immutable
-- from the buyer's side. Status changes go through the functions below.

-- keep the status column honest whatever path a write takes
alter table public.trade_orders
  drop constraint if exists trade_orders_status_check;
alter table public.trade_orders
  add constraint trade_orders_status_check check (status in
    ('submitted','confirmed','in_production','shipped','delivered','cancelled'));

-- ---------- 3. admins ----------
-- Simplest robust gate: a table of admin user ids. RLS is on with no
-- policies, so the API can't read or write it — only the SECURITY DEFINER
-- functions below (and you, in the dashboard) can see it.
create table if not exists public.admin_users (
  id uuid primary key references auth.users (id) on delete cascade
);
alter table public.admin_users enable row level security;

-- >>> IMOGEN: add yourself as the admin. Find your user id under
-- >>> Authentication → Users in the Supabase dashboard, then run:
-- insert into public.admin_users (id) values ('PASTE-YOUR-AUTH-USER-ID-HERE')
--   on conflict (id) do nothing;

-- Lets the app decide whether to show the admin status controls.
create or replace function public.is_order_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (select 1 from public.admin_users where id = auth.uid());
$$;

revoke all on function public.is_order_admin() from public;
grant execute on function public.is_order_admin() to authenticated;

-- ---------- 4. PL/NTH moves orders through the pipeline ----------
-- Admin-only: set the order status and/or the per-phase status map.
-- Pass null to leave either untouched.
create or replace function public.set_order_status(
  order_id uuid, new_status text, phase jsonb default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.admin_users where id = auth.uid()) then
    raise exception 'Only a PL/NTH admin can update order status';
  end if;
  if new_status is not null and new_status not in
     ('submitted','confirmed','in_production','shipped','delivered','cancelled') then
    raise exception 'Unknown status: %', new_status;
  end if;
  update public.trade_orders
     set status       = coalesce(new_status, status),
         phase_status = coalesce(phase, phase_status),
         updated_at   = now()
   where id = order_id;
  if not found then
    raise exception 'Order not found';
  end if;
end;
$$;

revoke all on function public.set_order_status(uuid, text, jsonb) from public;
grant execute on function public.set_order_status(uuid, text, jsonb) to authenticated;

-- ---------- 5. the owner's one out: cancel while still 'submitted' ----------
create or replace function public.cancel_order(order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.trade_orders
     set status = 'cancelled', updated_at = now()
   where id = order_id
     and owner = auth.uid()
     and status = 'submitted';
  if not found then
    raise exception 'Only your own, still-submitted orders can be cancelled';
  end if;
end;
$$;

revoke all on function public.cancel_order(uuid) from public;
grant execute on function public.cancel_order(uuid) to authenticated;
