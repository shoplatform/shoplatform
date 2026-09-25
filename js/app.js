/* =========================================================
 * app.js — 啟動：依網址決定顯示「商家後台」或「商店前台」
 * ========================================================= */
(function () {
  const { Router } = window.UI;
  Router.handlers.push(parts => {
    const side = parts[0] === "shop" ? "shop" : "admin";
    document.querySelectorAll(".devbar a").forEach(a => a.classList.toggle("is-on", a.dataset.side === side));
    document.title = (side === "shop" ? "商店前台" : "商家後台") + "｜" + DB.settings.get().name;
    if (side === "shop") window.ShopApp(parts); else window.AdminApp(parts);
    window.scrollTo(0, 0);
  });
  Router.start("admin");
})();
