# 階段四附件生命週期驗證

2026-10-09 接續既有附件實作；範圍止於階段四。

## 本機結果

- 93 項應用測試通過，包含 6 項附件 SDK 客戶端測試：完成重試、遺失上傳回應、撤權取消、延遲圖片拒絕、Blob URL 釋放。
- 34 項 Firestore 規則測試通過。
- 17 項 Storage 規則測試通過，含暫存不可讀／覆寫、正式路徑不可由客戶端建立、角色矩陣、撤權、20 MiB／MIME／metadata 限制及封存保留。
- 8 項後端生命週期測試通過：原子計數、重複／並行完成、格式拒絕、撤權與重試、牌卡封存／刪除、過期清理與已完成原檔保留；包含遲到的並行完成及尚未上傳的重試前置條件。
- Firefox 18 項介面測試通過；已觀察 1×1 PNG 正常解碼，以及下載面板顯示 attachment-test.png（68 bytes）已完成。

修正：上傳 request payload 以欄位值比對，不受 Firestore map 欄位順序影響；並行完成清掉暫存後，遲到請求重新確認完成狀態；帳號切換停止舊批次；上傳中選檔不能覆蓋佇列。

## 正式切換

- CORS 已限定 GitHub Pages 與 localhost:8765 測試來源。
- 218 個遷移物件逐檔大小／MD5 校驗通過，原 token 中繼資料已私人備份。
- 附件 begin／finish／每日 cleanup 及前端相依 Functions 已部署，9 個 Functions 均確認 ACTIVE；Storage 規則已發布。
- Firebase CLI 的 non-interactive 模式會跳過跨服務 IAM 設定。本輪經使用者明確核准，已將 `roles/firebaserules.firestoreServiceAgent` 授予本專案 Storage 服務帳號，IAM 重讀確認存在；原 IAM 政策已私人備份。工具 `scripts/ensure-storage-cross-service.cjs` 預設唯讀，`--apply` 才修改。
- Functions 部署最後提示 Artifact Registry 尚無映像清理政策；函式均已 ACTIVE，映像清理屬後續維護，不影響附件端點。
- 前端 `0d0de28` 與正式驗證頁補強 `ea2168c` 已發布至 GitHub Pages；HTTP 重讀附件客戶端及測試程式 SHA-256 與本機一致。
- 本輪重跑 93 項應用、17 項 Storage 規則、8 項後端生命週期與 Firefox 18 項介面測試，全部通過。
- 正式附件端點起初遭 Cloud Run IAM 拒絕，瀏覽器只取得 `functions/internal`。已重新部署 begin／finish 及 Storage 規則；目前 Firebase callable manifest 不會帶出 `invoker` 選項，故另經使用者明確同意，以 `scripts/ensure-attachment-invoker.cjs --apply` 僅對這兩個服務補上 `allUsers` 的 `roles/run.invoker`，原 IAM 已私人備份。這是 callable 的 HTTP 入口；程式仍驗證 Firebase 身分、會員、角色與看板權限。重讀確認兩服務 IAM 生效，GitHub Pages／localhost 的 OPTIONS 回應 204，匿名 POST 回應 `UNAUTHENTICATED`。參考 [callable 協定](https://firebase.google.com/docs/functions/callable-reference)。
- Firefox 的 GitHub Pages 正式 Viewer：成功解碼 148×296 圖片、實際下載 WEBP；`beginAttachmentUpload` 回應 permission-denied。
- Firefox 的 localhost:8765 連接正式 Firebase Owner：上傳 68-byte PNG、相同 requestId 重試後計數仍為 1、新圖片實際解碼及下載完成、封存牌卡拒絕新增附件、封存後原檔仍可授權讀取。成功測試牌卡 `phase4-test-b3a1672c-c571-456e-b650-850e59e4da23` 已封存；前兩次受 IAM 拒絕的測試牌卡也已由 finally 封存，沒有刪除既有資料。
- 經使用者同意，暫時移除測試 Viewer 的 Design 看板權限；GitHub Pages 即時清除預覽，對原先讀過的 Storage 路徑再次 `getBlob` 回應 storage/unauthorized，其他授權看板仍可載入。隨即使用 updateTime 前置條件還原；伺服器重讀逐欄確認與備份一致。工具 `scripts/verify-storage-access.cjs` 預設唯讀，`--revoke`／`--restore` 才修改，私人證據位於 `attachments_export/migration/storage-access-probe/`。
- 已執行 `node scripts/storage-auth-cutover.cjs --apply-tokens --verify-denied`：218 個遷移檔案逐檔大小／MD5 一致、剩餘 token 為 0、218 個原 token URL 全部遭拒、錯誤為 0；Storage 改為 `private, no-store`，Firestore 移除舊 Firebase `url` 欄位。原始 token／文件備份保留於忽略追蹤的私人目錄。
- token 撤銷後，Firefox 的 GitHub Pages 正式主畫面仍能從牌卡附件按鈕下載 `Ian_Portrait.jpg`；下載面板確認已完成 718 KB，圖片預覽正常，Viewer 上傳／封存按鈕停用。正式驗證頁亦已觀察撤權還原後再次解碼同一圖片成功。
- 遷移記錄複核：160 張牌卡、218 個 Storage 檔案、69 個外部連結，附件計數與中繼資料錯誤為 0。原本 2 個外部 404 連結仍沿用既有盤點，不在 token 切換中改寫來源。
- 階段四全部勾選完成，本輪停止於階段四；階段五、六的未完成項目保留。
