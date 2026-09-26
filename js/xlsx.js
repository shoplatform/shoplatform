/* =========================================================
 * xlsx.js — 不靠任何外部套件，產生真正的 Excel 檔（.xlsx）
 *
 * .xlsx 其實是一個 zip 壓縮檔，裡面放幾個 XML 檔。
 * 這裡用「不壓縮」的 zip 格式把它們包起來，Excel、Numbers、
 * Google 試算表都打得開。
 *
 * 用法：
 *   const blob = XLSX.build([{
 *     name: "訂單",
 *     columns: [{ header: "訂單編號", width: 14 }, { header: "金額", type: "number" }],
 *     rows: [["SO240001", 1420]],
 *   }]);
 * 欄位 type：text（預設）、number（千分位）、datetime（放 Date 或 ISO 字串）
 * ========================================================= */
(function () {
  const enc = new TextEncoder();

  /* ---------- XML 工具 ---------- */
  const xmlEsc = s => String(s == null ? "" : s)
    // 移除 XML 不允許的控制字元
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  function colName(i) { // 0 → A、25 → Z、26 → AA
    let s = "";
    for (i += 1; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s;
    return s;
  }
  function excelDate(v) { // 轉成 Excel 的日期序號（以本地時間為準）
    const d = v instanceof Date ? v : new Date(v);
    if (isNaN(d)) return null;
    return (d.getTime() - d.getTimezoneOffset() * 60000) / 86400000 + 25569;
  }
  const sheetNameOk = s => String(s).replace(/[\[\]:*?\/\\]/g, " ").slice(0, 31) || "Sheet";

  // 樣式編號（對應 styles.xml 的 cellXfs 順序）
  const ST = { text: 0, header: 1, number: 2, datetime: 3 };

  function sheetXml({ columns, rows }) {
    const cell = (ref, v, type, header) => {
      if (v == null || v === "") return "";
      if (header) return `<c r="${ref}" t="inlineStr" s="${ST.header}"><is><t xml:space="preserve">${xmlEsc(v)}</t></is></c>`;
      if (type === "number" && typeof v === "number" && isFinite(v)) return `<c r="${ref}" s="${ST.number}"><v>${v}</v></c>`;
      if (type === "datetime") {
        const n = excelDate(v);
        if (n != null) return `<c r="${ref}" s="${ST.datetime}"><v>${n}</v></c>`;
      }
      return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlEsc(v)}</t></is></c>`;
    };
    const lastCol = colName(columns.length - 1);
    const all = [columns.map(c => c.header)].concat(rows);
    const body = all.map((r, ri) =>
      `<row r="${ri + 1}">${r.map((v, ci) => cell(colName(ci) + (ri + 1), v, (columns[ci] || {}).type, ri === 0)).join("")}</row>`
    ).join("");
    const cols = columns.map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.width || 12}" customWidth="1"/>`).join("");
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<dimension ref="A1:${lastCol}${all.length}"/>
<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
<sheetFormatPr defaultRowHeight="16"/>
<cols>${cols}</cols>
<sheetData>${body}</sheetData>
${rows.length ? `<autoFilter ref="A1:${lastCol}${all.length}"/>` : ""}
</worksheet>`;
  }

  const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy/mm/dd hh:mm"/></numFmts>
<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE8EDEC"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="4">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
<xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

  function workbookFiles(sheets) {
    const n = sheets.length;
    const range = Array.from({ length: n }, (_, i) => i + 1);
    return [
      ["[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
${range.map(i => `<Override PartName="/xl/worksheets/sheet${i}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("\n")}
</Types>`],
      ["_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`],
      ["xl/workbook.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets>${sheets.map((s, i) => `<sheet name="${xmlEsc(sheetNameOk(s.name))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets>
${sheets.some(s => s.rows.length) ? `<definedNames>${sheets.map((s, i) => s.rows.length ? `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${xmlEsc(sheetNameOk(s.name))}'!$A$1:$${colName(s.columns.length - 1)}$${s.rows.length + 1}</definedName>` : "").join("")}</definedNames>` : ""}
</workbook>`],
      ["xl/_rels/workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${range.map(i => `<Relationship Id="rId${i}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i}.xml"/>`).join("\n")}
<Relationship Id="rId${n + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`],
      ["xl/styles.xml", STYLES],
      ...sheets.map((s, i) => [`xl/worksheets/sheet${i + 1}.xml`, sheetXml(s)]),
    ];
  }

  /* ---------- 不壓縮的 zip ---------- */
  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(bytes) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }
  function zip(files) {
    const parts = [], central = [];
    let offset = 0;
    const now = new Date();
    const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
    const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
    files.forEach(([name, text]) => {
      const nameBytes = enc.encode(name);
      const data = enc.encode(text);
      const crc = crc32(data);
      const local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true); local.setUint16(6, 0x0800, true);
      local.setUint16(8, 0, true); local.setUint16(10, dosTime, true); local.setUint16(12, dosDate, true);
      local.setUint32(14, crc, true); local.setUint32(18, data.length, true); local.setUint32(22, data.length, true);
      local.setUint16(26, nameBytes.length, true); local.setUint16(28, 0, true);
      parts.push(new Uint8Array(local.buffer), nameBytes, data);

      const cen = new DataView(new ArrayBuffer(46));
      cen.setUint32(0, 0x02014b50, true); cen.setUint16(4, 20, true); cen.setUint16(6, 20, true); cen.setUint16(8, 0x0800, true);
      cen.setUint16(10, 0, true); cen.setUint16(12, dosTime, true); cen.setUint16(14, dosDate, true);
      cen.setUint32(16, crc, true); cen.setUint32(20, data.length, true); cen.setUint32(24, data.length, true);
      cen.setUint16(28, nameBytes.length, true); cen.setUint32(42, offset, true);
      central.push(new Uint8Array(cen.buffer), nameBytes);
      offset += 30 + nameBytes.length + data.length;
    });
    const cenSize = central.reduce((s, b) => s + b.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
    end.setUint32(12, cenSize, true); end.setUint32(16, offset, true);
    return new Blob([...parts, ...central, new Uint8Array(end.buffer)],
      { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  }

  /* ---------- 讀 Excel（.xlsx）：只讀第一張工作表，回傳一列一列的陣列 ----------
   * .xlsx 是 zip：用瀏覽器內建的 DecompressionStream 解壓縮，再讀裡面的 XML。 */
  async function inflate(bytes) {
    const ds = new DecompressionStream("deflate-raw");
    const out = await new Response(new Blob([bytes]).stream().pipeThrough(ds)).arrayBuffer();
    return new Uint8Array(out);
  }
  async function unzip(buf) {
    const u8 = new Uint8Array(buf), dv = new DataView(buf);
    let eocd = -1;
    for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) { if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; } }
    if (eocd < 0) throw new Error("這不是 Excel 檔（.xlsx），請另存成 .xlsx 或 .csv 再試");
    const count = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    const files = {}, dec = new TextDecoder();
    for (let n = 0; n < count; n++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true);
      const nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
      const local = dv.getUint32(p + 42, true);
      const name = dec.decode(u8.subarray(p + 46, p + 46 + nlen));
      const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
      files[name] = { method, data: u8.subarray(start, start + csize) };
      p += 46 + nlen + xlen + clen;
    }
    return async name => {
      const f = files[name]; if (!f) return null;
      const bytes = f.method === 0 ? f.data : f.method === 8 ? await inflate(f.data) : null;
      if (!bytes) throw new Error("Excel 檔的壓縮格式不支援，請另存成 .csv 再試");
      return new TextDecoder().decode(bytes);
    };
  }
  const xml = t => new DOMParser().parseFromString(t, "application/xml");
  const colIdx = ref => { let n = 0; for (const ch of ref.replace(/\d+$/, "")) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };
  async function readXlsx(buf) {
    if (!window.DecompressionStream) throw new Error("這個瀏覽器太舊，無法讀 Excel，請改用 .csv 或換新版 Chrome／Safari");
    const get = await unzip(buf);
    const wb = xml(await get("xl/workbook.xml") || "");
    const first = wb.getElementsByTagName("sheet")[0];
    if (!first) throw new Error("Excel 檔裡沒有工作表");
    const rid = first.getAttribute("r:id") || first.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id");
    const rels = xml(await get("xl/_rels/workbook.xml.rels") || "<x/>");
    let target = "worksheets/sheet1.xml";
    [...rels.getElementsByTagName("Relationship")].forEach(r => { if (r.getAttribute("Id") === rid) target = r.getAttribute("Target"); });
    target = target.replace(/^\/?xl\//, "").replace(/^\//, "");
    const shared = [];
    const sst = await get("xl/sharedStrings.xml");
    if (sst) [...xml(sst).getElementsByTagName("si")].forEach(si => shared.push([...si.getElementsByTagName("t")].map(t => t.textContent).join("")));
    const sheet = xml(await get("xl/" + target) || "");
    const rows = [];
    [...sheet.getElementsByTagName("row")].forEach(row => {
      const r = (+row.getAttribute("r") || rows.length + 1) - 1;
      const cells = [];
      [...row.getElementsByTagName("c")].forEach(c => {
        const t = c.getAttribute("t"), v = c.getElementsByTagName("v")[0];
        let val = "";
        if (t === "s") val = shared[+(v && v.textContent)] || "";
        else if (t === "inlineStr") val = [...c.getElementsByTagName("t")].map(x => x.textContent).join("");
        else if (t === "b") val = v && v.textContent === "1" ? "TRUE" : "FALSE";
        else val = v ? v.textContent : "";
        cells[colIdx(c.getAttribute("r") || "A")] = val;
      });
      rows[r] = Array.from(cells, x => x === undefined ? "" : String(x));
    });
    return Array.from(rows, x => x || []);
  }
  // CSV（Excel「另存新檔 → CSV UTF-8」）
  function readCsv(text) {
    text = text.replace(/^﻿/, "");
    const rows = []; let row = [], cur = "", q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) { if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
      else if (ch === '"') q = true;
      else if (ch === ",") { row.push(cur); cur = ""; }
      else if (ch === "\n" || ch === "\r") { if (ch === "\r" && text[i + 1] === "\n") i++; row.push(cur); rows.push(row); row = []; cur = ""; }
      else cur += ch;
    }
    if (cur !== "" || row.length) { row.push(cur); rows.push(row); }
    return rows;
  }
  async function read(file) {
    const name = (file.name || "").toLowerCase();
    if (name.endsWith(".csv")) return readCsv(await file.text());
    if (name.endsWith(".xls")) throw new Error("舊版 Excel（.xls）不支援，請另存成 .xlsx 再匯入");
    return readXlsx(await file.arrayBuffer());
  }

  window.XLSX = { build: sheets => zip(workbookFiles(sheets)), read, readCsv };
})();
