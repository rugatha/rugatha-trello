# 階段六正式站部署與補驗

> 2026-10-16 清理更新：依使用者授權，本文提及的本機 `attachments_export/` 備份與稽核檔已移除，階段六專用測試工具亦已移除。以下保留歷史執行紀錄，不代表相關本機檔案仍存在。

## 2026-10-11 測試看板清理

依使用者要求，20:06（Asia/Taipei）已移除「階段六驗證 20261010」及「階段六 Admin 範圍驗證 20261010」。使用 `scripts/remove-phase6-boards.cjs` 先核對固定 ID 與名稱，再備份、以 updateTime 前置條件原子移除 19 份文件（含 2 份附件上傳紀錄），清除 1 份會員文件中的測試看板授權，並以 generation／metageneration 前置條件刪除 2 個測試 Storage 物件。

私人修改前資料、兩個附件原始位元組及重讀驗證結果保存於 Git 忽略的 `attachments_export/maintenance/phase6-cleanup-2026-10-11T12-06-27-368Z/`。重讀確認：剩餘 7 個看板、其他看板文件及 Storage 物件未變；全部會員欄位符合預期，只有指定測試授權被移除；兩個已刪看板沒有殘留子文件。歷史 managementRequests 維持稽核紀錄。

以下是清理前的驗證紀錄。需使用隔離看板的正式測試已不能直接重跑，應先建立新的隔離測試環境並明確指定目標，不能改用歷史工作看板。

2026-10-10–11 驗證紀錄；每個完整項目通過後，立即更新 `to-do.md`。模擬器、localhost 連接正式 Firebase、GitHub Pages 實際工作階段分開記錄。

## 部署

- 依序更新 9 個 management codebase Functions、GitHub Pages 前端、Firestore 私人會員文件規則。
- Functions 9 個更新成功、0 個失敗。CLI 因尚無 Artifact Registry 自動清理政策而回傳非零；沒有使用 `--force` 擅自設定刪除政策。
- Pages 核對 `app.js`、`auth.js`、`index.html`、`style.css` 與正式驗證模組 SHA-256 一致；規則發布成功。
- GitHub Pages 部署與新增的 Regression and dependency review workflow 均成功。
- 新看板建立的權限訂閱可能先於 callable 回覆；修正此競態與重新載入後選取，並保留不同 Google 帳號的舊回覆隔離。
- Google 登入加上帳號選擇器，避免自動沿用唯一既有 Google 工作階段。

## 已取得證據

- 最新應用測試 103 項、Firestore 35 項、Storage 17 項、管理整合 31 項、附件生命週期 8 項通過。
- Firefox GitHub Pages：名單外與 Pending 無看板；直接看板讀取、顯示名冊與管理端點拒絕。
- Firefox GitHub Pages：一般會員及 Viewer 可讀本人會員文件；會員集合列出、他人私人文件、自行提高角色、管理私人名冊、建立看板、指派、牌卡／留言／待辦直接寫入與附件上傳遭拒。
- Firefox localhost 連接正式 Firebase 的 Owner：隔離看板建立及三個預設欄位、指派／取消、防重複重試、過期指派衝突、虛構邀請／核准／角色及看板調整／停用通過。
- 同一 localhost Owner：零附件初次省略、封存附件延遲查詢、復原計數 1 通過；測試附件再封存。

## 測試資料與帳號

只使用「階段六驗證 20261010」隔離看板，保留既有歷史看板與子文件。虚構邀請使用 `example.invalid`，沒有寄送郵件，測試後停用。新增牌卡、附件及看板採封存清理，不永久刪除。

使用者已明確同意將指定測試信箱暫時切換 Pending／Member／Viewer／Editor／Admin，只授權隔離測試看板。原會員與登入索引的備份位於 Git 忽略的私人維護目錄；完成後必須逐欄恢復原會員，移除該登入索引，維持使用者要求的名單外狀態。

既有 Google 帳號移除登入索引，只代表無索引情境；不能當作全新 Google 帳號首次 OAuth 登入。首次登入及多信箱驗證仍需要實際可登入的合適帳號。

## GitHub Pages 補驗紀錄

- Chrome 真實 Owner 工作階段：三欄看板、指派／同請求重試／取消、虛構邀請／核准／角色與範圍調整／停用、零附件延遲查詢及復原通過。
- Firefox 真實測試會員：Pending／Member／Viewer／Editor／Admin 的私人文件與管理端點矩陣通過；Admin 建立第二個隔離看板，只選本人與 Owner，建立後自動選取，Chrome Owner 可見。
- Owner 與 Admin 同時建立相同指派版本的草稿，Owner 先成功送出後，Admin 得到 `functions/aborted`；Editor／Viewer 無法呼叫指派端點。
- Owner 與 Editor 同時持有牌卡標題草稿，Owner 先送出後，Editor 過期草稿得到資料衝突拒絕。測試已等待非同步操作完成，避免把尚未建立的草稿誤認為衝突。
- Viewer 無重新整理即接收 Owner 新標題；實際拖曳未改變所在欄位，伺服器欄位一致；零附件封存清單可讀、復原按鈕停用。
- Editor 輸入未送出留言後降級 Viewer：編輯視窗即時關閉，重開留言輸入為空。撤銷主測試看板後只保留第二隔離看板；停用後所有內容清空；恢復授權後站內重新整理成功。受限 CLI 只調整已核准的測試會員及兩個隔離看板，角色變動由正式站訂閱接收。
- 既有測試帳號暫設空白名稱，再透過 Firefox「重讀會員」進入名稱設定；儲存後載入工作區成功。這是首次工作區設定的模擬，沒有刪除 Authentication 帳號，不能當作新 Google OAuth 或實際多信箱驗證。
- Editor 與 Owner 皆完成本人留言新增／更新／刪除、待辦新增／勾選／刪除、跨欄排序、過期資料拒絕及牌卡封存／復原；另一帳號訂閱觀察父牌卡計數與欄位變化。
- 早期一次 Editor 新增後立即重讀未找到新子文件，伺服器寫入存在。加入直接伺服器／載入計數診斷後，空白牌卡重現集合查詢回傳零筆，而直接文件讀取確認父計數 1／子文件存在。一次性載入改用同一 Firebase app 的 Firestore Lite REST 讀取，訂閱及交易維持完整 SDK；不依賴既有即時查詢視圖，沒有新增逐牌卡補讀或取消零計數省略。104 項單元回歸通過，包含舊即時查詢視圖仍為零的首次子文件重讀情境；已部署並以全新零筆牌卡連續兩輪 Firefox Editor 與一輪 Chrome Owner 的完整 CRUD／排序／封存回歸通過；直接伺服器計數與子文件再次核對，沒有用任意等待或重試掩蓋錯誤。

原測試牌卡的孤立測試子文件保留，最後採封存。自動核准審查拒絕清除子文件的 CLI 操作，理由是永久刪除不可由產品介面復原；沒有執行該操作，也不以其他方式清除這些子文件。

FireStore Lite 的 REST-only、無離線快取及無快照訂閱特性依據 [Firebase 官方文件](https://firebase.google.com/docs/firestore/solutions/firestore-lite)；既有查詢視圖重用是本次觀測及 [SDK snapshot-listener 實作](https://github.com/firebase/firebase-js-sdk/blob/main/packages/firestore/src/core/firestore_client.ts) 的推論，不宣稱已確認上游缺陷。

## 2026-10-11 資料與離線補驗

- 正式唯讀備份：1,612 份 Firestore 文件、221 個 Storage 物件（136,054,256 bytes），保存於 Git 忽略的私人維護目錄。備份為循序讀取，非跨服務原子快照；測試會員與測試牌卡另行核對最終狀態。
- 總數：8 看板、44 欄位、665 牌卡、483 待辦、73 留言、290 附件文件（含封存）。與 2026-10-10 維護備份比較，原 6 看板／38 欄位／662 牌卡／481 待辦／71 留言／288 附件共 1,546 文件逐欄完全一致，原 Storage 物件 SHA-256 零差異。多出的文件包含後續隔離測試資料，不以最初遷移數量作為現況總數。
- 新增唯讀 `scripts/audit-deployment-snapshot.cjs`，只接受私人維護快照路徑，只輸出計數與差異摘要。既有牌卡的有效子文件計數零錯誤；4 張舊牌卡缺少待辦／留言計數，但實際均為零，前端仍會查詢未定義計數的集合，本輪保留原資料。
- Firefox GitHub Pages 真實 Owner 工作階段抽查 3D：7 階段／10 張可見牌卡，標題、圖片及附件數與 Firestore 文件相符；隔離看板為 3 階段／3 牌卡。頁面顯示「已從 Firebase 載入」。
- 正式驗證頁「離線與重試」通過 SDK 伺服器讀取失敗／恢復連線重讀。但 SDK 的暫停控制不足以證明實際交易斷網；另外使用 Firefox「檔案 → 離線模式」驗證真正斷線。
- 離線修改隔離牌卡標題：先顯示儲存中並鎖住操作，失敗後顯示「上次儲存失敗，變更未寫入：Connection failed.；畫面已還原」，牌卡回到原標題。恢復 Firefox 上線後，錯誤沒有自行消失；重新提交相同修改成功，重載同步後可見新標題。最後透過介面還原測試前原標題，顯示「已儲存至 Firebase」，唯讀伺服器重查確認一致。
- `npm test`：104 項通過、0 失敗。本輪沒有修改產品程式、規則或 Functions；延續已部署版本補驗。`index.html`、`app.js`、`auth.js`、`storage.js`、`style.css` 與正式驗證模組六份線上檔案 SHA-256 均與本機一致。

## 2026-10-11 名稱與首次工作區補驗

- 依使用者指定的第一個真實 Google 帳號，暫設空白名稱及隔離看板 Viewer。Chrome GitHub Pages 既有工作階段自動進入名稱設定，儲存後工作區成功載入；Firefox 使用 Google 帳號選擇器重新登入同一信箱，顯示已儲存的會員名稱，不被 Google 名稱覆蓋。
- 同一信箱在 Firefox 修改名稱後，Chrome 主頁未重新載入即更新；兩端 Viewer 寫入控制維持停用。
- 第一輪結束後，CLI 重讀確認會員所有欄位與原備份一致、臨時登入索引不存在；兩瀏覽器即時清空看板並顯示未取得權限。
- 使用者另指定原 Owner 信箱作為第二個真實登入信箱。新增受限 `scripts/phase6-alias-test.cjs`，先將原索引／會員文件保存在 Git 忽略的私人維護目錄，再以版本前置條件原子調整索引。只暫時對應到第一個測試會員的單一隔離看板 Viewer；原 Owner 會員文件未修改，沒有新增 OAuth 帳號或憑證。
- Firefox 第一信箱、Chrome 第二信箱分別以真實 Google 工作階段取得同一測試會員：名稱、Viewer 角色及單一看板一致；第二信箱修改名稱後，Firefox 第一信箱未重新整理即更新。此為實際多信箱索引／登入驗證，非虛構信箱或模擬器。
- 完成後原子還原，伺服器逐欄重讀確認測試會員與第二信箱原索引完全一致、第一信箱臨時索引不存在，原 Owner 會員文件完全未變；私人前置快照保留供稽核。Firefox 第一信箱即時清空看板，Chrome 第二信箱站內重新整理後恢復 Owner、原看板與編輯控制。
- 全新 Google 帳號首次 OAuth 登入仍未完成。兩個指定信箱皆曾登入過本網站，本輪沒有刪除 Google 或 Firebase Authentication 帳號；空白名稱、移除索引與重新登入均不代表首次 OAuth。`to-do.md` 已拆分首次工作區、跨瀏覽器、多信箱與全新 OAuth，前三者完成即勾選，最後一項保留未完成；沒有開始其他階段。
