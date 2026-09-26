/* =========================================================
 * app.js — 啟動：依網址決定顯示「商家後台」或「商店前台」
 * 資料庫版：切頁前先 DB.ready() 載入資料；後台沒登入就顯示登入畫面
 * ========================================================= */
(function () {
  const { Router, esc } = window.UI;
  const app = () => document.getElementById("app");
  let seq = 0;

  const SIDES = ["shop", "admin", "platform", "home"];
  Router.handlers.push(async parts => {
    const my = ++seq;
    let side = SIDES.includes(parts[0]) ? parts[0] : "admin";
    // 離線示範版沒有平台這一層
    if (DB.mode !== "remote" && (side === "home" || side === "platform")) {
      if (side === "home") return Router.go("admin");
      app().innerHTML = `<div class="loading"><div class="load-err"><b>平台總控台只在正式版（資料庫版）使用</b><p>離線示範版只有一家商店。</p><a class="btn" href="#admin">回商家後台</a></div></div>`;
      return;
    }
    document.querySelectorAll(".devbar a").forEach(a => a.classList.toggle("is-on", a.dataset.side === side));
    // 載入超過 0.3 秒才顯示「載入中」，避免畫面閃爍
    const slow = setTimeout(() => { if (my === seq) app().innerHTML = `<div class="loading" role="status">載入中…</div>`; }, 300);
    try {
      const st = await DB.ready(side);
      clearTimeout(slow);
      if (my !== seq) return; // 使用者已經切到別頁
      const platformName = (DB.home && DB.home.info().platformName) || "開店平台";
      document.title = side === "shop" ? `${DB.settings.get().name || "商店"}` : side === "admin" ? `商家後台｜${DB.settings.get().name || platformName}`
        : side === "platform" ? `平台總控台｜${platformName}` : platformName;
      const note = DB.takeNotice && DB.takeNotice();
      if ((side === "admin" || side === "platform") && st.state !== "ok") { window.AdminGate(Object.assign({ side }, st), parts); }
      else {
        const App = { shop: window.ShopApp, admin: window.AdminApp, platform: window.PlatformApp, home: window.HomeApp }[side];
        await App(parts); window.scrollTo(0, 0);
      }
      // Email 連結回來的提示（例如「信箱已確認」）
      if (note) window.UI.toast(note.text, note.kind === "error" ? "error" : undefined);
    } catch (err) {
      clearTimeout(slow);
      if (my !== seq) return;
      app().innerHTML = `<div class="loading"><div class="load-err"><b>暫時無法載入</b><p>${esc(err.message)}</p>
        <button class="btn" onclick="location.reload()">重新整理</button></div></div>`;
    }
  });
  // 從 Email 連結回來時，先換好登入狀態、改好網址，再開始顯示畫面
  // 預設頁面：正式版有 ?store= 就是那家店的前台，沒有就是平台首頁；離線示範版是商家後台
  const first = () => DB.mode !== "remote" ? "admin" : new URLSearchParams(location.search).get("store") ? "shop" : "home";
  Promise.resolve(DB.boot && DB.boot()).then(() => Router.start(first()), () => Router.start(first()));
})();
