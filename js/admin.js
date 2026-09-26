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

  /* ---------- 權限：每一頁需要哪個權限（店主全部都有） ---------- */
  const PERMS = [
    ["orders", "訂單", "查看訂單、確認收款、出貨、取消"],
    ["customers", "會員", "查看會員資料與消費紀錄"],
    ["products", "商品", "新增、編輯商品與分類"],
    ["inventory", "進銷存", "庫存、進貨單、供應商（會看到成本）"],
    ["marketing", "行銷", "優惠券、滿額活動、會員等級"],
    ["reports", "報表", "營收與毛利報表（會看到成本）"],
    ["settings", "設定", "商店設定與外觀"],
  ];
  const PAGE_PERM = { orders: "orders", order: "orders", customers: "customers", customer: "customers", reports: "reports",
    products: "products", product: "products", categories: "products", reviews: "products",
    stock: "inventory", moves: "inventory", purchases: "inventory", purchase: "inventory", suppliers: "inventory", supplier: "inventory",
    coupons: "marketing", coupon: "marketing", promotions: "marketing", promotion: "marketing", tiers: "marketing",
    theme: "settings", settings: "settings", staff: "owner" };
  const can = p => DB.admin.can(p);
  const permName = k => (PERMS.find(x => x[0] === k) || [k, k])[1];
  function navHtml(link, c, poOpen) {
    const groups = [
      ["", [["admin", "dash", "總覽", "", true]]],
      ["銷售", [["admin/orders", "orders", "訂單", c.paid || "", can("orders")], ["admin/customers", "customers", "會員", "", can("customers")], ["admin/reports", "reports", "報表", "", can("reports")]]],
      ["商品", [["admin/products", "products", "商品", "", can("products")], ["admin/categories", "categories", "分類", "", can("products")], ["admin/reviews", "reviews", "評價", DB.reviews.pending() || "", can("products")]]],
      ["進銷存", DB.features.inventory ? [["admin/stock", "stock", "庫存", "", can("inventory")], ["admin/purchases", "purchases", "進貨單", poOpen || "", can("inventory")], ["admin/suppliers", "suppliers", "供應商", "", can("inventory")]] : []],
      ["行銷", [["admin/coupons", "coupons", "優惠券", "", can("marketing")], ["admin/promotions", "promotions", "滿額活動", "", can("marketing")], ["admin/tiers", "tiers", "會員等級", "", DB.features.tiers && can("marketing")]]],
      ["商店", [["admin/theme", "theme", "外觀", "", can("settings")], ["admin/settings", "settings", "設定", "", can("settings")], ["admin/staff", "staff", "員工", "", DB.features.staff && can("owner")]]],
    ];
    return groups.map(([title, items]) => {
      const shown = items.filter(x => x[4]);
      return shown.length ? (title ? `<div class="sep">${title}</div>` : "") + shown.map(x => link(x[0], x[1], x[2], x[3])).join("") : "";
    }).join("");
  }
  function noPerm(perm) {
    shell("", `<div class="page-head"><h1>沒有權限</h1></div>
      <div class="panel"><div class="empty">${perm === "owner" ? "這一頁只有店主可以使用。" : `你沒有「${esc(permName(perm))}」的權限，請找店主開通。`}
      <div style="margin-top:12px"><a class="btn" href="#admin">回總覽</a></div></div></div>`);
  }

  /* ---------- 版面外框 ---------- */
  function shell(active, content) {
    const st = DB.settings.get();
    const c = DB.orders.countByStatus();
    const pc = DB.purchases.countByStatus();
    const poOpen = pc.ordered + pc.partial; // 待入庫的進貨單
    const remote = DB.mode === "remote";
    const link = (href, key, label, badge) =>
      `<a href="#${href}" class="${active === key ? "is-on" : ""}">${label}${badge ? `<span class="badge">${badge}</span>` : ""}</a>`;
    root().innerHTML = `
      <div class="admin">
        <aside class="side">
          <div class="side-brand"><strong>${esc(st.name)}</strong><span>商家後台</span></div>
          <nav aria-label="後台選單">${navHtml(link, c, poOpen)}</nav>
          <div class="side-foot">
            ${remote ? `<a class="side-link" href="${esc(DB.admin.storeUrl(DB.admin.store().slug))}#shop" target="_blank" rel="noopener">查看我的商店 ↗</a>
            <a class="side-link" href="#admin/stores">我的商店${DB.admin.stores().length > 1 ? `（${DB.admin.stores().length}）` : ""}・開新店</a>
            ${DB.admin.isPlatform() ? `<a class="side-link" href="#platform">平台總控台</a>` : ""}` : ""}
            <div>${remote ? "v0.16 · 資料庫已連線" : "v0.16 · 離線示範版"}</div>
            ${DB.admin.user() ? `<div class="side-user">${esc(DB.admin.user().email)}${remote ? `<span class="small muted">・${DB.admin.me().role === "owner" ? "店主" : "員工"}</span>` : ""}</div>` : ""}
            ${remote ? `<button class="btn btn-sm btn-ghost" id="side-logout" type="button">登出</button>` : ""}
          </div>
        </aside>
        <main class="main" id="main">${remote ? window.Billing.banner(DB.admin.billing(), DB.admin.platformInfo(), active) : ""}${content}</main>
      </div>`;
    const out = document.getElementById("side-logout");
    if (out) out.addEventListener("click", async () => { await DB.admin.logout(); toast("已登出"); Router.go("admin"); });
  }




  /* ---------- 員工（只有店主） ---------- */
  const permBoxes = (prefix, on) => `<div class="perm-grid">${PERMS.map(([k, name, desc]) => `<label class="check perm-item"><input type="checkbox" class="${prefix}" value="${k}" ${on.includes(k) ? "checked" : ""}><span><b>${name}</b><span class="small muted">${desc}</span></span></label>`).join("")}</div>`;
  const picked = sel => [...document.querySelectorAll(sel + ":checked")].map(x => x.value);
  const permPills = perms => perms.map(p => `<span class="pill idle">${esc(permName(p))}</span>`).join(" ");
  async function viewStaff(justLink) {
    shell("staff", `<div class="page-head"><h1>員工</h1></div><div class="panel"><div class="empty">載入中…</div></div>`);
    let L;
    try { L = await DB.staff.list(); } catch (err) { document.getElementById("main").innerHTML = `<div class="panel"><div class="empty">${esc(err.message)}</div></div>`; return; }
    const main = document.getElementById("main");
    if (!main) return;
    main.innerHTML = `
      <div class="page-head"><h1>員工</h1></div>
      ${justLink ? `<div class="panel is-hl"><div class="panel-body">
        <b>邀請連結已建立</b>
        <div class="url-box"><span class="mono small" style="overflow-wrap:anywhere">${esc(justLink)}</span><button class="btn btn-sm" type="button" data-copy="${esc(justLink)}">複製連結</button></div>
        <p class="small muted" style="margin:0">把連結用 LINE 或 Email 傳給對方。對方打開連結、用<b>被邀請的 Email</b> 登入或註冊，就會加入這家店。連結 7 天內有效、只能用一次。</p>
      </div></div>` : ""}
      <section class="panel">
        <div class="panel-head"><h2>成員</h2><span class="small muted">${L.members.length} 人</span></div>
        <div class="table-wrap"><table class="tbl">
          <thead><tr><th>Email</th><th>身分</th><th>權限</th><th>加入日期</th><th></th></tr></thead>
          <tbody>${L.members.map(m => `<tr>
            <td>${esc(m.email)}${m.isMe ? ` <span class="small muted">（你）</span>` : ""}</td>
            <td>${m.role === "owner" ? `<span class="pill info">店主</span>` : `<span class="pill ok">員工</span>`}</td>
            <td style="white-space:normal">${m.role === "owner" ? `<span class="small muted">全部</span>` : permPills(m.perms)}</td>
            <td class="small">${date(m.createdAt)}</td>
            <td class="r">${m.role === "owner" ? "" : `<button class="btn btn-sm" type="button" data-edit="${m.userId}">改權限</button> <button class="btn btn-sm btn-ghost" type="button" data-remove="${m.userId}" data-email="${esc(m.email)}">移除</button>`}</td>
          </tr>
          ${m.role === "owner" ? "" : `<tr class="perm-edit" id="pe-${m.userId}" hidden><td colspan="5">${permBoxes("pe-" + m.userId, m.perms)}
            <div class="actions" style="margin-top:8px"><button class="btn btn-sm btn-primary" type="button" data-save="${m.userId}">儲存權限</button></div></td></tr>`}`).join("")}</tbody>
        </table></div>
      </section>
      ${L.invites.length ? `<section class="panel">
        <div class="panel-head"><h2>邀請中</h2></div>
        <div class="table-wrap"><table class="tbl">
          <thead><tr><th>Email</th><th>權限</th><th>期限</th><th></th></tr></thead>
          <tbody>${L.invites.map(v => `<tr>
            <td>${esc(v.email)}</td><td style="white-space:normal">${permPills(v.perms)}</td>
            <td class="small">${v.expired ? `<span class="pill bad">已過期</span>` : date(v.expiresAt)}</td>
            <td class="r">${v.expired ? "" : `<button class="btn btn-sm" type="button" data-copy="${esc(DB.staff.link(v.token))}">複製連結</button>`} <button class="btn btn-sm btn-ghost" type="button" data-cancel="${v.id}">取消</button></td>
          </tr>`).join("")}</tbody>
        </table></div>
      </section>` : ""}
      <section class="panel">
        <div class="panel-head"><h2>邀請員工</h2></div>
        <form class="panel-body" id="inv-form" novalidate>
          <div class="field"><label for="inv-email">員工的 Email</label><input type="email" id="inv-email" placeholder="例如 helper@example.com" autocomplete="off"><span class="hint">對方要用這個 Email 登入或註冊</span></div>
          <div class="field"><label>可以做哪些事</label>${permBoxes("inv-perm", ["orders"])}</div>
          <div><button class="btn btn-primary" type="submit">建立邀請連結</button></div>
          <p class="small muted" style="margin:0">員工看不到「員工」這一頁，也不能開新店或改方案。沒有「進銷存」或「報表」權限的人看不到成本。</p>
        </form>
      </section>`;
    main.querySelectorAll("[data-edit]").forEach(b => b.addEventListener("click", () => { const r = document.getElementById("pe-" + b.dataset.edit); r.hidden = !r.hidden; }));
    main.querySelectorAll("[data-save]").forEach(b => b.addEventListener("click", async () => {
      b.disabled = true;
      try { await DB.staff.update(b.dataset.save, picked(".pe-" + b.dataset.save)); toast("已更新權限"); viewStaff(); }
      catch (err) { toast(err.message, "error"); b.disabled = false; }
    }));
    main.querySelectorAll("[data-remove]").forEach(b => b.addEventListener("click", async () => {
      if (!(await confirmBox({ title: `移除 ${b.dataset.email}？`, body: "對方會馬上無法進入這家店的後台。之後要再加入需要重新邀請。", ok: "移除", danger: true }))) return;
      try { await DB.staff.remove(b.dataset.remove); toast("已移除"); viewStaff(); } catch (err) { toast(err.message, "error"); }
    }));
    main.querySelectorAll("[data-cancel]").forEach(b => b.addEventListener("click", async () => {
      try { await DB.staff.cancelInvite(b.dataset.cancel); toast("已取消邀請"); viewStaff(); } catch (err) { toast(err.message, "error"); }
    }));
    document.getElementById("inv-form").addEventListener("submit", async e => {
      e.preventDefault();
      const btn = e.target.querySelector("button[type=submit]"); btn.disabled = true;
      try { const r = await DB.staff.invite(document.getElementById("inv-email").value, picked(".inv-perm")); toast("已建立邀請連結"); viewStaff(r.link); window.scrollTo(0, 0); }
      catch (err) { toast(err.message, "error"); btn.disabled = false; }
    });
  }

  /* ---------- 打開員工邀請連結 #admin/join/<token> ---------- */
  const INVITE_KEY = "shopPlatform.pendingInvite";
  window.AdminPendingInvite = {
    get: () => { try { return localStorage.getItem(INVITE_KEY) || ""; } catch (e) { return ""; } },
    set: t => { try { t ? localStorage.setItem(INVITE_KEY, t) : localStorage.removeItem(INVITE_KEY); } catch (e) { /* 忽略 */ } },
  };
  window.AdminJoin = async function (token, st) {
    const wrap = inner => { root().innerHTML = `<div class="gate"><div class="gate-card is-wide">${inner}</div></div>`; };
    let info = null;
    try { info = await DB.admin.inviteInfo(token); } catch (err) { return wrap(`<h1>員工邀請</h1><div class="notice">${esc(err.message)}</div>`); }
    const done = msg => { window.AdminPendingInvite.set(""); wrap(`<h1>員工邀請</h1><div class="notice">${msg}</div><div class="actions"><a class="btn" href="#admin">到商家後台</a></div>`); };
    if (!info) return done("邀請連結不正確，請跟店主要一個新的連結。");
    if (info.accepted) return done("這個邀請已經用過了。如果是你本人加入的，直接登入後台就可以。");
    if (info.expired) return done("邀請已過期，請店主重新邀請。");
    window.AdminPendingInvite.set(token);   // 註冊、點確認信回來後還記得這個邀請
    const head = `<h1>加入「${esc(info.storeName)}」</h1>
      <p class="muted">店主邀請你成為員工，可以使用：${esc(info.perms.map(permName).join("、"))}</p>`;
    if (st.state === "login") {
      wrap(`${head}<div class="notice">請用被邀請的 Email（${esc(info.email)}）登入；還沒有帳號就先註冊，確認信點完會回到這裡。</div><div id="join-gate"></div>`);
      const box = document.getElementById("join-gate");
      window.AdminGate({ state: "login", side: "admin" }, ["admin"], box);
      return;
    }
    if (!info.emailMatches) {
      wrap(`${head}<div class="notice">你現在用 <b>${esc((DB.admin.user() || {}).email || "")}</b> 登入，但邀請是給 ${esc(info.email)} 的。請登出後用被邀請的 Email 登入。</div>
        <div class="actions"><button class="btn btn-primary" id="join-out" type="button">登出，換帳號</button></div>`);
      document.getElementById("join-out").addEventListener("click", async () => { await DB.admin.logout(); Router.render(); });
      return;
    }
    wrap(`${head}<div class="actions"><button class="btn btn-primary" id="join-go" type="button">加入</button><button class="btn btn-ghost" id="join-skip" type="button">先不要</button></div>`);
    document.getElementById("join-skip").addEventListener("click", () => { window.AdminPendingInvite.set(""); Router.go("admin"); });
    document.getElementById("join-go").addEventListener("click", async e => {
      e.target.disabled = true;
      try { const r = await DB.admin.acceptInvite(token); window.AdminPendingInvite.set(""); toast(`已加入「${r.name}」`); Router.go("admin"); }
      catch (err) { toast(err.message, "error"); e.target.disabled = false; }
    });
  };


  /* ---------- 商品評價 ---------- */
  let rvRating = "", rvPage = 0;
  const rvStars = n => `<span class="rv-stars" role="img" aria-label="${n} 顆星">${"★".repeat(n)}<span>${"★".repeat(5 - n)}</span></span>`;
  const RV_PILL = { visible: ["ok", "公開中"], pending: ["warn", "待審核"], hidden: ["idle", "已隱藏"] };
  async function viewReviews(status) {
    status = status || "";
    const cfg = DB.reviews.settings();
    shell("reviews", `<div class="page-head"><h1>評價</h1></div><div class="panel"><div class="empty">載入中…</div></div>`);
    let L;
    try { L = await DB.reviews.list({ status, rating: rvRating || null }, { offset: rvPage * 50, limit: 50 }); }
    catch (err) { document.getElementById("main").innerHTML = `<div class="panel"><div class="empty">${esc(err.message)}</div></div>`; return; }
    const main = document.getElementById("main"); if (!main) return;
    const C = L.counts;
    const tab = (k, t, n) => `<a href="#admin/reviews${k ? "/" + k : ""}" class="${status === k ? "is-on" : ""}">${t}<span class="n">${n}</span></a>`;
    main.innerHTML = `
      <div class="page-head"><h1>評價</h1>${C.avg != null ? `<span class="muted">公開評價平均 <b class="num">${(+C.avg).toFixed(1)}</b> 顆星</span>` : ""}</div>
      ${can("settings") ? `<section class="panel"><div class="panel-body rv-set">
        <label class="check"><input type="checkbox" id="rv-on" ${cfg.enabled ? "checked" : ""}> 開放顧客評價（買過、已出貨的會員才能評）</label>
        <label class="check"><input type="checkbox" id="rv-review" ${cfg.autoPublish ? "" : "checked"}> 新評價要我先確認才公開</label>
        <button class="btn btn-sm" type="button" id="rv-save-set">儲存設定</button>
      </div></section>` : ""}
      <section class="panel">
        <nav class="tabs" aria-label="評價狀態">${tab("", "全部", C.all)}${tab("pending", "待審核", C.pending)}${tab("visible", "公開中", C.visible)}${tab("hidden", "已隱藏", C.hidden)}</nav>
        <div class="panel-head"><div class="toolbar"><select id="rv-rating" aria-label="星等"><option value="">全部星等</option>${[5, 4, 3, 2, 1].map(n => `<option value="${n}" ${String(rvRating) === String(n) ? "selected" : ""}>${n} 顆星</option>`).join("")}</select></div></div>
        ${L.rows.length ? `<ul class="rv-admin">${L.rows.map(r => `<li data-id="${r.id}">
          <div class="rv-a-head">${rvStars(r.rating)}<span class="pill ${RV_PILL[r.status][0]}">${RV_PILL[r.status][1]}</span>
            ${DB.products.get(r.productId) ? `<a href="#admin/product/${r.productId}">${esc(r.productName)}</a>` : esc(r.productName || "（商品已刪除）")}
            <span class="small muted">${esc(r.customerName || r.name)}・${can("orders") ? `<a href="#admin/order/${esc(r.orderNumber)}">${esc(r.orderNumber)}</a>` : esc(r.orderNumber)}・${date(r.createdAt, true)}${r.updatedAt && r.updatedAt !== r.createdAt ? "（修改過）" : ""}</span></div>
          ${r.content ? `<p class="rv-a-text">${esc(r.content)}</p>` : `<p class="rv-a-text muted small">（只給星等）</p>`}
          <div class="rv-a-reply">
            <textarea rows="2" maxlength="500" placeholder="回覆會公開在商品頁（選填）" aria-label="回覆">${esc(r.reply || "")}</textarea>
            <div class="actions"><button class="btn btn-sm" type="button" data-act="reply">${r.reply ? "更新回覆" : "回覆"}</button>
              ${r.status === "visible" ? `<button class="btn btn-sm btn-ghost" type="button" data-act="hidden">隱藏</button>` : `<button class="btn btn-sm btn-primary" type="button" data-act="visible">${r.status === "pending" ? "通過並公開" : "重新公開"}</button>`}</div>
          </div>
        </li>`).join("")}</ul>` : `<div class="empty">${status === "pending" ? "沒有待審核的評價" : "還沒有評價"}</div>`}
        <div id="rv-pager">${pager(L.total, rvPage, 50)}</div>
      </section>`;
    document.getElementById("rv-rating").addEventListener("change", e => { rvRating = e.target.value; rvPage = 0; viewReviews(status); });
    document.getElementById("rv-pager").addEventListener("click", e => { const b = e.target.closest("[data-page]"); if (b) { rvPage = +b.dataset.page; viewReviews(status); } });
    main.querySelectorAll(".rv-admin [data-act]").forEach(b => b.addEventListener("click", async () => {
      const li = b.closest("li"), id = li.dataset.id, act = b.dataset.act;
      b.disabled = true;
      try {
        if (act === "reply") { await DB.reviews.reply(id, li.querySelector("textarea").value); toast("已儲存回覆"); b.disabled = false; b.textContent = li.querySelector("textarea").value.trim() ? "更新回覆" : "回覆"; }
        else { await DB.reviews.setStatus(id, act); toast(act === "visible" ? "已公開" : "已隱藏"); viewReviews(status); }
      } catch (err) { toast(err.message, "error"); b.disabled = false; }
    }));
    const ss = document.getElementById("rv-save-set");
    if (ss) ss.addEventListener("click", async () => {
      ss.disabled = true;
      try { await DB.settings.update({ reviews: { enabled: document.getElementById("rv-on").checked, autoPublish: !document.getElementById("rv-review").checked } }); toast("已儲存評價設定"); ss.disabled = false; }
      catch (err) { toast(err.message, "error"); ss.disabled = false; }
    });
  }

  /* ---------- 外觀（佈景主題） ---------- */
  function viewTheme() {
    const T = window.Theme, st = DB.settings.get();
    const t = T.normalize(st.theme);
    const sample = DB.products.list({ status: "active" }).slice(0, 4);
    const radio = (name, val, label, extra) => `<label class="opt-card ${String(t[name]) === String(val) ? "is-on" : ""}"><input type="radio" name="th-${name}" value="${val}" ${String(t[name]) === String(val) ? "checked" : ""}>${label}${extra || ""}</label>`;
    shell("theme", `
      <div class="page-head"><h1>外觀</h1><div class="actions">
        ${DB.mode === "remote" ? `<a class="btn" href="${esc(DB.admin.storeUrl(DB.admin.store().slug))}#shop" target="_blank" rel="noopener">看前台 ↗</a>` : `<a class="btn" href="#shop">看前台</a>`}
        <button class="btn btn-primary" id="th-save" type="button">儲存外觀</button></div></div>
      <div class="th-layout">
        <div class="th-form">
          <section class="panel"><div class="panel-head"><h2>配色</h2></div><div class="panel-body">
            <div class="opt-grid">${Object.entries(T.PRESETS).map(([k, p]) => radio("preset", k, `<span class="sw">${[p.light.bg, p.light.accent, p.light.soft].map(c => `<i style="background:${c}"></i>`).join("")}</span><b>${p.name}</b>`)).join("")}</div>
            <label class="check"><input type="checkbox" id="th-custom" ${t.accent ? "checked" : ""}> 自訂主色（按鈕、連結、橫幅的顏色）</label>
            <div class="th-accent" ${t.accent ? "" : "hidden"}><input type="color" id="th-accent" value="${t.accent || T.PRESETS[t.preset].light.accent}" aria-label="主色"><span class="mono small" id="th-accent-hex"></span><span class="small" id="th-contrast" role="status"></span></div>
            <p class="small muted" style="margin:0">深色模式會自動換成同色系、比較亮的版本，按鈕上的字會自動選白色或黑色。</p>
          </div></section>
          <section class="panel"><div class="panel-head"><h2>Logo</h2></div><div class="panel-body">
            <div class="th-logo"><div class="th-logo-box" id="th-logo-box"></div>
              <div class="actions"><label class="btn btn-sm" for="th-logo-file">上傳 Logo</label><input type="file" id="th-logo-file" accept="image/png,image/jpeg,image/webp" hidden>
              <button class="btn btn-sm btn-ghost" type="button" id="th-logo-del">移除</button></div></div>
            <p class="small muted" style="margin:0">建議用橫式、透明背景的 PNG。前台會縮成 40px 高；沒有 Logo 就顯示店名。</p>
          </div></section>
          <section class="panel"><div class="panel-head"><h2>首頁版型</h2></div><div class="panel-body">
            <div class="opt-grid is-3">${T.LAYOUTS.map(([k, name, desc]) => radio("layout", k, `<span class="mini mini-${k}" aria-hidden="true"><i></i><i></i><i></i><i></i></span><b>${name}</b><span class="small muted">${desc}</span>`)).join("")}</div>
            <div class="grid-form">
              <div class="field"><label for="th-title">首頁標題</label><input type="text" id="th-title" maxlength="40" value="${esc(t.heroTitle)}" placeholder="${esc(st.name)}"><span class="hint">留空就用店名</span></div>
              <div class="field"><label for="th-text">首頁說明</label><input type="text" id="th-text" maxlength="120" value="${esc(t.heroText)}" placeholder="${esc(st.tagline || "一句話介紹你的店")}"><span class="hint">留空就用「一句話介紹」</span></div>
            </div>
          </div></section>
          <section class="panel"><div class="panel-head"><h2>商品排列與字體</h2></div><div class="panel-body">
            <div class="th-row"><span class="small muted">每列商品（電腦）</span><div class="seg">${[2, 3, 4].map(n => `<button type="button" data-cols="${n}" class="${t.cols === n ? "is-on" : ""}" aria-pressed="${t.cols === n}">${n} 個</button>`).join("")}</div></div>
            <div class="th-row"><span class="small muted">商品圖片比例</span><div class="seg"><button type="button" data-ratio="square" class="${t.ratio === "square" ? "is-on" : ""}">方形 1:1</button><button type="button" data-ratio="portrait" class="${t.ratio === "portrait" ? "is-on" : ""}">直式 4:5</button></div></div>
            <div class="th-row"><span class="small muted">字體</span><div class="seg"><button type="button" data-font="sans" class="${t.font === "sans" ? "is-on" : ""}">黑體（俐落）</button><button type="button" data-font="serif" class="${t.font === "serif" ? "is-on" : ""}" style="font-family:'Noto Serif TC',serif">明體（典雅）</button></div></div>
            <div class="field"><label for="th-notice">最上方公告列（選填）</label><input type="text" id="th-notice" maxlength="80" value="${esc(t.notice)}" placeholder="例如：週年慶全館 9 折，到 10/31"><span class="hint">會跟滿額活動、免運門檻一起顯示</span></div>
          </div></section>
        </div>
        <div class="th-side"><div class="th-sticky">
          <div class="small muted">預覽（跟著電腦的淺色／深色模式）</div>
          <div class="th-preview" id="th-preview"></div>
        </div></div>
      </div>`);
    const $ = id => document.getElementById(id);
    const cur = () => Object.assign({}, t, {
      preset: (document.querySelector('input[name="th-preset"]:checked') || {}).value || t.preset,
      layout: (document.querySelector('input[name="th-layout"]:checked') || {}).value || t.layout,
      accent: $("th-custom").checked ? $("th-accent").value : "",
      heroTitle: $("th-title").value.trim(), heroText: $("th-text").value.trim(), notice: $("th-notice").value.trim(),
    });
    const draw = () => {
      const v = cur(), a = T.attrs(v); T.useFont(v);
      document.querySelectorAll(".opt-card").forEach(l => l.classList.toggle("is-on", l.querySelector("input").checked));
      $("th-accent-hex").textContent = v.accent;
      if (v.accent) {
        const c = T.check(v);
        $("th-contrast").textContent = c.ok ? `對比 ${c.ratio.toFixed(1)}：清楚` : c.weak ? `對比 ${c.ratio.toFixed(1)}：偏淡，連結文字可能不好讀` : `對比 ${c.ratio.toFixed(1)}：太淡，連結和按鈕會看不清楚，建議選深一點`;
        $("th-contrast").className = "small " + (c.ok ? "is-ok" : "is-bad");
      }
      $("th-logo-box").innerHTML = v.logo ? `<img src="${esc(v.logo.url)}" alt="目前的 Logo">` : `<span class="small muted">還沒有 Logo</span>`;
      $("th-logo-del").hidden = !v.logo;
      const cards = (sample.length ? sample : [{ name: "商品", color: "#b7a38b", variants: [{ price: 0 }] }]).slice(0, v.layout === "magazine" ? 4 : 3);
      const imgOf = p => { const src = p.id ? DB.products.cover(p) : ""; return `<div class="s-img ${src ? "has-photo" : ""}" style="${src ? "" : `background:${esc(p.color)}`}">${src ? `<img src="${esc(src)}" alt="">` : esc(p.name.slice(0, 1))}</div>`; };
      const card = p => `<div class="s-card">${imgOf(p)}<span class="s-name">${esc(p.name)}</span></div>`;
      const title = esc(v.heroTitle || st.name), text = esc(v.heroText || st.tagline || "");
      $("th-preview").innerHTML = `<div class="shop ${a.cls}" style="${a.style}">
        ${v.notice ? `<div class="s-bar">${esc(v.notice)}</div>` : ""}
        <header class="s-head"><div class="s-wrap">${v.logo ? `<span class="s-logo has-img"><img src="${esc(v.logo.url)}" alt=""></span>` : `<span class="s-logo">${esc(st.name)}</span>`}<span class="s-cart">購物車 <b>1</b></span></div></header>
        ${v.layout === "banner" ? `<section class="s-banner"><div class="s-wrap"><h1>${title}</h1>${text ? `<p>${text}</p>` : ""}<span class="btn">逛逛商品</span></div></section>`
          : `<div class="s-wrap"><section class="s-hero"><h1>${title}</h1><p>${text}</p></section></div>`}
        <div class="s-wrap">
          ${v.layout === "magazine" ? `<div class="s-feature">${imgOf(cards[0])}<div><span class="s-kicker">本週主打</span><h2>${esc(cards[0].name)}</h2><span class="btn btn-primary">看商品</span></div></div>` : ""}
          <div class="s-grid">${(v.layout === "magazine" ? cards.slice(1) : cards).map(card).join("")}</div>
        </div></div>`;
    };
    draw();
    document.querySelectorAll('input[name="th-preset"]').forEach(r => r.addEventListener("change", () => { if (!$("th-custom").checked) $("th-accent").value = T.PRESETS[r.value].light.accent; draw(); }));
    document.querySelectorAll('input[name="th-layout"]').forEach(r => r.addEventListener("change", draw));
    $("th-custom").addEventListener("change", () => { document.querySelector(".th-accent").hidden = !$("th-custom").checked; draw(); });
    ["th-accent", "th-title", "th-text", "th-notice"].forEach(id => $(id).addEventListener("input", draw));
    const seg = (attr, key, conv) => document.querySelectorAll(`[data-${attr}]`).forEach(b => b.addEventListener("click", () => {
      t[key] = conv(b.dataset[attr]);
      document.querySelectorAll(`[data-${attr}]`).forEach(x => { x.classList.toggle("is-on", x === b); x.setAttribute("aria-pressed", x === b); });
      draw();
    }));
    seg("cols", "cols", Number); seg("ratio", "ratio", String); seg("font", "font", String);
    $("th-logo-file").addEventListener("change", async e => {
      const f = e.target.files[0]; if (!f) return;
      const lbl = document.querySelector('label[for="th-logo-file"]'); lbl.textContent = "上傳中…";
      try { t.logo = await DB.media.prepareLogo(f); draw(); toast("Logo 已上傳，記得按「儲存外觀」"); }
      catch (err) { toast(err.message, "error"); }
      lbl.textContent = "上傳 Logo"; e.target.value = "";
    });
    $("th-logo-del").addEventListener("click", () => { t.logo = null; draw(); });
    $("th-save").addEventListener("click", async e => {
      const v = cur();
      const c = v.accent ? T.check(v) : { ok: true, weak: false };
      if (!c.ok && !c.weak && !(await confirmBox({ title: "主色太淡", body: "這個顏色在白底上很難看清楚，顧客可能看不到按鈕和連結。確定要用嗎？", ok: "還是要用" }))) return;
      e.target.disabled = true;
      try { await DB.settings.update({ theme: v }); toast("已儲存外觀"); viewTheme(); }
      catch (err) { toast(err.message, "error"); e.target.disabled = false; }
    });
  }

  /* ---------- 報表（銷售、毛利、熱銷、進貨） ---------- */
  const pad2 = n => String(n).padStart(2, "0");
  const ymdOf = d => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const RANGES = [["7d", "近 7 天"], ["30d", "近 30 天"], ["month", "本月"], ["lastmonth", "上個月"], ["90d", "近 90 天"], ["year", "今年"], ["custom", "自訂"]];
  let rRange = "30d", rFrom = "", rTo = "";
  function rangeDates(k) {
    const t = new Date(); t.setHours(0, 0, 0, 0);
    const back = n => { const d = new Date(t); d.setDate(d.getDate() - n); return d; };
    switch (k) {
      case "7d": return [ymdOf(back(6)), ymdOf(t)];
      case "90d": return [ymdOf(back(89)), ymdOf(t)];
      case "month": return [ymdOf(new Date(t.getFullYear(), t.getMonth(), 1)), ymdOf(t)];
      case "lastmonth": return [ymdOf(new Date(t.getFullYear(), t.getMonth() - 1, 1)), ymdOf(new Date(t.getFullYear(), t.getMonth(), 0))];
      case "year": return [ymdOf(new Date(t.getFullYear(), 0, 1)), ymdOf(t)];
      case "custom": return [rFrom || ymdOf(back(29)), rTo || ymdOf(t)];
      default: return [ymdOf(back(29)), ymdOf(t)];
    }
  }
  const pct = (a, b) => (b ? (a / b * 100).toFixed(1) + "%" : "—");
  const slash = d => String(d).replace(/-/g, "/");

  async function viewReports() {
    const [from, to] = rangeDates(rRange);
    shell("reports", `
      <div class="page-head"><h1>報表</h1><div class="actions"><button class="btn" id="rp-export" type="button" disabled>匯出 Excel</button></div></div>
      <div class="rp-bar">
        <div class="seg" role="group" aria-label="期間">${RANGES.map(([k, t]) => `<button type="button" class="${rRange === k ? "is-on" : ""}" data-range="${k}" aria-pressed="${rRange === k}">${t}</button>`).join("")}</div>
        <div class="rp-dates" ${rRange === "custom" ? "" : "hidden"}><input type="date" id="rp-from" value="${from}" aria-label="開始日期"><span class="muted">～</span><input type="date" id="rp-to" value="${to}" aria-label="結束日期"><button class="btn btn-sm" id="rp-go" type="button">查詢</button></div>
        <span class="small muted">${slash(from)} ～ ${slash(to)}・營收只算已付款的訂單</span>
      </div>
      <div id="rp-body"><div class="panel"><div class="empty">計算中…</div></div></div>`);
    document.querySelectorAll("[data-range]").forEach(b => b.addEventListener("click", () => {
      if (b.dataset.range === "custom") { const [f, t] = rangeDates(rRange); rFrom = f; rTo = t; }
      rRange = b.dataset.range; viewReports();
    }));
    const go = document.getElementById("rp-go");
    if (go) go.addEventListener("click", () => { rFrom = document.getElementById("rp-from").value; rTo = document.getElementById("rp-to").value; viewReports(); });
    let R;
    try { R = await DB.reports.get(from, to); }
    catch (err) { const el = document.getElementById("rp-body"); if (el) el.innerHTML = `<div class="panel"><div class="empty">${esc(err.message)}</div></div>`; return; }
    const body = document.getElementById("rp-body");
    if (!body) return;
    const S = R.summary, net = S.goods - S.discount;
    const unitLabel = R.unit === "day" ? "每日" : "每月";
    const small = (title, rows, cols) => `<section class="panel"><div class="panel-head"><h2>${title}</h2></div>${rows.length ? `<div class="table-wrap"><table class="tbl">
      <thead><tr>${cols.map(c => `<th class="${c[2] || ""}">${c[0]}</th>`).join("")}</tr></thead>
      <tbody>${rows.map(r => `<tr>${cols.map(c => `<td class="${c[2] || ""}">${c[1](r)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>` : `<div class="empty">這段期間沒有資料</div>`}</section>`;
    body.innerHTML = `
      <div class="kpis">
        <div class="kpi"><span>營收（已付款）</span><strong>${money(S.revenue)}</strong><small>${S.orders} 筆訂單・${S.units} 件${R.refunds && R.refunds.amount ? `・退款 ${money(R.refunds.amount)}` : ""}</small></div>
        <div class="kpi"><span>毛利${R.refunds && R.refunds.amount ? "（扣退款）" : ""}</span><strong>${money(S.gross - ((R.refunds || {}).amount || 0) + ((R.refunds || {}).restockedCost || 0))}</strong><small>毛利率 ${pct(S.gross - ((R.refunds || {}).amount || 0) + ((R.refunds || {}).restockedCost || 0), net - ((R.refunds || {}).amount || 0))}</small></div>
        <div class="kpi"><span>平均客單</span><strong>${money(S.orders ? S.revenue / S.orders : 0)}</strong><small>含運費</small></div>
        <div class="kpi"><span>購買顧客</span><strong>${S.customers}</strong><small>新客 ${S.newCustomers}・回購 ${S.customers - S.newCustomers}</small></div>
      </div>
      <div class="grid-2">
        <section class="panel">
          <div class="panel-head"><h2>${unitLabel}營收</h2><span class="small muted">移到長條上看明細</span></div>
          <div class="panel-body rp-chart-wrap">${reportChart(R.series, R.unit)}</div>
        </section>
        <section class="panel">
          <div class="panel-head"><h2>金額怎麼來的</h2></div>
          <div class="panel-body"><dl class="calc">
            <dt>商品金額</dt><dd>${money(S.goods)}</dd>
            <dt>− 折扣</dt><dd>${money(S.discount)}</dd>
            <dt>− 商品成本</dt><dd>${money(S.cost)}</dd>
            <dt class="is-total">＝ 毛利</dt><dd class="is-total">${money(S.gross)}</dd>
            <dt>＋ 運費收入</dt><dd>${money(S.shipping)}</dd>
            <dt class="is-total">營收</dt><dd class="is-total">${money(S.revenue)}</dd>
            ${R.refunds && R.refunds.amount ? `<dt>− 退款（${R.refunds.count} 筆）</dt><dd>${money(R.refunds.amount)}</dd>
            <dt class="is-total">實收</dt><dd class="is-total">${money(S.revenue - R.refunds.amount)}</dd>` : ""}
          </dl>
          <p class="small muted" style="margin:0">成本用下單當時的平均成本。另外：待付款 ${R.pending.orders} 筆（${money(R.pending.amount)}）、已取消 ${R.cancelled.orders} 筆（${money(R.cancelled.amount)}），不算進營收。</p></div>
        </section>
      </div>
      <section class="panel">
        <div class="panel-head"><h2>熱銷商品</h2><span class="small muted">依銷售額；毛利未扣整筆訂單的折扣</span></div>
        ${R.products.length ? `<div class="table-wrap"><table class="tbl">
          <thead><tr><th>#</th><th>商品</th><th class="r">件數</th><th class="r">訂單數</th><th class="r">銷售額</th><th class="r">成本</th><th class="r">毛利</th><th class="r">毛利率</th><th>占營業額</th></tr></thead>
          <tbody>${R.products.slice(0, 20).map((x, i) => `<tr ${DB.products.get(x.productId) ? `class="is-link" data-href="admin/product/${x.productId}"` : ""}>
            <td class="num muted">${i + 1}</td><td>${esc(x.name)}</td><td class="r num">${x.qty}</td><td class="r num">${x.orders}</td><td class="r num">${money(x.sales)}</td>
            <td class="r num">${money(x.cost)}</td><td class="r num">${money(x.sales - x.cost)}</td><td class="r num">${pct(x.sales - x.cost, x.sales)}</td>
            <td><div class="share" role="img" aria-label="${pct(x.sales, S.goods)}"><i style="width:${S.goods ? Math.max(1, x.sales / S.goods * 100) : 0}%"></i></div></td></tr>`).join("")}</tbody>
        </table></div>` : `<div class="empty">這段期間沒有已付款的訂單</div>`}
      </section>
      <div class="grid-3">
        ${small("熱銷規格", R.variants.slice(0, 10), [["規格", r => `${esc(r.name)}<div class="small muted">${esc(r.optionText || "單一規格")}${r.sku ? ` · ${esc(r.sku)}` : ""}</div>`], ["件數", r => r.qty, "r num"]])}
        ${small("付款方式", R.payments, [["方式", r => esc(r.name)], ["訂單", r => r.orders, "r num"], ["金額", r => money(r.amount), "r num"]])}
        ${small("取貨方式", R.shippings, [["方式", r => esc(r.name)], ["訂單", r => r.orders, "r num"], ["運費", r => money(r.amount), "r num"]])}
      </div>
      <div class="grid-2">
        ${small("折扣來源", R.discounts, [["來源", r => esc(r.label)], ["訂單", r => r.orders, "r num"], ["折扣", r => money(r.amount), "r num"]])}
        <section class="panel"><div class="panel-head"><h2>進貨花費</h2><a class="small" href="#admin/purchases">進貨單</a></div>
          <div class="panel-body"><div class="rp-big">${money(R.purchases.amount)}<span class="small muted">　入庫 ${R.purchases.units} 件</span></div>
          ${R.purchases.bySupplier.length ? `<table class="tbl"><tbody>${R.purchases.bySupplier.map(x => `<tr><td>${esc(x.name || "（未指定供應商）")}</td><td class="r num">${x.units} 件</td><td class="r num">${money(x.amount)}</td></tr>`).join("")}</tbody></table>` : `<div class="small muted">這段期間沒有入庫</div>`}</div>
        </section>
      </div>
      <details class="panel rp-detail"><summary class="panel-head"><h2>${unitLabel}明細表</h2></summary>
        <div class="table-wrap"><table class="tbl"><thead><tr><th>${R.unit === "day" ? "日期" : "月份"}</th><th class="r">訂單</th><th class="r">營收</th><th class="r">毛利</th></tr></thead>
        <tbody>${R.series.slice().reverse().map(x => `<tr><td class="num">${R.unit === "day" ? slash(x.date) : slash(x.date).slice(0, 7)}</td><td class="r num">${x.orders}</td><td class="r num">${money(x.revenue)}</td><td class="r num">${money(x.gross)}</td></tr>`).join("")}</tbody></table></div>
      </details>`;
    bindChartHover(body.querySelector(".rp-chart-wrap"), R.series, R.unit);
    const ex = document.getElementById("rp-export");
    ex.disabled = false;
    ex.addEventListener("click", () => exportReport(R));
  }

  // 營收長條圖：單一數列（標題說明是什麼），滑過去顯示營收、訂單、毛利
  function reportChart(series, unit) {
    const W = 640, H = 200, padL = 48, padB = 24, padT = 12;
    const max = Math.max(1000, ...series.map(d => d.revenue));
    const step = niceStep(max / 4), top = Math.ceil(max / step) * step;
    const bw = (W - padL) / Math.max(series.length, 1);
    const y = v => H - padB - (v / top) * (H - padB - padT);
    let g = "";
    for (let v = 0; v <= top; v += step) g += `<line class="grid" x1="${padL}" x2="${W}" y1="${y(v)}" y2="${y(v)}"/><text x="${padL - 6}" y="${y(v) + 3}" text-anchor="end">${v >= 1000 ? v / 1000 + "k" : v}</text>`;
    const every = Math.ceil(series.length / 8);
    series.forEach((d, i) => {
      const x = padL + i * bw + bw * 0.15, w = Math.max(bw * 0.7, 1);
      const h = d.revenue ? Math.max(2, H - padB - y(d.revenue)) : 0;
      if (h) g += `<path class="bar" d="M${x},${H - padB} v${-(h - Math.min(4, h, w / 2))} q0,${-Math.min(4, h, w / 2)} ${Math.min(4, h, w / 2)},${-Math.min(4, h, w / 2)} h${w - 2 * Math.min(4, h, w / 2)} q${Math.min(4, h, w / 2)},0 ${Math.min(4, h, w / 2)},${Math.min(4, h, w / 2)} v${h - Math.min(4, h, w / 2)} z"/>`;
      g += `<rect class="hit" x="${padL + i * bw}" y="${padT}" width="${bw}" height="${H - padB - padT}" data-i="${i}"/>`;
      if (i % every === 0) { const [yy, mm, dd] = d.date.split("-"); g += `<text x="${x + w / 2}" y="${H - 7}" text-anchor="middle">${unit === "day" ? `${+mm}/${+dd}` : `${yy.slice(2)}/${+mm}`}</text>`; }
    });
    return `<svg class="chart rp-chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${unit === "day" ? "每日" : "每月"}營收長條圖，明細請看下方明細表">${g}</svg><div class="rp-tip" hidden></div>`;
  }
  function bindChartHover(wrap, series, unit) {
    if (!wrap) return;
    const tip = wrap.querySelector(".rp-tip"), svg = wrap.querySelector("svg");
    const show = el => {
      const d = series[+el.dataset.i]; if (!d) return;
      svg.querySelectorAll(".hit.is-on").forEach(x => x.classList.remove("is-on")); el.classList.add("is-on");
      tip.innerHTML = `<b>${unit === "day" ? slash(d.date) : slash(d.date).slice(0, 7)}</b><span>營收 ${money(d.revenue)}</span><span>毛利 ${money(d.gross)}</span><span>${d.orders} 筆訂單</span>`;
      tip.hidden = false;
      const r = el.getBoundingClientRect(), w = wrap.getBoundingClientRect();
      tip.style.left = Math.min(Math.max(r.left - w.left + r.width / 2, 70), w.width - 70) + "px";
    };
    svg.addEventListener("mousemove", e => { const el = e.target.closest(".hit"); if (el) show(el); });
    svg.addEventListener("click", e => { const el = e.target.closest(".hit"); if (el) show(el); });
    svg.addEventListener("mouseleave", () => { tip.hidden = true; svg.querySelectorAll(".hit.is-on").forEach(x => x.classList.remove("is-on")); });
  }
  function exportReport(R) {
    const S = R.summary, n = { type: "number" };
    const sheets = [
      { name: "摘要", columns: [{ header: "項目", width: 16 }, Object.assign({ header: "數值", width: 14 }, n)], rows: [
        ["期間", `${R.from} ～ ${R.to}`], ["營收（已付款）", S.revenue], ["訂單數", S.orders], ["件數", S.units], ["商品金額", S.goods], ["折扣", S.discount],
        ["商品成本", S.cost], ["毛利", S.gross], ["運費收入", S.shipping], ["購買顧客", S.customers], ["新客", S.newCustomers],
        ["待付款筆數", R.pending.orders], ["待付款金額", R.pending.amount], ["取消筆數", R.cancelled.orders], ["取消金額", R.cancelled.amount],
        ["退款筆數", (R.refunds || {}).count || 0], ["退款金額", (R.refunds || {}).amount || 0], ["退貨加回的成本", (R.refunds || {}).restockedCost || 0],
        ["進貨件數", R.purchases.units], ["進貨花費", R.purchases.amount]] },
      { name: R.unit === "day" ? "每日" : "每月", columns: [{ header: R.unit === "day" ? "日期" : "月份", width: 12 }, Object.assign({ header: "訂單" }, n), Object.assign({ header: "營收" }, n), Object.assign({ header: "毛利" }, n)],
        rows: R.series.map(x => [R.unit === "day" ? x.date : x.date.slice(0, 7), x.orders, x.revenue, x.gross]) },
      { name: "商品", columns: [{ header: "商品", width: 24 }, Object.assign({ header: "件數" }, n), Object.assign({ header: "訂單數" }, n), Object.assign({ header: "銷售額" }, n), Object.assign({ header: "成本" }, n), Object.assign({ header: "毛利" }, n)],
        rows: R.products.map(x => [x.name, x.qty, x.orders, x.sales, x.cost, x.sales - x.cost]) },
      { name: "規格", columns: [{ header: "商品", width: 24 }, { header: "規格", width: 14 }, { header: "SKU", width: 14 }, Object.assign({ header: "件數" }, n), Object.assign({ header: "銷售額" }, n)],
        rows: R.variants.map(x => [x.name, x.optionText || "單一規格", x.sku || "", x.qty, x.sales]) },
      { name: "付款與折扣", columns: [{ header: "類別", width: 10 }, { header: "名稱", width: 22 }, Object.assign({ header: "訂單" }, n), Object.assign({ header: "金額" }, n)],
        rows: [...R.payments.map(x => ["付款方式", x.name, x.orders, x.amount]), ...R.shippings.map(x => ["取貨方式（運費）", x.name, x.orders, x.amount]), ...R.discounts.map(x => ["折扣", x.label, x.orders, x.amount])] },
      { name: "進貨", columns: [{ header: "供應商", width: 22 }, Object.assign({ header: "件數" }, n), Object.assign({ header: "金額" }, n)],
        rows: R.purchases.bySupplier.map(x => [x.name || "（未指定）", x.units, x.amount]) },
    ];
    download(XLSX.build(sheets), `報表_${R.from}_${R.to}.xlsx`);
    toast("已匯出報表");
  }

  /* ---------- 商店網址、方案（資料庫版） ---------- */
  function storeUrlBox() {
    const url = DB.admin.storeUrl(DB.admin.store().slug);
    return `<div class="url-box"><span class="small muted">你的商店網址</span>
      <a class="mono" href="${esc(url)}" target="_blank" rel="noopener">${esc(url)}</a>
      <button class="btn btn-sm" type="button" data-copy="${esc(url)}">複製</button></div>`;
  }
  function planPanel() {
    const b = DB.admin.billing(), pf = DB.admin.platformInfo(), B = window.Billing;
    if (!b) return "";
    return `<section class="panel">
      <div class="panel-head"><h2>方案與年費</h2>${B.pill(b)}</div>
      <div class="panel-body">
        <div>${esc(B.line(b))}</div>
        ${b.plan !== "free" ? `<div class="small muted">年費 ${money(pf.annualFee || 0)}／年，平台不抽成。${b.status === "trial" ? "試用期間功能全開；" : ""}要繳費或續約請聯絡平台${pf.contactEmail ? `：<a href="mailto:${esc(pf.contactEmail)}">${esc(pf.contactEmail)}</a>` : ""}${pf.contactLine ? `（LINE：${esc(pf.contactLine)}）` : ""}。</div>` : ""}
        ${storeUrlBox()}
      </div>
    </section>`;
  }
  document.addEventListener("click", async e => {
    const b = e.target.closest("[data-copy]");
    if (!b) return;
    try { await navigator.clipboard.writeText(b.dataset.copy); toast("已複製"); } catch (err) { toast("請手動選取網址複製", "error"); }
  });

  /* ---------- 我的商店、開新店 ---------- */
  function viewStores() {
    const list = DB.admin.stores(), cur = DB.admin.store(), B = window.Billing;
    shell("", `
      <div class="page-head"><h1>我的商店</h1></div>
      <section class="panel">
        <div class="table-wrap"><table class="tbl">
          <thead><tr><th>商店</th><th>網址代號</th><th>身分</th><th>方案</th><th>到期</th><th></th></tr></thead>
          <tbody>${list.map(x => `<tr>
            <td><b>${esc(x.name)}</b>${x.id === cur.id ? ` <span class="pill info">目前</span>` : ""}</td>
            <td class="mono">${esc(x.slug)}</td>
            <td class="small">${x.role === "owner" ? "店主" : "員工"}</td>
            <td>${B.pill(x.billing)}</td>
            <td class="small">${esc(B.short(x.billing))}</td>
            <td class="r">${x.id === cur.id ? "" : `<button class="btn btn-sm" data-use="${esc(x.slug)}">切換到這家</button>`}
              <a class="btn btn-sm btn-ghost" href="${esc(DB.admin.storeUrl(x.slug))}#shop" target="_blank" rel="noopener">看前台 ↗</a>
              ${x.id === cur.id && x.role === "staff" ? `<button class="btn btn-sm btn-ghost" type="button" id="st-leave">離開這家店</button>` : ""}</td>
          </tr>`).join("")}</tbody>
        </table></div>
      </section>
      <section class="panel">
        <div class="panel-head"><h2>開一家新商店</h2></div>
        <div class="panel-body" id="new-store"></div>
      </section>`);
    document.querySelectorAll("[data-use]").forEach(b => b.addEventListener("click", () => {
      DB.admin.useStore(b.dataset.use); toast("已切換商店"); Router.go("admin");
    }));
    window.Billing.storeForm(document.getElementById("new-store"), DB.home.info(), () => Router.go("admin"));
    const lv = document.getElementById("st-leave");
    if (lv) lv.addEventListener("click", async () => {
      if (!(await confirmBox({ title: `離開「${cur.name}」？`, body: "離開後就不能再進這家店的後台，要回來需要店主重新邀請。", ok: "離開", danger: true }))) return;
      try { await DB.admin.leave(); toast("已離開"); Router.go("admin"); } catch (err) { toast(err.message, "error"); }
    });
  }

  /* ---------- 總覽 ---------- */
  function viewDashboard() {
    const s = DB.stats();
    const low = DB.products.lowStock();
    const recent = DB.orders.list().slice(0, 6);
    const lowPanel = `<section class="panel">
          <div class="panel-head"><h2>庫存偏低</h2>${can("products") ? `<a class="small" href="#admin/products">管理商品</a>` : ""}</div>
          ${low.length ? `<div class="table-wrap"><table class="tbl"><tbody>
            ${low.slice(0, 6).map(x => `<tr ${can("products") ? `class="is-link" data-href="admin/product/${x.product.id}"` : ""}>
              <td><div class="prod-cell">${thumb(x.product)}<div><span>${esc(x.product.name)}</span><span class="small muted">${esc(Object.values(x.variant.options).join(" / ") || "單一規格")}</span></div></div></td>
              <td class="r">${x.variant.stock === 0 ? `<span class="pill bad">售完</span>` : `<span class="pill warn">剩 ${x.variant.stock}</span>`}</td>
            </tr>`).join("")}
          </tbody></table></div>` : `<div class="empty">庫存都充足</div>`}
        </section>`;
    // 沒有訂單權限的員工：只看商店網址和庫存提醒
    if (!can("orders")) {
      return shell("dash", `
        <div class="page-head"><h1>總覽</h1><span class="muted">${date(new Date().toISOString())}</span></div>
        ${DB.mode === "remote" ? storeUrlBox() : ""}
        <div class="notice">你是這家店的員工，可以使用：${esc(DB.admin.me().perms.map(permName).join("、") || "（沒有權限）")}。</div>
        ${lowPanel}`);
    }
    shell("dash", `
      <div class="page-head"><h1>總覽</h1><span class="muted">${date(new Date().toISOString())}</span></div>
      ${DB.mode === "remote" ? storeUrlBox() : ""}
      <div class="kpis">
        <div class="kpi"><span>今日營收</span><strong>${money(s.todayRevenue)}</strong><small>${s.todayOrders} 筆訂單</small></div>
        <div class="kpi"><span>本月營收</span><strong>${money(s.monthRevenue)}</strong><small>平均客單 ${money(s.avgOrder)}</small></div>
        <a class="kpi" href="#admin/orders/paid"><span>待出貨</span><strong>${s.toShip}</strong><small>待付款 ${s.toPay} 筆</small></a>
        ${can("customers") ? `<a class="kpi" href="#admin/customers"><span>會員數</span><strong>${s.customers}</strong><small>含結帳自動建立</small></a>`
          : `<div class="kpi"><span>本月訂單</span><strong>${s.monthOrders}</strong><small>不含已取消</small></div>`}
      </div>
      <div class="grid-2">
        <section class="panel">
          <div class="panel-head"><h2>近 14 天營收</h2><span class="small muted">不含已取消</span></div>
          <div class="panel-body">${barChart(s.daily)}</div>
        </section>
        ${lowPanel}
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

  // sel：傳入 Set 時多一欄勾選框（訂單頁批次處理用）
  const refundTag = o => o.refundTotal ? ` <span class="pill bad" title="已退款">${o.refundTotal >= o.total ? "全額退款" : "退 " + money(o.refundTotal)}</span>` : "";
  function ordersTable(list, sel) {
    if (!list.length) return `<div class="empty">沒有符合的訂單</div>`;
    return `<div class="table-wrap"><table class="tbl">
      <thead><tr>${sel ? `<th class="ck"><input type="checkbox" id="o-all" aria-label="全選這一頁" ${list.every(o => sel.has(o.id)) ? "checked" : ""}></th>` : ""}<th>訂單編號</th><th>日期</th><th>顧客</th><th>取貨</th><th>付款</th><th>狀態</th><th class="r">金額</th></tr></thead>
      <tbody>${list.map(o => `<tr class="is-link ${sel && sel.has(o.id) ? "is-sel" : ""}" data-href="admin/order/${o.id}">
        ${sel ? `<td class="ck"><input type="checkbox" class="o-ck" value="${o.id}" ${sel.has(o.id) ? "checked" : ""} aria-label="選取 ${esc(o.number)}"></td>` : ""}
        <td class="mono">${esc(o.number)}</td>
        <td class="num">${date(o.createdAt, true)}</td>
        <td>${esc(o.contact.name)}</td>
        <td>${esc(o.shipping.methodName)}</td>
        <td>${payPill(o.payment)}</td>
        <td>${statusPill(o.status)}${refundTag(o)}</td>
        <td class="r num">${money(o.total)}</td>
      </tr>`).join("")}</tbody></table></div>`;
  }

  // datetime-local 輸入框 ↔ ISO 時間
  const toLocalInput = iso => { if (!iso) return ""; const d = new Date(iso); const p2 = n => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}`; };
  const fromLocalInput = v => (v ? new Date(v).toISOString() : null);
  const productPill = p => {
    const s = DB.products.schedule(p);
    return s === "draft" ? `<span class="pill idle">草稿</span>`
      : s === "scheduled" ? `<span class="pill info" title="${esc(date(p.publishAt, true))} 上架">排程中</span>`
      : s === "ended" ? `<span class="pill warn" title="${esc(date(p.unpublishAt, true))} 已自動下架">已下架（到期）</span>`
      : `<span class="pill ok">上架中</span>${p.unpublishAt ? ` <span class="small muted">到 ${esc(date(p.unpublishAt))}</span>` : ""}`;
  };

  /* ---------- 商品列表 ---------- */
  const pf = { q: "", categoryId: "", status: "" };
  function viewProducts() {
    const cats = DB.categories.list();
    shell("products", `
      <div class="page-head"><h1>商品</h1><div class="actions">
        <button class="btn" type="button" id="pp-export">匯出 Excel</button><button class="btn" type="button" id="pp-import">匯入 Excel</button>
        <a class="btn" href="#admin/products/sort">調整排序</a><a class="btn btn-primary" href="#admin/product/new">新增商品</a></div></div>
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
            <td>${productPill(p)}</td>
          </tr>`;
        }).join("")}</tbody></table></div>` : `<div class="empty">沒有符合的商品</div>`;
    };
    draw();
    document.getElementById("pf-q").addEventListener("input", e => { pf.q = e.target.value; draw(); });
    document.getElementById("pf-cat").addEventListener("change", e => { pf.categoryId = e.target.value; draw(); });
    document.getElementById("pf-status").addEventListener("change", e => { pf.status = e.target.value; draw(); });
    document.getElementById("pp-export").addEventListener("click", () => {
      const ex = window.ProductImport.exportRows(DB.products.list(), cats, can("cost"));
      const cols = ex.header.map(h => ({ header: h, width: h === "商品ID" ? 38 : h === "商品描述" ? 30 : h === "商品名稱" ? 22 : 12, type: ["售價", "成本", "庫存"].includes(h) ? "number" : "text" }));
      download(XLSX.build([{ name: "商品", columns: cols, rows: ex.rows }]), `商品_${new Date().toISOString().slice(0, 10)}.xlsx`);
      toast(`已匯出 ${ex.rows.length} 個規格`);
    });
    document.getElementById("pp-import").addEventListener("click", importPrompt);
  }

  // 匯入 Excel：選檔 → 預覽要改什麼、有沒有錯 → 確認才存
  function importPrompt() {
    const wrap = document.createElement("div");
    wrap.className = "modal-backdrop";
    const close = () => wrap.remove();
    wrap.innerHTML = `<div class="modal is-wide imp" role="dialog" aria-modal="true" aria-labelledby="imp-title">
      <h3 id="imp-title">匯入商品（Excel）</h3>
      <ol class="small imp-steps">
        <li>先按「匯出 Excel」拿到目前的商品表，直接在上面改或往下新增。</li>
        <li>一列是一個規格；同一個商品的規格名稱要一樣。有「商品ID」的是更新，沒有的是新增。</li>
        <li>「庫存」只用在新增的規格；已經有的規格要改庫存請用「進銷存 → 盤點」。檔案裡沒列到的規格不會被刪掉。</li>
      </ol>
      <label class="img-drop"><input type="file" id="imp-file" accept=".xlsx,.csv"><b>選擇檔案</b><span>.xlsx 或 .csv（UTF-8）</span></label>
      <div id="imp-result"></div>
      <div class="modal-actions"><button type="button" class="btn" id="imp-cancel">取消</button><button class="btn btn-primary" type="button" id="imp-go" disabled>確認匯入</button></div>
    </div>`;
    document.body.appendChild(wrap);
    let planned = null;
    wrap.querySelector("#imp-cancel").addEventListener("click", close);
    wrap.querySelector("#imp-file").addEventListener("change", async e => {
      const f = e.target.files[0]; if (!f) return;
      const box = wrap.querySelector("#imp-result"), go = wrap.querySelector("#imp-go");
      box.innerHTML = `<div class="small muted">讀取中…</div>`; go.disabled = true; planned = null;
      try {
        const rows = await XLSX.read(f);
        planned = window.ProductImport.plan(rows, { products: DB.products.list(), categories: DB.categories.list(), canCost: can("cost") });
      } catch (err) { box.innerHTML = `<div class="notice">${esc(err.message)}</div>`; return; }
      const P = planned, S = P.summary;
      box.innerHTML = P.errors.length ? `<div class="notice is-bad"><b>有 ${P.errors.length} 個問題，修正後再匯入一次：</b>
          <ul class="imp-list">${P.errors.slice(0, 50).map(x => `<li>第 ${x.row} 列：${esc(x.msg)}</li>`).join("")}${P.errors.length > 50 ? `<li>…還有 ${P.errors.length - 50} 個</li>` : ""}</ul></div>`
        : !P.payloads.length ? `<div class="notice">檔案裡的商品跟目前一樣，沒有要改的地方。</div>`
        : `<div class="imp-sum"><b>共 ${S.rows} 列</b>：新增 ${S.createProducts} 個商品、更新 ${S.updateProducts} 個商品（改 ${S.changedVariants} 個規格、新增 ${S.newVariants} 個規格）</div>
          <ul class="imp-list">${P.changes.slice(0, 80).map(c => `<li><span class="pill ${c.kind === "create" ? "ok" : "info"}">${c.kind === "create" ? "新增" : "更新"}</span> ${esc(c.name)} <span class="small muted">${esc(c.detail)}</span></li>`).join("")}${P.changes.length > 80 ? `<li class="muted">…還有 ${P.changes.length - 80} 個</li>` : ""}</ul>
          ${(P.notes || []).length ? `<div class="small muted">${P.notes.map(esc).join("<br>")}</div>` : ""}`;
      go.disabled = !(P && !P.errors.length && P.payloads.length);
    });
    wrap.querySelector("#imp-go").addEventListener("click", async e => {
      if (!planned) return;
      e.target.disabled = true; e.target.textContent = "匯入中…";
      try { await DB.products.saveMany(planned.payloads); close(); toast(`匯入完成：新增 ${planned.summary.createProducts} 個、更新 ${planned.summary.updateProducts} 個商品`); viewProducts(); }
      catch (err) { toast(err.message, "error"); e.target.disabled = false; e.target.textContent = "確認匯入"; }
    });
  }

  // 自訂排序：拖曳或按上下箭頭，前台照這個順序顯示
  function viewProductSort() {
    const list = DB.products.list();
    shell("products", `
      <div class="page-head"><div class="crumbs"><a href="#admin/products">商品</a><span>/</span><span>調整排序</span></div>
        <div class="actions"><a class="btn" href="#admin/products">取消</a><button class="btn btn-primary" id="ps-save" type="button">儲存排序</button></div></div>
      <p class="small muted" style="margin:0">拖曳整列，或按 ↑ ↓ 調整。前台商品列表會照這個順序；之後新增的商品會排在最前面。</p>
      <section class="panel"><ol class="sort-list" id="ps-list">${list.map(p => `<li draggable="true" data-id="${p.id}">
        <span class="grip" aria-hidden="true">⋮⋮</span>${thumb(p)}<span class="sort-name">${esc(p.name)}</span>${productPill(p)}
        <span class="sort-btns"><button class="btn btn-sm btn-ghost" type="button" data-mv="-1" aria-label="往上">↑</button><button class="btn btn-sm btn-ghost" type="button" data-mv="1" aria-label="往下">↓</button></span>
      </li>`).join("")}</ol></section>`);
    const ol = document.getElementById("ps-list");
    let dragging = null;
    ol.addEventListener("dragstart", e => { dragging = e.target.closest("li"); dragging.classList.add("is-drag"); e.dataTransfer.effectAllowed = "move"; });
    ol.addEventListener("dragend", () => { if (dragging) dragging.classList.remove("is-drag"); dragging = null; });
    ol.addEventListener("dragover", e => {
      e.preventDefault();
      const over = e.target.closest("li"); if (!dragging || !over || over === dragging) return;
      const r = over.getBoundingClientRect();
      ol.insertBefore(dragging, e.clientY > r.top + r.height / 2 ? over.nextSibling : over);
    });
    ol.addEventListener("click", e => {
      const b = e.target.closest("[data-mv]"); if (!b) return;
      const li = b.closest("li");
      if (b.dataset.mv === "-1" && li.previousElementSibling) ol.insertBefore(li, li.previousElementSibling);
      if (b.dataset.mv === "1" && li.nextElementSibling) ol.insertBefore(li.nextElementSibling, li);
      b.focus();
    });
    document.getElementById("ps-save").addEventListener("click", async e => {
      e.target.disabled = true;
      try { await DB.products.sortOrder([...ol.children].map(li => li.dataset.id)); toast("已儲存排序"); Router.go("admin/products"); }
      catch (err) { toast(err.message, "error"); e.target.disabled = false; }
    });
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
          ${isNew ? "" : `<a class="btn btn-ghost" href="#shop/p/${p.id}">看前台頁面</a><button class="btn" id="pe-dup" type="button">複製</button><button class="btn" id="pe-del">刪除</button>`}
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
              <details class="pe-sched" ${draft.publishAt || draft.unpublishAt ? "open" : ""}><summary class="small">排程上下架</summary>
                <div class="field"><label for="pe-pub">上架時間</label><input type="datetime-local" id="pe-pub" value="${toLocalInput(draft.publishAt)}"><span class="hint">留空 = 選「上架中」後馬上上架</span></div>
                <div class="field"><label for="pe-unpub">自動下架時間</label><input type="datetime-local" id="pe-unpub" value="${toLocalInput(draft.unpublishAt)}"><span class="hint">留空 = 不會自動下架（適合限時商品、預購）</span></div>
                <p class="small muted" style="margin:0">要選「上架中」，排程才會生效。</p>
              </details>
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
        <thead><tr><th>${hasOpts ? "規格" : "單一規格"}</th><th>貨號</th><th>售價</th><th>庫存</th>${can("cost") ? "<th>平均成本</th>" : ""}</tr></thead>
        <tbody>${draft.variants.map((v, i) => `<tr>
          <td>${esc(Object.values(v.options).join(" / ") || "預設")}</td>
          <td><input type="text" class="v-in" data-i="${i}" data-k="sku" id="pe-v-sku-${i}" value="${esc(v.sku)}" aria-label="貨號"></td>
          <td><input type="number" class="v-in" data-i="${i}" data-k="price" id="pe-v-price-${i}" value="${v.price}" min="0" step="1" aria-label="價格"></td>
          <td><input type="number" class="v-in" data-i="${i}" data-k="stock" id="pe-v-stock-${i}" value="${v.stock}" min="0" step="1" aria-label="庫存"></td>
          ${can("cost") ? `<td><input type="number" class="v-in" data-i="${i}" data-k="cost" id="pe-v-cost-${i}" value="${v.cost || 0}" min="0" step="1" aria-label="平均成本"></td>` : ""}
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
      draft.publishAt = fromLocalInput(document.getElementById("pe-pub").value);
      draft.unpublishAt = fromLocalInput(document.getElementById("pe-unpub").value);
      if (draft.publishAt && draft.unpublishAt && draft.unpublishAt <= draft.publishAt) return toast("自動下架時間要晚於上架時間", "error");
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
    const dup = document.getElementById("pe-dup");
    if (dup) dup.addEventListener("click", async () => {
      if (!(await confirmBox({ title: `複製「${p.name}」？`, body: "會建立一個草稿，規格和價格一樣；庫存是 0、貨號清空、圖片要重新上傳。", ok: "複製" }))) return;
      try { const nid = await DB.products.duplicate(p.id); toast("已複製，記得改名稱和上傳圖片"); Router.go("admin/product/" + nid); } catch (err) { toast(err.message, "error"); }
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
  let oq = "", oPage = 0, oStatus = null;
  const oSel = new Set(), oSeen = {};   // 勾選的訂單（換頁也保留）
  const O_PAGE = 50;
  // 分頁按鈕：上一頁／第幾頁／下一頁
  function pager(total, page, size) {
    const pages = Math.ceil(total / size);
    if (pages <= 1) return total ? `<div class="pager"><span class="small muted">共 ${total} 筆</span></div>` : "";
    return `<div class="pager">
      <button class="btn btn-sm" type="button" data-page="${page - 1}" ${page <= 0 ? "disabled" : ""}>上一頁</button>
      <span class="small muted">第 ${page + 1} / ${pages} 頁 · 共 ${total} 筆</span>
      <button class="btn btn-sm" type="button" data-page="${page + 1}" ${page >= pages - 1 ? "disabled" : ""}>下一頁</button>
    </div>`;
  }
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
        <div class="bulk-bar" id="o-bulk" hidden></div>
        <div id="o-list"><div class="empty">載入中…</div></div>
        <div id="o-pager"></div>
      </section>`);
    if (status !== oStatus) { oStatus = status; oPage = 0; oSel.clear(); }
    let rows = [];
    // 一頁 50 筆，由資料庫查（全部訂單，不只近期）
    let seq = 0;
    const draw = async () => {
      const my = ++seq;
      try {
        const r = await DB.orders.query({ status, q: oq }, { offset: oPage * O_PAGE, limit: O_PAGE });
        if (my !== seq || !document.getElementById("o-list")) return;
        rows = r.rows; r.rows.forEach(o => { oSeen[o.id] = o; });
        document.getElementById("o-list").innerHTML = ordersTable(r.rows, oSel);
        document.getElementById("o-pager").innerHTML = pager(r.total, oPage, O_PAGE);
        drawBulk();
      } catch (err) { if (my === seq) document.getElementById("o-list").innerHTML = `<div class="empty">${esc(err.message)}</div>`; }
    };
    draw();
    let timer = null;
    document.getElementById("oq").addEventListener("input", e => { oq = e.target.value; oPage = 0; clearTimeout(timer); timer = setTimeout(draw, 300); });
    // 勾選與批次動作
    const drawBulk = () => {
      const bar = document.getElementById("o-bulk"); if (!bar) return;
      const picked = [...oSel].map(id => oSeen[id]).filter(Boolean);
      bar.hidden = !picked.length;
      if (!picked.length) return;
      const cnt = st => picked.filter(o => o.status === st).length;
      bar.innerHTML = `<b>已選 ${picked.length} 筆</b>
        <button class="btn btn-sm" type="button" data-bulk="ship-print">列印出貨單</button>
        <button class="btn btn-sm" type="button" data-bulk="pick-print">列印揀貨單</button>
        ${cnt("pending_payment") ? `<button class="btn btn-sm" type="button" data-bulk="paid">確認收款（${cnt("pending_payment")}）</button>` : ""}
        ${cnt("paid") ? `<button class="btn btn-sm btn-primary" type="button" data-bulk="shipped">標記已出貨（${cnt("paid")}）</button>` : ""}
        ${cnt("shipped") ? `<button class="btn btn-sm" type="button" data-bulk="completed">標記已完成（${cnt("shipped")}）</button>` : ""}
        <button class="btn btn-sm btn-ghost" type="button" data-bulk="clear">清除選取</button>`;
    };
    document.getElementById("o-list").addEventListener("change", e => {
      if (e.target.id === "o-all") { rows.forEach(o => e.target.checked ? oSel.add(o.id) : oSel.delete(o.id)); document.getElementById("o-list").innerHTML = ordersTable(rows, oSel); }
      else if (e.target.classList.contains("o-ck")) { e.target.checked ? oSel.add(e.target.value) : oSel.delete(e.target.value); e.target.closest("tr").classList.toggle("is-sel", e.target.checked); }
      drawBulk();
    });
    document.getElementById("o-bulk").addEventListener("click", async e => {
      const b = e.target.closest("[data-bulk]"); if (!b) return;
      const act = b.dataset.bulk, picked = [...oSel].map(id => oSeen[id]).filter(Boolean);
      if (act === "clear") { oSel.clear(); document.getElementById("o-list").innerHTML = ordersTable(rows, oSel); return drawBulk(); }
      if (act === "ship-print") return printShipping(picked);
      if (act === "pick-print") return printPicking(picked);
      const from = { paid: "pending_payment", shipped: "paid", completed: "shipped" }[act];
      const target = picked.filter(o => o.status === from);
      if (act === "shipped") return bulkShipPrompt(target, done);
      if (!(await confirmBox({ title: `${target.length} 筆訂單改成「${DB.orders.STATUS[act]}」？`, ok: "確定" }))) return;
      b.disabled = true;
      try { done(await DB.orders.bulkStatus(target.map(o => o.id), act)); } catch (err) { toast(err.message, "error"); b.disabled = false; }
    });
    const done = r => {
      toast(`已更新 ${r.ok} 筆${r.failed.length ? `，${r.failed.length} 筆沒改（${r.failed.map(f => f.number).join("、")}）` : ""}`, r.failed.length ? "error" : undefined);
      oSel.clear(); draw();
    };
    document.getElementById("o-pager").addEventListener("click", e => {
      const b = e.target.closest("[data-page]"); if (!b) return;
      oPage = +b.dataset.page; draw(); document.getElementById("main").scrollIntoView();
    });
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
    let rseq = 0;
    const refresh = async () => {
      f.querySelector("#ex-custom").hidden = f.querySelector('input[name="ex-range"]:checked').value !== "custom";
      const my = ++rseq;
      f.querySelector("#ex-count").textContent = "計算中…";
      try {
        const n = (await DB.orders.query(filter(), { offset: 0, limit: 1 })).total;
        if (my !== rseq) return;
        f.querySelector("#ex-count").textContent = `共 ${n} 筆訂單`;
        f.querySelector("#ex-go").disabled = n === 0;
      } catch (err) { f.querySelector("#ex-count").textContent = err.message; }
    };
    refresh();
    f.addEventListener("change", refresh);
    const close = () => wrap.remove();
    wrap.querySelector("#ex-cancel").addEventListener("click", close);
    wrap.addEventListener("click", e => { if (e.target === wrap) close(); });
    wrap.querySelector('input[name="ex-range"]:checked').focus();
    f.addEventListener("submit", async e => {
      e.preventDefault();
      const fl = filter();
      const go = f.querySelector("#ex-go"); go.disabled = true; go.textContent = "準備中…";
      try {
        const list = (await DB.orders.query(fl, { offset: 0, limit: 20000 })).rows;
        if (!list.length) return;
        exportOrders(list, fl);
        close();
        toast(`已匯出 ${list.length} 筆訂單`);
      } catch (err) { toast(err.message, "error"); go.disabled = false; go.textContent = "下載 .xlsx"; }
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
  async function viewOrder(id) {
    const o = DB.orders.get(id) || await DB.orders.fetch(id);
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
        <div class="actions"><button class="btn btn-ghost" type="button" id="od-print">列印出貨單</button>
          ${["paid", "shipped", "completed"].includes(o.status) && (o.refundTotal || 0) < o.total ? `<button class="btn" type="button" id="od-refund">退貨／退款</button>` : ""}
          ${next.map(([s, label, cls]) => `<button class="btn ${cls}" data-next="${s}">${label}</button>`).join("")}</div>
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
              ${o.refundTotal ? `<tr><td colspan="4" class="r muted">已退款</td><td class="r num">−${money(o.refundTotal)}</td></tr><tr><td colspan="4" class="r"><b>實收</b></td><td class="r num"><b>${money(o.total - o.refundTotal)}</b></td></tr>` : ""}
              </tbody></table></div>
          </section>
          ${(o.refunds || []).length ? `<section class="panel">
            <div class="panel-head"><h2>退貨／退款紀錄</h2></div>
            <div class="table-wrap"><table class="tbl"><thead><tr><th>時間</th><th>退貨</th><th class="r">退款</th><th>原因</th></tr></thead>
              <tbody>${o.refunds.map(r => `<tr><td class="small">${date(r.at, true)}${r.by ? `<div class="muted">${esc(r.by)}</div>` : ""}</td>
                <td class="small" style="white-space:normal">${r.items.length ? r.items.map(i => `${esc(i.name)}${i.optionText ? `（${esc(i.optionText)}）` : ""} ×${i.qty}`).join("<br>") + (r.restock ? `<div class="muted">已加回庫存</div>` : "") : "—"}</td>
                <td class="r num">${money(r.amount)}</td><td class="small" style="white-space:normal">${esc(r.reason)}</td></tr>`).join("")}</tbody></table></div>
          </section>` : ""}
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
              ${o.history.slice().reverse().map(h => `<li><div><b>${h.kind === "refund" ? "退款" : DB.orders.STATUS[h.status]}</b> <span class="muted num">${date(h.at, true)}</span>${h.by ? ` <span class="small muted">· ${esc(h.by)}</span>` : ""}${h.note ? `<div class="muted">${esc(h.note)}</div>` : ""}</div></li>`).join("")}
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
    document.getElementById("od-print").addEventListener("click", () => printShipping([o]));
    const rfb = document.getElementById("od-refund");
    if (rfb) rfb.addEventListener("click", () => refundPrompt(o, () => viewOrder(o.id)));
    document.getElementById("od-note-save").addEventListener("click", async () => {
      try { await DB.orders.setNote(o.id, document.getElementById("od-note").value); toast("已儲存備註"); } catch (err) { toast(err.message, "error"); }
    });
  }


  // 批次出貨：每筆可以各自填物流單號
  function bulkShipPrompt(list, done) {
    const wrap = document.createElement("div");
    wrap.className = "modal-backdrop";
    wrap.innerHTML = `<form class="modal is-wide" id="bs-form">
      <h3>${list.length} 筆標記已出貨</h3>
      <p class="small muted" style="margin:0">物流單號可以留空，之後到訂單頁再補。</p>
      <div class="bs-list">${list.map(o => `<div class="bs-row"><span class="mono">${esc(o.number)}</span><span class="small">${esc(o.contact.name)}・${esc(o.shipping.methodName)}</span>
        <input type="text" data-id="${o.id}" placeholder="物流單號（選填）" aria-label="${esc(o.number)} 物流單號"></div>`).join("")}</div>
      <div class="modal-actions"><button type="button" class="btn" id="bs-cancel">取消</button><button class="btn btn-primary" type="submit">確認出貨</button></div>
    </form>`;
    document.body.appendChild(wrap);
    const first = wrap.querySelector("input"); if (first) first.focus();
    wrap.querySelector("#bs-cancel").addEventListener("click", () => wrap.remove());
    wrap.querySelector("#bs-form").addEventListener("submit", async e => {
      e.preventDefault();
      const tracking = {}; wrap.querySelectorAll("input[data-id]").forEach(i => { if (i.value.trim()) tracking[i.dataset.id] = i.value.trim(); });
      const btn = e.target.querySelector("button[type=submit]"); btn.disabled = true;
      try { const r = await DB.orders.bulkStatus(list.map(o => o.id), "shipped", tracking); wrap.remove(); done(r); }
      catch (err) { toast(err.message, "error"); btn.disabled = false; }
    });
  }

  /* ---------- 列印：出貨單（一筆一頁）、揀貨單（彙總要撿的商品） ---------- */
  function printDocs(title, html) {
    let box = document.getElementById("print-root");
    if (!box) { box = document.createElement("div"); box.id = "print-root"; document.body.appendChild(box); }
    box.innerHTML = html;
    const old = document.title; document.title = title;
    document.body.classList.add("printing");
    const end = () => { document.body.classList.remove("printing"); document.title = old; box.innerHTML = ""; window.removeEventListener("afterprint", end); };
    window.addEventListener("afterprint", end);
    setTimeout(() => { window.print(); setTimeout(end, 500); }, 50);
  }
  const shipTo = o => o.shipping.storeName ? `${o.shipping.methodName}・${o.shipping.storeName}` : o.shipping.address ? `${o.shipping.methodName}・${o.shipping.address}` : o.shipping.methodName;
  function printShipping(list, withPrice) {
    if (!list.length) return;
    if (withPrice === undefined) {
      const wrap = document.createElement("div");
      wrap.className = "modal-backdrop";
      wrap.innerHTML = `<div class="modal"><h3>列印 ${list.length} 張出貨單</h3>
        <label class="check"><input type="checkbox" id="ps-price"> 印出單價與金額（送禮的訂單建議不要勾）</label>
        <div class="modal-actions"><button class="btn" type="button" data-a="no">取消</button><button class="btn btn-primary" type="button" data-a="go">列印</button></div></div>`;
      document.body.appendChild(wrap);
      wrap.addEventListener("click", e => {
        const a = e.target.closest("[data-a]"); if (!a) return;
        const wp = wrap.querySelector("#ps-price").checked; wrap.remove();
        if (a.dataset.a === "go") printShipping(list, wp);
      });
      return;
    }
    const st = DB.settings.get();
    const cod = o => o.payment.methodId === "cod" && o.payment.status !== "paid";
    printDocs(`出貨單_${list.length}筆`, list.map(o => `<section class="pdoc">
      <header class="pd-head"><div><b class="pd-store">${esc(st.name)}</b><div class="pd-small">${esc(st.email || "")}${st.phone ? `・${esc(st.phone)}` : ""}</div></div>
        <div class="pd-r"><div class="pd-title">出貨單</div><div class="pd-no">${esc(o.number)}</div><div class="pd-small">下單 ${date(o.createdAt, true)}</div></div></header>
      <div class="pd-grid">
        <div><div class="pd-label">收件人</div><div class="pd-big">${esc(o.contact.name)}</div><div>${esc(o.contact.phone)}</div></div>
        <div><div class="pd-label">取貨方式</div><div>${esc(shipTo(o))}</div>${o.shipping.trackingNo ? `<div class="pd-small">物流單號 ${esc(o.shipping.trackingNo)}</div>` : ""}</div>
        <div><div class="pd-label">付款</div><div>${esc(o.payment.methodName)}</div>${cod(o) ? `<div class="pd-big">取貨收款 ${money(o.total)}</div>` : `<div class="pd-small">${o.payment.status === "paid" ? "已付款" : "未付款"}</div>`}</div>
      </div>
      <table class="pd-tbl"><thead><tr><th class="pd-ck">✓</th><th>商品</th><th>規格</th><th>貨號</th><th class="r">數量</th>${withPrice ? `<th class="r">單價</th><th class="r">小計</th>` : ""}</tr></thead>
        <tbody>${o.items.map(it => `<tr><td class="pd-ck">☐</td><td>${esc(it.name)}</td><td>${esc(it.optionText || "—")}</td><td>${esc(it.sku || "")}</td><td class="r">${it.qty}</td>${withPrice ? `<td class="r">${money(it.price)}</td><td class="r">${money(it.price * it.qty)}</td>` : ""}</tr>`).join("")}</tbody>
        <tfoot><tr><td></td><td colspan="3">共 ${o.items.reduce((a, i) => a + i.qty, 0)} 件</td><td></td>${withPrice ? `<td class="r">總計</td><td class="r">${money(o.total)}</td>` : ""}</tr></tfoot></table>
      ${o.note ? `<div class="pd-note"><div class="pd-label">備註</div>${esc(o.note)}</div>` : ""}
      <footer class="pd-foot">謝謝你的訂購！商品有任何問題，請聯絡 ${esc(st.email || st.name)}</footer>
    </section>`).join(""));
  }
  function printPicking(list) {
    if (!list.length) return;
    const map = {};
    list.forEach(o => o.items.forEach(it => {
      const k = it.variantId;
      map[k] = map[k] || { name: it.name, optionText: it.optionText || "", sku: it.sku || "", qty: 0, orders: [] };
      map[k].qty += it.qty; map[k].orders.push(`${o.number}×${it.qty}`);
    }));
    const rows = Object.values(map).sort((a, b) => (a.name + a.optionText).localeCompare(b.name + b.optionText, "zh-Hant"));
    const st = DB.settings.get();
    printDocs(`揀貨單_${list.length}筆`, `<section class="pdoc">
      <header class="pd-head"><div><b class="pd-store">${esc(st.name)}</b><div class="pd-small">列印時間 ${date(new Date().toISOString(), true)}</div></div>
        <div class="pd-r"><div class="pd-title">揀貨單</div><div class="pd-small">${list.length} 筆訂單・${rows.reduce((a, r) => a + r.qty, 0)} 件・${rows.length} 種規格</div></div></header>
      <table class="pd-tbl"><thead><tr><th class="pd-ck">✓</th><th>商品</th><th>規格</th><th>貨號</th><th class="r">數量</th><th>訂單</th></tr></thead>
        <tbody>${rows.map(r => `<tr><td class="pd-ck">☐</td><td>${esc(r.name)}</td><td>${esc(r.optionText || "—")}</td><td>${esc(r.sku)}</td><td class="r pd-big">${r.qty}</td><td class="pd-small">${esc(r.orders.join("、"))}</td></tr>`).join("")}</tbody></table>
      <div class="pd-note"><div class="pd-label">這次的訂單</div>${list.map(o => `${esc(o.number)} ${esc(o.contact.name)}`).join("、")}</div>
    </section>`);
  }

  // 退貨／退款
  function refundPrompt(o, after) {
    const done = {};
    (o.refunds || []).forEach(r => r.items.forEach(i => { done[i.variantId] = (done[i.variantId] || 0) + i.qty; }));
    const left = o.total - (o.refundTotal || 0);
    const wrap = document.createElement("div");
    wrap.className = "modal-backdrop";
    wrap.innerHTML = `<form class="modal is-wide" id="rf-form" novalidate>
      <h3>退貨／退款</h3>
      <p class="small muted" style="margin:0">金流還沒串接：錢請你自己退給顧客（轉帳等），這裡是記錄，會算進報表和會員累積消費。</p>
      <table class="tbl"><thead><tr><th>商品</th><th class="r">買了</th><th class="r">已退</th><th class="r">這次退貨</th></tr></thead>
        <tbody>${o.items.map(it => { const d = done[it.variantId] || 0; return `<tr><td>${esc(it.name)}${it.optionText ? `<div class="small muted">${esc(it.optionText)}</div>` : ""}</td>
          <td class="r num">${it.qty}</td><td class="r num">${d}</td>
          <td class="r"><input type="number" class="rf-q" data-v="${it.variantId}" data-price="${it.price}" min="0" max="${it.qty - d}" step="1" value="0" ${it.qty - d <= 0 ? "disabled" : ""} style="max-width:80px" aria-label="${esc(it.name)} 退貨數量"></td></tr>`; }).join("")}</tbody></table>
      <label class="check"><input type="checkbox" id="rf-restock" checked> 退回的商品加回庫存（商品完好可以再賣）</label>
      <div class="grid-form">
        <div class="field"><label for="rf-amt">退款金額（NT$）</label><input type="number" id="rf-amt" min="0" max="${left}" step="1" value="0"><span class="hint">最多還能退 ${money(left)}；填了退貨數量會自動帶入商品金額，可以再改</span></div>
        <div class="field"><label for="rf-reason">原因</label><input type="text" id="rf-reason" maxlength="200" placeholder="例如：商品破損、尺寸不合"></div>
      </div>
      <div class="modal-actions"><button type="button" class="btn" id="rf-cancel">取消</button><button class="btn btn-danger" type="submit">記錄退款</button></div>
    </form>`;
    document.body.appendChild(wrap);
    const amt = wrap.querySelector("#rf-amt");
    wrap.querySelectorAll(".rf-q").forEach(i => i.addEventListener("input", () => {
      const sum = [...wrap.querySelectorAll(".rf-q")].reduce((a, x) => a + (+x.value || 0) * +x.dataset.price, 0);
      amt.value = Math.min(sum, left);
    }));
    wrap.querySelector("#rf-cancel").addEventListener("click", () => wrap.remove());
    wrap.querySelector("#rf-form").addEventListener("submit", async e => {
      e.preventDefault();
      const items = [...wrap.querySelectorAll(".rf-q")].map(i => ({ variantId: i.dataset.v, qty: Math.floor(+i.value || 0) })).filter(i => i.qty > 0);
      const btn = e.target.querySelector("button[type=submit]"); btn.disabled = true;
      try {
        await DB.orders.refund(o.id, { items, amount: amt.value, restock: wrap.querySelector("#rf-restock").checked, reason: wrap.querySelector("#rf-reason").value });
        wrap.remove(); toast("已記錄退款"); after();
      } catch (err) { toast(err.message, "error"); btn.disabled = false; }
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
  let cq = "", ctier = "", cShow = 100;
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
      const shown = list.slice(0, cShow);
      document.getElementById("c-list").innerHTML = list.length ? `<div class="table-wrap"><table class="tbl">
        <thead><tr><th>姓名</th>${on ? "<th>等級</th>" : ""}<th>帳號</th><th>手機</th><th>Email</th><th class="r">訂單數</th><th class="r">累積消費</th><th>最後購買</th></tr></thead>
        <tbody>${shown.map(c => `<tr class="is-link" data-href="admin/customer/${c.id}">
          <td>${esc(c.name)}</td>${on ? `<td>${tierPill(c.level)}</td>` : ""}<td>${accountPill(c)}</td><td class="mono">${esc(c.phone)}</td><td>${esc(c.email) || "—"}</td>
          <td class="r num">${c.orderCount}</td><td class="r num">${money(c.totalSpent)}</td><td class="num">${date(c.lastOrderAt)}</td>
        </tr>`).join("")}</tbody></table></div>
        <div class="pager"><span class="small muted">顯示 ${shown.length} / ${list.length} 位</span>${list.length > shown.length ? `<button class="btn btn-sm" type="button" id="c-more">再顯示 100 位</button>` : ""}</div>` : `<div class="empty">沒有符合的會員</div>`;
      const more = document.getElementById("c-more");
      if (more) more.addEventListener("click", () => { cShow += 100; draw(); });
    };
    draw();
    document.getElementById("cq").addEventListener("input", e => { cq = e.target.value; cShow = 100; draw(); });
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
        <section class="panel"><div class="panel-head"><h2>訂單紀錄</h2></div><div id="cu-orders">${ordersTable(DB.orders.byCustomer(c.id))}</div></section>
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
    // 近期清單以外的舊訂單：到資料庫拿這位會員的全部訂單
    if (c.orderCount > DB.orders.byCustomer(c.id).filter(o => o.status !== "cancelled").length) {
      DB.orders.ofCustomer(c.id).then(list => { const el = document.getElementById("cu-orders"); if (el) el.innerHTML = ordersTable(list); }).catch(() => {});
    }
  }

  /* ---------- 設定 ---------- */
  function viewSettings() {
    const st = DB.settings.get();
    shell("settings", `
      <div class="page-head"><h1>設定</h1><button class="btn btn-primary" id="st-save">儲存設定</button></div>
      ${DB.mode === "remote" ? planPanel() : ""}
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
          ${DB.mode === "remote" ? "" : "<!-- 離線示範版沒有自動取消 -->"}<div class="field" ${DB.mode === "remote" ? "" : "hidden"}><label for="st-autocancel">銀行轉帳幾天沒付款自動取消</label><input type="number" id="st-autocancel" min="0" max="30" step="1" value="${+st.autoCancelDays || 0}"><span class="hint">填 0 代表不自動取消。取消後庫存會加回，避免假訂單卡住庫存</span></div>
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
          <p class="muted" style="margin:0">目前資料只存在這個瀏覽器裡（儲存空間約已使用 ${Math.round(((DB.media.usage() || {}).ratio || 0) * 100)}%）。重置會把商品、訂單、會員、商品圖片都換回範例資料。</p>
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
      cur.autoCancelDays = Math.min(30, Math.max(0, Math.floor(+document.getElementById("st-autocancel").value || 0)));
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
  const MOVE_PILL = { sale: "info", cancel: "warn", purchase: "ok", adjust: "warn", edit: "idle", initial: "idle", return: "warn" };
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
            <td class="small" style="white-space:normal;min-width:160px">${esc(m.note) || `<span class="muted">—</span>`}${m.by ? `<div class="muted">${esc(m.by)}</div>` : ""}</td>
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
              ${po.history.slice().reverse().map(h => `<li><div><b>${DB.purchases.STATUS[h.status]}</b> <span class="muted num">${date(h.at, true)}</span>${h.by ? ` <span class="small muted">· ${esc(h.by)}</span>` : ""}${h.note ? `<div class="muted">${esc(h.note)}</div>` : ""}</div></li>`).join("")}
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
    if (e.target.closest("a, button, input, select, textarea, label, .ck")) return;
    const tr = e.target.closest("tr[data-href]");
    if (tr) Router.go(tr.dataset.href);
  });

  /* ---------- 後台登入（資料庫版） ---------- */
  window.AdminGate = function (st, parts, into) {
    const wrap = (inner, wide) => { if (into) { into.innerHTML = inner; return; } root().innerHTML = `<div class="gate"><div class="gate-card${wide ? " is-wide" : ""}">${inner}</div></div>`; };
    const outBtn = () => document.getElementById("gate-out").addEventListener("click", async () => { await DB.admin.logout(); Router.go("admin"); });
    if (st.state === "nostore") {
      wrap(`
        <h1>開一家你的商店</h1>
        <p class="muted">已用 <b>${esc(st.email)}</b> 登入。填好商店名稱和網址代號，馬上就能開始試用。</p>
        <div id="gate-new"></div>
        <div class="actions"><button class="btn btn-ghost" id="gate-out" type="button">登出，換一個帳號</button></div>`, true);
      window.Billing.storeForm(document.getElementById("gate-new"), st.home || DB.home.info(), () => Router.go("admin"));
      outBtn(); return;
    }
    if (st.state === "pick") {
      const B = window.Billing;
      wrap(`
        <h1>選擇商店</h1>
        ${st.wanted ? `<div class="notice">這個帳號沒有「${esc(st.wanted)}」的管理權限，請從下面選一家你的商店。</div>` : `<p class="muted">${esc(st.email)} 管理 ${st.stores.length} 家商店</p>`}
        <div class="pick-list">${st.stores.map(x => `<button class="pick-item" type="button" data-use="${esc(x.slug)}">
          <b>${esc(x.name)}</b><span class="mono small muted">${esc(x.slug)}</span>${B.pill(x.billing)}</button>`).join("")}</div>
        <div class="actions"><button class="btn btn-ghost" id="gate-out" type="button">登出</button></div>`);
      document.querySelectorAll(".pick-item").forEach(b => b.addEventListener("click", () => { DB.admin.useStore(b.dataset.use); Router.go("admin"); }));
      outBtn(); return;
    }
    if (st.state === "denied") {
      const sql = `select setup_platform_admin('${String(st.email).replace(/'/g, "''")}');`;
      wrap(`
        <h1>平台總控台</h1>
        <p>你用 <b>${esc(st.email)}</b> 登入，但這個帳號還不是平台管理者。</p>
        <ol class="gate-steps">
          <li>打開 Supabase 後台，左邊選 <b>SQL Editor</b>，按 <b>New query</b></li>
          <li>貼上下面這一行，按 <b>Run</b>：<pre class="gate-sql mono" id="gate-sql">${esc(sql)}</pre><button class="btn btn-sm" type="button" data-copy="${esc(sql)}">複製</button></li>
          <li>看到「完成」後，回到這裡按「重新檢查」</li>
        </ol>
        <div class="actions"><button class="btn btn-primary" id="gate-retry" type="button">重新檢查</button><a class="btn" href="#admin">回商家後台</a><button class="btn btn-ghost" id="gate-out" type="button">登出</button></div>`);
      document.getElementById("gate-retry").addEventListener("click", () => { DB.admin.recheck(); Router.render(); });
      outBtn(); return;
    }
    // 登入／建立帳號
    const forPlatform = st.side === "platform";
    let mode = parts && parts[1] === "signup" && !forPlatform ? "signup" : "login";
    const draw = msg => {
      wrap(`
        ${into ? `<h2>${mode === "login" ? "登入" : "建立帳號"}</h2>` : `<h1>${forPlatform ? "平台總控台" : mode === "login" ? "商家登入" : "免費開店"}</h1>`}
        <p class="muted">${mode === "login" ? "用你的 Email 登入" : "第一步：建立你的帳號（之後可以開好幾家店）"}</p>
        ${msg ? `<div class="notice">${msg}</div>` : ""}
        <form id="gate-form" class="gate-form" novalidate>
          <div class="field"><label for="gate-email">Email</label><input type="email" id="gate-email" autocomplete="username" required></div>
          <div class="field"><label for="gate-pw">密碼</label><input type="password" id="gate-pw" autocomplete="${mode === "login" ? "current-password" : "new-password"}" required>${mode === "login" ? "" : `<span class="hint">至少 8 個字元</span>`}</div>
          <button class="btn btn-primary" type="submit" style="padding:10px">${mode === "login" ? "登入" : "建立帳號"}</button>
        </form>
        ${forPlatform ? "" : `<button class="btn btn-ghost" id="gate-switch" type="button">${mode === "login" ? "還沒有帳號？免費開店" : "已經有帳號？登入"}</button>`}
        <a class="small muted" href="#home" style="text-align:center">← 回平台首頁</a>`);
      document.getElementById("gate-email").focus();
      const sw = document.getElementById("gate-switch");
      if (sw) sw.addEventListener("click", () => { mode = mode === "login" ? "signup" : "login"; draw(); });
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
            if (r.needConfirm) { mode = "login"; draw(`已寄出確認信到 <b>${esc(email)}</b>。請到信箱點信裡的連結，會直接回到這裡繼續開店。`); }
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
    if (PAGE_PERM[page] && !can(PAGE_PERM[page])) return noPerm(PAGE_PERM[page]);
    if (!DB.features.inventory && ["stock", "moves", "purchases", "purchase", "suppliers", "supplier"].includes(page)) return phaseTwo("", "進銷存");
    if (!DB.features.tiers && page === "tiers") return phaseTwo("", "會員等級");
    switch (page) {
      case undefined: return viewDashboard();
      case "products": return arg === "sort" ? viewProductSort() : viewProducts();
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
      case "reports": return viewReports();
      case "theme": return viewTheme();
      case "reviews": return viewReviews(arg);
      case "staff": return DB.features.staff ? viewStaff() : notFound("離線示範版只有店主一個人", "admin");
      case "stores": return DB.mode === "remote" ? viewStores() : notFound("離線示範版只有一家商店", "admin");
      default: return notFound("找不到這個頁面", "admin");
    }
  };
})();
