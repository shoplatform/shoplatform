/* =========================================================
 * db-local.js — 資料層（離線示範版）
 * 給 demo.html 和預覽網頁用：資料只存在這個瀏覽器。
 * 正式網站用 db.js（接 Supabase），兩邊提供一樣的 window.DB 介面。
 *
 * 目前資料存在瀏覽器的 localStorage（只在你自己的瀏覽器裡）。
 * 所有頁面都只透過 window.DB 讀寫資料，之後換成真正的後端
 * （資料庫 + API）時，只要改這個檔案，頁面程式碼不用動。
 *
 * 多租戶結構：state.stores[storeId] 底下放一家店的所有資料。
 * ========================================================= */
(function () {
  const KEY = "shopPlatform.v1";
  // 瀏覽器給每個網站的 localStorage 大約 500 萬字元；圖片會吃掉大部分空間
  const STORAGE_BUDGET = 5000000;

  function readStorage() {
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }
  /* 寫入成功回傳 true；空間不足或瀏覽器不允許時回傳 false */
  function writeStorage() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); return true; }
    catch (e) { return false; }
  }

  /* 舊版資料升級
   * v1 → v2：商品加上 images 欄位
   * v2 → v3：加上會員登入狀態；示範店的第一位會員補上示範帳號 */
  function migrate(s) {
    Object.values(s.stores).forEach(store => store.products.forEach(p => { if (!Array.isArray(p.images)) p.images = []; }));
    if (!s.sessions) s.sessions = {};
    if ((s.version || 1) < 3 && s.stores.demo) {
      const u1 = s.stores.demo.customers.find(c => c.id === "u_1" && c.phone === "0912345678");
      if (u1 && !u1.auth) { u1.auth = window.DEMO_AUTH; u1.registeredAt = u1.createdAt; }
    }
    // v3 → v4：加上優惠券、滿額活動；示範店補上範例活動
    if ((s.version || 1) < 4) {
      const demo = window.makeSeed().stores.demo;
      Object.values(s.stores).forEach(store => {
        if (!store.coupons) store.coupons = store.id === "demo" ? demo.coupons : [];
        if (!store.promotions) store.promotions = store.id === "demo" ? demo.promotions : [];
      });
      if (s.cartCoupon === undefined) s.cartCoupon = "";
    }
    // v4 → v5：加上會員等級設定；示範店開啟範例等級
    if ((s.version || 1) < 5) {
      const demo = window.makeSeed().stores.demo;
      Object.values(s.stores).forEach(store => {
        if (!store.memberTiers) store.memberTiers = store.id === "demo" ? demo.memberTiers
          : { enabled: false, period: "all", tiers: [{ id: "tier_base", name: "一般會員", minSpend: 0, percent: 100, freeShip: false }] };
      });
    }
    // v5 → v6：進銷存（供應商、進貨單、庫存異動、規格成本）
    if ((s.version || 1) < 6) {
      const demo = window.makeSeed().stores.demo;
      const demoCost = {};
      demo.products.forEach(p => p.variants.forEach(v => { demoCost[v.id] = v.cost; }));
      Object.values(s.stores).forEach(store => {
        store.products.forEach(p => p.variants.forEach(v => { if (v.cost === undefined) v.cost = store.id === "demo" ? (demoCost[v.id] || 0) : 0; }));
        if (!store.suppliers) store.suppliers = store.id === "demo" ? demo.suppliers : [];
        if (!store.purchases) store.purchases = []; // 舊資料不補範例進貨單，避免和現有庫存對不上
        if (!store.movements) store.movements = [];
        if (!store.counters.purchase) store.counters.purchase = 0;
      });
    }
    s.version = 6;
    return s;
  }

  let state = migrate(readStorage() || window.makeSeed());
  writeStorage();

  const clone = o => JSON.parse(JSON.stringify(o));
  const uid = p => p + "_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const S = () => state.stores[state.currentStoreId];
  const notify = () => listeners.forEach(fn => fn());
  const commit = () => { writeStorage(); notify(); };
  const listeners = [];

  const STATUS = {
    pending_payment: "待付款",
    paid: "待出貨",
    shipped: "已出貨",
    completed: "已完成",
    cancelled: "已取消",
  };

  /* ---------- 商店設定 ---------- */
  const settings = {
    get: () => clone(S().settings),
    update(patch) { Object.assign(S().settings, clone(patch)); commit(); },
  };

  /* ---------- 分類 ---------- */
  const categories = {
    list: () => clone(S().categories),
    add(name) {
      name = String(name || "").trim();
      if (!name) throw new Error("請輸入分類名稱");
      if (S().categories.some(c => c.name === name)) throw new Error("已有同名分類");
      const c = { id: uid("c"), name };
      S().categories.push(c); commit(); return clone(c);
    },
    rename(id, name) {
      const c = S().categories.find(x => x.id === id);
      if (c && name.trim()) { c.name = name.trim(); commit(); }
    },
    remove(id) {
      S().categories = S().categories.filter(c => c.id !== id);
      S().products.forEach(p => { p.categoryIds = p.categoryIds.filter(x => x !== id); });
      commit();
    },
    productCount: id => S().products.filter(p => p.categoryIds.includes(id)).length,
  };

  /* ---------- 商品圖片 ----------
   * 現在：在瀏覽器裡把圖片縮小、轉成 JPEG，存成 data URL。
   * 之後換後端：prepare() 改成「上傳到雲端儲存空間、回傳圖片網址」，
   * 商品資料裡的 images[].url 從 data URL 變成 https 網址，頁面不用改。
   */
  const media = {
    MAX_PER_PRODUCT: 8,
    MAX_SOURCE_MB: 15,
    ACCEPT: ["image/jpeg", "image/png", "image/webp", "image/gif"],
    async prepare(file) {
      if (!file || !media.ACCEPT.includes(file.type)) throw new Error(`「${file && file.name}」不是支援的圖片格式（JPG、PNG、WebP、GIF）`);
      if (file.size > media.MAX_SOURCE_MB * 1024 * 1024) throw new Error(`「${file.name}」超過 ${media.MAX_SOURCE_MB}MB`);
      const bmp = await decode(file);
      // 先試 1200px，太大就降到 900px、壓縮更多
      let out = toJpeg(bmp, 1200, 0.82);
      if (out.url.length > 300000) out = toJpeg(bmp, 900, 0.74);
      if (bmp.close) bmp.close();
      return { id: uid("img"), url: out.url, width: out.width, height: out.height, name: file.name };
    },
    // Logo：保留透明背景（PNG），長邊最多 480px
    async prepareLogo(file) {
      if (!file || !media.ACCEPT.includes(file.type)) throw new Error("Logo 要是 JPG、PNG、WebP 圖片");
      if (file.size > 5 * 1024 * 1024) throw new Error("Logo 檔案太大（上限 5MB）");
      const bmp = await decode(file);
      const w0 = bmp.width || bmp.naturalWidth, h0 = bmp.height || bmp.naturalHeight, k = Math.min(1, 480 / Math.max(w0, h0));
      const cv = document.createElement("canvas"); cv.width = Math.max(1, Math.round(w0 * k)); cv.height = Math.max(1, Math.round(h0 * k));
      cv.getContext("2d").drawImage(bmp, 0, 0, cv.width, cv.height);
      if (bmp.close) bmp.close();
      return { url: cv.toDataURL("image/png"), width: cv.width, height: cv.height };
    },
    usage() {
      let used = 0;
      try { used = (localStorage.getItem(KEY) || "").length; } catch (e) { /* 無法讀取時當作 0 */ }
      return { used, budget: STORAGE_BUDGET, ratio: Math.min(1, used / STORAGE_BUDGET) };
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
  function toJpeg(src, maxEdge, quality) {
    const w0 = src.width || src.naturalWidth, h0 = src.height || src.naturalHeight;
    const scale = Math.min(1, maxEdge / Math.max(w0, h0));
    const w = Math.max(1, Math.round(w0 * scale)), h = Math.max(1, Math.round(h0 * scale));
    const cv = document.createElement("canvas");
    cv.width = w; cv.height = h;
    const ctx = cv.getContext("2d");
    ctx.fillStyle = "#ffffff"; // 透明背景（PNG）轉成白底
    ctx.fillRect(0, 0, w, h);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(src, 0, 0, w, h);
    return { url: cv.toDataURL("image/jpeg", quality), width: w, height: h };
  }

  /* ---------- 商品 ---------- */
  const products = {
    list({ q = "", categoryId = "", status = "" } = {}) {
      q = q.trim().toLowerCase();
      return clone(S().products.filter(p =>
        (!q || p.name.toLowerCase().includes(q) || p.variants.some(v => v.sku.toLowerCase().includes(q))) &&
        (!categoryId || p.categoryIds.includes(categoryId)) &&
        (!status || p.status === status)
      ).sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
    },
    get: id => { const p = S().products.find(x => x.id === id); return p ? clone(p) : null; },
    save(input) {
      if (!String(input.name || "").trim()) throw new Error("請輸入商品名稱");
      if (!input.variants || !input.variants.length) throw new Error("至少需要一個規格");
      input.variants.forEach(v => {
        if (!(v.price >= 0)) throw new Error("價格需為 0 以上的數字");
        if (!(v.stock >= 0)) throw new Error("庫存需為 0 以上的整數");
      });
      if ((input.images || []).length > media.MAX_PER_PRODUCT) throw new Error(`每個商品最多 ${media.MAX_PER_PRODUCT} 張圖片`);
      const data = clone(input);
      data.name = data.name.trim();
      data.images = (data.images || []).map(im => ({ id: im.id, url: im.url, width: im.width, height: im.height }));
      data.variants.forEach(v => { v.stock = Math.floor(v.stock); v.cost = Math.max(0, Math.round(+v.cost || 0)); });
      const before = JSON.stringify(S().products);
      const movesBefore = S().movements.length;
      const old = data.id ? S().products.find(x => x.id === data.id) : null;
      const oldStock = {};
      if (old) old.variants.forEach(v => { oldStock[v.id] = v.stock; });
      if (!data.id) {
        data.id = uid("p");
        data.createdAt = new Date().toISOString();
        data.color = data.color || pickColor();
        S().products.push(data);
      } else {
        const i = S().products.findIndex(x => x.id === data.id);
        S().products[i] = Object.assign({}, S().products[i], data);
      }
      // 在商品頁直接改庫存，也要留下異動紀錄
      const saved = S().products.find(x => x.id === data.id);
      saved.variants.forEach(v => {
        const was = oldStock[v.id] !== undefined ? oldStock[v.id] : 0;
        if (v.stock !== was) logMove(saved, v, v.stock - was, oldStock[v.id] === undefined ? "initial" : "edit", "", oldStock[v.id] === undefined ? "新增規格的期初庫存" : "在商品頁直接修改庫存");
      });
      if (!writeStorage()) {
        S().products = JSON.parse(before); // 還原，避免畫面和儲存的資料不一致
        S().movements.length = movesBefore;
        throw new Error("瀏覽器儲存空間已滿，請刪掉一些商品圖片再儲存");
      }
      notify(); return clone(data);
    },
    remove(id) { S().products = S().products.filter(p => p.id !== id); commit(); },
    cover: p => (p.images && p.images[0] ? p.images[0].url : ""),
    totalStock: p => p.variants.reduce((s, v) => s + v.stock, 0),
    priceRange(p) {
      const prices = p.variants.map(v => v.price);
      return [Math.min(...prices), Math.max(...prices)];
    },
    lowStock() {
      const limit = S().settings.lowStockAlert;
      const out = [];
      S().products.filter(p => p.status === "active").forEach(p => p.variants.forEach(v => {
        if (v.stock <= limit) out.push({ product: clone(p), variant: clone(v) });
      }));
      return out.sort((a, b) => a.variant.stock - b.variant.stock);
    },
    newVariantId: () => uid("v"),
  };
  /* ---------- 進銷存：庫存異動紀錄 ----------
   * 每一次庫存變動都記一筆：誰（哪個規格）、變多少、變完剩多少、為什麼、哪張單。
   * type：sale 銷售出貨扣庫存｜cancel 訂單取消加回｜purchase 進貨入庫｜
   *       adjust 盤點／手動調整｜edit 在商品頁直接改｜initial 新規格期初庫存
   * 呼叫前要先改好 v.stock，after 記的是改完的數字。
   */
  const MOVE_TYPES = { sale: "銷售", cancel: "取消加回", purchase: "進貨入庫", adjust: "盤點調整", edit: "商品頁修改", initial: "期初庫存" };
  function logMove(p, v, delta, type, ref, note) {
    S().movements.push({
      id: uid("mv"), at: new Date().toISOString(), productId: p.id, variantId: v.id,
      name: p.name, optionText: Object.values(v.options).join(" / "), sku: v.sku,
      delta, after: v.stock, type, ref: ref || "", note: note || "",
    });
  }
  const findVariant = variantId => {
    for (const p of S().products) { const v = p.variants.find(x => x.id === variantId); if (v) return { p, v }; }
    return null;
  };
  // 已下單、還沒入庫完的數量（在途）
  function incomingOf(variantId) {
    return S().purchases.filter(po => po.status === "ordered" || po.status === "partial")
      .reduce((s, po) => s + po.items.filter(it => it.variantId === variantId).reduce((a, it) => a + (it.qty - it.received), 0), 0);
  }

  const inventory = {
    MOVE_TYPES,
    ADJUST_REASONS: ["盤點差異", "損壞報廢", "樣品／贈品", "找回", "其他"],
    /* 所有規格的庫存列表；filter：low 低庫存、out 缺貨 */
    list({ q = "", filter = "" } = {}) {
      q = q.trim().toLowerCase();
      const limit = S().settings.lowStockAlert;
      const rows = [];
      S().products.forEach(p => p.variants.forEach(v => {
        rows.push({
          productId: p.id, variantId: v.id, name: p.name, color: p.color, image: products.cover(p), status: p.status,
          optionText: Object.values(v.options).join(" / "), sku: v.sku, price: v.price,
          stock: v.stock, cost: v.cost || 0, value: v.stock * (v.cost || 0), incoming: incomingOf(v.id),
          low: v.stock <= limit,
        });
      }));
      return rows.filter(r =>
        (!q || r.name.toLowerCase().includes(q) || r.sku.toLowerCase().includes(q) || r.optionText.toLowerCase().includes(q)) &&
        (filter !== "low" || r.low) && (filter !== "out" || r.stock === 0)
      ).sort((a, b) => a.name.localeCompare(b.name, "zh-Hant") || a.sku.localeCompare(b.sku));
    },
    summary() {
      const rows = inventory.list();
      return {
        skus: rows.length,
        units: rows.reduce((s, r) => s + r.stock, 0),
        value: rows.reduce((s, r) => s + r.value, 0),
        low: rows.filter(r => r.low && r.status === "active").length,
        incoming: rows.reduce((s, r) => s + r.incoming, 0),
      };
    },
    /* 盤點／手動調整：mode "set" 直接設成盤點後的數量，"delta" 增減 */
    adjust(variantId, { mode, qty, reason, note }) {
      const hit = findVariant(variantId);
      if (!hit) throw new Error("找不到這個規格");
      qty = Math.floor(+qty);
      if (!Number.isFinite(qty)) throw new Error("請填數量");
      const target = mode === "set" ? qty : hit.v.stock + qty;
      if (target < 0) throw new Error(`調整後庫存不能小於 0（目前 ${hit.v.stock}）`);
      const delta = target - hit.v.stock;
      if (delta === 0) throw new Error("數量沒有變化");
      if (!reason) throw new Error("請選擇調整原因");
      hit.v.stock = target;
      logMove(hit.p, hit.v, delta, "adjust", "", [reason, String(note || "").trim()].filter(Boolean).join("：") + (mode === "set" ? `（盤點實際數量 ${target}）` : ""));
      commit();
      return { stock: target, delta };
    },
    /* 異動紀錄：新的在前 */
    movements({ q = "", type = "", variantId = "", limit = 500 } = {}) {
      q = q.trim().toLowerCase();
      return clone(S().movements.filter(m =>
        (!type || m.type === type) && (!variantId || m.variantId === variantId) &&
        (!q || m.name.toLowerCase().includes(q) || m.sku.toLowerCase().includes(q) || m.ref.toLowerCase().includes(q))
      ).slice(-limit).reverse());
    },
  };

  /* ---------- 進銷存：供應商 ---------- */
  const suppliers = {
    list() {
      return clone(S().suppliers).map(s => {
        const pos = S().purchases.filter(po => po.supplierId === s.id && po.status !== "cancelled");
        return Object.assign(s, { poCount: pos.length, lastAt: pos.map(po => po.createdAt).sort().pop() || "" });
      }).sort((a, b) => a.name.localeCompare(b.name, "zh-Hant"));
    },
    get: id => { const s = S().suppliers.find(x => x.id === id); return s ? clone(s) : null; },
    save(input) {
      const d = clone(input);
      ["name", "contact", "phone", "email", "taxId", "address", "note"].forEach(k => { d[k] = String(d[k] || "").trim(); });
      if (!d.name) throw new Error("請填寫供應商名稱");
      if (d.taxId && !/^\d{8}$/.test(d.taxId)) throw new Error("統一編號是 8 位數字");
      if (d.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email)) throw new Error("Email 格式不正確");
      if (S().suppliers.some(s => s.name === d.name && s.id !== d.id)) throw new Error("已經有同名的供應商");
      if (!d.id) { Object.assign(d, { id: uid("sp"), createdAt: new Date().toISOString() }); S().suppliers.push(d); }
      else { const i = S().suppliers.findIndex(x => x.id === d.id); S().suppliers[i] = Object.assign({}, S().suppliers[i], d); }
      commit(); return clone(d);
    },
    remove(id) {
      if (S().purchases.some(po => po.supplierId === id && (po.status === "ordered" || po.status === "partial"))) throw new Error("這個供應商還有未入庫的進貨單，先處理完再刪除");
      S().suppliers = S().suppliers.filter(s => s.id !== id); commit();
    },
  };

  /* ---------- 進銷存：進貨單 ----------
   * 流程：草稿 draft → 已下單 ordered → 部分入庫 partial → 已入庫 received；可取消 cancelled
   * 入庫時：加庫存、寫異動紀錄、用「移動平均」更新規格成本
   *   新平均成本 =（原庫存 × 原平均成本 ＋ 入庫數量 × 這次進價）÷（原庫存 ＋ 入庫數量）
   */
  const PO_STATUS = { draft: "草稿", ordered: "已下單", partial: "部分入庫", received: "已入庫", cancelled: "已取消" };
  const poTotal = po => po.items.reduce((s, it) => s + it.qty * it.cost, 0);
  const purchases = {
    STATUS: PO_STATUS,
    list({ status = "", q = "" } = {}) {
      q = q.trim().toLowerCase();
      return clone(S().purchases.filter(po =>
        (!status || po.status === status) &&
        (!q || po.number.toLowerCase().includes(q) || po.supplierName.toLowerCase().includes(q) || po.items.some(it => it.name.toLowerCase().includes(q) || it.sku.toLowerCase().includes(q)))
      ).sort((a, b) => b.createdAt.localeCompare(a.createdAt))).map(po => Object.assign(po, { total: poTotal(po) }));
    },
    get: id => { const po = S().purchases.find(x => x.id === id); return po ? Object.assign(clone(po), { total: poTotal(po) }) : null; },
    countByStatus() {
      const out = { all: S().purchases.length };
      Object.keys(PO_STATUS).forEach(k => { out[k] = S().purchases.filter(po => po.status === k).length; });
      return out;
    },
    /* 建立或修改草稿 */
    save(input) {
      const d = clone(input);
      const existing = d.id ? S().purchases.find(x => x.id === d.id) : null;
      if (existing && existing.status !== "draft") throw new Error("已下單的進貨單不能再修改品項");
      const sp = S().suppliers.find(s => s.id === d.supplierId);
      if (!sp) throw new Error("請選擇供應商");
      const items = (d.items || []).map(it => {
        const hit = findVariant(it.variantId);
        if (!hit) throw new Error("有品項找不到對應的商品規格");
        const qty = Math.floor(+it.qty || 0), cost = Math.round(+it.cost || 0);
        if (qty <= 0) throw new Error(`「${hit.p.name}」數量要大於 0`);
        if (cost < 0) throw new Error(`「${hit.p.name}」進價不能是負數`);
        return { productId: hit.p.id, variantId: hit.v.id, name: hit.p.name, optionText: Object.values(hit.v.options).join(" / "), sku: hit.v.sku, qty, cost, received: 0 };
      });
      if (!items.length) throw new Error("至少要有一個品項");
      if (new Set(items.map(it => it.variantId)).size !== items.length) throw new Error("同一個規格不要重複列，請合併數量");
      const now = new Date().toISOString();
      const base = { supplierId: sp.id, supplierName: sp.name, expectedAt: d.expectedAt || "", note: String(d.note || "").trim(), items };
      let po;
      if (existing) { Object.assign(existing, base); po = existing; }
      else {
        S().counters.purchase = (S().counters.purchase || 0) + 1;
        po = Object.assign({ id: uid("po"), number: "PO" + String(240000 + S().counters.purchase), status: "draft", createdAt: now, history: [{ status: "draft", at: now }] }, base);
        S().purchases.push(po);
      }
      commit(); return purchases.get(po.id);
    },
    /* 草稿 → 已下單 */
    place(id) {
      const po = S().purchases.find(x => x.id === id);
      if (!po || po.status !== "draft") throw new Error("只有草稿可以送出");
      po.status = "ordered"; po.orderedAt = new Date().toISOString();
      po.history.push({ status: "ordered", at: po.orderedAt });
      commit();
    },
    /* 入庫：qtys = { variantId: 這次收到的數量 } */
    receive(id, qtys, note) {
      const po = S().purchases.find(x => x.id === id);
      if (!po || !(po.status === "ordered" || po.status === "partial")) throw new Error("這張進貨單現在不能入庫");
      const lines = po.items.map(it => ({ it, n: Math.floor(+(qtys || {})[it.variantId] || 0) })).filter(x => x.n !== 0);
      if (!lines.length) throw new Error("請填這次收到的數量");
      for (const { it, n } of lines) {
        if (n < 0) throw new Error(`「${it.name}」數量不能是負數`);
        if (n > it.qty - it.received) throw new Error(`「${it.name}${it.optionText ? "／" + it.optionText : ""}」最多還能收 ${it.qty - it.received}`);
        if (!findVariant(it.variantId)) throw new Error(`「${it.name}」的商品規格已被刪除，無法入庫`);
      }
      for (const { it, n } of lines) {
        const { p, v } = findVariant(it.variantId);
        const oldQty = Math.max(0, v.stock), oldCost = v.cost || 0;
        v.cost = oldQty + n > 0 ? Math.round((oldQty * oldCost + n * it.cost) / (oldQty + n)) : it.cost;
        v.stock += n;
        it.received += n;
        logMove(p, v, n, "purchase", po.number, `${po.supplierName}，進價 ${money0(it.cost)}`);
      }
      const done = po.items.every(it => it.received >= it.qty);
      po.status = done ? "received" : "partial";
      const at = new Date().toISOString();
      if (done) po.receivedAt = at;
      po.history.push({ status: po.status, at, note: lines.map(({ it, n }) => `${it.name}${it.optionText ? "／" + it.optionText : ""} ×${n}`).join("、") + (note ? `（${note}）` : "") });
      commit();
    },
    /* 取消：草稿、已下單可以取消；部分入庫則是「剩下的不收了」，已收的保留 */
    cancel(id, note) {
      const po = S().purchases.find(x => x.id === id);
      if (!po || !["draft", "ordered", "partial"].includes(po.status)) throw new Error("這張進貨單不能取消");
      const at = new Date().toISOString();
      if (po.status === "partial") {
        po.items.forEach(it => { it.qty = it.received; });
        po.items = po.items.filter(it => it.received > 0); // 完全沒收到的品項從單子移除
        po.status = "received"; po.receivedAt = at;
        po.history.push({ status: "received", at, note: "剩下的數量不再進貨" + (note ? `（${note}）` : "") });
      } else {
        po.status = "cancelled";
        po.history.push({ status: "cancelled", at, note: note || "" });
      }
      commit();
    },
    remove(id) {
      const po = S().purchases.find(x => x.id === id);
      if (!po || po.status !== "draft") throw new Error("只有草稿可以刪除");
      S().purchases = S().purchases.filter(x => x.id !== id); commit();
    },
  };

  function pickColor() {
    const pal = ["#8a9a8e", "#b7a38b", "#6d7b86", "#a58a6f", "#4f6b66", "#7a5a43", "#8c7f99"];
    return pal[Math.floor(Math.random() * pal.length)];
  }

  /* ---------- 會員 ---------- */
  // 對外提供的會員資料：拿掉密碼雜湊，加上「有沒有開通帳號」
  const publicCustomer = c => {
    const o = clone(c);
    delete o.auth;
    o.hasAccount = !!c.auth;
    return o;
  };
  const customers = {
    list(q = "") {
      q = q.trim().toLowerCase();
      return S().customers
        .filter(c => !q || [c.name, c.phone, c.email].some(x => (x || "").toLowerCase().includes(q)))
        .map(c => Object.assign(publicCustomer(c), customers.summary(c.id)))
        .sort((a, b) => (b.lastOrderAt || b.createdAt).localeCompare(a.lastOrderAt || a.createdAt));
    },
    get(id) {
      const c = S().customers.find(x => x.id === id);
      return c ? Object.assign(publicCustomer(c), customers.summary(id)) : null;
    },
    summary(id) {
      const os = S().orders.filter(o => o.customerId === id && o.status !== "cancelled");
      return {
        orderCount: os.length,
        totalSpent: os.reduce((s, o) => s + o.total, 0),
        lastOrderAt: os.map(o => o.createdAt).sort().pop() || "",
      };
    },
    /* 沒登入的結帳：只用手機比對同一位顧客（Email 可能打錯或是別人的，不拿來比對）。
     * 已開通帳號的會員資料由本人維護，結帳時不覆蓋。 */
    upsert({ name, phone, email }) {
      let c = S().customers.find(x => x.phone === phone);
      if (c && !c.auth) { Object.assign(c, { name, email: email || c.email }); }
      else if (c) { /* 已開通帳號：只把訂單掛上去 */ }
      else { c = { id: uid("u"), name, phone, email, createdAt: new Date().toISOString() }; S().customers.push(c); }
      return c;
    },
  };

  /* ---------- 會員帳號（消費者登入） ----------
   * 帳號 = 手機號碼，密碼只存「加鹽雜湊」，不存原文。
   * 註冊需要手機驗證碼：現在是示範模式，驗證碼直接顯示在畫面上；
   * 之後換後端時，requestCode() 改成真的發簡訊，其他頁面不用改。
   * 已經用這支手機結帳過的顧客，註冊時會接上原本的會員資料和訂單。
   */
  const PHONE_RE = /^09\d{8}$/;
  const codes = {};      // 手機 → { code, exp, tries }（只放記憶體，重新整理就失效）
  const failures = {};   // 手機 → { n, until }：密碼錯太多次先暫停
  const hexOf = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
  async function sha256Hex(text) {
    const bytes = new TextEncoder().encode(text);
    if (window.crypto && crypto.subtle) {
      try { return hexOf(await crypto.subtle.digest("SHA-256", bytes)); } catch (e) { /* 改用下面的純 JS 版本 */ }
    }
    return sha256Fallback(bytes);
  }
  const hashPassword = (salt, pw) => sha256Hex(salt + ":" + pw);
  function checkPassword(pw) {
    if (String(pw).length < 8) throw new Error("密碼至少 8 個字元");
    if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) throw new Error("密碼需要同時有英文字母和數字");
  }
  const me = () => {
    const id = state.sessions[state.currentStoreId];
    return id ? S().customers.find(c => c.id === id && c.auth) || null : null;
  };

  const auth = {
    current: () => { const c = me(); return c ? Object.assign(publicCustomer(c), customers.summary(c.id)) : null; },
    /* 第一步：送驗證碼（示範模式：直接回傳驗證碼讓畫面顯示） */
    requestCode(phone) {
      phone = String(phone || "").replace(/[\s-]/g, "");
      if (!PHONE_RE.test(phone)) throw new Error("手機格式應為 09 開頭共 10 碼");
      const c = S().customers.find(x => x.phone === phone);
      if (c && c.auth) throw new Error("這支手機已經註冊過，請直接登入");
      const last = codes[phone];
      if (last && Date.now() < last.sentAt + 60000) throw new Error("驗證碼剛送出，請 60 秒後再試");
      const code = String(Math.floor(100000 + Math.random() * 900000));
      codes[phone] = { code, exp: Date.now() + 10 * 60000, sentAt: Date.now(), tries: 0 };
      return { phone, demoCode: code, existing: !!c };
    },
    /* 第二步：填驗證碼＋資料完成註冊，註冊完直接登入 */
    async register({ phone, code, name, email, password }) {
      phone = String(phone || "").replace(/[\s-]/g, "");
      name = String(name || "").trim();
      email = String(email || "").trim();
      const rec = codes[phone];
      if (!rec || Date.now() > rec.exp) throw new Error("驗證碼已過期，請重新取得");
      if (rec.tries >= 5) throw new Error("驗證碼錯太多次，請重新取得");
      if (String(code).trim() !== rec.code) { rec.tries++; throw new Error("驗證碼不正確"); }
      if (!name) throw new Error("請填寫姓名");
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Email 格式不正確");
      checkPassword(password);
      const salt = uid("s");
      const hash = await hashPassword(salt, password);
      let c = S().customers.find(x => x.phone === phone);
      if (c && c.auth) throw new Error("這支手機已經註冊過，請直接登入");
      const now = new Date().toISOString();
      if (c) Object.assign(c, { name, email: email || c.email }); // 接上結帳時自動建立的會員
      else { c = { id: uid("u"), name, phone, email, createdAt: now }; S().customers.push(c); }
      c.auth = { salt, hash, algo: "sha256" };
      c.registeredAt = now;
      delete codes[phone];
      state.sessions[state.currentStoreId] = c.id;
      commit();
      return auth.current();
    },
    async login(phone, password) {
      phone = String(phone || "").replace(/[\s-]/g, "");
      const f = failures[phone];
      if (f && Date.now() < f.until) throw new Error(`密碼錯誤太多次，請 ${Math.ceil((f.until - Date.now()) / 60000)} 分鐘後再試`);
      const c = S().customers.find(x => x.phone === phone);
      if (!c || !c.auth) throw new Error("手機或密碼不正確");
      if (await hashPassword(c.auth.salt, password) !== c.auth.hash) {
        const n = (f ? f.n : 0) + 1;
        failures[phone] = { n, until: n >= 5 ? Date.now() + 5 * 60000 : 0 };
        throw new Error(n >= 5 ? "密碼錯誤太多次，請 5 分鐘後再試" : "手機或密碼不正確");
      }
      delete failures[phone];
      state.sessions[state.currentStoreId] = c.id;
      commit();
      return auth.current();
    },
    logout() { delete state.sessions[state.currentStoreId]; commit(); },
    hasAccount: phone => S().customers.some(c => c.phone === phone && c.auth),
    updateProfile({ name, email }) {
      const c = me(); if (!c) throw new Error("請先登入");
      name = String(name || "").trim(); email = String(email || "").trim();
      if (!name) throw new Error("請填寫姓名");
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Email 格式不正確");
      Object.assign(c, { name, email }); commit();
    },
    async changePassword(oldPw, newPw) {
      const c = me(); if (!c) throw new Error("請先登入");
      if (await hashPassword(c.auth.salt, oldPw) !== c.auth.hash) throw new Error("目前的密碼不正確");
      checkPassword(newPw);
      const salt = uid("s");
      c.auth = { salt, hash: await hashPassword(salt, newPw), algo: "sha256" };
      commit();
    },
  };

  /* ---------- 購物車（消費者端） ---------- */
  const cart = {
    items() {
      return state.cart.map(line => {
        const p = S().products.find(x => x.id === line.productId);
        const v = p && p.variants.find(x => x.id === line.variantId);
        if (!p || !v || p.status !== "active") return null;
        return {
          productId: p.id, variantId: v.id, name: p.name, color: p.color, image: products.cover(p),
          optionText: Object.values(v.options).join(" / "),
          price: v.price, stock: v.stock, qty: Math.min(line.qty, v.stock),
        };
      }).filter(Boolean);
    },
    count: () => cart.items().reduce((s, x) => s + x.qty, 0),
    add(productId, variantId, qty) {
      const p = S().products.find(x => x.id === productId);
      const v = p && p.variants.find(x => x.id === variantId);
      if (!v) throw new Error("找不到這個規格");
      const line = state.cart.find(x => x.productId === productId && x.variantId === variantId);
      const next = (line ? line.qty : 0) + qty;
      if (next > v.stock) throw new Error(`庫存只剩 ${v.stock} 件`);
      if (line) line.qty = next; else state.cart.push({ productId, variantId, qty });
      commit();
    },
    setQty(variantId, qty) {
      const line = state.cart.find(x => x.variantId === variantId);
      if (!line) return;
      if (qty <= 0) state.cart = state.cart.filter(x => x !== line); else line.qty = qty;
      commit();
    },
    clear() { state.cart = []; state.cartCoupon = ""; commit(); },
    /* 優惠碼跟著購物車走：購物車輸入、結帳頁還在 */
    coupon: () => state.cartCoupon || "",
    applyCoupon(code, phone) {
      code = normCode(code);
      if (!code) throw new Error("請輸入優惠碼");
      const q = quote(cart.items(), null, { couponCode: code, phone });
      if (q.couponError) throw new Error(q.couponError);
      state.cartCoupon = code; commit();
      return q;
    },
    removeCoupon() { state.cartCoupon = ""; commit(); },
  };

  /* ---------- 行銷：優惠券、滿額活動 ----------
   * 優惠券種類：amount（折固定金額）、percent（打折，value=85 代表 85 折）、freeship（免運）
   * 滿額活動：多段門檻，例如 滿 1500 折 150、滿 3000 折 400，自動套用最划算的一段
   * 日期是 "YYYY-MM-DD"（台灣時間），空白代表不限；兩端都包含
   */
  const pad2 = n => String(n).padStart(2, "0");
  const todayYmd = () => { const d = new Date(); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; };
  const inPeriod = x => { const t = todayYmd(); return (!x.startAt || t >= x.startAt) && (!x.endAt || t <= x.endAt); };
  const periodState = x => {
    const t = todayYmd();
    if (!x.enabled) return "off";
    if (x.startAt && t < x.startAt) return "scheduled";
    if (x.endAt && t > x.endAt) return "expired";
    return "active";
  };
  const money0 = n => "NT$" + Math.round(n).toLocaleString("zh-TW");
  const normCode = c => String(c || "").trim().toUpperCase();

  function couponUsage(c, { customerId, phone } = {}) {
    const valid = S().orders.filter(o => o.couponCode === c.code && o.status !== "cancelled");
    const mine = valid.filter(o => (customerId && o.customerId === customerId) || (phone && o.contact.phone === phone));
    return { used: valid.length, mine: mine.length };
  }
  function checkDate(x, what) {
    const s = periodState(x);
    if (s === "off") throw new Error(`這個${what}目前沒有開放`);
    if (s === "scheduled") throw new Error(`這個${what} ${x.startAt} 才開始`);
    if (s === "expired") throw new Error(`這個${what}已經在 ${x.endAt} 結束`);
  }

  const coupons = {
    TYPES: { amount: "折抵金額", percent: "打折", freeship: "免運" },
    list() {
      return clone(S().coupons).map(c => Object.assign(c, { state: periodState(c), used: couponUsage(c).used }))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },
    get: id => { const c = S().coupons.find(x => x.id === id); return c ? Object.assign(clone(c), { state: periodState(c), used: couponUsage(c).used }) : null; },
    describe(c) { // 給人看的一句話：「滿 NT$800 折 NT$100」
      const head = c.minSpend > 0 ? `滿 ${money0(c.minSpend)} ` : "";
      if (c.type === "amount") return `${head}折 ${money0(c.value)}`;
      if (c.type === "percent") return `${head}打 ${c.value % 10 === 0 ? c.value / 10 : c.value} 折${c.maxDiscount > 0 ? `（最多折 ${money0(c.maxDiscount)}）` : ""}`;
      return `${head}免運費`;
    },
    save(input) {
      const d = clone(input);
      d.code = normCode(d.code);
      d.name = String(d.name || "").trim();
      if (!/^[A-Z0-9]{3,20}$/.test(d.code)) throw new Error("優惠碼要 3～20 個英文字母或數字");
      if (S().coupons.some(c => c.code === d.code && c.id !== d.id)) throw new Error("已經有同樣的優惠碼");
      if (!d.name) throw new Error("請填寫優惠券名稱");
      if (!coupons.TYPES[d.type]) throw new Error("請選擇優惠方式");
      ["value", "maxDiscount", "minSpend", "usageLimit", "perCustomer"].forEach(k => { d[k] = Math.max(0, Math.floor(+d[k] || 0)); });
      if (d.type === "amount" && d.value <= 0) throw new Error("折抵金額要大於 0");
      if (d.type === "percent" && !(d.value >= 1 && d.value <= 99)) throw new Error("折數請填 1～99，例如 85 代表 85 折、9 折請填 90");
      if (d.type !== "percent") d.maxDiscount = 0;
      if (d.type === "freeship") d.value = 0;
      if (d.startAt && d.endAt && d.startAt > d.endAt) throw new Error("結束日期不能早於開始日期");
      d.membersOnly = !!d.membersOnly; d.stackable = !!d.stackable; d.enabled = !!d.enabled;
      if (!d.id) { Object.assign(d, { id: uid("cp"), usedCount: 0, createdAt: new Date().toISOString() }); S().coupons.push(d); }
      else { const i = S().coupons.findIndex(x => x.id === d.id); S().coupons[i] = Object.assign({}, S().coupons[i], d); }
      commit(); return clone(d);
    },
    remove(id) { S().coupons = S().coupons.filter(c => c.id !== id); commit(); },
  };

  const promotions = {
    list() {
      return clone(S().promotions).map(p => Object.assign(p, { state: periodState(p) }))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },
    get: id => { const p = S().promotions.find(x => x.id === id); return p ? Object.assign(clone(p), { state: periodState(p) }) : null; },
    describe: p => p.tiers.map(t => `滿 ${money0(t.min)} 折 ${money0(t.off)}`).join("、"),
    active: () => clone(S().promotions.filter(p => periodState(p) === "active")),
    save(input) {
      const d = clone(input);
      d.name = String(d.name || "").trim();
      if (!d.name) throw new Error("請填寫活動名稱");
      d.tiers = (d.tiers || []).map(t => ({ min: Math.max(0, Math.floor(+t.min || 0)), off: Math.max(0, Math.floor(+t.off || 0)) }))
        .filter(t => t.min > 0 && t.off > 0).sort((a, b) => a.min - b.min);
      if (!d.tiers.length) throw new Error("至少要有一段「滿多少折多少」");
      if (d.tiers.some(t => t.off >= t.min)) throw new Error("折抵金額要小於門檻金額");
      if (new Set(d.tiers.map(t => t.min)).size !== d.tiers.length) throw new Error("門檻金額不能重複");
      if (d.startAt && d.endAt && d.startAt > d.endAt) throw new Error("結束日期不能早於開始日期");
      d.enabled = !!d.enabled;
      if (!d.id) { Object.assign(d, { id: uid("pm"), createdAt: new Date().toISOString() }); S().promotions.push(d); }
      else { const i = S().promotions.findIndex(x => x.id === d.id); S().promotions[i] = Object.assign({}, S().promotions[i], d); }
      commit(); return clone(d);
    },
    remove(id) { S().promotions = S().promotions.filter(p => p.id !== id); commit(); },
  };

  /* ---------- 會員等級 ----------
   * 等級看「有效消費」：已付款以上（待出貨、已出貨、已完成）且沒取消的訂單總額。
   * period："all" 看全部訂單；"12m" 只看最近 12 個月（會自動降級）。
   * 每個等級：門檻 minSpend、折數 percent（95 = 95 折、100 = 不打折）、免運 freeShip。
   * 等級優惠只在會員「登入後」結帳才套用（要確定是本人）。
   */
  const COUNTED = ["paid", "shipped", "completed"];
  const tiers = {
    get: () => clone(S().memberTiers),
    save(input) {
      const d = clone(input);
      d.enabled = !!d.enabled;
      d.period = d.period === "12m" ? "12m" : "all";
      d.tiers = (d.tiers || []).map(t => ({
        id: t.id || uid("tier"), name: String(t.name || "").trim(),
        minSpend: Math.max(0, Math.floor(+t.minSpend || 0)),
        percent: Math.min(100, Math.max(1, Math.floor(+t.percent || 100))),
        freeShip: !!t.freeShip,
      })).sort((a, b) => a.minSpend - b.minSpend);
      if (!d.tiers.length) throw new Error("至少要有一個等級");
      if (d.tiers.some(t => !t.name)) throw new Error("每個等級都要有名稱");
      if (new Set(d.tiers.map(t => t.name)).size !== d.tiers.length) throw new Error("等級名稱不能重複");
      if (new Set(d.tiers.map(t => t.minSpend)).size !== d.tiers.length) throw new Error("升級門檻不能重複");
      d.tiers[0].minSpend = 0; // 最低等級一定從 0 開始，每位會員都有等級
      S().memberTiers = d; commit(); return clone(d);
    },
    /* 某位顧客的有效消費 */
    spentOf(customerId) {
      const since = S().memberTiers.period === "12m" ? Date.now() - 365 * 86400000 : -Infinity;
      return S().orders.filter(o => o.customerId === customerId && COUNTED.includes(o.status) && new Date(o.createdAt).getTime() >= since)
        .reduce((s, o) => s + o.total, 0);
    },
    /* 顧客目前的等級、下一級、還差多少；沒開啟分級回傳 null */
    of(customerId) {
      const cfg = S().memberTiers;
      if (!cfg || !cfg.enabled || !customerId) return null;
      const spent = tiers.spentOf(customerId);
      const list = cfg.tiers;
      let idx = 0;
      list.forEach((t, i) => { if (spent >= t.minSpend) idx = i; });
      const next = list[idx + 1] || null;
      return { tier: clone(list[idx]), index: idx, spent, next: next && clone(next), gap: next ? next.minSpend - spent : 0 };
    },
    benefit(t) { // 一句話說明等級權益
      const parts = [];
      if (t.percent < 100) parts.push(`全館 ${t.percent % 10 === 0 ? t.percent / 10 : t.percent} 折`);
      if (t.freeShip) parts.push("免運");
      return parts.join("、") || "累積消費升級";
    },
  };

  /* 檢查優惠碼能不能用在這張單上；不能用就丟出原因 */
  function evalCoupon(code, { subtotal, afterPromo, promoApplied, customerId, phone }) {
    const c = S().coupons.find(x => x.code === normCode(code));
    if (!c) throw new Error("沒有這個優惠碼");
    checkDate(c, "優惠碼");
    if (c.membersOnly && !customerId) throw new Error("這個優惠碼限會員使用，請先登入");
    if (c.usageLimit > 0 && couponUsage(c).used >= c.usageLimit) throw new Error("這個優惠碼已經被用完了");
    if (c.perCustomer > 0 && (customerId || phone) && couponUsage(c, { customerId, phone }).mine >= c.perCustomer) {
      throw new Error(c.perCustomer === 1 ? "這個優惠碼每人限用一次，你已經用過了" : `這個優惠碼每人限用 ${c.perCustomer} 次，你已經用完了`);
    }
    if (subtotal < c.minSpend) throw new Error(`商品滿 ${money0(c.minSpend)} 才能用，還差 ${money0(c.minSpend - subtotal)}`);
    if (!c.stackable && promoApplied) throw new Error("這個優惠碼不能和滿額活動一起使用");
    let amount = 0;
    if (c.type === "amount") amount = Math.min(c.value, afterPromo);
    if (c.type === "percent") {
      amount = Math.floor(afterPromo * (100 - c.value) / 100);
      if (c.maxDiscount > 0) amount = Math.min(amount, c.maxDiscount);
    }
    return { code: c.code, name: c.name, amount, freeShip: c.type === "freeship" };
  }

  /* ---------- 金額計算：商品小計 → 滿額折 → 會員等級折扣 → 優惠碼 → 運費 ----------
   * opts.couponCode：要套用的優惠碼（空白代表不用）
   * opts.customerId / opts.phone：用來檢查會員限定、每人限用次數
   * 免運門檻看「折扣後」的商品金額
   */
  function quote(items, shippingMethodId, opts = {}) {
    const st = S().settings;
    const subtotal = items.reduce((s, it) => s + it.price * it.qty, 0);

    // 滿額活動：所有進行中的活動裡，挑折最多的一段
    let promo = null, nextTier = null;
    S().promotions.filter(p => periodState(p) === "active").forEach(p => p.tiers.forEach(t => {
      if (subtotal >= t.min && (!promo || t.off > promo.amount)) promo = { id: p.id, name: p.name, amount: t.off, min: t.min };
      if (subtotal < t.min && t.off > (promo ? promo.amount : 0) && (!nextTier || t.min < nextTier.min)) nextTier = { name: p.name, min: t.min, off: t.off };
    }));
    if (nextTier && promo && nextTier.off <= promo.amount) nextTier = null;
    const promoAmt = promo ? promo.amount : 0;
    const afterPromo = subtotal - promoAmt;

    // 會員等級折扣：只有登入的會員才有
    const me_ = me();
    const customerId = opts.customerId || (me_ ? me_.id : "");
    const level = me_ ? tiers.of(me_.id) : null;
    const memberAmt = level && level.tier.percent < 100 ? Math.floor(afterPromo * (100 - level.tier.percent) / 100) : 0;
    const afterMember = afterPromo - memberAmt;

    let coupon = null, couponError = "";
    if (opts.couponCode) {
      try { coupon = evalCoupon(opts.couponCode, { subtotal, afterPromo: afterMember, promoApplied: !!promo, customerId, phone: opts.phone || (me_ ? me_.phone : "") }); }
      catch (e) { couponError = e.message; }
    }
    const couponAmt = coupon ? coupon.amount : 0;
    const discount = promoAmt + memberAmt + couponAmt;
    const goods = subtotal - discount;

    const method = st.shippingMethods.find(m => m.id === shippingMethodId);
    const freeByThreshold = st.freeShippingThreshold > 0 && goods >= st.freeShippingThreshold;
    const freeByLevel = !!(level && level.tier.freeShip);
    const free = freeByThreshold || freeByLevel || !!(coupon && coupon.freeShip);
    const shippingFee = !method || free ? 0 : method.fee;
    const discounts = [];
    if (promo) discounts.push({ kind: "promo", label: `${promo.name}（滿 ${money0(promo.min)} 折 ${money0(promo.amount)}）`, amount: promoAmt });
    if (memberAmt || freeByLevel) discounts.push({ kind: "member", label: `會員等級 ${level.tier.name}（${tiers.benefit(level.tier)}）`, amount: memberAmt, freeShip: freeByLevel });
    if (coupon) discounts.push({ kind: "coupon", code: coupon.code, label: `優惠碼 ${coupon.code}・${coupon.name}`, amount: couponAmt, freeShip: coupon.freeShip });
    return {
      subtotal, promo, level, nextTier: nextTier && { ...nextTier, gap: nextTier.min - subtotal },
      coupon, couponError, discounts, discount, goods, shippingFee, total: goods + shippingFee,
      freeShipByCoupon: !!(coupon && coupon.freeShip),
      freeGap: free ? 0 : Math.max(0, st.freeShippingThreshold - goods),
    };
  }

  /* ---------- 訂單 ---------- */
  const orders = {
    STATUS,
    /* from / to 是 "YYYY-MM-DD"（本地時間），兩端都包含 */
    list({ status = "", q = "", from = "", to = "" } = {}) {
      q = q.trim().toLowerCase();
      const t0 = from ? new Date(from + "T00:00:00").getTime() : -Infinity;
      const t1 = to ? new Date(to + "T00:00:00").getTime() + 86400000 : Infinity;
      return clone(S().orders.filter(o => {
        const t = new Date(o.createdAt).getTime();
        return (!status || o.status === status) && t >= t0 && t < t1 &&
          (!q || o.number.toLowerCase().includes(q) || o.contact.name.toLowerCase().includes(q) || o.contact.phone.includes(q));
      }).sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
    },
    get: id => { const o = S().orders.find(x => x.id === id || x.number === id); return o ? clone(o) : null; },
    countByStatus() {
      const out = { all: S().orders.length };
      Object.keys(STATUS).forEach(k => { out[k] = S().orders.filter(o => o.status === k).length; });
      return out;
    },
    byCustomer: id => clone(S().orders.filter(o => o.customerId === id).sort((a, b) => b.createdAt.localeCompare(a.createdAt))),
    // 跟資料庫版一樣的分頁介面（示範版資料都在瀏覽器裡，直接篩選）
    async query(filter = {}, { offset = 0, limit = 50 } = {}) { const all = orders.list(filter); return { total: all.length, rows: all.slice(offset, offset + limit) }; },
    async fetch(id) { return orders.get(id); },
    async ofCustomer(id) { return orders.byCustomer(id); },
    window: () => ({ loaded: S().orders.length, total: S().orders.length, days: 0 }),

    /* 消費者結帳：檢查庫存 → 扣庫存 → 建會員 → 建訂單 */
    create({ contact, shipping, paymentMethodId, note }) {
      const st = S().settings;
      const lines = cart.items();
      if (!lines.length) throw new Error("購物車是空的");
      if (!contact.name || !contact.phone) throw new Error("請填寫姓名與手機");
      if (!/^09\d{8}$/.test(contact.phone)) throw new Error("手機格式應為 09 開頭共 10 碼");
      const ship = st.shippingMethods.find(m => m.id === shipping.methodId && m.enabled);
      if (!ship) throw new Error("請選擇取貨方式");
      if (ship.type === "home" && !shipping.address) throw new Error("請填寫收件地址");
      if (ship.type === "cvs" && !shipping.storeName) throw new Error("請填寫取貨門市");
      const pay = st.paymentMethods.find(m => m.id === paymentMethodId && m.enabled);
      if (!pay) throw new Error("請選擇付款方式");

      // 庫存檢查
      for (const l of lines) {
        const v = S().products.find(p => p.id === l.productId).variants.find(x => x.id === l.variantId);
        if (v.stock < l.qty) throw new Error(`「${l.name}」庫存不足，只剩 ${v.stock} 件`);
      }
      // 金額（含優惠）在扣庫存之前算好：優惠碼不能用就整張單不成立
      const couponCode = state.cartCoupon || "";
      const q = quote(lines, ship.id, { couponCode, phone: contact.phone });
      if (q.couponError) throw new Error(`優惠碼 ${couponCode}：${q.couponError}（可以先移除優惠碼再結帳）`);
      // 扣庫存
      for (const l of lines) {
        const p = S().products.find(x => x.id === l.productId), v = p.variants.find(x => x.id === l.variantId);
        v.stock -= l.qty;
        logMove(p, v, -l.qty, "sale", "SO" + String(240000 + S().counters.order + 1), "");
      }
      // 已登入就掛在自己的帳號下；沒登入就用手機找（或建立）會員
      const c = me() || customers.upsert(contact);
      S().counters.order += 1;
      const now = new Date().toISOString();
      const o = {
        id: uid("o"),
        number: "SO" + String(240000 + S().counters.order),
        customerId: c.id,
        contact: { name: contact.name, phone: contact.phone, email: contact.email || "" },
        items: lines.map(l => {
          const v = S().products.find(p => p.id === l.productId).variants.find(x => x.id === l.variantId);
          // cost：下單當下的平均成本，之後算毛利用
          return { productId: l.productId, variantId: l.variantId, name: l.name, optionText: l.optionText, sku: v.sku, price: l.price, qty: l.qty, cost: v.cost || 0 };
        }),
        subtotal: q.subtotal, shippingFee: q.shippingFee, discount: q.discount, total: q.total,
        discounts: q.discounts, couponCode: q.coupon ? q.coupon.code : "",
        shipping: { methodId: ship.id, methodName: ship.name, address: shipping.address || "", storeName: shipping.storeName || "", trackingNo: "" },
        // 金流尚未串接：一律先記為未付款，由商家在後台手動確認
        payment: { methodId: pay.id, methodName: pay.name, status: "unpaid" },
        status: pay.id === "cod" ? "paid" : "pending_payment",
        note: note || "",
        createdAt: now,
        history: [{ status: "pending_payment", at: now }],
      };
      if (o.status === "paid") o.history.push({ status: "paid", at: now, note: "取貨付款，直接進入待出貨" });
      S().orders.push(o);
      guestPass[o.number] = true; // 剛下單的人可以直接看這筆訂單
      state.cart = [];
      state.cartCoupon = "";
      commit();
      return clone(o);
    },

    /* 商家後台改狀態 */
    setStatus(id, status, extra = {}) {
      const o = S().orders.find(x => x.id === id);
      if (!o || !STATUS[status]) return;
      if (status === "cancelled" && o.status !== "cancelled") {
        // 取消時把庫存加回去
        o.items.forEach(it => {
          const p = S().products.find(x => x.id === it.productId);
          const v = p && p.variants.find(x => x.id === it.variantId);
          if (v) { v.stock += it.qty; logMove(p, v, it.qty, "cancel", o.number, "訂單取消，庫存加回"); }
        });
      }
      if (status === "paid" || (status === "completed" && o.payment.methodId === "cod")) o.payment.status = "paid";
      if (extra.trackingNo !== undefined) o.shipping.trackingNo = extra.trackingNo;
      o.status = status;
      o.history.push({ status, at: new Date().toISOString(), note: extra.note || "" });
      commit();
    },
    setNote(id, note) { const o = S().orders.find(x => x.id === id); if (o) { o.note = note; commit(); } },

    /* ----- 消費者端 ----- */
    /* 不用登入的訂單查詢：訂單編號＋下單手機都對才給看 */
    lookup(number, phone) {
      number = String(number || "").trim().toUpperCase();
      phone = String(phone || "").replace(/[\s-]/g, "");
      if (!number || !phone) throw new Error("請填寫訂單編號和手機");
      const o = S().orders.find(x => x.number.toUpperCase() === number && x.contact.phone === phone);
      if (!o) throw new Error("查不到這筆訂單，請確認訂單編號和下單時填的手機");
      guestPass[o.number] = true;
      return customerView(o);
    },
    /* 登入會員看自己的訂單 */
    mine() {
      const c = me(); if (!c) return [];
      return S().orders.filter(o => o.customerId === c.id)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(customerView);
    },
    /* 顧客看單筆訂單：必須是自己的，或剛剛用編號＋手機查過 */
    forCustomer(number) {
      const o = S().orders.find(x => x.number === number);
      if (!o) return null;
      const c = me();
      return (c && o.customerId === c.id) || guestPass[o.number] ? customerView(o) : null;
    },
    /* 顧客自己取消：只有「待付款」的訂單可以 */
    cancelByCustomer(number) {
      const o = orders.forCustomer(number);
      if (!o) throw new Error("找不到這筆訂單");
      if (o.status !== "pending_payment") throw new Error("這筆訂單已經在處理，請聯絡客服取消");
      orders.setStatus(S().orders.find(x => x.number === number).id, "cancelled", { note: "顧客自行取消" });
    },
  };
  const guestPass = {}; // 這次開啟頁面時查過的訂單編號（重新整理就要重查）
  // 給顧客看的訂單：拿掉只有商家看得到的備註和內部編號
  function customerView(o) {
    const v = clone(o);
    delete v.note; delete v.customerId; delete v.id;
    v.history = v.history.map(h => ({ status: h.status, at: h.at }));
    return v;
  }

  /* ---------- 報表 ---------- */
  function stats() {
    const valid = S().orders.filter(o => o.status !== "cancelled");
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    const since = d => valid.filter(o => new Date(o.createdAt) >= d);
    const sum = arr => arr.reduce((s, o) => s + o.total, 0);
    // 近 14 天每日營收
    const daily = [];
    for (let i = 13; i >= 0; i--) {
      const d0 = new Date(today); d0.setDate(d0.getDate() - i);
      const d1 = new Date(d0); d1.setDate(d1.getDate() + 1);
      daily.push({ date: d0, total: sum(valid.filter(o => { const t = new Date(o.createdAt); return t >= d0 && t < d1; })) });
    }
    const monthOrders = since(monthStart);
    return {
      todayRevenue: sum(since(today)),
      todayOrders: since(today).length,
      monthRevenue: sum(monthOrders),
      monthOrders: monthOrders.length,
      avgOrder: monthOrders.length ? Math.round(sum(monthOrders) / monthOrders.length) : 0,
      toShip: S().orders.filter(o => o.status === "paid").length,
      toPay: S().orders.filter(o => o.status === "pending_payment").length,
      customers: S().customers.length,
      daily,
    };
  }

  /* 沒有 crypto.subtle 的環境（少數舊瀏覽器）用的 SHA-256 */
  function sha256Fallback(bytes) {
    const K = [0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2];
    const H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    const len = bytes.length, total = ((len + 9 + 63) >> 6) << 6;
    const m = new Uint8Array(total); m.set(bytes); m[len] = 0x80;
    const dv = new DataView(m.buffer);
    dv.setUint32(total - 4, len * 8); dv.setUint32(total - 8, Math.floor(len / 0x20000000));
    const w = new Uint32Array(64), rot = (x, n) => (x >>> n) | (x << (32 - n));
    for (let off = 0; off < total; off += 64) {
      for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4);
      for (let i = 16; i < 64; i++) {
        const s0 = rot(w[i - 15], 7) ^ rot(w[i - 15], 18) ^ (w[i - 15] >>> 3);
        const s1 = rot(w[i - 2], 17) ^ rot(w[i - 2], 19) ^ (w[i - 2] >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
      }
      let [a, b, c, d, e, f, g, h] = H;
      for (let i = 0; i < 64; i++) {
        const t1 = (h + (rot(e, 6) ^ rot(e, 11) ^ rot(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) | 0;
        const t2 = ((rot(a, 2) ^ rot(a, 13) ^ rot(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
        h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      [a, b, c, d, e, f, g, h].forEach((x, i) => { H[i] = (H[i] + x) | 0; });
    }
    return H.map(x => (x >>> 0).toString(16).padStart(8, "0")).join("");
  }


  /* ---------- 報表（跟資料庫版 admin_report 一樣的結果格式） ---------- */
  const PAID = ["paid", "shipped", "completed"];
  const ymdLocal = d => { const x = new Date(d); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`; };
  const reports = {
    async get(from, to) {
      if (!from || !to) throw new Error("請選擇日期區間");
      if (to < from) throw new Error("結束日期不能早於開始日期");
      const days = Math.round((new Date(to) - new Date(from)) / 86400000) + 1;
      if (days > 1100) throw new Error("一次最多查 3 年");
      const unit = days <= 62 ? "day" : "month";
      const inRange = o => { const d = ymdLocal(o.createdAt); return d >= from && d <= to; };
      const all = S().orders, o = all.filter(inRange);
      const paid = o.filter(x => PAID.includes(x.status));
      const who = x => x.customerId || "p:" + x.contact.phone;
      const costOf = x => x.items.reduce((a, i) => a + i.qty * (i.cost || 0), 0);
      const sum = (arr, f) => arr.reduce((a, x) => a + f(x), 0);
      const firsts = {};
      all.filter(x => PAID.includes(x.status)).forEach(x => { const d = ymdLocal(x.createdAt), k = who(x); if (!firsts[k] || d < firsts[k]) firsts[k] = d; });
      const whos = [...new Set(paid.map(who))];
      const key = d => (unit === "day" ? d : d.slice(0, 7) + "-01");
      const series = [];
      for (let t = new Date((unit === "day" ? from : from.slice(0, 7) + "-01") + "T00:00:00"); ymdLocal(t) <= to; unit === "day" ? t.setDate(t.getDate() + 1) : t.setMonth(t.getMonth() + 1)) {
        const b = ymdLocal(t), inB = paid.filter(x => key(ymdLocal(x.createdAt)) === b);
        series.push({ date: b, revenue: sum(inB, x => x.total), orders: inB.length, gross: sum(inB, x => x.subtotal - x.discount - costOf(x)) });
      }
      const group = (arr, k, f) => { const m = {}; arr.forEach(x => { const kk = k(x); m[kk] = f(m[kk], x); }); return Object.values(m); };
      const lines = paid.flatMap(x => x.items.map(i => Object.assign({ oid: x.id }, i)));
      const products = group(lines, i => i.productId, (a, i) => { a = a || { productId: i.productId, name: i.name, qty: 0, sales: 0, cost: 0, oids: new Set() };
        a.qty += i.qty; a.sales += i.qty * i.price; a.cost += i.qty * (i.cost || 0); a.oids.add(i.oid); return a; })
        .map(a => ({ productId: a.productId, name: a.name, qty: a.qty, sales: a.sales, cost: a.cost, orders: a.oids.size })).sort((a, b) => b.sales - a.sales).slice(0, 50);
      const variants = group(lines, i => i.variantId, (a, i) => { a = a || { variantId: i.variantId, name: i.name, optionText: i.optionText, sku: i.sku, qty: 0, sales: 0 };
        a.qty += i.qty; a.sales += i.qty * i.price; return a; }).sort((a, b) => b.qty - a.qty).slice(0, 50);
      const payments = group(paid, x => x.payment.methodName, (a, x) => { a = a || { name: x.payment.methodName, orders: 0, amount: 0 }; a.orders++; a.amount += x.total; return a; }).sort((a, b) => b.amount - a.amount);
      const shippings = group(paid, x => x.shipping.methodName, (a, x) => { a = a || { name: x.shipping.methodName, orders: 0, amount: 0 }; a.orders++; a.amount += x.shippingFee; return a; }).sort((a, b) => b.orders - a.orders);
      const dl = paid.flatMap(x => x.discounts || []);
      const LBL = d => d.kind === "coupon" ? "優惠碼 " + d.code : d.kind === "promo" ? "滿額活動" : d.kind === "member" ? "會員等級" : d.kind;
      const discounts = group(dl, d => d.kind + LBL(d), (a, d) => { a = a || { kind: d.kind, label: LBL(d), orders: 0, amount: 0 }; a.orders++; a.amount += d.amount; return a; }).sort((a, b) => b.amount - a.amount);
      const moves = S().movements.filter(m => m.type === "purchase" && ymdLocal(m.at) >= from && ymdLocal(m.at) <= to).map(m => {
        const po = S().purchases.find(x => x.number === m.ref); const it = po && po.items.find(i => i.variantId === m.variantId);
        return { delta: m.delta, cost: it ? it.cost : 0, supplier: po ? po.supplierName : "" };
      });
      return clone({
        from, to, unit,
        summary: { orders: paid.length, revenue: sum(paid, x => x.total), goods: sum(paid, x => x.subtotal), discount: sum(paid, x => x.discount),
          shipping: sum(paid, x => x.shippingFee), cost: sum(paid, costOf), gross: sum(paid, x => x.subtotal - x.discount - costOf(x)),
          customers: whos.length, newCustomers: whos.filter(k => firsts[k] >= from).length, units: sum(lines, i => i.qty) },
        pending: { orders: o.filter(x => x.status === "pending_payment").length, amount: sum(o.filter(x => x.status === "pending_payment"), x => x.total) },
        cancelled: { orders: o.filter(x => x.status === "cancelled").length, amount: sum(o.filter(x => x.status === "cancelled"), x => x.total) },
        series, products, variants, payments, shippings, discounts,
        purchases: { units: sum(moves, m => m.delta), amount: sum(moves, m => m.delta * m.cost),
          bySupplier: group(moves, m => m.supplier, (a, m) => { a = a || { name: m.supplier || null, units: 0, amount: 0 }; a.units += m.delta; a.amount += m.delta * m.cost; return a; }).sort((a, b) => b.amount - a.amount) },
      });
    },
  };

  // 跟 db.js（資料庫版）對齊的介面：示範版功能全開、不用登入
  const features = { members: true, images: true, inventory: true, tiers: true, reset: true, platform: false };
  const ready = async () => ({ state: "ok" });
  const admin = { user: () => ({ email: "示範模式（資料只存在這個瀏覽器）" }), logout: async () => {}, login: async () => {}, signup: async () => ({}),
    stores: () => [], isPlatform: () => false, billing: () => null, platformInfo: () => ({}), storeUrl: () => location.href.split("#")[0] };

  window.DB = {
    mode: "local", features, ready, admin, takeNotice: () => null, shopState: () => ({ closed: false, message: "" }),
    settings, categories, products, media, customers, auth, cart, orders, quote, stats, coupons, promotions, tiers,
    inventory, suppliers, purchases, reports,
    onChange: fn => listeners.push(fn),
    reset() { state = window.makeSeed(); commit(); },
    exportJSON: () => JSON.stringify(state, null, 2),
  };
})();
