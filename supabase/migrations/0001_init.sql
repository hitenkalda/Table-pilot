-- DishExplain initial schema (Phase 2)
create extension if not exists "pgcrypto";

create table public.restaurants (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  slug text not null unique,
  description text,
  logo_url text,
  default_language text not null default 'en',
  published boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.menu_categories (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  name text not null,
  sort_order integer not null default 0,
  published boolean not null default false
);

create table public.dishes (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  category_id uuid not null references public.menu_categories (id) on delete cascade,
  name text not null,
  price numeric(10, 2) not null default 0,
  short_description text not null default '',
  ingredients jsonb not null default '[]',
  taste_profile jsonb not null default '[]',
  texture_profile jsonb not null default '[]',
  spice_level integer not null default 0 check (spice_level between 0 and 5),
  dietary_tags text[] not null default '{}',
  allergens text[] not null default '{}',
  allergens_unknown boolean not null default true,
  portion_note text,
  image_url text,
  is_available boolean not null default true,
  published boolean not null default false,
  updated_at timestamptz not null default now()
);

-- Aggregate-only chat counters; no guest question or answer text is stored.
create table public.chat_events (
  id bigserial primary key,
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  dish_id uuid not null references public.dishes (id) on delete cascade,
  question_hash text, -- redacted sha256, only when debugging is enabled
  mode text not null check (mode in ('deterministic', 'ai')),
  status text not null,
  created_at timestamptz not null default now()
);

create index on public.dishes (restaurant_id);
create index on public.menu_categories (restaurant_id);
create index on public.chat_events (restaurant_id, created_at);

-- Row Level Security
alter table public.restaurants enable row level security;
alter table public.menu_categories enable row level security;
alter table public.dishes enable row level security;
alter table public.chat_events enable row level security;

-- Public read: published rows only.
create policy "public read published restaurants" on public.restaurants
  for select using (published);

create policy "public read published categories" on public.menu_categories
  for select using (published and exists (
    select 1 from public.restaurants r
    where r.id = restaurant_id and r.published
  ));

create policy "public read published dishes" on public.dishes
  for select using (published and exists (
    select 1 from public.restaurants r
    where r.id = restaurant_id and r.published
  ));

-- Owners manage their own tenants only.
create policy "owner all restaurants" on public.restaurants
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create policy "owner all categories" on public.menu_categories
  for all using (exists (
    select 1 from public.restaurants r
    where r.id = restaurant_id and r.owner_id = auth.uid()
  ));

create policy "owner all dishes" on public.dishes
  for all using (exists (
    select 1 from public.restaurants r
    where r.id = restaurant_id and r.owner_id = auth.uid()
  ));

-- Chat counters are written by the server-side function using the service
-- role key; managers read their own restaurant's aggregates.
create policy "owner read chat events" on public.chat_events
  for select using (exists (
    select 1 from public.restaurants r
    where r.id = restaurant_id and r.owner_id = auth.uid()
  ));
