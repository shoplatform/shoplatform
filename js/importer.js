/* =========================================================
 * importer.js — 商品 Excel 匯出／匯入（前台後台共用的規則）
 *
 * 一列 = 一個規格。同一個商品的規格排在一起，商品名稱相同。
 * 欄位：商品ID｜商品名稱｜狀態｜分類｜商品描述｜規格1名稱｜規格1選項｜規格2名稱｜規格2選項｜規格3名稱｜規格3選項｜貨號｜售價｜成本｜庫存
 *  ‧有「商品ID」= 更新這個商品；沒有 = 新增商品
 *  ‧庫存只用在新增的規格（期初庫存）；已經有的規格要改庫存請用「進銷存 → 盤點」
 *  ‧檔案裡沒列出的規格不會被刪掉
 * plan() 只算出要改什麼、檢查錯誤，不會寫入；確認後再用 DB.products.saveMany() 存。
 * ========================================================= */
(function () {
  const COLS = ["商品ID", "商品名稱", "狀態", "分類", "商品描述", "規格1名稱", "規格1選項", "規格2名稱", "規格2選項", "規格3名稱", "規格3選項", "貨號", "售價", "成本", "庫存"];
  const ALIAS = { "商品名稱": ["名稱", "品名", "商品"], "商品描述": ["描述", "說明"], "售價": ["價格", "單價"], "貨號": ["sku", "SKU"], "庫存": ["數量"] };
  const MAX_OPTS = 3;

  function exportRows(products, categories, withCost) {
    const catName = id => (categories.find(c => c.id === id) || {}).name || "";
    const header = COLS.filter(c => withCost || c !== "成本");
    const rows = [];
    products.forEach(p => p.variants.forEach(v => {
      const opt = [];
      for (let k = 0; k < MAX_OPTS; k++) { const o = (p.options || [])[k]; opt.push(o ? o.name : "", o ? (v.options || {})[o.name] || "" : ""); }
      const r = [p.id, p.name, p.status === "active" ? "上架" : "草稿", p.categoryIds.map(catName).filter(Boolean).join("、"), p.description || "", ...opt, v.sku || "", v.price];
      if (withCost) r.push(v.cost || 0);
      r.push(v.stock);
      rows.push(r);
    }));
    return { header, rows };
  }

  const num = s => { s = String(s == null ? "" : s).replace(/[,\s，NT$元]/g, ""); if (s === "") return null; const n = Number(s); return Number.isFinite(n) ? n : NaN; };
  const key = o => JSON.stringify(Object.keys(o).sort().map(k => [k, o[k]]));

  function plan(rows, { products, categories, canCost }) {
    const errors = [], notes = [];
    if (!rows.length) return { errors: [{ row: 1, msg: "檔案是空的" }], payloads: [], changes: [], summary: {} };
    const head = rows[0].map(h => String(h || "").trim());
    const col = {};
    COLS.forEach(c => {
      let i = head.indexOf(c);
      if (i < 0) (ALIAS[c] || []).some(a => (i = head.indexOf(a)) >= 0);
      if (i >= 0) col[c] = i;
    });
    if (col["商品名稱"] === undefined || col["售價"] === undefined) {
      return { errors: [{ row: 1, msg: "第一列要是欄位名稱，至少要有「商品名稱」和「售價」。可以先按「匯出 Excel」拿範本" }], payloads: [], changes: [], summary: {} };
    }
    const hasCost = canCost && col["成本"] !== undefined;
    const cell = (r, c) => col[c] === undefined ? "" : String(r[col[c]] == null ? "" : r[col[c]]).trim();

    // 分組：同一個商品的列放一起
    const groups = new Map();
    rows.slice(1).forEach((r, i) => {
      const rowNo = i + 2;
      if (!r.some(x => String(x || "").trim())) return;
      const id = cell(r, "商品ID"), name = cell(r, "商品名稱");
      if (!id && !name) return errors.push({ row: rowNo, msg: "缺商品名稱" });
      const k = id ? "id:" + id : "new:" + name;
      if (!groups.has(k)) groups.set(k, { id, name, rows: [] });
      groups.get(k).rows.push({ r, rowNo });
    });
    if (!groups.size && !errors.length) errors.push({ row: 2, msg: "沒有資料列" });
    if (groups.size > 500) errors.push({ row: 1, msg: "一次最多匯入 500 個商品，請分批" });

    const payloads = [], changes = [];
    const summary = { createProducts: 0, updateProducts: 0, newVariants: 0, changedVariants: 0, rows: [...groups.values()].reduce((a, g) => a + g.rows.length, 0) };
    const catByName = {}; categories.forEach(c => { catByName[c.name.trim()] = c.id; });

    groups.forEach(g => {
      const first = g.rows[0];
      const rowErr = (row, msg) => errors.push({ row, msg: `「${g.name || g.id}」${msg}` });
      const existing = g.id ? products.find(p => p.id === g.id) : null;
      if (g.id && !existing) return rowErr(first.rowNo, "的商品ID找不到（可能已經刪除）。要新增商品請把商品ID清空");
      if (!g.id && products.some(p => p.name === g.name)) return rowErr(first.rowNo, "已經有同名的商品。要更新請保留「商品ID」欄；要新增請改一個名稱");
      const name = cell(first.r, "商品名稱") || (existing && existing.name) || "";
      if (name.length > 60) return rowErr(first.rowNo, "名稱超過 60 個字");
      // 狀態
      const st = cell(first.r, "狀態");
      let status = existing ? existing.status : "draft";
      if (st) {
        if (/^(上架|上架中|active|是|y|yes|1)$/i.test(st)) status = "active";
        else if (/^(草稿|下架|draft|否|n|no|0)$/i.test(st)) status = "draft";
        else return rowErr(first.rowNo, `的狀態「${st}」看不懂，請填「上架」或「草稿」`);
      }
      // 分類
      const cs = cell(first.r, "分類");
      let categoryIds = existing ? existing.categoryIds.slice() : [];
      if (cs) {
        const names = cs.split(/[、,，;；]/).map(x => x.trim()).filter(Boolean);
        const miss = names.filter(n => !catByName[n]);
        if (miss.length) return rowErr(first.rowNo, `的分類「${miss.join("、")}」不存在，請先到「商品 → 分類」建立`);
        categoryIds = names.map(n => catByName[n]);
      }
      const description = cell(first.r, "商品描述") || (existing ? existing.description : "");
      // 規格名稱
      const optNames = [];
      for (let k = 1; k <= MAX_OPTS; k++) { const n = cell(first.r, `規格${k}名稱`); if (n) optNames.push(n); }
      for (const { r, rowNo } of g.rows) {
        for (let k = 1; k <= MAX_OPTS; k++) {
          const n = cell(r, `規格${k}名稱`);
          if (n && n !== optNames[k - 1]) return rowErr(rowNo, `同一個商品的「規格${k}名稱」要一樣（第一列是「${optNames[k - 1] || "空白"}」）`);
        }
      }
      if (new Set(optNames).size !== optNames.length) return rowErr(first.rowNo, "的規格名稱重複");
      if (existing) {
        const was = (existing.options || []).map(o => o.name);
        if (was.join("|") !== optNames.join("|")) return rowErr(first.rowNo, `的規格名稱要跟原本一樣（原本：${was.join("、") || "沒有規格"}）。要改規格請到商品頁`);
      }
      if (!optNames.length && g.rows.length > 1) return rowErr(g.rows[1].rowNo, "沒有規格名稱，只能有一列。有多個規格請填「規格1名稱／規格1選項」");

      // 每一列 → 規格
      const seen = new Set(), vars = [];
      let bad = false;
      for (const { r, rowNo } of g.rows) {
        const combo = {};
        optNames.forEach((n, i) => { combo[n] = cell(r, `規格${i + 1}選項`); });
        if (optNames.some(n => !combo[n])) { rowErr(rowNo, `缺「${optNames.find(n => !combo[n])}」的選項`); bad = true; break; }
        const k = key(combo);
        if (seen.has(k)) { rowErr(rowNo, `有重複的規格（${Object.values(combo).join(" / ")}）`); bad = true; break; }
        seen.add(k);
        const price = num(cell(r, "售價"));
        if (price === null || Number.isNaN(price) || price < 0 || !Number.isInteger(price)) { rowErr(rowNo, `的售價「${cell(r, "售價")}」要是 0 以上的整數`); bad = true; break; }
        const cost = hasCost ? num(cell(r, "成本")) : null;
        if (cost !== null && (Number.isNaN(cost) || cost < 0)) { rowErr(rowNo, "的成本要是 0 以上的數字"); bad = true; break; }
        const stock = num(cell(r, "庫存"));
        if (stock !== null && (Number.isNaN(stock) || stock < 0 || !Number.isInteger(stock))) { rowErr(rowNo, "的庫存要是 0 以上的整數"); bad = true; break; }
        vars.push({ combo, k, sku: cell(r, "貨號"), price, cost: cost === null ? null : Math.round(cost), stock, rowNo });
      }
      if (bad) return;

      // 組出要存的商品
      const options = optNames.map(n => {
        const old = existing ? (existing.options.find(o => o.name === n) || { values: [] }).values.slice() : [];
        vars.forEach(v => { if (!old.includes(v.combo[n])) old.push(v.combo[n]); });
        return { name: n, values: old };
      });
      const outVars = [];
      let changed = 0, added = 0, stockNotes = 0;
      const used = new Set();
      if (existing) {
        existing.variants.forEach(ev => {
          const hit = vars.find(v => v.k === key(ev.options || {}));
          if (!hit) { outVars.push({ id: ev.id, sku: ev.sku, options: ev.options, price: ev.price, cost: ev.cost, stock: ev.stock, stockDelta: 0 }); return; }
          used.add(hit.k);
          const nv = { id: ev.id, sku: hit.sku || ev.sku, options: ev.options, price: hit.price, cost: hit.cost === null ? ev.cost : hit.cost, stock: ev.stock, stockDelta: 0 };
          if (nv.sku !== ev.sku || nv.price !== ev.price || (hasCost && nv.cost !== ev.cost)) changed++;
          if (hit.stock !== null && hit.stock !== ev.stock) stockNotes++;
          outVars.push(nv);
        });
      }
      vars.filter(v => !used.has(v.k)).forEach(v => {
        added++;
        outVars.push({ id: null, sku: v.sku, options: v.combo, price: v.price, cost: v.cost || 0, stock: v.stock || 0, stockDelta: v.stock || 0 });
      });
      if (stockNotes) notes.push(`「${name}」有 ${stockNotes} 個規格的庫存跟目前不同，匯入不會改已經有的規格庫存（請用「進銷存 → 盤點」）`);
      const fieldsChanged = existing && (existing.name !== name || existing.status !== status || existing.description !== description || existing.categoryIds.join() !== categoryIds.join());
      if (existing && !changed && !added && !fieldsChanged) return;   // 沒有變化就跳過
      payloads.push({
        id: existing ? existing.id : null, name, description, status, color: existing ? existing.color : "", categoryIds, options,
        images: existing ? existing.images || [] : [], publishAt: existing ? existing.publishAt || null : null, unpublishAt: existing ? existing.unpublishAt || null : null,
        variants: outVars,
      });
      if (existing) { summary.updateProducts++; summary.changedVariants += changed; summary.newVariants += added; }
      else { summary.createProducts++; summary.newVariants += added; }
      changes.push({ kind: existing ? "update" : "create", name, detail: existing
        ? [fieldsChanged ? "商品資料" : "", changed ? `${changed} 個規格改價格／貨號${hasCost ? "／成本" : ""}` : "", added ? `新增 ${added} 個規格` : ""].filter(Boolean).join("、")
        : `${outVars.length} 個規格・${status === "active" ? "上架" : "草稿"}` });
    });
    return { errors, notes, payloads: errors.length ? [] : payloads, changes, summary };
  }

  window.ProductImport = { COLS, exportRows, plan };
})();
