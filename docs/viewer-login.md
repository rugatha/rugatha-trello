# Viewer 密碼登入（2026-10-21）

新增共用會員 `shared-viewer`，顯示名稱 Viewer。Google 登入保留；主頁及甘特圖的登入區新增「Viewer 密碼登入」，只需輸入密碼。密碼由 Firebase Authentication 驗證，未寫入前端、Git 或本機儲存設定。

正式帳號使用專用內部識別信箱 `viewer@rugatha-trello.invalid`，由管理端建立，沒有對外收信功能。會員角色為 `viewer`、狀態 `active`、`readOnly: true`、`assignable: false`，可讀取全部 8 個既有看板（含封存看板）。`allBoards: true` 讓 `createManagedBoard` 在建立看板的同一交易內自動授權；停用會員不會新增授權。此旗標不提供任意看板查詢權，讀取仍依 `accessboard` 檢查。

完整唯讀限制包括牌卡、階段、留言、待辦、附件上傳、標籤定義與負責人截止日。Firestore 規則特別阻擋 `readOnly` 會員原本可使用的標籤與截止日例外；既有一般會員行為維持。可調整個人閱讀偏好並下載可存取附件。甘特圖對此帳號預設顯示所有負責人。

## 建立與維護

`scripts/provision-viewer.cjs --check` 先檢查登入設定、看板、帳號與會員文件；`--apply` 才會寫入。密碼由 `VIEWER_INITIAL_PASSWORD` 環境變數提供。工具拒絕覆寫既有帳號，先建立停用的 Auth 帳號，原子建立會員與 lookup，核對看板版本後才啟用帳號；中斷時應先檢查停用帳號及會員是否已建立，不可直接刪除或重建既有會員。未來密碼變更由 Firebase 管理端操作，不需修改前端。

## 驗證

189 項應用測試、49 項 Firestore 規則測試與 40 項後端整合測試通過。修正甘特圖測試的時間注入，使週日起日使用固定測試日期。

正式環境已建立帳號、啟用 Email/Password 登入並部署唯讀規則；以指定密碼實際登入，確認驗證信箱旗標、Viewer 身分、唯讀限制、8 個看板的讀取與名冊 callable 均成功。瀏覽器也確認看板可讀且編輯操作停用。
