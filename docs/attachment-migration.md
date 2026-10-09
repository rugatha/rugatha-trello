# Trello 附件遷移

來源：`attachments_export/trello-backup/manifest.json`。以 Trello 看板、牌卡、附件 ID 對應 Firestore，不使用名稱猜測。使用者指定略過 Socials，176 筆附件仍保留於本機備份。

|看板|上傳檔案|保留外部連結|
|---|---:|---:|
|3D|43|0|
|Design|36|0|
|Illustration|137|2|
|Map|2|0|
|World Building|0|67|
|合計|218|69|

目的 bucket：`rugatha-trello.firebasestorage.app`。物件以 `workspaces/main/boards/{boardId}/cards/{cardId}/attachments/{trelloAttachmentId}/{filename}` 分層。`.url.txt` 是外部網站連結備份，牌卡繼續使用原網址，不將文字檔當作原附件。

遷移會保存原始網址為 `sourceUrl`，更新既有附件的 `url`、`storagePath`、`storageBucket`、`type`、`size`、`migrationStatus`、`external`。保留附件名稱、封存狀態及封面 ID。3D 備份中較新的 5 筆附件會新增到原牌卡，透過同一原子提交遞增 `attachmentCount`。父牌卡 `updatedAt` 的更新會觸發現有看板訂閱重新載入。

使用 Firebase 下載 token URL，現有前端即可顯示圖片與開啟附件；持有完整連結者可下載。沒有開放整個 bucket 的公開讀取。前端的 Storage 標籤調整為本機程式碼變更，雲端附件連結本身不需要部署新版前端。

## 執行

在專案目錄登入具專案管理權限的 Firebase CLI 帳號，再執行：

```sh
# 本機檔案完整性檢查，無網路與雲端寫入
node scripts/migrate-trello-attachments.cjs --local-only
# 唯讀對應檢查
node scripts/migrate-trello-attachments.cjs --skip-board=Socials
# 上傳並更新正式附件資料
node scripts/migrate-trello-attachments.cjs --skip-board=Socials --apply
# 唯讀檢查附件連結、外部網址及牌卡附件計數
node scripts/verify-trello-attachments.cjs
```

上傳採最多四個並行工作。使用 Storage `ifGenerationMatch=0` 防止覆寫；重跑時驗證既有物件 MD5 與大小並重用。每個檔案以牌卡實際使用的下載 URL 下載並比對 MD5，確認後才更新 Firestore。既有附件更新有 `updateTime` 前置條件；新附件使用 `exists:false`。遇到衝突停止，已完成部分可重跑接續。

本機 `attachments_export/migration/` 保存對應計畫、每筆修改前資料及驗證結果；此目錄已由 `.gitignore` 排除，內含私人附件連結，不提交版本庫。遷移腳本不刪除原檔或雲端物件。

API 行為參考：[Cloud Storage objects.insert](https://docs.cloud.google.com/storage/docs/json_api/v1/objects/insert)。

## 2026-10-07 執行結果

已完成正式資料遷移：5 個看板、160 張牌卡，218 個檔案上傳且逐檔下載校驗通過，69 個外部連結保持原網址。最後唯讀核對時間為 2026-10-07 10:51 UTC，全部 287 筆附件的對應、Storage 欄位與牌卡附件數量均通過，錯誤為 0。Socials 176 筆依使用者指示略過。既有 56 項應用測試全數通過。

2026-10-07 11:49 UTC 唯讀複核：160 張牌卡、218 檔案及 69 外部連結的中繼資料與附件計數均通過，錯誤 0。P2 Storage 規則及 token 切換限制另見 [Storage 設計](storage-design.md)。

## 2026-10-08 外部連結檢查

依使用者明確授權，對 69 筆既有外部附件送出不含 Firebase 憑證的唯讀 HTTP GET。67 筆回應成功；HTTP 成功只代表可取得頁面，沒有宣稱完整內容已人工逐項校對。

Illustration 看板的 Stefano 牌卡（`66251c646c0ea6b5f43215cb`）有兩筆附件指向同一個原始網頁，均回應 HTTP 404，需提供替代網址或重新上傳原檔：

- `66251c696918119ecba3e4c2`
- `66251c7c1c1f2b2722965b2e`

未變更或刪除這兩筆附件。逐筆網址、狀態與時間保存在忽略追蹤的 `attachments_export/migration/external-link-audit.json`。
