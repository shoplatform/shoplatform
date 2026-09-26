/* =========================================================
 * app.js — 啟動：依網址決定顯示「商家後台」或「商店前台」
 * 資料庫版：切頁前先 DB.ready() 載入資料；後台沒登入就顯示登入畫面
 * ========================================================= */
(function () {
  const { Router, esc } = window.UI;
  const app = () => document.getElementById("app");
  let seq = 0;

  Router.handlers.push(async parts => {
    const my = ++seq;
    const side = parts[0] === "shop" ? "shop" : "admin";
    document.querySelectorAll(".devbar a").forEach(a => a.classList.toggle("is-on", a.dataset.side === side));
    // 載入超過 0.3 秒才顯示「載入中」，避免畫面閃爍
    const slow = setTimeout(() => { if (my === seq) app().innerHTML = `<div class="loading" role="status">載入中…</div>`; }, 300);
    try {
      const st = await DB.ready(side);
      clearTimeout(slow);
      if (my !== seq) return; // 使用者已經切到別頁
      document.title = (side === "shop" ? "商店前台" : "商家後台") + "｜" + (DB.settings.get().name || "開店平台");
      const note = DB.takeNotice && DB.takeNotice();
      if (side === "admin" && st.state !== "ok") { window.AdminGate(st); }
      else { await (side === "shop" ? window.ShopApp(parts) : window.AdminApp(parts)); window.scrollTo(0, 0); }
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
  Promise.resolve(DB.boot && DB.boot()).then(() => Router.start("admin"), () => Router.start("admin"));
})();
