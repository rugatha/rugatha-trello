# 2026-10-11 正式部署

正式站：[Rugatha Trello](https://rugatha.github.io/rugatha-trello/)。網站由 GitHub Pages 的 `main` 分支根目錄發布，Firebase 專案為 `rugatha-trello`，Functions 區域為 `asia-east1`。

## 發布與驗證

- 先發布 `firestore.rules`，再發布 `management` codebase 的全部函式，最後推送前端至 `main`。功能提交為 `71ab4fa`。
- Firestore 發布的 ruleset：`b69a144d-8cba-4172-8b4a-58c63961cb3c`。從正式 API 讀取後，規則內容與本機逐字一致。
- 全部 10 個 Functions 均為 ACTIVE，使用相同程式雜湊；新增 `manageContentLifecycle` 為 Node.js 22、540 秒逾時。
- GitHub Pages 建置成功，正式發布提交符合本機版本。19 個入口、模組、CSS、PWA 與圖示檔案的 SHA-256 與本機逐一一致。
- 正式 Owner callable 的 CORS 接受 `https://rugatha.github.io`，未登入的合法格式請求回覆 HTTP 401／UNAUTHENTICATED，沒有寫入正式資料。
- Chrome 正式頁以既有 Owner 工作階段載入看板；可見新版 Rugatha Trello 名稱、PWA 安裝入口，以及看板封存／永久刪除按鈕。未封存看板的永久刪除停用。驗證沒有封存或刪除正式內容。
- 發布前 `npm test` 的 112 項回歸通過；既有規則、附件與生命週期整合驗證見 [content-lifecycle.md](content-lifecycle.md)。

## CI 修正

第一個部署提交的 Pages 建置成功、相依性檢查成功，管理端點測試失敗。原因是 `test:management` 只啟動 Auth、Firestore、Functions，但新增的永久刪除測試也使用 Storage。已補啟動 Storage 模擬器，並在測試開始時要求 demo 專案及三個服務的 emulator 環境變數，防止缺少模擬器時誤用雲端服務。修正後本機完整 `npm run test:management` 的 32 項通過。此修正只涉及測試指令與前置檢查，後端程式沒有變更。

## 建置映像政策

Firebase CLI 已成功發布全部函式，但結尾因未設定 `asia-east1` Artifact Registry 的自動清理政策回傳非零狀態。正式 API 已確認函式全數 ACTIVE、新端點可呼叫。沒有使用 `--force` 自動移除舊建置映像，也沒有改變既有映像保存政策。

完整部署輸出保留在 Git 忽略的 `attachments_export/maintenance/deployment-2026-10-11/`；私人會員 CSV、匯入檔及備份不在部署提交內。
