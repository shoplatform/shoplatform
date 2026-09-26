/* =========================================================
 * theme.js — 商店外觀（佈景主題）
 *   配色預設組合、自訂主色（自動算按鈕文字顏色與對比）、
 *   首頁版型、每列商品數、圖片比例、字體、公告列、Logo
 * 前台與後台的「外觀」頁共用。設定存在 settings.theme。
 * ========================================================= */
(function () {
  // 每組都有淺色與深色兩套；深色是另外挑的顏色，不是直接反轉
  const P = (name, l, d) => ({ name, light: l, dark: d });
  const c = (bg, surface, ink, muted, line, accent, accentInk, soft) => ({ bg, surface, ink, muted, line, accent, accentInk, soft });
  const PRESETS = {
    warm: P("暖米", c("#f6f3ee", "#fffdfa", "#2a2622", "#756c63", "#e2dbd1", "#3f5d56", "#ffffff", "#ebe4d9"),
      c("#1a1816", "#221f1c", "#ece6de", "#a89e93", "#37322d", "#8fbfb3", "#13201d", "#2c2824")),
    forest: P("森林", c("#f3f6f2", "#fcfdfb", "#1f2a22", "#5b695f", "#d8e0d6", "#2f6b45", "#ffffff", "#e2ebdf"),
      c("#141a16", "#1b231d", "#e4ece5", "#9aab9e", "#2c3a30", "#7cc79a", "#102016", "#223027")),
    ocean: P("海洋", c("#f2f5f8", "#fdfeff", "#1b2530", "#5a6876", "#d6dee7", "#1f5f99", "#ffffff", "#e0e9f3"),
      c("#121820", "#19212b", "#e3eaf2", "#98a7b6", "#2a3643", "#7fb2e6", "#0e1a26", "#1f2a36")),
    rose: P("玫瑰", c("#faf4f4", "#fffcfc", "#2e2224", "#76606a", "#ecdcdd", "#a23f55", "#ffffff", "#f3e3e5"),
      c("#1c1516", "#241c1d", "#f0e4e5", "#b39ea1", "#3d2e30", "#e897a8", "#2a1016", "#2e2224")),
    sun: P("暖陽", c("#fbf6ee", "#fffdf9", "#2b2418", "#72644c", "#eadfcb", "#a44f17", "#ffffff", "#f4e7d2"),
      c("#1b1611", "#241d16", "#f1e7da", "#b3a38c", "#3b3025", "#f0a26b", "#2a1606", "#2d241b")),
    mono: P("墨黑", c("#f5f5f4", "#ffffff", "#1c1c1c", "#626262", "#e0e0de", "#1c1c1c", "#ffffff", "#ebebe9"),
      c("#121212", "#1b1b1b", "#eeeeee", "#a0a0a0", "#333333", "#eeeeee", "#121212", "#262626")),
  };
  const LAYOUTS = [["grid", "簡潔格狀", "店名與介紹，下面直接是商品"], ["banner", "大橫幅", "上方一塊主色橫幅放標語，適合有活動、有主打"], ["magazine", "雜誌風", "第一個商品放大介紹，其他排在下面"]];
  const DEFAULTS = { preset: "warm", accent: "", layout: "grid", cols: 4, ratio: "square", font: "sans", notice: "", heroTitle: "", heroText: "", logo: null };

  /* ---------- 顏色計算 ---------- */
  const hexOk = h => /^#[0-9a-f]{6}$/i.test(h || "");
  const rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  const toHex = a => "#" + a.map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("");
  const lum = h => { const [r, g, b] = rgb(h).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const mix = (a, b, t) => toHex(rgb(a).map((v, i) => v + (rgb(b)[i] - v) * t));
  // 按鈕文字：白或近黑，選對比比較高的那個
  const inkFor = h => (contrast(h, "#ffffff") >= contrast(h, "#161616") ? "#ffffff" : "#161616");
  // 深色模式的主色：往白色調亮，直到在深色背景上夠清楚
  function darkAccent(h, bg) {
    let out = h;
    for (let t = 0; t <= 0.8 && contrast(out, bg) < 4.5; t += 0.1) out = mix(h, "#ffffff", t);
    return out;
  }

  function normalize(t) {
    const o = Object.assign({}, DEFAULTS, t || {});
    if (!PRESETS[o.preset]) o.preset = "warm";
    if (!hexOk(o.accent)) o.accent = "";
    if (!LAYOUTS.some(l => l[0] === o.layout)) o.layout = "grid";
    o.cols = [2, 3, 4].includes(+o.cols) ? +o.cols : 4;
    if (!["square", "portrait"].includes(o.ratio)) o.ratio = "square";
    if (!["sans", "serif"].includes(o.font)) o.font = "sans";
    return o;
  }

  // 算出這個主題的顏色（淺色、深色各一套）
  function palette(t) {
    t = normalize(t);
    const base = PRESETS[t.preset];
    const light = Object.assign({}, base.light), dark = Object.assign({}, base.dark);
    if (t.accent) {
      light.accent = t.accent; light.accentInk = inkFor(t.accent);
      dark.accent = darkAccent(t.accent, dark.surface); dark.accentInk = inkFor(dark.accent);
    }
    return { light, dark };
  }
  // 自訂主色的可讀性檢查（連結文字在白底上要夠清楚）
  function check(t) {
    const p = palette(t);
    const c1 = contrast(p.light.accent, p.light.surface);
    return { ratio: c1, ok: c1 >= 4.5, weak: c1 >= 3 && c1 < 4.5 };
  }

  // 前台最外層要加的 class 與 style
  function attrs(t) {
    t = normalize(t);
    const p = palette(t);
    const keys = ["bg", "surface", "ink", "muted", "line", "accent", "accentInk", "soft"];
    const css = k => k.replace(/[A-Z]/g, m => "-" + m.toLowerCase());
    const style = keys.map(k => `--l-${css(k)}:${p.light[k]};--d-${css(k)}:${p.dark[k]}`).join(";");
    const cls = `themed layout-${t.layout} cols-${t.cols} ratio-${t.ratio} font-${t.font}`;
    return { cls, style, theme: t };
  }

  let serifLoaded = false;
  function useFont(t) {
    if (normalize(t).font !== "serif" || serifLoaded) return;
    serifLoaded = true;
    const l = document.createElement("link");
    l.rel = "stylesheet";
    l.href = "https://fonts.googleapis.com/css2?family=Noto+Serif+TC:wght@400;600;700&display=swap";
    document.head.appendChild(l);
  }

  window.Theme = { PRESETS, LAYOUTS, DEFAULTS, normalize, palette, attrs, check, contrast, inkFor, useFont };
})();
