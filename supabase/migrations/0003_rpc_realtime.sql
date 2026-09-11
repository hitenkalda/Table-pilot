-- TablePilot migration 0003: guest-executable ordering RPC, staff order
-- transitions, payment verification, open/closed flag, and Realtime.

-- Restaurant-level open/closed switch shown on the public menu.
alter table public.restaurants
  add column if not exists is_open boolean not null default true;

-- place_order re-prices every line from the published menu server-side and
-- validates table/quantity/availability, so granting guests execute is safe:
-- nothing about the order (prices, totals, snapshots) is trusted from the
-- browser. (When the Cloudflare worker ships, this grant moves to the
-- service-role path; the database rules stay identical.)
grant execute on function public.place_order to anon, authenticated;

-- Staff order transitions (blueprint §13 state machine), enforced in the DB.
create or replace function public.update_order_status(
  p_order_id uuid,
  p_new_status text,
  p_rejection_reason text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders;
  v_allowed text[];
begin
  if p_new_status not in
    ('PENDING','ACCEPTED','PREPARING','READY','SERVED','REJECTED','CANCELLED')
  then
    raise exception 'Invalid status';
  end if;

  select o.* into v_order
    from public.orders o
    join public.staff s on s.restaurant_id = o.restaurant_id
    where o.id = p_order_id and s.user_id = auth.uid();
  if not found then
    raise exception 'Not authorized for this order';
  end if;

  v_allowed := case v_order.status
    when 'PENDING'   then array['ACCEPTED','REJECTED','CANCELLED']
    when 'ACCEPTED'  then array['PREPARING','CANCELLED']
    when 'PREPARING' then array['READY']
    when 'READY'     then array['SERVED']
    else array[]::text[]
  end;
  if not (p_new_status = any(v_allowed)) then
    raise exception 'Cannot move order from % to %', v_order.status, p_new_status;
  end if;

  update public.orders
    set status = p_new_status,
        rejection_reason = case
          when p_new_status = 'REJECTED'
            then coalesce(p_rejection_reason, 'Kitchen is currently at capacity.')
          else null
        end,
        updated_at = now()
    where id = p_order_id;
end;
$$;

-- Payment verification: only OWNER/MANAGER may mark money as received.
create or replace function public.set_order_payment_status(
  p_order_id uuid,
  p_status text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_restaurant_id uuid;
begin
  if p_status not in ('UNPAID','PAYMENT_PENDING','PAID','PAYMENT_FAILED','REFUNDED') then
    raise exception 'Invalid payment status';
  end if;

  select o.restaurant_id into v_restaurant_id
    from public.orders o
    join public.staff s on s.restaurant_id = o.restaurant_id
    where o.id = p_order_id
      and s.user_id = auth.uid()
      and s.role in ('OWNER', 'MANAGER');
  if not found then
    raise exception 'Not authorized for this order';
  end if;

  update public.orders
    set payment_status = p_status, updated_at = now()
    where id = p_order_id;

  update public.payments
    set status = p_status,
        paid_at = case when p_status = 'PAID' then now() else paid_at end
    where order_id = p_order_id;
end;
$$;

grant execute on function public.update_order_status to authenticated;
revoke execute on function public.update_order_status from anon;
grant execute on function public.set_order_payment_status to authenticated;
revoke execute on function public.set_order_payment_status from anon;

-- Realtime: menu + orders broadcast to subscribed clients (RLS governs what
-- each role may actually see).
do $$
begin
  begin
    alter publication supabase_realtime add table public.orders;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.order_items;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.dishes;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.menu_categories;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.tables;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.restaurants;
  exception when duplicate_object then null;
  end;
end $$;