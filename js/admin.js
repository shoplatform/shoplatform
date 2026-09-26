/* =========================================================
 * admin.js — 商家後台
 * 路由：#admin、#admin/products、#admin/product/<id|new>、
 *       #admin/categories、#admin/orders[/<status>]、#admin/order/<id>、
 *       #admin/customers、#admin/customer/<id>、#admin/settings
 * ========================================================= */
(function () {
  const { esc, money, date, toast, confirmBox, download, Router } = window.UI;
  const root = () => document.getElementById("app");

  const STATUS_PILL = { pending_payment: "warn", paid: "info", shipped: "ok", completed: "idle", cancelled: "bad" };
  const statusPill = s => `<span class="pill ${STATUS_PILL[s]}">${DB.orders.STATUS[s]}</span>`;
  const accountPill = c => c.hasAccount ? `<span class="pill ok">已開通</span>` : `<span class="pill idle">未開通</span>`;
  const payPill = p => p.status === "paid" ? `<span class="pill ok">已付款</span>` : `<span class="pill warn">未付款</span>`;
  const thumb = p => {
    const src = DB.products.cover(p);
    return src
      ? `<div class="thumb"><img src="${esc(src)}" alt=""></div>`
      : `<div class="thumb" style="background:${esc(p.color)}">${esc(p.name.slice(0, 1))}</div>`;
  };

  /* ---------- 版面外框 ---------- */
  function shell(active, content) {
    const st = DB.settings.get();
    const c = DB.orders.countByStatus();
    const pc = DB.purchases.countByStatus();
    const poOpen = pc.ordered + pc.partial; // 待入庫的進貨單
    const link = (href, key, label, badge) =>
      `<a href="#${href}" class="${active === key ? "is-on" : ""}">${label}${badge ? `<span class="badge">${badge}</span>` : ""}</a>`;
    root().innerHTML = `
      <div class="admin">
        <aside class="side">
          <div class="side-brand"><strong>${esc(st.name)}</strong><span>商家後台</span></div>
          <nav aria-label="後台選單">
            ${link("admin", "dash", "總覽")}
            <div class="sep">銷售</div>
            ${link("admin/orders", "orders", "訂單", c.paid || "")}
            ${link("admin/customers", "customers", "會員")}
            <div class="sep">商品</div>
            ${link("admin/products", "products", "商品")}
            ${link("admin/categories", "categories", "分類")}
            ${DB.features.inventory ? `<div class="sep">進銷存</div>
            ${link("admin/stock", "stock", "庫存")}
            ${link("admin/purchases", "purchases", "進貨單", poOpen || "")}
            ${link("admin/suppliers", "suppliers", "供應商")}` : ""}
            <div class="sep">行銷</div>
            ${link("admin/coupons", "coupons", "優惠券")}
            ${link("admin/promotions", "promotions", "滿額活動")}
            ${DB.features.tiers ? link("admin/tiers", "tiers", "會員等級") : ""}
            <div class="sep">商店</div>
            ${link("admin/settings", "settings", "設定")}
          </nav>
          <div class="side-foot">
            <div>${DB.mode === "remote" ? "v0.8 · 資料庫已連線" : "v0.8 · 離線示範版"}</div>
            ${DB.admin.user() ? `<div class="side-user">${esc(DB.admin.user().email)}</div>` : ""}
            ${DB.mode === "remote" ? `<button class="btn btn-sm btn-ghost" id="side-logout" type="button">登出</button>` : ""}
          </div>
        </aside>
        <main class="main" id="main">${content}</main>
      </div>`;
    const out = document.getElementById("side-logout");
    if (out) out.addEventListener("click", async () => { await DB.admin.logout(); toast("已登出"); Router.go("admin"); });
  }

  /* ---------- 總覽 ---------- */
  function viewDashboard() {
    const s = DB.stats();
    const low = DB.products.lowStock();
    const recent = DB.orders.list().slice(0, 6);
    shell("dash", `
      <div class="page-head"><h1>總覽</h1><span class="muted">${date(new Date().toISOString())}</span></div>
      <div class="kpis">
        <div class="kpi"><span>今日營收</span><strong>${money(s.todayRevenue)}</strong><small>${s.todayOrders} 筆訂單</small></div>
        <div class="kpi"><span>本月營收</span><strong>${money(s.monthRevenue)}</strong><small>平均客單 ${money(s.avgOrder)}</small></div>
        <a class="kpi" href="#admin/orders/paid"><span>待出貨</span><strong>${s.toShip}</strong><small>待付款 ${s.toPay} 筆</small></a>
        <a class="kpi" href="#admin/customers"><span>會員數</span><strong>${s.customers}</strong><small>含結帳自動建立</small></a>
      </div>
      <div class="grid-2">
        <section class="panel">
          <div class="panel-head"><h2>近 14 天營收</h2><span class="small muted">不含已取消</span></div>
          <div class="panel-body">${barChart(s.daily)}</div>
        </section>
        <section class="panel">
          <div class="panel-head"><h2>庫存偏低</h2><a class="small" href="#admin/products">管理商品</a></div>
          ${low.length ? `<div class="table-wrap"><table class="tbl"><tbody>
            ${low.slice(0, 6).map(x => `<tr class="is-link" data-href="admin/product/${x.product.id}">
              <td><div class="prod-cell">${thumb(x.product)}<div><span>${esc(x.product.name)}</span><span class="small muted">${esc(Object.values(x.variant.options).join(" / ") || "單一規格")}</span></div></div></td>
              <td class="r">${x.variant.stock === 0 ? `<span class="pill bad">售完</span>` : `<span class="pill warn">剩 ${x.variant.stock}</span>`}</td>
            </tr>`).join("")}
          </tbody></table></div>` : `<div class="empty">庫存都充足</div>`}
        </section>
      </div>
      <section class="panel">
        <div class="panel-head"><h2>最新訂單</h2><a class="small" href="#admin/orders">全部訂單</a></div>
        ${ordersTable(recent)}
      </section>`);
  }

  function barChart(daily) {
    const W = 560, H = 170, padL = 44, padB = 22, padT = 10;
    const max = Math.max(1000, ...daily.map(d => d.total));
    const step = niceStep(max / 3);
    const top = Math.ceil(max / step) * step;
    const bw = (W - padL) / daily.length;
    const y = v => H - padB - (v / top) * (H - padB - padT);
    let g = "";
    for (let v = 0; v <= top; v += step) {
      g += `<line class="grid" x1="${padL}" x2="${W}" y1="${y(v)}" y2="${y(v)}"/><text x="${padL - 6}" y="${y(v) + 3}" text-anchor="end">${v >= 1000 ? v / 1000 + "k" : v}</text>`;
    }
    daily.forEach((d, i) => {
      const x = padL + i * bw + bw * 0.18, w = bw * 0.64;
      const h = Math.max(d.total ? 2 : 0, H - padB - y(d.total));
      g += `<rect class="bar ${i === daily.length - 1 ? "today" : ""}" x="${x}" y="${H - padB - h}" width="${w}" height="${h}" rx="2"><title>${date(d.date.toISOString())}：${money(d.total)}</title></rect>`;
      if (i % 2 === 1 || i === daily.length - 1) g += `<text x="${x + w / 2}" y="${H - 6}" text-anchor="middle">${d.date.getMonth() + 1}/${d.date.getDate()}</text>`;
    });
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="近 14 天每日營收長條圖">${g}</svg>`;
  }
  function niceStep(raw) {
    const p = Math.pow(10, Math.floor(Math.log10(raw)));
    const n = raw / p;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
  }

  function ordersTable(list) {
    if (!list.length) return `<div class="empty">沒有符合的訂單</div>`;
    return `<div class="table-wrap"><table class="tbl">
      <thead><tr><th>訂單編號</th><th>日期</th><th>顧客</th><th>取貨</th><th>付款</th><th>狀態</th><th class="r">金額</th></tr></thead>
      <tbody>${list.map(o => `<tr class="is-link" data-href="admin/order/${o.id}">
        <td class="mono">${esc(o.number)}</td>
        <td class="num">${date(o.createdAt, true)}</td>
        <td>${esc(o.contact.name)}</td>
        <td>${esc(o.shipping.methodName)}</td>
        <td>${payPill(o.payment)}</td>
        <td>${statusPill(o.status)}</td>
        <td class="r num">${money(o.total)}</td>
      </tr>`).join("")}</tbody></table></div>`;
  }

  /* ---------- 商品列表 ---------- */
  const pf = { q: "", categoryId: "", status: "" };
  function viewProducts() {
    const cats = DB.categories.list();
    shell("products", `
      <div class="page-head"><h1>商品</h1><div class="actions"><a class="btn btn-primary" href="#admin/product/new">新增商品</a></div></div>
      <section class="panel">
        <div class="panel-head">
          <div class="toolbar">
            <input type="search" id="pf-q" placeholder="搜尋名稱或貨號" value="${esc(pf.q)}" aria-label="搜尋商品">
            <select id="pf-cat" aria-label="分類"><option value="">全部分類</option>${cats.map(c => `<option value="${c.id}" ${pf.categoryId === c.id ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select>
            <select id="pf-status" aria-label="狀態"><option value="">全部狀態</option><option value="active" ${pf.status === "active" ? "selected" : ""}>上架中</option><option value="draft" ${pf.status === "draft" ? "selected" : ""}>草稿</option></select>
          </div>
        </div>
        <div id="pf-list"></div>
      </section>`);
    const draw = () => {
      const list = DB.products.list(pf);
      const catName = id => (cats.find(c => c.id === id) || {}).name;
      document.getElementById("pf-list").innerHTML = list.length ? `<div class="table-wrap"><table class="tbl">
        <thead><tr><th>商品</th><th>分類</th><th>規格數</th><th class="r">價格</th><th class="r">庫存</th><th>狀態</th></tr></thead>
        <tbody>${list.map(p => {
          const [lo, hi] = DB.products.priceRange(p);
          const stock = DB.products.totalStock(p);
          return `<tr class="is-link" data-href="admin/product/${p.id}">
            <td><div class="prod-cell">${thumb(p)}<div><span>${esc(p.name)}</span><span class="small muted mono">${esc(p.variants[0].sku)}${p.variants.length > 1 ? " …" : ""}</span></div></div></td>
            <td>${p.categoryIds.map(catName).filter(Boolean).map(esc).join("、") || `<span class="muted">未分類</span>`}</td>
            <td class="num">${p.variants.length}</td>
            <td class="r num">${lo === hi ? money(lo) : money(lo) + "–" + money(hi).replace("NT$", "")}</td>
            <td class="r num">${stock === 0 ? `<span class="pill bad">0</span>` : stock}</td>
            <td>${p.status === "active" ? `<span class="pill ok">上架中</span>` : `<span class="pill idle">草稿</span>`}</td>
          </tr>`;
        }).join("")}</tbody></table></div>` : `<div class="empty">沒有符合的商品</div>`;
    };
    draw();
    document.getElementById("pf-q").addEventListener("input", e => { pf.q = e.target.value; draw(); });
    document.getElementById("pf-cat").addEventListener("change", e => { pf.categoryId = e.target.value; draw(); });
    document.getElementById("pf-status").addEventListener("change", e => { pf.status = e.target.value; draw(); });
  }

  /* ---------- 商品編輯 ---------- */
  function viewProductEdit(id) {
    const isNew = id === "new";
    const p = isNew
      ? { name: "", description: "", status: "draft", categoryIds: [], options: [], images: [], variants: [{ id: DB.products.newVariantId(), sku: "", options: {}, price: 0, stock: 0 }] }
      : DB.products.get(id);
    if (!p) return notFound("找不到這個商品", "admin/products");
    const cats = DB.categories.list();
    // 編輯中的暫存（按儲存才寫入）
    const draft = JSON.parse(JSON.stringify(p));
    draft.images = draft.images || [];

    shell("products", `
      <div class="page-head">
        <div class="crumbs"><a href="#admin/products">商品</a><span>/</span><span>${isNew ? "新增商品" : esc(p.name)}</span></div>
        <div class="actions">
          ${isNew ? "" : `<a class="btn btn-ghost" href="#shop/p/${p.id}">看前台頁面</a><button class="btn" id="pe-del">刪除</button>`}
          <button class="btn btn-primary" id="pe-save">儲存</button>
        </div>
      </div>
      <div class="grid-2">
        <div style="display:grid;gap:16px">
          <section class="panel">
            <div class="panel-head"><h2>基本資料</h2></div>
            <div class="panel-body">
              <div class="field"><label for="pe-name">商品名稱</label><input type="text" id="pe-name" value="${esc(draft.name)}" maxlength="60"></div>
              <div class="field"><label for="pe-desc">商品描述</label><textarea id="pe-desc" rows="4">${esc(draft.description)}</textarea></div>
            </div>
          </section>
          <section class="panel">
            <div class="panel-head"><h2>商品圖片</h2><span class="small muted" id="pe-img-count"></span></div>
            ${DB.features.images ? "" : `<div class="panel-body"><div class="notice">商品圖片上傳會在第二階段開放（圖片會存到雲端）。目前前台先用色塊顯示。</div></div>`}
            <div class="panel-body" ${DB.features.images ? "" : "hidden"}>
              <div class="img-grid" id="pe-imgs"></div>
              <label class="img-drop" id="pe-drop">
                <input type="file" id="pe-file" accept="image/jpeg,image/png,image/webp,image/gif" multiple>
                <b>點這裡選擇圖片</b>
                <span>或把圖片拖曳進來 · JPG、PNG、WebP · 最多 ${DB.media.MAX_PER_PRODUCT} 張</span>
              </label>
              <p class="small muted" style="margin:0">第一張是主圖（列表和購物車會顯示）。圖片會自動縮小壓縮${DB.mode === "remote" ? "、上傳到雲端" : ""}，按「儲存」後才會生效。</p>
              <div style="display:grid;gap:6px">
                <div class="small muted" id="pe-usage"></div>
                <div class="meter" id="pe-meter"><i></i></div>
              </div>
            </div>
          </section>
          <section class="panel">
            <div class="panel-head"><h2>規格與庫存</h2><button class="btn btn-sm" id="pe-addopt">新增規格類型</button></div>
            <div class="panel-body">
              <p class="small muted" style="margin:0">例如「顏色」填入「白, 黑」、「尺寸」填入「S, M, L」，系統會自動組合出 6 個規格。不需要規格的商品就留空。</p>
              <p class="small muted" style="margin:0">${DB.features.inventory ? "庫存建議用「進銷存 → 庫存」的盤點調整或進貨單入庫，這裡直接改也會留下異動紀錄。平均成本會在進貨入庫時自動更新。" : "直接改庫存會留下異動紀錄；儲存時只會加減你改的數量，這段時間顧客買走的不會被蓋掉。"}</p>
              <div id="pe-opts" style="display:grid;gap:8px"></div>
              <div id="pe-vars"></div>
            </div>
          </section>
        </div>
        <div style="display:grid;gap:16px">
          <section class="panel">
            <div class="panel-head"><h2>狀態</h2></div>
            <div class="panel-body">
              <label class="check"><input type="radio" name="pe-status" id="pe-st-active" value="active" ${draft.status === "active" ? "checked" : ""}> 上架中（前台看得到）</label>
              <label class="check"><input type="radio" name="pe-status" id="pe-st-draft" value="draft" ${draft.status === "draft" ? "checked" : ""}> 草稿（前台看不到）</label>
            </div>
          </section>
          <section class="panel">
            <div class="panel-head"><h2>分類</h2><a class="small" href="#admin/categories">管理分類</a></div>
            <div class="panel-body">
              ${cats.length ? cats.map(c => `<label class="check"><input type="checkbox" class="pe-cat" id="pe-cat-${c.id}" value="${c.id}" ${draft.categoryIds.includes(c.id) ? "checked" : ""}> ${esc(c.name)}</label>`).join("") : `<span class="muted">還沒有分類</span>`}
            </div>
          </section>
        </div>
      </div>`);

    /* --- 圖片 --- */
    const imgsEl = document.getElementById("pe-imgs");
    const dropEl = document.getElementById("pe-drop");
    const fileEl = document.getElementById("pe-file");
    let busy = false;

    function drawImages() {
      imgsEl.innerHTML = draft.images.map((im, i) => `
        <div class="img-tile">
          <img src="${esc(im.url)}" alt="商品圖 ${i + 1}">
          ${i === 0 ? `<span class="main-tag">主圖</span>` : ""}
          <div class="tile-acts">
            ${i === 0 ? "<span></span>" : `<button type="button" data-img-main="${i}" aria-label="設第 ${i + 1} 張為主圖">設主圖</button>`}
            <button type="button" data-img-del="${i}" aria-label="移除第 ${i + 1} 張">移除</button>
          </div>
        </div>`).join("");
      imgsEl.style.display = draft.images.length ? "" : "none";
      document.getElementById("pe-img-count").textContent = `${draft.images.length} / ${DB.media.MAX_PER_PRODUCT}`;
      const full = draft.images.length >= DB.media.MAX_PER_PRODUCT;
      dropEl.style.display = full ? "none" : "";
      drawUsage();
    }
    function drawUsage() {
      // 估算：已儲存的資料 + 這次新加、還沒儲存的圖片（雲端版沒有這個限制，不顯示）
      const u = DB.media.usage();
      if (!u) { document.getElementById("pe-usage").parentElement.hidden = true; return; }
      const saved = new Set((p.images || []).map(x => x.id));
      const pending = draft.images.filter(x => !saved.has(x.id)).reduce((s, x) => s + x.url.length, 0);
      const ratio = Math.min(1, (u.used + pending) / u.budget);
      document.getElementById("pe-usage").textContent = `這個瀏覽器的儲存空間約已使用 ${Math.round(ratio * 100)}%（正式版會改存雲端，沒有這個限制）`;
      const m = document.getElementById("pe-meter");
      m.firstElementChild.style.width = (ratio * 100).toFixed(1) + "%";
      m.classList.toggle("is-high", ratio > 0.8);
    }
    async function addFiles(files) {
      if (busy) return;
      files = [...files].filter(Boolean);
      if (!files.length) return;
      const room = DB.media.MAX_PER_PRODUCT - draft.images.length;
      if (room <= 0) return toast(`每個商品最多 ${DB.media.MAX_PER_PRODUCT} 張圖片`, "error");
      if (files.length > room) toast(`只能再加 ${room} 張，多的已略過`, "error");
      busy = true;
      dropEl.querySelector("b").textContent = "處理中…";
      let ok = 0;
      for (const f of files.slice(0, room)) {
        try { draft.images.push(await DB.media.prepare(f)); ok++; drawImages(); }
        catch (err) { toast(err.message, "error"); }
      }
      busy = false;
      dropEl.querySelector("b").textContent = "點這裡選擇圖片";
      fileEl.value = "";
      if (ok) toast(`已加入 ${ok} 張圖片，記得按「儲存」`);
    }
    fileEl.addEventListener("change", () => addFiles(fileEl.files));
    ["dragenter", "dragover"].forEach(t => dropEl.addEventListener(t, e => { e.preventDefault(); dropEl.classList.add("is-over"); }));
    ["dragleave", "drop"].forEach(t => dropEl.addEventListener(t, e => { e.preventDefault(); dropEl.classList.remove("is-over"); }));
    dropEl.addEventListener("drop", e => addFiles(e.dataTransfer.files));
    imgsEl.addEventListener("click", e => {
      const main = e.target.closest("[data-img-main]");
      const del = e.target.closest("[data-img-del]");
      if (main) { const [im] = draft.images.splice(+main.dataset.imgMain, 1); draft.images.unshift(im); drawImages(); }
      if (del) { draft.images.splice(+del.dataset.imgDel, 1); drawImages(); }
    });
    drawImages();

    /* --- 規格 --- */
    const optsEl = document.getElementById("pe-opts");
    const varsEl = document.getElementById("pe-vars");

    function drawOpts() {
      optsEl.innerHTML = draft.options.map((o, i) => `
        <div class="opt-row">
          <input type="text" class="opt-name" data-i="${i}" id="pe-opt-name-${i}" value="${esc(o.name)}" placeholder="規格名稱，例如 顏色" aria-label="規格名稱">
          <input type="text" class="opt-vals" data-i="${i}" id="pe-opt-vals-${i}" value="${esc(o.values.join(", "))}" placeholder="選項，用逗號分開" aria-label="規格選項">
          <button class="btn btn-sm btn-ghost opt-del" data-i="${i}">移除</button>
        </div>`).join("");
    }
    function rebuildVariants() {
      const opts = draft.options.filter(o => o.name && o.values.length);
      const combos = opts.reduce((acc, o) => acc.flatMap(c => o.values.map(v => ({ ...c, [o.name]: v }))), [{}]);
      const old = draft.variants;
      const key = o => JSON.stringify(Object.keys(o).sort().map(k => [k, o[k]]));
      draft.variants = combos.map(c => {
        const hit = old.find(v => key(v.options) === key(c));
        return hit || { id: DB.products.newVariantId(), sku: "", options: c, price: old[0] ? old[0].price : 0, stock: 0, cost: old[0] ? old[0].cost || 0 : 0 };
      });
      drawVars();
    }
    function drawVars() {
      const hasOpts = draft.variants.some(v => Object.keys(v.options).length);
      varsEl.innerHTML = `<div class="table-wrap"><table class="tbl variant-tbl">
        <thead><tr><th>${hasOpts ? "規格" : "單一規格"}</th><th>貨號</th><th>售價</th><th>庫存</th><th>平均成本</th></tr></thead>
        <tbody>${draft.variants.map((v, i) => `<tr>
          <td>${esc(Object.values(v.options).join(" / ") || "預設")}</td>
          <td><input type="text" class="v-in" data-i="${i}" data-k="sku" id="pe-v-sku-${i}" value="${esc(v.sku)}" aria-label="貨號"></td>
          <td><input type="number" class="v-in" data-i="${i}" data-k="price" id="pe-v-price-${i}" value="${v.price}" min="0" step="1" aria-label="價格"></td>
          <td><input type="number" class="v-in" data-i="${i}" data-k="stock" id="pe-v-stock-${i}" value="${v.stock}" min="0" step="1" aria-label="庫存"></td>
          <td><input type="number" class="v-in" data-i="${i}" data-k="cost" id="pe-v-cost-${i}" value="${v.cost || 0}" min="0" step="1" aria-label="平均成本"></td>
        </tr>`).join("")}</tbody></table></div>`;
    }
    drawOpts(); drawVars();

    optsEl.addEventListener("change", e => {
      const i = +e.target.dataset.i;
      if (e.target.classList.contains("opt-name")) draft.options[i].name = e.target.value.trim();
      if (e.target.classList.contains("opt-vals")) draft.options[i].values = [...new Set(e.target.value.split(/[,，、]/).map(s => s.trim()).filter(Boolean))];
      rebuildVariants();
    });
    optsEl.addEventListener("click", e => {
      const b = e.target.closest(".opt-del"); if (!b) return;
      draft.options.splice(+b.dataset.i, 1); drawOpts(); rebuildVariants();
    });
    document.getElementById("pe-addopt").addEventListener("click", () => {
      if (draft.options.length >= 3) return toast("最多 3 種規格類型", "error");
      draft.options.push({ name: "", values: [] }); drawOpts();
      optsEl.querySelector(`#pe-opt-name-${draft.options.length - 1}`).focus();
    });
    varsEl.addEventListener("input", e => {
      const el = e.target.closest(".v-in"); if (!el) return;
      const v = draft.variants[+el.dataset.i];
      v[el.dataset.k] = el.dataset.k === "sku" ? el.value.trim() : Math.max(0, Math.floor(+el.value || 0));
    });

    document.getElementById("pe-save").addEventListener("click", async e => {
      if (busy) return toast("圖片還在處理中，請稍等", "error");
      draft.name = document.getElementById("pe-name").value;
      draft.description = document.getElementById("pe-desc").value;
      draft.status = document.getElementById("pe-st-active").checked ? "active" : "draft";
      draft.categoryIds = [...document.querySelectorAll(".pe-cat:checked")].map(x => x.value);
      draft.options = draft.options.filter(o => o.name && o.values.length);
      draft.variants.forEach((v, i) => { if (!v.sku) v.sku = "SKU-" + Date.now().toString(36).toUpperCase().slice(-5) + "-" + (i + 1); });
      const btn = e.currentTarget;
      try {
        btn.disabled = true;
        const saved = await DB.products.save(draft, p);
        toast("已儲存");
        Router.go("admin/product/" + saved.id);
      } catch (err) { toast(err.message, "error"); btn.disabled = false; }
    });
    const del = document.getElementById("pe-del");
    if (del) del.addEventListener("click", async () => {
      if (await confirmBox({ title: `刪除「${p.name}」？`, body: "刪除後無法復原，過去訂單的紀錄不受影響。", ok: "刪除", danger: true })) {
        try { await DB.products.remove(p.id); toast("已刪除"); Router.go("admin/products"); } catch (err) { toast(err.message, "error"); }
      }
    });
  }

  /* ---------- 分類 ---------- */
  function viewCategories() {
    const cats = DB.categories.list();
    shell("categories", `
      <div class="page-head"><h1>分類</h1></div>
      <section class="panel">
        <div class="panel-head">
          <form class="toolbar" id="cat-form" style="width:100%">
            <input type="text" id="cat-name" placeholder="新分類名稱" aria-label="新分類名稱" style="max-width:260px">
            <button class="btn btn-primary" type="submit">新增分類</button>
          </form>
        </div>
        ${cats.length ? `<div class="table-wrap"><table class="tbl">
          <thead><tr><th>名稱</th><th class="r">商品數</th><th></th></tr></thead>
          <tbody>${cats.map(c => `<tr>
            <td><input type="text" class="cat-rename" data-id="${c.id}" id="cat-rn-${c.id}" value="${esc(c.name)}" aria-label="分類名稱" style="max-width:260px"></td>
            <td class="r num">${DB.categories.productCount(c.id)}</td>
            <td class="r"><button class="btn btn-sm btn-ghost cat-del" data-id="${c.id}" data-name="${esc(c.name)}">刪除</button></td>
          </tr>`).join("")}</tbody></table></div>` : `<div class="empty">還沒有分類</div>`}
      </section>`);
    document.getElementById("cat-form").addEventListener("submit", async e => {
      e.preventDefault();
      try { await DB.categories.add(document.getElementById("cat-name").value); toast("已新增分類"); viewCategories(); }
      catch (err) { toast(err.message, "error"); }
    });
    root().querySelectorAll(".cat-rename").forEach(el => el.addEventListener("change", async () => {
      try { await DB.categories.rename(el.dataset.id, el.value); toast("已更新名稱"); } catch (err) { toast(err.message, "error"); viewCategories(); }
    }));
    root().querySelectorAll(".cat-del").forEach(el => el.addEventListener("click", async () => {
      if (await confirmBox({ title: `刪除分類「${el.dataset.name}」？`, body: "商品不會被刪除，只會移出這個分類。", ok: "刪除", danger: true })) {
        try { await DB.categories.remove(el.dataset.id); toast("已刪除分類"); viewCategories(); } catch (err) { toast(err.message, "error"); }
      }
    }));
  }

  /* ---------- 訂單列表 ---------- */
  let oq = "";
  function viewOrders(status) {
    status = status || "";
    const c = DB.orders.countByStatus();
    const tab = (s, label) => `<a href="#admin/orders${s ? "/" + s : ""}" class="${status === s ? "is-on" : ""}">${label}<span class="n">${s ? c[s] : c.all}</span></a>`;
    shell("orders", `
      <div class="page-head"><h1>訂單</h1><div class="actions"><button class="btn" id="o-export">匯出 Excel</button></div></div>
      <section class="panel">
        <nav class="tabs" aria-label="訂單狀態">
          ${tab("", "全部")}${tab("pending_payment", "待付款")}${tab("paid", "待出貨")}${tab("shipped", "已出貨")}${tab("completed", "已完成")}${tab("cancelled", "已取消")}
        </nav>
        <div class="panel-head"><div class="toolbar"><input type="search" id="oq" placeholder="搜尋編號、姓名、手機" value="${esc(oq)}" aria-label="搜尋訂單"></div></div>
        <div id="o-list"></div>
      </section>`);
    const draw = () => { document.getElementById("o-list").innerHTML = ordersTable(DB.orders.list({ status, q: oq })); };
    draw();
    document.getElementById("oq").addEventListener("input", e => { oq = e.target.value; draw(); });
    document.getElementById("o-export").addEventListener("click", () => exportPrompt(status));
  }

  /* ---------- 訂單匯出 Excel ---------- */
  function exportPrompt(status) {
    const pad = n => String(n).padStart(2, "0");
    const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const today = new Date();
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    const statusLabel = status ? DB.orders.STATUS[status] : "全部狀態";
    const wrap = document.createElement("div");
    wrap.className = "modal-backdrop";
    wrap.innerHTML = `<form class="modal is-wide" id="ex-form" role="dialog" aria-modal="true" aria-labelledby="ex-title">
      <h3 id="ex-title">匯出訂單 Excel</h3>
      <p>會匯出目前分頁（<b>${esc(statusLabel)}</b>）${oq ? `、搜尋「${esc(oq)}」` : ""}的訂單。</p>
      <div class="radio-list">
        <label class="check"><input type="radio" name="ex-range" value="all" checked> 不限日期</label>
        <label class="check"><input type="radio" name="ex-range" value="month"> 本月（${esc(date(monthStart.toISOString()))} 起）</label>
        <label class="check"><input type="radio" name="ex-range" value="custom"> 自訂日期</label>
      </div>
      <div class="grid-form" id="ex-custom" hidden>
        <div class="field"><label for="ex-from">從</label><input type="date" id="ex-from" value="${ymd(monthStart)}"></div>
        <div class="field"><label for="ex-to">到</label><input type="date" id="ex-to" value="${ymd(today)}"></div>
      </div>
      <p class="small" id="ex-count"></p>
      <div class="modal-actions"><button type="button" class="btn" id="ex-cancel">取消</button><button class="btn btn-primary" type="submit" id="ex-go">下載 .xlsx</button></div>
    </form>`;
    document.body.appendChild(wrap);
    const f = wrap.querySelector("#ex-form");
    const filter = () => {
      const r = f.querySelector('input[name="ex-range"]:checked').value;
      const from = r === "month" ? ymd(monthStart) : r === "custom" ? f.querySelector("#ex-from").value : "";
      const to = r === "custom" ? f.querySelector("#ex-to").value : "";
      return { status, q: oq, from, to };
    };
    const refresh = () => {
      f.querySelector("#ex-custom").hidden = f.querySelector('input[name="ex-range"]:checked').value !== "custom";
      const n = DB.orders.list(filter()).length;
      f.querySelector("#ex-count").textContent = `共 ${n} 筆訂單`;
      f.querySelector("#ex-go").disabled = n === 0;
    };
    refresh();
    f.addEventListener("change", refresh);
    const close = () => wrap.remove();
    wrap.querySelector("#ex-cancel").addEventListener("click", close);
    wrap.addEventListener("click", e => { if (e.target === wrap) close(); });
    wrap.querySelector('input[name="ex-range"]:checked').focus();
    f.addEventListener("submit", e => {
      e.preventDefault();
      const fl = filter();
      const list = DB.orders.list(fl);
      if (!list.length) return;
      exportOrders(list, fl);
      close();
      toast(`已匯出 ${list.length} 筆訂單`);
    });
  }

  function exportOrders(list, fl) {
    const pay = o => o.payment.status === "paid" ? "已付款" : "未付款";
    const chronological = list.slice().reverse(); // 由舊到新，符合對帳習慣
    const orderSheet = {
      name: "訂單",
      columns: [
        { header: "訂單編號", width: 12 }, { header: "下單時間", width: 17, type: "datetime" },
        { header: "訂單狀態", width: 9 }, { header: "付款狀態", width: 9 }, { header: "付款方式", width: 20 },
        { header: "顧客姓名", width: 10 }, { header: "手機", width: 12 }, { header: "Email", width: 24 },
        { header: "取貨方式", width: 11 }, { header: "取貨門市", width: 12 }, { header: "收件地址", width: 30 },
        { header: "物流單號", width: 15 }, { header: "商品件數", width: 9, type: "number" },
        { header: "商品小計", width: 10, type: "number" }, { header: "運費", width: 8, type: "number" },
        { header: "折扣", width: 8, type: "number" }, { header: "優惠碼", width: 12 }, { header: "訂單總額", width: 11, type: "number" },
        { header: "備註", width: 30 },
      ],
      rows: chronological.map(o => [
        o.number, o.createdAt, DB.orders.STATUS[o.status], pay(o), o.payment.methodName,
        o.contact.name, o.contact.phone, o.contact.email, o.shipping.methodName, o.shipping.storeName,
        o.shipping.address, o.shipping.trackingNo, o.items.reduce((s, it) => s + it.qty, 0),
        o.subtotal, o.shippingFee, o.discount || 0, o.couponCode || "", o.total, o.note,
      ]),
    };
    const itemSheet = {
      name: "訂單明細",
      columns: [
        { header: "訂單編號", width: 12 }, { header: "下單時間", width: 17, type: "datetime" },
        { header: "訂單狀態", width: 9 }, { header: "顧客姓名", width: 10 },
        { header: "商品名稱", width: 18 }, { header: "規格", width: 12 }, { header: "貨號", width: 14 },
        { header: "單價", width: 9, type: "number" }, { header: "數量", width: 7, type: "number" },
        { header: "小計", width: 10, type: "number" },
      ],
      rows: chronological.flatMap(o => o.items.map(it => [
        o.number, o.createdAt, DB.orders.STATUS[o.status], o.contact.name,
        it.name, it.optionText, it.sku, it.price, it.qty, it.price * it.qty,
      ])),
    };
    const pad = n => String(n).padStart(2, "0");
    const d = new Date();
    const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
    const tag = fl.status ? "_" + DB.orders.STATUS[fl.status] : "";
    download(XLSX.build([orderSheet, itemSheet]), `訂單${tag}_${stamp}.xlsx`);
  }

  /* ---------- 訂單詳情 ---------- */
  function viewOrder(id) {
    const o = DB.orders.get(id);
    if (!o) return notFound("找不到這筆訂單", "admin/orders");
    const next = {
      pending_payment: [["paid", "確認已收款", "btn-primary"], ["cancelled", "取消訂單", ""]],
      paid: [["shipped", "標記已出貨", "btn-primary"], ["cancelled", "取消訂單", ""]],
      shipped: [["completed", "標記已完成", "btn-primary"]],
      completed: [], cancelled: [],
    }[o.status];

    shell("orders", `
      <div class="page-head">
        <div class="crumbs"><a href="#admin/orders">訂單</a><span>/</span><span class="mono">${esc(o.number)}</span></div>
        <div class="actions">${next.map(([s, label, cls]) => `<button class="btn ${cls}" data-next="${s}">${label}</button>`).join("")}</div>
      </div>
      <div class="grid-2">
        <div style="display:grid;gap:16px">
          <section class="panel">
            <div class="panel-head"><h2>訂購商品</h2>${statusPill(o.status)}</div>
            <div class="table-wrap"><table class="tbl">
              <thead><tr><th>商品</th><th>貨號</th><th class="r">單價</th><th class="r">數量</th><th class="r">小計</th></tr></thead>
              <tbody>${o.items.map(it => `<tr>
                <td>${esc(it.name)}${it.optionText ? `<div class="small muted">${esc(it.optionText)}</div>` : ""}</td>
                <td class="mono small">${esc(it.sku)}</td>
                <td class="r num">${money(it.price)}</td><td class="r num">${it.qty}</td><td class="r num">${money(it.price * it.qty)}</td>
              </tr>`).join("")}
              <tr><td colspan="4" class="r muted">商品小計</td><td class="r num">${money(o.subtotal)}</td></tr>
              ${(o.discounts || []).map(d => `<tr><td colspan="4" class="r muted">${esc(d.label)}</td><td class="r num">${d.amount ? "−" + money(d.amount) : "免運"}</td></tr>`).join("")}
              <tr><td colspan="4" class="r muted">運費</td><td class="r num">${o.shippingFee ? money(o.shippingFee) : "免運"}</td></tr>
              <tr><td colspan="4" class="r"><b>總計</b></td><td class="r num"><b>${money(o.total)}</b></td></tr>
              </tbody></table></div>
          </section>
          <section class="panel">
            <div class="panel-head"><h2>商家備註</h2></div>
            <div class="panel-body">
              <textarea id="od-note" rows="3" placeholder="只有後台看得到">${esc(o.note)}</textarea>
              <div><button class="btn btn-sm" id="od-note-save">儲存備註</button></div>
            </div>
          </section>
        </div>
        <div style="display:grid;gap:16px">
          <section class="panel">
            <div class="panel-head"><h2>顧客</h2><a class="small" href="#admin/customer/${o.customerId}">會員資料</a></div>
            <div class="panel-body"><dl class="kv">
              <dt>姓名</dt><dd>${esc(o.contact.name)}</dd>
              <dt>手機</dt><dd class="mono">${esc(o.contact.phone)}</dd>
              <dt>Email</dt><dd>${esc(o.contact.email) || "—"}</dd>
            </dl></div>
          </section>
          <section class="panel">
            <div class="panel-head"><h2>付款</h2>${payPill(o.payment)}</div>
            <div class="panel-body"><dl class="kv">
              <dt>方式</dt><dd>${esc(o.payment.methodName)}</dd>
            </dl><div class="notice">金流尚未串接，付款狀態由商家手動確認。</div></div>
          </section>
          <section class="panel">
            <div class="panel-head"><h2>物流</h2></div>
            <div class="panel-body"><dl class="kv">
              <dt>方式</dt><dd>${esc(o.shipping.methodName)}</dd>
              ${o.shipping.storeName ? `<dt>門市</dt><dd>${esc(o.shipping.storeName)}</dd>` : ""}
              ${o.shipping.address ? `<dt>地址</dt><dd>${esc(o.shipping.address)}</dd>` : ""}
              <dt>物流單號</dt><dd class="mono">${esc(o.shipping.trackingNo) || "—"}</dd>
            </dl></div>
          </section>
          <section class="panel">
            <div class="panel-head"><h2>訂單紀錄</h2></div>
            <div class="panel-body"><ul class="timeline">
              ${o.history.slice().reverse().map(h => `<li><div><b>${DB.orders.STATUS[h.status]}</b> <span class="muted num">${date(h.at, true)}</span>${h.note ? `<div class="muted">${esc(h.note)}</div>` : ""}</div></li>`).join("")}
            </ul></div>
          </section>
        </div>
      </div>`);

    root().querySelectorAll("[data-next]").forEach(b => b.addEventListener("click", async () => {
      const s = b.dataset.next;
      if (s === "cancelled") {
        if (!await confirmBox({ title: "取消這筆訂單？", body: "商品庫存會自動加回去。", ok: "取消訂單", danger: true })) return;
      }
      if (s === "shipped") return shipPrompt(o);
      b.disabled = true;
      try { await DB.orders.setStatus(o.id, s); toast("訂單已更新為「" + DB.orders.STATUS[s] + "」"); viewOrder(o.id); }
      catch (err) { toast(err.message, "error"); b.disabled = false; }
    }));
    document.getElementById("od-note-save").addEventListener("click", async () => {
      try { await DB.orders.setNote(o.id, document.getElementById("od-note").value); toast("已儲存備註"); } catch (err) { toast(err.message, "error"); }
    });
  }

  function shipPrompt(o) {
    const wrap = document.createElement("div");
    wrap.className = "modal-backdrop";
    wrap.innerHTML = `<form class="modal" id="ship-form">
      <h3>標記已出貨</h3>
      <div class="field"><label for="ship-no">物流單號（選填）</label><input type="text" id="ship-no" placeholder="例如 F12345678901"><span class="hint">物流尚未串接，先手動填寫。</span></div>
      <div class="modal-actions"><button type="button" class="btn" id="ship-cancel">取消</button><button class="btn btn-primary" type="submit">確認出貨</button></div>
    </form>`;
    document.body.appendChild(wrap);
    wrap.querySelector("#ship-no").focus();
    wrap.querySelector("#ship-cancel").addEventListener("click", () => wrap.remove());
    wrap.querySelector("#ship-form").addEventListener("submit", async e => {
      e.preventDefault();
      try { await DB.orders.setStatus(o.id, "shipped", { trackingNo: wrap.querySelector("#ship-no").value.trim() }); }
      catch (err) { return toast(err.message, "error"); }
      wrap.remove(); toast("已標記出貨"); viewOrder(o.id);
    });
  }

  /* ---------- 會員 ---------- */
  let cq = "", ctier = "";
  // 等級標籤：第幾級決定顏色深淺
  const tierPill = lv => lv ? `<span class="tier-pill t${Math.min(lv.index, 4)}">${esc(lv.tier.name)}</span>` : "";
  function viewCustomers() {
    const cfg = DB.tiers.get();
    const on = cfg.enabled;
    if (!on) ctier = "";
    shell("customers", `
      <div class="page-head"><h1>會員</h1>${on ? `<a class="btn" href="#admin/tiers">會員等級設定</a>` : ""}</div>
      <section class="panel">
        <div class="panel-head"><div class="toolbar">
          <input type="search" id="cq" placeholder="搜尋姓名、手機、Email" value="${esc(cq)}" aria-label="搜尋會員">
          ${on ? `<select id="ctier" aria-label="等級"><option value="">全部等級</option>${cfg.tiers.map(t => `<option value="${t.id}" ${ctier === t.id ? "selected" : ""}>${esc(t.name)}</option>`).join("")}</select>` : ""}
        </div></div>
        <div id="c-list"></div>
      </section>`);
    const draw = () => {
      const list = DB.customers.list(cq).map(c => Object.assign(c, { level: DB.tiers.of(c.id) }))
        .filter(c => !ctier || (c.level && c.level.tier.id === ctier));
      document.getElementById("c-list").innerHTML = list.length ? `<div class="table-wrap"><table class="tbl">
        <thead><tr><th>姓名</th>${on ? "<th>等級</th>" : ""}<th>帳號</th><th>手機</th><th>Email</th><th class="r">訂單數</th><th class="r">累積消費</th><th>最後購買</th></tr></thead>
        <tbody>${list.map(c => `<tr class="is-link" data-href="admin/customer/${c.id}">
          <td>${esc(c.name)}</td>${on ? `<td>${tierPill(c.level)}</td>` : ""}<td>${accountPill(c)}</td><td class="mono">${esc(c.phone)}</td><td>${esc(c.email) || "—"}</td>
          <td class="r num">${c.orderCount}</td><td class="r num">${money(c.totalSpent)}</td><td class="num">${date(c.lastOrderAt)}</td>
        </tr>`).join("")}</tbody></table></div>` : `<div class="empty">沒有符合的會員</div>`;
    };
    draw();
    document.getElementById("cq").addEventListener("input", e => { cq = e.target.value; draw(); });
    const sel = document.getElementById("ctier");
    if (sel) sel.addEventListener("change", e => { ctier = e.target.value; draw(); });
  }

  /* ---------- 會員等級設定 ---------- */
  function viewTiers() {
    const cfg = DB.tiers.get();
    const rows = cfg.tiers.map(t => ({ ...t }));
    const counts = {};
    DB.customers.list().forEach(c => { const lv = DB.tiers.of(c.id); if (lv) counts[lv.tier.id] = (counts[lv.tier.id] || 0) + 1; });
    shell("tiers", `
      <div class="page-head"><h1>會員等級</h1><button class="btn btn-primary" id="tr-save">儲存</button></div>
      <div class="grid-2">
        <section class="panel">
          <div class="panel-head"><h2>等級與權益</h2><button class="btn btn-sm" type="button" id="tr-add">新增等級</button></div>
          <div class="table-wrap"><table class="tbl variant-tbl tier-tbl">
            <thead><tr><th>等級名稱</th><th>升級門檻（NT$）</th><th>折數</th><th>免運</th><th class="r">目前人數</th><th></th></tr></thead>
            <tbody id="tr-rows"></tbody>
          </table></div>
          <div class="panel-body" style="padding-top:0">
            <p class="small muted" style="margin:0">折數填 95 代表 95 折、9 折填 90、不打折填 100。第一級是所有會員的起點，門檻固定為 0。會員升到哪一級，就用那一級的折數，不會累加。</p>
          </div>
        </section>
        <div style="display:grid;gap:16px">
          <section class="panel">
            <div class="panel-head"><h2>規則</h2></div>
            <div class="panel-body">
              <label class="check"><input type="checkbox" id="tr-on" ${cfg.enabled ? "checked" : ""}> 啟用會員分級</label>
              <div class="field"><label for="tr-period">消費怎麼算</label>
                <select id="tr-period">
                  <option value="all" ${cfg.period === "all" ? "selected" : ""}>全部累積（只升不降）</option>
                  <option value="12m" ${cfg.period === "12m" ? "selected" : ""}>最近 12 個月（會自動降級）</option>
                </select>
                <span class="hint">只算已付款、沒取消的訂單（待出貨、已出貨、已完成）</span>
              </div>
            </div>
          </section>
          <section class="panel">
            <div class="panel-head"><h2>結帳時怎麼折</h2></div>
            <div class="panel-body">
              <p class="small" style="margin:0;line-height:1.8">商品小計 → 滿額活動 → <b>會員等級折扣</b> → 優惠碼 → 運費<br>
              <span class="muted">等級優惠只在會員登入後結帳才會套用。沒登入的顧客仍會累積消費，登入後就能享有。</span></p>
            </div>
          </section>
        </div>
      </div>`);
    const body = document.getElementById("tr-rows");
    const draw = () => {
      body.innerHTML = rows.map((t, i) => `<tr>
        <td><input type="text" data-i="${i}" data-k="name" id="tr-name-${i}" value="${esc(t.name)}" maxlength="12" aria-label="等級名稱"></td>
        <td><input type="number" data-i="${i}" data-k="minSpend" id="tr-min-${i}" value="${i === 0 ? 0 : t.minSpend}" min="0" step="100" ${i === 0 ? "disabled" : ""} aria-label="升級門檻"></td>
        <td><input type="number" data-i="${i}" data-k="percent" id="tr-pct-${i}" value="${t.percent}" min="1" max="100" step="1" aria-label="折數"></td>
        <td><input type="checkbox" data-i="${i}" data-k="freeShip" id="tr-ship-${i}" ${t.freeShip ? "checked" : ""} aria-label="免運" style="width:16px;height:16px;accent-color:var(--accent)"></td>
        <td class="r num">${t.id && counts[t.id] ? counts[t.id] : 0}</td>
        <td class="r">${i === 0 ? "" : `<button class="btn btn-sm btn-ghost" type="button" data-del="${i}">移除</button>`}</td>
      </tr>`).join("");
    };
    draw();
    body.addEventListener("input", e => {
      const el = e.target.closest("[data-k]"); if (!el) return;
      const t = rows[+el.dataset.i];
      t[el.dataset.k] = el.type === "checkbox" ? el.checked : el.type === "number" ? +el.value : el.value;
    });
    body.addEventListener("change", e => { const el = e.target.closest('[data-k="freeShip"]'); if (el) rows[+el.dataset.i].freeShip = el.checked; });
    body.addEventListener("click", e => { const b = e.target.closest("[data-del]"); if (b) { rows.splice(+b.dataset.del, 1); draw(); } });
    document.getElementById("tr-add").addEventListener("click", () => {
      if (rows.length >= 5) return toast("最多 5 個等級", "error");
      const last = rows[rows.length - 1];
      rows.push({ name: "", minSpend: last.minSpend ? last.minSpend * 2 : 3000, percent: Math.max(80, last.percent - 5), freeShip: false });
      draw(); document.getElementById(`tr-name-${rows.length - 1}`).focus();
    });
    document.getElementById("tr-save").addEventListener("click", async () => {
      try {
        await DB.tiers.save({ enabled: document.getElementById("tr-on").checked, period: document.getElementById("tr-period").value, tiers: rows });
        toast("已儲存會員等級"); viewTiers();
      } catch (err) { toast(err.message, "error"); }
    });
  }

  function viewCustomer(id) {
    const c = DB.customers.get(id);
    if (!c) return notFound("找不到這位會員", "admin/customers");
    const lv = DB.tiers.of(c.id);
    shell("customers", `
      <div class="page-head"><div class="crumbs"><a href="#admin/customers">會員</a><span>/</span><span>${esc(c.name)}</span></div></div>
      <div class="kpis">
        <div class="kpi"><span>累積消費</span><strong>${money(c.totalSpent)}</strong></div>
        <div class="kpi"><span>訂單數</span><strong>${c.orderCount}</strong></div>
        <div class="kpi"><span>平均客單</span><strong>${money(c.orderCount ? c.totalSpent / c.orderCount : 0)}</strong></div>
        <div class="kpi"><span>加入日期</span><strong style="font-size:17px">${date(c.createdAt)}</strong></div>
      </div>
      <div class="grid-2">
        <section class="panel"><div class="panel-head"><h2>訂單紀錄</h2></div>${ordersTable(DB.orders.byCustomer(c.id))}</section>
        <div style="display:grid;gap:16px">
        <section class="panel"><div class="panel-head"><h2>聯絡資料</h2></div>
          <div class="panel-body"><dl class="kv">
            <dt>帳號</dt><dd>${accountPill(c)}${c.hasAccount ? ` <span class="small muted">${date(c.registeredAt)} 開通</span>` : ""}</dd>
            <dt>手機</dt><dd class="mono">${esc(c.phone)}</dd><dt>Email</dt><dd>${esc(c.email) || "—"}</dd></dl>
          ${c.hasAccount ? "" : `<p class="small muted" style="margin:0">這位顧客是結帳時自動建立的。${DB.mode === "remote"
            ? "他用下單時填的同一個 Email 在前台註冊會員後，這些訂單會自動接到他的帳號。"
            : "他用同一支手機在前台註冊後，就能登入看到這些訂單。"}</p>`}</div>
        </section>
        ${lv ? `<section class="panel"><div class="panel-head"><h2>會員等級</h2>${tierPill(lv)}</div>
          <div class="panel-body">
            <dl class="kv"><dt>有效消費</dt><dd class="num">${money(lv.spent)}</dd><dt>目前權益</dt><dd>${esc(DB.tiers.benefit(lv.tier))}</dd></dl>
            ${lv.next ? `<div style="display:grid;gap:6px">
              <div class="small">再消費 <b class="num">${money(lv.gap)}</b> 升級為「${esc(lv.next.name)}」</div>
              <div class="meter"><i style="width:${Math.min(100, (lv.spent - lv.tier.minSpend) / (lv.next.minSpend - lv.tier.minSpend) * 100).toFixed(1)}%"></i></div>
            </div>` : `<div class="small muted">已經是最高等級</div>`}
            ${c.hasAccount ? "" : `<p class="small muted" style="margin:0">還沒開通帳號，等級優惠要登入後結帳才會套用。</p>`}
          </div></section>` : ""}
        </div>
      </div>`);
  }

  /* ---------- 設定 ---------- */
  function viewSettings() {
    const st = DB.settings.get();
    shell("settings", `
      <div class="page-head"><h1>設定</h1><button class="btn btn-primary" id="st-save">儲存設定</button></div>
      <section class="panel">
        <div class="panel-head"><h2>商店資料</h2></div>
        <div class="panel-body grid-form">
          <div class="field"><label for="st-name">商店名稱</label><input type="text" id="st-name" value="${esc(st.name)}"></div>
          <div class="field"><label for="st-tagline">一句話介紹</label><input type="text" id="st-tagline" value="${esc(st.tagline)}"></div>
          <div class="field"><label for="st-email">客服 Email</label><input type="email" id="st-email" value="${esc(st.email)}"></div>
          <div class="field"><label for="st-phone">客服電話</label><input type="tel" id="st-phone" value="${esc(st.phone)}"></div>
        </div>
      </section>
      <section class="panel">
        <div class="panel-head"><h2>運費與庫存</h2></div>
        <div class="panel-body grid-form">
          <div class="field"><label for="st-free">免運門檻（NT$）</label><input type="number" id="st-free" min="0" step="1" value="${st.freeShippingThreshold}"><span class="hint">填 0 代表不設免運</span></div>
          <div class="field"><label for="st-low">低庫存提醒（件）</label><input type="number" id="st-low" min="0" step="1" value="${st.lowStockAlert}"><span class="hint">規格庫存小於等於這個數字時，總覽會提醒</span></div>
        </div>
      </section>
      <section class="panel">
        <div class="panel-head"><h2>取貨方式</h2><span class="pill warn">物流未串接</span></div>
        <div class="panel-body" style="gap:0">
          ${st.shippingMethods.map((m, i) => `<div class="method-row">
            <input type="checkbox" class="sm-on" id="sm-on-${m.id}" data-i="${i}" ${m.enabled ? "checked" : ""} aria-label="啟用 ${esc(m.name)}" style="width:16px;height:16px;accent-color:var(--accent)">
            <label for="sm-on-${m.id}">${esc(m.name)}</label>
            <input type="number" class="sm-fee" id="sm-fee-${m.id}" data-i="${i}" min="0" step="1" value="${m.fee}" aria-label="${esc(m.name)} 運費">
          </div>`).join("")}
        </div>
      </section>
      <section class="panel">
        <div class="panel-head"><h2>付款方式</h2><span class="pill warn">金流未串接</span></div>
        <div class="panel-body" style="gap:0">
          ${st.paymentMethods.map((m, i) => `<div class="method-row">
            <input type="checkbox" class="pm-on" id="pm-on-${m.id}" data-i="${i}" ${m.enabled ? "checked" : ""} ${m.id === "card" ? "disabled" : ""} aria-label="啟用 ${esc(m.name)}" style="width:16px;height:16px;accent-color:var(--accent)">
            <label for="pm-on-${m.id}">${esc(m.name)}<div class="small muted">${esc(m.instruction)}</div></label>
            <span class="pill ${m.id === "card" ? "idle" : "info"}">${m.id === "card" ? "待串接" : "人工確認"}</span>
          </div>`).join("")}
        </div>
      </section>
      ${DB.mode === "remote" ? `<section class="panel">
        <div class="panel-head"><h2>帳號與資料</h2></div>
        <div class="panel-body"><dl class="kv">
          <dt>登入帳號</dt><dd>${esc((DB.admin.user() || {}).email || "")}</dd>
          <dt>資料存放</dt><dd>Supabase 資料庫（商店代號 <span class="mono">${esc((window.SHOP_CONFIG || {}).storeSlug || "")}</span>）</dd>
        </dl></div>
      </section>` : ""}
      <section class="panel" ${DB.features.reset ? "" : "hidden"}>
        <div class="panel-head"><h2>開發工具</h2></div>
        <div class="panel-body">
          <p class="muted" style="margin:0">目前資料只存在這個瀏覽器裡（儲存空間約已使用 ${Math.round(DB.media.usage().ratio * 100)}%）。重置會把商品、訂單、會員、商品圖片都換回範例資料。</p>
          <div class="actions"><button class="btn" id="st-reset">重置範例資料</button></div>
        </div>
      </section>`);

    document.getElementById("st-save").addEventListener("click", async () => {
      const cur = DB.settings.get();
      cur.name = document.getElementById("st-name").value.trim() || cur.name;
      cur.tagline = document.getElementById("st-tagline").value.trim();
      cur.email = document.getElementById("st-email").value.trim();
      cur.phone = document.getElementById("st-phone").value.trim();
      cur.freeShippingThreshold = Math.max(0, Math.floor(+document.getElementById("st-free").value || 0));
      cur.lowStockAlert = Math.max(0, Math.floor(+document.getElementById("st-low").value || 0));
      root().querySelectorAll(".sm-on").forEach(el => { cur.shippingMethods[+el.dataset.i].enabled = el.checked; });
      root().querySelectorAll(".sm-fee").forEach(el => { cur.shippingMethods[+el.dataset.i].fee = Math.max(0, Math.floor(+el.value || 0)); });
      root().querySelectorAll(".pm-on").forEach(el => { cur.paymentMethods[+el.dataset.i].enabled = el.checked; });
      if (!cur.shippingMethods.some(m => m.enabled)) return toast("至少要開一種取貨方式", "error");
      if (!cur.paymentMethods.some(m => m.enabled)) return toast("至少要開一種付款方式", "error");
      try { await DB.settings.update(cur); toast("已儲存設定"); viewSettings(); } catch (err) { toast(err.message, "error"); }
    });
    document.getElementById("st-reset").addEventListener("click", async () => {
      if (await confirmBox({ title: "重置範例資料？", body: "你新增或修改的商品、訂單、會員、圖片都會被清掉。", ok: "重置", danger: true })) {
        try { await DB.reset(); toast("已重置範例資料"); Router.go("admin"); } catch (err) { toast(err.message, "error"); }
      }
    });
  }

  /* ---------- 行銷：共用 ---------- */
  const PERIOD_PILL = { active: ["ok", "進行中"], scheduled: ["info", "尚未開始"], expired: ["idle", "已結束"], off: ["idle", "已停用"] };
  const periodPill = s => `<span class="pill ${PERIOD_PILL[s][0]}">${PERIOD_PILL[s][1]}</span>`;
  const periodText = x => !x.startAt && !x.endAt ? "不限期間" : `${x.startAt ? x.startAt.replace(/-/g, "/") : "即日起"} – ${x.endAt ? x.endAt.replace(/-/g, "/") : "不限"}`;
  const periodFields = (x, prefix) => `
    <div class="field"><label for="${prefix}-start">開始日期</label><input type="date" id="${prefix}-start" value="${esc(x.startAt || "")}"><span class="hint">空白代表立即開始</span></div>
    <div class="field"><label for="${prefix}-end">結束日期</label><input type="date" id="${prefix}-end" value="${esc(x.endAt || "")}"><span class="hint">空白代表不限；當天結束前都有效</span></div>`;

  /* ---------- 優惠券 ---------- */
  function viewCoupons() {
    const list = DB.coupons.list();
    shell("coupons", `
      <div class="page-head"><h1>優惠券</h1><div class="actions"><a class="btn btn-primary" href="#admin/coupon/new">新增優惠券</a></div></div>
      <section class="panel">
        ${list.length ? `<div class="table-wrap"><table class="tbl">
          <thead><tr><th>優惠碼</th><th>名稱</th><th>內容</th><th>期間</th><th class="r">已使用</th><th>狀態</th></tr></thead>
          <tbody>${list.map(c => `<tr class="is-link" data-href="admin/coupon/${c.id}">
            <td class="mono">${esc(c.code)}</td>
            <td>${esc(c.name)}${c.membersOnly ? ` <span class="pill info">限會員</span>` : ""}</td>
            <td>${esc(DB.coupons.describe(c))}</td>
            <td class="num small">${esc(periodText(c))}</td>
            <td class="r num">${c.used}${c.usageLimit ? ` / ${c.usageLimit}` : ""}</td>
            <td>${periodPill(c.state)}</td>
          </tr>`).join("")}</tbody></table></div>` : `<div class="empty">還沒有優惠券</div>`}
      </section>
      <p class="small muted" style="margin:0">「已使用」只算沒有取消的訂單；訂單取消後，優惠券次數會自動退回。</p>`);
  }

  function viewCouponEdit(id) {
    const isNew = id === "new";
    const c = isNew
      ? { code: "", name: "", type: "amount", value: 100, maxDiscount: 0, minSpend: 0, startAt: "", endAt: "", usageLimit: 0, perCustomer: 1, membersOnly: false, stackable: true, enabled: true, used: 0 }
      : DB.coupons.get(id);
    if (!c) return notFound("找不到這張優惠券", "admin/coupons");
    shell("coupons", `
      <div class="page-head">
        <div class="crumbs"><a href="#admin/coupons">優惠券</a><span>/</span><span>${isNew ? "新增優惠券" : esc(c.code)}</span></div>
        <div class="actions">${isNew ? "" : `<button class="btn" id="cp-del">刪除</button>`}<button class="btn btn-primary" id="cp-save">儲存</button></div>
      </div>
      <div class="grid-2">
        <div style="display:grid;gap:16px">
          <section class="panel">
            <div class="panel-head"><h2>基本資料</h2>${isNew ? "" : periodPill(c.state)}</div>
            <div class="panel-body grid-form">
              <div class="field"><label for="cp-code">優惠碼</label><input type="text" id="cp-code" value="${esc(c.code)}" maxlength="20" style="text-transform:uppercase;font-family:var(--mono)" placeholder="例如 WELCOME100"><span class="hint">顧客結帳時輸入，英文字母或數字 3～20 個</span></div>
              <div class="field"><label for="cp-name">名稱</label><input type="text" id="cp-name" value="${esc(c.name)}" maxlength="30" placeholder="例如 新客折 100"><span class="hint">顧客和訂單上會看到</span></div>
            </div>
          </section>
          <section class="panel">
            <div class="panel-head"><h2>優惠內容</h2></div>
            <div class="panel-body">
              <div class="radio-list">
                ${Object.entries(DB.coupons.TYPES).map(([k, label]) => `<label class="check"><input type="radio" name="cp-type" value="${k}" id="cp-type-${k}" ${c.type === k ? "checked" : ""}> ${label}</label>`).join("")}
              </div>
              <div class="grid-form">
                <div class="field" id="cp-value-f"><label for="cp-value" id="cp-value-l"></label><input type="number" id="cp-value" min="0" step="1" value="${c.value}"><span class="hint" id="cp-value-h"></span></div>
                <div class="field" id="cp-max-f"><label for="cp-max">最多折抵（NT$）</label><input type="number" id="cp-max" min="0" step="1" value="${c.maxDiscount}"><span class="hint">0 代表不設上限</span></div>
                <div class="field"><label for="cp-min">使用門檻（NT$）</label><input type="number" id="cp-min" min="0" step="1" value="${c.minSpend}"><span class="hint">商品金額滿多少才能用，0 代表不限</span></div>
              </div>
              <p class="small" id="cp-preview" style="margin:0"></p>
            </div>
          </section>
        </div>
        <div style="display:grid;gap:16px">
          <section class="panel">
            <div class="panel-head"><h2>期間與狀態</h2></div>
            <div class="panel-body">
              ${periodFields(c, "cp")}
              <label class="check"><input type="checkbox" id="cp-on" ${c.enabled ? "checked" : ""}> 啟用</label>
            </div>
          </section>
          <section class="panel">
            <div class="panel-head"><h2>使用限制</h2></div>
            <div class="panel-body">
              <div class="field"><label for="cp-limit">總共可用幾次</label><input type="number" id="cp-limit" min="0" step="1" value="${c.usageLimit}"><span class="hint">0 代表不限；目前已用 ${c.used || 0} 次</span></div>
              <div class="field"><label for="cp-per">每位顧客可用幾次</label><input type="number" id="cp-per" min="0" step="1" value="${c.perCustomer}"><span class="hint">用會員帳號或下單手機計算，0 代表不限</span></div>
              <label class="check"><input type="checkbox" id="cp-members" ${c.membersOnly ? "checked" : ""}> 限登入會員使用</label>
              <label class="check"><input type="checkbox" id="cp-stack" ${c.stackable ? "checked" : ""}> 可以和滿額活動一起用</label>
            </div>
          </section>
        </div>
      </div>`);

    const val = () => ({
      id: c.id, code: document.getElementById("cp-code").value, name: document.getElementById("cp-name").value,
      type: (root().querySelector('input[name="cp-type"]:checked') || {}).value,
      value: +document.getElementById("cp-value").value, maxDiscount: +document.getElementById("cp-max").value,
      minSpend: +document.getElementById("cp-min").value,
      startAt: document.getElementById("cp-start").value, endAt: document.getElementById("cp-end").value,
      usageLimit: +document.getElementById("cp-limit").value, perCustomer: +document.getElementById("cp-per").value,
      membersOnly: document.getElementById("cp-members").checked, stackable: document.getElementById("cp-stack").checked,
      enabled: document.getElementById("cp-on").checked,
    });
    function drawType() {
      const t = val().type;
      document.getElementById("cp-value-f").hidden = t === "freeship";
      document.getElementById("cp-max-f").hidden = t !== "percent";
      document.getElementById("cp-value-l").textContent = t === "percent" ? "打幾折" : "折抵金額（NT$）";
      document.getElementById("cp-value-h").textContent = t === "percent" ? "85 代表 85 折；9 折請填 90" : "";
      const v = val();
      document.getElementById("cp-preview").innerHTML = `顧客會看到：<b>${esc(DB.coupons.describe(v))}</b>`;
    }
    drawType();
    root().querySelector(".main").addEventListener("input", drawType);
    root().querySelector(".main").addEventListener("change", drawType);
    document.getElementById("cp-save").addEventListener("click", async () => {
      try { const s = await DB.coupons.save(val()); toast("已儲存優惠券"); Router.go("admin/coupon/" + s.id); }
      catch (err) { toast(err.message, "error"); }
    });
    const del = document.getElementById("cp-del");
    if (del) del.addEventListener("click", async () => {
      if (await confirmBox({ title: `刪除優惠碼 ${c.code}？`, body: "已經用過的訂單折扣不受影響，但顧客之後就不能再用這個碼。", ok: "刪除", danger: true })) {
        try { await DB.coupons.remove(c.id); toast("已刪除"); Router.go("admin/coupons"); } catch (err) { toast(err.message, "error"); }
      }
    });
  }

  /* ---------- 滿額活動 ---------- */
  function viewPromotions() {
    const list = DB.promotions.list();
    shell("promotions", `
      <div class="page-head"><h1>滿額活動</h1><div class="actions"><a class="btn btn-primary" href="#admin/promotion/new">新增活動</a></div></div>
      <section class="panel">
        ${list.length ? `<div class="table-wrap"><table class="tbl">
          <thead><tr><th>活動名稱</th><th>內容</th><th>期間</th><th>狀態</th></tr></thead>
          <tbody>${list.map(p => `<tr class="is-link" data-href="admin/promotion/${p.id}">
            <td>${esc(p.name)}</td><td>${esc(DB.promotions.describe(p))}</td>
            <td class="num small">${esc(periodText(p))}</td><td>${periodPill(p.state)}</td>
          </tr>`).join("")}</tbody></table></div>` : `<div class="empty">還沒有滿額活動</div>`}
      </section>
      <p class="small muted" style="margin:0">結帳時會自動套用。同時有好幾個活動進行中時，系統會幫顧客挑折最多的那一段。</p>`);
  }

  function viewPromotionEdit(id) {
    const isNew = id === "new";
    const p = isNew ? { name: "", tiers: [{ min: 1500, off: 150 }], startAt: "", endAt: "", enabled: true } : DB.promotions.get(id);
    if (!p) return notFound("找不到這個活動", "admin/promotions");
    const tiers = p.tiers.map(t => ({ ...t }));
    shell("promotions", `
      <div class="page-head">
        <div class="crumbs"><a href="#admin/promotions">滿額活動</a><span>/</span><span>${isNew ? "新增活動" : esc(p.name)}</span></div>
        <div class="actions">${isNew ? "" : `<button class="btn" id="pm-del">刪除</button>`}<button class="btn btn-primary" id="pm-save">儲存</button></div>
      </div>
      <div class="grid-2">
        <section class="panel">
          <div class="panel-head"><h2>活動內容</h2>${isNew ? "" : periodPill(p.state)}</div>
          <div class="panel-body">
            <div class="field"><label for="pm-name">活動名稱</label><input type="text" id="pm-name" value="${esc(p.name)}" maxlength="30" placeholder="例如 秋季滿額折"><span class="hint">顧客在購物車和訂單上會看到</span></div>
            <div class="label">滿額門檻</div>
            <div id="pm-tiers" style="display:grid;gap:8px"></div>
            <div><button class="btn btn-sm" type="button" id="pm-add">新增一段</button></div>
            <p class="small muted" style="margin:0">例如「滿 1500 折 150」「滿 3000 折 400」，買到 3200 就折 400，不會兩段疊加。門檻看的是商品原價小計。</p>
          </div>
        </section>
        <section class="panel">
          <div class="panel-head"><h2>期間與狀態</h2></div>
          <div class="panel-body">
            ${periodFields(p, "pm")}
            <label class="check"><input type="checkbox" id="pm-on" ${p.enabled ? "checked" : ""}> 啟用</label>
          </div>
        </section>
      </div>`);
    const box = document.getElementById("pm-tiers");
    const draw = () => {
      box.innerHTML = tiers.map((t, i) => `<div class="tier-row">
        <span>滿</span><input type="number" min="0" step="1" data-i="${i}" data-k="min" id="pm-min-${i}" value="${t.min}" aria-label="門檻金額">
        <span>折</span><input type="number" min="0" step="1" data-i="${i}" data-k="off" id="pm-off-${i}" value="${t.off}" aria-label="折抵金額">
        <button class="btn btn-sm btn-ghost" type="button" data-del="${i}" ${tiers.length === 1 ? "disabled" : ""}>移除</button>
      </div>`).join("");
    };
    draw();
    box.addEventListener("input", e => { const el = e.target.closest("[data-k]"); if (el) tiers[+el.dataset.i][el.dataset.k] = +el.value; });
    box.addEventListener("click", e => { const b = e.target.closest("[data-del]"); if (b && tiers.length > 1) { tiers.splice(+b.dataset.del, 1); draw(); } });
    document.getElementById("pm-add").addEventListener("click", () => {
      if (tiers.length >= 5) return toast("最多 5 段", "error");
      const last = tiers[tiers.length - 1] || { min: 0, off: 0 };
      tiers.push({ min: last.min * 2 || 1000, off: last.off * 2 || 100 }); draw();
    });
    document.getElementById("pm-save").addEventListener("click", async () => {
      try {
        const s = await DB.promotions.save({ id: p.id, name: document.getElementById("pm-name").value, tiers,
          startAt: document.getElementById("pm-start").value, endAt: document.getElementById("pm-end").value,
          enabled: document.getElementById("pm-on").checked });
        toast("已儲存活動"); Router.go("admin/promotion/" + s.id);
      } catch (err) { toast(err.message, "error"); }
    });
    const del = document.getElementById("pm-del");
    if (del) del.addEventListener("click", async () => {
      if (await confirmBox({ title: `刪除「${p.name}」？`, body: "已成立訂單的折扣不受影響。", ok: "刪除", danger: true })) {
        try { await DB.promotions.remove(p.id); toast("已刪除"); Router.go("admin/promotions"); } catch (err) { toast(err.message, "error"); }
      }
    });
  }

  /* =========================================================
   * 進銷存：庫存、異動紀錄、進貨單、供應商
   * ========================================================= */
  const variantThumb = r => r.image
    ? `<div class="thumb"><img src="${esc(r.image)}" alt=""></div>`
    : `<div class="thumb" style="background:${esc(r.color)}">${esc(r.name.slice(0, 1))}</div>`;
  const PO_PILL = { draft: "idle", ordered: "info", partial: "warn", received: "ok", cancelled: "bad" };
  const poPill = s => `<span class="pill ${PO_PILL[s]}">${DB.purchases.STATUS[s]}</span>`;
  const MOVE_PILL = { sale: "info", cancel: "warn", purchase: "ok", adjust: "warn", edit: "idle", initial: "idle" };
  const signed = n => (n > 0 ? "+" : n < 0 ? "−" : "") + Math.abs(n);

  /* ---------- 庫存總覽 ---------- */
  const sf = { q: "", filter: "" };
  function viewStock() {
    const s = DB.inventory.summary();
    shell("stock", `
      <div class="page-head"><h1>庫存</h1>
        <div class="actions"><a class="btn" href="#admin/moves">異動紀錄</a><button class="btn" id="st-export">匯出 Excel</button><a class="btn btn-primary" href="#admin/purchase/new">建立進貨單</a></div>
      </div>
      <div class="kpis">
        <div class="kpi"><span>規格數</span><strong>${s.skus}</strong><small>含草稿商品</small></div>
        <div class="kpi"><span>庫存件數</span><strong>${s.units.toLocaleString("zh-TW")}</strong><small>在途 ${s.incoming} 件</small></div>
        <div class="kpi"><span>庫存成本</span><strong>${money(s.value)}</strong><small>庫存 × 平均成本</small></div>
        <a class="kpi" href="#admin/stock" data-low="1"><span>庫存偏低</span><strong>${s.low}</strong><small>上架中、≤ ${DB.settings.get().lowStockAlert} 件</small></a>
      </div>
      <section class="panel">
        <div class="panel-head"><div class="toolbar">
          <input type="search" id="sf-q" placeholder="搜尋商品、規格、貨號" value="${esc(sf.q)}" aria-label="搜尋庫存">
          <select id="sf-filter" aria-label="篩選"><option value="">全部</option><option value="low" ${sf.filter === "low" ? "selected" : ""}>庫存偏低</option><option value="out" ${sf.filter === "out" ? "selected" : ""}>缺貨</option></select>
        </div></div>
        <div id="sf-list"></div>
      </section>`);
    const draw = () => {
      const rows = DB.inventory.list(sf);
      document.getElementById("sf-list").innerHTML = rows.length ? `<div class="table-wrap"><table class="tbl">
        <thead><tr><th>商品／規格</th><th>貨號</th><th class="r">可售庫存</th><th class="r">在途</th><th class="r">平均成本</th><th class="r">庫存成本</th><th></th></tr></thead>
        <tbody>${rows.map(r => `<tr>
          <td><div class="prod-cell">${variantThumb(r)}<div><a href="#admin/product/${r.productId}">${esc(r.name)}</a><span class="small muted">${esc(r.optionText || "單一規格")}${r.status === "draft" ? "・草稿" : ""}</span></div></div></td>
          <td class="mono small">${esc(r.sku)}</td>
          <td class="r num">${r.stock === 0 ? `<span class="pill bad">0</span>` : r.low ? `<span class="pill warn">${r.stock}</span>` : r.stock}</td>
          <td class="r num">${r.incoming ? `<span class="pill info">+${r.incoming}</span>` : `<span class="muted">—</span>`}</td>
          <td class="r num">${r.cost ? money(r.cost) : `<span class="muted">—</span>`}</td>
          <td class="r num">${money(r.value)}</td>
          <td class="r"><button class="btn btn-sm" data-adjust="${r.variantId}">調整</button> <a class="btn btn-sm btn-ghost" href="#admin/moves/${r.variantId}">紀錄</a></td>
        </tr>`).join("")}</tbody></table></div>` : `<div class="empty">沒有符合的規格</div>`;
    };
    draw();
    document.getElementById("sf-q").addEventListener("input", e => { sf.q = e.target.value; draw(); });
    document.getElementById("sf-filter").addEventListener("change", e => { sf.filter = e.target.value; draw(); });
    root().querySelector("[data-low]").addEventListener("click", () => { sf.filter = "low"; });
    document.getElementById("sf-list").addEventListener("click", e => {
      const b = e.target.closest("[data-adjust]");
      if (b) adjustPrompt(b.dataset.adjust, viewStock);
    });
    document.getElementById("st-export").addEventListener("click", () => {
      const rows = DB.inventory.list();
      const d = new Date(), pad = n => String(n).padStart(2, "0");
      download(XLSX.build([{
        name: "庫存",
        columns: [
          { header: "商品", width: 18 }, { header: "規格", width: 12 }, { header: "貨號", width: 14 }, { header: "狀態", width: 8 },
          { header: "售價", width: 9, type: "number" }, { header: "可售庫存", width: 9, type: "number" }, { header: "在途", width: 7, type: "number" },
          { header: "平均成本", width: 10, type: "number" }, { header: "庫存成本", width: 11, type: "number" },
        ],
        rows: rows.map(r => [r.name, r.optionText, r.sku, r.status === "active" ? "上架中" : "草稿", r.price, r.stock, r.incoming, r.cost, r.value]),
      }]), `庫存_${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}.xlsx`);
      toast(`已匯出 ${rows.length} 個規格`);
    });
  }

  function adjustPrompt(variantId, after) {
    const r = DB.inventory.list().find(x => x.variantId === variantId);
    if (!r) return;
    const wrap = document.createElement("div");
    wrap.className = "modal-backdrop";
    wrap.innerHTML = `<form class="modal is-wide" id="aj-form" role="dialog" aria-modal="true" aria-labelledby="aj-title" novalidate>
      <h3 id="aj-title">調整庫存</h3>
      <p>${esc(r.name)}${r.optionText ? `・${esc(r.optionText)}` : ""}　<span class="mono">${esc(r.sku)}</span><br>目前庫存 <b class="num">${r.stock}</b></p>
      <div class="radio-list">
        <label class="check"><input type="radio" name="aj-mode" value="set" checked> 盤點後的實際數量</label>
        <label class="check"><input type="radio" name="aj-mode" value="delta"> 增加或減少（減少請填負數）</label>
      </div>
      <div class="grid-form">
        <div class="field"><label for="aj-qty" id="aj-qty-l">實際數量</label><input type="number" id="aj-qty" step="1" value="${r.stock}"></div>
        <div class="field"><label for="aj-reason">原因</label><select id="aj-reason">${DB.inventory.ADJUST_REASONS.map(x => `<option>${esc(x)}</option>`).join("")}</select></div>
      </div>
      <div class="field"><label for="aj-note">備註（選填）</label><input type="text" id="aj-note" maxlength="60" placeholder="例如 10/1 月底盤點"></div>
      <p class="small" id="aj-preview" style="margin:0"></p>
      <div class="modal-actions"><button type="button" class="btn" id="aj-cancel">取消</button><button class="btn btn-primary" type="submit">確認調整</button></div>
    </form>`;
    document.body.appendChild(wrap);
    const f = wrap.querySelector("#aj-form");
    const mode = () => f.querySelector('input[name="aj-mode"]:checked').value;
    const preview = () => {
      const n = Math.floor(+f.querySelector("#aj-qty").value || 0);
      const target = mode() === "set" ? n : r.stock + n;
      const d = target - r.stock;
      f.querySelector("#aj-preview").innerHTML = d === 0 ? `<span class="muted">數量沒有變化</span>`
        : `調整後 <b class="num">${target}</b>（${d > 0 ? "多" : "少"} ${Math.abs(d)} 件）${target < 0 ? `<span style="color:var(--bad)">　不能小於 0</span>` : ""}`;
    };
    f.addEventListener("change", e => {
      if (e.target.name === "aj-mode") {
        f.querySelector("#aj-qty-l").textContent = mode() === "set" ? "實際數量" : "增減數量";
        f.querySelector("#aj-qty").value = mode() === "set" ? r.stock : 0;
      }
      preview();
    });
    f.addEventListener("input", preview);
    preview();
    const close = () => wrap.remove();
    wrap.querySelector("#aj-cancel").addEventListener("click", close);
    wrap.addEventListener("click", e => { if (e.target === wrap) close(); });
    f.querySelector("#aj-qty").select();
    f.addEventListener("submit", async e => {
      e.preventDefault();
      try {
        const res = await DB.inventory.adjust(variantId, { mode: mode(), qty: f.querySelector("#aj-qty").value, reason: f.querySelector("#aj-reason").value, note: f.querySelector("#aj-note").value });
        close(); toast(`庫存已調整為 ${res.stock}（${signed(res.delta)}）`); after();
      } catch (err) { toast(err.message, "error"); }
    });
  }

  /* ---------- 庫存異動紀錄 ---------- */
  const mf = { q: "", type: "" };
  function viewMoves(variantId) {
    variantId = variantId || "";
    const one = variantId ? DB.inventory.list().find(r => r.variantId === variantId) : null;
    const poId = {}; DB.purchases.list().forEach(po => { poId[po.number] = po.id; });
    shell("stock", `
      <div class="page-head">
        <div class="crumbs"><a href="#admin/stock">庫存</a><span>/</span><span>異動紀錄${one ? `：${esc(one.name)}${one.optionText ? "・" + esc(one.optionText) : ""}` : ""}</span></div>
        ${one ? `<div class="actions"><span class="muted">目前庫存 <b class="num">${one.stock}</b></span><button class="btn" id="mv-adjust">調整</button><a class="btn btn-ghost" href="#admin/moves">看全部</a></div>` : ""}
      </div>
      <section class="panel">
        <div class="panel-head"><div class="toolbar">
          ${one ? "" : `<input type="search" id="mf-q" placeholder="搜尋商品、貨號、單號" value="${esc(mf.q)}" aria-label="搜尋異動">`}
          <select id="mf-type" aria-label="類型"><option value="">全部類型</option>${Object.entries(DB.inventory.MOVE_TYPES).map(([k, v]) => `<option value="${k}" ${mf.type === k ? "selected" : ""}>${v}</option>`).join("")}</select>
        </div><span class="small muted">最新的在最上面</span></div>
        <div id="mf-list"></div>
      </section>`);
    const draw = () => {
      const list = DB.inventory.movements({ q: one ? "" : mf.q, type: mf.type, variantId });
      document.getElementById("mf-list").innerHTML = list.length ? `<div class="table-wrap"><table class="tbl">
        <thead><tr><th>時間</th>${one ? "" : "<th>商品／規格</th><th>貨號</th>"}<th>類型</th><th class="r">異動</th><th class="r">結存</th><th>單據</th><th>備註</th></tr></thead>
        <tbody>${list.map(m => {
          const ref = !m.ref ? `<span class="muted">—</span>`
            : m.ref.startsWith("PO") && poId[m.ref] ? `<a class="mono" href="#admin/purchase/${poId[m.ref]}">${esc(m.ref)}</a>`
            : m.ref.startsWith("SO") && DB.orders.get(m.ref) ? `<a class="mono" href="#admin/order/${DB.orders.get(m.ref).id}">${esc(m.ref)}</a>`
            : `<span class="mono">${esc(m.ref)}</span>`;
          return `<tr>
            <td class="num small">${date(m.at, true)}</td>
            ${one ? "" : `<td>${esc(m.name)}<div class="small muted">${esc(m.optionText || "單一規格")}</div></td><td class="mono small">${esc(m.sku)}</td>`}
            <td><span class="pill ${MOVE_PILL[m.type]}">${DB.inventory.MOVE_TYPES[m.type]}</span></td>
            <td class="r num"><b style="color:${m.delta > 0 ? "var(--ok)" : "var(--bad)"}">${signed(m.delta)}</b></td>
            <td class="r num">${m.after}</td>
            <td>${ref}</td>
            <td class="small" style="white-space:normal;min-width:160px">${esc(m.note) || `<span class="muted">—</span>`}</td>
          </tr>`;
        }).join("")}</tbody></table></div>` : `<div class="empty">沒有異動紀錄</div>`;
    };
    draw();
    const q = document.getElementById("mf-q");
    if (q) q.addEventListener("input", e => { mf.q = e.target.value; draw(); });
    document.getElementById("mf-type").addEventListener("change", e => { mf.type = e.target.value; draw(); });
    const aj = document.getElementById("mv-adjust");
    if (aj) aj.addEventListener("click", () => adjustPrompt(variantId, () => viewMoves(variantId)));
  }

  /* ---------- 進貨單列表 ---------- */
  let pq = "";
  function viewPurchases(status) {
    status = status || "";
    const c = DB.purchases.countByStatus();
    const tab = (s, label) => `<a href="#admin/purchases${s ? "/" + s : ""}" class="${status === s ? "is-on" : ""}">${label}<span class="n">${s ? c[s] : c.all}</span></a>`;
    shell("purchases", `
      <div class="page-head"><h1>進貨單</h1><div class="actions"><a class="btn btn-primary" href="#admin/purchase/new">建立進貨單</a></div></div>
      <section class="panel">
        <nav class="tabs" aria-label="進貨單狀態">${tab("", "全部")}${tab("draft", "草稿")}${tab("ordered", "已下單")}${tab("partial", "部分入庫")}${tab("received", "已入庫")}${tab("cancelled", "已取消")}</nav>
        <div class="panel-head"><div class="toolbar"><input type="search" id="pq" placeholder="搜尋單號、供應商、商品" value="${esc(pq)}" aria-label="搜尋進貨單"></div></div>
        <div id="po-list"></div>
      </section>`);
    const draw = () => {
      const list = DB.purchases.list({ status, q: pq });
      document.getElementById("po-list").innerHTML = list.length ? `<div class="table-wrap"><table class="tbl">
        <thead><tr><th>單號</th><th>供應商</th><th>建立日期</th><th>預計到貨</th><th>品項</th><th class="r">數量（已收／訂購）</th><th class="r">金額</th><th>狀態</th></tr></thead>
        <tbody>${list.map(po => {
          const qty = po.items.reduce((s, it) => s + it.qty, 0), got = po.items.reduce((s, it) => s + it.received, 0);
          return `<tr class="is-link" data-href="admin/purchase/${po.id}">
            <td class="mono">${esc(po.number)}</td><td>${esc(po.supplierName)}</td><td class="num">${date(po.createdAt)}</td>
            <td class="num">${po.expectedAt ? po.expectedAt.replace(/-/g, "/") : `<span class="muted">—</span>`}</td>
            <td style="white-space:normal;min-width:160px" class="small">${esc(po.items.map(it => it.name + (it.optionText ? "／" + it.optionText : "")).join("、"))}</td>
            <td class="r num">${got} / ${qty}</td><td class="r num">${money(po.total)}</td><td>${poPill(po.status)}</td>
          </tr>`;
        }).join("")}</tbody></table></div>` : `<div class="empty">沒有符合的進貨單</div>`;
    };
    draw();
    document.getElementById("pq").addEventListener("input", e => { pq = e.target.value; draw(); });
  }

  /* ---------- 進貨單：建立／編輯草稿／入庫 ---------- */
  function viewPurchase(id) {
    const isNew = id === "new";
    const po = isNew ? null : DB.purchases.get(id);
    if (!isNew && !po) return notFound("找不到這張進貨單", "admin/purchases");
    if (isNew || po.status === "draft") return purchaseForm(po);
    return purchaseView(po);
  }

  let poPreset = ""; // 從供應商頁按「向他進貨」帶過來
  function purchaseForm(po) {
    const sups = DB.suppliers.list();
    const rows = DB.inventory.list();
    const byVar = {}; rows.forEach(r => { byVar[r.variantId] = r; });
    const draft = po ? { ...po, items: po.items.map(it => ({ variantId: it.variantId, qty: it.qty, cost: it.cost })) }
      : { supplierId: (sups.find(x => x.id === poPreset) || sups[0] || {}).id || "", expectedAt: "", note: "", items: [] };
    poPreset = "";
    const low = DB.settings.get().lowStockAlert;
    shell("purchases", `
      <div class="page-head">
        <div class="crumbs"><a href="#admin/purchases">進貨單</a><span>/</span><span>${po ? `<span class="mono">${esc(po.number)}</span>（草稿）` : "建立進貨單"}</span></div>
        <div class="actions">
          ${po ? `<button class="btn" id="pf-del">刪除草稿</button>` : ""}
          <button class="btn" id="pf-save">儲存草稿</button>
          <button class="btn btn-primary" id="pf-place">儲存並下單</button>
        </div>
      </div>
      ${sups.length ? "" : `<div class="notice">還沒有供應商，請先<a href="#admin/supplier/new">新增供應商</a>。</div>`}
      <div class="grid-2">
        <section class="panel">
          <div class="panel-head"><h2>進貨品項</h2><div class="actions"><button class="btn btn-sm" type="button" id="pf-low">帶入庫存偏低的規格</button><button class="btn btn-sm" type="button" id="pf-add">新增品項</button></div></div>
          <div id="pf-lines"></div>
        </section>
        <section class="panel">
          <div class="panel-head"><h2>進貨資訊</h2></div>
          <div class="panel-body">
            <div class="field"><label for="pf-sup">供應商</label><select id="pf-sup">${sups.map(s => `<option value="${s.id}" ${draft.supplierId === s.id ? "selected" : ""}>${esc(s.name)}</option>`).join("")}</select><a class="small" href="#admin/supplier/new">新增供應商</a></div>
            <div class="field"><label for="pf-exp">預計到貨日</label><input type="date" id="pf-exp" value="${esc(draft.expectedAt)}"></div>
            <div class="field"><label for="pf-note">備註</label><textarea id="pf-note" rows="3" placeholder="例如 付款條件、交期">${esc(draft.note)}</textarea></div>
          </div>
        </section>
      </div>`);
    const linesEl = document.getElementById("pf-lines");
    const option = (r, sel) => `<option value="${r.variantId}" ${sel === r.variantId ? "selected" : ""}>${esc(r.name)}${r.optionText ? "／" + esc(r.optionText) : ""}（${esc(r.sku)}，庫存 ${r.stock}）</option>`;
    function drawLines() {
      const total = draft.items.reduce((s, it) => s + (+it.qty || 0) * (+it.cost || 0), 0);
      linesEl.innerHTML = draft.items.length ? `<div class="table-wrap"><table class="tbl variant-tbl po-tbl">
        <thead><tr><th>商品／規格</th><th>數量</th><th>進價</th><th class="r">小計</th><th></th></tr></thead>
        <tbody>${draft.items.map((it, i) => `<tr>
          <td><select data-i="${i}" data-k="variantId" id="pf-v-${i}" aria-label="商品規格">${rows.map(r => option(r, it.variantId)).join("")}</select></td>
          <td><input type="number" data-i="${i}" data-k="qty" id="pf-q-${i}" value="${it.qty}" min="1" step="1" aria-label="數量"></td>
          <td><input type="number" data-i="${i}" data-k="cost" id="pf-c-${i}" value="${it.cost}" min="0" step="1" aria-label="進價"></td>
          <td class="r num" id="pf-sub-${i}">${money((+it.qty || 0) * (+it.cost || 0))}</td>
          <td class="r"><button class="btn btn-sm btn-ghost" type="button" data-del="${i}">移除</button></td>
        </tr>`).join("")}
        <tr><td colspan="3" class="r"><b>合計</b></td><td class="r num"><b id="pf-total">${money(total)}</b></td><td></td></tr>
        </tbody></table></div>` : `<div class="empty">還沒有品項，按「新增品項」或「帶入庫存偏低的規格」</div>`;
    }
    drawLines();
    const addLine = r => draft.items.push({ variantId: r.variantId, qty: 10, cost: r.cost || 0 });
    document.getElementById("pf-add").addEventListener("click", () => {
      const used = new Set(draft.items.map(it => it.variantId));
      const r = rows.find(x => !used.has(x.variantId));
      if (!r) return toast("所有規格都已經在單子上了", "error");
      addLine(r); drawLines();
    });
    document.getElementById("pf-low").addEventListener("click", () => {
      const used = new Set(draft.items.map(it => it.variantId));
      // 上架中、庫存＋在途仍然偏低的規格；建議補到「提醒數量的 3 倍」
      const picks = rows.filter(r => r.status === "active" && r.stock + r.incoming <= low && !used.has(r.variantId));
      if (!picks.length) return toast("沒有需要補貨的規格（已經算進在途數量）");
      picks.forEach(r => draft.items.push({ variantId: r.variantId, qty: Math.max(1, (low + 1) * 3 - r.stock - r.incoming), cost: r.cost || 0 }));
      drawLines(); toast(`已帶入 ${picks.length} 個規格`);
    });
    linesEl.addEventListener("input", e => {
      const el = e.target.closest("[data-k]"); if (!el) return;
      const it = draft.items[+el.dataset.i];
      if (el.dataset.k === "variantId") { it.variantId = el.value; it.cost = (byVar[el.value] || {}).cost || 0; return drawLines(); }
      it[el.dataset.k] = +el.value;
      document.getElementById(`pf-sub-${el.dataset.i}`).textContent = money((+it.qty || 0) * (+it.cost || 0));
      document.getElementById("pf-total").textContent = money(draft.items.reduce((s, x) => s + (+x.qty || 0) * (+x.cost || 0), 0));
    });
    linesEl.addEventListener("change", e => {
      const el = e.target.closest('select[data-k="variantId"]'); if (!el) return;
      const it = draft.items[+el.dataset.i];
      it.variantId = el.value; it.cost = (byVar[el.value] || {}).cost || 0; drawLines();
    });
    linesEl.addEventListener("click", e => { const b = e.target.closest("[data-del]"); if (b) { draft.items.splice(+b.dataset.del, 1); drawLines(); } });
    const collect = () => ({ id: po ? po.id : undefined, supplierId: document.getElementById("pf-sup").value, expectedAt: document.getElementById("pf-exp").value, note: document.getElementById("pf-note").value, items: draft.items });
    document.getElementById("pf-save").addEventListener("click", async () => {
      try { const s = await DB.purchases.save(collect()); toast("已儲存草稿"); Router.go("admin/purchase/" + s.id); }
      catch (err) { toast(err.message, "error"); }
    });
    document.getElementById("pf-place").addEventListener("click", async () => {
      try {
        const s = await DB.purchases.save(collect());
        if (!await confirmBox({ title: `送出 ${s.number}？`, body: `向「${s.supplierName}」下單 ${s.items.reduce((a, it) => a + it.qty, 0)} 件，金額 ${money(s.total)}。下單後品項不能再改，貨到了再到這張單按「入庫」。`, ok: "確認下單" })) return Router.go("admin/purchase/" + s.id);
        await DB.purchases.place(s.id); toast("已下單"); Router.go("admin/purchase/" + s.id);
      } catch (err) { toast(err.message, "error"); }
    });
    const del = document.getElementById("pf-del");
    if (del) del.addEventListener("click", async () => {
      if (await confirmBox({ title: `刪除草稿 ${po.number}？`, ok: "刪除", danger: true })) { try { await DB.purchases.remove(po.id); toast("已刪除"); Router.go("admin/purchases"); } catch (err) { toast(err.message, "error"); } }
    });
  }

  function purchaseView(po) {
    const open = po.status === "ordered" || po.status === "partial";
    const left = it => it.qty - it.received;
    shell("purchases", `
      <div class="page-head">
        <div class="crumbs"><a href="#admin/purchases">進貨單</a><span>/</span><span class="mono">${esc(po.number)}</span></div>
        <div class="actions">${open ? `<button class="btn" id="pv-cancel">${po.status === "partial" ? "剩下的不收了" : "取消進貨單"}</button>` : ""}</div>
      </div>
      <div class="grid-2">
        <section class="panel">
          <div class="panel-head"><h2>進貨品項</h2>${poPill(po.status)}</div>
          <div class="table-wrap"><table class="tbl po-tbl">
            <thead><tr><th>商品／規格</th><th>貨號</th><th class="r">進價</th><th class="r">訂購</th><th class="r">已收</th>${open ? "<th>這次收到</th>" : ""}<th class="r">小計</th></tr></thead>
            <tbody>${po.items.map(it => `<tr>
              <td>${esc(it.name)}<div class="small muted">${esc(it.optionText || "單一規格")}</div></td>
              <td class="mono small">${esc(it.sku)}</td>
              <td class="r num">${money(it.cost)}</td><td class="r num">${it.qty}</td>
              <td class="r num">${it.received >= it.qty ? `<span class="pill ok">${it.received}</span>` : it.received}</td>
              ${open ? `<td>${left(it) > 0 ? `<input type="number" class="rc-in" data-v="${it.variantId}" id="rc-${it.variantId}" min="0" max="${left(it)}" step="1" value="${left(it)}" aria-label="這次收到數量" style="max-width:96px">` : `<span class="muted small">已收齊</span>`}</td>` : ""}
              <td class="r num">${money(it.qty * it.cost)}</td>
            </tr>`).join("")}
            <tr><td colspan="${open ? 6 : 5}" class="r"><b>合計</b></td><td class="r num"><b>${money(po.total)}</b></td></tr>
            </tbody></table></div>
          ${open ? `<div class="panel-body" style="border-top:1px solid var(--line)">
            <div class="toolbar"><input type="text" id="rc-note" placeholder="入庫備註（選填），例如 缺 2 件下週補" style="max-width:340px"><button class="btn btn-primary" id="rc-go">入庫</button></div>
            <p class="small muted" style="margin:0">入庫後會加到可售庫存、留下異動紀錄，並用這次的進價更新平均成本。沒收到的品項數量填 0。</p>
          </div>` : ""}
        </section>
        <div style="display:grid;gap:16px">
          <section class="panel">
            <div class="panel-head"><h2>進貨資訊</h2></div>
            <div class="panel-body"><dl class="kv">
              <dt>供應商</dt><dd>${DB.suppliers.get(po.supplierId) ? `<a href="#admin/supplier/${po.supplierId}">${esc(po.supplierName)}</a>` : esc(po.supplierName)}</dd>
              <dt>建立</dt><dd class="num">${date(po.createdAt, true)}</dd>
              <dt>預計到貨</dt><dd class="num">${po.expectedAt ? po.expectedAt.replace(/-/g, "/") : "—"}</dd>
              ${po.note ? `<dt>備註</dt><dd>${esc(po.note)}</dd>` : ""}
            </dl></div>
          </section>
          <section class="panel">
            <div class="panel-head"><h2>紀錄</h2></div>
            <div class="panel-body"><ul class="timeline">
              ${po.history.slice().reverse().map(h => `<li><div><b>${DB.purchases.STATUS[h.status]}</b> <span class="muted num">${date(h.at, true)}</span>${h.note ? `<div class="muted">${esc(h.note)}</div>` : ""}</div></li>`).join("")}
            </ul></div>
          </section>
        </div>
      </div>`);
    const go = document.getElementById("rc-go");
    if (go) go.addEventListener("click", async () => {
      const qtys = {};
      root().querySelectorAll(".rc-in").forEach(el => { qtys[el.dataset.v] = Math.floor(+el.value || 0); });
      const n = Object.values(qtys).reduce((s, x) => s + x, 0);
      if (n <= 0) return toast("請填這次收到的數量", "error");
      if (!await confirmBox({ title: `入庫 ${n} 件？`, body: "庫存會立刻增加，入庫後不能撤回（數量有誤請用庫存調整）。", ok: "確認入庫" })) return;
      try { await DB.purchases.receive(po.id, qtys, document.getElementById("rc-note").value.trim()); toast(`已入庫 ${n} 件`); viewPurchase(po.id); }
      catch (err) { toast(err.message, "error"); }
    });
    const cancel = document.getElementById("pv-cancel");
    if (cancel) cancel.addEventListener("click", async () => {
      const partial = po.status === "partial";
      if (!await confirmBox({ title: partial ? "剩下的不收了？" : `取消 ${po.number}？`, body: partial ? "已經收到的保留，沒收到的數量從這張單移除，單子改為已入庫。" : "還沒入庫，取消不會影響庫存。", ok: partial ? "確認" : "取消進貨單", danger: !partial })) return;
      try { await DB.purchases.cancel(po.id); toast(partial ? "已結案" : "已取消"); viewPurchase(po.id); }
      catch (err) { toast(err.message, "error"); }
    });
  }

  /* ---------- 供應商 ---------- */
  function viewSuppliers() {
    const list = DB.suppliers.list();
    shell("suppliers", `
      <div class="page-head"><h1>供應商</h1><div class="actions"><a class="btn btn-primary" href="#admin/supplier/new">新增供應商</a></div></div>
      <section class="panel">
        ${list.length ? `<div class="table-wrap"><table class="tbl">
          <thead><tr><th>名稱</th><th>聯絡人</th><th>電話</th><th>Email</th><th class="r">進貨單</th><th>最後進貨</th></tr></thead>
          <tbody>${list.map(s => `<tr class="is-link" data-href="admin/supplier/${s.id}">
            <td>${esc(s.name)}</td><td>${esc(s.contact) || "—"}</td><td class="mono">${esc(s.phone) || "—"}</td><td>${esc(s.email) || "—"}</td>
            <td class="r num">${s.poCount}</td><td class="num">${date(s.lastAt)}</td>
          </tr>`).join("")}</tbody></table></div>` : `<div class="empty">還沒有供應商</div>`}
      </section>`);
  }

  function viewSupplierEdit(id) {
    const isNew = id === "new";
    const s = isNew ? { name: "", contact: "", phone: "", email: "", taxId: "", address: "", note: "" } : DB.suppliers.get(id);
    if (!s) return notFound("找不到這個供應商", "admin/suppliers");
    const pos = isNew ? [] : DB.purchases.list().filter(po => po.supplierId === s.id);
    const f = (k, label, extra = "") => `<div class="field"><label for="sp-${k}">${label}</label><input type="text" id="sp-${k}" value="${esc(s[k])}" ${extra}></div>`;
    shell("suppliers", `
      <div class="page-head">
        <div class="crumbs"><a href="#admin/suppliers">供應商</a><span>/</span><span>${isNew ? "新增供應商" : esc(s.name)}</span></div>
        <div class="actions">${isNew ? "" : `<a class="btn" href="#admin/purchase/new" id="sp-po">向他進貨</a><button class="btn" id="sp-del">刪除</button>`}<button class="btn btn-primary" id="sp-save">儲存</button></div>
      </div>
      <div class="grid-2">
        <section class="panel">
          <div class="panel-head"><h2>基本資料</h2></div>
          <div class="panel-body grid-form">
            ${f("name", "名稱", 'maxlength="40"')}${f("contact", "聯絡人", 'maxlength="20"')}
            ${f("phone", "電話", 'maxlength="20"')}${f("email", "Email", 'maxlength="60"')}
            ${f("taxId", "統一編號（選填）", 'maxlength="8" inputmode="numeric"')}${f("address", "地址", 'maxlength="80"')}
            <div class="field full"><label for="sp-note">備註</label><textarea id="sp-note" rows="3" placeholder="例如 交期、付款條件、最低訂量">${esc(s.note)}</textarea></div>
          </div>
        </section>
        <section class="panel">
          <div class="panel-head"><h2>進貨紀錄</h2></div>
          ${pos.length ? `<div class="table-wrap"><table class="tbl"><tbody>${pos.map(po => `<tr class="is-link" data-href="admin/purchase/${po.id}">
            <td class="mono">${esc(po.number)}</td><td class="num">${date(po.createdAt)}</td><td class="r num">${money(po.total)}</td><td>${poPill(po.status)}</td>
          </tr>`).join("")}</tbody></table></div>` : `<div class="empty">還沒有進貨紀錄</div>`}
        </section>
      </div>`);
    const val = k => document.getElementById("sp-" + k).value;
    const poBtn = document.getElementById("sp-po");
    if (poBtn) poBtn.addEventListener("click", () => { poPreset = s.id; });
    document.getElementById("sp-save").addEventListener("click", async () => {
      try {
        const saved = await DB.suppliers.save({ id: s.id, name: val("name"), contact: val("contact"), phone: val("phone"), email: val("email"), taxId: val("taxId"), address: val("address"), note: val("note") });
        toast("已儲存供應商"); Router.go("admin/supplier/" + saved.id);
      } catch (err) { toast(err.message, "error"); }
    });
    const del = document.getElementById("sp-del");
    if (del) del.addEventListener("click", async () => {
      if (!await confirmBox({ title: `刪除「${s.name}」？`, body: "過去的進貨單會保留供應商名稱。", ok: "刪除", danger: true })) return;
      try { await DB.suppliers.remove(s.id); toast("已刪除"); Router.go("admin/suppliers"); } catch (err) { toast(err.message, "error"); }
    });
  }

  function notFound(msg, back) {
    shell("", `<div class="panel"><div class="empty">${esc(msg)}<div style="margin-top:12px"><a class="btn" href="#${back}">返回</a></div></div></div>`);
  }

  /* 表格整列點擊 */
  document.addEventListener("click", e => {
    if (e.target.closest("a, button, input, select, textarea, label")) return;
    const tr = e.target.closest("tr[data-href]");
    if (tr) Router.go(tr.dataset.href);
  });

  /* ---------- 後台登入（資料庫版） ---------- */
  window.AdminGate = function (st) {
    const wrap = inner => { root().innerHTML = `<div class="gate"><div class="gate-card">${inner}</div></div>`; };
    if (st.state === "nostore") {
      const sql = `select setup_add_owner('${st.slug}', '${String(st.email).replace(/'/g, "''")}');`;
      wrap(`
        <h1>還差一步：設定店主</h1>
        <p>你已經用 <b>${esc(st.email)}</b> 登入，但這個帳號還不是這家商店的管理者。</p>
        <ol class="gate-steps">
          <li>打開 Supabase 後台，左邊選 <b>SQL Editor</b>，按 <b>New query</b></li>
          <li>貼上下面這一行，按 <b>Run</b>：<pre class="gate-sql mono" id="gate-sql">${esc(sql)}</pre><button class="btn btn-sm" id="gate-copy" type="button">複製</button></li>
          <li>看到「完成」後，回到這裡按「重新檢查」</li>
        </ol>
        <div class="actions"><button class="btn btn-primary" id="gate-retry">重新檢查</button><button class="btn btn-ghost" id="gate-out">登出，換一個帳號</button></div>`);
      document.getElementById("gate-copy").addEventListener("click", async () => {
        try { await navigator.clipboard.writeText(sql); toast("已複製"); }
        catch (e) { const r = document.createRange(); r.selectNodeContents(document.getElementById("gate-sql")); getSelection().removeAllRanges(); getSelection().addRange(r); toast("請按 ⌘C／Ctrl+C 複製"); }
      });
      document.getElementById("gate-retry").addEventListener("click", () => Router.render());
      document.getElementById("gate-out").addEventListener("click", async () => { await DB.admin.logout(); Router.render(); });
      return;
    }
    // 登入／建立帳號
    let mode = "login";
    const draw = msg => {
      wrap(`
        <h1>商家後台</h1>
        <p class="muted">${mode === "login" ? "用你的 Email 登入" : "第一次使用：建立管理者帳號"}</p>
        ${msg ? `<div class="notice">${msg}</div>` : ""}
        <form id="gate-form" class="gate-form" novalidate>
          <div class="field"><label for="gate-email">Email</label><input type="email" id="gate-email" autocomplete="username" required></div>
          <div class="field"><label for="gate-pw">密碼</label><input type="password" id="gate-pw" autocomplete="${mode === "login" ? "current-password" : "new-password"}" required>${mode === "login" ? "" : `<span class="hint">至少 8 個字元</span>`}</div>
          <button class="btn btn-primary" type="submit" style="padding:10px">${mode === "login" ? "登入" : "建立帳號"}</button>
        </form>
        <button class="btn btn-ghost" id="gate-switch" type="button">${mode === "login" ? "第一次使用？建立帳號" : "已經有帳號？登入"}</button>`);
      document.getElementById("gate-email").focus();
      document.getElementById("gate-switch").addEventListener("click", () => { mode = mode === "login" ? "signup" : "login"; draw(); });
      document.getElementById("gate-form").addEventListener("submit", async e => {
        e.preventDefault();
        const email = document.getElementById("gate-email").value.trim(), pw = document.getElementById("gate-pw").value;
        const btn = e.target.querySelector("button[type=submit]");
        if (!email || !pw) return toast("請填寫 Email 和密碼", "error");
        if (mode === "signup" && pw.length < 8) return toast("密碼至少 8 個字元", "error");
        btn.disabled = true;
        try {
          if (mode === "login") { await DB.admin.login(email, pw); Router.render(); }
          else {
            const r = await DB.admin.signup(email, pw);
            if (r.needConfirm) { mode = "login"; draw(`已寄出確認信到 <b>${esc(email)}</b>。請到信箱點信裡的連結，完成後回來這裡登入。`); }
            else Router.render();
          }
        } catch (err) { toast(err.message, "error"); btn.disabled = false; }
      });
    };
    draw();
  };

  function phaseTwo(active, title) {
    shell(active, `<div class="page-head"><h1>${esc(title)}</h1></div>
      <div class="panel"><div class="empty">這個功能會在第二階段搬到資料庫後開放。<div style="margin-top:12px"><a class="btn" href="#admin">回總覽</a></div></div></div>`);
  }

  window.AdminApp = function (parts) {
    const [, page, arg] = parts;
    if (!DB.features.inventory && ["stock", "moves", "purchases", "purchase", "suppliers", "supplier"].includes(page)) return phaseTwo("", "進銷存");
    if (!DB.features.tiers && page === "tiers") return phaseTwo("", "會員等級");
    switch (page) {
      case undefined: return viewDashboard();
      case "products": return viewProducts();
      case "product": return viewProductEdit(arg);
      case "categories": return viewCategories();
      case "orders": return viewOrders(arg);
      case "order": return viewOrder(arg);
      case "customers": return viewCustomers();
      case "customer": return viewCustomer(arg);
      case "settings": return viewSettings();
      case "coupons": return viewCoupons();
      case "coupon": return viewCouponEdit(arg);
      case "promotions": return viewPromotions();
      case "promotion": return viewPromotionEdit(arg);
      case "tiers": return viewTiers();
      case "stock": return viewStock();
      case "moves": return viewMoves(arg);
      case "purchases": return viewPurchases(arg);
      case "purchase": return viewPurchase(arg);
      case "suppliers": return viewSuppliers();
      case "supplier": return viewSupplierEdit(arg);
      default: return notFound("找不到這個頁面", "admin");
    }
  };
})();
