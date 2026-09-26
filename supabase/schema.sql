-- =========================================================
-- 開店平台 · 資料庫設定（v0.16：…＋商品排序、排程上下架、批次匯入、商品評價）
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
--   4. 平台函式（platform_*）只有平台管理者能用。
--   5. 設定用函式（setup_*）只能在 SQL Editor 執行。
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

-- ---------- v0.9：多商家、年費方案、平台管理 ----------
-- plan：trial 試用／paid 已繳年費／free 平台自己的免費商店
-- 營業中 = 沒被停用，而且（free 或 active_until 還沒過）
alter table stores add column if not exists plan text not null default 'trial';
alter table stores add column if not exists active_until date;
alter table stores add column if not exists suspended boolean not null default false;
alter table stores add column if not exists suspend_reason text not null default '';
alter table stores add column if not exists platform_note text not null default '';
alter table stores add column if not exists created_by uuid references auth.users(id) on delete set null;
-- 從舊版升級：原本就存在的商店（範例商店）設成免費，不會因為沒有到期日而關店
update stores set plan = 'free' where plan = 'trial' and active_until is null;
alter table stores drop constraint if exists stores_plan_check;
alter table stores add constraint stores_plan_check check (plan in ('trial', 'paid', 'free'));

create table if not exists platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
create table if not exists platform_settings (
  id int primary key default 1 check (id = 1),
  settings jsonb not null default '{}'::jsonb
);
insert into platform_settings(id, settings) values (1, '{"platformName":"開店平台","annualFee":12000,"trialDays":14,"signupOpen":true,"maxStoresPerUser":3,"contactEmail":"","contactLine":""}'::jsonb)
  on conflict (id) do nothing;
-- 年費與方案異動紀錄：收款、延長、改方案、停用、恢復
create table if not exists platform_billing_log (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  kind text not null check (kind in ('payment', 'extend', 'plan', 'suspend', 'resume', 'create')),
  amount int not null default 0,
  from_date date,
  to_date date,
  note text not null default '',
  by_email text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists platform_billing_log_idx on platform_billing_log(created_at desc);

-- ---------- v0.10：頻率限制（防灌單、防猜訂單） ----------
create table if not exists rate_events (
  bucket text not null,
  key text not null,
  at timestamptz not null default now()
);
create index if not exists rate_events_idx on rate_events(bucket, key, at);
create index if not exists orders_phone_idx on orders(store_id, (contact ->> 'phone'), status);

-- ---------- v0.13：員工帳號與權限 ----------
-- 店主（owner）什麼都能做；員工（staff）只能做 perms 裡勾選的事
-- orders 訂單、customers 會員、products 商品、inventory 進銷存、marketing 行銷、reports 報表、settings 設定
alter table store_members add column if not exists perms text[] not null default '{}';
create table if not exists store_invites (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  email text not null,
  perms text[] not null default '{}',
  token uuid not null unique default gen_random_uuid(),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days',
  accepted_at timestamptz
);
create index if not exists store_invites_store_idx on store_invites(store_id);
-- 誰做的：庫存異動記下操作者
alter table stock_movements add column if not exists by_email text not null default '';

-- ---------- v0.16：商品評價（買過的會員才能評；一筆訂單的一個商品評一次，可以修改） ----------
create table if not exists reviews (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade,
  order_id uuid not null references orders(id) on delete cascade,
  customer_id uuid references customers(id) on delete set null,
  display_name text not null default '',
  rating int not null check (rating between 1 and 5),
  content text not null default '',
  status text not null default 'visible' check (status in ('visible', 'pending', 'hidden')),
  reply text not null default '',
  reply_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (order_id, product_id)
);
create index if not exists reviews_product_idx on reviews(product_id, status, created_at desc);
create index if not exists reviews_store_idx on reviews(store_id, status, created_at desc);

-- ---------- v0.15：商品排序、排程上下架 ----------
alter table products add column if not exists sort int not null default 0;          -- 0 = 沒排過（新商品排最前面）
alter table products add column if not exists publish_at timestamptz;              -- 什麼時候開始上架（空白 = 立刻）
alter table products add column if not exists unpublish_at timestamptz;            -- 什麼時候自動下架（空白 = 不下架）

-- ---------- v0.14：退貨／退款紀錄 ----------
create table if not exists order_refunds (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  order_id uuid not null references orders(id) on delete cascade,
  items jsonb not null default '[]'::jsonb,     -- [{variantId, name, optionText, sku, qty, cost}]
  amount int not null check (amount >= 0),
  restock boolean not null default false,
  reason text not null default '',
  by_email text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists order_refunds_order_idx on order_refunds(order_id);
create index if not exists order_refunds_store_idx on order_refunds(store_id, created_at);

-- ---------- v0.11：報表用 ----------
-- 進貨入庫時記下進價，報表才算得出「進貨花費」；舊資料從備註裡的「進價 NT$…」補上
alter table stock_movements add column if not exists unit_cost int;
update stock_movements set unit_cost = replace(substring(note from '進價 NT\$([0-9,]+)'), ',', '')::int
  where type = 'purchase' and unit_cost is null and note ~ '進價 NT\$[0-9,]+';

-- 全部上鎖：開啟 RLS、不給任何直接存取
do $$
declare t text;
begin
  foreach t in array array['stores','store_members','categories','products','variants','customers','orders','coupons','promotions','stock_movements','suppliers','purchases','platform_admins','platform_settings','platform_billing_log','rate_events','store_invites','order_refunds','reviews'] loop
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

-- 商店狀態：suspended 停用／free 免費／trial 試用中／paid 已繳費／expired 已到期
create or replace function _store_status(s stores) returns text language sql stable as $$
  select case
    when s.suspended then 'suspended'
    when s.plan = 'free' then 'free'
    when s.active_until is null or s.active_until < _today() then 'expired'
    else s.plan end
$$;
create or replace function _store_open(s stores) returns boolean language sql stable as $$
  select _store_status(s) in ('free', 'trial', 'paid')
$$;
create or replace function _billing_json(s stores) returns jsonb language sql stable as $$
  select jsonb_build_object('plan', s.plan, 'status', _store_status(s), 'open', _store_open(s),
    'activeUntil', s.active_until, 'daysLeft', case when s.active_until is null then null else s.active_until - _today() end,
    'suspended', s.suspended, 'suspendReason', s.suspend_reason)
$$;
create or replace function _platform_settings() returns jsonb language sql stable as $$
  select settings from platform_settings where id = 1
$$;
create or replace function _is_platform_admin() returns boolean language sql stable as $$
  select auth.uid() is not null and exists (select 1 from platform_admins where user_id = auth.uid())
$$;
create or replace function _require_platform() returns void language plpgsql stable as $$
begin
  if auth.uid() is null then raise exception '請先登入'; end if;
  if not _is_platform_admin() then raise exception '你沒有平台管理權限'; end if;
end $$;
create or replace function _closed_msg(s stores) returns text language sql stable as $$
  select case when _store_status(s) = 'suspended' then '這家商店目前暫停營業' else '這家商店目前休息中' end
$$;

-- 呼叫者的 IP（Supabase 會帶 x-forwarded-for；拿不到就是 null）
create or replace function _client_ip() returns text language plpgsql stable as $$
declare h json;
begin
  begin h := current_setting('request.headers', true)::json; exception when others then return null; end;
  if h is null then return null; end if;
  return nullif(trim(split_part(coalesce(h ->> 'cf-connecting-ip', h ->> 'x-real-ip', h ->> 'x-forwarded-for', ''), ',', 1)), '');
end $$;

-- 頻率限制：同一個 key 在 p_window 內最多 p_max 次，超過就擋下
-- （只有整個動作成功才會記一次；失敗的動作會連同這筆紀錄一起復原）
create or replace function _rate_hit(p_bucket text, p_key text, p_max int, p_window interval, p_msg text default null) returns void
language plpgsql volatile as $$
declare n int;
begin
  if p_key is null or p_key = '' then return; end if;
  delete from rate_events where bucket = p_bucket and key = p_key and at < now() - p_window;
  select count(*) into n from rate_events where bucket = p_bucket and key = p_key;
  if n >= p_max then raise exception '%', coalesce(p_msg, '操作太頻繁，請稍後再試'); end if;
  insert into rate_events(bucket, key) values (p_bucket, p_key);
end $$;

-- 超過設定天數還沒付款的「銀行轉帳」訂單自動取消、庫存加回（商家在設定頁開啟，0 = 不自動取消）
create or replace function _expire_unpaid(p_store uuid) returns int language plpgsql volatile as $$
declare days int; o orders; it jsonb; n int := 0;
begin
  select coalesce((settings ->> 'autoCancelDays')::int, 0) into days from stores where id = p_store;
  if days is null or days <= 0 then return 0; end if;
  for o in select * from orders where store_id = p_store and status = 'pending_payment' and payment ->> 'methodId' = 'transfer'
             and created_at < now() - make_interval(days => days) for update loop
    for it in select * from jsonb_array_elements(o.items) loop
      update variants set stock = stock + (it ->> 'qty')::int where id = (it ->> 'variantId')::uuid and store_id = p_store;
      if found then perform _log_move(p_store, (it ->> 'variantId')::uuid, (it ->> 'qty')::int, 'cancel', o.number, '逾期未付款自動取消，庫存加回'); end if;
    end loop;
    update orders set status = 'cancelled', history = history || jsonb_build_array(jsonb_build_object('status', 'cancelled', 'at', now(),
      'note', '超過 ' || days || ' 天未付款，系統自動取消')) where id = o.id;
    n := n + 1;
  end loop;
  return n;
end $$;

-- 後台權限檢查：登入者必須是這家店的成員
create or replace function _require_member(p_store uuid) returns void language plpgsql stable as $$
begin
  if auth.uid() is null then raise exception '請先登入'; end if;
  if not exists (select 1 from store_members where store_id = p_store and user_id = auth.uid()) then
    raise exception '你沒有這家商店的管理權限';
  end if;
end $$;

-- 員工權限
create or replace function _perm_label(p text) returns text language sql immutable as $$
  select case p when 'orders' then '訂單' when 'customers' then '會員' when 'products' then '商品' when 'inventory' then '進銷存'
    when 'marketing' then '行銷' when 'reports' then '報表' when 'settings' then '設定' else p end
$$;
create or replace function _member_row(p_store uuid) returns store_members language sql stable as $$
  select * from store_members where store_id = p_store and user_id = auth.uid()
$$;
create or replace function _has_perm(p_store uuid, p_perm text) returns boolean language sql stable as $$
  select coalesce((select role = 'owner' or p_perm = any(perms) from store_members where store_id = p_store and user_id = auth.uid()), false)
$$;
-- 看得到成本：店主，或有「進銷存」或「報表」權限的員工
create or replace function _can_see_cost(p_store uuid) returns boolean language sql stable as $$
  select _has_perm(p_store, 'inventory') or _has_perm(p_store, 'reports')
$$;
create or replace function _require_perm(p_store uuid, p_perm text) returns void language plpgsql stable as $$
begin
  perform _require_member(p_store);
  if not _has_perm(p_store, p_perm) then raise exception '你沒有「%」的權限，請找店主開通', _perm_label(p_perm); end if;
end $$;
create or replace function _require_owner(p_store uuid) returns void language plpgsql stable as $$
begin
  perform _require_member(p_store);
  if (_member_row(p_store)).role <> 'owner' then raise exception '只有店主可以管理員工'; end if;
end $$;
create or replace function _my_email() returns text language sql stable as $$
  select coalesce((select email from auth.users where id = auth.uid()), '')
$$;

create or replace function _log_move(p_store uuid, p_variant uuid, p_delta int, p_type text, p_ref text, p_note text)
returns void language plpgsql as $$
begin
  insert into stock_movements(store_id, product_id, variant_id, name, option_text, sku, delta, after, type, ref, note, by_email)
  select p_store, p.id, v.id, p.name, _option_text(p.options, v.options), v.sku, p_delta, v.stock, p_type, coalesce(p_ref, ''), coalesce(p_note, ''),
    coalesce((select email from auth.users where id = auth.uid()), '')
  from variants v join products p on p.id = v.product_id where v.id = p_variant;
end $$;

-- ---------- JSON 形狀（跟網站用的一樣） ----------
-- 前台看得到：上架中，而且在排程時間內
create or replace function _product_live(p products) returns boolean language sql stable as $$
  select p.status = 'active' and (p.publish_at is null or p.publish_at <= now()) and (p.unpublish_at is null or p.unpublish_at > now())
$$;

create or replace function _product_json(p products, with_cost boolean) returns jsonb language sql stable as $$
  select jsonb_build_object(
    'id', p.id, 'name', p.name, 'description', p.description, 'status', p.status, 'color', p.color,
    'categoryIds', to_jsonb(p.category_ids), 'options', p.options, 'images', p.images,
    'createdAt', p.created_at, 'sort', p.sort, 'publishAt', p.publish_at, 'unpublishAt', p.unpublish_at, 'live', _product_live(p),
    'ratingAvg', (select round(avg(r.rating)::numeric, 1) from reviews r where r.product_id = p.id and r.status = 'visible'),
    'ratingCount', (select count(*) from reviews r where r.product_id = p.id and r.status = 'visible'),
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
    'status', o.status, 'note', o.note, 'history', o.history, 'createdAt', o.created_at,
    'refundTotal', coalesce((select sum(r.amount) from order_refunds r where r.order_id = o.id), 0)::int,
    'refunds', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'items', r.items, 'amount', r.amount, 'restock', r.restock,
      'reason', r.reason, 'by', r.by_email, 'at', r.created_at) order by r.created_at) from order_refunds r where r.order_id = o.id), '[]'::jsonb))
$$;

-- 給沒有成本權限的人看的訂單：拿掉每個品項的成本
create or replace function _order_json_for(o orders, cost_ok boolean) returns jsonb language sql stable as $$
  select case when cost_ok then _order_json(o)
    else jsonb_set(_order_json(o), '{items}', (select coalesce(jsonb_agg(i - 'cost'), '[]'::jsonb) from jsonb_array_elements(o.items) i)) end
$$;

-- 給顧客看的訂單：拿掉商家備註、內部編號、成本
create or replace function _order_customer_json(o orders) returns jsonb language sql stable as $$
  select _order_json(o) - 'note' - 'customerId' - 'id' - 'refunds'
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
    'theme', coalesce(s.settings -> 'theme', '{}'::jsonb),
    'reviews', jsonb_build_object('enabled', coalesce((s.settings #>> '{reviews,enabled}')::boolean, true)),
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
  select coalesce(sum(total - coalesce((select sum(r.amount) from order_refunds r where r.order_id = orders.id), 0)), 0) into spent from orders
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
    join products p on p.id = v.product_id and _product_live(p)
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
  if not _store_open(s) then
    -- 關店中：只回商店名稱與聯絡方式，前台顯示「暫停營業」
    return jsonb_build_object('store', jsonb_build_object('id', s.id, 'slug', s.slug), 'closed', true, 'closedMessage', _closed_msg(s),
      'settings', _public_settings(s), 'categories', '[]'::jsonb, 'products', '[]'::jsonb, 'promotions', '[]'::jsonb,
      'memberTiers', jsonb_build_object('enabled', false, 'period', 'all', 'tiers', '[]'::jsonb));
  end if;
  return jsonb_build_object(
    'store', jsonb_build_object('id', s.id, 'slug', s.slug),
    'closed', false,
    'settings', _public_settings(s),
    'categories', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name) order by c.sort, c.created_at) from categories c where c.store_id = s.id), '[]'::jsonb),
    'products', coalesce((select jsonb_agg(_product_json(p, false) order by p.sort, p.created_at desc) from products p where p.store_id = s.id and _product_live(p)), '[]'::jsonb),
    'promotions', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'tiers', p.tiers)) from promotions p where p.store_id = s.id and _period_state(p.enabled, p.start_at, p.end_at) = 'active'), '[]'::jsonb),
    'memberTiers', jsonb_build_object('enabled', coalesce((s.member_tiers ->> 'enabled')::boolean, false), 'period', s.member_tiers ->> 'period', 'tiers', s.member_tiers -> 'tiers'));
end $$;

-- 購物車／結帳試算
create or replace function shop_quote(p_slug text, p_items jsonb, p_ship text default null, p_coupon text default null, p_phone text default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare s stores; q jsonb;
begin
  s := _store_by_slug(p_slug);
  if not _store_open(s) then raise exception '%', _closed_msg(s) || '，暫時無法下單'; end if;
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
  if not _store_open(s) then raise exception '%', _closed_msg(s) || '，暫時無法下單'; end if;
  -- 防灌單：隱藏欄位被填 = 機器人；同一支手機、同一個 IP、整家店都有上限
  if coalesce(p_order ->> 'hp', '') <> '' then raise exception '下單失敗，請重新整理頁面再試一次'; end if;
  perform _expire_unpaid(s.id);
  if v_phone ~ '^09\d{8}$' then
    if (select count(*) from orders where store_id = s.id and contact ->> 'phone' = v_phone and status = 'pending_payment') >= 5 then
      raise exception '這支手機還有 5 筆訂單尚未付款，請先付款或取消舊訂單後再下單';
    end if;
    perform _rate_hit('order-phone', s.id || ':' || v_phone, 5, interval '10 minutes', '下單太頻繁，請 10 分鐘後再試');
    perform _rate_hit('order-phone-day', s.id || ':' || v_phone, 20, interval '1 day', '這支手機今天下單次數已達上限，請明天再試或聯絡客服');
  end if;
  perform _rate_hit('order-ip', _client_ip(), 20, interval '10 minutes', '下單太頻繁，請稍後再試');
  perform _rate_hit('order-store', s.id::text, 300, interval '1 hour', '目前訂單太多，請稍後再試');
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
-- 找不到時回傳 null（不丟錯誤），這樣查詢次數才會被記下來，防止有人一直猜手機號碼
create or replace function shop_order_lookup(p_slug text, p_number text, p_phone text) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare s stores; o orders;
begin
  s := _store_by_slug(p_slug);
  perform _rate_hit('lookup-ip', _client_ip(), 30, interval '10 minutes', '查詢太頻繁，請 10 分鐘後再試');
  perform _rate_hit('lookup-no', s.id || ':' || upper(trim(coalesce(p_number, ''))), 10, interval '10 minutes', '這筆訂單查詢太多次，請 10 分鐘後再試');
  select * into o from orders where store_id = s.id and upper(number) = upper(trim(p_number))
    and contact ->> 'phone' = regexp_replace(coalesce(p_phone, ''), '[\s-]', '', 'g');
  if not found then return null; end if;
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
  if not found then
    perform _rate_hit('lookup-no', s.id || ':' || upper(trim(coalesce(p_number, ''))), 10, interval '10 minutes', '這筆訂單查詢太多次，請 10 分鐘後再試');
    return null;
  end if;
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
  select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'slug', s.slug, 'name', s.settings ->> 'name', 'role', m.role, 'perms', to_jsonb(m.perms),
    'billing', _billing_json(s), 'createdAt', s.created_at) order by s.created_at), '[]'::jsonb)
  from store_members m join stores s on s.id = m.store_id where m.user_id = auth.uid()
$$;

-- 後台一次載入整家店的資料（小型商店適用；訂單取最近 1000 筆）
-- 訂單只載入「最近 120 天」和「還沒結案的」（最多 1500 筆）；更早的用 admin_search_orders 查
-- 會員的累積消費、各狀態訂單數由伺服器算全部訂單
create or replace function admin_bootstrap(p_store uuid) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare s stores; me store_members;
  c_orders boolean; c_customers boolean; c_inventory boolean; c_marketing boolean; c_cost boolean;
begin
  perform _require_member(p_store);
  perform _expire_unpaid(p_store);
  select * into s from stores where id = p_store;
  me := _member_row(p_store);
  -- 員工只拿得到有權限的資料
  c_orders := _has_perm(p_store, 'orders'); c_customers := _has_perm(p_store, 'customers');
  c_inventory := _has_perm(p_store, 'inventory'); c_marketing := _has_perm(p_store, 'marketing'); c_cost := _can_see_cost(p_store);
  return jsonb_build_object(
    'me', jsonb_build_object('role', me.role, 'perms', to_jsonb(me.perms), 'email', _my_email()),
    'reviewPending', (select count(*) from reviews where store_id = p_store and status = 'pending'),
    'store', jsonb_build_object('id', s.id, 'slug', s.slug, 'createdAt', s.created_at),
    'billing', _billing_json(s),
    'platform', (select jsonb_build_object('platformName', x ->> 'platformName', 'annualFee', (x ->> 'annualFee')::int,
        'contactEmail', x ->> 'contactEmail', 'contactLine', x ->> 'contactLine') from _platform_settings() x),
    'isPlatformAdmin', _is_platform_admin(),
    'settings', s.settings,
    'categories', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name) order by c.sort, c.created_at) from categories c where c.store_id = s.id), '[]'::jsonb),
    'products', coalesce((select jsonb_agg(_product_json(p, c_cost) order by p.sort, p.created_at desc) from products p where p.store_id = s.id), '[]'::jsonb),
    'customers', case when c_customers then coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'phone', c.phone, 'email', c.email,
        'createdAt', c.created_at, 'hasAccount', c.user_id is not null, 'registeredAt', c.registered_at)) from customers c where c.store_id = s.id), '[]'::jsonb) else '[]'::jsonb end,
    'memberTiers', s.member_tiers,
    'suppliers', case when c_inventory then coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name, 'contact', x.contact, 'phone', x.phone, 'email', x.email,
        'taxId', x.tax_id, 'address', x.address, 'note', x.note, 'createdAt', x.created_at) order by x.name) from suppliers x where x.store_id = s.id), '[]'::jsonb) else '[]'::jsonb end,
    'purchases', case when c_inventory then coalesce((select jsonb_agg(jsonb_build_object('id', po.id, 'number', po.number, 'supplierId', po.supplier_id, 'supplierName', po.supplier_name,
        'status', po.status, 'expectedAt', coalesce(po.expected_at::text, ''), 'note', po.note, 'items', po.items, 'history', po.history,
        'createdAt', po.created_at, 'orderedAt', po.ordered_at, 'receivedAt', po.received_at) order by po.created_at desc)
        from (select * from purchases where store_id = s.id order by created_at desc limit 500) po), '[]'::jsonb) else '[]'::jsonb end,
    'movements', case when c_inventory then coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'at', m.at, 'productId', m.product_id, 'variantId', m.variant_id,
        'name', m.name, 'optionText', m.option_text, 'sku', m.sku, 'delta', m.delta, 'after', m.after, 'type', m.type, 'ref', m.ref, 'note', m.note, 'by', m.by_email) order by m.at)
        from (select * from stock_movements where store_id = s.id order by at desc limit 1000) m), '[]'::jsonb) else '[]'::jsonb end,
    'orders', case when c_orders then coalesce((select jsonb_agg(_order_json_for(o, c_cost) order by o.created_at desc) from (select * from orders where store_id = s.id
        and (created_at >= now() - interval '120 days' or status in ('pending_payment', 'paid', 'shipped')) order by created_at desc limit 1500) o), '[]'::jsonb) else '[]'::jsonb end,
    'orderTotal', case when c_orders then (select count(*) from orders where store_id = s.id) else 0 end,
    'statusCounts', case when not c_orders then '{}'::jsonb else coalesce((select jsonb_object_agg(status, n) from (select status, count(*) n from orders where store_id = s.id group by status) x), '{}'::jsonb) end,
    'customerStats', case when not c_customers then '{}'::jsonb else coalesce((select jsonb_object_agg(x.customer_id, jsonb_build_object('n', x.n, 'spent', x.spent, 'last', x.last, 'tierSpent', x.tier_spent)) from (
        select customer_id, count(*) filter (where status <> 'cancelled') n, coalesce(sum(total - rf) filter (where status <> 'cancelled'), 0) spent,
          max(created_at) filter (where status <> 'cancelled') last,
          coalesce(sum(total - rf) filter (where status in ('paid', 'shipped', 'completed')
            and (s.member_tiers ->> 'period' is distinct from '12m' or created_at >= now() - interval '365 days')), 0) tier_spent
        from (select o2.*, coalesce((select sum(r.amount) from order_refunds r where r.order_id = o2.id), 0) rf from orders o2
              where o2.store_id = s.id and o2.customer_id is not null) oo group by customer_id) x), '{}'::jsonb) end,
    'coupons', case when not c_marketing then '[]'::jsonb else coalesce((select jsonb_agg(_coupon_json(c) order by c.created_at desc) from coupons c where c.store_id = s.id), '[]'::jsonb) end,
    'promotions', case when not c_marketing then '[]'::jsonb else coalesce((select jsonb_agg(_promotion_json(p) order by p.created_at desc) from promotions p where p.store_id = s.id), '[]'::jsonb) end,
    'loadedAt', now());
end $$;

-- 訂單搜尋（分頁）：狀態、關鍵字（編號、姓名、手機）、日期（台灣時間）
create or replace function admin_search_orders(p_store uuid, p_status text default '', p_q text default '', p_from date default null, p_to date default null,
  p_offset int default 0, p_limit int default 50) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_q text := lower(trim(coalesce(p_q, ''))); v_total int; v_rows jsonb;
begin
  perform _require_perm(p_store, 'orders');
  p_limit := least(greatest(coalesce(p_limit, 50), 0), 20000);
  p_offset := greatest(coalesce(p_offset, 0), 0);
  with f as (select * from orders o where o.store_id = p_store
    and (coalesce(p_status, '') = '' or o.status = p_status)
    and (p_from is null or (o.created_at at time zone 'Asia/Taipei')::date >= p_from)
    and (p_to is null or (o.created_at at time zone 'Asia/Taipei')::date <= p_to)
    and (v_q = '' or lower(o.number) like '%' || v_q || '%' or lower(o.contact ->> 'name') like '%' || v_q || '%' or (o.contact ->> 'phone') like '%' || v_q || '%'))
  select (select count(*) from f),
    coalesce((select jsonb_agg(_order_json_for(x, _can_see_cost(p_store)) order by x.created_at desc) from (select * from f order by created_at desc offset p_offset limit p_limit) x), '[]'::jsonb)
  into v_total, v_rows;
  return jsonb_build_object('total', v_total, 'rows', v_rows);
end $$;

create or replace function admin_get_order(p_store uuid, p_id text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare o orders;
begin
  perform _require_perm(p_store, 'orders');
  select * into o from orders where store_id = p_store and (id::text = p_id or upper(number) = upper(p_id));
  if not found then return null; end if;
  return _order_json_for(o, _can_see_cost(p_store));
end $$;

create or replace function admin_customer_orders(p_store uuid, p_customer uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform _require_perm(p_store, 'customers');
  return coalesce((select jsonb_agg(_order_json_for(o, _can_see_cost(p_store)) order by o.created_at desc) from
    (select * from orders where store_id = p_store and customer_id = p_customer order by created_at desc limit 500) o), '[]'::jsonb);
end $$;

-- 佈景主題檢查：配色、主色、版型、文字長度、Logo 必須是這家店自己資料夾裡的圖
create or replace function _theme_problem(p_store uuid, t jsonb) returns text language plpgsql immutable as $$
begin
  if t is null or jsonb_typeof(t) = 'null' then return null; end if;
  if jsonb_typeof(t) <> 'object' then return '外觀設定格式不正確'; end if;
  if coalesce(t ->> 'preset', 'warm') not in ('warm', 'forest', 'ocean', 'rose', 'sun', 'mono') then return '配色不正確'; end if;
  if coalesce(t ->> 'accent', '') <> '' and (t ->> 'accent') !~ '^#[0-9a-fA-F]{6}$' then return '主色要是 #RRGGBB 格式'; end if;
  if coalesce(t ->> 'layout', 'grid') not in ('grid', 'banner', 'magazine') then return '首頁版型不正確'; end if;
  if coalesce(t ->> 'cols', '4') not in ('2', '3', '4') then return '每列商品數要是 2～4'; end if;
  if coalesce(t ->> 'ratio', 'square') not in ('square', 'portrait') then return '圖片比例不正確'; end if;
  if coalesce(t ->> 'font', 'sans') not in ('sans', 'serif') then return '字體不正確'; end if;
  if length(coalesce(t ->> 'notice', '')) > 80 then return '公告最多 80 個字'; end if;
  if length(coalesce(t ->> 'heroTitle', '')) > 40 then return '橫幅標題最多 40 個字'; end if;
  if length(coalesce(t ->> 'heroText', '')) > 120 then return '橫幅說明最多 120 個字'; end if;
  if t -> 'logo' is not null and jsonb_typeof(t -> 'logo') <> 'null' then
    if position('/storage/v1/object/public/product-images/' || p_store::text || '/' in coalesce(t #>> '{logo,url}', '')) = 0
       or coalesce(t #>> '{logo,path}', '') not like p_store::text || '/%' then return 'Logo 圖片不正確，請重新上傳'; end if;
  end if;
  return null;
end $$;

create or replace function admin_save_settings(p_store uuid, p_settings jsonb) returns void
language plpgsql volatile security definer set search_path = public as $$
begin
  perform _require_perm(p_store, 'settings');
  if coalesce(trim(p_settings ->> 'name'), '') = '' then raise exception '請填寫商店名稱'; end if;
  if not exists (select 1 from jsonb_array_elements(p_settings -> 'shippingMethods') m where (m ->> 'enabled')::boolean) then raise exception '至少要開一種取貨方式'; end if;
  if coalesce(p_settings ->> 'autoCancelDays', '0') !~ '^\d{1,2}$' or (p_settings ->> 'autoCancelDays')::int > 30 then raise exception '自動取消天數要 0～30 天'; end if;
  if _theme_problem(p_store, p_settings -> 'theme') is not null then raise exception '%', _theme_problem(p_store, p_settings -> 'theme'); end if;
  if not exists (select 1 from jsonb_array_elements(p_settings -> 'paymentMethods') m where (m ->> 'enabled')::boolean) then raise exception '至少要開一種付款方式'; end if;
  update stores set settings = p_settings where id = p_store;
end $$;

create or replace function admin_save_category(p_store uuid, p_id uuid, p_name text) returns uuid
language plpgsql volatile security definer set search_path = public as $$
declare cid uuid;
begin
  perform _require_perm(p_store, 'products');
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
  perform _require_perm(p_store, 'products');
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
  cats uuid[]; v_images jsonb; v_pub timestamptz; v_unpub timestamptz;
begin
  perform _require_perm(p_store, 'products');
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
  v_pub := nullif(p_product ->> 'publishAt', '')::timestamptz; v_unpub := nullif(p_product ->> 'unpublishAt', '')::timestamptz;
  if v_pub is not null and v_unpub is not null and v_unpub <= v_pub then raise exception '自動下架時間要晚於上架時間'; end if;
  select coalesce(array_agg(c.id), '{}') into cats from categories c
    where c.store_id = p_store and c.id in (select (x #>> '{}')::uuid from jsonb_array_elements(coalesce(p_product -> 'categoryIds', '[]'::jsonb)) x);
  if pid is null then
    insert into products(store_id, name, description, status, color, category_ids, options, images, publish_at, unpublish_at)
    values (p_store, trim(p_product ->> 'name'), coalesce(p_product ->> 'description', ''),
      case when p_product ->> 'status' = 'active' then 'active' else 'draft' end,
      coalesce(nullif(p_product ->> 'color', ''), (array['#8a9a8e','#b7a38b','#6d7b86','#a58a6f','#4f6b66','#7a5a43','#8c7f99'])[1 + floor(random() * 7)::int]),
      cats, coalesce(p_product -> 'options', '[]'::jsonb), v_images, v_pub, v_unpub)
    returning id into pid;
  else
    update products set name = trim(p_product ->> 'name'), description = coalesce(p_product ->> 'description', ''),
      status = case when p_product ->> 'status' = 'active' then 'active' else 'draft' end,
      category_ids = cats, options = coalesce(p_product -> 'options', '[]'::jsonb), images = v_images, updated_at = now(),
      publish_at = v_pub, unpublish_at = v_unpub
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
        price = (v ->> 'price')::int, cost = case when _can_see_cost(p_store) then greatest(0, coalesce((v ->> 'cost')::int, 0)) else cost end, stock = stock + delta, sort = ord
      where id = vid;
      if delta <> 0 then perform _log_move(p_store, vid, delta, 'edit', '', '在商品頁直接修改庫存'); end if;
    else
      if delta < 0 then raise exception '庫存需為 0 以上的整數'; end if;
      insert into variants(product_id, store_id, sku, options, price, stock, cost, sort)
      values (pid, p_store, coalesce(v ->> 'sku', ''), coalesce(v -> 'options', '{}'::jsonb), (v ->> 'price')::int, delta,
              case when _can_see_cost(p_store) then greatest(0, coalesce((v ->> 'cost')::int, 0)) else 0 end, ord)
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
  perform _require_perm(p_store, 'products');
  delete from products where id = p_id and store_id = p_store;
end $$;

-- 改訂單狀態：只允許正常的流程
create or replace function admin_set_order_status(p_store uuid, p_order uuid, p_status text, p_tracking text default null, p_note text default null)
returns void language plpgsql volatile security definer set search_path = public as $$
declare o orders; it jsonb; allowed text[];
begin
  perform _require_perm(p_store, 'orders');
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
    history = history || jsonb_build_array(jsonb_build_object('status', p_status, 'at', now(), 'note', coalesce(p_note, ''), 'by', _my_email()))
  where id = o.id;
end $$;

create or replace function admin_set_order_note(p_store uuid, p_order uuid, p_note text) returns void
language plpgsql volatile security definer set search_path = public as $$
begin
  perform _require_perm(p_store, 'orders');
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
  perform _require_perm(p_store, 'marketing');
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
  perform _require_perm(p_store, 'marketing');
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
  perform _require_perm(p_store, 'marketing');
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
  perform _require_perm(p_store, 'marketing');
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
  perform _require_perm(p_store, 'marketing');
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
  perform _require_perm(p_store, 'inventory');
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
  perform _require_perm(p_store, 'inventory');
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
  perform _require_perm(p_store, 'inventory');
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
  perform _require_perm(p_store, 'inventory');
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
  perform _require_perm(p_store, 'inventory');
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
  perform _require_perm(p_store, 'inventory');
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
      update stock_movements set unit_cost = (it ->> 'cost')::int where id = (select id from stock_movements where store_id = p_store
        and variant_id = (it ->> 'variantId')::uuid and ref = po.number and type = 'purchase' and unit_cost is null order by at desc limit 1);
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
  perform _require_perm(p_store, 'inventory');
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
  perform _require_perm(p_store, 'inventory');
  delete from purchases where id = p_id and store_id = p_store and status = 'draft';
  if not found then raise exception '只有草稿可以刪除'; end if;
end $$;

-- =========================================================
-- v0.11：銷售／毛利報表
-- 營收只算「已付款」的訂單（待出貨、已出貨、已完成）；日期用台灣時間
-- 毛利 = 商品金額 − 折扣 − 當時的成本（運費不算進毛利）
-- =========================================================
create or replace function admin_report(p_store uuid, p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_days int; v_unit text; r jsonb;
begin
  perform _require_perm(p_store, 'reports');
  if p_from is null or p_to is null then raise exception '請選擇日期區間'; end if;
  if p_to < p_from then raise exception '結束日期不能早於開始日期'; end if;
  v_days := p_to - p_from + 1;
  if v_days > 1100 then raise exception '一次最多查 3 年'; end if;
  v_unit := case when v_days <= 62 then 'day' else 'month' end;

  with o as (
    select *, (created_at at time zone 'Asia/Taipei')::date as d from orders
    where store_id = p_store and (created_at at time zone 'Asia/Taipei')::date between p_from and p_to
  ),
  paid as (
    select o.*, coalesce(o.customer_id::text, 'p:' || (o.contact ->> 'phone')) as who,
      (select coalesce(sum((i ->> 'qty')::int * coalesce((i ->> 'cost')::int, 0)), 0) from jsonb_array_elements(o.items) i) as cost
    from o where status in ('paid', 'shipped', 'completed')
  ),
  -- 每位顧客「第一次付款」的日期（看全部歷史），用來分新客／回購
  firsts as (
    select coalesce(customer_id::text, 'p:' || (contact ->> 'phone')) as who, min((created_at at time zone 'Asia/Taipei')::date) as first_d
    from orders where store_id = p_store and status in ('paid', 'shipped', 'completed') group by 1
  ),
  its as (select p.id, i from paid p, jsonb_array_elements(p.items) i),
  buckets as (
    select g::date as b from generate_series(
      case when v_unit = 'day' then p_from else date_trunc('month', p_from)::date end, p_to,
      case when v_unit = 'day' then interval '1 day' else interval '1 month' end) g
  ),
  moves as (
    select m.*, coalesce(pu.supplier_name, '') as supplier from stock_movements m
    left join purchases pu on pu.store_id = m.store_id and pu.number = m.ref
    where m.store_id = p_store and m.type = 'purchase' and (m.at at time zone 'Asia/Taipei')::date between p_from and p_to
  )
  select jsonb_build_object(
    'from', p_from, 'to', p_to, 'unit', v_unit,
    'summary', (select jsonb_build_object(
        'orders', count(*), 'revenue', coalesce(sum(total), 0), 'goods', coalesce(sum(subtotal), 0),
        'discount', coalesce(sum(discount), 0), 'shipping', coalesce(sum(shipping_fee), 0), 'cost', coalesce(sum(cost), 0),
        'gross', coalesce(sum(subtotal - discount - cost), 0),
        'customers', count(distinct who),
        'newCustomers', (select count(*) from firsts f where f.who in (select who from paid) and f.first_d >= p_from),
        'units', (select coalesce(sum((i ->> 'qty')::int), 0) from its)) from paid),
    'pending', (select jsonb_build_object('orders', count(*), 'amount', coalesce(sum(total), 0)) from o where status = 'pending_payment'),
    -- 退款：依「退款日期」算；退回庫存的商品，成本加回來
    'refunds', (select jsonb_build_object('count', count(*), 'amount', coalesce(sum(r.amount), 0),
        'restockedCost', coalesce(sum((select coalesce(sum((i ->> 'qty')::int * coalesce((i ->> 'cost')::int, 0)), 0) from jsonb_array_elements(r.items) i) * (case when r.restock then 1 else 0 end)), 0))
      from order_refunds r where r.store_id = p_store and (r.created_at at time zone 'Asia/Taipei')::date between p_from and p_to),
    'cancelled', (select jsonb_build_object('orders', count(*), 'amount', coalesce(sum(total), 0)) from o where status = 'cancelled'),
    'series', (select coalesce(jsonb_agg(jsonb_build_object('date', b.b,
        'revenue', coalesce(x.revenue, 0), 'orders', coalesce(x.n, 0), 'gross', coalesce(x.gross, 0)) order by b.b), '[]'::jsonb)
      from buckets b left join (
        select case when v_unit = 'day' then d else date_trunc('month', d)::date end as b,
          sum(total) revenue, count(*) n, sum(subtotal - discount - cost) gross from paid group by 1) x on x.b = b.b),
    'products', (select coalesce(jsonb_agg(t order by (t ->> 'sales')::int desc), '[]'::jsonb) from (
        select jsonb_build_object('productId', i ->> 'productId', 'name', max(i ->> 'name'),
          'qty', sum((i ->> 'qty')::int), 'sales', sum((i ->> 'qty')::int * (i ->> 'price')::int),
          'cost', sum((i ->> 'qty')::int * coalesce((i ->> 'cost')::int, 0)),
          'orders', count(distinct id)) t
        from its group by i ->> 'productId' order by sum((i ->> 'qty')::int * (i ->> 'price')::int) desc limit 50) z),
    'variants', (select coalesce(jsonb_agg(t order by (t ->> 'qty')::int desc), '[]'::jsonb) from (
        select jsonb_build_object('variantId', i ->> 'variantId', 'name', max(i ->> 'name'), 'optionText', max(i ->> 'optionText'), 'sku', max(i ->> 'sku'),
          'qty', sum((i ->> 'qty')::int), 'sales', sum((i ->> 'qty')::int * (i ->> 'price')::int)) t
        from its group by i ->> 'variantId' order by sum((i ->> 'qty')::int) desc limit 50) z),
    'payments', (select coalesce(jsonb_agg(jsonb_build_object('name', n, 'orders', c, 'amount', a) order by a desc), '[]'::jsonb)
      from (select payment ->> 'methodName' n, count(*) c, sum(total) a from paid group by 1) z),
    'shippings', (select coalesce(jsonb_agg(jsonb_build_object('name', n, 'orders', c, 'amount', a) order by c desc), '[]'::jsonb)
      from (select shipping ->> 'methodName' n, count(*) c, sum(shipping_fee) a from paid group by 1) z),
    'discounts', (select coalesce(jsonb_agg(jsonb_build_object('kind', k, 'label', l, 'orders', c, 'amount', a) order by a desc), '[]'::jsonb)
      from (select dd ->> 'kind' k, case dd ->> 'kind' when 'coupon' then '優惠碼 ' || (dd ->> 'code') when 'promo' then '滿額活動' when 'member' then '會員等級' else dd ->> 'kind' end l,
              count(*) c, sum((dd ->> 'amount')::int) a
            from paid p, jsonb_array_elements(p.discounts) dd group by 1, 2) z),
    'purchases', (select jsonb_build_object('units', coalesce(sum(delta), 0), 'amount', coalesce(sum(delta * coalesce(unit_cost, 0)), 0),
        'bySupplier', coalesce((select jsonb_agg(jsonb_build_object('name', s, 'units', u, 'amount', a) order by a desc)
          from (select nullif(supplier, '') s, sum(delta) u, sum(delta * coalesce(unit_cost, 0)) a from moves group by 1) z), '[]'::jsonb)) from moves)
  ) into r;
  return r;
end $$;





-- =========================================================
-- v0.16：商品評價
-- =========================================================
create or replace function _mask_name(n text) returns text language sql immutable as $$
  select case when coalesce(trim(n), '') = '' then '顧客' when char_length(trim(n)) = 1 then trim(n) || '*' else left(trim(n), 1) || repeat('*', least(char_length(trim(n)) - 1, 2)) end
$$;
create or replace function _review_json(r reviews, with_private boolean) returns jsonb language sql stable as $$
  select jsonb_build_object('id', r.id, 'productId', r.product_id, 'name', r.display_name, 'rating', r.rating, 'content', r.content,
    'reply', r.reply, 'replyAt', r.reply_at, 'createdAt', r.created_at, 'updatedAt', r.updated_at)
  || case when with_private then jsonb_build_object('status', r.status, 'orderNumber', (select number from orders where id = r.order_id),
       'customerId', r.customer_id, 'customerName', (select name from customers where id = r.customer_id),
       'productName', (select name from products where id = r.product_id)) else '{}'::jsonb end
$$;

-- 商品頁：公開的評價（平均、各星等數量、一次 10 則）
create or replace function shop_reviews(p_slug text, p_product uuid, p_offset int default 0) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare s stores;
begin
  s := _store_by_slug(p_slug);
  return jsonb_build_object(
    'avg', (select round(avg(rating)::numeric, 1) from reviews where product_id = p_product and store_id = s.id and status = 'visible'),
    'count', (select count(*) from reviews where product_id = p_product and store_id = s.id and status = 'visible'),
    'dist', (select jsonb_object_agg(g, (select count(*) from reviews where product_id = p_product and store_id = s.id and status = 'visible' and rating = g)) from generate_series(1, 5) g),
    'items', coalesce((select jsonb_agg(_review_json(r, false) order by r.created_at desc) from
      (select * from reviews where product_id = p_product and store_id = s.id and status = 'visible' order by created_at desc offset greatest(coalesce(p_offset, 0), 0) limit 10) r), '[]'::jsonb));
end $$;

-- 會員可以評價的商品：自己的訂單、已出貨或已完成
create or replace function shop_my_reviewables(p_slug text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare s stores; cid uuid;
begin
  s := _store_by_slug(p_slug);
  cid := _member_id(s.id);
  if cid is null then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(x order by x ->> 'orderedAt' desc) from (
    select distinct on (o.id, it ->> 'productId') jsonb_build_object('orderNumber', o.number, 'orderedAt', o.created_at, 'productId', it ->> 'productId',
      'name', it ->> 'name', 'review', (select _review_json(r, false) || jsonb_build_object('status', r.status) from reviews r where r.order_id = o.id and r.product_id::text = it ->> 'productId')) x
    from orders o, jsonb_array_elements(o.items) it
    where o.store_id = s.id and o.customer_id = cid and o.status in ('shipped', 'completed')
      and exists (select 1 from products p where p.id::text = it ->> 'productId')) z), '[]'::jsonb);
end $$;

create or replace function shop_review_save(p_slug text, p_order text, p_product uuid, p_rating int, p_content text) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare s stores; cid uuid; o orders; c customers; r reviews; v_content text := left(trim(coalesce(p_content, '')), 500); auto boolean;
begin
  s := _store_by_slug(p_slug);
  if not coalesce((s.settings #>> '{reviews,enabled}')::boolean, true) then raise exception '這家店目前沒有開放評價'; end if;
  cid := _member_id(s.id);
  if cid is null then raise exception '請先登入會員'; end if;
  select * into o from orders where store_id = s.id and number = upper(trim(p_order)) and customer_id = cid;
  if not found then raise exception '找不到這筆訂單'; end if;
  if o.status not in ('shipped', 'completed') then raise exception '商品出貨後才能評價'; end if;
  if not exists (select 1 from jsonb_array_elements(o.items) it where it ->> 'productId' = p_product::text) then raise exception '這筆訂單沒有這個商品'; end if;
  if p_rating is null or p_rating not between 1 and 5 then raise exception '請選 1～5 顆星'; end if;
  perform _rate_hit('review', cid::text, 20, interval '1 day', '今天評價太多次了，明天再試');
  select * into c from customers where id = cid;
  auto := coalesce((s.settings #>> '{reviews,autoPublish}')::boolean, true);
  insert into reviews(store_id, product_id, order_id, customer_id, display_name, rating, content, status)
    values (s.id, p_product, o.id, cid, _mask_name(c.name), p_rating, v_content, case when auto then 'visible' else 'pending' end)
  on conflict (order_id, product_id) do update set rating = excluded.rating, content = excluded.content, updated_at = now(),
    status = case when reviews.status = 'hidden' then 'hidden' when auto then 'visible' else 'pending' end
  returning * into r;
  return _review_json(r, false) || jsonb_build_object('status', r.status);
end $$;

-- 後台：評價列表（狀態、星等篩選，分頁）
create or replace function admin_reviews(p_store uuid, p_status text default '', p_rating int default null, p_offset int default 0, p_limit int default 50) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform _require_perm(p_store, 'products');
  return jsonb_build_object(
    'total', (select count(*) from reviews where store_id = p_store and (coalesce(p_status, '') = '' or status = p_status) and (p_rating is null or rating = p_rating)),
    'counts', (select jsonb_build_object('all', count(*), 'pending', count(*) filter (where status = 'pending'), 'visible', count(*) filter (where status = 'visible'),
        'hidden', count(*) filter (where status = 'hidden'), 'avg', round(avg(rating) filter (where status = 'visible')::numeric, 1)) from reviews where store_id = p_store),
    'rows', coalesce((select jsonb_agg(_review_json(r, true) order by r.created_at desc) from
      (select * from reviews where store_id = p_store and (coalesce(p_status, '') = '' or status = p_status) and (p_rating is null or rating = p_rating)
       order by created_at desc offset greatest(coalesce(p_offset, 0), 0) limit least(greatest(coalesce(p_limit, 50), 1), 200)) r), '[]'::jsonb));
end $$;

create or replace function admin_review_set(p_store uuid, p_id uuid, p_status text) returns void
language plpgsql volatile security definer set search_path = public as $$
begin
  perform _require_perm(p_store, 'products');
  if p_status not in ('visible', 'hidden') then raise exception '狀態不正確'; end if;
  update reviews set status = p_status where id = p_id and store_id = p_store;
  if not found then raise exception '找不到這則評價'; end if;
end $$;

create or replace function admin_review_reply(p_store uuid, p_id uuid, p_reply text) returns void
language plpgsql volatile security definer set search_path = public as $$
begin
  perform _require_perm(p_store, 'products');
  if char_length(coalesce(p_reply, '')) > 500 then raise exception '回覆最多 500 個字'; end if;
  update reviews set reply = trim(coalesce(p_reply, '')), reply_at = case when trim(coalesce(p_reply, '')) = '' then null else now() end
    where id = p_id and store_id = p_store;
  if not found then raise exception '找不到這則評價'; end if;
end $$;

-- =========================================================
-- v0.15：商品管理（排序、複製、批次匯入）
-- =========================================================
-- 自訂排序：照傳進來的順序排 1、2、3…
create or replace function admin_sort_products(p_store uuid, p_ids uuid[]) returns void
language plpgsql volatile security definer set search_path = public as $$
declare i int := 0; x uuid;
begin
  perform _require_perm(p_store, 'products');
  foreach x in array coalesce(p_ids, '{}') loop
    i := i + 1;
    update products set sort = i where id = x and store_id = p_store;
  end loop;
end $$;

-- 複製商品：存成草稿、庫存 0、貨號清空、不複製圖片（圖片檔案跟原商品共用會互相影響）
create or replace function admin_duplicate_product(p_store uuid, p_id uuid) returns uuid
language plpgsql volatile security definer set search_path = public as $$
declare p products; nid uuid;
begin
  perform _require_perm(p_store, 'products');
  select * into p from products where id = p_id and store_id = p_store;
  if not found then raise exception '找不到這個商品'; end if;
  insert into products(store_id, name, description, status, color, category_ids, options, images, sort)
    values (p_store, left(p.name || '（複製）', 60), p.description, 'draft', p.color, p.category_ids, p.options, '[]'::jsonb, p.sort)
    returning id into nid;
  insert into variants(product_id, store_id, sku, options, price, stock, cost, sort)
    select nid, p_store, '', options, price, 0, cost, sort from variants where product_id = p.id;
  return nid;
end $$;

-- 批次匯入：一次存很多個商品，全部成功才生效（有一個錯就全部不存，並說是哪一個）
create or replace function admin_save_products_bulk(p_store uuid, p_products jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare x jsonb; i int := 0; ids jsonb := '[]'::jsonb;
begin
  perform _require_perm(p_store, 'products');
  if jsonb_typeof(p_products) <> 'array' or jsonb_array_length(p_products) = 0 then raise exception '沒有要匯入的商品'; end if;
  if jsonb_array_length(p_products) > 500 then raise exception '一次最多 500 個商品'; end if;
  for x in select * from jsonb_array_elements(p_products) loop
    i := i + 1;
    begin
      ids := ids || to_jsonb(admin_save_product(p_store, x));
    exception when others then
      raise exception '%', format('第 %s 個商品「%s」：%s', i, coalesce(x ->> 'name', ''), sqlerrm);
    end;
  end loop;
  return ids;
end $$;

-- =========================================================
-- v0.14：批次改狀態、退貨／退款
-- =========================================================
-- 一次改很多筆訂單（例如一起出貨）；改不了的會列出原因，其他照樣完成
create or replace function admin_bulk_set_status(p_store uuid, p_orders uuid[], p_status text, p_tracking jsonb default '{}'::jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare oid uuid; n int := 0; failed jsonb := '[]'::jsonb;
begin
  perform _require_perm(p_store, 'orders');
  if p_status not in ('paid', 'shipped', 'completed', 'cancelled') then raise exception '狀態不正確'; end if;
  if coalesce(cardinality(p_orders), 0) = 0 then raise exception '請先勾選訂單'; end if;
  if cardinality(p_orders) > 200 then raise exception '一次最多 200 筆'; end if;
  foreach oid in array p_orders loop
    begin
      perform admin_set_order_status(p_store, oid, p_status, nullif(trim(coalesce(p_tracking ->> oid::text, '')), ''), null);
      n := n + 1;
    exception when others then
      failed := failed || jsonb_build_object('id', oid, 'number', (select number from orders where id = oid and store_id = p_store), 'reason', sqlerrm);
    end;
  end loop;
  return jsonb_build_object('ok', n, 'failed', failed);
end $$;

-- 退貨／退款：可以只退部分商品、部分金額；選擇要不要把商品加回庫存
create or replace function admin_refund_order(p_store uuid, p_order uuid, p_items jsonb, p_amount int, p_restock boolean, p_reason text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare o orders; it jsonb; line jsonb; want int; done_qty int; items_out jsonb := '[]'::jsonb; refunded int; r order_refunds;
begin
  perform _require_perm(p_store, 'orders');
  select * into o from orders where id = p_order and store_id = p_store for update;
  if not found then raise exception '找不到這筆訂單'; end if;
  if o.status not in ('paid', 'shipped', 'completed') then raise exception '只有已付款的訂單可以退款（待付款的請直接取消）'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception '請填寫退款原因'; end if;
  select coalesce(sum(amount), 0) into refunded from order_refunds where order_id = o.id;
  if p_amount is null or p_amount < 0 then raise exception '退款金額不正確'; end if;
  if p_amount > o.total - refunded then raise exception '%', '最多還能退 ' || _money(o.total - refunded); end if;
  for it in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    want := coalesce(floor((it ->> 'qty')::numeric)::int, 0);
    if want <= 0 then continue; end if;
    select l into line from jsonb_array_elements(o.items) l where l ->> 'variantId' = it ->> 'variantId';
    if line is null then raise exception '這筆訂單沒有這個商品'; end if;
    select coalesce(sum((x ->> 'qty')::int), 0) into done_qty from order_refunds rr, jsonb_array_elements(rr.items) x
      where rr.order_id = o.id and x ->> 'variantId' = it ->> 'variantId';
    if want > (line ->> 'qty')::int - done_qty then
      raise exception '%', format('「%s」最多還能退 %s 件', line ->> 'name', (line ->> 'qty')::int - done_qty);
    end if;
    items_out := items_out || jsonb_build_object('variantId', line ->> 'variantId', 'productId', line ->> 'productId', 'name', line ->> 'name',
      'optionText', coalesce(line ->> 'optionText', ''), 'sku', coalesce(line ->> 'sku', ''), 'qty', want, 'price', (line ->> 'price')::int, 'cost', coalesce((line ->> 'cost')::int, 0));
    if p_restock then
      update variants set stock = stock + want where id = (line ->> 'variantId')::uuid and store_id = p_store;
      if found then perform _log_move(p_store, (line ->> 'variantId')::uuid, want, 'return', o.number, '退貨入庫：' || trim(p_reason)); end if;
    end if;
  end loop;
  if p_amount = 0 and jsonb_array_length(items_out) = 0 then raise exception '請填退款金額或退貨數量'; end if;
  insert into order_refunds(store_id, order_id, items, amount, restock, reason, by_email)
    values (p_store, o.id, items_out, p_amount, coalesce(p_restock, false) and jsonb_array_length(items_out) > 0, left(trim(p_reason), 200), _my_email())
    returning * into r;
  update orders set history = history || jsonb_build_array(jsonb_build_object('status', o.status, 'kind', 'refund', 'at', now(), 'by', _my_email(),
    'note', '退款 ' || _money(p_amount) || case when jsonb_array_length(items_out) > 0 then '，退貨 ' ||
      (select string_agg((x ->> 'name') || ' ×' || (x ->> 'qty'), '、') from jsonb_array_elements(items_out) x) ||
      case when r.restock then '（已加回庫存）' else '' end else '' end || '：' || trim(p_reason)))
    where id = o.id;
  return jsonb_build_object('id', r.id, 'amount', r.amount);
end $$;

-- =========================================================
-- v0.13：員工帳號（店主邀請 → 對方用同一個 Email 登入 → 加入）
-- =========================================================
create or replace function _clean_perms(p text[]) returns text[] language sql immutable as $$
  select coalesce(array_agg(distinct x order by x), '{}') from unnest(coalesce(p, '{}')) x
  where x in ('orders', 'customers', 'products', 'inventory', 'marketing', 'reports', 'settings')
$$;

create or replace function admin_staff_list(p_store uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform _require_owner(p_store);
  return jsonb_build_object(
    'members', coalesce((select jsonb_agg(jsonb_build_object('userId', m.user_id, 'email', u.email, 'role', m.role, 'perms', to_jsonb(m.perms),
        'createdAt', m.created_at, 'isMe', m.user_id = auth.uid()) order by m.role desc, m.created_at)
      from store_members m join auth.users u on u.id = m.user_id where m.store_id = p_store), '[]'::jsonb),
    'invites', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'email', i.email, 'perms', to_jsonb(i.perms), 'token', i.token,
        'createdAt', i.created_at, 'expiresAt', i.expires_at, 'expired', i.expires_at < now()) order by i.created_at desc)
      from store_invites i where i.store_id = p_store and i.accepted_at is null), '[]'::jsonb));
end $$;

create or replace function admin_invite_staff(p_store uuid, p_email text, p_perms text[]) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare v_email text := lower(trim(coalesce(p_email, ''))); v_perms text[] := _clean_perms(p_perms); inv store_invites;
begin
  perform _require_owner(p_store);
  if v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then raise exception 'Email 格式不正確'; end if;
  if cardinality(v_perms) = 0 then raise exception '至少要勾一項權限'; end if;
  if exists (select 1 from store_members m join auth.users u on u.id = m.user_id where m.store_id = p_store and lower(u.email) = v_email) then
    raise exception '這個 Email 已經是這家店的成員'; end if;
  if (select count(*) from store_members where store_id = p_store) + (select count(*) from store_invites where store_id = p_store and accepted_at is null and expires_at > now()) >= 20 then
    raise exception '每家店最多 20 位成員（含邀請中）'; end if;
  perform _rate_hit('invite', p_store::text, 30, interval '1 day', '今天邀請太多次了，明天再試');
  delete from store_invites where store_id = p_store and lower(email) = v_email and accepted_at is null;
  insert into store_invites(store_id, email, perms, created_by) values (p_store, v_email, v_perms, auth.uid()) returning * into inv;
  return jsonb_build_object('id', inv.id, 'token', inv.token, 'expiresAt', inv.expires_at);
end $$;

create or replace function admin_cancel_invite(p_store uuid, p_id uuid) returns void
language plpgsql volatile security definer set search_path = public as $$
begin
  perform _require_owner(p_store);
  delete from store_invites where id = p_id and store_id = p_store and accepted_at is null;
end $$;

create or replace function admin_update_staff(p_store uuid, p_user uuid, p_perms text[]) returns void
language plpgsql volatile security definer set search_path = public as $$
declare v_perms text[] := _clean_perms(p_perms);
begin
  perform _require_owner(p_store);
  if cardinality(v_perms) = 0 then raise exception '至少要勾一項權限（要移除請按「移除」）'; end if;
  update store_members set perms = v_perms where store_id = p_store and user_id = p_user and role = 'staff';
  if not found then raise exception '找不到這位員工'; end if;
end $$;

create or replace function admin_remove_staff(p_store uuid, p_user uuid) returns void
language plpgsql volatile security definer set search_path = public as $$
begin
  perform _require_owner(p_store);
  delete from store_members where store_id = p_store and user_id = p_user and role = 'staff';
  if not found then raise exception '找不到這位員工（店主不能移除）'; end if;
end $$;

-- 員工自己離開這家店
create or replace function admin_leave_store(p_store uuid) returns void
language plpgsql volatile security definer set search_path = public as $$
begin
  perform _require_member(p_store);
  if (_member_row(p_store)).role = 'owner' then raise exception '店主不能離開自己的商店'; end if;
  delete from store_members where store_id = p_store and user_id = auth.uid();
end $$;

-- 邀請連結資訊（打開連結時顯示是哪一家店；Email 只露出一部分）
create or replace function admin_invite_info(p_token uuid) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare inv store_invites; s stores;
begin
  perform _rate_hit('invite-info', coalesce(_client_ip(), ''), 60, interval '10 minutes', '查詢太頻繁，請稍後再試');
  select * into inv from store_invites where token = p_token;
  if not found then return null; end if;
  select * into s from stores where id = inv.store_id;
  return jsonb_build_object('storeName', s.settings ->> 'name', 'storeSlug', s.slug,
    'email', left(inv.email, 2) || '***' || substring(inv.email from position('@' in inv.email)),
    'perms', to_jsonb(inv.perms), 'expired', inv.expires_at < now(), 'accepted', inv.accepted_at is not null,
    'emailMatches', auth.uid() is not null and lower(_my_email()) = lower(inv.email));
end $$;

create or replace function admin_accept_invite(p_token uuid) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare inv store_invites; s stores; v_email text; confirmed timestamptz;
begin
  if auth.uid() is null then raise exception '請先登入'; end if;
  select * into inv from store_invites where token = p_token for update;
  if not found then raise exception '邀請連結不正確'; end if;
  if inv.accepted_at is not null then raise exception '這個邀請已經用過了'; end if;
  if inv.expires_at < now() then raise exception '邀請已過期，請店主重新邀請'; end if;
  select email, email_confirmed_at into v_email, confirmed from auth.users where id = auth.uid();
  if lower(v_email) <> lower(inv.email) then raise exception '這個邀請是給另一個 Email 的，請用被邀請的 Email 登入'; end if;
  if confirmed is null then raise exception '請先完成 Email 驗證'; end if;
  insert into store_members(store_id, user_id, role, perms) values (inv.store_id, auth.uid(), 'staff', inv.perms)
    on conflict (store_id, user_id) do nothing;
  update store_invites set accepted_at = now() where id = inv.id;
  select * into s from stores where id = inv.store_id;
  return jsonb_build_object('storeId', s.id, 'slug', s.slug, 'name', s.settings ->> 'name');
end $$;

-- =========================================================
-- v0.9：商家自助開店
-- =========================================================

-- 平台公開資訊（首頁用）：平台名稱、年費、試用天數、是否開放開店
create or replace function platform_public() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('platformName', x ->> 'platformName', 'annualFee', (x ->> 'annualFee')::int,
    'trialDays', (x ->> 'trialDays')::int, 'signupOpen', coalesce((x ->> 'signupOpen')::boolean, false),
    'contactEmail', x ->> 'contactEmail', 'contactLine', x ->> 'contactLine')
  from _platform_settings() x
$$;

-- 商店網址代號規則：3～30 個小寫英文、數字、減號，頭尾不能是減號
create or replace function _slug_problem(p_slug text) returns text language sql immutable as $$
  select case
    when p_slug is null or p_slug = '' then '請填寫商店網址代號'
    when length(p_slug) < 3 or length(p_slug) > 30 then '商店網址代號要 3～30 個字'
    when p_slug !~ '^[a-z0-9][a-z0-9-]*[a-z0-9]$' then '商店網址代號只能用小寫英文、數字和減號（-），頭尾不能是減號'
    when p_slug ~ '--' then '商店網址代號不能有連續兩個減號'
    when p_slug = any (array['admin','platform','api','www','app','apps','shop','shops','store','stores','demo','test','help','support',
      'login','signup','register','static','assets','mail','email','home','official','system','root','null','undefined']) then '這個代號保留給平台使用，請換一個'
    else null end
$$;

create or replace function admin_slug_available(p_slug text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_slug text := lower(trim(coalesce(p_slug, ''))); prob text;
begin
  if auth.uid() is null then raise exception '請先登入'; end if;
  prob := _slug_problem(v_slug);
  if prob is null and exists (select 1 from stores where slug = v_slug) then prob := '這個代號已經有人用了，請換一個'; end if;
  return jsonb_build_object('slug', v_slug, 'ok', prob is null, 'message', coalesce(prob, '可以使用'));
end $$;

-- 建立商店：登入者（信箱已確認）變成店主，開始試用
create or replace function admin_create_store(p_name text, p_slug text) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  v_name text := trim(coalesce(p_name, ''));
  v_slug text := lower(trim(coalesce(p_slug, '')));
  cfg jsonb := _platform_settings();
  v_email text; confirmed timestamptz; prob text; sid uuid; owned int;
  v_trial int := greatest(coalesce((cfg ->> 'trialDays')::int, 14), 0);
  v_max int := greatest(coalesce((cfg ->> 'maxStoresPerUser')::int, 3), 1);
begin
  if auth.uid() is null then raise exception '請先登入'; end if;
  select email, email_confirmed_at into v_email, confirmed from auth.users where id = auth.uid();
  if confirmed is null then raise exception '請先到信箱點確認連結，完成 Email 驗證'; end if;
  if not _is_platform_admin() then
    if not coalesce((cfg ->> 'signupOpen')::boolean, false) then raise exception '平台目前暫停開放新商店，請聯絡平台'; end if;
    select count(*) into owned from store_members where user_id = auth.uid() and role = 'owner';
    if owned >= v_max then raise exception '每個帳號最多建立 % 家商店', v_max; end if;
  end if;
  if v_name = '' then raise exception '請填寫商店名稱'; end if;
  if length(v_name) > 40 then raise exception '商店名稱最多 40 個字'; end if;
  prob := _slug_problem(v_slug);
  if prob is not null then raise exception '%', prob; end if;
  if exists (select 1 from stores where slug = v_slug) then raise exception '這個代號已經有人用了，請換一個'; end if;

  insert into stores(slug, plan, active_until, created_by, settings) values (v_slug, 'trial', _today() + v_trial, auth.uid(), jsonb_build_object(
    'name', v_name, 'tagline', '', 'email', v_email, 'phone', '',
    'freeShippingThreshold', 1000, 'lowStockAlert', 3,
    'shippingMethods', jsonb_build_array(
      jsonb_build_object('id', 'cvs711', 'name', '7-11 取貨', 'type', 'cvs', 'fee', 60, 'enabled', true),
      jsonb_build_object('id', 'cvsfami', 'name', '全家取貨', 'type', 'cvs', 'fee', 60, 'enabled', true),
      jsonb_build_object('id', 'home', 'name', '宅配到府', 'type', 'home', 'fee', 100, 'enabled', true)),
    'paymentMethods', jsonb_build_array(
      jsonb_build_object('id', 'transfer', 'name', '銀行轉帳（人工對帳）', 'enabled', true, 'integrated', false, 'instruction', '下單後請於 3 天內匯款，商家確認後出貨。（請到後台「設定」填上你的匯款帳號）'),
      jsonb_build_object('id', 'cod', 'name', '取貨付款', 'enabled', true, 'integrated', false, 'instruction', '取貨時付款即可。'),
      jsonb_build_object('id', 'card', 'name', '信用卡', 'enabled', false, 'integrated', false, 'instruction', '尚未串接金流。'))))
  returning id into sid;
  insert into store_members(store_id, user_id, role) values (sid, auth.uid(), 'owner');
  insert into platform_billing_log(store_id, kind, from_date, to_date, note, by_email)
    values (sid, 'create', _today(), _today() + v_trial, '商家自助開店，試用 ' || v_trial || ' 天', coalesce(v_email, ''));
  return jsonb_build_object('id', sid, 'slug', v_slug);
end $$;

-- =========================================================
-- v0.9：平台總控台（只有平台管理者能用）
-- =========================================================

create or replace function platform_me() returns boolean
language sql stable security definer set search_path = public as $$
  select _is_platform_admin()
$$;

create or replace function _platform_store_json(s stores) returns jsonb language sql stable as $$
  select jsonb_build_object('id', s.id, 'slug', s.slug, 'name', s.settings ->> 'name', 'createdAt', s.created_at,
    'email', s.settings ->> 'email', 'phone', s.settings ->> 'phone',
    'billing', _billing_json(s), 'note', s.platform_note,
    'owners', coalesce((select jsonb_agg(u.email order by m.created_at) from store_members m join auth.users u on u.id = m.user_id where m.store_id = s.id and m.role = 'owner'), '[]'::jsonb),
    'products', (select count(*) from products p where p.store_id = s.id),
    'customers', (select count(*) from customers c where c.store_id = s.id),
    'orders', (select count(*) from orders o where o.store_id = s.id),
    'orders30', (select count(*) from orders o where o.store_id = s.id and o.created_at >= now() - interval '30 days' and o.status <> 'cancelled'),
    'revenue30', (select coalesce(sum(o.total), 0) from orders o where o.store_id = s.id and o.created_at >= now() - interval '30 days' and o.status in ('paid', 'shipped', 'completed')),
    'lastOrderAt', (select max(o.created_at) from orders o where o.store_id = s.id))
$$;

create or replace function platform_overview() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform _require_platform();
  return jsonb_build_object(
    'settings', _platform_settings(),
    'today', _today(),
    'stores', coalesce((select jsonb_agg(_platform_store_json(s) order by s.created_at desc) from stores s), '[]'::jsonb),
    'log', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'storeId', l.store_id, 'storeName', s.settings ->> 'name', 'storeSlug', s.slug,
        'kind', l.kind, 'amount', l.amount, 'from', l.from_date, 'to', l.to_date, 'note', l.note, 'by', l.by_email, 'at', l.created_at) order by l.created_at desc)
      from (select * from platform_billing_log order by created_at desc limit 1000) l join stores s on s.id = l.store_id), '[]'::jsonb),
    'loadedAt', now());
end $$;

create or replace function _platform_email() returns text language sql stable as $$
  select coalesce((select email from auth.users where id = auth.uid()), '')
$$;

-- 登記收到年費：從「今天」或「目前到期日的隔天」（比較晚的那個）開始算
create or replace function platform_record_payment(p_store uuid, p_years int, p_amount int, p_note text default '') returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare s stores; v_from date; v_to date;
begin
  perform _require_platform();
  select * into s from stores where id = p_store for update;
  if not found then raise exception '找不到這家商店'; end if;
  if s.plan = 'free' then raise exception '這家是免費商店，不用收年費（要收費請先把方案改成試用或付費）'; end if;
  if p_years is null or p_years < 1 or p_years > 5 then raise exception '年數要 1～5 年'; end if;
  if p_amount is null or p_amount < 0 then raise exception '金額不正確'; end if;
  v_from := greatest(_today(), coalesce(s.active_until, _today() - 1) + 1);
  v_to := (v_from + make_interval(years => p_years))::date - 1;
  update stores set plan = 'paid', active_until = v_to where id = p_store;
  insert into platform_billing_log(store_id, kind, amount, from_date, to_date, note, by_email)
    values (p_store, 'payment', p_amount, v_from, v_to, coalesce(trim(p_note), ''), _platform_email());
  return jsonb_build_object('from', v_from, 'to', v_to);
end $$;

-- 直接改到期日（例如延長試用、補償天數）
create or replace function platform_set_until(p_store uuid, p_until date, p_note text default '') returns void
language plpgsql volatile security definer set search_path = public as $$
declare s stores;
begin
  perform _require_platform();
  select * into s from stores where id = p_store for update;
  if not found then raise exception '找不到這家商店'; end if;
  if s.plan = 'free' then raise exception '免費商店沒有到期日'; end if;
  if p_until is null then raise exception '請選擇日期'; end if;
  update stores set active_until = p_until where id = p_store;
  insert into platform_billing_log(store_id, kind, from_date, to_date, note, by_email)
    values (p_store, 'extend', s.active_until, p_until, coalesce(trim(p_note), ''), _platform_email());
end $$;

create or replace function platform_set_plan(p_store uuid, p_plan text, p_note text default '') returns void
language plpgsql volatile security definer set search_path = public as $$
declare s stores; v_until date;
begin
  perform _require_platform();
  if p_plan not in ('trial', 'paid', 'free') then raise exception '方案不正確'; end if;
  select * into s from stores where id = p_store for update;
  if not found then raise exception '找不到這家商店'; end if;
  if s.plan = p_plan then return; end if;
  v_until := case when p_plan = 'free' then null
    else coalesce(s.active_until, _today() + greatest(coalesce((_platform_settings() ->> 'trialDays')::int, 14), 0)) end;
  update stores set plan = p_plan, active_until = v_until where id = p_store;
  insert into platform_billing_log(store_id, kind, to_date, note, by_email)
    values (p_store, 'plan', v_until, '方案改為「' || case p_plan when 'trial' then '試用' when 'paid' then '付費' else '免費' end || '」' || coalesce('：' || nullif(trim(p_note), ''), ''), _platform_email());
end $$;

create or replace function platform_set_suspended(p_store uuid, p_suspended boolean, p_reason text default '') returns void
language plpgsql volatile security definer set search_path = public as $$
declare s stores;
begin
  perform _require_platform();
  select * into s from stores where id = p_store for update;
  if not found then raise exception '找不到這家商店'; end if;
  if p_suspended and coalesce(trim(p_reason), '') = '' then raise exception '請填寫停用原因（商家後台會看到）'; end if;
  update stores set suspended = p_suspended, suspend_reason = case when p_suspended then trim(p_reason) else '' end where id = p_store;
  insert into platform_billing_log(store_id, kind, note, by_email)
    values (p_store, case when p_suspended then 'suspend' else 'resume' end, coalesce(trim(p_reason), ''), _platform_email());
end $$;

create or replace function platform_save_note(p_store uuid, p_note text) returns void
language plpgsql volatile security definer set search_path = public as $$
begin
  perform _require_platform();
  update stores set platform_note = left(coalesce(p_note, ''), 2000) where id = p_store;
  if not found then raise exception '找不到這家商店'; end if;
end $$;

create or replace function platform_save_settings(p_settings jsonb) returns void
language plpgsql volatile security definer set search_path = public as $$
declare v jsonb;
begin
  perform _require_platform();
  v := jsonb_build_object(
    'platformName', trim(coalesce(p_settings ->> 'platformName', '')),
    'annualFee', (p_settings ->> 'annualFee')::int,
    'trialDays', (p_settings ->> 'trialDays')::int,
    'signupOpen', coalesce((p_settings ->> 'signupOpen')::boolean, false),
    'maxStoresPerUser', (p_settings ->> 'maxStoresPerUser')::int,
    'contactEmail', trim(coalesce(p_settings ->> 'contactEmail', '')),
    'contactLine', trim(coalesce(p_settings ->> 'contactLine', '')));
  if v ->> 'platformName' = '' then raise exception '請填寫平台名稱'; end if;
  if (v ->> 'annualFee') is null or (v ->> 'annualFee')::int < 0 then raise exception '年費金額不正確'; end if;
  if (v ->> 'trialDays') is null or (v ->> 'trialDays')::int not between 0 and 90 then raise exception '試用天數要 0～90 天'; end if;
  if (v ->> 'maxStoresPerUser') is null or (v ->> 'maxStoresPerUser')::int not between 1 and 20 then raise exception '每個帳號可開店數要 1～20'; end if;
  update platform_settings set settings = v where id = 1;
exception when invalid_text_representation then raise exception '數字欄位請填整數';
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

-- 把某個已註冊的帳號設成「平台管理者」（可以進平台總控台 #platform）
-- 用法：select setup_platform_admin('你註冊用的email');
create or replace function setup_platform_admin(p_email text) returns text
language plpgsql volatile security definer set search_path = public as $$
declare uid uuid;
begin
  select id into uid from auth.users where lower(email) = lower(trim(p_email));
  if uid is null then raise exception '找不到帳號 %，請先到網站後台按「建立帳號」註冊', p_email; end if;
  insert into platform_admins(user_id) values (uid) on conflict do nothing;
  return '完成：' || p_email || ' 已經是平台管理者';
end $$;

-- 建立範例商店「晨霧選物」（已經存在就跳過）
create or replace function setup_demo_store() returns text
language plpgsql volatile security definer set search_path = public as $$
declare sid uuid; c_home uuid; c_wear uuid; c_scent uuid; pid uuid;
begin
  if exists (select 1 from stores where slug = 'demo') then return '範例商店已經存在，沒有變更'; end if;
  insert into stores(slug, plan, settings) values ('demo', 'free', jsonb_build_object(
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
  shop_order_lookup(text, text, text), shop_cancel_order(text, text, text), platform_public(), admin_invite_info(uuid), shop_reviews(text, uuid, int) to anon, authenticated;
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
  shop_my_orders(text), shop_member_cancel(text, text), is_store_member(text),
  admin_slug_available(text), admin_create_store(text, text),
  admin_search_orders(uuid, text, text, date, date, int, int), admin_get_order(uuid, text), admin_customer_orders(uuid, uuid),
  admin_report(uuid, date, date), admin_reviews(uuid, text, int, int, int), admin_review_set(uuid, uuid, text), admin_review_reply(uuid, uuid, text),
  shop_my_reviewables(text), shop_review_save(text, text, uuid, int, text), admin_sort_products(uuid, uuid[]), admin_duplicate_product(uuid, uuid), admin_save_products_bulk(uuid, jsonb), admin_bulk_set_status(uuid, uuid[], text, jsonb), admin_refund_order(uuid, uuid, jsonb, int, boolean, text),
  admin_staff_list(uuid), admin_invite_staff(uuid, text, text[]), admin_cancel_invite(uuid, uuid), admin_update_staff(uuid, uuid, text[]),
  admin_remove_staff(uuid, uuid), admin_leave_store(uuid), admin_accept_invite(uuid),
  platform_me(), platform_overview(), platform_record_payment(uuid, int, int, text), platform_set_until(uuid, date, text),
  platform_set_plan(uuid, text, text), platform_set_suspended(uuid, boolean, text), platform_save_note(uuid, text),
  platform_save_settings(jsonb) to authenticated;

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

-- 頻率限制紀錄只需要保留一天
delete from rate_events where at < now() - interval '1 day';

select '完成：資料庫是 v0.16 版' as result;
