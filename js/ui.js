/* =========================================================
 * ui.js — 共用小工具：跳脫、格式化、提示訊息、確認視窗、路由、下載
 * ========================================================= */
(function () {
  const esc = s => String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

  const money = n => "NT$" + Math.round(n || 0).toLocaleString("zh-TW");

  const date = (iso, withTime) => {
    if (!iso) return "—";
    const d = new Date(iso);
    const p = n => String(n).padStart(2, "0");
    const s = `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())}`;
    return withTime ? `${s} ${p(d.getHours())}:${p(d.getMinutes())}` : s;
  };

  function toast(msg, kind) {
    let box = document.getElementById("toasts");
    if (!box) { box = document.createElement("div"); box.id = "toasts"; document.body.appendChild(box); }
    const t = document.createElement("div");
    t.className = "toast" + (kind === "error" ? " is-error" : "");
    t.setAttribute("role", "status");
    t.textContent = msg;
    box.appendChild(t);
    setTimeout(() => t.classList.add("is-out"), 2600);
    setTimeout(() => t.remove(), 3000);
  }

  /* 頁面內的確認視窗（不使用瀏覽器 confirm） */
  function confirmBox({ title, body, ok = "確定", danger = false }) {
    return new Promise(resolve => {
      const wrap = document.createElement("div");
      wrap.className = "modal-backdrop";
      wrap.innerHTML = `
        <div class="modal" role="dialog" aria-modal="true" aria-labelledby="m-title">
          <h3 id="m-title">${esc(title)}</h3>
          ${body ? `<p>${esc(body)}</p>` : ""}
          <div class="modal-actions">
            <button class="btn" data-a="no">取消</button>
            <button class="btn ${danger ? "btn-danger" : "btn-primary"}" data-a="yes">${esc(ok)}</button>
          </div>
        </div>`;
      document.body.appendChild(wrap);
      const done = v => { wrap.remove(); resolve(v); };
      wrap.addEventListener("click", e => {
        const a = e.target.closest("[data-a]");
        if (a) done(a.dataset.a === "yes");
        else if (e.target === wrap) done(false);
      });
      wrap.querySelector('[data-a="yes"]').focus();
    });
  }

  /* 讓瀏覽器下載一個檔案（Blob） */
  function download(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename; a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1500);
  }

  /* 簡單的 hash 路由：#admin/orders、#shop/p/p_cup */
  const Router = {
    current: "",
    handlers: [],
    parse(h) { return (h || "").replace(/^#/, "").split("/").filter(Boolean); },
    go(path) {
      this.current = path;
      try { if (location.hash.slice(1) !== path) history.pushState(null, "", "#" + path); } catch (e) { /* 預覽環境不支援時仍可切頁 */ }
      this.render();
    },
    start(defaultPath) {
      this.current = location.hash.slice(1) || defaultPath;
      window.addEventListener("hashchange", () => {
        const h = location.hash.slice(1);
        if (h && h !== this.current) { this.current = h; this.render(); }
      });
      window.addEventListener("popstate", () => {
        const h = location.hash.slice(1);
        if (h && h !== this.current) { this.current = h; this.render(); }
      });
      // 讓所有 <a href="#..."> 都走 Router.go
      document.addEventListener("click", e => {
        const a = e.target.closest('a[href^="#"]');
        if (!a || e.metaKey || e.ctrlKey) return;
        e.preventDefault();
        this.go(a.getAttribute("href").slice(1));
      });
      this.render();
    },
    render() { this.handlers.forEach(fn => fn(this.parse(this.current))); },
  };

  window.UI = { esc, money, date, toast, confirmBox, download, Router };
})();
