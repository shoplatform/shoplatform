# AGENTS.md — 給 AI 程式助理（Codex 等）的工作守則

這個檔案放在 repository 根目錄，AI 助理開工前會先讀。完整藍圖在 `docs/藍圖.md`。

## 專案一句話
台灣的電商開店 SaaS（含進銷存）：商家付固定年費、平台不抽成。專案擁有者是平台方，**不是工程師**，所有說明、介面文字都要用白話的繁體中文（台灣用語）。

## 絕對不能做
- 不要把 Supabase 的 Secret key／service_role、資料庫密碼放進任何檔案或 commit。`js/config.js` 裡的 Publishable key（`sb_publishable_…`）本來就是公開金鑰，可以留著。
- 這是獨立專案：不要出現任何金融、投資、資產配置相關的品牌名稱或內容。
- 不要引入框架或打包工具（React、Vue、webpack、Vite…）。這是純 HTML／CSS／JavaScript，直接用 GitHub Pages 發布。
- 不要讓前端直接讀寫資料表。所有資料都透過 `supabase/schema.sql` 裡的函式（RPC）。
- 不要刪掉或改壞既有功能；改完要跑測試（見下方）。

## 架構重點
- 入口：`index.html`（正式版，連 Supabase）、`demo.html`（離線示範版，資料存在瀏覽器 localStorage）。
- 網址：平台首頁（不帶參數）、商店前台 `?store=<代號>#shop/...`、商家後台 `#admin/...`、平台總控台 `#platform/...`。hash 路由在 `js/ui.js`，分派在 `js/app.js`。
- **頁面只跟 `window.DB` 說話**。有兩個實作，介面必須一致：
  - `js/db.js`：Supabase 版。讀取是同步的（先 `DB.ready(side)` 把資料載進快取），寫入是 `async`、呼叫 RPC 後重新載入快取。
  - `js/db-local.js`：離線示範版，同樣的函式名稱與回傳格式。
  - 新增資料功能時，**兩個檔案都要加**（離線版可以簡化，但不能讓頁面壞掉）；只有資料庫版才有的功能用 `DB.features.xxx` 或 `DB.mode === "remote"` 判斷。
- 頁面：`js/admin.js`（商家後台）、`js/shop.js`（商店前台）、`js/platform.js`（平台首頁、總控台、方案狀態）、`js/theme.js`（佈景主題）、`js/importer.js`（商品 Excel 匯入規則）、`js/xlsx.js`（讀寫 Excel，不靠套件）。
- 樣式：`css/base.css`（共用、顏色變數、深色模式）、`css/admin.css`、`css/shop.css`（前台，顏色用 `--s-*` 變數，佈景主題會覆蓋）。

## 資料庫（supabase/schema.sql）規則
- 整份檔案要**可以重複執行**，而且能把任何舊版資料庫升級上來、不丟資料：用 `create table if not exists`、`alter table … add column if not exists`、`create or replace function`、`on conflict do nothing`。
- 每張新資料表都要加進檔案前段「全部上鎖」的陣列（開 RLS、revoke anon/authenticated）。
- 函式命名：`shop_*` 前台（anon 可呼叫，只回公開資料）、`admin_*` 商家後台、`platform_*` 平台管理者、`setup_*` 只能在 SQL Editor 執行、`_*` 內部小工具。新函式一定要加進檔案最後面的 `grant execute` 清單。
- 後台函式第一行做權限檢查：`perform _require_perm(p_store, '<權限>')`（orders／customers／products／inventory／marketing／reports／settings），只有店主能做的用 `_require_owner(p_store)`。沒有 inventory 或 reports 權限的人不能看到成本（`_can_see_cost`）。
- 金額、折扣、庫存一律在伺服器算，不信任瀏覽器送來的價格。改庫存要用 `_log_move(...)` 記異動。
- 防濫用：用 `_rate_hit(bucket, key, 次數, 時間)`。如果「失敗的嘗試」也要計次，函式要回傳 `null` 而不是 `raise`（raise 會把計次一起復原）。
- `language sql` 的函式在建立時就會檢查裡面呼叫的函式／資料表，所以要放在它們後面。
- 錯誤訊息用白話中文（會直接顯示給商家或顧客）。
- 檔案開頭的版本註解、最後一行 `select '完成：資料庫是 vX.Y 版'` 要一起更新。

## 改版時要一起改的地方
版本號出現在：`supabase/schema.sql`（開頭與最後一行）、`js/db.js` 開頭註解、`js/admin.js` 側欄的 `vX.Y · 資料庫已連線／離線示範版`、`js/platform.js` 的 `vX.Y · 平台管理者`、`README.md` 標題與「新增」段落。

## 測試
- `test/` 有一台「模擬 Supabase」（`fake-supabase.js`：Auth、RPC、Storage、Email 確認連結），接本機 PostgreSQL 16，用真正的 `@supabase/supabase-js` 呼叫。
- 執行：`cd test && npm install && bash run-all.sh`（預設連 127.0.0.1:55432、使用者 postgres，可用 PGHOST／PGPORT／PGUSER 改）。全部要顯示「0 失敗」。
- 新增伺服器功能時，加一個 `test/api-testN.js`（照既有檔案的寫法），並加進 `run-all.sh`：至少測「正常流程、欄位檢查、沒權限的人會被擋下、資料表不能直接讀」。
- 介面改動要在 1280px 和 390px 寬（手機）看過：不能有橫向捲軸、瀏覽器 console 不能有錯誤，`index.html` 和 `demo.html` 都要能用。

## 交付給擁有者
擁有者用 GitHub 網頁的 Upload files 上傳，並把 `schema.sql` 貼到 Supabase SQL Editor 執行。每次交付請附：
1. 這次改了什麼（白話、條列）。
2. 要不要重跑 `schema.sql`（要的話，執行後應該看到的那一行字）。
3. 要上傳哪些檔案／資料夾。
