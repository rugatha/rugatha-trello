# P2 附件與 Storage 設計

## 檔案與資料關聯

沿用遷移路徑：`workspaces/{workspaceId}/boards/{boardId}/cards/{cardId}/attachments/{attachmentId}/{filename}`。新附件使用隨機唯一 ID；替換檔案建立新附件，不覆寫舊路徑。前端應移除檔名中的斜線、控制字元，保留原始顯示名稱於 Firestore。只支援單層檔名；規則不開放任意子路徑或目錄列舉。

Firestore 牌卡下 `attachments/{attachmentId}` 保存 `name`、`type`、`size`、`storageBucket`、`storagePath`、`createdBy`、`createdAt`、`archived`。父牌卡保存 `attachmentCount`、`coverId`，附件建立／封存／復原時透過 transaction 更新計數與父牌卡 `updatedAt`，沿用即時同步。外部連結保存 `url`、`external: true`；遷移附件另保留 `sourceUrl` 與 `migrationStatus`，不把來源網址當成已驗證可讀。

Storage 新物件的自訂 metadata 必须只有 `uploadedBy`（會員 ID）、`boardId`、`cardId`、`attachmentId`，且與登入會員／路徑一致。既有管理遷移物件的 metadata 不改寫；讀取不以新上傳 metadata 格式為條件。

## 新上傳限制

- 每檔大於 0 bytes、最多 20 MiB（20 × 1024 × 1024 bytes，包含上限）。這是新客戶端上傳限制，不回頭刪除或限制既有大檔案的讀取。
- 允許 MIME：`image/png`、`image/jpeg`、`image/gif`、`image/webp`、`image/avif`、`application/pdf`、`text/plain`、`application/zip`、`model/gltf-binary`、`model/stl`。
- 不接受 HTML、SVG、JavaScript 或通用 `application/octet-stream`。GLB／STL 等瀏覽器未提供明確 MIME 的檔案，未來上傳流程應由可信任驗證判斷格式，不只依副檔名放行。
- 規則只能核對宣告的 MIME、大小及 metadata，無法判斷檔案位元內容；上傳功能正式開放前，仍須處理格式驗證與未完成上傳的檔案清理。

## 權限與生命週期

`storage.rules` 透過 Firestore 的信箱索引與會員文件判斷權限，使用原有 `accessboard`，不新增第二份授權清單。有效且信箱已驗證的會員可讀取授權看板中的物件；Owner／Admin／Editor 可新增合規物件，Viewer／一般會員唯讀。所有客戶端皆不可覆寫、改 metadata、刪除檔案或列舉目錄。未登入、未核准、停用及無看板權限者拒絕存取。

每次授權讀取信箱索引與會員兩份文件，符合 Storage 跨服務規則的兩份文件上限；不能再依賴第三份牌卡文件判定封存狀態。規則校驗路徑與 metadata 的一致性，不保證牌卡／附件文件存在，也不禁止往已封存牌卡的路徑新增物件。未來上傳完成流程須由可信任端核對牌卡有效性及物件，再建立附件紀錄；失敗或離線留下的未關聯物件由管理流程清理。**前端上傳仍未開放，這部分尚未實作。** 跨服務行為見 [Firebase 官方說明](https://firebase.blog/posts/2022/09/announcing-cross-service-security-rules/) 與 [規則限制](https://firebase.google.com/docs/rules/rules-behavior)。

封存牌卡／附件只改 Firestore，保留檔案與既有授權成員的檔案讀取；復原不用重傳。實體刪除仍須管理端先備份並檢查參照，不提供客戶端刪除入口。

## 下載 token 與尚未完成的切換

現有 218 個遷移檔案使用下載 token URL。2026-10-07 11:56 UTC 抽驗 3D 的一個檔案：無登入但保留 token 時 HTTP 200、735096 bytes、MD5 與本機備份一致；移除 token 後 HTTP 403。這表示 bucket 未直接公開，但已取得完整 token URL 者仍可下載；修改會員或 Storage 規則不等於使既有連結失效。

要完成「撤權即禁止後續下載」，仍須把預覽／下載改為驗證 Firebase 身分的 SDK 讀取，處理 CORS 與 Blob URL 的釋放，再由管理流程移除／撤銷物件的下載 token。新物件也須避免長期保留可繞過會員檢查的 token URL。切換須先完成正式站預覽／下載驗證；本輪沒有變更任何 token 或既有 URL。已下载至使用者裝置的副本無法靠撤權收回。

## 測試與部署狀態

```sh
PATH=/opt/homebrew/opt/node@24/bin:/opt/homebrew/opt/openjdk@21/bin:$PATH npm run test:storage-rules
```

此指令使用 `demo-rugatha-trello`，同時啟動 Firestore（8080）與 Storage（9199）本機模擬器，不連接正式 bucket。16 項測試涵蓋角色矩陣、已驗證／未驗證信箱、缺少會員、跨看板、信箱大小寫與多信箱、20 MiB 邊界、允許／拒絕 MIME、偽造 metadata、覆寫／刪除／列舉拒絕、既有工作階段撤權，以及封存保留檔案。

測試曾發現上傳至既有路徑僅靠 `allow create` 不足以達成本工具鏈下的不可覆寫要求；加入 `resource == null` 後回歸通過。規則與 `firebase.json` 已納入本機設定，**尚未部署**。部署還須確認 Storage 跨服務讀取 Firestore 的服務權限，並與 token／前端下載切換一起安排正式驗證。
