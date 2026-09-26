/* =========================================================
 * platform.js — 平台這一層（資料庫版才有）
 *   ‧#home                平台首頁：介紹、年費、免費開店
 *   ‧#platform[/…]        平台總控台：所有商家、年費到期、收款、停用、平台設定
 *   ‧window.Billing       商店方案狀態的文字與標籤、開新店表單（後台也會用）
 * ========================================================= */
(function () {
  const { esc, money, date, toast, confirmBox, download, Router } = window.UI;
  const root = () => document.getElementById("app");
  const ymd = s => (s ? String(s).slice(0, 10).replace(/-/g, "/") : "—");

  /* ---------- 方案狀態 ---------- */
  const STATUS_TEXT = { trial: "試用中", paid: "年費有效", free: "免費方案", expired: "已到期", suspended: "已停用" };
  const STATUS_CLS = { trial: "info", paid: "ok", free: "idle", expired: "bad", suspended: "bad" };
  const KIND_TEXT = { payment: "收到年費", extend: "調整到期日", plan: "改方案", suspend: "停用", resume: "恢復營業", create: "開店" };
  const Billing = {
    ymd,
    pill: b => (b ? `<span class="pill ${STATUS_CLS[b.status] || "idle"}">${STATUS_TEXT[b.status] || b.status}</span>` : ""),
    text: b => STATUS_TEXT[b.status] || b.status,
    line(b) {
      if (!b) return "";
      switch (b.status) {
        case "suspended": return `平台已停用這家商店${b.suspendReason ? `：${b.suspendReason}` : ""}。前台暫停營業，後台資料都還在。`;
        case "free": return "免費方案，沒有到期日。";
        case "expired": return `${ymd(b.activeUntil)} 已到期，前台已暫停接單（後台資料都還在）。續約後立刻恢復營業。`;
        case "trial": return `免費試用到 ${ymd(b.activeUntil)}（還剩 ${b.daysLeft} 天）。`;
        default: return `年費有效到 ${ymd(b.activeUntil)}（還剩 ${b.daysLeft} 天）。`;
      }
    },
    short(b) {
      if (!b) return "";
      if (b.status === "free") return "—";
      if (b.status === "suspended") return "停用中";
      if (b.status === "expired") return `${ymd(b.activeUntil)} 到期`;
      return `${ymd(b.activeUntil)}（剩 ${b.daysLeft} 天）`;
    },
    // 後台最上方的提醒：到期、停用，或剩 7 天內
    banner(b, pf, active) {
      if (!b || active === "settings") return "";
      const soon = (b.status === "trial" || b.status === "paid") && b.daysLeft <= 7;
      if (!soon && b.status !== "expired" && b.status !== "suspended") return "";
      const bad = b.status === "expired" || b.status === "suspended";
      const title = b.status === "suspended" ? "商店已被平台停用" : b.status === "expired" ? "商店已到期，前台暫停接單"
        : b.status === "trial" ? `試用還剩 ${b.daysLeft} 天` : `年費還剩 ${b.daysLeft} 天到期`;
      return `<div class="bill-banner ${bad ? "is-bad" : ""}" role="status"><b>${esc(title)}</b>
        <span>${esc(Billing.line(b))}</span><a href="#admin/settings">看方案與續約方式</a></div>`;
    },
    // 開新店表單（開店畫面、我的商店頁共用）
    storeForm(el, home, onDone) {
      home = home || {};
      const canCreate = home.signupOpen || DB.admin.isPlatform();
      if (!canCreate) {
        el.innerHTML = `<div class="notice">平台目前暫停開放新商店${home.contactEmail ? `，想開店請來信 <a href="mailto:${esc(home.contactEmail)}">${esc(home.contactEmail)}</a>` : ""}。</div>`;
        return;
      }
      const trial = +home.trialDays || 0;
      el.innerHTML = `
        <form class="gate-form" id="sf-form" novalidate>
          <div class="field"><label for="sf-name">商店名稱</label><input type="text" id="sf-name" maxlength="40" placeholder="例如：山邊小舖" autocomplete="organization"></div>
          <div class="field"><label for="sf-slug">商店網址代號</label>
            <input type="text" id="sf-slug" class="mono" maxlength="30" placeholder="例如 hill-shop" autocapitalize="off" autocomplete="off" spellcheck="false">
            <span class="hint" id="sf-hint">3～30 個小寫英文、數字或減號，<b>建立後不能改</b></span>
            <span class="hint mono sf-url" id="sf-url"></span></div>
          <label class="check"><input type="checkbox" id="sf-agree"> 我已閱讀並同意<a href="#home/terms" target="_blank">服務條款</a>與<a href="#home/privacy" target="_blank">隱私權政策</a></label>
          <button class="btn btn-primary" type="submit" style="padding:10px">${trial ? `開始免費試用 ${trial} 天` : "建立商店"}</button>
          ${home.annualFee ? `<p class="small muted" style="margin:0">${trial ? "試用結束後" : ""}年費 ${money(home.annualFee)}／年，平台不抽成。試用期間不用付款。</p>` : ""}
        </form>`;
      const f = el.querySelector("#sf-form"), slugEl = el.querySelector("#sf-slug"), hint = el.querySelector("#sf-hint"), urlEl = el.querySelector("#sf-url");
      let timer = null, seq = 0;
      const setHint = (msg, kind) => { hint.innerHTML = msg; hint.className = "hint" + (kind ? " is-" + kind : ""); };
      slugEl.addEventListener("input", () => {
        const v = slugEl.value.toLowerCase().replace(/\s+/g, "-");
        if (v !== slugEl.value) slugEl.value = v;
        urlEl.textContent = v ? DB.admin.storeUrl(v) : "";
        clearTimeout(timer);
        if (!v) return setHint("3～30 個小寫英文、數字或減號，<b>建立後不能改</b>");
        const my = ++seq;
        timer = setTimeout(async () => {
          try { const r = await DB.admin.checkSlug(v); if (my === seq) setHint(esc(r.message), r.ok ? "ok" : "bad"); } catch (e) { /* 送出時再檢查 */ }
        }, 400);
      });
      f.addEventListener("submit", async e => {
        e.preventDefault();
        if (!f.querySelector("#sf-agree").checked) return toast("請先閱讀並同意服務條款與隱私權政策", "error");
        const btn = f.querySelector("button[type=submit]");
        btn.disabled = true;
        try {
          await DB.admin.createStore(f.querySelector("#sf-name").value, slugEl.value);
          toast("商店建立好了！先到「設定」填上客服資料和匯款帳號");
          onDone();
        } catch (err) { toast(err.message, "error"); btn.disabled = false; }
      });
      el.querySelector("#sf-name").focus();
    },
  };
  window.Billing = Billing;

  /* =========================================================
   * 平台首頁 #home
   * ========================================================= */
  window.HomeApp = function (parts) {
    const h = DB.home.info();
    const name = h.platformName || "開店平台";
    const page = parts && parts[1];
    if (page === "terms" || page === "privacy") {
      const isTerms = page === "terms", title = isTerms ? "服務條款" : "隱私權政策";
      const body = isTerms ? h.terms : h.privacy;
      root().innerHTML = `<div class="home"><header class="home-top"><div class="home-wrap"><a class="home-logo" href="#home">${esc(name)}</a><nav><a href="#home">回平台首頁</a></nav></div></header>
        <main class="home-sec"><div class="home-wrap" style="max-width:820px"><h1>${title}</h1>
          <div class="home-card" style="white-space:pre-wrap;line-height:1.8">${body ? esc(body) : `平台尚未公布${title}，請聯絡平台。`}</div>
        </div></main>${homeFooter(h, name)}</div>`;
      return;
    }
    const demo = DB.admin.storeUrl("demo") + "#shop";
    const cta = h.signupOpen
      ? `<a class="btn btn-primary btn-lg" href="#admin/signup">${h.trialDays ? `免費試用 ${h.trialDays} 天` : "免費開店"}</a>`
      : `<span class="btn btn-lg" aria-disabled="true">目前暫停開放新商店</span>`;
    const feats = [
      ["商品與多規格", "顏色 × 尺寸自動組合，每個規格各自設價格、庫存；可上傳多張商品照片。"],
      ["訂單一條龍", "待付款 → 待出貨 → 已出貨 → 完成，填物流單號、匯出 Excel。"],
      ["會員與等級", "顧客用 Email 註冊，累積消費自動升級，銀卡、金卡各有折扣與免運。"],
      ["優惠券與滿額", "折金額、打折、免運；滿額自動折，購物車會提示「再買多少」。"],
      ["進銷存", "庫存異動紀錄、盤點、進貨單分批入庫、供應商、平均成本。"],
      ["不怕超賣", "金額由伺服器計算，下單時鎖庫存；很多人同時搶最後一件也不會賣超過。"],
    ];
    root().innerHTML = `
      <div class="home">
        <header class="home-top"><div class="home-wrap">
          <a class="home-logo" href="#home">${esc(name)}</a>
          <nav><a href="${esc(demo)}" target="_blank" rel="noopener">示範商店</a><a href="#admin">商家登入</a></nav>
        </div></header>
        <section class="home-hero"><div class="home-wrap">
          <p class="home-kicker">台灣的網路開店平台 · 年費制</p>
          <h1>開一家自己的網路商店，<br>賣多少都是你的。</h1>
          <p class="home-lead">固定年費${h.annualFee ? ` ${money(h.annualFee)}` : ""}，平台<b>不抽成</b>。商品、訂單、會員、優惠券、進銷存，一套到位。</p>
          <div class="home-cta">${cta}<a class="btn btn-lg" href="${esc(demo)}" target="_blank" rel="noopener">先逛示範商店</a></div>
        </div></section>
        <section class="home-sec"><div class="home-wrap">
          <h2>開店需要的，都已經準備好</h2>
          <div class="home-grid">${feats.map(([t, d]) => `<div class="home-card"><h3>${esc(t)}</h3><p>${esc(d)}</p></div>`).join("")}</div>
        </div></section>
        <section class="home-sec is-alt"><div class="home-wrap home-split">
          <div>
            <h2>三步驟開店</h2>
            <ol class="home-steps">
              <li><b>建立帳號</b><span>用 Email 註冊，點確認信。</span></li>
              <li><b>取店名與網址</b><span>例如 <span class="mono">…/?store=hill-shop</span>，馬上可以分享。</span></li>
              <li><b>上架商品開賣</b><span>設定取貨方式與匯款帳號，就能接單。</span></li>
            </ol>
          </div>
          <div class="home-price">
            <span class="small muted">年費方案</span>
            <strong>${h.annualFee ? money(h.annualFee) : "—"}<small>／年</small></strong>
            <ul>
              <li>0% 交易抽成</li>
              ${h.trialDays ? `<li>先免費試用 ${h.trialDays} 天，不用綁卡</li>` : ""}
              <li>所有功能都能用，商品數不限</li>
              <li>一個帳號可以管理好幾家店</li>
            </ul>
            ${cta}
          </div>
        </div></section>
        <section class="home-sec"><div class="home-wrap">
          <h2>常見問題</h2>
          <dl class="home-faq">
            <dt>可以刷卡、超商取貨嗎？</dt><dd>目前由商家自己收款與出貨（銀行轉帳、取貨付款），在後台確認收款、填物流單號。金流、物流串接會在之後的版本加入。</dd>
            <dt>試用結束沒續約會怎樣？</dt><dd>前台會暫停接單，但商品、訂單、會員資料都會保留；續約後立刻恢復營業。</dd>
            <dt>怎麼繳年費？</dt><dd>${h.contactEmail ? `來信 <a href="mailto:${esc(h.contactEmail)}">${esc(h.contactEmail)}</a>` : "聯絡平台"}${h.contactLine ? `或加 LINE：${esc(h.contactLine)}` : ""}，確認收款後平台會幫你開通一年。</dd>
          </dl>
        </div></section>
        ${homeFooter(h, name)}
      </div>`;
  };

  function homeFooter(h, name) {
    return `<footer class="home-foot"><div class="home-wrap"><span>© ${new Date().getFullYear()} ${esc(name)}</span>
      <span><a href="#home/terms">服務條款</a> · <a href="#home/privacy">隱私權政策</a></span>
      ${h.contactEmail ? `<a href="mailto:${esc(h.contactEmail)}">${esc(h.contactEmail)}</a>` : ""}</div></footer>`;
  }

  /* =========================================================
   * 平台總控台 #platform
   * ========================================================= */
  function shell(active, content) {
    const link = (href, key, label, badge) => `<a href="#${href}" class="${active === key ? "is-on" : ""}">${label}${badge ? `<span class="badge">${badge}</span>` : ""}</a>`;
    const d = DB.platform.data();
    const soon = d.stores.filter(isSoon).length;
    root().innerHTML = `
      <div class="admin is-platform">
        <aside class="side">
          <div class="side-brand"><strong>${esc(d.settings.platformName || "開店平台")}</strong><span>平台總控台</span></div>
          <nav aria-label="平台選單">
            ${link("platform", "dash", "總覽")}
            ${link("platform/stores", "stores", "商店", soon || "")}
            ${link("platform/billing", "billing", "收款與異動")}
            ${link("platform/settings", "settings", "平台設定")}
          </nav>
          <div class="side-foot">
            <a class="side-link" href="#home" target="_blank" rel="noopener">平台首頁 ↗</a>
            <a class="side-link" href="#admin">我的商家後台</a>
            <div>v0.21 · 平台管理者</div>
            <div class="side-user">${esc((DB.admin.user() || {}).email || "")}</div>
            <button class="btn btn-sm btn-ghost" id="side-logout" type="button">登出</button>
          </div>
        </aside>
        <main class="main" id="main">${content}</main>
      </div>`;
    document.getElementById("side-logout").addEventListener("click", async () => { await DB.admin.logout(); toast("已登出"); Router.go("platform"); });
  }
  const isSoon = s => (s.billing.status === "trial" || s.billing.status === "paid") && s.billing.daysLeft <= 30;
  const ownerText = s => s.owners.join("、") || "—";
  const storeCell = s => `<div style="display:grid"><b>${esc(s.name)}</b><span class="mono small muted">${esc(s.slug)}</span></div>`;

  function storesTable(list, empty) {
    if (!list.length) return `<div class="empty">${esc(empty || "沒有商店")}</div>`;
    return `<div class="table-wrap"><table class="tbl">
      <thead><tr><th>商店</th><th>店主</th><th>狀態</th><th>到期</th><th class="r">商品</th><th class="r">30 天訂單</th><th class="r">30 天營收</th><th>開店日</th></tr></thead>
      <tbody>${list.map(s => `<tr class="is-link" data-href="platform/store/${s.id}">
        <td>${storeCell(s)}</td><td class="small">${esc(ownerText(s))}</td><td>${Billing.pill(s.billing)}</td>
        <td class="small">${esc(Billing.short(s.billing))}</td><td class="r num">${s.products}</td><td class="r num">${s.orders30}</td>
        <td class="r num">${money(s.revenue30)}</td><td class="small">${date(s.createdAt)}</td></tr>`).join("")}</tbody>
    </table></div>`;
  }
  function logTable(list, withStore) {
    if (!list.length) return `<div class="empty">還沒有紀錄</div>`;
    return `<div class="table-wrap"><table class="tbl">
      <thead><tr><th>時間</th>${withStore ? "<th>商店</th>" : ""}<th>項目</th><th class="r">金額</th><th>期間／日期</th><th>備註</th><th>操作者</th></tr></thead>
      <tbody>${list.map(l => `<tr ${withStore ? `class="is-link" data-href="platform/store/${l.storeId}"` : ""}>
        <td class="small">${date(l.at, true)}</td>
        ${withStore ? `<td>${esc(l.storeName)} <span class="mono small muted">${esc(l.storeSlug)}</span></td>` : ""}
        <td>${esc(KIND_TEXT[l.kind] || l.kind)}</td>
        <td class="r num">${l.kind === "payment" ? money(l.amount) : ""}</td>
        <td class="small">${l.from || l.to ? `${l.from ? ymd(l.from) + " → " : ""}${ymd(l.to)}` : ""}</td>
        <td class="small" style="white-space:normal;min-width:160px">${esc(l.note)}</td>
        <td class="small">${esc(l.by)}</td></tr>`).join("")}</tbody>
    </table></div>`;
  }

  function viewDash() {
    const d = DB.platform.data(), st = d.stores;
    const count = k => st.filter(s => s.billing.status === k).length;
    const year = String(new Date().getFullYear());
    const income = d.log.filter(l => l.kind === "payment" && String(l.at).startsWith(year)).reduce((a, l) => a + l.amount, 0);
    const soon = st.filter(isSoon).sort((a, b) => a.billing.daysLeft - b.billing.daysLeft);
    const gmv = st.reduce((a, s) => a + s.revenue30, 0);
    shell("dash", `
      <div class="page-head"><h1>平台總覽</h1><span class="muted">${ymd(d.today)}</span></div>
      <div class="kpis">
        <a class="kpi" href="#platform/stores"><span>商店</span><strong>${st.length}</strong><small>營業中 ${st.filter(s => s.billing.open).length} 家</small></a>
        <a class="kpi" href="#platform/stores/trial"><span>試用中</span><strong>${count("trial")}</strong><small>年費有效 ${count("paid")} 家</small></a>
        <a class="kpi" href="#platform/stores/soon"><span>30 天內到期</span><strong>${soon.length}</strong><small>已到期 ${count("expired")}・停用 ${count("suspended")}</small></a>
        <a class="kpi" href="#platform/billing"><span>${year} 年費收入</span><strong>${money(income)}</strong><small>近 30 天各店營收合計 ${money(gmv)}</small></a>
      </div>
      <section class="panel">
        <div class="panel-head"><h2>即將到期（30 天內）</h2><a class="small" href="#platform/stores/soon">全部</a></div>
        ${storesTable(soon.slice(0, 8), "30 天內沒有商店到期")}
      </section>
      <div class="grid-2">
        <section class="panel">
          <div class="panel-head"><h2>最新開店</h2><a class="small" href="#platform/stores">全部商店</a></div>
          ${storesTable(st.slice(0, 5), "還沒有商店")}
        </section>
        <section class="panel">
          <div class="panel-head"><h2>最近收款與異動</h2><a class="small" href="#platform/billing">全部</a></div>
          ${logTable(d.log.slice(0, 6), true)}
        </section>
      </div>`);
  }

  const FILTERS = [["", "全部"], ["trial", "試用中"], ["paid", "年費有效"], ["soon", "30 天內到期"], ["expired", "已到期"], ["suspended", "已停用"], ["free", "免費"]];
  let pq = "";
  function viewStores(filter) {
    filter = filter || "";
    const all = DB.platform.data().stores;
    const match = s => !filter || (filter === "soon" ? isSoon(s) : s.billing.status === filter);
    const q = pq.trim().toLowerCase();
    let list = all.filter(match).filter(s => !q || [s.name, s.slug, ownerText(s), s.email].join(" ").toLowerCase().includes(q));
    if (filter === "soon") list = list.sort((a, b) => a.billing.daysLeft - b.billing.daysLeft);
    shell("stores", `
      <div class="page-head"><h1>商店</h1></div>
      <section class="panel">
        <nav class="tabs" aria-label="商店狀態">${FILTERS.map(([k, t]) => `<a href="#platform/stores${k ? "/" + k : ""}" class="${filter === k ? "is-on" : ""}">${t}<span class="n">${all.filter(s => !k || (k === "soon" ? isSoon(s) : s.billing.status === k)).length}</span></a>`).join("")}</nav>
        <div class="panel-head"><div class="toolbar"><input type="search" id="pq" placeholder="搜尋店名、代號、店主 Email" value="${esc(pq)}" aria-label="搜尋商店"></div></div>
        <div id="p-list">${storesTable(list, "沒有符合的商店")}</div>
      </section>`);
    const inp = document.getElementById("pq");
    inp.addEventListener("input", () => { pq = inp.value; const pos = inp.selectionStart; viewStores(filter); const n = document.getElementById("pq"); n.focus(); n.setSelectionRange(pos, pos); });
  }

  function viewStore(id) {
    const s = DB.platform.store(id);
    if (!s) return shell("stores", `<div class="panel"><div class="empty">找不到這家商店<div style="margin-top:12px"><a class="btn" href="#platform/stores">回商店列表</a></div></div></div>`);
    const d = DB.platform.data(), fee = +d.settings.annualFee || 0, b = s.billing;
    const log = d.log.filter(l => l.storeId === id);
    const url = DB.admin.storeUrl(s.slug);
    shell("stores", `
      <div class="page-head">
        <div><div class="crumbs"><a href="#platform/stores">商店</a> / ${esc(s.slug)}</div><h1>${esc(s.name)} ${Billing.pill(b)}</h1></div>
        <a class="btn" href="${esc(url)}#shop" target="_blank" rel="noopener">看前台 ↗</a>
      </div>
      <div class="grid-2">
        <section class="panel">
          <div class="panel-head"><h2>商店資料</h2></div>
          <div class="panel-body">
            <dl class="kv">
              <dt>網址</dt><dd><a class="mono" href="${esc(url)}" target="_blank" rel="noopener">${esc(url)}</a></dd>
              <dt>店主</dt><dd>${esc(ownerText(s))}</dd>
              <dt>客服</dt><dd>${esc(s.email || "—")}${s.phone ? ` · ${esc(s.phone)}` : ""}</dd>
              <dt>開店日</dt><dd>${date(s.createdAt)}</dd>
              <dt>方案</dt><dd>${esc(Billing.line(b))}</dd>
              <dt>規模</dt><dd>商品 ${s.products} · 會員 ${s.customers} · 訂單 ${s.orders}</dd>
              <dt>近 30 天</dt><dd>${s.orders30} 筆訂單 · 營收 ${money(s.revenue30)}${s.lastOrderAt ? ` · 最後下單 ${date(s.lastOrderAt)}` : ""}</dd>
            </dl>
            <div class="field"><label for="ps-note">平台備註（商家看不到）</label><textarea id="ps-note" rows="3" placeholder="例如：介紹人、聯絡紀錄">${esc(s.note)}</textarea></div>
            <div><button class="btn btn-sm" id="ps-note-save" type="button">儲存備註</button></div>
          </div>
        </section>
        <div style="display:grid;gap:16px">
          ${b.plan === "free" ? "" : `
          <section class="panel">
            <div class="panel-head"><h2>登記收到年費</h2></div>
            <form class="panel-body" id="pay-form" novalidate>
              <div class="grid-form">
                <div class="field"><label for="pay-years">年數</label><select id="pay-years">${[1, 2, 3].map(n => `<option value="${n}">${n} 年</option>`).join("")}</select></div>
                <div class="field"><label for="pay-amt">收到金額（NT$）</label><input type="number" id="pay-amt" min="0" step="1" value="${fee}"></div>
              </div>
              <div class="field"><label for="pay-note">備註</label><input type="text" id="pay-note" placeholder="例如：匯款末五碼 12345"></div>
              <div class="small muted" id="pay-preview"></div>
              <div><button class="btn btn-primary" type="submit">登記收款並延長</button></div>
            </form>
          </section>
          <section class="panel">
            <div class="panel-head"><h2>調整到期日</h2></div>
            <form class="panel-body" id="until-form" novalidate>
              <div class="grid-form">
                <div class="field"><label for="until-date">到期日</label><input type="date" id="until-date" value="${esc(b.activeUntil || "")}"></div>
                <div class="field"><label for="until-note">原因</label><input type="text" id="until-note" placeholder="例如：延長試用 7 天"></div>
              </div>
              <div><button class="btn" type="submit">更新到期日</button></div>
            </form>
          </section>`}
          <section class="panel">
            <div class="panel-head"><h2>方案與停用</h2></div>
            <div class="panel-body">
              <div class="toolbar"><label for="plan-sel" class="small muted">方案</label>
                <select id="plan-sel">${[["trial", "試用"], ["paid", "付費（年費）"], ["free", "免費（平台自營、合作夥伴）"]].map(([k, t]) => `<option value="${k}" ${b.plan === k ? "selected" : ""}>${t}</option>`).join("")}</select>
                <button class="btn btn-sm" id="plan-save" type="button">改方案</button></div>
              ${b.suspended
                ? `<div class="notice">停用中：${esc(b.suspendReason)}</div><div><button class="btn btn-primary" id="resume" type="button">恢復營業</button></div>`
                : `<div class="field"><label for="sus-reason">停用原因（商家後台會看到）</label><input type="text" id="sus-reason" placeholder="例如：違反使用條款"></div>
                   <div><button class="btn btn-danger" id="suspend" type="button">停用這家商店</button></div>`}
            </div>
          </section>
        </div>
      </div>
      <section class="panel">
        <div class="panel-head"><h2>收款與異動紀錄</h2></div>
        ${logTable(log, false)}
      </section>`);
    const act = async (btn, fn, okMsg) => {
      btn.disabled = true;
      try { const r = await fn(); toast(typeof okMsg === "function" ? okMsg(r) : okMsg); viewStore(id); }
      catch (e) { toast(e.message, "error"); btn.disabled = false; }
    };
    document.getElementById("ps-note-save").addEventListener("click", e => act(e.target, () => DB.platform.saveNote(id, document.getElementById("ps-note").value), "已儲存備註"));
    const pay = document.getElementById("pay-form");
    if (pay) {
      const years = document.getElementById("pay-years"), amt = document.getElementById("pay-amt"), pv = document.getElementById("pay-preview");
      const preview = () => {
        const today = d.today, cur = b.activeUntil;
        const from = cur && cur >= today ? addDays(cur, 1) : today;
        pv.textContent = `會延長為 ${ymd(from)} 到 ${ymd(addDays(addYears(from, +years.value), -1))}${b.status === "trial" && cur >= today ? "（接在試用結束後）" : ""}`;
      };
      years.addEventListener("change", () => { amt.value = fee * +years.value; preview(); });
      preview();
      pay.addEventListener("submit", e => {
        e.preventDefault();
        act(pay.querySelector("button[type=submit]"), () => DB.platform.recordPayment(id, years.value, amt.value, document.getElementById("pay-note").value),
          r => `已登記：${ymd(r.from)} ～ ${ymd(r.to)}`);
      });
      const uf = document.getElementById("until-form");
      uf.addEventListener("submit", e => {
        e.preventDefault();
        act(uf.querySelector("button[type=submit]"), () => DB.platform.setUntil(id, document.getElementById("until-date").value, document.getElementById("until-note").value), "已更新到期日");
      });
    }
    document.getElementById("plan-save").addEventListener("click", async e => {
      const v = document.getElementById("plan-sel").value;
      if (v === b.plan) return toast("方案沒有變");
      if (!(await confirmBox({ title: "改方案？", body: v === "free" ? "改成免費方案後，這家店不會到期。" : "改成試用或付費後，會依到期日決定是否營業。", ok: "確定改" }))) return;
      act(e.target, () => DB.platform.setPlan(id, v), "已改方案");
    });
    const sus = document.getElementById("suspend");
    if (sus) sus.addEventListener("click", async () => {
      const reason = document.getElementById("sus-reason").value.trim();
      if (!reason) return toast("請填寫停用原因", "error");
      if (!(await confirmBox({ title: `停用「${s.name}」？`, body: "前台會立刻暫停營業，顧客無法下單；商家還能登入後台看資料。之後可以隨時恢復。", ok: "停用", danger: true }))) return;
      act(sus, () => DB.platform.setSuspended(id, true, reason), "已停用");
    });
    const res = document.getElementById("resume");
    if (res) res.addEventListener("click", () => act(res, () => DB.platform.setSuspended(id, false, ""), "已恢復營業"));
  }
  const addDays = (ymdStr, n) => { const t = new Date(ymdStr + "T00:00:00Z"); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
  const addYears = (ymdStr, n) => { const t = new Date(ymdStr + "T00:00:00Z"); t.setUTCFullYear(t.getUTCFullYear() + n); return t.toISOString().slice(0, 10); };

  function viewBilling(kind) {
    const d = DB.platform.data();
    const list = kind === "payment" ? d.log.filter(l => l.kind === "payment") : d.log;
    const byYear = {};
    d.log.filter(l => l.kind === "payment").forEach(l => { const y = String(l.at).slice(0, 4); byYear[y] = (byYear[y] || 0) + l.amount; });
    shell("billing", `
      <div class="page-head"><h1>收款與異動</h1>
        <span class="small muted">${Object.keys(byYear).sort().reverse().map(y => `${y} 年收入 ${money(byYear[y])}`).join(" · ") || "還沒有收款"}</span></div>
      <section class="panel">
        <nav class="tabs"><a href="#platform/billing" class="${kind ? "" : "is-on"}">全部</a><a href="#platform/billing/payment" class="${kind === "payment" ? "is-on" : ""}">只看收款</a></nav>
        ${logTable(list, true)}
      </section>`);
  }

  function viewSettings() {
    const v = DB.platform.data().settings;
    shell("settings", `
      <div class="page-head"><h1>平台設定</h1><button class="btn btn-primary" id="pf-save" type="button">儲存設定</button></div>
      <section class="panel">
        <div class="panel-head"><h2>全部資料備份</h2></div>
        <div class="panel-body"><p class="muted" style="margin:0">匯出所有商店的商品、訂單、會員、庫存、進貨、平台設定與收款紀錄。檔案含個資與營運資料，請存放在安全的位置。</p>
          <div class="actions"><button class="btn" id="pf-backup" type="button">匯出平台全部資料（JSON）</button></div></div>
      </section>
      <section class="panel">
        <div class="panel-head"><h2>方案</h2></div>
        <div class="panel-body grid-form">
          <div class="field"><label for="pf-name">平台名稱</label><input type="text" id="pf-name" value="${esc(v.platformName)}"><span class="hint">顯示在平台首頁與總控台</span></div>
          <div class="field"><label for="pf-fee">年費（NT$）</label><input type="number" id="pf-fee" min="0" step="1" value="${esc(v.annualFee)}"></div>
          <div class="field"><label for="pf-trial">免費試用天數</label><input type="number" id="pf-trial" min="0" max="90" step="1" value="${esc(v.trialDays)}"><span class="hint">只影響之後新開的商店</span></div>
          <div class="field"><label for="pf-max">每個帳號最多開幾家店</label><input type="number" id="pf-max" min="1" max="20" step="1" value="${esc(v.maxStoresPerUser)}"></div>
          <label class="check"><input type="checkbox" id="pf-open" ${v.signupOpen ? "checked" : ""}> 開放商家自助開店</label>
        </div>
      </section>
      <section class="panel">
        <div class="panel-head"><h2>法律文件</h2><span class="small muted">顯示在平台首頁，開店與註冊時會要求同意</span></div>
        <div class="panel-body">
          <div class="field"><label for="pf-terms">服務條款</label><textarea id="pf-terms" rows="12" maxlength="20000">${esc(v.terms || "")}</textarea><span class="hint">最多 20,000 個字</span></div>
          <div class="field"><label for="pf-privacy">隱私權政策</label><textarea id="pf-privacy" rows="12" maxlength="20000">${esc(v.privacy || "")}</textarea><span class="hint">最多 20,000 個字</span></div>
        </div>
      </section>
      <section class="panel">
        <div class="panel-head"><h2>聯絡方式</h2><span class="small muted">商家要續約時會看到</span></div>
        <div class="panel-body grid-form">
          <div class="field"><label for="pf-email">聯絡 Email</label><input type="email" id="pf-email" value="${esc(v.contactEmail)}"></div>
          <div class="field"><label for="pf-line">LINE ID（選填）</label><input type="text" id="pf-line" value="${esc(v.contactLine)}"></div>
        </div>
      </section>`);
    document.getElementById("pf-save").addEventListener("click", async e => {
      const g = id => document.getElementById(id);
      e.target.disabled = true;
      try {
        await DB.platform.saveSettings({ platformName: g("pf-name").value, annualFee: g("pf-fee").value, trialDays: g("pf-trial").value,
          maxStoresPerUser: g("pf-max").value, signupOpen: g("pf-open").checked, contactEmail: g("pf-email").value, contactLine: g("pf-line").value,
          terms: g("pf-terms").value, privacy: g("pf-privacy").value });
        toast("已儲存平台設定"); viewSettings();
      } catch (err) { toast(err.message, "error"); e.target.disabled = false; }
    });
    const backup = document.getElementById("pf-backup");
    backup.addEventListener("click", async () => {
      backup.disabled = true; backup.textContent = "整理資料中…";
      try {
        const data = await DB.platform.exportData();
        download(new Blob([JSON.stringify(data, null, 2)], { type: "application/json;charset=utf-8" }), `平台完整備份_${new Date().toISOString().slice(0, 10)}.json`);
        toast("平台資料已匯出");
      } catch (err) { toast(err.message, "error"); }
      finally { if (backup.isConnected) { backup.disabled = false; backup.textContent = "匯出平台全部資料（JSON）"; } }
    });
  }

  window.PlatformApp = function (parts) {
    const [, page, arg] = parts;
    switch (page) {
      case undefined: return viewDash();
      case "stores": return viewStores(arg);
      case "store": return viewStore(arg);
      case "billing": return viewBilling(arg);
      case "settings": return viewSettings();
      default: return viewDash();
    }
  };
})();
