/* =========================================================
 * db.js — 資料層（Supabase 資料庫版）
 *
 * 頁面只透過 window.DB 讀寫資料，介面跟離線示範版 db-local.js 一樣：
 *   ‧讀取是同步的：從「快取」拿資料（進入頁面前先 DB.ready() 載好）
 *   ‧寫入是非同步的：呼叫資料庫函式，成功後重新載入快取
 *   ‧金額、折扣、扣庫存都由資料庫計算（shop_quote、shop_place_order）
 *
 * 資料庫那邊的函式與權限在 supabase/schema.sql。
 * ========================================================= */
(function () {
  const cfg = window.SHOP_CONFIG || {};
  const sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, {
    auth: { persistSession: true, autoRefreshToken: true, storageKey: "shopPlatform.auth." + cfg.storeSlug },
  });
  const SLUG = cfg.storeSlug;

  // 第一階段還沒搬到資料庫的功能（頁面會顯示「第二階段開放」）
  const features = { members: false, images: false, inventory: false, tiers: false, reset: false };

  const clone = o => JSON.parse(JSON.stringify(o));
  const listeners = [];
  const notify = () => listeners.forEach(fn => fn());
  const money0 = n => "NT$" + Math.round(n).toLocaleString("zh-TW");
  const pad2 = n => String(n).padStart(2, "0");
  const todayYmd = () => { const d = new Date(); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; };

  /* ---------- 錯誤訊息翻成看得懂的話 ---------- */
  function friendly(err) {
    const m = String((err && (err.message || err.msg || err.error_description)) || err || "");
    if (/Failed to fetch|NetworkError|Load failed|fetch failed/i.test(m)) return "連不上資料庫。請確認網路；如果超過一週沒人使用，Supabase 可能暫停了專案，請到 Supabase 後台按「Restore」。";
    if (/Invalid login credentials/i.test(m)) return "Email 或密碼不正確";
    if (/Email not confirmed/i.test(m)) return "這個帳號還沒完成 Email 驗證，請到信箱點確認連結後再登入";
    if (/already registered|already been registered|user_already_exists/i.test(m)) return "這個 Email 已經註冊過，請直接登入";
    if (/Password should be at least/i.test(m)) return "密碼至少 6 個字元";
    if (/rate limit/i.test(m)) return "寄信次數超過上限，請過一小時再試";
    if (/Unable to validate email|invalid format/i.test(m)) return "Email 格式不正確";
    if (/permission denied|JWT|not authorized/i.test(m)) return "沒有權限，請重新登入";
    return m || "發生錯誤，請再試一次";
  }
  async function rpc(fn, args) {
    let r;
    try { r = await sb.rpc(fn, args || {}); } catch (e) { throw new Error(friendly(e)); }
    if (r.error) throw new Error(friendly(r.error));
    return r.data;
  }

  /* ---------- 快取：前台（公開目錄）與後台（整家店）分開 ---------- */
  const cache = { shop: null, admin: null };
  let side = "shop";
  const C = () => cache[side] || cache.shop || empty();
  function empty() {
    return { settings: { name: "", tagline: "", email: "", phone: "", freeShippingThreshold: 0, lowStockAlert: 3, shippingMethods: [], paymentMethods: [] },
      categories: [], products: [], customers: [], orders: [], coupons: [], promotions: [], store: {}, loadedAt: 0 };
  }
  // 規格的 options 依照商品規格順序重排（資料庫存的 JSON 不保留欄位順序）
  function normalize(data) {
    (data.products || []).forEach(p => {
      p.images = p.images || [];
      p.categoryIds = p.categoryIds || [];
      p.variants.forEach(v => {
        const o = {};
        (p.options || []).forEach(opt => { if (v.options && opt.name in v.options) o[opt.name] = v.options[opt.name]; });
        Object.keys(v.options || {}).forEach(k => { if (!(k in o)) o[k] = v.options[k]; });
        v.options = o;
        if (v.cost === undefined) v.cost = 0;
      });
    });
    return data;
  }

  async function loadShop() {
    const d = normalize(await rpc("shop_catalog", { p_slug: SLUG }));
    cache.shop = Object.assign(empty(), d, { loadedAt: Date.now() });
  }
  async function loadAdmin() {
    const d = normalize(await rpc("admin_bootstrap", { p_store: adminStore.id }));
    cache.admin = Object.assign(empty(), d, { loadedAt: Date.now() });
    notify();
  }

  /* ---------- 後台登入 ---------- */
  let adminStore = null, adminUser = null;
  const admin = {
    user: () => adminUser && { email: adminUser.email, id: adminUser.id },
    store: () => adminStore,
    async login(email, password) {
      const r = await sb.auth.signInWithPassword({ email: String(email || "").trim(), password });
      if (r.error) throw new Error(friendly(r.error));
      adminUser = r.data.user; adminStore = null; cache.admin = null;
    },
    /* 回傳 { needConfirm: true } 代表要先去信箱點確認連結 */
    async signup(email, password) {
      const r = await sb.auth.signUp({ email: String(email || "").trim(), password,
        options: { emailRedirectTo: location.href.split("#")[0] + "#admin" } });
      if (r.error) throw new Error(friendly(r.error));
      if (r.data.session) { adminUser = r.data.user; return { needConfirm: false }; }
      return { needConfirm: true };
    },
    async logout() {
      await sb.auth.signOut().catch(() => {});
      adminUser = null; adminStore = null; cache.admin = null;
    },
    refresh: () => loadAdmin(),
  };

  /* 進入頁面前呼叫。回傳 {state}：ok／login（要登入）／nostore（登入了但不是店主） */
  async function ready(which) {
    side = which === "admin" ? "admin" : "shop";
    if (side === "shop") {
      if (!cache.shop || Date.now() - cache.shop.loadedAt > 60000) await loadShop();
      return { state: "ok" };
    }
    const { data } = await sb.auth.getSession();
    const sess = data && data.session;
    if (!sess) { adminUser = null; return { state: "login" }; }
    adminUser = sess.user;
    if (!adminStore) {
      const stores = await rpc("admin_my_stores");
      adminStore = stores.find(s => s.slug === SLUG) || null;
      if (!adminStore) return { state: "nostore", email: adminUser.email, slug: SLUG };
    }
    if (!cache.admin || Date.now() - cache.admin.loadedAt > 10000) await loadAdmin();
    return { state: "ok" };
  }
  // 寫入後重新載入後台快取
  const afterWrite = async () => { await loadAdmin(); };

  const STATUS = { pending_payment: "待付款", paid: "待出貨", shipped: "已出貨", completed: "已完成", cancelled: "已取消" };

  /* ---------- 商店設定 ---------- */
  const settings = {
    get: () => clone(C().settings),
    async update(patch) { await rpc("admin_save_settings", { p_store: adminStore.id, p_settings: Object.assign(clone(cache.admin.settings), clone(patch)) }); await afterWrite(); },
  };

  /* ---------- 分類 ---------- */
  const categories = {
    list: () => clone(C().categories),
    async add(name) { await rpc("admin_save_category", { p_store: adminStore.id, p_id: null, p_name: name }); await afterWrite(); },
    async rename(id, name) { await rpc("admin_save_category", { p_store: adminStore.id, p_id: id, p_name: name }); await afterWrite(); },
    async remove(id) { await rpc("admin_delete_category", { p_store: adminStore.id, p_id: id }); await afterWrite(); },
    productCount: id => C().products.filter(p => p.categoryIds.includes(id)).length,
  };

  /* ---------- 商品圖片（第二階段） ---------- */
  const media = {
    MAX_PER_PRODUCT: 8,
    async prepare() { throw new Error("商品圖片上傳會在第二階段開放"); },
    usage: () => ({ used: 0, budget: 1, ratio: 0 }),
  };

  /* ---------- 商品 ---------- */
  const products = {
    list({ q = "", categoryId = "", status = "" } = {}) {
      q = q.trim().toLowerCase();
      return clone(C().products.filter(p =>
        (!q || p.name.toLowerCase().includes(q) || p.variants.some(v => v.sku.toLowerCase().includes(q))) &&
        (!categoryId || p.categoryIds.includes(categoryId)) &&
        (!status || p.status === status)
      ).sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
    },
    get: id => { const p = C().products.find(x => x.id === id); return p ? clone(p) : null; },
    /* original：打開編輯頁時的商品。庫存用「變動量」送出，不會蓋掉這段時間賣掉的數量 */
    async save(input, original) {
      if (!String(input.name || "").trim()) throw new Error("請輸入商品名稱");
      if (!input.variants || !input.variants.length) throw new Error("至少需要一個規格");
      input.variants.forEach(v => {
        if (!(v.price >= 0)) throw new Error("價格需為 0 以上的數字");
        if (!(v.stock >= 0)) throw new Error("庫存需為 0 以上的整數");
      });
      const was = {};
      ((original && original.variants) || []).forEach(v => { was[v.id] = v.stock; });
      const payload = {
        id: input.id || null, name: input.name.trim(), description: input.description || "", status: input.status,
        color: input.color || "", categoryIds: input.categoryIds || [], options: input.options || [],
        variants: input.variants.map(v => ({
          id: v.id && !String(v.id).startsWith("new_") ? v.id : null,
          sku: v.sku, options: v.options, price: Math.floor(v.price), cost: Math.max(0, Math.round(+v.cost || 0)),
          stockDelta: Math.floor(v.stock) - (was[v.id] !== undefined ? was[v.id] : 0),
        })),
      };
      const id = await rpc("admin_save_product", { p_store: adminStore.id, p_product: payload });
      await afterWrite();
      return products.get(id);
    },
    async remove(id) { await rpc("admin_delete_product", { p_store: adminStore.id, p_id: id }); await afterWrite(); },
    cover: p => (p.images && p.images[0] ? p.images[0].url : ""),
    totalStock: p => p.variants.reduce((s, v) => s + v.stock, 0),
    priceRange(p) { const prices = p.variants.map(v => v.price); return [Math.min(...prices), Math.max(...prices)]; },
    lowStock() {
      const limit = C().settings.lowStockAlert;
      const out = [];
      C().products.filter(p => p.status === "active").forEach(p => p.variants.forEach(v => {
        if (v.stock <= limit) out.push({ product: clone(p), variant: clone(v) });
      }));
      return out.sort((a, b) => a.variant.stock - b.variant.stock);
    },
    newVariantId: () => "new_" + Math.random().toString(36).slice(2, 10),
  };

  /* ---------- 會員（後台看的顧客清單） ---------- */
  const customers = {
    list(q = "") {
      q = q.trim().toLowerCase();
      return C().customers
        .filter(c => !q || [c.name, c.phone, c.email].some(x => (x || "").toLowerCase().includes(q)))
        .map(c => Object.assign(clone(c), customers.summary(c.id)))
        .sort((a, b) => (b.lastOrderAt || b.createdAt).localeCompare(a.lastOrderAt || a.createdAt));
    },
    get(id) { const c = C().customers.find(x => x.id === id); return c ? Object.assign(clone(c), customers.summary(id)) : null; },
    summary(id) {
      const os = C().orders.filter(o => o.customerId === id && o.status !== "cancelled");
      return { orderCount: os.length, totalSpent: os.reduce((s, o) => s + o.total, 0), lastOrderAt: os.map(o => o.createdAt).sort().pop() || "" };
    },
  };

  /* ---------- 前台會員帳號（第二階段） ---------- */
  const notYet = async () => { throw new Error("會員功能會在第二階段開放"); };
  const auth = { current: () => null, hasAccount: () => false, requestCode: notYet, register: notYet, login: notYet, logout: () => {}, updateProfile: notYet, changePassword: notYet };

  /* ---------- 會員等級（第二階段） ---------- */
  const tiers = { get: () => ({ enabled: false, period: "all", tiers: [] }), of: () => null, benefit: () => "", save: notYet, spentOf: () => 0 };

  /* ---------- 進銷存（第二階段） ---------- */
  const inventory = { MOVE_TYPES: {}, ADJUST_REASONS: [], list: () => [], summary: () => ({ skus: 0, units: 0, value: 0, low: 0, incoming: 0 }), adjust: notYet, movements: () => [] };
  const suppliers = { list: () => [], get: () => null, save: notYet, remove: notYet };
  const purchases = { STATUS: {}, list: () => [], get: () => null, countByStatus: () => ({ all: 0, draft: 0, ordered: 0, partial: 0, received: 0, cancelled: 0 }), save: notYet, place: notYet, receive: notYet, cancel: notYet, remove: notYet };

  /* ---------- 購物車（存在這個瀏覽器） ---------- */
  const CART_KEY = "shopPlatform.cart." + SLUG;
  function readCart() {
    try { const x = JSON.parse(localStorage.getItem(CART_KEY) || "null"); return x && Array.isArray(x.lines) ? x : { lines: [], coupon: "" }; }
    catch (e) { return { lines: [], coupon: "" }; }
  }
  let cartState = readCart();
  const saveCart = () => { try { localStorage.setItem(CART_KEY, JSON.stringify(cartState)); } catch (e) { /* 無法儲存時只保留在記憶體 */ } notify(); };
  const findVariant = variantId => {
    for (const p of (cache.shop || empty()).products) { const v = p.variants.find(x => x.id === variantId); if (v) return { p, v }; }
    return null;
  };
  const cart = {
    items() {
      return cartState.lines.map(line => {
        const hit = findVariant(line.variantId);
        if (!hit) return null;
        const { p, v } = hit;
        return { productId: p.id, variantId: v.id, name: p.name, color: p.color, image: products.cover(p),
          optionText: Object.values(v.options).join(" / "), price: v.price, stock: v.stock, qty: Math.min(line.qty, v.stock) };
      }).filter(Boolean);
    },
    count: () => cart.items().reduce((s, x) => s + x.qty, 0),
    add(productId, variantId, qty) {
      const hit = findVariant(variantId);
      if (!hit) throw new Error("找不到這個規格");
      const line = cartState.lines.find(x => x.variantId === variantId);
      const next = (line ? line.qty : 0) + qty;
      if (next > hit.v.stock) throw new Error(`庫存只剩 ${hit.v.stock} 件`);
      if (line) line.qty = next; else cartState.lines.push({ productId, variantId, qty });
      saveCart();
    },
    setQty(variantId, qty) {
      const line = cartState.lines.find(x => x.variantId === variantId);
      if (!line) return;
      if (qty <= 0) cartState.lines = cartState.lines.filter(x => x !== line); else line.qty = qty;
      saveCart();
    },
    clear() { cartState = { lines: [], coupon: "" }; saveCart(); },
    coupon: () => cartState.coupon || "",
    async applyCoupon(code, phone) {
      code = String(code || "").trim().toUpperCase();
      if (!code) throw new Error("請輸入優惠碼");
      const q = await quote(cart.items(), null, { couponCode: code, phone });
      if (q.couponError) throw new Error(q.couponError);
      cartState.coupon = code; saveCart();
      return q;
    },
    removeCoupon() { cartState.coupon = ""; saveCart(); },
  };

  /* ---------- 金額試算（資料庫算） ---------- */
  async function quote(items, shippingMethodId, opts = {}) {
    const q = await rpc("shop_quote", {
      p_slug: SLUG, p_items: items.map(it => ({ variantId: it.variantId, qty: it.qty })),
      p_ship: shippingMethodId || null, p_coupon: opts.couponCode || null, p_phone: opts.phone || null,
    });
    return q;
  }

  /* ---------- 訂單 ---------- */
  const guestPass = {}; // 這次開啟頁面時下過或查過的訂單（編號 → { view, phone }）
  const orders = {
    STATUS,
    list({ status = "", q = "", from = "", to = "" } = {}) {
      q = q.trim().toLowerCase();
      const t0 = from ? new Date(from + "T00:00:00").getTime() : -Infinity;
      const t1 = to ? new Date(to + "T00:00:00").getTime() + 86400000 : Infinity;
      return clone(C().orders.filter(o => {
        const t = new Date(o.createdAt).getTime();
        return (!status || o.status === status) && t >= t0 && t < t1 &&
          (!q || o.number.toLowerCase().includes(q) || o.contact.name.toLowerCase().includes(q) || o.contact.phone.includes(q));
      }).sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
    },
    get: id => { const o = C().orders.find(x => x.id === id || x.number === id); return o ? clone(o) : null; },
    countByStatus() {
      const out = { all: C().orders.length };
      Object.keys(STATUS).forEach(k => { out[k] = C().orders.filter(o => o.status === k).length; });
      return out;
    },
    byCustomer: id => clone(C().orders.filter(o => o.customerId === id).sort((a, b) => b.createdAt.localeCompare(a.createdAt))),

    /* 前台下單：資料庫檢查庫存、算金額、建立訂單 */
    async create({ contact, shipping, paymentMethodId, note }) {
      const lines = cart.items();
      if (!lines.length) throw new Error("購物車是空的");
      const view = await rpc("shop_place_order", { p_slug: SLUG, p_order: {
        items: lines.map(l => ({ variantId: l.variantId, qty: l.qty })),
        contact, shipping, paymentMethodId, note: note || "", coupon: cart.coupon(),
      } });
      guestPass[view.number] = { view, phone: contact.phone };
      cart.clear();
      await loadShop().catch(() => {}); // 更新庫存
      return view;
    },
    async lookup(number, phone) {
      number = String(number || "").trim().toUpperCase();
      phone = String(phone || "").replace(/[\s-]/g, "");
      if (!number || !phone) throw new Error("請填寫訂單編號和手機");
      const view = await rpc("shop_order_lookup", { p_slug: SLUG, p_number: number, p_phone: phone });
      guestPass[view.number] = { view, phone };
      return view;
    },
    mine: () => [],
    forCustomer: number => (guestPass[number] ? clone(guestPass[number].view) : null),
    async cancelByCustomer(number) {
      const pass = guestPass[number];
      if (!pass) throw new Error("找不到這筆訂單");
      const view = await rpc("shop_cancel_order", { p_slug: SLUG, p_number: number, p_phone: pass.phone });
      guestPass[number] = { view, phone: pass.phone };
      await loadShop().catch(() => {});
    },

    /* 後台 */
    async setStatus(id, status, extra = {}) {
      await rpc("admin_set_order_status", { p_store: adminStore.id, p_order: id, p_status: status,
        p_tracking: extra.trackingNo !== undefined ? extra.trackingNo : null, p_note: extra.note || null });
      await afterWrite();
    },
    async setNote(id, note) { await rpc("admin_set_order_note", { p_store: adminStore.id, p_order: id, p_note: note }); await afterWrite(); },
  };

  /* ---------- 行銷：優惠券、滿額活動 ---------- */
  const coupons = {
    TYPES: { amount: "折抵金額", percent: "打折", freeship: "免運" },
    list: () => clone(C().coupons),
    get: id => { const c = C().coupons.find(x => x.id === id); return c ? clone(c) : null; },
    describe(c) {
      const head = c.minSpend > 0 ? `滿 ${money0(c.minSpend)} ` : "";
      if (c.type === "amount") return `${head}折 ${money0(c.value)}`;
      if (c.type === "percent") return `${head}打 ${c.value % 10 === 0 ? c.value / 10 : c.value} 折${c.maxDiscount > 0 ? `（最多折 ${money0(c.maxDiscount)}）` : ""}`;
      return `${head}免運費`;
    },
    async save(input) { const id = await rpc("admin_save_coupon", { p_store: adminStore.id, p_coupon: input }); await afterWrite(); return coupons.get(id); },
    async remove(id) { await rpc("admin_delete_coupon", { p_store: adminStore.id, p_id: id }); await afterWrite(); },
  };
  const periodActive = x => { const t = todayYmd(); return x.enabled !== false && (!x.startAt || t >= x.startAt) && (!x.endAt || t <= x.endAt); };
  const promotions = {
    list: () => clone(C().promotions),
    get: id => { const p = C().promotions.find(x => x.id === id); return p ? clone(p) : null; },
    describe: p => p.tiers.map(t => `滿 ${money0(t.min)} 折 ${money0(t.off)}`).join("、"),
    active: () => clone(C().promotions.filter(periodActive)),
    async save(input) { const id = await rpc("admin_save_promotion", { p_store: adminStore.id, p_promo: input }); await afterWrite(); return promotions.get(id); },
    async remove(id) { await rpc("admin_delete_promotion", { p_store: adminStore.id, p_id: id }); await afterWrite(); },
  };

  /* ---------- 報表（從後台快取算） ---------- */
  function stats() {
    const valid = C().orders.filter(o => o.status !== "cancelled");
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    const since = d => valid.filter(o => new Date(o.createdAt) >= d);
    const sum = arr => arr.reduce((s, o) => s + o.total, 0);
    const daily = [];
    for (let i = 13; i >= 0; i--) {
      const d0 = new Date(today); d0.setDate(d0.getDate() - i);
      const d1 = new Date(d0); d1.setDate(d1.getDate() + 1);
      daily.push({ date: d0, total: sum(valid.filter(o => { const t = new Date(o.createdAt); return t >= d0 && t < d1; })) });
    }
    const monthOrders = since(monthStart);
    return {
      todayRevenue: sum(since(today)), todayOrders: since(today).length,
      monthRevenue: sum(monthOrders), monthOrders: monthOrders.length,
      avgOrder: monthOrders.length ? Math.round(sum(monthOrders) / monthOrders.length) : 0,
      toShip: C().orders.filter(o => o.status === "paid").length,
      toPay: C().orders.filter(o => o.status === "pending_payment").length,
      customers: C().customers.length, daily,
    };
  }

  window.DB = {
    mode: "remote", features, ready, admin,
    settings, categories, products, media, customers, auth, cart, orders, quote, stats, coupons, promotions, tiers,
    inventory, suppliers, purchases,
    onChange: fn => listeners.push(fn),
    reset: notYet,
  };
})();
