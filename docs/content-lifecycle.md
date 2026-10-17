# Admin 封存與永久刪除

2026-10-11 實作與驗證紀錄。部署採 Firebase 發布規則及 Functions，再推送 GitHub Pages 的 `main` 分支。正式會員資料已完成一次性更新：芸樺改為昀樺；雨嶸與 Jim 沿用歷史會員 ID 連結使用者指定的 Google 信箱，啟用為 Editor，取得目前五個未封存看板的權限。私人修改前資料及逐欄驗證在被 Git 忽略的 `attachments_export/maintenance/member-updates-2026-10-11T12-09-25-133Z/`。

## 操作入口

- 看板：Admin 開啟看板右上角「⋯」設定，選擇封存或復原。已封存看板仍可從側欄「封存看板」選取，再開啟設定永久刪除。
- 牌卡：詳情右側「封存卡片」保留資料。開啟「封存項目」，Admin 可對封存牌卡選擇永久刪除；原有有效編輯角色的牌卡封存／復原功能保留。
- 永久刪除要求先封存並輸入完整名稱。名稱不符不會送出請求；後端再次核對最新名稱及封存狀態。未完成時顯示錯誤並可重試。
- 刪除看板會移除全部階段、牌卡及子集合、正式附件與既有暫存附件，以及所有會員中的該看板授權。刪除牌卡只移除該牌卡及其子資料與附件，保留其他牌卡、看板與授權。外部 URL 不會被呼叫或刪除。

## 後端與併發處理

`manageContentLifecycle` 驗證 Firebase 已驗證信箱、工作空間 lookup、有效 Admin 角色與目標看板權限；沒有硬編碼特定信箱或信任前端傳入角色。Owner／Editor／Viewer／一般會員及未登入、未核准、停用帳號均不能使用此端點。

封存與復原在 Firestore 交易完成；相同 requestId 的同一操作可以重試，不同內容不能重用識別碼。刪除先將目標標記為 `deleting`，交易保留目標名稱及可信任的工作收據。規則禁止用戶建立、改寫或清除刪除鎖，也禁止在鎖定的看板／牌卡下寫入。上傳與管理後端同樣檢查刪除鎖；客戶端仍不可直接永久刪除看板或牌卡。

先將相關上傳工作標為 expired，清理從目標 ID 推導出的 Storage 路徑，再以 Admin SDK 遞迴刪除所有子集合（包含缺少父文件的孤兒子集合）。清理成功前保留鎖定的父文件，途中失敗可以重新確認相同名稱，使用原或新 requestId 重試。最後才刪父文件並將工作收據標為完成。Firestore 與 Storage 不是跨服務原子交易，因此途中可以看見刪除中的唯讀內容；它不能復原或繼續編輯。

看板授權使用 `arrayRemove` 移除單一 ID，保留會員的其他授權、角色、信箱與狀態。Storage 範圍只由已驗證 ID 組合，忽略附件文件內不可信的 storagePath 或外部 URL。刪除途中才完成的正式附件上傳會回查父文件並清掉孤兒物件；更晚送出的暫存 bytes 不會發布，可由既有每日暫存清理按時效移除。expired 上傳紀錄與管理收據保留作為拒絕舊請求及稽核依據。

參考：[Firestore recursiveDelete](https://googleapis.dev/nodejs/firestore/latest/Firestore.html#recursiveDelete)、[Storage Bucket](https://docs.cloud.google.com/nodejs/docs/reference/storage/latest/storage/bucket)。

## 部署與驗證

部署順序：先發布新版 Firestore 規則，更新既有 `setManagedAssignees`、`saveManagedMembership`、`beginAttachmentUpload`、`finishAttachmentUpload` 的刪除鎖驗證，再部署新增的 `manageContentLifecycle`，最後切換前端。Callable 的 HTTP invocation 開放供瀏覽器 CORS 使用，實際權限仍由 Firebase Auth 與 Admin 檢查控制；逾時 540 秒，前端使用相同等待時間。

本機檢查：

- `npm test`：112 項通過，含 Admin 表單與權限控制。
- `npm run test:content`：7 項 Firestore＋Storage 整合通過，涵蓋權限、封存／復原、永久刪除、孤兒子集合、隔離其他資料、失敗重試、撤權及附件上傳競態。
- Chrome `tests/browser/owner-lifecycle.html`：11 項記憶體介面流程通過；不連接正式 Firebase。以 `python3 scripts/serve-phase5-test.py` 啟動測試伺服器後開啟該頁。
- Firestore／Storage 規則、管理 callable、附件及刪除整合回歸：99 項通過；最後補驗 7 項 Admin callable／規則／清理測試通過。
- 最終 `npm run test:rules`：38 項通過，包括不能偽造／解除刪除鎖、Admin 專屬看板封存及原子複製牌卡與待辦。上述測試不代表新端點或前端已上線。


2026-10-17 角色定義已交換：`admin` 為全站管理員，`owner` 為授權看板範圍的管理者；必須保留至少一位有效 admin。會員 ID 不隨角色更名而變更。
