-- =========================================================
-- 開店平台 · 資料庫設定（v0.8：第一＋第二階段）
--
-- 用法：Supabase 後台左邊「SQL Editor」→ New query →
--       把這整個檔案貼上 → 按 Run。可以重複執行，不會重複建資料。
--       已經跑過舊版的資料庫，直接再跑一次新版就會升級（資料會保留）。
--
-- 安全設計：
--   1. 所有資料表都開啟 RLS 而且「不開任何直接存取」，
--      網站只能透過下面的函式讀寫。
--   2. 前台函式（shop_*）只回傳公開資訊；金額、折扣、庫存都在
--      伺服器重算，瀏覽器送來的價格一律不採用。
--   3. 後台函式（admin_*）會先確認登入者是這家店的管理者。
--   4. 設定用函式（setup_*）只能在 SQL Editor 執行。
-- =========================================================

create extension if not exists pgcrypto;

-- ---------- 資料表 ----------
create table if not exists stores (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]{2,40}$'),
  settings jsonb not null default '{}'::jsonb,
  order_seq int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists store_members (
  store_id uuid not null references stores(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'owner' check (role in ('owner', 'staff')),
  created_at timestamptz not null default now(),
  primary key (store_id, user_id)
);

create table if not exists categories (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  name text not null check (length(name) between 1 and 30),
  sort int not null default 0,
  created_at timestamptz not null default now(),
  unique (store_id, name)
);

create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  name text not null check (length(name) between 1 and 60),
  description text not null default '',
  status text not null default 'draft' check (status in ('active', 'draft')),
  color text not null default '#8a9a8e',
  category_ids uuid[] not null default '{}',
  options jsonb not null default '[]'::jsonb,   -- [{name, values:[...]}]，順序就是顯示順序
  images jsonb not null default '[]'::jsonb,    -- 第二階段放雲端圖片網址
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists variants (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id) on delete cascade,
  store_id uuid not null references stores(id) on delete cascade,
  sku text not null default '',
  options jsonb not null default '{}'::jsonb,   -- {"顏色":"白","尺寸":"S"}
  price int not null default 0 check (price >= 0),
  stock int not null default 0 check (stock >= 0),
  cost int not null default 0 check (cost >= 0),
  sort int not null default 0
);
create index if not exists variants_product_idx on variants(product_id);

create table if not exists customers (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  name text not null,
  phone text not null,
  email text not null default '',
  user_id uuid references auth.users(id) on delete set null,  -- 第二階段：會員帳號
  created_at timestamptz not null default now(),
  unique (store_id, phone)
);

create table if not exists orders (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  number text not null,
  customer_id uuid references customers(id) on delete set null,
  contact jsonb not null,
  items jsonb not null,
  subtotal int not null,
  shipping_fee int not null,
  discount int not null default 0,
  total int not null,
  discounts jsonb not null default '[]'::jsonb,
  coupon_code text not null default '',
  shipping jsonb not null,
  payment jsonb not null,
  status text not null check (status in ('pending_payment', 'paid', 'shipped', 'completed', 'cancelled')),
  note text not null default '',
  history jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  unique (store_id, number)
);
create index if not exists orders_store_created_idx on orders(store_id, created_at desc);
create index if not exists orders_coupon_idx on orders(store_id, coupon_code) where coupon_code <> '';

create table if not exists coupons (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  code text not null check (code ~ '^[A-Z0-9]{3,20}$'),
  name text not null,
  type text not null check (type in ('amount', 'percent', 'freeship')),
  value int not null default 0,
  max_discount int not null default 0,
  min_spend int not null default 0,
  start_at date,
  end_at date,
  usage_limit int not null default 0,
  per_customer int not null default 0,
  members_only boolean not null default false,
  stackable boolean not null default true,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  unique (store_id, code)
);

create table if not exists promotions (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  name text not null,
  tiers jsonb not null,           -- [{min, off}]
  start_at date,
  end_at date,
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists stock_movements (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  product_id uuid,
  variant_id uuid,
  name text not null,
  option_text text not null default '',
  sku text not null default '',
  delta int not null,
  after int not null,
  type text not null,             -- sale, cancel, purchase, adjust, edit, initial
  ref text not null default '',
  note text not null default '',
  at timestamptz not null default now()
);
create index if not exists stock_movements_store_idx on stock_movements(store_id, at desc);

-- ---------- 第二階段：會員、會員等級、進銷存 ----------
alter table stores add column if not exists po_seq int not null default 0;
alter table stores add column if not exists member_tiers jsonb not null default
  '{"enabled":false,"period":"all","tiers":[{"id":"tier_base","name":"一般會員","minSpend":0,"percent":100,"freeShip":false}]}'::jsonb;

-- 顧客：沒登入的顧客用手機分辨；登入的會員用帳號分辨（同一支手機可以同時有會員資料和舊的訪客資料）
alter table customers add column if not exists registered_at timestamptz;
alter table customers drop constraint if exists customers_store_id_phone_key;
create unique index if not exists customers_guest_phone_idx on customers(store_id, phone) where user_id is null;
create unique index if not exists customers_member_idx on customers(store_id, user_id) where user_id is not null;

create table if not exists suppliers (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  name text not null check (length(name) between 1 and 40),
  contact text not null default '',
  phone text not null default '',
  email text not null default '',
  tax_id text not null default '',
  address text not null default '',
  note text not null default '',
  created_at timestamptz not null default now(),
  unique (store_id, name)
);

create table if not exists purchases (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  number text not null,
  supplier_id uuid references suppliers(id) on delete set null,
  supplier_name text not null,
  status text not null check (status in ('draft', 'ordered', 'partial', 'received', 'cancelled')),
  expected_at date,
  note text not null default '',
  items jsonb not null default '[]'::jsonb,     -- [{productId, variantId, name, optionText, sku, qty, cost, received}]
  history jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  ordered_at timestamptz,
  received_at timestamptz,
  unique (store_id, number)
);

-- 全部上鎖：開啟 RLS、不給任何直接存取
do $$
declare t text;
begin
  foreach t in array array['stores','store_members','categories','products','variants','customers','orders','coupons','promotions','stock_movements','suppliers','purchases'] loop
    execute format('alter table %I enable row level security', t);
    execute format('revoke all on table %I from anon, authenticated', t);
  end loop;
end $$;

-- ---------- 小工具 ----------
create or replace function _money(n int) returns text language sql immutable as $$
  select 'NT$' || to_char(n, 'FM999,999,999,990')
$$;

-- 台灣今天的日期（優惠期間用）
create or replace function _today() returns date language sql stable as $$
  select (now() at time zone 'Asia/Taipei')::date
$$;

create or replace function _period_state(p_enabled boolean, p_start date, p_end date) returns text language sql stable as $$
  select case
    when not p_enabled then 'off'
    when p_start is not null and _today() < p_start then 'scheduled'
    when p_end is not null and _today() > p_end then 'expired'
    else 'active' end
$$;

-- 規格文字：照商品的規格順序排，例如「白 / S」
create or replace function _option_text(p_options jsonb, v_options jsonb) returns text language sql immutable as $$
  select coalesce(string_agg(v_options ->> (o ->> 'name'), ' / ' order by ord), '')
  from jsonb_array_elements(p_options) with ordinality as x(o, ord)
  where v_options ? (o ->> 'name')
$$;

-- 目前登入的會員在這家店的顧客編號（沒登入或還沒加入會員是 null）
create or replace function _member_id(p_store uuid) returns uuid language sql stable as $$
  select id from customers where store_id = p_store and user_id = auth.uid() and auth.uid() is not null
$$;

create or replace function _store_by_slug(p_slug text) returns stores language plpgsql stable as $$
declare s stores;
begin
  select * into s from stores where slug = p_slug;
  if not found then raise exception '找不到這家商店'; end if;
  return s;
end $$;

-- 後台權限檢查：登入者必須是這家店的成員
create or replace function _require_member(p_store uuid) returns void language plpgsql stable as $$
begin
  if auth.uid() is null then raise exception '請先登入'; end if;
  if not exists (select 1 from store_members where store_id = p_store and user_id = auth.uid()) then
    raise exception '你沒有這家商店的管理權限';
  end if;
end $$;

create or replace function _log_move(p_store uuid, p_variant uuid, p_delta int, p_type text, p_ref text, p_note text)
returns void language plpgsql as $$
begin
  insert into stock_movements(store_id, product_id, variant_id, name, option_text, sku, delta, after, type, ref, note)
  select p_store, p.id, v.id, p.name, _option_text(p.options, v.options), v.sku, p_delta, v.stock, p_type, coalesce(p_ref, ''), coalesce(p_note, '')
  from variants v join products p on p.id = v.product_id where v.id = p_variant;
end $$;

-- ---------- JSON 形狀（跟網站用的一樣） ----------
create or replace function _product_json(p products, with_cost boolean) returns jsonb language sql stable as $$
  select jsonb_build_object(
    'id', p.id, 'name', p.name, 'description', p.description, 'status', p.status, 'color', p.color,
    'categoryIds', to_jsonb(p.category_ids), 'options', p.options, 'images', p.images,
    'createdAt', p.created_at,
    'variants', coalesce((select jsonb_agg(
        jsonb_build_object('id', v.id, 'sku', v.sku, 'options', v.options, 'price', v.price, 'stock', v.stock)
        || case when with_cost then jsonb_build_object('cost', v.cost) else '{}'::jsonb end
        order by v.sort, v.sku) from variants v where v.product_id = p.id), '[]'::jsonb))
$$;

create or replace function _order_json(o orders) returns jsonb language sql stable as $$
  select jsonb_build_object(
    'id', o.id, 'number', o.number, 'customerId', o.customer_id, 'contact', o.contact, 'items', o.items,
    'subtotal', o.subtotal, 'shippingFee', o.shipping_fee, 'discount', o.discount, 'total', o.total,
    'discounts', o.discounts, 'couponCode', o.coupon_code, 'shipping', o.shipping, 'payment', o.payment,
    'status', o.status, 'note', o.note, 'history', o.history, 'createdAt', o.created_at)
$$;

-- 給顧客看的訂單：拿掉商家備註、內部編號、成本
create or replace function _order_customer_json(o orders) returns jsonb language sql stable as $$
  select _order_json(o) - 'note' - 'customerId' - 'id'
    || jsonb_build_object('items', (select coalesce(jsonb_agg(i - 'cost'), '[]'::jsonb) from jsonb_array_elements(o.items) i))
    || jsonb_build_object('history', (select coalesce(jsonb_agg(jsonb_build_object('status', h ->> 'status', 'at', h -> 'at')), '[]'::jsonb) from jsonb_array_elements(o.history) h))
$$;

create or replace function _coupon_json(c coupons) returns jsonb language sql stable as $$
  select jsonb_build_object(
    'id', c.id, 'code', c.code, 'name', c.name, 'type', c.type, 'value', c.value, 'maxDiscount', c.max_discount,
    'minSpend', c.min_spend, 'startAt', coalesce(c.start_at::text, ''), 'endAt', coalesce(c.end_at::text, ''),
    'usageLimit', c.usage_limit, 'perCustomer', c.per_customer, 'membersOnly', c.members_only,
    'stackable', c.stackable, 'enabled', c.enabled, 'createdAt', c.created_at,
    'state', _period_state(c.enabled, c.start_at, c.end_at),
    'used', (select count(*) from orders o where o.store_id = c.store_id and o.coupon_code = c.code and o.status <> 'cancelled'))
$$;

create or replace function _promotion_json(p promotions) returns jsonb language sql stable as $$
  select jsonb_build_object('id', p.id, 'name', p.name, 'tiers', p.tiers,
    'startAt', coalesce(p.start_at::text, ''), 'endAt', coalesce(p.end_at::text, ''),
    'enabled', p.enabled, 'createdAt', p.created_at, 'state', _period_state(p.enabled, p.start_at, p.end_at))
$$;

-- 前台看得到的商店設定（不含內部設定）
create or replace function _public_settings(s stores) returns jsonb language sql stable as $$
  select jsonb_build_object(
    'name', s.settings ->> 'name', 'tagline', s.settings ->> 'tagline',
    'email', s.settings ->> 'email', 'phone', s.settings ->> 'phone',
    'freeShippingThreshold', coalesce((s.settings ->> 'freeShippingThreshold')::int, 0),
    'shippingMethods', coalesce((select jsonb_agg(m) from jsonb_array_elements(s.settings -> 'shippingMethods') m where (m ->> 'enabled')::boolean), '[]'::jsonb),
    'paymentMethods', coalesce((select jsonb_agg(m) from jsonb_array_elements(s.settings -> 'paymentMethods') m where (m ->> 'enabled')::boolean), '[]'::jsonb))
$$;

-- ---------- 會員等級 ----------
-- 有效消費：已付款以上、沒取消的訂單；period = '12m' 只算最近 12 個月
create or replace function _member_level(p_store uuid, p_customer uuid) returns jsonb language plpgsql stable as $$
declare cfg jsonb; spent int; cur jsonb; nxt jsonb; idx int := 0; i int := 0; t jsonb;
begin
  select member_tiers into cfg from stores where id = p_store;
  if p_customer is null or cfg is null or not coalesce((cfg ->> 'enabled')::boolean, false) then return null; end if;
  select coalesce(sum(total), 0) into spent from orders
    where customer_id = p_customer and status in ('paid', 'shipped', 'completed')
      and (cfg ->> 'period' <> '12m' or created_at >= now() - interval '365 days');
  for t in select x from jsonb_array_elements(cfg -> 'tiers') x order by (x ->> 'minSpend')::int loop
    if spent >= (t ->> 'minSpend')::int then cur := t; idx := i;
    elsif nxt is null then nxt := t; end if;
    i := i + 1;
  end loop;
  if cur is null then return null; end if;
  return jsonb_build_object('tier', cur, 'index', idx, 'spent', spent, 'next', nxt,
    'gap', case when nxt is null then 0 else (nxt ->> 'minSpend')::int - spent end);
end $$;

create or replace function _tier_benefit(t jsonb) returns text language sql immutable as $$
  select coalesce(nullif(concat_ws('、',
    case when (t ->> 'percent')::int < 100 then '全館 ' ||
      case when (t ->> 'percent')::int % 10 = 0 then ((t ->> 'percent')::int / 10)::text else t ->> 'percent' end || ' 折' end,
    case when coalesce((t ->> 'freeShip')::boolean, false) then '免運' end), ''), '累積消費升級')
$$;

-- ---------- 金額計算（伺服器版） ----------
-- p_items：[{variantId, qty}]
-- 順序：商品小計 → 滿額折 → 會員等級折扣 → 優惠碼 → 運費；免運門檻看折扣後金額
-- p_customer：登入會員的顧客編號（沒登入是 null）
create or replace function _quote(p_store uuid, p_items jsonb, p_ship text, p_coupon text, p_phone text, p_customer uuid)
returns jsonb language plpgsql stable as $$
declare
  s stores;
  lines jsonb := '[]'::jsonb;
  subtotal int := 0;
  promo jsonb; next_tier jsonb; promo_amt int := 0; after_promo int;
  cp coupons; cp_json jsonb; cp_err text := ''; cp_amt int := 0; cp_free boolean := false;
  lvl jsonb; member_amt int := 0; after_member int; free_level boolean := false;
  used int; mine int;
  discounts jsonb := '[]'::jsonb;
  goods int; method jsonb; threshold int; free boolean; fee int;
  it record; t record;
begin
  select * into s from stores where id = p_store;
  if jsonb_typeof(p_items) is distinct from 'array' then raise exception '購物車格式不正確'; end if;
  if jsonb_array_length(p_items) > 50 then raise exception '一張訂單最多 50 種商品'; end if;

  for it in
    select v.id as variant_id, p.id as product_id, p.name, _option_text(p.options, v.options) as option_text,
           v.sku, v.price, v.stock, v.cost, greatest(0, least(99, (x ->> 'qty')::int)) as qty
    from jsonb_array_elements(p_items) x
    join variants v on v.id = (x ->> 'variantId')::uuid and v.store_id = p_store
    join products p on p.id = v.product_id and p.status = 'active'
  loop
    continue when it.qty <= 0;
    lines := lines || jsonb_build_object('productId', it.product_id, 'variantId', it.variant_id, 'name', it.name,
      'optionText', it.option_text, 'sku', it.sku, 'price', it.price, 'qty', it.qty, 'stock', it.stock, 'cost', it.cost);
    subtotal := subtotal + it.price * it.qty;
  end loop;

  -- 滿額活動：進行中的活動裡挑折最多的一段
  for t in
    select pm.name, (tier ->> 'min')::int as min, (tier ->> 'off')::int as off, pm.id
    from promotions pm, jsonb_array_elements(pm.tiers) tier
    where pm.store_id = p_store and _period_state(pm.enabled, pm.start_at, pm.end_at) = 'active'
  loop
    if subtotal >= t.min and (promo is null or t.off > (promo ->> 'amount')::int) then
      promo := jsonb_build_object('id', t.id, 'name', t.name, 'amount', t.off, 'min', t.min);
    end if;
  end loop;
  for t in
    select pm.name, (tier ->> 'min')::int as min, (tier ->> 'off')::int as off
    from promotions pm, jsonb_array_elements(pm.tiers) tier
    where pm.store_id = p_store and _period_state(pm.enabled, pm.start_at, pm.end_at) = 'active'
      and subtotal < (tier ->> 'min')::int and (tier ->> 'off')::int > coalesce((promo ->> 'amount')::int, 0)
    order by (tier ->> 'min')::int limit 1
  loop
    next_tier := jsonb_build_object('name', t.name, 'min', t.min, 'off', t.off, 'gap', t.min - subtotal);
  end loop;
  promo_amt := coalesce((promo ->> 'amount')::int, 0);
  after_promo := subtotal - promo_amt;

  -- 會員等級折扣
  lvl := _member_level(p_store, p_customer);
  if lvl is not null then
    if (lvl #>> '{tier,percent}')::int < 100 then
      member_amt := floor(after_promo * (100 - (lvl #>> '{tier,percent}')::int) / 100.0);
    end if;
    free_level := coalesce((lvl #>> '{tier,freeShip}')::boolean, false);
  end if;
  after_member := after_promo - member_amt;

  -- 優惠碼
  if coalesce(trim(p_coupon), '') <> '' then
    select * into cp from coupons where store_id = p_store and code = upper(trim(p_coupon));
    if not found then cp_err := '沒有這個優惠碼';
    else
      case _period_state(cp.enabled, cp.start_at, cp.end_at)
        when 'off' then cp_err := '這個優惠碼目前沒有開放';
        when 'scheduled' then cp_err := '這個優惠碼 ' || cp.start_at || ' 才開始';
        when 'expired' then cp_err := '這個優惠碼已經在 ' || cp.end_at || ' 結束';
        else null;
      end case;
      if cp_err = '' and cp.members_only and p_customer is null then cp_err := '這個優惠碼限會員使用，請先登入'; end if;
      if cp_err = '' and cp.usage_limit > 0 then
        select count(*) into used from orders where store_id = p_store and coupon_code = cp.code and status <> 'cancelled';
        if used >= cp.usage_limit then cp_err := '這個優惠碼已經被用完了'; end if;
      end if;
      if cp_err = '' and cp.per_customer > 0 and (p_customer is not null or coalesce(p_phone, '') <> '') then
        select count(*) into mine from orders where store_id = p_store and coupon_code = cp.code and status <> 'cancelled'
          and ((p_customer is not null and customer_id = p_customer) or (coalesce(p_phone, '') <> '' and contact ->> 'phone' = p_phone));
        if mine >= cp.per_customer then
          cp_err := case when cp.per_customer = 1 then '這個優惠碼每人限用一次，你已經用過了'
                         else '這個優惠碼每人限用 ' || cp.per_customer || ' 次，你已經用完了' end;
        end if;
      end if;
      if cp_err = '' and subtotal < cp.min_spend then
        cp_err := '商品滿 ' || _money(cp.min_spend) || ' 才能用，還差 ' || _money(cp.min_spend - subtotal);
      end if;
      if cp_err = '' and not cp.stackable and promo is not null then cp_err := '這個優惠碼不能和滿額活動一起使用'; end if;
      if cp_err = '' then
        if cp.type = 'amount' then cp_amt := least(cp.value, after_member);
        elsif cp.type = 'percent' then
          cp_amt := floor(after_member * (100 - cp.value) / 100.0);
          if cp.max_discount > 0 then cp_amt := least(cp_amt, cp.max_discount); end if;
        else cp_free := true;
        end if;
        cp_json := jsonb_build_object('code', cp.code, 'name', cp.name, 'amount', cp_amt, 'freeShip', cp_free);
      end if;
    end if;
  end if;

  if promo is not null then
    discounts := discounts || jsonb_build_object('kind', 'promo', 'label',
      (promo ->> 'name') || '（滿 ' || _money((promo ->> 'min')::int) || ' 折 ' || _money(promo_amt) || '）', 'amount', promo_amt);
  end if;
  if member_amt > 0 or free_level then
    discounts := discounts || jsonb_build_object('kind', 'member', 'label',
      '會員等級 ' || (lvl #>> '{tier,name}') || '（' || _tier_benefit(lvl -> 'tier') || '）', 'amount', member_amt, 'freeShip', free_level);
  end if;
  if cp_json is not null then
    discounts := discounts || jsonb_build_object('kind', 'coupon', 'code', cp.code, 'label', '優惠碼 ' || cp.code || '・' || cp.name,
      'amount', cp_amt, 'freeShip', cp_free);
  end if;

  goods := subtotal - promo_amt - member_amt - cp_amt;
  select m into method from jsonb_array_elements(s.settings -> 'shippingMethods') m
    where m ->> 'id' = p_ship and (m ->> 'enabled')::boolean;
  threshold := coalesce((s.settings ->> 'freeShippingThreshold')::int, 0);
  free := (threshold > 0 and goods >= threshold) or cp_free or free_level;
  fee := case when method is null or free then 0 else (method ->> 'fee')::int end;

  return jsonb_build_object(
    'lines', lines, 'subtotal', subtotal, 'promo', promo, 'nextTier', next_tier,
    'coupon', cp_json, 'couponError', cp_err, 'discounts', discounts, 'discount', promo_amt + member_amt + cp_amt,
    'goods', goods, 'shippingFee', fee, 'total', goods + fee, 'freeShipByCoupon', cp_free,
    'freeGap', case when free then 0 else greatest(0, threshold - goods) end,
    'level', lvl);
end $$;

-- =========================================================
-- 前台（任何人都能呼叫）
-- =========================================================

-- 商店目錄：設定、分類、上架商品（不含成本）、進行中的滿額活動
create or replace function shop_catalog(p_slug text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare s stores;
begin
  s := _store_by_slug(p_slug);
  return jsonb_build_object(
    'store', jsonb_build_object('id', s.id, 'slug', s.slug),
    'settings', _public_settings(s),
    'categories', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name) order by c.sort, c.created_at) from categories c where c.store_id = s.id), '[]'::jsonb),
    'products', coalesce((select jsonb_agg(_product_json(p, false) order by p.created_at desc) from products p where p.store_id = s.id and p.status = 'active'), '[]'::jsonb),
    'promotions', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'tiers', p.tiers)) from promotions p where p.store_id = s.id and _period_state(p.enabled, p.start_at, p.end_at) = 'active'), '[]'::jsonb),
    'memberTiers', jsonb_build_object('enabled', coalesce((s.member_tiers ->> 'enabled')::boolean, false), 'period', s.member_tiers ->> 'period', 'tiers', s.member_tiers -> 'tiers'));
end $$;

-- 購物車／結帳試算
create or replace function shop_quote(p_slug text, p_items jsonb, p_ship text default null, p_coupon text default null, p_phone text default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare s stores; q jsonb;
begin
  s := _store_by_slug(p_slug);
  q := _quote(s.id, p_items, p_ship, p_coupon, nullif(regexp_replace(coalesce(p_phone, ''), '[\s-]', '', 'g'), ''), _member_id(s.id));
  return jsonb_set(q, '{lines}', (select coalesce(jsonb_agg(l - 'cost'), '[]'::jsonb) from jsonb_array_elements(q -> 'lines') l));
end $$;

-- 下單：檢查 → 鎖庫存 → 伺服器算金額 → 建訂單 → 扣庫存
create or replace function shop_place_order(p_slug text, p_order jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  s stores;
  v_name text := trim(coalesce(p_order #>> '{contact,name}', ''));
  v_phone text := regexp_replace(coalesce(p_order #>> '{contact,phone}', ''), '[\s-]', '', 'g');
  v_email text := trim(coalesce(p_order #>> '{contact,email}', ''));
  ship jsonb; pay jsonb; q jsonb; l jsonb;
  cust uuid; member uuid; num text; seq int; o orders; now_ts timestamptz := now();
  v_address text := trim(coalesce(p_order #>> '{shipping,address}', ''));
  v_store_name text := trim(coalesce(p_order #>> '{shipping,storeName}', ''));
  v_items jsonb := p_order -> 'items';
begin
  select * into s from stores where slug = p_slug for update;   -- 同一家店的下單排隊處理，避免超賣與單號重複
  if not found then raise exception '找不到這家商店'; end if;
  if v_name = '' or v_phone = '' then raise exception '請填寫姓名與手機'; end if;
  if length(v_name) > 40 then raise exception '姓名太長'; end if;
  if v_phone !~ '^09\d{8}$' then raise exception '手機格式應為 09 開頭共 10 碼'; end if;
  if v_email <> '' and v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then raise exception 'Email 格式不正確'; end if;
  select m into ship from jsonb_array_elements(s.settings -> 'shippingMethods') m
    where m ->> 'id' = p_order #>> '{shipping,methodId}' and (m ->> 'enabled')::boolean;
  if ship is null then raise exception '請選擇取貨方式'; end if;
  if ship ->> 'type' = 'home' and v_address = '' then raise exception '請填寫收件地址'; end if;
  if ship ->> 'type' = 'cvs' and v_store_name = '' then raise exception '請填寫取貨門市'; end if;
  select m into pay from jsonb_array_elements(s.settings -> 'paymentMethods') m
    where m ->> 'id' = p_order ->> 'paymentMethodId' and (m ->> 'enabled')::boolean;
  if pay is null then raise exception '請選擇付款方式'; end if;

  -- 鎖住這張單用到的規格
  perform 1 from variants v where v.store_id = s.id
    and v.id in (select (x ->> 'variantId')::uuid from jsonb_array_elements(v_items) x) for update;

  member := _member_id(s.id);
  q := _quote(s.id, v_items, ship ->> 'id', p_order ->> 'coupon', v_phone, member);
  if jsonb_array_length(q -> 'lines') = 0 then raise exception '購物車是空的，或商品已下架'; end if;
  if jsonb_array_length(q -> 'lines') < (select count(*) from jsonb_array_elements(v_items) x where (x ->> 'qty')::int > 0) then
    raise exception '購物車裡有商品已下架，請回購物車確認';
  end if;
  for l in select * from jsonb_array_elements(q -> 'lines') loop
    if (l ->> 'qty')::int > (l ->> 'stock')::int then
      raise exception '「%」庫存不足，只剩 % 件', l ->> 'name', l ->> 'stock';
    end if;
  end loop;
  if coalesce(q ->> 'couponError', '') <> '' then
    raise exception '優惠碼 %：%（可以先移除優惠碼再結帳）', upper(p_order ->> 'coupon'), q ->> 'couponError';
  end if;

  -- 登入的會員：訂單掛在會員資料下；沒登入：用手機找（或建立）訪客資料
  if member is not null then
    cust := member;
  else
    insert into customers(store_id, name, phone, email) values (s.id, v_name, v_phone, v_email)
    on conflict (store_id, phone) where user_id is null do update
      set name = excluded.name, email = case when excluded.email <> '' then excluded.email else customers.email end
    returning id into cust;
  end if;

  update stores set order_seq = order_seq + 1 where id = s.id returning order_seq into seq;
  num := 'SO' || (240000 + seq);

  insert into orders(store_id, number, customer_id, contact, items, subtotal, shipping_fee, discount, total, discounts, coupon_code,
                     shipping, payment, status, note, history, created_at)
  values (s.id, num, cust, jsonb_build_object('name', v_name, 'phone', v_phone, 'email', v_email),
    (select jsonb_agg(ln - 'stock') from jsonb_array_elements(q -> 'lines') ln),
    (q ->> 'subtotal')::int, (q ->> 'shippingFee')::int, (q ->> 'discount')::int, (q ->> 'total')::int, q -> 'discounts',
    coalesce(q #>> '{coupon,code}', ''),
    jsonb_build_object('methodId', ship ->> 'id', 'methodName', ship ->> 'name', 'address', case when ship ->> 'type' = 'home' then v_address else '' end,
                       'storeName', case when ship ->> 'type' = 'cvs' then v_store_name else '' end, 'trackingNo', ''),
    jsonb_build_object('methodId', pay ->> 'id', 'methodName', pay ->> 'name', 'status', 'unpaid'),
    case when pay ->> 'id' = 'cod' then 'paid' else 'pending_payment' end,
    left(trim(coalesce(p_order ->> 'note', '')), 500),
    jsonb_build_array(jsonb_build_object('status', 'pending_payment', 'at', now_ts))
      || case when pay ->> 'id' = 'cod' then jsonb_build_array(jsonb_build_object('status', 'paid', 'at', now_ts, 'note', '取貨付款，直接進入待出貨')) else '[]'::jsonb end,
    now_ts)
  returning * into o;

  for l in select * from jsonb_array_elements(q -> 'lines') loop
    update variants set stock = stock - (l ->> 'qty')::int where id = (l ->> 'variantId')::uuid;
    perform _log_move(s.id, (l ->> 'variantId')::uuid, -(l ->> 'qty')::int, 'sale', num, '');
  end loop;

  return _order_customer_json(o) || jsonb_build_object('paymentInstruction', pay ->> 'instruction');
end $$;

-- 免登入查訂單：訂單編號＋下單手機都對才給看
create or replace function shop_order_lookup(p_slug text, p_number text, p_phone text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare s stores; o orders;
begin
  s := _store_by_slug(p_slug);
  select * into o from orders where store_id = s.id and upper(number) = upper(trim(p_number))
    and contact ->> 'phone' = regexp_replace(coalesce(p_phone, ''), '[\s-]', '', 'g');
  if not found then raise exception '查不到這筆訂單，請確認訂單編號和下單時填的手機'; end if;
  return _order_customer_json(o) || jsonb_build_object('paymentInstruction',
    (select m ->> 'instruction' from jsonb_array_elements(s.settings -> 'paymentMethods') m where m ->> 'id' = o.payment ->> 'methodId'));
end $$;

-- 顧客自己取消：只有「待付款」可以，要訂單編號＋手機
create or replace function shop_cancel_order(p_slug text, p_number text, p_phone text) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare s stores; o orders; it jsonb;
begin
  s := _store_by_slug(p_slug);
  select * into o from orders where store_id = s.id and upper(number) = upper(trim(p_number))
    and contact ->> 'phone' = regexp_replace(coalesce(p_phone, ''), '[\s-]', '', 'g') for update;
  if not found then raise exception '找不到這筆訂單'; end if;
  if o.status <> 'pending_payment' then raise exception '這筆訂單已經在處理，請聯絡客服取消'; end if;
  for it in select * from jsonb_array_elements(o.items) loop
    update variants set stock = stock + (it ->> 'qty')::int where id = (it ->> 'variantId')::uuid and store_id = s.id;
    if found then perform _log_move(s.id, (it ->> 'variantId')::uuid, (it ->> 'qty')::int, 'cancel', o.number, '顧客自行取消，庫存加回'); end if;
  end loop;
  update orders set status = 'cancelled', history = history || jsonb_build_array(jsonb_build_object('status', 'cancelled', 'at', now(), 'note', '顧客自行取消'))
    where id = o.id returning * into o;
  return shop_order_lookup(p_slug, p_number, p_phone);
end $$;

-- =========================================================
-- 商家後台（要登入、而且是這家店的成員）
-- =========================================================

create or replace function admin_my_stores() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'slug', s.slug, 'name', s.settings ->> 'name', 'role', m.role)), '[]'::jsonb)
  from store_members m join stores s on s.id = m.store_id where m.user_id = auth.uid()
$$;

-- 後台一次載入整家店的資料（小型商店適用；訂單取最近 1000 筆）
create or replace function admin_bootstrap(p_store uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare s stores;
begin
  perform _require_member(p_store);
  select * into s from stores where id = p_store;
  return jsonb_build_object(
    'store', jsonb_build_object('id', s.id, 'slug', s.slug),
    'settings', s.settings,
    'categories', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name) order by c.sort, c.created_at) from categories c where c.store_id = s.id), '[]'::jsonb),
    'products', coalesce((select jsonb_agg(_product_json(p, true) order by p.created_at desc) from products p where p.store_id = s.id), '[]'::jsonb),
    'customers', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'phone', c.phone, 'email', c.email,
        'createdAt', c.created_at, 'hasAccount', c.user_id is not null, 'registeredAt', c.registered_at)) from customers c where c.store_id = s.id), '[]'::jsonb),
    'memberTiers', s.member_tiers,
    'suppliers', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name, 'contact', x.contact, 'phone', x.phone, 'email', x.email,
        'taxId', x.tax_id, 'address', x.address, 'note', x.note, 'createdAt', x.created_at) order by x.name) from suppliers x where x.store_id = s.id), '[]'::jsonb),
    'purchases', coalesce((select jsonb_agg(jsonb_build_object('id', po.id, 'number', po.number, 'supplierId', po.supplier_id, 'supplierName', po.supplier_name,
        'status', po.status, 'expectedAt', coalesce(po.expected_at::text, ''), 'note', po.note, 'items', po.items, 'history', po.history,
        'createdAt', po.created_at, 'orderedAt', po.ordered_at, 'receivedAt', po.received_at) order by po.created_at desc)
        from (select * from purchases where store_id = s.id order by created_at desc limit 500) po), '[]'::jsonb),
    'movements', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'at', m.at, 'productId', m.product_id, 'variantId', m.variant_id,
        'name', m.name, 'optionText', m.option_text, 'sku', m.sku, 'delta', m.delta, 'after', m.after, 'type', m.type, 'ref', m.ref, 'note', m.note) order by m.at)
        from (select * from stock_movements where store_id = s.id order by at desc limit 1000) m), '[]'::jsonb),
    'orders', coalesce((select jsonb_agg(_order_json(o) order by o.created_at desc) from (select * from orders where store_id = s.id order by created_at desc limit 1000) o), '[]'::jsonb),
    'coupons', coalesce((select jsonb_agg(_coupon_json(c) order by c.created_at desc) from coupons c where c.store_id = s.id), '[]'::jsonb),
    'promotions', coalesce((select jsonb_agg(_promotion_json(p) order by p.created_at desc) from promotions p where p.store_id = s.id), '[]'::jsonb),
    'loadedAt', now());
end $$;

create or replace function admin_save_settings(p_store uuid, p_settings jsonb) returns void
language plpgsql volatile security definer set search_path = public as $$
begin
  perform _require_member(p_store);
  if coalesce(trim(p_settings ->> 'name'), '') = '' then raise exception '請填寫商店名稱'; end if;
  if not exists (select 1 from jsonb_array_elements(p_settings -> 'shippingMethods') m where (m ->> 'enabled')::boolean) then raise exception '至少要開一種取貨方式'; end if;
  if not exists (select 1 from jsonb_array_elements(p_settings -> 'paymentMethods') m where (m ->> 'enabled')::boolean) then raise exception '至少要開一種付款方式'; end if;
  update stores set settings = p_settings where id = p_store;
end $$;

create or replace function admin_save_category(p_store uuid, p_id uuid, p_name text) returns uuid
language plpgsql volatile security definer set search_path = public as $$
declare cid uuid;
begin
  perform _require_member(p_store);
  p_name := trim(coalesce(p_name, ''));
  if p_name = '' then raise exception '請輸入分類名稱'; end if;
  if exists (select 1 from categories where store_id = p_store and name = p_name and id is distinct from p_id) then raise exception '已有同名分類'; end if;
  if p_id is null then
    insert into categories(store_id, name, sort) values (p_store, p_name, (select coalesce(max(sort), 0) + 1 from categories where store_id = p_store)) returning id into cid;
  else
    update categories set name = p_name where id = p_id and store_id = p_store returning id into cid;
  end if;
  return cid;
end $$;

create or replace function admin_delete_category(p_store uuid, p_id uuid) returns void
language plpgsql volatile security definer set search_path = public as $$
begin
  perform _require_member(p_store);
  update products set category_ids = array_remove(category_ids, p_id) where store_id = p_store;
  delete from categories where id = p_id and store_id = p_store;
end $$;

-- 儲存商品：variants 裡用 stockDelta 表示「這次改了多少庫存」，
-- 伺服器用目前庫存加上變動量，不會蓋掉剛剛才賣掉的數字
create or replace function admin_save_product(p_store uuid, p_product jsonb) returns uuid
language plpgsql volatile security definer set search_path = public as $$
declare
  pid uuid := nullif(p_product ->> 'id', '')::uuid;
  v jsonb; vid uuid; keep uuid[] := '{}'; ord int := 0; delta int; cur int;
  cats uuid[]; v_images jsonb;
begin
  perform _require_member(p_store);
  if coalesce(trim(p_product ->> 'name'), '') = '' then raise exception '請輸入商品名稱'; end if;
  -- 商品圖片：只接受這家店自己上傳到雲端的圖片網址
  select coalesce(jsonb_agg(jsonb_build_object('id', im ->> 'id', 'url', im ->> 'url', 'path', im ->> 'path',
      'width', coalesce((im ->> 'width')::int, 0), 'height', coalesce((im ->> 'height')::int, 0))), '[]'::jsonb)
  into v_images from jsonb_array_elements(coalesce(p_product -> 'images', '[]'::jsonb)) im;
  if jsonb_array_length(v_images) > 8 then raise exception '每個商品最多 8 張圖片'; end if;
  if exists (select 1 from jsonb_array_elements(v_images) im
             where im ->> 'url' not like '%/storage/v1/object/public/product-images/' || p_store::text || '/%'
                or im ->> 'path' not like p_store::text || '/%') then
    raise exception '圖片網址不正確，請重新上傳';
  end if;
  if jsonb_array_length(coalesce(p_product -> 'variants', '[]'::jsonb)) = 0 then raise exception '至少需要一個規格'; end if;
  select coalesce(array_agg(c.id), '{}') into cats from categories c
    where c.store_id = p_store and c.id in (select (x #>> '{}')::uuid from jsonb_array_elements(coalesce(p_product -> 'categoryIds', '[]'::jsonb)) x);
  if pid is null then
    insert into products(store_id, name, description, status, color, category_ids, options, images)
    values (p_store, trim(p_product ->> 'name'), coalesce(p_product ->> 'description', ''),
      case when p_product ->> 'status' = 'active' then 'active' else 'draft' end,
      coalesce(nullif(p_product ->> 'color', ''), (array['#8a9a8e','#b7a38b','#6d7b86','#a58a6f','#4f6b66','#7a5a43','#8c7f99'])[1 + floor(random() * 7)::int]),
      cats, coalesce(p_product -> 'options', '[]'::jsonb), v_images)
    returning id into pid;
  else
    update products set name = trim(p_product ->> 'name'), description = coalesce(p_product ->> 'description', ''),
      status = case when p_product ->> 'status' = 'active' then 'active' else 'draft' end,
      category_ids = cats, options = coalesce(p_product -> 'options', '[]'::jsonb), images = v_images, updated_at = now()
    where id = pid and store_id = p_store;
    if not found then raise exception '找不到這個商品'; end if;
  end if;

  for v in select * from jsonb_array_elements(p_product -> 'variants') loop
    ord := ord + 1;
    if coalesce((v ->> 'price')::int, -1) < 0 then raise exception '價格需為 0 以上的數字'; end if;
    vid := nullif(v ->> 'id', '')::uuid;
    delta := coalesce((v ->> 'stockDelta')::int, 0);
    if vid is not null and exists (select 1 from variants where id = vid and product_id = pid) then
      select stock into cur from variants where id = vid for update;
      if cur + delta < 0 then raise exception '「%」庫存不能小於 0（目前 %）', coalesce(nullif(v ->> 'sku', ''), '規格'), cur; end if;
      update variants set sku = coalesce(v ->> 'sku', ''), options = coalesce(v -> 'options', '{}'::jsonb),
        price = (v ->> 'price')::int, cost = greatest(0, coalesce((v ->> 'cost')::int, 0)), stock = stock + delta, sort = ord
      where id = vid;
      if delta <> 0 then perform _log_move(p_store, vid, delta, 'edit', '', '在商品頁直接修改庫存'); end if;
    else
      if delta < 0 then raise exception '庫存需為 0 以上的整數'; end if;
      insert into variants(product_id, store_id, sku, options, price, stock, cost, sort)
      values (pid, p_store, coalesce(v ->> 'sku', ''), coalesce(v -> 'options', '{}'::jsonb), (v ->> 'price')::int, delta,
              greatest(0, coalesce((v ->> 'cost')::int, 0)), ord)
      returning id into vid;
      if delta > 0 then perform _log_move(p_store, vid, delta, 'initial', '', '新增規格的期初庫存'); end if;
    end if;
    keep := keep || vid;
  end loop;
  delete from variants where product_id = pid and not (id = any(keep));
  return pid;
end $$;

create or replace function admin_delete_product(p_store uuid, p_id uuid) returns void
language plpgsql volatile security definer set search_path = public as $$
begin
  perform _require_member(p_store);
  delete from products where id = p_id and store_id = p_store;
end $$;

-- 改訂單狀態：只允許正常的流程
create or replace function admin_set_order_status(p_store uuid, p_order uuid, p_status text, p_tracking text default null, p_note text default null)
returns void language plpgsql volatile security definer set search_path = public as $$
declare o orders; it jsonb; allowed text[];
begin
  perform _require_member(p_store);
  select * into o from orders where id = p_order and store_id = p_store for update;
  if not found then raise exception '找不到這筆訂單'; end if;
  allowed := case o.status
    when 'pending_payment' then array['paid', 'cancelled']
    when 'paid' then array['shipped', 'cancelled']
    when 'shipped' then array['completed']
    else array[]::text[] end;
  if not (p_status = any(allowed)) then raise exception '這筆訂單現在不能改成這個狀態'; end if;
  if p_status = 'cancelled' then
    for it in select * from jsonb_array_elements(o.items) loop
      update variants set stock = stock + (it ->> 'qty')::int where id = (it ->> 'variantId')::uuid and store_id = p_store;
      if found then perform _log_move(p_store, (it ->> 'variantId')::uuid, (it ->> 'qty')::int, 'cancel', o.number, '訂單取消，庫存加回'); end if;
    end loop;
  end if;
  update orders set
    status = p_status,
    payment = case when p_status = 'paid' or (p_status = 'completed' and o.payment ->> 'methodId' = 'cod')
                   then jsonb_set(payment, '{status}', '"paid"') else payment end,
    shipping = case when p_tracking is not null then jsonb_set(shipping, '{trackingNo}', to_jsonb(left(trim(p_tracking), 40))) else shipping end,
    history = history || jsonb_build_array(jsonb_build_object('status', p_status, 'at', now(), 'note', coalesce(p_note, '')))
  where id = o.id;
end $$;

create or replace function admin_set_order_note(p_store uuid, p_order uuid, p_note text) returns void
language plpgsql volatile security definer set search_path = public as $$
begin
  perform _require_member(p_store);
  update orders set note = left(coalesce(p_note, ''), 2000) where id = p_order and store_id = p_store;
end $$;

create or replace function admin_save_coupon(p_store uuid, p_coupon jsonb) returns uuid
language plpgsql volatile security definer set search_path = public as $$
declare
  cid uuid := nullif(p_coupon ->> 'id', '')::uuid;
  v_code text := upper(trim(coalesce(p_coupon ->> 'code', '')));
  typ text := p_coupon ->> 'type';
  val int := greatest(0, coalesce((p_coupon ->> 'value')::int, 0));
  sd date := nullif(p_coupon ->> 'startAt', '')::date;
  ed date := nullif(p_coupon ->> 'endAt', '')::date;
begin
  perform _require_member(p_store);
  if v_code !~ '^[A-Z0-9]{3,20}$' then raise exception '優惠碼要 3～20 個英文字母或數字'; end if;
  if exists (select 1 from coupons where store_id = p_store and coupons.code = v_code and id is distinct from cid) then raise exception '已經有同樣的優惠碼'; end if;
  if coalesce(trim(p_coupon ->> 'name'), '') = '' then raise exception '請填寫優惠券名稱'; end if;
  if typ not in ('amount', 'percent', 'freeship') then raise exception '請選擇優惠方式'; end if;
  if typ = 'amount' and val <= 0 then raise exception '折抵金額要大於 0'; end if;
  if typ = 'percent' and not (val between 1 and 99) then raise exception '折數請填 1～99，例如 85 代表 85 折、9 折請填 90'; end if;
  if sd is not null and ed is not null and sd > ed then raise exception '結束日期不能早於開始日期'; end if;
  if cid is null then
    insert into coupons(store_id, code, name, type, value, max_discount, min_spend, start_at, end_at, usage_limit, per_customer, members_only, stackable, enabled)
    values (p_store, v_code, trim(p_coupon ->> 'name'), typ, case when typ = 'freeship' then 0 else val end,
      case when typ = 'percent' then greatest(0, coalesce((p_coupon ->> 'maxDiscount')::int, 0)) else 0 end,
      greatest(0, coalesce((p_coupon ->> 'minSpend')::int, 0)), sd, ed,
      greatest(0, coalesce((p_coupon ->> 'usageLimit')::int, 0)), greatest(0, coalesce((p_coupon ->> 'perCustomer')::int, 0)),
      coalesce((p_coupon ->> 'membersOnly')::boolean, false), coalesce((p_coupon ->> 'stackable')::boolean, true), coalesce((p_coupon ->> 'enabled')::boolean, true))
    returning id into cid;
  else
    update coupons set code = v_code, name = trim(p_coupon ->> 'name'), type = typ,
      value = case when typ = 'freeship' then 0 else val end,
      max_discount = case when typ = 'percent' then greatest(0, coalesce((p_coupon ->> 'maxDiscount')::int, 0)) else 0 end,
      min_spend = greatest(0, coalesce((p_coupon ->> 'minSpend')::int, 0)), start_at = sd, end_at = ed,
      usage_limit = greatest(0, coalesce((p_coupon ->> 'usageLimit')::int, 0)), per_customer = greatest(0, coalesce((p_coupon ->> 'perCustomer')::int, 0)),
      members_only = coalesce((p_coupon ->> 'membersOnly')::boolean, false), stackable = coalesce((p_coupon ->> 'stackable')::boolean, true),
      enabled = coalesce((p_coupon ->> 'enabled')::boolean, true)
    where id = cid and store_id = p_store;
    if not found then raise exception '找不到這張優惠券'; end if;
  end if;
  return cid;
end $$;

create or replace function admin_delete_coupon(p_store uuid, p_id uuid) returns void
language plpgsql volatile security definer set search_path = public as $$
begin
  perform _require_member(p_store);
  delete from coupons where id = p_id and store_id = p_store;
end $$;

create or replace function admin_save_promotion(p_store uuid, p_promo jsonb) returns uuid
language plpgsql volatile security definer set search_path = public as $$
declare
  pmid uuid := nullif(p_promo ->> 'id', '')::uuid;
  v_tiers jsonb;
  sd date := nullif(p_promo ->> 'startAt', '')::date;
  ed date := nullif(p_promo ->> 'endAt', '')::date;
begin
  perform _require_member(p_store);
  if coalesce(trim(p_promo ->> 'name'), '') = '' then raise exception '請填寫活動名稱'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('min', mn, 'off', off) order by mn), '[]'::jsonb) into v_tiers
  from (select greatest(0, floor((t ->> 'min')::numeric))::int as mn, greatest(0, floor((t ->> 'off')::numeric))::int as off
        from jsonb_array_elements(coalesce(p_promo -> 'tiers', '[]'::jsonb)) t) x where mn > 0 and off > 0;
  if jsonb_array_length(v_tiers) = 0 then raise exception '至少要有一段「滿多少折多少」'; end if;
  if exists (select 1 from jsonb_array_elements(v_tiers) t where (t ->> 'off')::int >= (t ->> 'min')::int) then raise exception '折抵金額要小於門檻金額'; end if;
  if (select count(distinct t ->> 'min') from jsonb_array_elements(v_tiers) t) <> jsonb_array_length(v_tiers) then raise exception '門檻金額不能重複'; end if;
  if sd is not null and ed is not null and sd > ed then raise exception '結束日期不能早於開始日期'; end if;
  if pmid is null then
    insert into promotions(store_id, name, tiers, start_at, end_at, enabled)
    values (p_store, trim(p_promo ->> 'name'), v_tiers, sd, ed, coalesce((p_promo ->> 'enabled')::boolean, true)) returning id into pmid;
  else
    update promotions set name = trim(p_promo ->> 'name'), tiers = v_tiers, start_at = sd, end_at = ed,
      enabled = coalesce((p_promo ->> 'enabled')::boolean, true)
    where id = pmid and store_id = p_store;
    if not found then raise exception '找不到這個活動'; end if;
  end if;
  return pmid;
end $$;

create or replace function admin_delete_promotion(p_store uuid, p_id uuid) returns void
language plpgsql volatile security definer set search_path = public as $$
begin
  perform _require_member(p_store);
  delete from promotions where id = p_id and store_id = p_store;
end $$;

-- =========================================================
-- 前台會員（顧客用 Email 帳號登入，第二階段）
-- =========================================================

-- 登入後呼叫：取得這家店的會員資料（還沒加入就回 null）
create or replace function shop_member_me(p_slug text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare s stores; c customers;
begin
  s := _store_by_slug(p_slug);
  if auth.uid() is null then return null; end if;
  select * into c from customers where store_id = s.id and user_id = auth.uid();
  if not found then return null; end if;
  return jsonb_build_object('id', c.id, 'name', c.name, 'phone', c.phone, 'email', c.email, 'hasAccount', true,
    'registeredAt', c.registered_at,
    'orderCount', (select count(*) from orders where customer_id = c.id and status <> 'cancelled'),
    'totalSpent', (select coalesce(sum(total), 0) from orders where customer_id = c.id and status <> 'cancelled'),
    'level', _member_level(s.id, c.id));
end $$;

-- 加入這家店的會員（Email 要先驗證過）。
-- 以前用同一個 Email 下過的訪客訂單會自動接上；只用手機比對不會接上（手機沒有驗證）。
create or replace function shop_member_join(p_slug text, p_name text, p_phone text) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare s stores; u record; cid uuid; v_name text := trim(coalesce(p_name, '')); v_phone text := regexp_replace(coalesce(p_phone, ''), '[\s-]', '', 'g');
begin
  s := _store_by_slug(p_slug);
  if auth.uid() is null then raise exception '請先登入'; end if;
  select id, email, email_confirmed_at into u from auth.users where id = auth.uid();
  if u.email_confirmed_at is null then raise exception '請先到信箱完成 Email 驗證'; end if;
  if v_name = '' then raise exception '請填寫姓名'; end if;
  if length(v_name) > 40 then raise exception '姓名太長'; end if;
  if v_phone !~ '^09\d{8}$' then raise exception '手機格式應為 09 開頭共 10 碼'; end if;
  select id into cid from customers where store_id = s.id and user_id = auth.uid();
  if cid is null then
    select id into cid from customers where store_id = s.id and user_id is null and email <> '' and lower(email) = lower(u.email)
      order by created_at limit 1 for update;
    if cid is not null then
      update customers set user_id = auth.uid(), registered_at = now(), name = v_name, email = u.email where id = cid;
    else
      insert into customers(store_id, name, phone, email, user_id, registered_at) values (s.id, v_name, v_phone, u.email, auth.uid(), now())
      returning id into cid;
    end if;
  end if;
  update customers set name = v_name, phone = v_phone, email = u.email where id = cid;
  return shop_member_me(p_slug);
end $$;

create or replace function shop_member_update(p_slug text, p_name text, p_phone text) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare s stores; cid uuid; v_name text := trim(coalesce(p_name, '')); v_phone text := regexp_replace(coalesce(p_phone, ''), '[\s-]', '', 'g');
begin
  s := _store_by_slug(p_slug);
  cid := _member_id(s.id);
  if cid is null then raise exception '請先登入'; end if;
  if v_name = '' then raise exception '請填寫姓名'; end if;
  if v_phone !~ '^09\d{8}$' then raise exception '手機格式應為 09 開頭共 10 碼'; end if;
  update customers set name = v_name, phone = v_phone where id = cid;
  return shop_member_me(p_slug);
end $$;

create or replace function shop_my_orders(p_slug text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare s stores; cid uuid;
begin
  s := _store_by_slug(p_slug);
  cid := _member_id(s.id);
  if cid is null then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(_order_customer_json(o) order by o.created_at desc) from orders o where o.customer_id = cid), '[]'::jsonb);
end $$;

-- 會員取消自己「待付款」的訂單
create or replace function shop_member_cancel(p_slug text, p_number text) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare s stores; o orders; cid uuid;
begin
  s := _store_by_slug(p_slug);
  cid := _member_id(s.id);
  if cid is null then raise exception '請先登入'; end if;
  select * into o from orders where store_id = s.id and number = upper(trim(p_number)) and customer_id = cid;
  if not found then raise exception '找不到這筆訂單'; end if;
  return shop_cancel_order(p_slug, o.number, o.contact ->> 'phone');
end $$;

-- =========================================================
-- 後台：會員等級、盤點、供應商、進貨單（第二階段）
-- =========================================================

create or replace function admin_save_tiers(p_store uuid, p_cfg jsonb) returns void
language plpgsql volatile security definer set search_path = public as $$
declare v_tiers jsonb;
begin
  perform _require_member(p_store);
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', coalesce(nullif(t ->> 'id', ''), 'tier_' || substr(md5(random()::text), 1, 8)),
      'name', trim(t ->> 'name'),
      'minSpend', greatest(0, coalesce((t ->> 'minSpend')::numeric, 0))::int,
      'percent', least(100, greatest(1, coalesce((t ->> 'percent')::numeric, 100)))::int,
      'freeShip', coalesce((t ->> 'freeShip')::boolean, false))
    order by greatest(0, coalesce((t ->> 'minSpend')::numeric, 0))), '[]'::jsonb)
  into v_tiers from jsonb_array_elements(coalesce(p_cfg -> 'tiers', '[]'::jsonb)) t;
  if jsonb_array_length(v_tiers) = 0 then raise exception '至少要有一個等級'; end if;
  if jsonb_array_length(v_tiers) > 5 then raise exception '最多 5 個等級'; end if;
  if exists (select 1 from jsonb_array_elements(v_tiers) t where coalesce(t ->> 'name', '') = '') then raise exception '每個等級都要有名稱'; end if;
  if (select count(distinct t ->> 'name') from jsonb_array_elements(v_tiers) t) <> jsonb_array_length(v_tiers) then raise exception '等級名稱不能重複'; end if;
  if (select count(distinct t ->> 'minSpend') from jsonb_array_elements(v_tiers) t) <> jsonb_array_length(v_tiers) then raise exception '升級門檻不能重複'; end if;
  v_tiers := jsonb_set(v_tiers, '{0,minSpend}', '0');   -- 最低等級一定從 0 開始
  update stores set member_tiers = jsonb_build_object(
    'enabled', coalesce((p_cfg ->> 'enabled')::boolean, false),
    'period', case when p_cfg ->> 'period' = '12m' then '12m' else 'all' end,
    'tiers', v_tiers) where id = p_store;
end $$;

-- 盤點調整：p_mode 'set' 設成實際數量、'delta' 增減
create or replace function admin_adjust_stock(p_store uuid, p_variant uuid, p_mode text, p_qty int, p_reason text, p_note text default '')
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare cur int; target int; d int;
begin
  perform _require_member(p_store);
  select stock into cur from variants where id = p_variant and store_id = p_store for update;
  if not found then raise exception '找不到這個規格'; end if;
  if p_qty is null then raise exception '請填數量'; end if;
  target := case when p_mode = 'set' then p_qty else cur + p_qty end;
  if target < 0 then raise exception '調整後庫存不能小於 0（目前 %）', cur; end if;
  d := target - cur;
  if d = 0 then raise exception '數量沒有變化'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception '請選擇調整原因'; end if;
  update variants set stock = target where id = p_variant;
  perform _log_move(p_store, p_variant, d, 'adjust', '',
    concat_ws('：', trim(p_reason), nullif(trim(coalesce(p_note, '')), '')) || case when p_mode = 'set' then '（盤點實際數量 ' || target || '）' else '' end);
  return jsonb_build_object('stock', target, 'delta', d);
end $$;

create or replace function admin_save_supplier(p_store uuid, p_supplier jsonb) returns uuid
language plpgsql volatile security definer set search_path = public as $$
declare sid uuid := nullif(p_supplier ->> 'id', '')::uuid; v_name text := trim(coalesce(p_supplier ->> 'name', ''));
  v_tax text := trim(coalesce(p_supplier ->> 'taxId', '')); v_email text := trim(coalesce(p_supplier ->> 'email', ''));
begin
  perform _require_member(p_store);
  if v_name = '' then raise exception '請填寫供應商名稱'; end if;
  if v_tax <> '' and v_tax !~ '^\d{8}$' then raise exception '統一編號是 8 位數字'; end if;
  if v_email <> '' and v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then raise exception 'Email 格式不正確'; end if;
  if exists (select 1 from suppliers where store_id = p_store and name = v_name and id is distinct from sid) then raise exception '已經有同名的供應商'; end if;
  if sid is null then
    insert into suppliers(store_id, name, contact, phone, email, tax_id, address, note)
    values (p_store, v_name, trim(coalesce(p_supplier ->> 'contact', '')), trim(coalesce(p_supplier ->> 'phone', '')), v_email, v_tax,
            trim(coalesce(p_supplier ->> 'address', '')), trim(coalesce(p_supplier ->> 'note', ''))) returning id into sid;
  else
    update suppliers set name = v_name, contact = trim(coalesce(p_supplier ->> 'contact', '')), phone = trim(coalesce(p_supplier ->> 'phone', '')),
      email = v_email, tax_id = v_tax, address = trim(coalesce(p_supplier ->> 'address', '')), note = trim(coalesce(p_supplier ->> 'note', ''))
    where id = sid and store_id = p_store;
    if not found then raise exception '找不到這個供應商'; end if;
  end if;
  return sid;
end $$;

create or replace function admin_delete_supplier(p_store uuid, p_id uuid) returns void
language plpgsql volatile security definer set search_path = public as $$
begin
  perform _require_member(p_store);
  if exists (select 1 from purchases where store_id = p_store and supplier_id = p_id and status in ('ordered', 'partial')) then
    raise exception '這個供應商還有未入庫的進貨單，先處理完再刪除';
  end if;
  delete from suppliers where id = p_id and store_id = p_store;
end $$;

-- 建立或修改進貨單草稿
create or replace function admin_save_purchase(p_store uuid, p_po jsonb) returns uuid
language plpgsql volatile security definer set search_path = public as $$
declare pid uuid := nullif(p_po ->> 'id', '')::uuid; po purchases; sp suppliers; v_items jsonb := '[]'::jsonb; it jsonb; r record; seq int;
begin
  perform _require_member(p_store);
  if pid is not null then
    select * into po from purchases where id = pid and store_id = p_store for update;
    if not found then raise exception '找不到這張進貨單'; end if;
    if po.status <> 'draft' then raise exception '已下單的進貨單不能再修改品項'; end if;
  end if;
  select * into sp from suppliers where id = nullif(p_po ->> 'supplierId', '')::uuid and store_id = p_store;
  if not found then raise exception '請選擇供應商'; end if;
  for it in select * from jsonb_array_elements(coalesce(p_po -> 'items', '[]'::jsonb)) loop
    select p.id as product_id, p.name, v.id as variant_id, v.sku, _option_text(p.options, v.options) as option_text into r
    from variants v join products p on p.id = v.product_id where v.id = nullif(it ->> 'variantId', '')::uuid and v.store_id = p_store;
    if not found then raise exception '有品項找不到對應的商品規格'; end if;
    if coalesce((it ->> 'qty')::numeric, 0) < 1 then raise exception '「%」數量要大於 0', r.name; end if;
    if coalesce((it ->> 'cost')::numeric, 0) < 0 then raise exception '「%」進價不能是負數', r.name; end if;
    if v_items @> jsonb_build_array(jsonb_build_object('variantId', r.variant_id)) then raise exception '同一個規格不要重複列，請合併數量'; end if;
    v_items := v_items || jsonb_build_object('productId', r.product_id, 'variantId', r.variant_id, 'name', r.name, 'optionText', r.option_text,
      'sku', r.sku, 'qty', floor((it ->> 'qty')::numeric)::int, 'cost', round((it ->> 'cost')::numeric)::int, 'received', 0);
  end loop;
  if jsonb_array_length(v_items) = 0 then raise exception '至少要有一個品項'; end if;
  if pid is null then
    update stores set po_seq = po_seq + 1 where id = p_store returning po_seq into seq;
    insert into purchases(store_id, number, supplier_id, supplier_name, status, expected_at, note, items, history)
    values (p_store, 'PO' || (240000 + seq), sp.id, sp.name, 'draft', nullif(p_po ->> 'expectedAt', '')::date, trim(coalesce(p_po ->> 'note', '')), v_items,
            jsonb_build_array(jsonb_build_object('status', 'draft', 'at', now())))
    returning id into pid;
  else
    update purchases set supplier_id = sp.id, supplier_name = sp.name, expected_at = nullif(p_po ->> 'expectedAt', '')::date,
      note = trim(coalesce(p_po ->> 'note', '')), items = v_items where id = pid;
  end if;
  return pid;
end $$;

create or replace function admin_place_purchase(p_store uuid, p_id uuid) returns void
language plpgsql volatile security definer set search_path = public as $$
begin
  perform _require_member(p_store);
  update purchases set status = 'ordered', ordered_at = now(), history = history || jsonb_build_array(jsonb_build_object('status', 'ordered', 'at', now()))
  where id = p_id and store_id = p_store and status = 'draft';
  if not found then raise exception '只有草稿可以送出'; end if;
end $$;

-- 入庫：p_qtys = {variantId: 這次收到的數量}；用移動平均更新成本
create or replace function admin_receive_purchase(p_store uuid, p_id uuid, p_qtys jsonb, p_note text default '') returns void
language plpgsql volatile security definer set search_path = public as $$
declare po purchases; it jsonb; n int; new_items jsonb := '[]'::jsonb; any_in boolean := false; done boolean := true;
  cur_stock int; cur_cost int; parts text[] := '{}';
begin
  perform _require_member(p_store);
  select * into po from purchases where id = p_id and store_id = p_store for update;
  if not found or po.status not in ('ordered', 'partial') then raise exception '這張進貨單現在不能入庫'; end if;
  for it in select * from jsonb_array_elements(po.items) loop
    n := coalesce(floor((p_qtys ->> (it ->> 'variantId'))::numeric)::int, 0);
    if n < 0 then raise exception '「%」數量不能是負數', it ->> 'name'; end if;
    if n > (it ->> 'qty')::int - (it ->> 'received')::int then
      raise exception '%', format('「%s%s」最多還能收 %s', it ->> 'name', case when it ->> 'optionText' <> '' then '／' || (it ->> 'optionText') else '' end,
        (it ->> 'qty')::int - (it ->> 'received')::int);
    end if;
    if n > 0 then
      select stock, cost into cur_stock, cur_cost from variants where id = (it ->> 'variantId')::uuid and store_id = p_store for update;
      if not found then raise exception '「%」的商品規格已被刪除，無法入庫', it ->> 'name'; end if;
      update variants set
        cost = case when greatest(cur_stock, 0) + n > 0 then round((greatest(cur_stock, 0) * cur_cost + n * (it ->> 'cost')::int)::numeric / (greatest(cur_stock, 0) + n))::int else (it ->> 'cost')::int end,
        stock = stock + n
      where id = (it ->> 'variantId')::uuid;
      perform _log_move(p_store, (it ->> 'variantId')::uuid, n, 'purchase', po.number, po.supplier_name || '，進價 ' || _money((it ->> 'cost')::int));
      it := jsonb_set(it, '{received}', to_jsonb((it ->> 'received')::int + n));
      any_in := true;
      parts := parts || ((it ->> 'name') || case when it ->> 'optionText' <> '' then '／' || (it ->> 'optionText') else '' end || ' ×' || n);
    end if;
    if (it ->> 'received')::int < (it ->> 'qty')::int then done := false; end if;
    new_items := new_items || it;
  end loop;
  if not any_in then raise exception '請填這次收到的數量'; end if;
  update purchases set items = new_items, status = case when done then 'received' else 'partial' end,
    received_at = case when done then now() else received_at end,
    history = history || jsonb_build_array(jsonb_build_object('status', case when done then 'received' else 'partial' end, 'at', now(),
      'note', array_to_string(parts, '、') || case when coalesce(trim(p_note), '') <> '' then '（' || trim(p_note) || '）' else '' end))
  where id = po.id;
end $$;

-- 取消：草稿、已下單直接取消；部分入庫則是「剩下的不收了」
create or replace function admin_cancel_purchase(p_store uuid, p_id uuid, p_note text default '') returns void
language plpgsql volatile security definer set search_path = public as $$
declare po purchases;
begin
  perform _require_member(p_store);
  select * into po from purchases where id = p_id and store_id = p_store for update;
  if not found or po.status not in ('draft', 'ordered', 'partial') then raise exception '這張進貨單不能取消'; end if;
  if po.status = 'partial' then
    update purchases set status = 'received', received_at = now(),
      items = (select coalesce(jsonb_agg(jsonb_set(i, '{qty}', i -> 'received')), '[]'::jsonb) from jsonb_array_elements(po.items) i where (i ->> 'received')::int > 0),
      history = history || jsonb_build_array(jsonb_build_object('status', 'received', 'at', now(), 'note', '剩下的數量不再進貨' || case when coalesce(p_note, '') <> '' then '（' || p_note || '）' else '' end))
    where id = po.id;
  else
    update purchases set status = 'cancelled', history = history || jsonb_build_array(jsonb_build_object('status', 'cancelled', 'at', now(), 'note', coalesce(p_note, '')))
    where id = po.id;
  end if;
end $$;

create or replace function admin_delete_purchase(p_store uuid, p_id uuid) returns void
language plpgsql volatile security definer set search_path = public as $$
begin
  perform _require_member(p_store);
  delete from purchases where id = p_id and store_id = p_store and status = 'draft';
  if not found then raise exception '只有草稿可以刪除'; end if;
end $$;

-- =========================================================
-- 設定用（只能在 SQL Editor 執行）
-- =========================================================

-- 把某個已註冊的帳號設成商店的店主
-- 用法：select setup_add_owner('demo', '你註冊用的email');
create or replace function setup_add_owner(p_slug text, p_email text) returns text
language plpgsql volatile security definer set search_path = public as $$
declare uid uuid; sid uuid;
begin
  select id into sid from stores where slug = p_slug;
  if sid is null then raise exception '找不到商店 %', p_slug; end if;
  select id into uid from auth.users where lower(email) = lower(trim(p_email));
  if uid is null then raise exception '找不到帳號 %，請先到網站後台按「建立帳號」註冊', p_email; end if;
  insert into store_members(store_id, user_id, role) values (sid, uid, 'owner') on conflict do nothing;
  return '完成：' || p_email || ' 已經是商店「' || p_slug || '」的店主';
end $$;

-- 建立範例商店「晨霧選物」（已經存在就跳過）
create or replace function setup_demo_store() returns text
language plpgsql volatile security definer set search_path = public as $$
declare sid uuid; c_home uuid; c_wear uuid; c_scent uuid; pid uuid;
begin
  if exists (select 1 from stores where slug = 'demo') then return '範例商店已經存在，沒有變更'; end if;
  insert into stores(slug, settings) values ('demo', jsonb_build_object(
    'name', '晨霧選物', 'tagline', '日常裡好用、耐看的小東西', 'email', 'hello@example.com', 'phone', '04-1234-5678',
    'freeShippingThreshold', 1200, 'lowStockAlert', 3,
    'shippingMethods', jsonb_build_array(
      jsonb_build_object('id', 'cvs711', 'name', '7-11 取貨', 'type', 'cvs', 'fee', 60, 'enabled', true),
      jsonb_build_object('id', 'cvsfami', 'name', '全家取貨', 'type', 'cvs', 'fee', 60, 'enabled', true),
      jsonb_build_object('id', 'home', 'name', '宅配到府', 'type', 'home', 'fee', 100, 'enabled', true)),
    'paymentMethods', jsonb_build_array(
      jsonb_build_object('id', 'transfer', 'name', '銀行轉帳（人工對帳）', 'enabled', true, 'integrated', false, 'instruction', '下單後請於 3 天內匯款，商家確認後出貨。'),
      jsonb_build_object('id', 'cod', 'name', '取貨付款', 'enabled', true, 'integrated', false, 'instruction', '取貨時付款即可。'),
      jsonb_build_object('id', 'card', 'name', '信用卡', 'enabled', false, 'integrated', false, 'instruction', '尚未串接金流。'))))
  returning id into sid;

  insert into categories(store_id, name, sort) values (sid, '生活器物', 1) returning id into c_home;
  insert into categories(store_id, name, sort) values (sid, '服飾配件', 2) returning id into c_wear;
  insert into categories(store_id, name, sort) values (sid, '香氛', 3) returning id into c_scent;

  insert into products(store_id, name, description, status, color, category_ids, options) values (sid, '手捏陶杯',
    '每一只都是手捏成形，杯緣帶著些微不規則的弧度。容量約 250ml，可放洗碗機。', 'active', '#b7a38b', array[c_home],
    '[{"name":"釉色","values":["霧白","灰藍","松綠"]}]') returning id into pid;
  insert into variants(product_id, store_id, sku, options, price, stock, cost, sort) values
    (pid, sid, 'CUP-01', '{"釉色":"霧白"}', 680, 12, 280, 1), (pid, sid, 'CUP-02', '{"釉色":"灰藍"}', 680, 3, 280, 2), (pid, sid, 'CUP-03', '{"釉色":"松綠"}', 680, 0, 280, 3);

  insert into products(store_id, name, description, status, color, category_ids, options) values (sid, '有機棉素T',
    '240g 厚磅有機棉，微寬版型，洗後不易變形。', 'active', '#8a9a8e', array[c_wear],
    '[{"name":"顏色","values":["白","黑"]},{"name":"尺寸","values":["S","M","L"]}]') returning id into pid;
  insert into variants(product_id, store_id, sku, options, price, stock, cost, sort) values
    (pid, sid, 'TEE-01', '{"顏色":"白","尺寸":"S"}', 890, 8, 360, 1), (pid, sid, 'TEE-02', '{"顏色":"白","尺寸":"M"}', 890, 15, 360, 2),
    (pid, sid, 'TEE-03', '{"顏色":"白","尺寸":"L"}', 890, 10, 360, 3), (pid, sid, 'TEE-04', '{"顏色":"黑","尺寸":"S"}', 890, 4, 360, 4),
    (pid, sid, 'TEE-05', '{"顏色":"黑","尺寸":"M"}', 890, 12, 360, 5), (pid, sid, 'TEE-06', '{"顏色":"黑","尺寸":"L"}', 890, 9, 360, 6);

  insert into products(store_id, name, description, status, color, category_ids, options) values (sid, '亞麻工作圍裙',
    '水洗亞麻，雙口袋設計，頸帶可調整長度。', 'active', '#6d7b86', array[c_wear, c_home],
    '[{"name":"顏色","values":["炭灰","米白"]}]') returning id into pid;
  insert into variants(product_id, store_id, sku, options, price, stock, cost, sort) values
    (pid, sid, 'APRON-01', '{"顏色":"炭灰"}', 1280, 6, 520, 1), (pid, sid, 'APRON-02', '{"顏色":"米白"}', 1280, 2, 520, 2);

  insert into products(store_id, name, description, status, color, category_ids, options) values (sid, '雪松大豆蠟燭',
    '天然大豆蠟，雪松與岩蘭草調，燃燒時間約 40 小時。', 'active', '#a58a6f', array[c_scent], '[]') returning id into pid;
  insert into variants(product_id, store_id, sku, options, price, stock, cost, sort) values (pid, sid, 'CANDLE-01', '{}', 750, 25, 300, 1);

  insert into products(store_id, name, description, status, color, category_ids, options) values (sid, '帆布托特包',
    '12 安士厚帆布，內附小口袋，可裝 A4 文件與筆電。', 'active', '#4f6b66', array[c_wear],
    '[{"name":"顏色","values":["原色","墨綠"]}]') returning id into pid;
  insert into variants(product_id, store_id, sku, options, price, stock, cost, sort) values
    (pid, sid, 'TOTE-01', '{"顏色":"原色"}', 590, 18, 230, 1), (pid, sid, 'TOTE-02', '{"顏色":"墨綠"}', 590, 7, 230, 2);

  insert into products(store_id, name, description, status, color, category_ids, options) values (sid, '胡桃木餐具組',
    '湯匙、叉子、筷子三件組，附收納布套。（草稿，尚未上架）', 'draft', '#7a5a43', array[c_home], '[]') returning id into pid;
  insert into variants(product_id, store_id, sku, options, price, stock, cost, sort) values (pid, sid, 'CUTLERY-01', '{}', 480, 30, 190, 1);

  -- 期初庫存紀錄
  insert into stock_movements(store_id, product_id, variant_id, name, option_text, sku, delta, after, type, note)
  select sid, p.id, v.id, p.name, _option_text(p.options, v.options), v.sku, v.stock, v.stock, 'initial', '期初庫存'
  from variants v join products p on p.id = v.product_id where v.store_id = sid and v.stock > 0;

  insert into coupons(store_id, code, name, type, value, min_spend, per_customer) values (sid, 'WELCOME100', '新客折 100', 'amount', 100, 800, 1);
  insert into coupons(store_id, code, name, type, value, max_discount, min_spend, start_at, end_at, usage_limit, stackable)
    values (sid, 'AUTUMN85', '秋季 85 折', 'percent', 85, 300, 1000, _today() - 10, _today() + 20, 100, false);
  insert into promotions(store_id, name, tiers, start_at, end_at)
    values (sid, '秋季滿額折', '[{"min":1500,"off":150},{"min":3000,"off":400}]', _today() - 10, _today() + 20);
  return '已建立範例商店「晨霧選物」';
end $$;

-- ---------- 商品圖片：雲端儲存空間 ----------
-- 公開的圖片資料夾（任何人都能看圖），但只有這家店的管理者能上傳、刪除「自己商店資料夾」裡的圖
create or replace function is_store_member(p_store text) returns boolean
language plpgsql stable security definer set search_path = public as $$
begin
  return exists (select 1 from store_members where user_id = auth.uid() and store_id::text = p_store);
end $$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-images', 'product-images', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = true, file_size_limit = 2097152, allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

drop policy if exists "product images: members insert" on storage.objects;
create policy "product images: members insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'product-images' and public.is_store_member((storage.foldername(name))[1]));
drop policy if exists "product images: members select" on storage.objects;
create policy "product images: members select" on storage.objects for select to authenticated
  using (bucket_id = 'product-images' and public.is_store_member((storage.foldername(name))[1]));
drop policy if exists "product images: members delete" on storage.objects;
create policy "product images: members delete" on storage.objects for delete to authenticated
  using (bucket_id = 'product-images' and public.is_store_member((storage.foldername(name))[1]));

-- ---------- 權限：只開放該開的函式 ----------
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function shop_catalog(text), shop_quote(text, jsonb, text, text, text), shop_place_order(text, jsonb),
  shop_order_lookup(text, text, text), shop_cancel_order(text, text, text) to anon, authenticated;
grant execute on function admin_my_stores(), admin_bootstrap(uuid), admin_save_settings(uuid, jsonb),
  admin_save_category(uuid, uuid, text), admin_delete_category(uuid, uuid),
  admin_save_product(uuid, jsonb), admin_delete_product(uuid, uuid),
  admin_set_order_status(uuid, uuid, text, text, text), admin_set_order_note(uuid, uuid, text),
  admin_save_coupon(uuid, jsonb), admin_delete_coupon(uuid, uuid),
  admin_save_promotion(uuid, jsonb), admin_delete_promotion(uuid, uuid),
  admin_save_tiers(uuid, jsonb), admin_adjust_stock(uuid, uuid, text, int, text, text),
  admin_save_supplier(uuid, jsonb), admin_delete_supplier(uuid, uuid),
  admin_save_purchase(uuid, jsonb), admin_place_purchase(uuid, uuid), admin_receive_purchase(uuid, uuid, jsonb, text),
  admin_cancel_purchase(uuid, uuid, text), admin_delete_purchase(uuid, uuid),
  shop_member_me(text), shop_member_join(text, text, text), shop_member_update(text, text, text),
  shop_my_orders(text), shop_member_cancel(text, text), is_store_member(text) to authenticated;

select setup_demo_store();

-- 第二階段的範例資料：範例商店的會員等級、供應商（已經有就跳過）
do $$
declare sid uuid;
begin
  select id into sid from stores where slug = 'demo';
  if sid is null then return; end if;
  if not coalesce((select (member_tiers ->> 'enabled')::boolean from stores where id = sid), false)
     and jsonb_array_length((select member_tiers -> 'tiers' from stores where id = sid)) <= 1 then
    update stores set member_tiers = '{"enabled":true,"period":"all","tiers":[
      {"id":"tier_base","name":"一般會員","minSpend":0,"percent":100,"freeShip":false},
      {"id":"tier_silver","name":"銀卡","minSpend":3000,"percent":95,"freeShip":false},
      {"id":"tier_gold","name":"金卡","minSpend":10000,"percent":90,"freeShip":true}]}'::jsonb where id = sid;
  end if;
  if not exists (select 1 from suppliers where store_id = sid) then
    insert into suppliers(store_id, name, contact, phone, email, address, note) values
      (sid, '土感陶作工房', '吳師傅', '049-2345-678', 'clay@example.com', '南投縣水里鄉', '手作陶器，交期約 2 週'),
      (sid, '棉麻織造社', '李小姐', '02-2765-4321', 'textile@example.com', '新北市三重區', '服飾、圍裙、帆布包'),
      (sid, '森調香氛工作室', '周先生', '0933-222-111', 'scent@example.com', '台中市南屯區', '');
  end if;
end $$;

select '完成：資料庫是 v0.8 版' as result;
