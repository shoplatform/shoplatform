/* =========================================================
 * db.js — 資料層（Supabase 資料庫版，v0.16）
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
  const DEFAULT_SLUG = cfg.storeSlug || "demo";
  const cleanSlug = v => { v = String(v || "").trim().toLowerCase(); return /^[a-z0-9-]{2,40}$/.test(v) ? v : ""; };
  // 商店網址：?store=<代號>。前台沒帶代號時用範例商店；後台登入後依帳號決定是哪一家
  let SLUG = cleanSlug(new URLSearchParams(location.search).get("store"));
  const shopSlug = () => SLUG || DEFAULT_SLUG;
  // 商家後台和前台顧客分成兩個登入狀態，互不影響（店主去逛前台不會被當成顧客，反之亦然）
  // 前台的登入狀態每家店分開存
  const mkClient = key => window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, flowType: "pkce", storageKey: `shopPlatform.${key}` },
  });
  const sbAdmin = mkClient("admin");
  let sbShopC = null, sbShopSlug = null;
  function shopClient() {
    if (sbShopSlug !== shopSlug()) {
      sbShopC = mkClient("shop." + shopSlug()); sbShopSlug = shopSlug();
      cache.shop = null; cache.member = null; cache.myOrders = []; memberLoaded = false; shopUser = null;
      cartState = readCart();
    }
    return sbShopC;
  }
  const IMAGE_BUCKET = "product-images";
  const baseUrl = () => location.origin + location.pathname;
  // 產生網址：linkUrl({ next: "shop" }, "abc") → …/?store=abc&next=shop
  const linkUrl = (extra, slug) => {
    const q = new URLSearchParams();
    if (slug) q.set("store", slug);
    Object.entries(extra || {}).forEach(([k, v]) => q.set(k, v));
    const t = q.toString();
    return baseUrl() + (t ? "?" + t : "");
  };
  const storeUrl = slug => linkUrl({}, slug);

  // memberAuth：前台會員用 Email 帳號（離線示範版用手機）
  const features = { members: true, images: true, inventory: true, tiers: true, reset: false, memberAuth: "email", platform: true, staff: true };

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
    if (/New password should be different/i.test(m)) return "新密碼不能和舊密碼一樣";
    if (/row-level security|Unauthorized/i.test(m)) return "沒有權限上傳，請重新登入後台";
    if (/exceeded the maximum allowed size|Payload too large/i.test(m)) return "圖片太大（上限 2MB）";
    if (/mime type/i.test(m)) return "只能上傳 JPG、PNG、WebP 圖片";
    if (/permission denied|JWT|not authorized/i.test(m)) return "沒有權限，請重新登入";
    return m || "發生錯誤，請再試一次";
  }
  async function call(client, fn, args) {
    let r;
    try { r = await client.rpc(fn, args || {}); } catch (e) { throw new Error(friendly(e)); }
    if (r.error) throw new Error(friendly(r.error));
    return r.data;
  }
  // 後台與平台函式用商家的登入狀態，前台函式用顧客的
  const rpc = (fn, args) => call(fn.startsWith("admin_") || (fn.startsWith("platform_") && fn !== "platform_public") ? sbAdmin : shopClient(), fn, args);

  /* ---------- 從 Email 連結回來（確認信、重設密碼）----------
   * 連結會帶 ?code=...&next=admin|shop|reset，用發出請求的那個登入狀態換成登入 */
  let notice = null;
  const takeNotice = () => { const n = notice; notice = null; return n; };
  let landing = null;
  // 網站一打開先處理 Email 連結，再決定要顯示前台還是後台
  const boot = () => (landing = landing || handleLanding().catch(() => {}));
  async function handleLanding() {
    const qs = new URLSearchParams(location.search);
    const next = qs.get("next");
    if (!next || !(qs.get("code") || qs.get("error_description") || qs.get("error"))) return;
    let hash = next === "admin" ? "#admin" : next === "reset" ? "#shop/reset" : "#shop/account";
    try {
      if (qs.get("error_description") || qs.get("error")) throw new Error(qs.get("error_description") || qs.get("error"));
      const client = next === "admin" ? sbAdmin : shopClient();
      const r = await client.auth.exchangeCodeForSession(qs.get("code"));
      if (r.error) throw r.error;
      notice = { kind: "ok", text: next === "reset" ? "請設定新密碼" : "Email 已確認，歡迎！" };
    } catch (e) {
      // 常見原因：在另一個瀏覽器／手機打開確認信。信箱其實已經確認，直接登入就好
      notice = next === "reset"
        ? { kind: "error", text: "重設密碼連結已失效，或是在不同的瀏覽器打開。請在同一個瀏覽器重新申請一次。" }
        : { kind: "ok", text: "Email 已確認，請用剛剛的 Email 和密碼登入" };
      if (next === "reset") hash = "#shop/forgot";
      else if (next === "shop") hash = "#shop/login";
    }
    history.replaceState(null, "", linkUrl({}, SLUG) + hash);
    if (window.UI && window.UI.Router) window.UI.Router.current = hash.slice(1);
  }

  /* ---------- 快取：前台（公開目錄）與後台（整家店）分開 ---------- */
  const cache = { shop: null, admin: null, member: null, myOrders: [], platform: null, home: null };
  let side = "shop";
  const C = () => (side === "admin" ? cache.admin : side === "shop" ? cache.shop : null) || cache.shop || empty();
  function empty() {
    return { settings: { name: "", tagline: "", email: "", phone: "", freeShippingThreshold: 0, lowStockAlert: 3, shippingMethods: [], paymentMethods: [] },
      categories: [], products: [], customers: [], orders: [], coupons: [], promotions: [], store: {},
      memberTiers: { enabled: false, period: "all", tiers: [] }, suppliers: [], purchases: [], movements: [], loadedAt: 0 };
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
    const d = normalize(await rpc("shop_catalog", { p_slug: shopSlug() }));
    cache.shop = Object.assign(empty(), d, { loadedAt: Date.now() });
  }
  // 前台會員：有登入就載入會員資料和訂單
  async function loadMember() {
    const { data } = await shopClient().auth.getSession();
    shopUser = data && data.session ? data.session.user : null;
    if (!shopUser) { cache.member = null; cache.myOrders = []; return; }
    cache.member = await rpc("shop_member_me", { p_slug: shopSlug() });
    cache.myOrders = cache.member ? await rpc("shop_my_orders", { p_slug: shopSlug() }) : [];
  }
  async function loadAdmin() {
    const d = normalize(await rpc("admin_bootstrap", { p_store: adminStore.id }));
    cache.admin = Object.assign(empty(), d, { loadedAt: Date.now() });
    extraOrders = {};
    notify();
  }

  /* ---------- 後台登入、選商店、開新店 ---------- */
  let adminStore = null, adminUser = null, shopUser = null;
  let myStores = null, isPlatform = false;
  const LAST_KEY = "shopPlatform.lastStore";
  const remember = slug => { try { localStorage.setItem(LAST_KEY, slug); } catch (e) { /* 忽略 */ } };
  const lastStore = () => { try { return localStorage.getItem(LAST_KEY) || ""; } catch (e) { return ""; } };
  const resetAdmin = () => { adminStore = null; cache.admin = null; myStores = null; isPlatform = false; cache.platform = null; };
  const admin = {
    user: () => adminUser && { email: adminUser.email, id: adminUser.id },
    store: () => adminStore,
    stores: () => clone(myStores || []),
    isPlatform: () => isPlatform,
    storeUrl,
    billing: () => (cache.admin && cache.admin.billing) || null,
    // 自己在這家店的身分：owner 店主／staff 員工（perms 是勾選的權限）
    me: () => (cache.admin && cache.admin.me) || { role: "owner", perms: [] },
    can(p) {
      const me = admin.me();
      if (me.role === "owner") return true;
      if (p === "owner") return false;
      if (p === "cost") return me.perms.includes("inventory") || me.perms.includes("reports");
      return me.perms.includes(p);
    },
    platformInfo: () => (cache.admin && cache.admin.platform) || {},
    async login(email, password) {
      const r = await sbAdmin.auth.signInWithPassword({ email: String(email || "").trim(), password });
      if (r.error) throw new Error(friendly(r.error));
      adminUser = r.data.user; resetAdmin();
    },
    /* 回傳 { needConfirm: true } 代表要先去信箱點確認連結 */
    async signup(email, password) {
      const r = await sbAdmin.auth.signUp({ email: String(email || "").trim(), password,
        options: { emailRedirectTo: linkUrl({ next: "admin" }, SLUG) } });
      if (r.error) throw new Error(friendly(r.error));
      if (r.data.session) { adminUser = r.data.user; return { needConfirm: false }; }
      return { needConfirm: true };
    },
    async logout() {
      await sbAdmin.auth.signOut({ scope: "local" }).catch(() => {});
      adminUser = null; resetAdmin();
    },
    refresh: () => loadAdmin(),
    recheck: () => resetAdmin(),   // 重新確認權限（例如剛在 SQL Editor 設定完平台管理者）
    // 切換到另一家自己的商店（網址改成 ?store=<代號>）
    useStore(slug) {
      const st = (myStores || []).find(x => x.slug === slug);
      if (!st) throw new Error("找不到這家商店");
      adminStore = st; cache.admin = null; SLUG = slug; remember(slug);
      history.replaceState(null, "", storeUrl(slug) + location.hash);
    },
    async acceptInvite(token) {
      const r = await rpc("admin_accept_invite", { p_token: token });
      myStores = await rpc("admin_my_stores");
      admin.useStore(r.slug);
      return r;
    },
    async leave() {
      await rpc("admin_leave_store", { p_store: adminStore.id });
      myStores = await rpc("admin_my_stores"); adminStore = null; cache.admin = null; SLUG = "";
      history.replaceState(null, "", baseUrl() + "#admin");
    },
    inviteInfo: token => call(sbAdmin, "admin_invite_info", { p_token: token }),
    async checkSlug(slug) { return rpc("admin_slug_available", { p_slug: slug }); },
    async createStore(name, slug) {
      const r = await rpc("admin_create_store", { p_name: name, p_slug: slug });
      myStores = await rpc("admin_my_stores");
      admin.useStore(r.slug);
      return r;
    },
  };

  /* 平台首頁的公開資訊（年費、試用天數…） */
  async function loadHome() {
    if (!cache.home) { try { cache.home = await call(sbAdmin, "platform_public"); } catch (e) { cache.home = { platformName: "開店平台", annualFee: 0, trialDays: 0, signupOpen: false, error: e.message }; } }
    return cache.home;
  }
  const home = { info: () => clone(cache.home || {}), load: loadHome };

  /* 進入頁面前呼叫。回傳 {state}：
   *   後台：ok／login（要登入）／nostore（還沒有商店，可以開店）／pick（有好幾家，選一家）
   *   平台：ok／login／denied（不是平台管理者） */
  let memberLoaded = false;
  async function ready(which) {
    await boot();
    side = which === "admin" ? "admin" : which === "platform" ? "platform" : which === "home" ? "home" : "shop";
    if (side === "home") { await loadHome(); return { state: "ok" }; }
    if (side === "shop") {
      shopClient();
      if (!cache.shop || Date.now() - cache.shop.loadedAt > 60000) await Promise.all([loadShop(), loadHome()]);
      if (!memberLoaded) { await loadMember(); await autoJoin(); memberLoaded = true; }
      return { state: "ok" };
    }
    const { data } = await sbAdmin.auth.getSession();
    const sess = data && data.session;
    if (!sess) { adminUser = null; resetAdmin(); return { state: "login" }; }
    if (!adminUser || adminUser.id !== sess.user.id) resetAdmin();
    adminUser = sess.user;
    if (!myStores) { [myStores, isPlatform] = await Promise.all([rpc("admin_my_stores"), rpc("platform_me")]); }
    if (side === "platform") {
      if (!isPlatform) return { state: "denied", email: adminUser.email };
      if (!cache.platform || Date.now() - cache.platform.loadedAt > 10000) await loadPlatform();
      return { state: "ok" };
    }
    if (!adminStore) {
      await loadHome();
      if (!myStores.length) return { state: "nostore", email: adminUser.email, home: clone(cache.home) };
      let pick = SLUG ? myStores.find(x => x.slug === SLUG) : null;
      if (!pick && !SLUG) pick = myStores.length === 1 ? myStores[0] : myStores.find(x => x.slug === lastStore());
      if (!pick) return { state: "pick", email: adminUser.email, stores: clone(myStores), wanted: SLUG };
      admin.useStore(pick.slug);
    }
    if (!cache.admin || Date.now() - cache.admin.loadedAt > 10000) await loadAdmin();
    return { state: "ok" };
  }

  /* ---------- 平台總控台 ---------- */
  async function loadPlatform() {
    const d = await rpc("platform_overview");
    cache.platform = Object.assign(d, { loadedAt: Date.now() });
  }
  const afterPlatform = async () => { await loadPlatform(); };
  const platform = {
    data: () => clone(cache.platform || { stores: [], log: [], settings: {} }),
    store: id => clone(((cache.platform || {}).stores || []).find(x => x.id === id) || null),
    async recordPayment(store, years, amount, note) { const r = await rpc("platform_record_payment", { p_store: store, p_years: +years, p_amount: +amount, p_note: note || "" }); await afterPlatform(); return r; },
    async setUntil(store, until, note) { await rpc("platform_set_until", { p_store: store, p_until: until, p_note: note || "" }); await afterPlatform(); },
    async setPlan(store, plan, note) { await rpc("platform_set_plan", { p_store: store, p_plan: plan, p_note: note || "" }); await afterPlatform(); },
    async setSuspended(store, on, reason) { await rpc("platform_set_suspended", { p_store: store, p_suspended: !!on, p_reason: reason || "" }); await afterPlatform(); },
    async saveNote(store, note) { await rpc("platform_save_note", { p_store: store, p_note: note || "" }); await afterPlatform(); },
    async saveSettings(v) { await rpc("platform_save_settings", { p_settings: v }); cache.home = null; await afterPlatform(); },
    reload: () => loadPlatform(),
  };
  // 寫入後重新載入後台快取
  const afterWrite = async () => { await loadAdmin(); };

  const STATUS = { pending_payment: "待付款", paid: "待出貨", shipped: "已出貨", completed: "已完成", cancelled: "已取消" };

  /* ---------- 商店設定 ---------- */
  const settings = {
    get: () => clone(C().settings),
    async update(patch) {
      const before = ((cache.admin.settings.theme || {}).logo || {}).path;
      await rpc("admin_save_settings", { p_store: adminStore.id, p_settings: Object.assign(clone(cache.admin.settings), clone(patch)) });
      await afterWrite();
      // 換掉或移除的 Logo 檔案一起刪掉
      const after = ((cache.admin.settings.theme || {}).logo || {}).path;
      if (before && before !== after) await media.removeFiles([before]);
    },
  };

  /* ---------- 分類 ---------- */
  const categories = {
    list: () => clone(C().categories),
    async add(name) { await rpc("admin_save_category", { p_store: adminStore.id, p_id: null, p_name: name }); await afterWrite(); },
    async rename(id, name) { await rpc("admin_save_category", { p_store: adminStore.id, p_id: id, p_name: name }); await afterWrite(); },
    async remove(id) { await rpc("admin_delete_category", { p_store: adminStore.id, p_id: id }); await afterWrite(); },
    productCount: id => C().products.filter(p => p.categoryIds.includes(id)).length,
  };

  /* ---------- 商品圖片：縮小後上傳到 Supabase Storage ----------
   * 路徑：<商店編號>/<隨機名稱>.jpg；只有這家店的管理者能上傳（權限在 schema.sql） */
  const uid = p => p + "_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const media = {
    MAX_PER_PRODUCT: 8,
    MAX_SOURCE_MB: 15,
    ACCEPT: ["image/jpeg", "image/png", "image/webp", "image/gif"],
    async prepare(file) {
      if (!file || !media.ACCEPT.includes(file.type)) throw new Error(`「${file && file.name}」不是支援的圖片格式（JPG、PNG、WebP、GIF）`);
      if (file.size > media.MAX_SOURCE_MB * 1024 * 1024) throw new Error(`「${file.name}」超過 ${media.MAX_SOURCE_MB}MB`);
      const bmp = await decode(file);
      let out = await toJpegBlob(bmp, 1200, 0.82);
      if (out.blob.size > 400000) out = await toJpegBlob(bmp, 1000, 0.75);
      if (bmp.close) bmp.close();
      const id = uid("img");
      const path = `${adminStore.id}/${id}.jpg`;
      const r = await sbAdmin.storage.from(IMAGE_BUCKET).upload(path, out.blob, { contentType: "image/jpeg", cacheControl: "31536000", upsert: false });
      if (r.error) throw new Error(friendly(r.error));
      const url = sbAdmin.storage.from(IMAGE_BUCKET).getPublicUrl(path).data.publicUrl;
      return { id, url, path, width: out.width, height: out.height, name: file.name };
    },
    // Logo：保留透明背景（PNG），長邊最多 480px，存到 <商店編號>/logo_xxx.png
    async prepareLogo(file) {
      if (!file || !media.ACCEPT.includes(file.type) || file.type === "image/gif") throw new Error("Logo 要是 JPG、PNG、WebP 圖片");
      if (file.size > 5 * 1024 * 1024) throw new Error("Logo 檔案太大（上限 5MB）");
      const bmp = await decode(file);
      const w0 = bmp.width || bmp.naturalWidth, h0 = bmp.height || bmp.naturalHeight, k = Math.min(1, 480 / Math.max(w0, h0));
      const cv = document.createElement("canvas"); cv.width = Math.max(1, Math.round(w0 * k)); cv.height = Math.max(1, Math.round(h0 * k));
      cv.getContext("2d").drawImage(bmp, 0, 0, cv.width, cv.height);
      if (bmp.close) bmp.close();
      const blob = await new Promise((res, rej) => cv.toBlob(b => b ? res(b) : rej(new Error("圖片轉檔失敗")), "image/png"));
      const path = `${adminStore.id}/${uid("logo")}.png`;
      const r = await sbAdmin.storage.from(IMAGE_BUCKET).upload(path, blob, { contentType: "image/png", cacheControl: "31536000", upsert: false });
      if (r.error) throw new Error(friendly(r.error));
      return { url: sbAdmin.storage.from(IMAGE_BUCKET).getPublicUrl(path).data.publicUrl, path, width: cv.width, height: cv.height };
    },
    usage: () => null,   // 雲端儲存不用顯示瀏覽器容量
    async removeFiles(paths) {
      paths = (paths || []).filter(Boolean);
      if (!paths.length) return;
      await sbAdmin.storage.from(IMAGE_BUCKET).remove(paths).catch(() => {});
    },
  };
  async function decode(file) {
    if (window.createImageBitmap) {
      try { return await createImageBitmap(file, { imageOrientation: "from-image" }); } catch (e) { /* 改用 <img> */ }
    }
    const url = URL.createObjectURL(file);
    try {
      return await new Promise((resolve, reject) => {
        const im = new Image();
        im.onload = () => resolve(im);
        im.onerror = () => reject(new Error(`「${file.name}」無法讀取，檔案可能損壞`));
        im.src = url;
      });
    } finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
  }
  function toJpegBlob(src, maxEdge, quality) {
    const w0 = src.width || src.naturalWidth, h0 = src.height || src.naturalHeight;
    const scale = Math.min(1, maxEdge / Math.max(w0, h0));
    const w = Math.max(1, Math.round(w0 * scale)), h = Math.max(1, Math.round(h0 * scale));
    const cv = document.createElement("canvas");
    cv.width = w; cv.height = h;
    const ctx = cv.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(src, 0, 0, w, h);
    return new Promise((resolve, reject) => cv.toBlob(b => b ? resolve({ blob: b, width: w, height: h }) : reject(new Error("圖片轉檔失敗")), "image/jpeg", quality));
  }

  /* ---------- 商品 ---------- */
  const products = {
    // live：只要前台看得到的（上架中、在排程時間內）
    list({ q = "", categoryId = "", status = "", live = false } = {}) {
      q = q.trim().toLowerCase();
      return clone(C().products.filter(p =>
        (!q || p.name.toLowerCase().includes(q) || p.variants.some(v => v.sku.toLowerCase().includes(q))) &&
        (!categoryId || p.categoryIds.includes(categoryId)) &&
        (!status || p.status === status) && (!live || products.isLive(p))
      ).sort((a, b) => (a.sort || 0) - (b.sort || 0) || b.createdAt.localeCompare(a.createdAt)));
    },
    // 排程：上架中，而且現在在「上架時間～自動下架時間」之間
    isLive(p) {
      if (!p || p.status !== "active") return false;
      const now = Date.now();
      return (!p.publishAt || new Date(p.publishAt).getTime() <= now) && (!p.unpublishAt || new Date(p.unpublishAt).getTime() > now);
    },
    schedule(p) {   // 後台顯示用：live／scheduled（還沒到上架時間）／ended（已自動下架）／draft
      if (p.status !== "active") return "draft";
      if (p.publishAt && new Date(p.publishAt).getTime() > Date.now()) return "scheduled";
      if (p.unpublishAt && new Date(p.unpublishAt).getTime() <= Date.now()) return "ended";
      return "live";
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
        publishAt: input.publishAt || null, unpublishAt: input.unpublishAt || null,
        color: input.color || "", categoryIds: input.categoryIds || [], options: input.options || [],
        images: (input.images || []).map(im => ({ id: im.id, url: im.url, path: im.path, width: im.width, height: im.height })),
        variants: input.variants.map(v => ({
          id: v.id && !String(v.id).startsWith("new_") ? v.id : null,
          sku: v.sku, options: v.options, price: Math.floor(v.price), cost: Math.max(0, Math.round(+v.cost || 0)),
          stockDelta: Math.floor(v.stock) - (was[v.id] !== undefined ? was[v.id] : 0),
        })),
      };
      const id = await rpc("admin_save_product", { p_store: adminStore.id, p_product: payload });
      // 儲存成功後，把這次拿掉的圖片從雲端刪掉
      const keep = new Set(payload.images.map(im => im.path));
      await media.removeFiles(((original && original.images) || []).map(im => im.path).filter(pth => pth && !keep.has(pth)));
      await afterWrite();
      return products.get(id);
    },
    async sortOrder(ids) { await rpc("admin_sort_products", { p_store: adminStore.id, p_ids: ids }); await afterWrite(); },
    async duplicate(id) { const nid = await rpc("admin_duplicate_product", { p_store: adminStore.id, p_id: id }); await afterWrite(); return nid; },
    // 匯入：一次存很多個（全部成功才生效）
    async saveMany(list) {
      const payload = list.map(p => Object.assign({}, p, { variants: p.variants.map(v => ({ id: v.id, sku: v.sku, options: v.options, price: v.price, cost: v.cost, stockDelta: v.stockDelta || 0 })) }));
      const ids = await rpc("admin_save_products_bulk", { p_store: adminStore.id, p_products: payload });
      await afterWrite();
      return ids;
    },
    async remove(id) {
      const p = C().products.find(x => x.id === id);
      await rpc("admin_delete_product", { p_store: adminStore.id, p_id: id });
      await media.removeFiles(((p && p.images) || []).map(im => im.path));
      await afterWrite();
    },
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
    // 累積消費、訂單數由伺服器算「全部訂單」（後台只載入近期訂單）
    summary(id) {
      const x = (C().customerStats || {})[id];
      return x ? { orderCount: x.n, totalSpent: x.spent, lastOrderAt: x.last || "" } : { orderCount: 0, totalSpent: 0, lastOrderAt: "" };
    },
  };

  const notYet = async () => { throw new Error("這個功能在資料庫版還沒開放"); };

  /* ---------- 前台會員（Email 帳號） ----------
   * 註冊 → 到信箱點確認連結 → 回到網站自動登入 → 加入這家店的會員（姓名、手機）
   * 以前用同一個 Email 下過的訂單會自動接上 */
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  // 註冊時填的姓名、手機存在帳號資料裡，第一次登入（或點確認信回來）時自動加入會員
  async function autoJoin() {
    if (!shopUser || cache.member) return;
    const meta = shopUser.user_metadata || {};
    if (!meta.name || !meta.phone) return;
    try { cache.member = await rpc("shop_member_join", { p_slug: shopSlug(), p_name: meta.name, p_phone: meta.phone }); cache.myOrders = await rpc("shop_my_orders", { p_slug: shopSlug() }); }
    catch (e) { /* 資料不完整就讓使用者自己補 */ }
  }
  async function afterShopLogin() {
    await loadMember();
    await autoJoin();
    notify();
  }
  const auth = {
    mode: "email",
    current: () => (cache.member ? clone(cache.member) : null),
    session: () => (shopUser ? { email: shopUser.email } : null),   // 已登入但還沒完成會員資料
    hasAccount: () => false,
    async signup({ email, password, name, phone }) {
      email = String(email || "").trim(); name = String(name || "").trim(); phone = String(phone || "").replace(/[\s-]/g, "");
      if (!EMAIL_RE.test(email)) throw new Error("Email 格式不正確");
      if (!name) throw new Error("請填寫姓名");
      if (!/^09\d{8}$/.test(phone)) throw new Error("手機格式應為 09 開頭共 10 碼");
      if (String(password || "").length < 8) throw new Error("密碼至少 8 個字元");
      const r = await shopClient().auth.signUp({ email, password, options: { data: { name, phone }, emailRedirectTo: linkUrl({ next: "shop" }, shopSlug()) } });
      if (r.error) throw new Error(friendly(r.error));
      if (r.data.session) { await afterShopLogin(); return { needConfirm: false }; }
      return { needConfirm: true };
    },
    async login(email, password) {
      const r = await shopClient().auth.signInWithPassword({ email: String(email || "").trim(), password });
      if (r.error) throw new Error(friendly(r.error));
      await afterShopLogin();
      return auth.current();
    },
    async join({ name, phone }) {
      cache.member = await rpc("shop_member_join", { p_slug: shopSlug(), p_name: name, p_phone: String(phone || "").replace(/[\s-]/g, "") });
      cache.myOrders = await rpc("shop_my_orders", { p_slug: shopSlug() });
      notify();
      return auth.current();
    },
    async logout() {
      await shopClient().auth.signOut({ scope: "local" }).catch(() => {});
      shopUser = null; cache.member = null; cache.myOrders = []; notify();
    },
    async updateProfile({ name, phone }) {
      cache.member = await rpc("shop_member_update", { p_slug: shopSlug(), p_name: name, p_phone: String(phone || "").replace(/[\s-]/g, "") });
      notify();
    },
    async changePassword(oldPw, newPw) {
      if (!shopUser) throw new Error("請先登入");
      if (String(newPw || "").length < 8) throw new Error("新密碼至少 8 個字元");
      const check = await shopClient().auth.signInWithPassword({ email: shopUser.email, password: oldPw });
      if (check.error) throw new Error("目前的密碼不正確");
      const r = await shopClient().auth.updateUser({ password: newPw });
      if (r.error) throw new Error(friendly(r.error));
    },
    async requestReset(email) {
      email = String(email || "").trim();
      if (!EMAIL_RE.test(email)) throw new Error("Email 格式不正確");
      const r = await shopClient().auth.resetPasswordForEmail(email, { redirectTo: linkUrl({ next: "reset" }, shopSlug()) });
      if (r.error) throw new Error(friendly(r.error));
    },
    async setNewPassword(pw) {
      if (String(pw || "").length < 8) throw new Error("密碼至少 8 個字元");
      const { data } = await shopClient().auth.getSession();
      if (!data || !data.session) throw new Error("重設密碼連結已失效，請重新申請");
      const r = await shopClient().auth.updateUser({ password: pw });
      if (r.error) throw new Error(friendly(r.error));
      await afterShopLogin();
    },
  };

  /* ---------- 會員等級 ----------
   * 前台：目前會員的等級由資料庫算好（cache.member.level）
   * 後台：從後台快取的訂單自己算（跟資料庫同一套規則） */
  const COUNTED = ["paid", "shipped", "completed"];
  const tiers = {
    get: () => clone((side === "admin" && cache.admin ? cache.admin.memberTiers : (cache.shop || empty()).memberTiers) || { enabled: false, period: "all", tiers: [] }),
    async save(cfg) { await rpc("admin_save_tiers", { p_store: adminStore.id, p_cfg: cfg }); await afterWrite(); },
    spentOf(customerId) {
      const x = (C().customerStats || {})[customerId];
      if (side === "admin" && x) return x.tierSpent;
      const cfgT = tiers.get();
      const since = cfgT.period === "12m" ? Date.now() - 365 * 86400000 : -Infinity;
      return C().orders.filter(o => o.customerId === customerId && COUNTED.includes(o.status) && new Date(o.createdAt).getTime() >= since)
        .reduce((s, o) => s + o.total, 0);
    },
    of(customerId) {
      if (side !== "admin") return cache.member && cache.member.level ? clone(cache.member.level) : null;
      const cfgT = tiers.get();
      if (!cfgT.enabled || !customerId) return null;
      const spent = tiers.spentOf(customerId);
      const list = cfgT.tiers.slice().sort((a, b) => a.minSpend - b.minSpend);
      let idx = 0;
      list.forEach((t, i) => { if (spent >= t.minSpend) idx = i; });
      const next = list[idx + 1] || null;
      return { tier: clone(list[idx]), index: idx, spent, next: next && clone(next), gap: next ? next.minSpend - spent : 0 };
    },
    benefit(t) {
      const parts = [];
      if (t.percent < 100) parts.push(`全館 ${t.percent % 10 === 0 ? t.percent / 10 : t.percent} 折`);
      if (t.freeShip) parts.push("免運");
      return parts.join("、") || "累積消費升級";
    },
  };

  /* ---------- 進銷存：讀取從後台快取算，寫入呼叫資料庫 ---------- */
  const MOVE_TYPES = { sale: "銷售", cancel: "取消加回", purchase: "進貨入庫", adjust: "盤點調整", edit: "商品頁修改", initial: "期初庫存", return: "退貨入庫" };
  function incomingOf(variantId) {
    return C().purchases.filter(po => po.status === "ordered" || po.status === "partial")
      .reduce((s, po) => s + po.items.filter(it => it.variantId === variantId).reduce((a, it) => a + (it.qty - it.received), 0), 0);
  }
  const inventory = {
    MOVE_TYPES,
    ADJUST_REASONS: ["盤點差異", "損壞報廢", "樣品／贈品", "找回", "其他"],
    list({ q = "", filter = "" } = {}) {
      q = q.trim().toLowerCase();
      const limit = C().settings.lowStockAlert;
      const rows = [];
      C().products.forEach(p => p.variants.forEach(v => {
        rows.push({
          productId: p.id, variantId: v.id, name: p.name, color: p.color, image: products.cover(p), status: p.status,
          optionText: Object.values(v.options).join(" / "), sku: v.sku, price: v.price,
          stock: v.stock, cost: v.cost || 0, value: v.stock * (v.cost || 0), incoming: incomingOf(v.id), low: v.stock <= limit,
        });
      }));
      return rows.filter(r =>
        (!q || r.name.toLowerCase().includes(q) || r.sku.toLowerCase().includes(q) || r.optionText.toLowerCase().includes(q)) &&
        (filter !== "low" || r.low) && (filter !== "out" || r.stock === 0)
      ).sort((a, b) => a.name.localeCompare(b.name, "zh-Hant") || a.sku.localeCompare(b.sku));
    },
    summary() {
      const rows = inventory.list();
      return { skus: rows.length, units: rows.reduce((s, r) => s + r.stock, 0), value: rows.reduce((s, r) => s + r.value, 0),
        low: rows.filter(r => r.low && r.status === "active").length, incoming: rows.reduce((s, r) => s + r.incoming, 0) };
    },
    async adjust(variantId, { mode, qty, reason, note }) {
      const n = Math.floor(+qty);
      if (!Number.isFinite(n)) throw new Error("請填數量");
      const r = await rpc("admin_adjust_stock", { p_store: adminStore.id, p_variant: variantId, p_mode: mode, p_qty: n, p_reason: reason, p_note: note || "" });
      await afterWrite();
      return r;
    },
    movements({ q = "", type = "", variantId = "", limit = 500 } = {}) {
      q = q.trim().toLowerCase();
      return clone(C().movements.filter(m =>
        (!type || m.type === type) && (!variantId || m.variantId === variantId) &&
        (!q || m.name.toLowerCase().includes(q) || m.sku.toLowerCase().includes(q) || m.ref.toLowerCase().includes(q))
      ).slice(-limit).reverse());
    },
  };
  const suppliers = {
    list() {
      return clone(C().suppliers).map(x => {
        const pos = C().purchases.filter(po => po.supplierId === x.id && po.status !== "cancelled");
        return Object.assign(x, { poCount: pos.length, lastAt: pos.map(po => po.createdAt).sort().pop() || "" });
      }).sort((a, b) => a.name.localeCompare(b.name, "zh-Hant"));
    },
    get: id => { const x = C().suppliers.find(y => y.id === id); return x ? clone(x) : null; },
    async save(input) { const id = await rpc("admin_save_supplier", { p_store: adminStore.id, p_supplier: input }); await afterWrite(); return suppliers.get(id); },
    async remove(id) { await rpc("admin_delete_supplier", { p_store: adminStore.id, p_id: id }); await afterWrite(); },
  };
  const PO_STATUS = { draft: "草稿", ordered: "已下單", partial: "部分入庫", received: "已入庫", cancelled: "已取消" };
  const poTotal = po => po.items.reduce((s, it) => s + it.qty * it.cost, 0);
  const purchases = {
    STATUS: PO_STATUS,
    list({ status = "", q = "" } = {}) {
      q = q.trim().toLowerCase();
      return clone(C().purchases.filter(po =>
        (!status || po.status === status) &&
        (!q || po.number.toLowerCase().includes(q) || po.supplierName.toLowerCase().includes(q) || po.items.some(it => it.name.toLowerCase().includes(q) || it.sku.toLowerCase().includes(q)))
      ).sort((a, b) => b.createdAt.localeCompare(a.createdAt))).map(po => Object.assign(po, { total: poTotal(po) }));
    },
    get: id => { const po = C().purchases.find(x => x.id === id); return po ? Object.assign(clone(po), { total: poTotal(po) }) : null; },
    countByStatus() {
      const out = { all: C().purchases.length };
      Object.keys(PO_STATUS).forEach(k => { out[k] = C().purchases.filter(po => po.status === k).length; });
      return out;
    },
    async save(input) { const id = await rpc("admin_save_purchase", { p_store: adminStore.id, p_po: input }); await afterWrite(); return purchases.get(id); },
    async place(id) { await rpc("admin_place_purchase", { p_store: adminStore.id, p_id: id }); await afterWrite(); },
    async receive(id, qtys, note) { await rpc("admin_receive_purchase", { p_store: adminStore.id, p_id: id, p_qtys: qtys, p_note: note || "" }); await afterWrite(); },
    async cancel(id, note) { await rpc("admin_cancel_purchase", { p_store: adminStore.id, p_id: id, p_note: note || "" }); await afterWrite(); },
    async remove(id) { await rpc("admin_delete_purchase", { p_store: adminStore.id, p_id: id }); await afterWrite(); },
  };

  /* ---------- 購物車（存在這個瀏覽器） ---------- */
  const cartKey = () => "shopPlatform.cart." + shopSlug();
  function readCart() {
    try { const x = JSON.parse(localStorage.getItem(cartKey()) || "null"); return x && Array.isArray(x.lines) ? x : { lines: [], coupon: "" }; }
    catch (e) { return { lines: [], coupon: "" }; }
  }
  let cartState = readCart();
  const saveCart = () => { try { localStorage.setItem(cartKey(), JSON.stringify(cartState)); } catch (e) { /* 無法儲存時只保留在記憶體 */ } notify(); };
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
      p_slug: shopSlug(), p_items: items.map(it => ({ variantId: it.variantId, qty: it.qty })),
      p_ship: shippingMethodId || null, p_coupon: opts.couponCode || null, p_phone: opts.phone || null,
    });
    return q;
  }

  /* ---------- 訂單 ---------- */
  const guestPass = {}; // 這次開啟頁面時下過或查過的訂單（編號 → { view, phone }）
  let extraOrders = {};   // 從搜尋、舊訂單頁拿到的訂單（不在近期清單裡）
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
    get: id => { const o = C().orders.find(x => x.id === id || x.number === id) || (side === "admin" && Object.values(extraOrders).find(x => x.id === id || x.number === id)); return o ? clone(o) : null; },
    countByStatus() {
      const sc = C().statusCounts || {};
      const out = { all: C().orderTotal != null ? C().orderTotal : C().orders.length };
      Object.keys(STATUS).forEach(k => { out[k] = sc[k] || 0; });
      return out;
    },
    byCustomer: id => clone(C().orders.filter(o => o.customerId === id).sort((a, b) => b.createdAt.localeCompare(a.createdAt))),
    /* 分頁查詢（全部訂單，伺服器端）：回傳 { total, rows } */
    async query({ status = "", q = "", from = "", to = "" } = {}, { offset = 0, limit = 50 } = {}) {
      const r = await rpc("admin_search_orders", { p_store: adminStore.id, p_status: status, p_q: q.trim(), p_from: from || null, p_to: to || null, p_offset: offset, p_limit: limit });
      r.rows.forEach(o => { extraOrders[o.id] = o; });
      return clone(r);
    },
    // 打開一筆不在近期清單裡的舊訂單
    async fetch(id) {
      const hit = orders.get(id);
      if (hit) return hit;
      const o = await rpc("admin_get_order", { p_store: adminStore.id, p_id: id });
      if (o) extraOrders[o.id] = o;
      return o ? clone(o) : null;
    },
    // 批次改狀態：回傳 { ok: 成功筆數, failed: [{ number, reason }] }
    async bulkStatus(ids, status, tracking) {
      const r = await rpc("admin_bulk_set_status", { p_store: adminStore.id, p_orders: ids, p_status: status, p_tracking: tracking || {} });
      await afterWrite(); extraOrders = {};
      return r;
    },
    // 退貨／退款：items = [{ variantId, qty }]
    async refund(orderId, { items, amount, restock, reason }) {
      const r = await rpc("admin_refund_order", { p_store: adminStore.id, p_order: orderId, p_items: items || [], p_amount: Math.round(+amount || 0), p_restock: !!restock, p_reason: reason || "" });
      await afterWrite(); delete extraOrders[orderId];
      return r;
    },
    async ofCustomer(id) { return clone(await rpc("admin_customer_orders", { p_store: adminStore.id, p_customer: id })); },
    window: () => ({ loaded: C().orders.length, total: C().orderTotal != null ? C().orderTotal : C().orders.length, days: 120 }),

    /* 前台下單：資料庫檢查庫存、算金額、建立訂單 */
    async create({ contact, shipping, paymentMethodId, note, hp }) {
      const lines = cart.items();
      if (!lines.length) throw new Error("購物車是空的");
      const view = await rpc("shop_place_order", { p_slug: shopSlug(), p_order: {
        items: lines.map(l => ({ variantId: l.variantId, qty: l.qty })),
        contact, shipping, paymentMethodId, note: note || "", coupon: cart.coupon(), hp: hp || "",
      } });
      guestPass[view.number] = { view, phone: contact.phone };
      cart.clear();
      await loadShop().catch(() => {}); // 更新庫存
      if (cache.member) await loadMember().catch(() => {});
      return view;
    },
    async lookup(number, phone) {
      number = String(number || "").trim().toUpperCase();
      phone = String(phone || "").replace(/[\s-]/g, "");
      if (!number || !phone) throw new Error("請填寫訂單編號和手機");
      const view = await rpc("shop_order_lookup", { p_slug: shopSlug(), p_number: number, p_phone: phone });
      if (!view) throw new Error("查不到這筆訂單，請確認訂單編號和下單時填的手機");
      guestPass[view.number] = { view, phone };
      return view;
    },
    mine: () => clone(cache.myOrders || []),
    forCustomer(number) {
      const m = (cache.myOrders || []).find(o => o.number === number);
      if (m) return clone(m);
      return guestPass[number] ? clone(guestPass[number].view) : null;
    },
    async cancelByCustomer(number) {
      if ((cache.myOrders || []).some(o => o.number === number)) {
        await rpc("shop_member_cancel", { p_slug: shopSlug(), p_number: number });
        await loadMember();
      } else {
        const pass = guestPass[number];
        if (!pass) throw new Error("找不到這筆訂單");
        const view = await rpc("shop_cancel_order", { p_slug: shopSlug(), p_number: number, p_phone: pass.phone });
        if (!view) throw new Error("找不到這筆訂單");
        guestPass[number] = { view, phone: pass.phone };
      }
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

  /* ---------- 商品評價 ---------- */
  const reviews = {
    settings: () => Object.assign({ enabled: true, autoPublish: true }, (C().settings || {}).reviews || {}),
    summary: p => ({ avg: p && p.ratingAvg != null ? +p.ratingAvg : null, count: (p && p.ratingCount) || 0 }),
    forProduct: (productId, offset) => rpc("shop_reviews", { p_slug: shopSlug(), p_product: productId, p_offset: offset || 0 }),
    mine: async () => (cache.member ? rpc("shop_my_reviewables", { p_slug: shopSlug() }) : []),
    async save({ orderNumber, productId, rating, content }) {
      const r = await rpc("shop_review_save", { p_slug: shopSlug(), p_order: orderNumber, p_product: productId, p_rating: +rating || 0, p_content: content || "" });
      cache.shop = null;   // 重新載入平均星等
      return r;
    },
    // 後台
    pending: () => (cache.admin && cache.admin.reviewPending) || 0,
    list: ({ status = "", rating = null } = {}, { offset = 0, limit = 50 } = {}) =>
      rpc("admin_reviews", { p_store: adminStore.id, p_status: status, p_rating: rating ? +rating : null, p_offset: offset, p_limit: limit }),
    async setStatus(id, st) { await rpc("admin_review_set", { p_store: adminStore.id, p_id: id, p_status: st }); await afterWrite(); },
    async reply(id, text) { await rpc("admin_review_reply", { p_store: adminStore.id, p_id: id, p_reply: text || "" }); },
  };

  /* ---------- 員工（只有店主能管理） ---------- */
  const staff = {
    list: () => rpc("admin_staff_list", { p_store: adminStore.id }),
    async invite(email, perms) {
      const r = await rpc("admin_invite_staff", { p_store: adminStore.id, p_email: email, p_perms: perms });
      return Object.assign(r, { link: staff.link(r.token) });
    },
    link: token => baseUrl() + "#admin/join/" + token,
    cancelInvite: id => rpc("admin_cancel_invite", { p_store: adminStore.id, p_id: id }),
    update: (userId, perms) => rpc("admin_update_staff", { p_store: adminStore.id, p_user: userId, p_perms: perms }),
    remove: userId => rpc("admin_remove_staff", { p_store: adminStore.id, p_user: userId }),
  };

  /* ---------- 報表：由資料庫計算（全部訂單） ---------- */
  const reports = { get: (from, to) => rpc("admin_report", { p_store: adminStore.id, p_from: from, p_to: to }) };

  window.DB = {
    mode: "remote", features, ready, admin, takeNotice, boot, platform, home,
    shopState: () => ({ closed: !!(cache.shop && cache.shop.closed), message: (cache.shop && cache.shop.closedMessage) || "" }),
    settings, categories, products, media, customers, auth, cart, orders, quote, stats, coupons, promotions, tiers,
    inventory, suppliers, purchases, reports, staff, reviews,
    onChange: fn => listeners.push(fn),
    reset: notYet,
  };
})();
