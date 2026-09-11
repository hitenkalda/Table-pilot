-- TablePilot: orders, payments, tables, staff (migration 0002)
-- Extends 0001_init.sql with the ordering platform schema.

create table public.staff (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('OWNER', 'MANAGER', 'KITCHEN', 'WAITER')),
  created_at timestamptz not null default now(),
  unique (restaurant_id, user_id)
);

create table public.tables (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  table_number integer not null,
  qr_token text not null unique default encode(gen_random_bytes(8), 'hex'),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (restaurant_id, table_number)
);

-- Order state machine (PENDING -> ACCEPTED -> PREPARING -> READY -> SERVED,
-- with REJECTED/CANCELLED alternatives) and separate payment state.
create table public.orders (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  table_id uuid references public.tables (id) on delete set null,
  order_number bigint not null,
  order_type text not null check (order_type in ('DINE_IN', 'TAKEAWAY')),
  status text not null default 'PENDING' check (status in
    ('PENDING', 'ACCEPTED', 'PREPARING', 'READY', 'SERVED', 'REJECTED', 'CANCELLED')),
  payment_status text not null default 'UNPAID' check (payment_status in
    ('UNPAID', 'PAYMENT_PENDING', 'PAID', 'PAYMENT_FAILED', 'REFUNDED')),
  payment_method text not null check (payment_method in ('CASH', 'UPI', 'GATEWAY')),
  subtotal numeric(10, 2) not null check (subtotal >= 0),
  tax numeric(10, 2) not null default 0 check (tax >= 0),
  discount numeric(10, 2) not null default 0 check (discount >= 0),
  total numeric(10, 2) not null check (total >= 0),
  customer_note text,
  rejection_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (restaurant_id, order_number)
);

-- Immutable snapshots: dish name and unit price are frozen at order time.
create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  dish_id uuid not null references public.dishes (id) on delete restrict,
  dish_name_snapshot text not null,
  unit_price_snapshot numeric(10, 2) not null check (unit_price_snapshot >= 0),
  quantity integer not null check (quantity between 1 and 50),
  special_instruction text,
  subtotal numeric(10, 2) not null check (subtotal >= 0)
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  order_id uuid not null references public.orders (id) on delete cascade,
  provider text not null check (provider in ('CASH', 'UPI', 'GATEWAY')),
  provider_payment_id text,
  amount numeric(10, 2) not null check (amount >= 0),
  currency text not null default 'INR',
  status text not null check (status in
    ('UNPAID', 'PAYMENT_PENDING', 'PAID', 'PAYMENT_FAILED', 'REFUNDED')),
  paid_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.order_counters (
  restaurant_id uuid primary key references public.restaurants (id) on delete cascade,
  last_order_number bigint not null default 1000
);

create index on public.orders (restaurant_id, status, created_at);
create index on public.order_items (order_id);
create index on public.payments (restaurant_id, status);

-- Restaurant-level settings for the zero-budget UPI workflow.
alter table public.restaurants
  add column if not exists phone text,
  add column if not exists address text,
  add column if not exists currency text not null default '₹',
  add column if not exists upi_id text,
  add column if not exists upi_name text;

alter table public.dishes
  add column if not exists allergens_unknown boolean not null default true,
  add column if not exists is_special boolean not null default false;

-- RLS
alter table public.staff enable row level security;
alter table public.tables enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.payments enable row level security;
alter table public.order_counters enable row level security;

-- Public guests may read active table info necessary for ordering.
create policy "public read active tables" on public.tables
  for select using (is_active and exists (
    select 1 from public.restaurants r
    where r.id = restaurant_id and r.published
  ));

-- Guests may read their own order by number (public status tracking).
create policy "public read orders" on public.orders
  for select using (exists (
    select 1 from public.restaurants r
    where r.id = restaurant_id and r.published
  ));

create policy "public read order items" on public.order_items
  for select using (exists (
    select 1 from public.orders o
    join public.restaurants r on r.id = o.restaurant_id
    where o.id = order_id and r.published
  ));

-- Staff (any role) can read their restaurant's orders; order mutations go
-- through the place_order database function, which never trusts client prices.
create policy "staff read own restaurant orders" on public.orders
  for select using (exists (
    select 1 from public.staff s
    where s.restaurant_id = restaurant_id and s.user_id = auth.uid()
  ));

create policy "staff read own restaurant order items" on public.order_items
  for select using (exists (
    select 1 from public.orders o
    join public.staff s on s.restaurant_id = o.restaurant_id
    where o.id = order_id and s.user_id = auth.uid()
  ));

create policy "staff read own restaurant payments" on public.payments
  for select using (exists (
    select 1 from public.staff s
    where s.restaurant_id = restaurant_id and s.user_id = auth.uid()
  ));

create policy "staff read own restaurant tables" on public.tables
  for select using (exists (
    select 1 from public.staff s
    where s.restaurant_id = restaurant_id and s.user_id = auth.uid()
  ));

create policy "staff manage own restaurant tables" on public.tables
  for all using (exists (
    select 1 from public.staff s
    where s.restaurant_id = restaurant_id
      and s.user_id = auth.uid()
      and s.role in ('OWNER', 'MANAGER')
  ));

create policy "staff read counters" on public.order_counters
  for select using (exists (
    select 1 from public.staff s
    where s.restaurant_id = restaurant_id and s.user_id = auth.uid()
  ));

-- Server-side order creation: validates availability, re-prices from the
-- current published menu (never trusting browser prices), snapshots items,
-- and inserts the order atomically.
create or replace function public.place_order(
  p_restaurant_slug text,
  p_table_number integer,
  p_order_type text,
  p_payment_method text,
  p_items jsonb, -- [{"dishId": uuid, "quantity": int, "note"?: text}]
  p_customer_note text default null
) returns uuid
language plpgsql
security definer
as $$
declare
  v_restaurant public.restaurants;
  v_table public.tables;
  v_order_id uuid;
  v_order_number bigint;
  v_item jsonb;
  v_dish public.dishes;
  v_qty integer;
  v_subtotal numeric(10, 2) := 0;
begin
  select * into v_restaurant from public.restaurants
    where slug = p_restaurant_slug and published;
  if not found then
    raise exception 'Restaurant not found';
  end if;

  if p_order_type = 'DINE_IN' then
    select * into v_table from public.tables
      where restaurant_id = v_restaurant.id
        and table_number = p_table_number
        and is_active;
    if not found then
      raise exception 'Invalid table';
    end if;
  end if;

  update public.order_counters
    set last_order_number = last_order_number + 1
    where restaurant_id = v_restaurant.id
    returning last_order_number into v_order_number;
  if not found then
    insert into public.order_counters (restaurant_id, last_order_number)
      values (v_restaurant.id, 1001)
      returning last_order_number into v_order_number;
  end if;

  insert into public.orders (
    restaurant_id, table_id, order_number, order_type, payment_method,
    payment_status, subtotal, tax, discount, total, customer_note
  ) values (
    v_restaurant.id,
    v_table.id,
    v_order_number,
    p_order_type,
    p_payment_method,
    case when p_payment_method = 'UPI' then 'PAYMENT_PENDING' else 'UNPAID' end,
    0, 0, 0, 0,
    p_customer_note
  ) returning id into v_order_id;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := (v_item->>'quantity')::int;
    if v_qty < 1 or v_qty > 50 then
      raise exception 'Invalid quantity';
    end if;

    select * into v_dish from public.dishes
      where id = (v_item->>'dishId')::uuid
        and restaurant_id = v_restaurant.id
        and published
        and is_available;
    if not found then
      raise exception 'A dish in your order is unavailable';
    end if;

    insert into public.order_items (
      order_id, dish_id, dish_name_snapshot, unit_price_snapshot,
      quantity, special_instruction, subtotal
    ) values (
      v_order_id,
      v_dish.id,
      v_dish.name,
      v_dish.price,
      v_qty,
      v_item->>'note',
      v_dish.price * v_qty
    );

    v_subtotal := v_subtotal + v_dish.price * v_qty;
  end loop;

  update public.orders
    set subtotal = v_subtotal, total = v_subtotal, updated_at = now()
    where id = v_order_id;

  insert into public.payments (restaurant_id, order_id, provider, amount, status)
    values (
      v_restaurant.id, v_order_id, p_payment_method, v_subtotal,
      case when p_payment_method = 'UPI' then 'PAYMENT_PENDING' else 'UNPAID' end
    );

  return v_order_id;
end;
$$;

-- Only the service role / chat function calls place_order; guests cannot
-- execute it directly (no public execute grant is granted below).
revoke execute on function public.place_order from anon, authenticated;
