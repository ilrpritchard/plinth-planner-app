-- SUPABASE_DOCS.sql — run this ONCE in Supabase → SQL Editor
-- (after SUPABASE_ORDERS.sql). Adds the DOCS HUB: a log of every document
-- issued against a trade order.
--
-- The model: documents are never stored — they are REGENERATED
-- deterministically from the order's frozen snapshot (trade_orders.data), so
-- this table is only the ledger of WHAT was issued and WHEN. Buyer and PL/NTH
-- both read the same list. RLS is on with NO policies (like admin_users), so
-- the API can't touch the table directly — every read and write goes through
-- the two SECURITY DEFINER functions below, which allow the order's owner and
-- PL/NTH admins (admin_users) and nobody else.

-- ---------- 1. the issued-documents table ----------
create table if not exists public.order_documents (
  id        uuid primary key default gen_random_uuid(),
  order_id  uuid not null references public.trade_orders (id) on delete cascade,
  kind      text not null check (kind in
              ('submittal','workbook','csv','invoice_deposit','invoice_balance','change_order')),
  label     text,
  rev       text,
  issued_by uuid default auth.uid() references auth.users (id) on delete set null,
  issued_at timestamptz default now()
);

create index if not exists order_documents_order_idx
  on public.order_documents (order_id, issued_at desc);

-- ---------- 2. row level security: locked shut, functions only ----------
alter table public.order_documents enable row level security;
-- Deliberately NO policies: the anon/authenticated roles cannot select,
-- insert, update or delete rows through PostgREST. list_order_docs() and
-- log_order_doc() are the only doors, and both check owner-or-admin.

-- ---------- 3. who may see an order's documents? ----------
-- Shared gate for both functions: the order's owner, or a PL/NTH admin.
create or replace function public.can_touch_order_docs(oid uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.trade_orders o
     where o.id = oid
       and (o.owner = auth.uid()
            or exists (select 1 from public.admin_users a where a.id = auth.uid()))
  );
$$;

revoke all on function public.can_touch_order_docs(uuid) from public;
-- (not exposed to clients — only the two functions below call it)

-- ---------- 4. read the issued log ----------
create or replace function public.list_order_docs(order_id uuid)
returns table (id uuid, kind text, label text, rev text, issued_by uuid, issued_at timestamptz)
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  if not public.can_touch_order_docs(order_id) then
    raise exception 'Only the order owner or a PL/NTH admin can list its documents';
  end if;
  return query
    select d.id, d.kind, d.label, d.rev, d.issued_by, d.issued_at
      from public.order_documents d
     where d.order_id = list_order_docs.order_id
     order by d.issued_at desc;
end;
$$;

revoke all on function public.list_order_docs(uuid) from public;
grant execute on function public.list_order_docs(uuid) to authenticated;

-- ---------- 5. log an issuance ----------
-- Called whenever a document is (re)generated from the order snapshot. The
-- kind must match the table's check constraint (and DOC_KINDS in
-- src/core/orders.js). Returns the new row id.
create or replace function public.log_order_doc(
  order_id uuid, kind text, label text default null, rev text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id uuid;
begin
  if not public.can_touch_order_docs(order_id) then
    raise exception 'Only the order owner or a PL/NTH admin can log a document';
  end if;
  if kind not in ('submittal','workbook','csv','invoice_deposit','invoice_balance','change_order') then
    raise exception 'Unknown document kind: %', kind;
  end if;
  insert into public.order_documents (order_id, kind, label, rev, issued_by)
  values (log_order_doc.order_id, log_order_doc.kind, log_order_doc.label, log_order_doc.rev, auth.uid())
  returning id into new_id;
  return new_id;
end;
$$;

revoke all on function public.log_order_doc(uuid, text, text, text) from public;
grant execute on function public.log_order_doc(uuid, text, text, text) to authenticated;
