# Cloud saving + accounts (Supabase) — setup

The planner works fully offline without this. To let customers create an account
and save designs to the cloud, do the following once.

## 1. Create a Supabase project
- Go to https://supabase.com → New project. Pick a name + database password.
- When it's ready, open **Project Settings → API** and copy:
  - **Project URL** (e.g. `https://abcd1234.supabase.co`)
  - the **anon / public** key

## 2. Paste the keys into the app
Open `src/core/config.js` and fill in:

```js
export const SUPABASE_URL = 'https://abcd1234.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOi...';   // the anon key
```

That's all the app needs — the cloud buttons turn on automatically.

## 3. Create the designs table + security rules
In Supabase → **SQL Editor**, run this:

```sql
create table public.designs (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  name        text,
  mode        text,
  data        jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Row Level Security: each person can only see/edit their own designs
alter table public.designs enable row level security;

create policy "designs are private to their owner"
  on public.designs for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index designs_user_idx on public.designs (user_id, updated_at desc);
```

## 4. Email accounts
- Supabase → **Authentication → Providers → Email** is on by default.
- For a smoother launch you can turn **"Confirm email"** off (Authentication →
  Providers → Email) so customers can sign in immediately; turn it on later for
  production.
- Add your live site URL under **Authentication → URL Configuration**.

## 5. Done
Reload the planner. The top bar shows **Account** — customers can sign up, sign
in, **Save to cloud**, and reopen designs from **My designs**. Each design stores
the full layout (room, cabinets, finishes, trade spec) as JSON.

> Security note: the anon key is meant to be public (it's safe in client code).
> Row Level Security above is what keeps each customer's designs private.
