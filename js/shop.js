/* =========================================================
 * shop.js — 商店前台（消費者看到的網站）
 * 路由：#shop、#shop/c/<分類id>、#shop/p/<商品id>、
 *       #shop/cart、#shop/checkout、#shop/done/<訂單編號>、
 *       #shop/login、#shop/register、#shop/account、
 *       #shop/track（訂單查詢）、#shop/order/<訂單編號>
 * ========================================================= */
(function () {
  const { esc, money, date, toast, Router } = window.UI;
  const root = () => document.getElementById("app");
  let query = "";

  function priceText(p) {
    const [lo, hi] = DB.products.priceRange(p);
    return lo === hi ? money(lo) : money(lo) + " 起";
  }
  /* 有圖片就顯示主圖，沒有就用色塊 + 商品名第一個字 */
  const img = (p, cls = "", src) => {
    src = src !== undefined ? src : DB.products.cover(p);
    return src
      ? `<div class="s-img has-photo ${cls}"><img src="${esc(src)}" alt="${esc(p.name)}" loading="lazy"></div>`
      : `<div class="s-img ${cls}" style="background:${esc(p.color)}" aria-hidden="true">${esc(p.name.slice(0, 1))}</div>`;
  };

  /* 最上方的公告列：進行中的滿額活動＋免運門檻 */
  function barText(st) {
    const th = window.Theme ? window.Theme.normalize(st.theme) : {};
    const parts = th.notice ? [esc(th.notice)] : [];
    parts.push(...DB.promotions.active().map(p => `${esc(p.name)}：${esc(DB.promotions.describe(p))}`));
    if (st.freeShippingThreshold > 0) parts.push(`全館滿 ${money(st.freeShippingThreshold)} 免運`);
    return parts.join('<span class="s-bar-sep" aria-hidden="true">｜</span>');
  }

  /* 金額明細（購物車、結帳共用） */
  function sumLines(q, withShipping) {
    return `
      <div><span>商品小計</span><span>${money(q.subtotal)}</span></div>
      ${q.discounts.map(d => `<div class="s-disc"><span>${esc(d.label)}</span><span>${d.amount ? "−" + money(d.amount) : "免運"}</span></div>`).join("")}
      ${withShipping ? `<div><span>運費</span><span>${q.shippingFee ? money(q.shippingFee) : "免運"}</span></div>
      <div class="total"><span>總計</span><span>${money(q.total)}</span></div>`
      : `<div><span>運費</span><span>${q.freeGap === 0 ? "免運" : "結帳時計算"}</span></div>
      <div class="total"><span>目前金額</span><span>${money(q.goods)}</span></div>`}`;
  }
  /* 還差多少可以多折／免運 */
  function nudges(q) {
    const out = [];
    if (q.nextTier) out.push(`再買 ${money(q.nextTier.gap)}，${esc(q.nextTier.name)}可以折 ${money(q.nextTier.off)}`);
    if (q.freeGap > 0) out.push(`再買 ${money(q.freeGap)} 就免運`);
    // 沒登入、而且有會員等級優惠時，提醒登入
    const cfg = DB.tiers.get();
    if (DB.features.members && !DB.auth.current() && cfg.enabled && cfg.tiers.some(t => t.percent < 100 || t.freeShip)) {
      out.push(`會員<a href="#shop/login" data-back="${esc(Router.current)}">登入</a>後，可以享有會員等級優惠`);
    }
    return out.map(t => `<div class="s-gap">${t}</div>`).join("");
  }
  /* 優惠碼輸入框；套用或移除後呼叫 redraw */
  function couponBox(q, redraw, getPhone) {
    const code = DB.cart.coupon();
    const html = code ? `
      <div class="s-coupon ${q.couponError ? "is-bad" : ""}">
        <div><b class="mono">${esc(code)}</b>${q.coupon ? ` <span>${esc(q.coupon.name)}</span>` : ""}
          ${q.couponError ? `<div class="s-coupon-err" role="alert">${esc(q.couponError)}</div>` : ""}</div>
        <button type="button" class="btn btn-sm" id="cp-remove">移除</button>
      </div>` : `
      <div class="s-coupon-in">
        <label class="sr-only" for="cp-code">優惠碼</label>
        <input type="text" id="cp-code" placeholder="輸入優惠碼" autocomplete="off" autocapitalize="characters">
        <button type="button" class="btn" id="cp-apply">套用</button>
      </div>`;
    const bind = () => {
      const rm = document.getElementById("cp-remove");
      if (rm) rm.addEventListener("click", () => { DB.cart.removeCoupon(); toast("已移除優惠碼"); redraw(); });
      const ap = document.getElementById("cp-apply");
      if (ap) {
        const input = document.getElementById("cp-code");
        const go = () => {
          ap.disabled = true;
          Promise.resolve().then(() => DB.cart.applyCoupon(input.value, getPhone ? getPhone() : ""))
            .then(() => { toast("已套用優惠碼"); redraw(); })
            .catch(err => { toast(err.message, "error"); ap.disabled = false; input.focus(); });
        };
        ap.addEventListener("click", go);
        input.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); go(); } });
      }
    };
    return { html, bind };
  }

  function shell(content) {
    const st = DB.settings.get();
    const n = DB.cart.count();
    const user = DB.auth.current();
    root().innerHTML = `
      <div class="shop ${themeAttr(st).cls}" style="${themeAttr(st).style}">
        ${barText(st) ? `<div class="s-bar">${barText(st)}</div>` : ""}
        <header class="s-head"><div class="s-wrap">
          ${logoLink(st)}
          <input type="search" class="s-search" id="s-q" placeholder="搜尋商品" value="${esc(query)}" aria-label="搜尋商品">
          <nav class="s-nav" aria-label="會員">
            ${user ? `<a href="#shop/account">${esc(user.name)}</a>`
              : DB.auth.session && DB.auth.session() ? `<a href="#shop/join">完成會員資料</a>`
              : `<a href="#shop/track">訂單查詢</a>${DB.features.members ? `<a href="#shop/login">登入</a>` : ""}`}
          </nav>
          <a class="s-cart" href="#shop/cart">購物車 <b>${n}</b></a>
        </div></header>
        <main>${content}</main>
        <footer class="s-foot"><div class="s-wrap">
          <span>© ${new Date().getFullYear()} ${esc(st.name)}</span>
          <span>客服 ${esc(st.email)}${st.phone ? ` · ${esc(st.phone)}` : ""}</span>
          ${st.returnPolicy ? `<a href="#shop/policy">退換貨政策</a>` : ""}
          ${poweredBy()}
        </div></footer>
      </div>`;
    const q = document.getElementById("s-q");
    q.addEventListener("keydown", e => {
      if (e.key === "Enter") { query = q.value; Router.go("shop"); }
    });
  }

  function viewPolicy() {
    const st = DB.settings.get();
    shell(`<div class="s-wrap s-page s-narrow"><h1>退換貨政策</h1><section class="s-box" style="white-space:pre-wrap;line-height:1.8">${st.returnPolicy ? esc(st.returnPolicy) : "店家尚未公布退換貨政策，購買前請先聯絡客服確認。"}</section></div>`);
  }

  /* ---------- 商品評價 ---------- */
  const stars = (n, big) => `<span class="stars${big ? " is-big" : ""}" role="img" aria-label="${n} 顆星（滿分 5 顆）">${[1, 2, 3, 4, 5].map(i => `<i class="${i <= Math.round(n) ? "on" : ""}" aria-hidden="true">★</i>`).join("")}</span>`;
  const reviewsOn = () => DB.reviews && DB.reviews.settings().enabled;
  const ratingLine = p => {
    if (!reviewsOn()) return "";
    const r = DB.reviews.summary(p);
    return r.count ? `<span class="s-rating">${stars(r.avg)} <span>${r.avg.toFixed(1)}（${r.count}）</span></span>` : "";
  };
  // 寫／改評價的視窗
  function reviewForm(item, after) {
    const cur = item.review || {};
    const wrap = document.createElement("div");
    wrap.className = "modal-backdrop shop-modal";
    wrap.innerHTML = `<form class="modal s-review-form" novalidate>
      <h3>${cur.id ? "修改評價" : "寫評價"}：${esc(item.name)}</h3>
      <fieldset class="star-pick"><legend class="small">給幾顆星？</legend>
        ${[5, 4, 3, 2, 1].map(n => `<input type="radio" name="rv-star" id="rv-s${n}" value="${n}" ${cur.rating === n ? "checked" : ""}><label for="rv-s${n}" title="${n} 顆星"><span class="sr">${n} 顆星</span>★</label>`).join("")}
      </fieldset>
      <div class="field"><label for="rv-text">心得（選填）</label><textarea id="rv-text" rows="4" maxlength="500" placeholder="用起來怎麼樣？給其他人一點參考">${esc(cur.content || "")}</textarea><span class="hint">會以「${esc((DB.auth.current() || {}).name ? DB.auth.current().name.slice(0, 1) + "**" : "顧客")}」的名字公開</span></div>
      <div class="modal-actions"><button type="button" class="btn" id="rv-cancel">取消</button><button class="btn btn-primary" type="submit">送出評價</button></div>
    </form>`;
    document.body.appendChild(wrap);
    const shopEl = document.querySelector(".shop");
    if (shopEl) { wrap.className += " " + shopEl.className.replace(/\bshop\b/, ""); wrap.setAttribute("style", shopEl.getAttribute("style") || ""); }
    wrap.querySelector("#rv-cancel").addEventListener("click", () => wrap.remove());
    wrap.querySelector("form").addEventListener("submit", async e => {
      e.preventDefault();
      const star = wrap.querySelector('input[name="rv-star"]:checked');
      if (!star) return toast("請選幾顆星", "error");
      const btn = e.target.querySelector("button[type=submit]"); btn.disabled = true;
      try {
        const r = await DB.reviews.save({ orderNumber: item.orderNumber, productId: item.productId, rating: +star.value, content: wrap.querySelector("#rv-text").value });
        wrap.remove(); toast(r.status === "pending" ? "謝謝！評價會在店家確認後公開" : r.status === "hidden" ? "已更新評價" : "謝謝你的評價！"); after();
      } catch (err) { toast(err.message, "error"); btn.disabled = false; }
    });
  }
  // 商品頁下方的評價區
  async function drawReviews(p, box) {
    if (!reviewsOn() || !box) return;
    let data, mine = [];
    try { [data, mine] = await Promise.all([DB.reviews.forProduct(p.id, 0), DB.reviews.mine().catch(() => [])]); } catch (err) { return; }
    if (!document.body.contains(box)) return;
    const mineHere = mine.filter(x => x.productId === p.id);
    const todo = mineHere.find(x => !x.review) || mineHere[0];
    const items = data.items.slice();
    const card = r => `<li class="s-rv"><div class="s-rv-head">${stars(r.rating)}<b>${esc(r.name)}</b><span class="small">${esc(date(r.createdAt))}</span><span class="s-rv-badge">已購買</span></div>
      ${r.content ? `<p>${esc(r.content)}</p>` : ""}
      ${r.reply ? `<div class="s-rv-reply"><b>店家回覆</b><p>${esc(r.reply)}</p></div>` : ""}</li>`;
    const render = () => {
      box.innerHTML = `<div class="s-rv-top">
        <div><h2>商品評價</h2>${data.count ? `<div class="s-rv-avg"><b>${(+data.avg).toFixed(1)}</b>${stars(+data.avg, true)}<span>${data.count} 則評價</span></div>` : `<p class="small" style="margin:0">還沒有評價</p>`}</div>
        ${data.count ? `<ul class="s-rv-dist" aria-label="各星等數量">${[5, 4, 3, 2, 1].map(g => `<li><span>${g} 星</span><i><b style="width:${data.count ? data.dist[g] / data.count * 100 : 0}%"></b></i><span>${data.dist[g]}</span></li>`).join("")}</ul>` : ""}
        <div class="s-rv-act">${todo ? `<button class="btn btn-primary" type="button" id="rv-write">${todo.review ? "修改我的評價" : "寫評價"}</button>`
          : `<span class="small">${DB.auth.current() ? "買過並出貨後就可以評價" : `買過的會員<a href="#shop/login">登入</a>後可以評價`}</span>`}</div>
      </div>
      ${todo && todo.review && todo.review.status === "pending" ? `<div class="s-gap">你的評價正在等店家確認，確認後才會公開</div>` : ""}
      ${items.length ? `<ul class="s-rv-list">${items.map(card).join("")}</ul>` : ""}
      ${items.length < data.count ? `<div style="text-align:center"><button class="btn" type="button" id="rv-more">看更多評價</button></div>` : ""}`;
      const w = document.getElementById("rv-write");
      if (w) w.addEventListener("click", () => reviewForm(todo, () => { DB.ready("shop").then(() => viewProduct(p.id)); }));
      const m = document.getElementById("rv-more");
      if (m) m.addEventListener("click", async () => { m.disabled = true; const more = await DB.reviews.forProduct(p.id, items.length); items.push(...more.items); render(); });
    };
    render();
  }

  // 佈景主題：配色、版型、字體（theme.js）
  const themeAttr = st => { if (!window.Theme) return { cls: "", style: "" }; window.Theme.useFont(st.theme); return window.Theme.attrs(st.theme); };
  const logoLink = st => {
    const logo = st.theme && st.theme.logo;
    return logo && logo.url ? `<a class="s-logo has-img" href="#shop"><img src="${esc(logo.url)}" alt="${esc(st.name)}"></a>` : `<a class="s-logo" href="#shop">${esc(st.name)}</a>`;
  };

  // 頁尾「我也要開店」：帶回平台首頁（正式版才有）
  const poweredBy = () => DB.mode === "remote"
    ? `<a class="s-powered" href="${esc(DB.admin.storeUrl(""))}#home">${esc((DB.home.info().platformName) || "開店平台")} · 我也要開店</a>` : "";

  /* ---------- 暫停營業（試用到期、年費到期、被平台停用） ---------- */
  function viewClosed(msg) {
    const st = DB.settings.get();
    root().innerHTML = `
      <div class="shop ${themeAttr(st).cls}" style="${themeAttr(st).style}">
        <header class="s-head"><div class="s-wrap"><span class="s-logo">${esc(st.name)}</span>
          <nav class="s-nav" aria-label="訂單"><a href="#shop/track">訂單查詢</a></nav></div></header>
        <main><div class="s-wrap s-page s-narrow"><div class="s-box s-closed">
          <h1>${esc(msg || "這家商店目前休息中")}</h1>
          <p>暫時無法下單。已經下過的訂單可以用「訂單查詢」看進度${st.email ? `，其他問題請來信 <a href="mailto:${esc(st.email)}">${esc(st.email)}</a>` : ""}。</p>
          <div><a class="btn" href="#shop/track">查詢訂單</a></div>
        </div></div></main>
        <footer class="s-foot"><div class="s-wrap"><span>© ${new Date().getFullYear()} ${esc(st.name)}</span>${poweredBy()}</div></footer>
      </div>`;
  }

  /* ---------- 首頁 / 分類 ---------- */
  function viewHome(categoryId) {
    const st = DB.settings.get();
    const cats = DB.categories.list().filter(c => DB.products.list({ categoryId: c.id, live: true }).length);
    const list = DB.products.list({ q: query, categoryId: categoryId || "", live: true });
    const cur = cats.find(c => c.id === categoryId);
    const th = window.Theme ? window.Theme.normalize(st.theme) : { layout: "grid" };
    const front = !cur && !query;   // 首頁（不是分類頁、搜尋結果）才套用版型
    const banner = front && th.layout === "banner";
    const feature = front && th.layout === "magazine" && list.length > 1 ? list[0] : null;
    const gridList = feature ? list.slice(1) : list;
    shell(`
      ${banner ? `<section class="s-banner"><div class="s-wrap">
        <h1>${esc(th.heroTitle || st.name)}</h1>
        ${th.heroText || st.tagline ? `<p>${esc(th.heroText || st.tagline)}</p>` : ""}
        <button class="btn" type="button" id="s-to-all">逛逛商品</button>
      </div></section>` : ""}
      <div class="s-wrap" id="s-all">
        ${banner ? "" : `<section class="s-hero">
          <h1>${cur ? esc(cur.name) : query ? `搜尋「${esc(query)}」` : esc(front && th.heroTitle ? th.heroTitle : st.name)}</h1>
          <p>${cur || query ? `共 ${list.length} 件商品` : esc(front && th.heroText ? th.heroText : st.tagline)}</p>
        </section>`}
        <nav class="s-cats" aria-label="商品分類">
          <a href="#shop" class="${!categoryId && !query ? "is-on" : ""}" data-clear="1">全部</a>
          ${cats.map(c => `<a href="#shop/c/${c.id}" class="${categoryId === c.id ? "is-on" : ""}">${esc(c.name)}</a>`).join("")}
        </nav>
        ${feature ? `<a class="s-feature" href="#shop/p/${feature.id}">
          ${img(feature)}
          <div><span class="s-kicker">本週主打</span><h2>${esc(feature.name)}</h2>
            ${feature.description ? `<p>${esc(feature.description)}</p>` : ""}
            <span class="s-price">${priceText(feature)}</span><span class="btn btn-primary">看商品</span></div>
        </a>` : ""}
        ${gridList.length ? `<div class="s-grid">${gridList.map(p => {
          const out = DB.products.totalStock(p) === 0;
          return `<a class="s-card" href="#shop/p/${p.id}">
            <div style="position:relative">${out ? `<span class="s-soldout">售完</span>` : ""}${img(p)}</div>
            <span class="s-name">${esc(p.name)}</span>
            <span class="s-price">${priceText(p)}</span>
            ${ratingLine(p)}
          </a>`;
        }).join("")}</div>` : `<div class="empty">找不到符合的商品</div>`}
      </div>`);
    root().querySelectorAll("[data-clear]").forEach(a => a.addEventListener("click", () => { query = ""; }));
    const toAll = document.getElementById("s-to-all");
    if (toAll) toAll.addEventListener("click", () => document.getElementById("s-all").scrollIntoView({ behavior: "smooth" }));
  }

  /* ---------- 商品頁 ---------- */
  function viewProduct(id) {
    const p = DB.products.get(id);
    if (!p || !DB.products.isLive(p)) {
      return shell(`<div class="s-wrap"><div class="empty">這個商品不存在或已下架<div style="margin-top:12px"><a class="btn" href="#shop">回到商店</a></div></div></div>`);
    }
    // 預設選第一個有庫存的規格
    const first = p.variants.find(v => v.stock > 0) || p.variants[0];
    const sel = Object.assign({}, first.options);
    let qty = 1;
    const images = p.images || [];

    shell(`
      <div class="s-wrap">
        <div class="s-product">
          <div class="s-gallery">
            <div id="sp-main">${img(p)}</div>
            ${images.length > 1 ? `<div class="s-thumbs" role="group" aria-label="商品圖片">
              ${images.map((im, i) => `<button type="button" data-img="${i}" class="${i === 0 ? "is-on" : ""}" aria-label="第 ${i + 1} 張圖"><img src="${esc(im.url)}" alt=""></button>`).join("")}
            </div>` : ""}
          </div>
          <div class="s-info">
            <a href="#shop" class="small">← 繼續逛</a>
            <h1>${esc(p.name)}</h1>
            <div class="s-price" id="sp-price"></div>
            <p>${esc(p.description)}</p>
            <div id="sp-opts" style="display:grid;gap:14px"></div>
            <div class="s-opt"><span class="label">數量</span>
              <div class="s-qty"><button type="button" id="sp-minus" aria-label="減少">−</button><input type="number" id="sp-qty" value="1" min="1" aria-label="數量"><button type="button" id="sp-plus" aria-label="增加">+</button></div>
            </div>
            <div class="s-buy">
              <button class="btn btn-primary" id="sp-add">加入購物車</button>
              <button class="btn" id="sp-buy">直接購買</button>
              <span class="s-stock" id="sp-stock"></span>
            </div>
            ${ratingLine(p) ? `<a href="#sp-reviews" class="s-rating-link" id="sp-to-rv">${ratingLine(p)}</a>` : ""}
          </div>
        </div>
        <section class="s-box s-reviews" id="sp-reviews" ${reviewsOn() ? "" : "hidden"}></section>
      </div>`);
    drawReviews(p, document.getElementById("sp-reviews"));
    const toRv = document.getElementById("sp-to-rv");
    if (toRv) toRv.addEventListener("click", e => { e.preventDefault(); e.stopPropagation(); document.getElementById("sp-reviews").scrollIntoView({ behavior: "smooth" }); });

    root().querySelectorAll(".s-thumbs [data-img]").forEach(b => b.addEventListener("click", () => {
      document.getElementById("sp-main").innerHTML = img(p, "", images[+b.dataset.img].url);
      root().querySelectorAll(".s-thumbs [data-img]").forEach(x => x.classList.toggle("is-on", x === b));
    }));

    const match = () => p.variants.find(v => Object.keys(sel).every(k => v.options[k] === sel[k]) && Object.keys(v.options).length === Object.keys(sel).length);
    function draw() {
      const v = match();
      document.getElementById("sp-opts").innerHTML = p.options.map(o => `
        <div class="s-opt"><span class="label">${esc(o.name)}</span><div class="vals">
          ${o.values.map(val => {
            const test = Object.assign({}, sel, { [o.name]: val });
            const tv = p.variants.find(x => Object.keys(test).every(k => x.options[k] === test[k]));
            return `<button type="button" data-o="${esc(o.name)}" data-v="${esc(val)}" class="${sel[o.name] === val ? "is-on" : ""} ${tv && tv.stock === 0 ? "is-out" : ""}">${esc(val)}</button>`;
          }).join("")}
        </div></div>`).join("");
      document.getElementById("sp-price").textContent = v ? money(v.price) : priceText(p);
      const stockEl = document.getElementById("sp-stock");
      const can = v && v.stock > 0;
      stockEl.textContent = !v ? "請選擇規格" : v.stock === 0 ? "這個規格已售完" : v.stock <= 5 ? `僅剩 ${v.stock} 件` : "有現貨";
      document.getElementById("sp-add").disabled = !can;
      document.getElementById("sp-buy").disabled = !can;
      if (v && qty > v.stock && v.stock > 0) { qty = v.stock; document.getElementById("sp-qty").value = qty; }
    }
    draw();

    document.getElementById("sp-opts").addEventListener("click", e => {
      const b = e.target.closest("button[data-o]"); if (!b) return;
      sel[b.dataset.o] = b.dataset.v; draw();
    });
    const qEl = document.getElementById("sp-qty");
    const setQty = n => { const v = match(); qty = Math.max(1, Math.min(n, v ? Math.max(1, v.stock) : 1)); qEl.value = qty; };
    document.getElementById("sp-minus").addEventListener("click", () => setQty(qty - 1));
    document.getElementById("sp-plus").addEventListener("click", () => setQty(qty + 1));
    qEl.addEventListener("change", () => setQty(Math.floor(+qEl.value || 1)));

    const add = () => {
      const v = match();
      try { DB.cart.add(p.id, v.id, qty); return true; }
      catch (err) { toast(err.message, "error"); return false; }
    };
    document.getElementById("sp-add").addEventListener("click", () => { if (add()) { toast("已加入購物車"); viewProduct(id); } });
    document.getElementById("sp-buy").addEventListener("click", () => { if (add()) Router.go("shop/cart"); });
  }

  /* ---------- 購物車 ---------- */
  async function viewCart() {
    const items = DB.cart.items();
    let q;
    try { q = items.length ? await DB.quote(items, null, { couponCode: DB.cart.coupon() }) : null; }
    catch (err) { return shell(`<div class="s-wrap s-page"><h1>購物車</h1><div class="s-box"><div class="empty">${esc(err.message)}<div style="margin-top:12px"><button class="btn" onclick="location.reload()">重新整理</button></div></div></div></div>`); }
    const cb = q ? couponBox(q, viewCart) : { html: "", bind() {} };
    shell(`
      <div class="s-wrap s-page">
        <h1>購物車</h1>
        ${items.length ? `<div class="s-two">
          <section class="s-box">
            ${items.map(it => `<div class="s-line">
              ${img({ color: it.color, name: it.name }, "", it.image)}
              <div class="meta"><a href="#shop/p/${it.productId}">${esc(it.name)}</a><small>${esc(it.optionText) || "單一規格"} · ${money(it.price)}</small></div>
              <div class="right">
                <div class="s-qty"><button type="button" data-v="${it.variantId}" data-d="-1" aria-label="減少">−</button><input type="number" value="${it.qty}" min="0" max="${it.stock}" data-v="${it.variantId}" id="cq-${it.variantId}" aria-label="數量"><button type="button" data-v="${it.variantId}" data-d="1" aria-label="增加">+</button></div>
                <span class="mono">${money(it.price * it.qty)}</span>
              </div>
            </div>`).join("")}
          </section>
          <aside class="s-box">
            <h2>訂單摘要</h2>
            <div class="s-sum">${sumLines(q, false)}</div>
            ${nudges(q)}
            ${cb.html}
            <a class="btn btn-primary" href="#shop/checkout" style="padding:11px">前往結帳</a>
            <a href="#shop" class="small" style="text-align:center">繼續逛</a>
          </aside>
        </div>` : `<div class="s-box"><div class="empty">購物車是空的<div style="margin-top:12px"><a class="btn btn-primary" href="#shop">去逛逛</a></div></div></div>`}
      </div>`);

    if (items.length) cb.bind();
    root().querySelectorAll(".s-qty button[data-v]").forEach(b => b.addEventListener("click", () => {
      const it = items.find(x => x.variantId === b.dataset.v);
      const n = it.qty + (+b.dataset.d);
      if (n > it.stock) return toast(`庫存只剩 ${it.stock} 件`, "error");
      DB.cart.setQty(it.variantId, n); viewCart();
    }));
    root().querySelectorAll(".s-qty input[data-v]").forEach(el => el.addEventListener("change", () => {
      const it = items.find(x => x.variantId === el.dataset.v);
      const n = Math.max(0, Math.min(it.stock, Math.floor(+el.value || 0)));
      DB.cart.setQty(it.variantId, n); viewCart();
    }));
  }

  /* ---------- 結帳 ---------- */
  const form = { name: "", phone: "", email: "", ship: "", address: "", storeName: "", pay: "", note: "" };
  function viewCheckout() {
    const items = DB.cart.items();
    if (!items.length) return Router.go("shop/cart");
    const st = DB.settings.get();
    const ships = st.shippingMethods.filter(m => m.enabled);
    const pays = st.paymentMethods.filter(m => m.enabled);
    if (!ships.find(m => m.id === form.ship)) form.ship = ships[0] ? ships[0].id : "";
    if (!pays.find(m => m.id === form.pay)) form.pay = pays[0] ? pays[0].id : "";
    const user = DB.auth.current();
    // 換人登入或登出後，清掉上一個人留在結帳表單的資料
    const owner = user ? user.id : "";
    if (form.owner !== owner) Object.assign(form, { owner, name: "", phone: "", email: "", address: "", storeName: "", note: "" });
    if (user) { // 已登入就帶入會員資料（還能改成別的收件人）
      form.name = form.name || user.name;
      form.phone = form.phone || user.phone;
      form.email = form.email || user.email || "";
    }

    shell(`
      <div class="s-wrap s-page">
        <h1>結帳</h1>
        <form class="s-two" id="co-form" novalidate>
          <div style="display:grid;gap:18px">
            <section class="s-box">
              <div class="s-box-head"><h2>訂購人</h2>${user
                ? `<span class="small" style="color:var(--s-muted)">以會員 ${esc(user.name)} 的身分結帳</span>`
                : DB.features.members ? `<a class="small" href="#shop/login" data-back="shop/checkout">已經是會員？登入</a>` : ""}</div>
              <div class="grid-form" style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
                <div class="field"><label for="co-name">姓名</label><input type="text" id="co-name" value="${esc(form.name)}" autocomplete="name" required></div>
                <div class="field"><label for="co-phone">手機</label><input type="tel" id="co-phone" value="${esc(form.phone)}" placeholder="0912345678" autocomplete="tel" required></div>
                <div class="field" style="grid-column:1/-1"><label for="co-email">Email（選填，接收訂單通知）</label><input type="email" id="co-email" value="${esc(form.email)}" autocomplete="email"></div>
              </div>
            </section>
            <section class="s-box">
              <h2>取貨方式</h2>
              <div class="s-radio">${ships.map(m => `<label><input type="radio" name="co-ship" id="co-ship-${m.id}" value="${m.id}" ${form.ship === m.id ? "checked" : ""}> ${esc(m.name)}<span class="fee">${money(m.fee)}</span></label>`).join("")}</div>
              <div id="co-ship-extra"></div>
            </section>
            <section class="s-box">
              <h2>付款方式</h2>
              <div class="s-radio">${pays.map(m => `<label><input type="radio" name="co-pay" id="co-pay-${m.id}" value="${m.id}" ${form.pay === m.id ? "checked" : ""}> ${esc(m.name)}</label>`).join("")}</div>
              <p class="small" style="margin:0;color:var(--s-muted)">線上刷卡尚未開放。</p>
            </section>
            <section class="s-box">
              <div class="field"><label for="co-note">備註（選填）</label><textarea id="co-note" rows="2">${esc(form.note)}</textarea></div>
              <div class="hp" aria-hidden="true"><label for="co-web">網站（請留空）</label><input type="text" id="co-web" name="website" tabindex="-1" autocomplete="off"></div>
            </section>
            ${st.returnPolicy ? `<section class="s-box"><h2>退換貨政策</h2><div class="small" style="white-space:pre-wrap;line-height:1.7;color:var(--s-muted)">${esc(st.returnPolicy)}</div></section>` : ""}
          </div>
          <aside class="s-box" id="co-sum"></aside>
        </form>
      </div>`);

    const f = document.getElementById("co-form");
    function readForm() {
      form.name = f.querySelector("#co-name").value.trim();
      form.phone = f.querySelector("#co-phone").value.replace(/[\s-]/g, "");
      form.email = f.querySelector("#co-email").value.trim();
      form.note = f.querySelector("#co-note").value.trim();
      const s = f.querySelector('input[name="co-ship"]:checked'); form.ship = s ? s.value : "";
      const p = f.querySelector('input[name="co-pay"]:checked'); form.pay = p ? p.value : "";
      const a = f.querySelector("#co-address"); if (a) form.address = a.value.trim();
      const sn = f.querySelector("#co-store"); if (sn) form.storeName = sn.value.trim();
    }
    function drawExtra() {
      const m = ships.find(x => x.id === form.ship);
      document.getElementById("co-ship-extra").innerHTML = !m ? "" : m.type === "home"
        ? `<div class="field"><label for="co-address">收件地址</label><input type="text" id="co-address" value="${esc(form.address)}" autocomplete="street-address"></div>`
        : `<div class="field"><label for="co-store">取貨門市</label><input type="text" id="co-store" value="${esc(form.storeName)}" placeholder="例如 中港門市"><span class="hint">超商門市地圖要等物流串接後才能選，先手動填寫。</span></div>`;
    }
    let sumSeq = 0;
    async function drawSum() {
      const seq = ++sumSeq;
      const box = document.getElementById("co-sum");
      if (!box.innerHTML.trim()) box.innerHTML = `<h2>訂單內容</h2><p class="small" style="margin:0;color:var(--s-muted)">計算金額中…</p>`;
      let q;
      try { q = await DB.quote(items, form.ship, { couponCode: DB.cart.coupon(), phone: form.phone }); }
      catch (err) { if (seq === sumSeq) box.innerHTML = `<h2>訂單內容</h2><div class="s-gap">${esc(err.message)}</div>`; return; }
      if (seq !== sumSeq || !box.isConnected) return; // 已經有更新的計算結果
      const cb = couponBox(q, () => { readForm(); drawSum(); }, () => form.phone);
      box.innerHTML = `
        <h2>訂單內容</h2>
        ${items.map(it => `<div class="s-sum"><div><span>${esc(it.name)}${it.optionText ? `（${esc(it.optionText)}）` : ""} × ${it.qty}</span><span>${money(it.price * it.qty)}</span></div></div>`).join("")}
        <div class="s-sum">${sumLines(q, true)}</div>
        ${nudges(q)}
        ${cb.html}
        <button class="btn btn-primary" type="submit" style="padding:12px">送出訂單</button>`;
      cb.bind();
    }
    drawExtra(); drawSum();
    f.addEventListener("change", e => {
      if (e.target.id === "cp-code") return; // 優惠碼按「套用」才生效
      readForm();
      if (e.target.name === "co-ship") drawExtra();
      if (e.target.name === "co-ship" || e.target.id === "co-phone") drawSum();
    });
    f.addEventListener("submit", async e => {
      e.preventDefault();
      readForm();
      const btn = f.querySelector("button[type=submit]");
      if (btn) { btn.disabled = true; btn.textContent = "送出中…"; }
      try {
        const o = await DB.orders.create({
          contact: { name: form.name, phone: form.phone, email: form.email },
          shipping: { methodId: form.ship, address: form.address, storeName: form.storeName },
          paymentMethodId: form.pay, note: form.note, hp: (document.getElementById("co-web") || {}).value || "",
        });
        form.note = "";
        Router.go("shop/done/" + o.number);
      } catch (err) {
        toast(err.message, "error");
        if (btn && btn.isConnected) { btn.disabled = false; btn.textContent = "送出訂單"; }
        drawSum();
      }
    });
  }

  /* ---------- 下單完成 ---------- */
  function viewDone(number) {
    const o = DB.orders.forCustomer(number);
    const st = DB.settings.get();
    const pay = o && st.paymentMethods.find(m => m.id === o.payment.methodId);
    const user = DB.auth.current();
    const canJoin = o && DB.features.members && !user && !DB.auth.hasAccount(o.contact.phone);
    const adminOrder = o && DB.orders.get(o.number);
    shell(`
      <div class="s-wrap s-done">
        ${o ? `
          <h1>訂單已送出</h1>
          <p class="muted" style="margin:0">訂單編號</p>
          <div class="no">${esc(o.number)}</div>
          <p style="margin:0">總計 <b class="mono">${money(o.total)}</b> · ${esc(o.shipping.methodName)}</p>
          ${pay ? `<p style="margin:0;max-width:40ch;color:var(--s-muted)">${esc(pay.instruction)}</p>` : ""}
          <div class="actions" style="justify-content:center"><a class="btn btn-primary" href="#shop/order/${esc(o.number)}">查看訂單</a><a class="btn" href="#shop">繼續逛</a></div>
          ${canJoin ? `<div class="s-box s-join">
            <b>下次想更快查訂單？</b>
            <span>用這支手機 ${esc(maskPhone(o.contact.phone))} 設定密碼，就能隨時看到這筆和以後的訂單。</span>
            <button class="btn" type="button" id="done-join">設定密碼成為會員</button>
          </div>` : user ? `<p class="small" style="margin:0;color:var(--s-muted)">這筆訂單已經放在你的<a href="#shop/account">會員中心</a>。</p>`
            : DB.features.members ? `<p class="small" style="margin:0;color:var(--s-muted)">這支手機已經是會員，<a href="#shop/login">登入</a>後就能在會員中心看到這筆訂單。</p>`
            : `<p class="small" style="margin:0;color:var(--s-muted)">之後可以在「<a href="#shop/track">訂單查詢</a>」用訂單編號＋手機查看進度。</p>`}
          ${adminOrder ? `<a class="small" href="#admin/order/${esc(adminOrder.id)}" style="color:var(--s-muted)">（開發用）到後台看這筆訂單</a>` : ""}
        ` : `<div class="empty">找不到這筆訂單</div>`}
      </div>`);
    const join = document.getElementById("done-join");
    if (join) join.addEventListener("click", () => { regPrefill = { phone: o.contact.phone, name: o.contact.name, email: o.contact.email }; Router.go("shop/register"); });
  }

  function membersSoon() {
    shell(`<div class="s-wrap s-page s-narrow"><div class="s-box"><div class="empty">會員登入即將開放。<br>現在可以用訂單編號＋手機查詢訂單。
      <div style="margin-top:12px"><a class="btn btn-primary" href="#shop/track">訂單查詢</a></div></div></div></div>`);
  }

  /* ========== 會員與訂單查詢 ========== */
  let afterLogin = "shop/account"; // 登入後要回到哪一頁
  let regPrefill = null;           // 從下單完成頁帶過來的註冊資料
  document.addEventListener("click", e => {
    const a = e.target.closest("a[data-back]");
    if (a) afterLogin = a.dataset.back;
  });
  const maskPhone = p => String(p).replace(/^(\d{4})\d{3}(\d{3})$/, "$1***$2");
  const CUSTOMER_STATUS = { pending_payment: "待付款", paid: "備貨中", shipped: "已出貨", completed: "已完成", cancelled: "已取消" };
  const STEPS = ["pending_payment", "paid", "shipped", "completed"];
  const statusTag = s => `<span class="s-tag is-${s}">${CUSTOMER_STATUS[s]}</span>`;
  // 送出表單時先把按鈕鎖住，避免連點
  async function busy(btn, fn) {
    btn.disabled = true;
    try { await fn(); } catch (err) { toast(err.message, "error"); } finally { if (btn.isConnected) btn.disabled = false; }
  }

  /* ---------- 登入 ---------- */
  function viewLogin() {
    if (DB.auth.current()) return Router.go(afterLogin);
    shell(`
      <div class="s-wrap s-page s-narrow">
        <h1>會員登入</h1>
        <form class="s-box" id="li-form" novalidate>
          <div class="field"><label for="li-phone">手機</label><input type="tel" id="li-phone" autocomplete="username" placeholder="0912345678" required></div>
          <div class="field"><label for="li-pw">密碼</label><input type="password" id="li-pw" autocomplete="current-password" required></div>
          <button class="btn btn-primary" type="submit" style="padding:11px">登入</button>
          <div class="s-links"><a href="#shop/register">還沒有帳號？註冊</a><a href="#shop/track">不登入，直接查訂單</a></div>
        </form>
        <p class="small s-demo">示範帳號：手機 0912345678、密碼 demo1234</p>
      </div>`);
    const f = document.getElementById("li-form");
    f.querySelector("#li-phone").focus();
    f.addEventListener("submit", e => {
      e.preventDefault();
      busy(f.querySelector("button[type=submit]"), async () => {
        const u = await DB.auth.login(f.querySelector("#li-phone").value, f.querySelector("#li-pw").value);
        toast(`歡迎回來，${u.name}`);
        const back = afterLogin; afterLogin = "shop/account";
        Router.go(back);
      });
    });
  }

  /* ---------- 註冊（兩步：手機驗證碼 → 填資料） ---------- */
  function viewRegister() {
    if (DB.auth.current()) return Router.go("shop/account");
    const pre = regPrefill || {}; regPrefill = null;
    let sent = null; // requestCode 的結果
    shell(`
      <div class="s-wrap s-page s-narrow">
        <h1>註冊會員</h1>
        <form class="s-box" id="rg-form" novalidate>
          <div class="field"><label for="rg-phone">手機</label>
            <div class="s-inline"><input type="tel" id="rg-phone" autocomplete="tel" placeholder="0912345678" value="${esc(pre.phone || "")}"><button class="btn" type="button" id="rg-send">取得驗證碼</button></div>
            <span class="hint">已經用這支手機下過單的話，註冊後會自動接上以前的訂單。</span>
          </div>
          <div id="rg-step2" hidden style="display:grid;gap:14px">
            <div class="s-demo-code" id="rg-demo" role="status"></div>
            <div class="field"><label for="rg-code">驗證碼</label><input type="text" id="rg-code" inputmode="numeric" autocomplete="one-time-code" maxlength="6"></div>
            <div class="field"><label for="rg-name">姓名</label><input type="text" id="rg-name" autocomplete="name" value="${esc(pre.name || "")}"></div>
            <div class="field"><label for="rg-email">Email（選填）</label><input type="email" id="rg-email" autocomplete="email" value="${esc(pre.email || "")}"></div>
            <div class="field"><label for="rg-pw">設定密碼</label><input type="password" id="rg-pw" autocomplete="new-password"><span class="hint">至少 8 個字元，要有英文字母和數字</span></div>
            <label class="check"><input type="checkbox" id="rg-agree"> 我已閱讀並同意服務條款與隱私權政策</label>
            <button class="btn btn-primary" type="submit" style="padding:11px">完成註冊</button>
          </div>
          <div class="s-links"><a href="#shop/login">已經有帳號？登入</a></div>
        </form>
      </div>`);
    const f = document.getElementById("rg-form");
    const sendBtn = f.querySelector("#rg-send");
    sendBtn.addEventListener("click", () => {
      try {
        sent = DB.auth.requestCode(f.querySelector("#rg-phone").value);
        f.querySelector("#rg-phone").readOnly = true;
        f.querySelector("#rg-step2").hidden = false;
        f.querySelector("#rg-demo").innerHTML = `<b>示範模式</b>：簡訊還沒串接，驗證碼是 <span class="mono">${sent.demoCode}</span>（10 分鐘內有效）${sent.existing ? "<br>這支手機下過單，註冊後會接上原本的訂單。" : ""}`;
        f.querySelector("#rg-code").focus();
        let left = 60;
        sendBtn.disabled = true; sendBtn.textContent = `${left} 秒後可重送`;
        const t = setInterval(() => {
          if (!sendBtn.isConnected) return clearInterval(t);
          left -= 1;
          if (left <= 0) { clearInterval(t); sendBtn.disabled = false; sendBtn.textContent = "重送驗證碼"; }
          else sendBtn.textContent = `${left} 秒後可重送`;
        }, 1000);
      } catch (err) { toast(err.message, "error"); }
    });
    f.addEventListener("submit", e => {
      e.preventDefault();
      if (!sent) return toast("請先取得驗證碼", "error");
      if (!f.querySelector("#rg-agree").checked) return toast("請先閱讀並同意服務條款與隱私權政策", "error");
      busy(f.querySelector("button[type=submit]"), async () => {
        const u = await DB.auth.register({
          phone: sent.phone, code: f.querySelector("#rg-code").value,
          name: f.querySelector("#rg-name").value, email: f.querySelector("#rg-email").value,
          password: f.querySelector("#rg-pw").value,
        });
        toast(`註冊完成，歡迎 ${u.name}`);
        Router.go("shop/account");
      });
    });
  }

  /* ========== 會員（Email 帳號，資料庫版） ========== */
  function viewLoginEmail() {
    if (DB.auth.current()) return Router.go(afterLogin);
    if (DB.auth.session()) return Router.go("shop/join");
    shell(`
      <div class="s-wrap s-page s-narrow">
        <h1>會員登入</h1>
        <form class="s-box" id="le-form" novalidate>
          <div class="field"><label for="le-email">Email</label><input type="email" id="le-email" autocomplete="username" required></div>
          <div class="field"><label for="le-pw">密碼</label><input type="password" id="le-pw" autocomplete="current-password" required></div>
          <button class="btn btn-primary" type="submit" style="padding:11px">登入</button>
          <div class="s-links"><a href="#shop/register">還沒有帳號？註冊</a><a href="#shop/forgot">忘記密碼</a></div>
          <div class="s-links"><a href="#shop/track">不登入，直接查訂單</a></div>
        </form>
      </div>`);
    const f = document.getElementById("le-form");
    f.querySelector("#le-email").focus();
    f.addEventListener("submit", e => {
      e.preventDefault();
      busy(f.querySelector("button[type=submit]"), async () => {
        const u = await DB.auth.login(f.querySelector("#le-email").value, f.querySelector("#le-pw").value);
        if (!u) return Router.go("shop/join");
        toast(`歡迎回來，${u.name}`);
        const back = afterLogin; afterLogin = "shop/account";
        Router.go(back);
      });
    });
  }

  function viewRegisterEmail() {
    if (DB.auth.current()) return Router.go("shop/account");
    const pre = regPrefill || {}; regPrefill = null;
    shell(`
      <div class="s-wrap s-page s-narrow">
        <h1>註冊會員</h1>
        <form class="s-box" id="re-form" novalidate>
          <div class="field"><label for="re-email">Email</label><input type="email" id="re-email" autocomplete="email" value="${esc(pre.email || "")}"><span class="hint">用這個 Email 登入；以前用同一個 Email 下過的訂單會自動接上</span></div>
          <div class="field"><label for="re-name">姓名</label><input type="text" id="re-name" autocomplete="name" value="${esc(pre.name || "")}"></div>
          <div class="field"><label for="re-phone">手機</label><input type="tel" id="re-phone" autocomplete="tel" placeholder="0912345678" value="${esc(pre.phone || "")}"></div>
          <div class="field"><label for="re-pw">設定密碼</label><input type="password" id="re-pw" autocomplete="new-password"><span class="hint">至少 8 個字元</span></div>
          <label class="check"><input type="checkbox" id="re-agree"> 我已閱讀並同意<a href="${esc(DB.admin.storeUrl(""))}#home/terms" target="_blank">服務條款</a>與<a href="${esc(DB.admin.storeUrl(""))}#home/privacy" target="_blank">隱私權政策</a></label>
          <button class="btn btn-primary" type="submit" style="padding:11px">註冊</button>
          <div class="s-links"><a href="#shop/login">已經有帳號？登入</a></div>
        </form>
        <div class="s-box" id="re-sent" hidden>
          <h2>請到信箱確認</h2>
          <p style="margin:0;color:var(--s-muted)">我們寄了一封確認信到 <b id="re-to"></b>。點信裡的連結就會回到這裡並完成註冊。</p>
          <p class="small" style="margin:0;color:var(--s-muted)">沒收到？看一下垃圾信件匣；幾分鐘後還是沒有，可以再註冊一次或聯絡客服。</p>
        </div>
      </div>`);
    const f = document.getElementById("re-form");
    f.querySelector(pre.email ? "#re-pw" : "#re-email").focus();
    f.addEventListener("submit", e => {
      e.preventDefault();
      if (!f.querySelector("#re-agree").checked) return toast("請先閱讀並同意服務條款與隱私權政策", "error");
      busy(f.querySelector("button[type=submit]"), async () => {
        const email = f.querySelector("#re-email").value.trim();
        const r = await DB.auth.signup({ email, password: f.querySelector("#re-pw").value,
          name: f.querySelector("#re-name").value, phone: f.querySelector("#re-phone").value });
        if (r.needConfirm) {
          f.hidden = true;
          document.getElementById("re-to").textContent = email;
          document.getElementById("re-sent").hidden = false;
        } else { toast("註冊完成"); Router.go("shop/account"); }
      });
    });
  }

  // 登入了但這家店還沒有會員資料（例如在別的瀏覽器確認信箱）
  function viewJoin() {
    if (DB.auth.current()) return Router.go("shop/account");
    const sess = DB.auth.session();
    if (!sess) return Router.go("shop/login");
    shell(`
      <div class="s-wrap s-page s-narrow">
        <h1>完成會員資料</h1>
        <form class="s-box" id="jn-form" novalidate>
          <p style="margin:0;color:var(--s-muted)">帳號：${esc(sess.email)}</p>
          <div class="field"><label for="jn-name">姓名</label><input type="text" id="jn-name" autocomplete="name"></div>
          <div class="field"><label for="jn-phone">手機</label><input type="tel" id="jn-phone" autocomplete="tel" placeholder="0912345678"></div>
          <button class="btn btn-primary" type="submit" style="padding:11px">完成</button>
          <div class="s-links"><button class="btn btn-ghost btn-sm" type="button" id="jn-out">登出</button></div>
        </form>
      </div>`);
    const f = document.getElementById("jn-form");
    f.querySelector("#jn-name").focus();
    document.getElementById("jn-out").addEventListener("click", async () => { await DB.auth.logout(); Router.go("shop"); });
    f.addEventListener("submit", e => {
      e.preventDefault();
      busy(f.querySelector("button[type=submit]"), async () => {
        const u = await DB.auth.join({ name: f.querySelector("#jn-name").value, phone: f.querySelector("#jn-phone").value });
        toast(`歡迎加入，${u.name}`); Router.go("shop/account");
      });
    });
  }

  function viewForgot() {
    shell(`
      <div class="s-wrap s-page s-narrow">
        <h1>忘記密碼</h1>
        <form class="s-box" id="fg-form" novalidate>
          <p style="margin:0;color:var(--s-muted)">輸入註冊用的 Email，我們會寄一封重設密碼的信給你。</p>
          <div class="field"><label for="fg-email">Email</label><input type="email" id="fg-email" autocomplete="email"></div>
          <button class="btn btn-primary" type="submit" style="padding:11px">寄出重設信</button>
          <div class="s-links"><a href="#shop/login">回到登入</a></div>
        </form>
      </div>`);
    const f = document.getElementById("fg-form");
    f.querySelector("#fg-email").focus();
    f.addEventListener("submit", e => {
      e.preventDefault();
      busy(f.querySelector("button[type=submit]"), async () => {
        await DB.auth.requestReset(f.querySelector("#fg-email").value);
        // 不透露這個 Email 有沒有註冊過
        f.innerHTML = `<h2>請到信箱收信</h2><p style="margin:0;color:var(--s-muted)">如果這個 Email 有註冊，幾分鐘內會收到重設密碼的信。請在<b>同一個瀏覽器</b>打開信裡的連結。</p>
          <div class="s-links"><a href="#shop/login">回到登入</a></div>`;
      });
    });
  }

  function viewReset() {
    if (!DB.auth.session()) {
      return shell(`<div class="s-wrap s-page s-narrow"><div class="s-box"><div class="empty">重設密碼連結已失效，請重新申請。
        <div style="margin-top:12px"><a class="btn btn-primary" href="#shop/forgot">重新申請</a></div></div></div></div>`);
    }
    shell(`
      <div class="s-wrap s-page s-narrow">
        <h1>設定新密碼</h1>
        <form class="s-box" id="rs-form" novalidate>
          <div class="field"><label for="rs-pw">新密碼</label><input type="password" id="rs-pw" autocomplete="new-password"><span class="hint">至少 8 個字元</span></div>
          <button class="btn btn-primary" type="submit" style="padding:11px">儲存新密碼</button>
        </form>
      </div>`);
    const f = document.getElementById("rs-form");
    f.querySelector("#rs-pw").focus();
    f.addEventListener("submit", e => {
      e.preventDefault();
      busy(f.querySelector("button[type=submit]"), async () => {
        await DB.auth.setNewPassword(f.querySelector("#rs-pw").value);
        toast("密碼已更新"); Router.go(DB.auth.current() ? "shop/account" : "shop/join");
      });
    });
  }

  /* ---------- 會員中心 ---------- */
  function viewAccount() {
    const u = DB.auth.current();
    if (!u) {
      if (DB.auth.session && DB.auth.session()) return Router.go("shop/join");   // 登入了但還沒填會員資料
      afterLogin = "shop/account"; return Router.go("shop/login");
    }
    const emailMode = DB.auth.mode === "email";
    const list = DB.orders.mine();
    const lv = DB.tiers.of(u.id);
    const cfg = DB.tiers.get();
    const tierCard = lv ? `
      <section class="s-box s-tier">
        <div class="s-box-head"><h2>會員等級</h2><span class="s-tier-name">${esc(lv.tier.name)}</span></div>
        <div class="s-tier-benefit">${esc(DB.tiers.benefit(lv.tier))}</div>
        ${lv.next ? `
          <div class="s-meter" role="img" aria-label="升級進度"><i style="width:${Math.min(100, (lv.spent - lv.tier.minSpend) / (lv.next.minSpend - lv.tier.minSpend) * 100).toFixed(1)}%"></i></div>
          <div class="small">再消費 <b class="mono">${money(lv.gap)}</b> 升級為「${esc(lv.next.name)}」：${esc(DB.tiers.benefit(lv.next))}</div>`
        : `<div class="small" style="color:var(--s-muted)">你已經是最高等級，謝謝你的支持</div>`}
        <details class="s-tier-all"><summary class="small">看全部等級</summary>
          <ul>${cfg.tiers.map(t => `<li class="${t.id === lv.tier.id ? "is-me" : ""}"><b>${esc(t.name)}</b><span>${t.minSpend ? `消費滿 ${money(t.minSpend)}` : "註冊即享"}</span><span>${esc(DB.tiers.benefit(t))}</span></li>`).join("")}</ul>
          <p class="small" style="margin:0;color:var(--s-muted)">累積${cfg.period === "12m" ? "最近 12 個月" : ""}已付款、未取消的訂單金額；目前 ${money(lv.spent)}。</p>
        </details>
      </section>` : "";
    shell(`
      <div class="s-wrap s-page">
        <div class="s-page-head"><h1>會員中心</h1><button class="btn" type="button" id="ac-out">登出</button></div>
        <div class="s-two">
          <section class="s-box">
            <h2>我的訂單</h2>
            ${list.length ? `<div class="s-orders">${list.map(o => `
              <a class="s-order" href="#shop/order/${esc(o.number)}">
                <span class="mono">${esc(o.number)}</span>
                <span class="s-order-date">${esc(date(o.createdAt))}</span>
                ${statusTag(o.status)}
                <span class="s-order-items">${esc(o.items.map(it => it.name).join("、"))}</span>
                <span class="mono s-order-total">${money(o.total)}</span>
              </a>`).join("")}</div>` : `<div class="empty">還沒有訂單<div style="margin-top:12px"><a class="btn btn-primary" href="#shop">去逛逛</a></div></div>`}
          </section>
          <div style="display:grid;gap:18px">
            ${tierCard}
            <form class="s-box" id="ac-profile" novalidate>
              <h2>會員資料</h2>
              ${emailMode ? `
              <div class="field"><label>Email（帳號）</label><div>${esc(u.email)}</div></div>
              <div class="field"><label for="ac-name">姓名</label><input type="text" id="ac-name" value="${esc(u.name)}" autocomplete="name"></div>
              <div class="field"><label for="ac-phone">手機</label><input type="tel" id="ac-phone" value="${esc(u.phone || "")}" autocomplete="tel"></div>` : `
              <div class="field"><label>手機（帳號）</label><div class="mono">${esc(u.phone)}</div></div>
              <div class="field"><label for="ac-name">姓名</label><input type="text" id="ac-name" value="${esc(u.name)}" autocomplete="name"></div>
              <div class="field"><label for="ac-email">Email</label><input type="email" id="ac-email" value="${esc(u.email || "")}" autocomplete="email"></div>`}
              <button class="btn" type="submit">儲存資料</button>
            </form>
            <form class="s-box" id="ac-pw" novalidate>
              <h2>變更密碼</h2>
              <div class="field"><label for="ac-old">目前密碼</label><input type="password" id="ac-old" autocomplete="current-password"></div>
              <div class="field"><label for="ac-new">新密碼</label><input type="password" id="ac-new" autocomplete="new-password"><span class="hint">${emailMode ? "至少 8 個字元" : "至少 8 個字元，要有英文字母和數字"}</span></div>
              <button class="btn" type="submit">變更密碼</button>
            </form>
          </div>
        </div>
      </div>`);
    document.getElementById("ac-out").addEventListener("click", async () => { await DB.auth.logout(); toast("已登出"); Router.go("shop"); });
    const pf = document.getElementById("ac-profile");
    pf.addEventListener("submit", e => {
      e.preventDefault();
      busy(pf.querySelector("button[type=submit]"), async () => {
        await DB.auth.updateProfile(emailMode
          ? { name: pf.querySelector("#ac-name").value, phone: pf.querySelector("#ac-phone").value }
          : { name: pf.querySelector("#ac-name").value, email: pf.querySelector("#ac-email").value });
        toast("已儲存資料"); viewAccount();
      });
    });
    const pw = document.getElementById("ac-pw");
    pw.addEventListener("submit", e => {
      e.preventDefault();
      busy(pw.querySelector("button[type=submit]"), async () => {
        await DB.auth.changePassword(pw.querySelector("#ac-old").value, pw.querySelector("#ac-new").value);
        pw.reset(); toast("密碼已變更");
      });
    });
  }

  /* ---------- 訂單查詢（不用登入） ---------- */
  function viewTrack() {
    shell(`
      <div class="s-wrap s-page s-narrow">
        <h1>訂單查詢</h1>
        <form class="s-box" id="tk-form" novalidate>
          <p style="margin:0;color:var(--s-muted)">輸入訂單編號和下單時填的手機，就能看到訂單狀態和物流單號。</p>
          <div class="field"><label for="tk-no">訂單編號</label><input type="text" id="tk-no" placeholder="例如 SO240002" autocapitalize="characters"></div>
          <div class="field"><label for="tk-phone">手機</label><input type="tel" id="tk-phone" placeholder="0912345678" autocomplete="tel"></div>
          <button class="btn btn-primary" type="submit" style="padding:11px">查詢</button>
          <div class="s-links"><a href="#shop/login" data-back="shop/account">會員登入，看全部訂單</a></div>
        </form>
      </div>`);
    const f = document.getElementById("tk-form");
    f.querySelector("#tk-no").focus();
    f.addEventListener("submit", async e => {
      e.preventDefault();
      const btn = f.querySelector("button[type=submit]");
      btn.disabled = true;
      try {
        const o = await DB.orders.lookup(f.querySelector("#tk-no").value, f.querySelector("#tk-phone").value);
        Router.go("shop/order/" + o.number);
      } catch (err) { toast(err.message, "error"); btn.disabled = false; }
    });
  }

  /* ---------- 訂單詳情（顧客看的） ---------- */
  function viewMyOrder(number) {
    const o = DB.orders.forCustomer(number);
    if (!o) {
      return shell(`<div class="s-wrap s-page s-narrow"><div class="s-box"><div class="empty">要登入，或用訂單編號＋手機查詢，才能看這筆訂單
        <div class="actions" style="justify-content:center;margin-top:12px"><a class="btn btn-primary" href="#shop/track">訂單查詢</a><a class="btn" href="#shop/login">會員登入</a></div></div></div></div>`);
    }
    const st = DB.settings.get();
    const pay = st.paymentMethods.find(m => m.id === o.payment.methodId);
    const reached = s => o.history.find(h => h.status === s);
    const curIdx = STEPS.indexOf(o.status);
    const user = DB.auth.current();
    shell(`
      <div class="s-wrap s-page">
        <div class="s-page-head">
          <div style="display:grid;gap:4px">
            <a class="small" href="${user ? "#shop/account" : "#shop/track"}">← ${user ? "會員中心" : "訂單查詢"}</a>
            <h1>訂單 <span class="mono">${esc(o.number)}</span></h1>
            <span class="small" style="color:var(--s-muted)">下單時間 ${esc(date(o.createdAt, true))}</span>
          </div>
          ${statusTag(o.status)}
        </div>
        ${o.status === "cancelled" ? `<div class="s-box"><b>這筆訂單已取消</b></div>` : `
        <ol class="s-steps" aria-label="訂單進度">
          ${STEPS.map((s, i) => {
            const h = reached(s);
            return `<li class="${i < curIdx ? "is-done" : i === curIdx ? "is-now" : ""}"${i === curIdx ? ' aria-current="step"' : ""}><b>${CUSTOMER_STATUS[s]}</b><span>${h ? esc(date(h.at, true)) : ""}</span></li>`;
          }).join("")}
        </ol>`}
        ${o.status === "pending_payment" && pay ? `<div class="s-gap"><b>付款方式：${esc(pay.name)}</b><br>${esc(pay.instruction)}</div>` : ""}
        <div class="s-two">
          <section class="s-box">
            <h2>訂購商品</h2>
            ${o.items.map(it => `<div class="s-sum"><div><span>${esc(it.name)}${it.optionText ? `（${esc(it.optionText)}）` : ""} × ${it.qty}</span><span>${money(it.price * it.qty)}</span></div></div>`).join("")}
            <div class="s-sum">
              <div><span>商品小計</span><span>${money(o.subtotal)}</span></div>
              ${(o.discounts || []).map(d => `<div class="s-disc"><span>${esc(d.label)}</span><span>${d.amount ? "−" + money(d.amount) : "免運"}</span></div>`).join("")}
              <div><span>運費</span><span>${o.shippingFee ? money(o.shippingFee) : "免運"}</span></div>
              <div class="total"><span>總計</span><span>${money(o.total)}</span></div>
            </div>
          </section>
          <div style="display:grid;gap:18px">
            <section class="s-box">
              <h2>取貨資訊</h2>
              <dl class="s-kv">
                <dt>收件人</dt><dd>${esc(o.contact.name)} · <span class="mono">${esc(maskPhone(o.contact.phone))}</span></dd>
                <dt>方式</dt><dd>${esc(o.shipping.methodName)}</dd>
                ${o.shipping.storeName ? `<dt>門市</dt><dd>${esc(o.shipping.storeName)}</dd>` : ""}
                ${o.shipping.address ? `<dt>地址</dt><dd>${esc(o.shipping.address)}</dd>` : ""}
                <dt>物流單號</dt><dd class="mono">${esc(o.shipping.trackingNo) || "出貨後會顯示"}</dd>
              </dl>
            </section>
            <section class="s-box">
              <h2>付款</h2>
              <dl class="s-kv">
                <dt>方式</dt><dd>${esc(o.payment.methodName)}</dd>
                <dt>狀態</dt><dd>${o.payment.status === "paid" ? "已付款" : o.payment.methodId === "cod" ? "取貨時付款" : "尚未付款"}</dd>
              </dl>
              ${o.status === "pending_payment" ? `<button class="btn" type="button" id="mo-cancel">取消訂單</button>` : ""}
            </section>
            <section class="s-box" id="mo-reviews" hidden></section>
          </div>
        </div>
      </div>`);
    // 已出貨的會員訂單：可以評價買過的商品
    if (user && reviewsOn() && ["shipped", "completed"].includes(o.status)) {
      DB.reviews.mine().then(list => {
        const mineHere = list.filter(x => x.orderNumber === o.number), box = document.getElementById("mo-reviews");
        if (!box || !mineHere.length) return;
        box.hidden = false;
        box.innerHTML = `<h2>評價這次買的商品</h2>${mineHere.map((x, i) => `<div class="s-rv-row"><span>${esc(x.name)}</span>
          ${x.review ? `<span class="small">${stars(x.review.rating)}${x.review.status === "pending" ? "（等店家確認）" : ""}</span><button class="btn btn-sm" type="button" data-rv="${i}">修改</button>`
            : `<button class="btn btn-sm btn-primary" type="button" data-rv="${i}">寫評價</button>`}</div>`).join("")}`;
        box.querySelectorAll("[data-rv]").forEach(b => b.addEventListener("click", () => reviewForm(mineHere[+b.dataset.rv], () => viewMyOrder(o.number))));
      }).catch(() => {});
    }
    const c = document.getElementById("mo-cancel");
    if (c) c.addEventListener("click", async () => {
      if (!await UI.confirmBox({ title: "取消這筆訂單？", body: "取消後無法復原，要買的話需要重新下單。", ok: "取消訂單", danger: true })) return;
      try { await DB.orders.cancelByCustomer(o.number); toast("訂單已取消"); viewMyOrder(o.number); }
      catch (err) { toast(err.message, "error"); }
    });
  }

  window.ShopApp = function (parts) {
    const [, page, arg] = parts;
    const cs = DB.shopState ? DB.shopState() : { closed: false };
    if (cs.closed && page !== "track" && page !== "order" && page !== "policy") return viewClosed(cs.message);
    switch (page) {
      case undefined: return viewHome();
      case "c": return viewHome(arg);
      case "p": return viewProduct(arg);
      case "cart": return viewCart();
      case "checkout": return viewCheckout();
      case "done": return viewDone(arg);
      case "policy": return viewPolicy();
      case "login": case "register": case "account": case "join": case "forgot": case "reset":
        if (!DB.features.members) return membersSoon();
        if (DB.auth.mode === "email") {
          return { login: viewLoginEmail, register: viewRegisterEmail, account: viewAccount, join: viewJoin, forgot: viewForgot, reset: viewReset }[page]();
        }
        return page === "login" ? viewLogin() : page === "register" ? viewRegister() : page === "account" ? viewAccount() : viewHome();
      case "track": return viewTrack();
      case "order": return viewMyOrder(arg);
      default: return viewHome();
    }
  };
})();
