create extension if not exists pgcrypto;

create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  size text,
  price numeric(12, 2) not null check (price >= 0),
  variation text,
  stock integer not null check (stock >= 0),
  sku text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists orders (
  id uuid primary key default gen_random_uuid(),
  order_number text not null unique,
  status text not null check (status in ('Pending', 'Done')),
  pickup_agreement text not null check (
    pickup_agreement in (
      'Self pick up at biggledot',
      'Online delivery',
      'Expedition'
    )
  ),
  total_price numeric(12, 2) not null default 0 check (total_price >= 0),
  date_order_created date not null default current_date,
  customer_name text,
  customer_address text,
  customer_phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
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
create index if not exists idx_orders_date_order_created on orders(date_order_created desc);
create index if not exists idx_order_items_order_id on order_items(order_id);
create index if not exists idx_order_items_product_id on order_items(product_id);
create index if not exists idx_products_sku on products(sku);

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

drop trigger if exists orders_set_updated_at on orders;
create trigger orders_set_updated_at
before update on orders
for each row
execute function set_updated_at();

create or replace function generate_order_number()
returns text as $$
begin
  return 'HP-' || to_char(now(), 'YYYYMMDD') || '-' || lpad(nextval('order_number_seq')::text, 4, '0');
end;
$$ language plpgsql;

create or replace function create_order(
  p_status text,
  p_pickup_agreement text,
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

  v_order_number := generate_order_number();

  insert into orders (
    order_number,
    status,
    pickup_agreement,
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
alter table orders enable row level security;
alter table order_items enable row level security;

drop policy if exists "Authenticated users can read products" on products;
create policy "Authenticated users can read products"
on products for select
to authenticated
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

grant execute on function create_order(text, text, date, text, text, text, jsonb) to authenticated;
grant execute on function update_pending_order(uuid, text, text, date, text, text, text, jsonb) to authenticated;
grant execute on function delete_pending_order(uuid) to authenticated;
