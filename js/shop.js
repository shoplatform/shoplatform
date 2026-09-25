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
    const parts = DB.promotions.active().map(p => `${esc(p.name)}：${esc(DB.promotions.describe(p))}`);
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
          try { DB.cart.applyCoupon(input.value, getPhone ? getPhone() : ""); toast("已套用優惠碼"); redraw(); }
          catch (err) { toast(err.message, "error"); input.focus(); }
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
      <div class="shop">
        ${barText(st) ? `<div class="s-bar">${barText(st)}</div>` : ""}
        <header class="s-head"><div class="s-wrap">
          <a class="s-logo" href="#shop">${esc(st.name)}</a>
          <input type="search" class="s-search" id="s-q" placeholder="搜尋商品" value="${esc(query)}" aria-label="搜尋商品">
          <nav class="s-nav" aria-label="會員">
            ${user ? `<a href="#shop/account">${esc(user.name)}</a>` : `<a href="#shop/track">訂單查詢</a><a href="#shop/login">登入</a>`}
          </nav>
          <a class="s-cart" href="#shop/cart">購物車 <b>${n}</b></a>
        </div></header>
        <main>${content}</main>
        <footer class="s-foot"><div class="s-wrap">
          <span>© ${new Date().getFullYear()} ${esc(st.name)}</span>
          <span>客服 ${esc(st.email)} · ${esc(st.phone)}</span>
        </div></footer>
      </div>`;
    const q = document.getElementById("s-q");
    q.addEventListener("keydown", e => {
      if (e.key === "Enter") { query = q.value; Router.go("shop"); }
    });
  }

  /* ---------- 首頁 / 分類 ---------- */
  function viewHome(categoryId) {
    const st = DB.settings.get();
    const cats = DB.categories.list().filter(c => DB.products.list({ categoryId: c.id, status: "active" }).length);
    const list = DB.products.list({ q: query, categoryId: categoryId || "", status: "active" });
    const cur = cats.find(c => c.id === categoryId);
    shell(`
      <div class="s-wrap">
        <section class="s-hero">
          <h1>${cur ? esc(cur.name) : query ? `搜尋「${esc(query)}」` : esc(st.name)}</h1>
          <p>${cur || query ? `共 ${list.length} 件商品` : esc(st.tagline)}</p>
        </section>
        <nav class="s-cats" aria-label="商品分類">
          <a href="#shop" class="${!categoryId && !query ? "is-on" : ""}" data-clear="1">全部</a>
          ${cats.map(c => `<a href="#shop/c/${c.id}" class="${categoryId === c.id ? "is-on" : ""}">${esc(c.name)}</a>`).join("")}
        </nav>
        ${list.length ? `<div class="s-grid">${list.map(p => {
          const out = DB.products.totalStock(p) === 0;
          return `<a class="s-card" href="#shop/p/${p.id}">
            <div style="position:relative">${out ? `<span class="s-soldout">售完</span>` : ""}${img(p)}</div>
            <span class="s-name">${esc(p.name)}</span>
            <span class="s-price">${priceText(p)}</span>
          </a>`;
        }).join("")}</div>` : `<div class="empty">找不到符合的商品</div>`}
      </div>`);
    root().querySelectorAll("[data-clear]").forEach(a => a.addEventListener("click", () => { query = ""; }));
  }

  /* ---------- 商品頁 ---------- */
  function viewProduct(id) {
    const p = DB.products.get(id);
    if (!p || p.status !== "active") {
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
          </div>
        </div>
      </div>`);

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
  function viewCart() {
    const items = DB.cart.items();
    const q = DB.quote(items, null, { couponCode: DB.cart.coupon() });
    const cb = couponBox(q, viewCart);
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
                : `<a class="small" href="#shop/login" data-back="shop/checkout">已經是會員？登入</a>`}</div>
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
            </section>
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
    function drawSum() {
      const q = DB.quote(items, form.ship, { couponCode: DB.cart.coupon(), phone: form.phone });
      const cb = couponBox(q, () => { readForm(); drawSum(); }, () => form.phone);
      document.getElementById("co-sum").innerHTML = `
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
    f.addEventListener("submit", e => {
      e.preventDefault();
      readForm();
      try {
        const o = DB.orders.create({
          contact: { name: form.name, phone: form.phone, email: form.email },
          shipping: { methodId: form.ship, address: form.address, storeName: form.storeName },
          paymentMethodId: form.pay, note: form.note,
        });
        form.note = "";
        Router.go("shop/done/" + o.number);
      } catch (err) { toast(err.message, "error"); }
    });
  }

  /* ---------- 下單完成 ---------- */
  function viewDone(number) {
    const o = DB.orders.forCustomer(number);
    const st = DB.settings.get();
    const pay = o && st.paymentMethods.find(m => m.id === o.payment.methodId);
    const user = DB.auth.current();
    const canJoin = o && !user && !DB.auth.hasAccount(o.contact.phone);
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
            : `<p class="small" style="margin:0;color:var(--s-muted)">這支手機已經是會員，<a href="#shop/login">登入</a>後就能在會員中心看到這筆訂單。</p>`}
          <a class="small" href="#admin/order/${esc(DB.orders.get(o.number).id)}" style="color:var(--s-muted)">（開發用）到後台看這筆訂單</a>
        ` : `<div class="empty">找不到這筆訂單</div>`}
      </div>`);
    const join = document.getElementById("done-join");
    if (join) join.addEventListener("click", () => { regPrefill = { phone: o.contact.phone, name: o.contact.name, email: o.contact.email }; Router.go("shop/register"); });
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

  /* ---------- 會員中心 ---------- */
  function viewAccount() {
    const u = DB.auth.current();
    if (!u) { afterLogin = "shop/account"; return Router.go("shop/login"); }
    const list = DB.orders.mine();
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
            <form class="s-box" id="ac-profile" novalidate>
              <h2>會員資料</h2>
              <div class="field"><label>手機（帳號）</label><div class="mono">${esc(u.phone)}</div></div>
              <div class="field"><label for="ac-name">姓名</label><input type="text" id="ac-name" value="${esc(u.name)}" autocomplete="name"></div>
              <div class="field"><label for="ac-email">Email</label><input type="email" id="ac-email" value="${esc(u.email || "")}" autocomplete="email"></div>
              <button class="btn" type="submit">儲存資料</button>
            </form>
            <form class="s-box" id="ac-pw" novalidate>
              <h2>變更密碼</h2>
              <div class="field"><label for="ac-old">目前密碼</label><input type="password" id="ac-old" autocomplete="current-password"></div>
              <div class="field"><label for="ac-new">新密碼</label><input type="password" id="ac-new" autocomplete="new-password"><span class="hint">至少 8 個字元，要有英文字母和數字</span></div>
              <button class="btn" type="submit">變更密碼</button>
            </form>
          </div>
        </div>
      </div>`);
    document.getElementById("ac-out").addEventListener("click", () => { DB.auth.logout(); toast("已登出"); Router.go("shop"); });
    const pf = document.getElementById("ac-profile");
    pf.addEventListener("submit", e => {
      e.preventDefault();
      try { DB.auth.updateProfile({ name: pf.querySelector("#ac-name").value, email: pf.querySelector("#ac-email").value }); toast("已儲存資料"); viewAccount(); }
      catch (err) { toast(err.message, "error"); }
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
    f.addEventListener("submit", e => {
      e.preventDefault();
      try {
        const o = DB.orders.lookup(f.querySelector("#tk-no").value, f.querySelector("#tk-phone").value);
        Router.go("shop/order/" + o.number);
      } catch (err) { toast(err.message, "error"); }
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
          </div>
        </div>
      </div>`);
    const c = document.getElementById("mo-cancel");
    if (c) c.addEventListener("click", async () => {
      if (!await UI.confirmBox({ title: "取消這筆訂單？", body: "取消後無法復原，要買的話需要重新下單。", ok: "取消訂單", danger: true })) return;
      try { DB.orders.cancelByCustomer(o.number); toast("訂單已取消"); viewMyOrder(o.number); }
      catch (err) { toast(err.message, "error"); }
    });
  }

  window.ShopApp = function (parts) {
    const [, page, arg] = parts;
    switch (page) {
      case undefined: return viewHome();
      case "c": return viewHome(arg);
      case "p": return viewProduct(arg);
      case "cart": return viewCart();
      case "checkout": return viewCheckout();
      case "done": return viewDone(arg);
      case "login": return viewLogin();
      case "register": return viewRegister();
      case "account": return viewAccount();
      case "track": return viewTrack();
      case "order": return viewMyOrder(arg);
      default: return viewHome();
    }
  };
})();
