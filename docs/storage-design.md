# 附件與 Firebase Storage

## 路徑與可信任完成

正式物件沿用 `workspaces/main/boards/{boardId}/cards/{cardId}/attachments/{attachmentId}/{filename}`；客戶端禁止建立、覆寫、改 metadata 或刪除正式物件。

新附件先呼叫 `beginAttachmentUpload`，以登入 UID 與 requestId 雜湊建立獨立上傳工作。原檔暫存於 `uploads/{memberId}/{boardId}/{cardId}/{sessionId}/{filename}`。暫存物件不可由客戶端讀取、覆寫或刪除；只有有效 Owner／Admin／Editor 且具看板權限者可新增。

`finishAttachmentUpload` 重新確認會員、看板和牌卡狀態，核對大小、MIME、metadata 與檔頭／內容格式，以 generation 前置條件建立正式物件。最後在 Firestore transaction 中再次核對權限、工作狀態，建立附件並更新父牌卡實際 `attachmentCount`、`updatedAt`、`updatedBy`。重複／並行完成只計數一次，已完成工作不重傳；失敗重試沿用原 requestId，內容變更則拒絕。

正式附件記錄保存 `name`、`type`、`size`、`storageBucket`、`storagePath`、`createdBy`、`createdAt`、`archived`。新物件沒有下載 token；Cache-Control 為 `private, no-store`。檔名移除斜線與控制字元，原顯示名稱另存於 Firestore。

## 檔案限制

每檔大於 0 bytes、最多 20 MiB（包含上限）。允許 PNG、JPEG、GIF、WebP、AVIF、PDF、UTF-8 純文字、ZIP、GLB、STL；不接受 HTML、SVG、JavaScript、通用 octet-stream。GLB／STL 可依副檔名補 MIME，但可信任端仍驗證內容。格式檢查不是完整病毒掃描，也不代表 ZIP 內含檔案皆可信任。既有遷移檔案不受新上傳類型／大小限制，不會因此被刪除。

Storage 規則核對 metadata 僅含 `uploadedBy`、`boardId`、`cardId`、`attachmentId` 且與路徑一致。規則透過信箱索引與會員文件判定角色／看板權限；牌卡是否有效則由可信任完成端點檢查。

## 清理與封存

`cleanupAttachmentUploads` 每 24 小時處理建立超過 24 小時的工作。先在 transaction 將未完成工作標為 expired，再刪除其暫存及未關聯正式物件；完成工作的正式檔案保留。過期墓碑保留，遲到重試不可復活。另分頁掃描 `uploads/` 清除無工作記錄且超過 24 小時的物件，刪除時帶 generation 前置條件。

封存牌卡／附件只改 Firestore，保留原檔，已授權會員仍可讀取；復原不用重傳。不存在或已封存的牌卡／看板不能完成新上傳。一般客戶端不能實體刪除牌卡或原檔；管理端實體刪除牌卡不會自動刪除歷史附件，避免誤刪與失去還原來源。

## 授權預覽與下載

前端使用 Firebase SDK `getBlob`，不使用 `getDownloadURL` 或 Firestore 的舊 token URL。圖片與下載採短期 Blob URL；重新渲染移除圖片時釋放，下載後釋放，帳號／會員授權變更時取消正在上傳的工作並釋放全部 URL。延遲完成的圖片讀取不得重新建立可用 URL；舊帳號的批次不得繼續下一個檔案。

2026-10-09 已設定 CORS：允許 `https://rugatha.github.io`、`http://localhost:8765`、`http://127.0.0.1:8765` 的 GET／HEAD。CORS 不授予資料存取权，仍需 Firebase 身分與 Storage 規則。參考 [Firebase SDK 下載與 CORS](https://firebase.google.com/docs/storage/web/download-files)。

`node scripts/storage-auth-cutover.cjs` 預設唯讀核對 218 個遷移檔案的大小／MD5；備份寫入忽略追蹤、0600 權限的 `attachments_export/migration/storage-auth-cutover/`。`--apply-cors` 只更新 CORS；`--apply-tokens` 以 generation／metageneration 前置條件移除舊 token、設定 no-store，並以 Firestore updateTime 前置條件移除舊 `url` 欄位。外部連結不變。`--verify-denied` 驗證原 token 連結失效。參考 [Cloud Storage metadata 前置條件](https://docs.cloud.google.com/storage/docs/request-preconditions)。

必須先發布並驗證前端授權讀取，再執行 token 撤銷。舊網頁分頁需重新載入新版；已下載至装置的副本無法收回。正式切換與驗證記錄見 [附件生命週期](attachment-lifecycle.md)。

## 本機驗證

使用 Node 24、Java 21：

```sh
npm test
npm run test:rules
npm run test:storage-rules
npm run test:attachments
```

模擬器僅使用 `demo-rugatha-trello`。Firefox 開啟 `tests/browser/attachments.html`，測試重試、批次隔離、Viewer 阻擋、圖片解碼、實際下載與 Blob 釋放。正式角色存取必須另行驗證，不能以模擬器代替。
