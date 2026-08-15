create extension if not exists pgcrypto;

create table if not exists markets (
  id uuid primary key default gen_random_uuid(),
  market_id text not null unique,
  name text not null,
  start_date date not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  size text,
  price numeric(12, 2) not null check (price >= 0),
  variation text,
  stock integer not null check (stock >= 0),
  sku text not null unique,
  product_segment text not null default 'Kudapan Club' check (
    product_segment in (
      'Kudapan Club',
      'Chonky Club',
      'Bocah Hompimpah Club'
    )
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists orders (
  id uuid primary key default gen_random_uuid(),
  order_number text not null unique,
  status text not null check (status in ('Pending', 'Done')),
  pickup_agreement text not null check (
    pickup_agreement in (
      'Self pick up',
      'Online delivery',
      'Expedition'
    )
  ),
  market_id uuid references markets(id),
  total_price numeric(12, 2) not null default 0 check (total_price >= 0),
  date_order_created date not null default ((now() at time zone 'Asia/Jakarta')::date),
  customer_name text,
  customer_address text,
  customer_phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into markets (market_id, name, start_date, is_active)
values ('ART-MARKET', 'Art Market', ((now() at time zone 'Asia/Jakarta')::date), true)
on conflict (market_id) do update
set name = excluded.name,
    is_active = excluded.is_active;

alter table products add column if not exists product_segment text;

update products
set product_segment = case
  when upper(sku) like 'BCH%' then 'Bocah Hompimpah Club'
  when upper(sku) like 'CC%' then 'Chonky Club'
  when upper(sku) like 'KC%' then 'Kudapan Club'
  else 'Kudapan Club'
end
where product_segment is null or trim(product_segment) = '';

alter table products
alter column product_segment set default 'Kudapan Club';

alter table products
alter column product_segment set not null;

alter table products drop constraint if exists products_product_segment_check;

alter table products
add constraint products_product_segment_check
check (
  product_segment in (
    'Kudapan Club',
    'Chonky Club',
    'Bocah Hompimpah Club'
  )
);

alter table orders add column if not exists market_id uuid references markets(id);

update orders
set market_id = (select id from markets where market_id = 'ART-MARKET')
where market_id is null;

alter table orders
alter column market_id set not null;

alter table orders
alter column date_order_created set default ((now() at time zone 'Asia/Jakarta')::date);

alter table orders drop constraint if exists orders_pickup_agreement_check;

update orders
set pickup_agreement = 'Self pick up'
where pickup_agreement = 'Self pick up at biggledot';

alter table orders
add constraint orders_pickup_agreement_check
check (
  pickup_agreement in (
    'Self pick up',
    'Online delivery',
    'Expedition'
  )
);

create table if not exists order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  product_id uuid not null references products(id),
  item_name text not null,
  sku text not null,
  size text,
  variation text,
  quantity integer not null check (quantity > 0),
  unit_price numeric(12, 2) not null check (unit_price >= 0),
  line_total numeric(12, 2) not null check (line_total >= 0),
  created_at timestamptz not null default now()
);

create index if not exists idx_orders_status on orders(status);
create index if not exists idx_orders_market_id on orders(market_id);
create index if not exists idx_orders_date_order_created on orders(date_order_created desc);
create index if not exists idx_order_items_order_id on order_items(order_id);
create index if not exists idx_order_items_product_id on order_items(product_id);
create index if not exists idx_products_sku on products(sku);
create index if not exists idx_products_product_segment on products(product_segment);

create sequence if not exists order_number_seq;

create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists products_set_updated_at on products;
create trigger products_set_updated_at
before update on products
for each row
execute function set_updated_at();

drop trigger if exists markets_set_updated_at on markets;
create trigger markets_set_updated_at
before update on markets
for each row
execute function set_updated_at();

drop trigger if exists orders_set_updated_at on orders;
create trigger orders_set_updated_at
before update on orders
for each row
execute function set_updated_at();

create or replace function product_segment_from_sku(p_sku text)
returns text as $$
begin
  if upper(p_sku) like 'BCH%' then
    return 'Bocah Hompimpah Club';
  elsif upper(p_sku) like 'CC%' then
    return 'Chonky Club';
  elsif upper(p_sku) like 'KC%' then
    return 'Kudapan Club';
  end if;

  return 'Kudapan Club';
end;
$$ language plpgsql immutable;

create or replace function set_product_segment_from_sku()
returns trigger as $$
begin
  if new.product_segment is null or trim(new.product_segment) = '' or new.product_segment = 'Kudapan Club' then
    new.product_segment = product_segment_from_sku(new.sku);
  end if;

  return new;
end;
$$ language plpgsql;

drop trigger if exists products_set_segment_from_sku on products;
create trigger products_set_segment_from_sku
before insert or update of sku, product_segment on products
for each row
execute function set_product_segment_from_sku();

create or replace function generate_order_number()
returns text as $$
begin
  return 'HP-' || to_char(now() at time zone 'Asia/Jakarta', 'YYYYMMDD') || '-' || lpad(nextval('order_number_seq')::text, 4, '0');
end;
$$ language plpgsql;

create or replace function product_segment_sku_prefix(p_product_segment text)
returns text as $$
begin
  case p_product_segment
    when 'Kudapan Club' then
      return 'KC';
    when 'Chonky Club' then
      return 'CC';
    when 'Bocah Hompimpah Club' then
      return 'BCH';
    else
      raise exception 'Invalid product segment.';
  end case;
end;
$$ language plpgsql immutable;

create or replace function generate_product_sku(p_product_segment text)
returns text as $$
declare
  v_prefix text;
  v_next_number integer;
begin
  v_prefix := product_segment_sku_prefix(p_product_segment);

  select coalesce(max((substring(sku from ('^' || v_prefix || '([0-9]+)$')))::integer), 0) + 1
  into v_next_number
  from products
  where sku ~ ('^' || v_prefix || '[0-9]+$');

  return v_prefix || lpad(v_next_number::text, 3, '0');
end;
$$ language plpgsql stable;

create or replace function create_product(
  p_name text,
  p_size text,
  p_price numeric,
  p_variation text,
  p_stock integer,
  p_product_segment text
)
returns uuid as $$
declare
  v_product_id uuid;
  v_sku text;
begin
  lock table products in share row exclusive mode;
  v_sku := generate_product_sku(p_product_segment);

  insert into products (
    name,
    size,
    price,
    variation,
    stock,
    sku,
    product_segment
  )
  values (
    p_name,
    nullif(trim(p_size), ''),
    p_price,
    nullif(trim(p_variation), ''),
    p_stock,
    v_sku,
    p_product_segment
  )
  returning id into v_product_id;

  return v_product_id;
end;
$$ language plpgsql security definer;

drop function if exists create_order(text, text, date, text, text, text, jsonb);
drop function if exists update_pending_order(uuid, text, text, date, text, text, text, jsonb);

create or replace function create_order(
  p_status text,
  p_pickup_agreement text,
  p_market_id uuid,
  p_date_order_created date,
  p_customer_name text,
  p_customer_address text,
  p_customer_phone text,
  p_items jsonb
)
returns uuid as $$
declare
  v_order_id uuid;
  v_order_number text;
  v_total numeric(12, 2) := 0;
  v_item jsonb;
  v_product products%rowtype;
  v_quantity integer;
  v_line_total numeric(12, 2);
begin
  if jsonb_array_length(p_items) = 0 then
    raise exception 'Order must contain at least one item.';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_items) item
    group by item->>'product_id'
    having count(*) > 1
  ) then
    raise exception 'Each product can only be listed once in the same order.';
  end if;

  v_order_number := generate_order_number();

  insert into orders (
    order_number,
    status,
    pickup_agreement,
    market_id,
    total_price,
    date_order_created,
    customer_name,
    customer_address,
    customer_phone
  )
  values (
    v_order_number,
    p_status,
    p_pickup_agreement,
    p_market_id,
    0,
    p_date_order_created,
    nullif(trim(p_customer_name), ''),
    nullif(trim(p_customer_address), ''),
    nullif(trim(p_customer_phone), '')
  )
  returning id into v_order_id;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_quantity := (v_item->>'quantity')::integer;

    select *
    into v_product
    from products
    where id = (v_item->>'product_id')::uuid
    for update;

    if not found then
      raise exception 'Product not found.';
    end if;

    if v_product.stock < v_quantity then
      raise exception 'Not enough stock for %.', v_product.name;
    end if;

    v_line_total := v_product.price * v_quantity;
    v_total := v_total + v_line_total;

    insert into order_items (
      order_id,
      product_id,
      item_name,
      sku,
      size,
      variation,
      quantity,
      unit_price,
      line_total
    )
    values (
      v_order_id,
      v_product.id,
      v_product.name,
      v_product.sku,
      v_product.size,
      v_product.variation,
      v_quantity,
      v_product.price,
      v_line_total
    );

    update products
    set stock = stock - v_quantity
    where id = v_product.id;
  end loop;

  update orders
  set total_price = v_total
  where id = v_order_id;

  return v_order_id;
end;
$$ language plpgsql security definer;

create or replace function update_pending_order(
  p_order_id uuid,
  p_status text,
  p_pickup_agreement text,
  p_market_id uuid,
  p_date_order_created date,
  p_customer_name text,
  p_customer_address text,
  p_customer_phone text,
  p_items jsonb
)
returns uuid as $$
declare
  v_existing orders%rowtype;
  v_old_item order_items%rowtype;
  v_item jsonb;
  v_product products%rowtype;
  v_quantity integer;
  v_line_total numeric(12, 2);
  v_total numeric(12, 2) := 0;
begin
  select *
  into v_existing
  from orders
  where id = p_order_id
  for update;

  if not found then
    raise exception 'Order not found.';
  end if;

  if v_existing.status <> 'Pending' then
    raise exception 'Only Pending orders can be edited.';
  end if;

  if jsonb_array_length(p_items) = 0 then
    raise exception 'Order must contain at least one item.';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_items) item
    group by item->>'product_id'
    having count(*) > 1
  ) then
    raise exception 'Each product can only be listed once in the same order.';
  end if;

  for v_old_item in select * from order_items where order_id = p_order_id
  loop
    update products
    set stock = stock + v_old_item.quantity
    where id = v_old_item.product_id;
  end loop;

  delete from order_items where order_id = p_order_id;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_quantity := (v_item->>'quantity')::integer;

    select *
    into v_product
    from products
    where id = (v_item->>'product_id')::uuid
    for update;

    if not found then
      raise exception 'Product not found.';
    end if;

    if v_product.stock < v_quantity then
      raise exception 'Not enough stock for %.', v_product.name;
    end if;

    v_line_total := v_product.price * v_quantity;
    v_total := v_total + v_line_total;

    insert into order_items (
      order_id,
      product_id,
      item_name,
      sku,
      size,
      variation,
      quantity,
      unit_price,
      line_total
    )
    values (
      p_order_id,
      v_product.id,
      v_product.name,
      v_product.sku,
      v_product.size,
      v_product.variation,
      v_quantity,
      v_product.price,
      v_line_total
    );

    update products
    set stock = stock - v_quantity
    where id = v_product.id;
  end loop;

  update orders
  set
    status = p_status,
    pickup_agreement = p_pickup_agreement,
    market_id = p_market_id,
    total_price = v_total,
    date_order_created = p_date_order_created,
    customer_name = nullif(trim(p_customer_name), ''),
    customer_address = nullif(trim(p_customer_address), ''),
    customer_phone = nullif(trim(p_customer_phone), '')
  where id = p_order_id;

  return p_order_id;
end;
$$ language plpgsql security definer;

create or replace function delete_pending_order(p_order_id uuid)
returns void as $$
declare
  v_existing orders%rowtype;
  v_old_item order_items%rowtype;
begin
  select *
  into v_existing
  from orders
  where id = p_order_id
  for update;

  if not found then
    raise exception 'Order not found.';
  end if;

  if v_existing.status <> 'Pending' then
    raise exception 'Only Pending orders can be deleted.';
  end if;

  for v_old_item in select * from order_items where order_id = p_order_id
  loop
    update products
    set stock = stock + v_old_item.quantity
    where id = v_old_item.product_id;
  end loop;

  delete from orders where id = p_order_id;
end;
$$ language plpgsql security definer;

alter table products enable row level security;
alter table markets enable row level security;
alter table orders enable row level security;
alter table order_items enable row level security;

drop policy if exists "Authenticated users can manage markets" on markets;
create policy "Authenticated users can manage markets"
on markets for all
to authenticated
using (true)
with check (true);

drop policy if exists "Authenticated users can read products" on products;
create policy "Authenticated users can read products"
on products for select
to authenticated
using (true);

drop policy if exists "Public can read product stock and prices" on products;
create policy "Public can read product stock and prices"
on products for select
to anon
using (true);

drop policy if exists "Authenticated users can manage products" on products;
create policy "Authenticated users can manage products"
on products for all
to authenticated
using (true)
with check (true);

drop policy if exists "Authenticated users can read orders" on orders;
create policy "Authenticated users can read orders"
on orders for select
to authenticated
using (true);

drop policy if exists "Authenticated users can read order items" on order_items;
create policy "Authenticated users can read order items"
on order_items for select
to authenticated
using (true);

grant execute on function generate_product_sku(text) to authenticated;
grant execute on function create_product(text, text, numeric, text, integer, text) to authenticated;
grant execute on function create_order(text, text, uuid, date, text, text, text, jsonb) to authenticated;
grant execute on function update_pending_order(uuid, text, text, uuid, date, text, text, text, jsonb) to authenticated;
grant execute on function delete_pending_order(uuid) to authenticated;
grant select on products to anon;
