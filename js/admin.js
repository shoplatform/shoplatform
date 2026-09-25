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
            <div class="sep">商店</div>
            ${link("admin/settings", "settings", "設定")}
          </nav>
          <div class="side-foot">骨架版 v0.3 · 金流未串接</div>
        </aside>
        <main class="main" id="main">${content}</main>
      </div>`;
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
            <div class="panel-body">
              <div class="img-grid" id="pe-imgs"></div>
              <label class="img-drop" id="pe-drop">
                <input type="file" id="pe-file" accept="image/jpeg,image/png,image/webp,image/gif" multiple>
                <b>點這裡選擇圖片</b>
                <span>或把圖片拖曳進來 · JPG、PNG、WebP · 最多 ${DB.media.MAX_PER_PRODUCT} 張</span>
              </label>
              <p class="small muted" style="margin:0">第一張是主圖（列表和購物車會顯示）。圖片會自動縮小壓縮，按「儲存」後才會生效。</p>
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
      // 估算：已儲存的資料 + 這次新加、還沒儲存的圖片
      const u = DB.media.usage();
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
        return hit || { id: DB.products.newVariantId(), sku: "", options: c, price: old[0] ? old[0].price : 0, stock: 0 };
      });
      drawVars();
    }
    function drawVars() {
      const hasOpts = draft.variants.some(v => Object.keys(v.options).length);
      varsEl.innerHTML = `<div class="table-wrap"><table class="tbl variant-tbl">
        <thead><tr><th>${hasOpts ? "規格" : "單一規格"}</th><th>貨號</th><th>價格</th><th>庫存</th></tr></thead>
        <tbody>${draft.variants.map((v, i) => `<tr>
          <td>${esc(Object.values(v.options).join(" / ") || "預設")}</td>
          <td><input type="text" class="v-in" data-i="${i}" data-k="sku" id="pe-v-sku-${i}" value="${esc(v.sku)}" aria-label="貨號"></td>
          <td><input type="number" class="v-in" data-i="${i}" data-k="price" id="pe-v-price-${i}" value="${v.price}" min="0" step="1" aria-label="價格"></td>
          <td><input type="number" class="v-in" data-i="${i}" data-k="stock" id="pe-v-stock-${i}" value="${v.stock}" min="0" step="1" aria-label="庫存"></td>
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

    document.getElementById("pe-save").addEventListener("click", () => {
      if (busy) return toast("圖片還在處理中，請稍等", "error");
      draft.name = document.getElementById("pe-name").value;
      draft.description = document.getElementById("pe-desc").value;
      draft.status = document.getElementById("pe-st-active").checked ? "active" : "draft";
      draft.categoryIds = [...document.querySelectorAll(".pe-cat:checked")].map(x => x.value);
      draft.options = draft.options.filter(o => o.name && o.values.length);
      draft.variants.forEach((v, i) => { if (!v.sku) v.sku = "SKU-" + Date.now().toString(36).toUpperCase().slice(-5) + "-" + (i + 1); });
      try {
        const saved = DB.products.save(draft);
        toast("已儲存");
        Router.go("admin/product/" + saved.id);
      } catch (err) { toast(err.message, "error"); }
    });
    const del = document.getElementById("pe-del");
    if (del) del.addEventListener("click", async () => {
      if (await confirmBox({ title: `刪除「${p.name}」？`, body: "刪除後無法復原，過去訂單的紀錄不受影響。", ok: "刪除", danger: true })) {
        DB.products.remove(p.id); toast("已刪除"); Router.go("admin/products");
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
    document.getElementById("cat-form").addEventListener("submit", e => {
      e.preventDefault();
      try { DB.categories.add(document.getElementById("cat-name").value); toast("已新增分類"); viewCategories(); }
      catch (err) { toast(err.message, "error"); }
    });
    root().querySelectorAll(".cat-rename").forEach(el => el.addEventListener("change", () => { DB.categories.rename(el.dataset.id, el.value); toast("已更新名稱"); }));
    root().querySelectorAll(".cat-del").forEach(el => el.addEventListener("click", async () => {
      if (await confirmBox({ title: `刪除分類「${el.dataset.name}」？`, body: "商品不會被刪除，只會移出這個分類。", ok: "刪除", danger: true })) {
        DB.categories.remove(el.dataset.id); toast("已刪除分類"); viewCategories();
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
        { header: "折扣", width: 8, type: "number" }, { header: "訂單總額", width: 11, type: "number" },
        { header: "備註", width: 30 },
      ],
      rows: chronological.map(o => [
        o.number, o.createdAt, DB.orders.STATUS[o.status], pay(o), o.payment.methodName,
        o.contact.name, o.contact.phone, o.contact.email, o.shipping.methodName, o.shipping.storeName,
        o.shipping.address, o.shipping.trackingNo, o.items.reduce((s, it) => s + it.qty, 0),
        o.subtotal, o.shippingFee, o.discount || 0, o.total, o.note,
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
      DB.orders.setStatus(o.id, s); toast("訂單已更新為「" + DB.orders.STATUS[s] + "」"); viewOrder(o.id);
    }));
    document.getElementById("od-note-save").addEventListener("click", () => {
      DB.orders.setNote(o.id, document.getElementById("od-note").value); toast("已儲存備註");
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
    wrap.querySelector("#ship-form").addEventListener("submit", e => {
      e.preventDefault();
      DB.orders.setStatus(o.id, "shipped", { trackingNo: wrap.querySelector("#ship-no").value.trim() });
      wrap.remove(); toast("已標記出貨"); viewOrder(o.id);
    });
  }

  /* ---------- 會員 ---------- */
  let cq = "";
  function viewCustomers() {
    shell("customers", `
      <div class="page-head"><h1>會員</h1></div>
      <section class="panel">
        <div class="panel-head"><div class="toolbar"><input type="search" id="cq" placeholder="搜尋姓名、手機、Email" value="${esc(cq)}" aria-label="搜尋會員"></div></div>
        <div id="c-list"></div>
      </section>`);
    const draw = () => {
      const list = DB.customers.list(cq);
      document.getElementById("c-list").innerHTML = list.length ? `<div class="table-wrap"><table class="tbl">
        <thead><tr><th>姓名</th><th>帳號</th><th>手機</th><th>Email</th><th class="r">訂單數</th><th class="r">累積消費</th><th>最後購買</th></tr></thead>
        <tbody>${list.map(c => `<tr class="is-link" data-href="admin/customer/${c.id}">
          <td>${esc(c.name)}</td><td>${accountPill(c)}</td><td class="mono">${esc(c.phone)}</td><td>${esc(c.email) || "—"}</td>
          <td class="r num">${c.orderCount}</td><td class="r num">${money(c.totalSpent)}</td><td class="num">${date(c.lastOrderAt)}</td>
        </tr>`).join("")}</tbody></table></div>` : `<div class="empty">沒有符合的會員</div>`;
    };
    draw();
    document.getElementById("cq").addEventListener("input", e => { cq = e.target.value; draw(); });
  }

  function viewCustomer(id) {
    const c = DB.customers.get(id);
    if (!c) return notFound("找不到這位會員", "admin/customers");
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
        <section class="panel"><div class="panel-head"><h2>聯絡資料</h2></div>
          <div class="panel-body"><dl class="kv">
            <dt>帳號</dt><dd>${accountPill(c)}${c.hasAccount ? ` <span class="small muted">${date(c.registeredAt)} 開通</span>` : ""}</dd>
            <dt>手機</dt><dd class="mono">${esc(c.phone)}</dd><dt>Email</dt><dd>${esc(c.email) || "—"}</dd></dl>
          ${c.hasAccount ? "" : `<p class="small muted" style="margin:0">這位顧客是結帳時自動建立的。他用同一支手機在前台註冊後，就能登入看到這些訂單。</p>`}
          <div class="notice">會員分級、標籤、購物金排在第二階段（P1）。</div></div>
        </section>
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
      <section class="panel">
        <div class="panel-head"><h2>開發工具</h2></div>
        <div class="panel-body">
          <p class="muted" style="margin:0">目前資料只存在這個瀏覽器裡（儲存空間約已使用 ${Math.round(DB.media.usage().ratio * 100)}%）。重置會把商品、訂單、會員、商品圖片都換回範例資料。</p>
          <div class="actions"><button class="btn" id="st-reset">重置範例資料</button></div>
        </div>
      </section>`);

    document.getElementById("st-save").addEventListener("click", () => {
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
      DB.settings.update(cur); toast("已儲存設定"); viewSettings();
    });
    document.getElementById("st-reset").addEventListener("click", async () => {
      if (await confirmBox({ title: "重置範例資料？", body: "你新增或修改的商品、訂單、會員、圖片都會被清掉。", ok: "重置", danger: true })) {
        DB.reset(); toast("已重置範例資料"); Router.go("admin");
      }
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

  window.AdminApp = function (parts) {
    const [, page, arg] = parts;
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
      default: return notFound("找不到這個頁面", "admin");
    }
  };
})();
