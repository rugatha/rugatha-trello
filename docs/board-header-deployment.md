# 看板會員頭像後端部署（2026-10-16）

經使用者「請部署」授權，已更新正式 Firebase 專案 `rugatha-trello`、`asia-east1` 的 `management:listDisplayMembers`。此次未部署其他 Functions、規則或 GitHub Pages。

名冊為每位會員附上 `boardIds`：僅包含已啟用會員與目前登入者皆可存取的看板。前端據此篩選右上角頭像，避免將缺少新版資格欄位的舊名冊全數排除。保留既有歷史作者姓名與大頭貼欄位。

## 驗證

- 正式 API 回報 `ACTIVE`，更新時間為台北時間 2026-10-16 01:51:54。
- 下載正式建置來源，`management.cjs` 與本機已驗證版本逐位元組相同。
- GitHub Pages Origin 的 OPTIONS 預檢回傳 204，CORS Origin 正確。
- 匿名合法格式請求回傳 401／`UNAUTHENTICATED`，驗證未修改正式會員、牌卡或指派。
- 部署前的應用測試 143 項、Firebase 管理端點模擬器測試 39 項通過。

Firebase CLI 確認函式更新成功後，因既有 Artifact Registry 缺少映像清理政策而回傳非零狀態；未更動該政策，已另以正式 API 與已部署來源比對確認發布成功。

既有頁面的名冊在登入／重新整理時載入；部署完成後需重新整理頁面。尚未用正式登入會員檢查實際頭像。
