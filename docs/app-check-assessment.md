# Firebase App Check 評估（2026-10-10）

評估已完成，結論為分階段導入 reCAPTCHA Enterprise，先觀測再逐服務啟用 enforcement。本輪不建立 key、不變更正式 enforcement，不修改會員授權與安全規則。

## 現況與邊界

目前網頁只有 Firebase Authentication、Firestore／Storage 規則及 callable 的會員／角色／看板檢查；未初始化 App Check，Functions 也未設定 `enforceAppCheck`。唯讀 App Check services API 未回傳已設定的服務條目，這不能替代控制台的完整設定審查。

App Check 用於證明請求來自經驗證的應用，不能決定使用者是否為有效會員、是否有看板權限或是否可編輯。它與 Authentication、Security Rules 的用途互補；也不能消除所有濫用。[Firebase 官方說明](https://firebase.google.com/docs/app-check)

## 導入方案與驗收

1. 在 Firebase／Google Cloud 建立 reCAPTCHA Enterprise 網頁 key，限定正式 `rugatha.github.io` 網域。測試使用獨立 key／debug token；debug token 只存本機，不提交或發布。確認網站的 Cookie／隱私說明涵蓋新驗證服務。
2. 在 Firebase app 初始化後、Firestore／Storage／Functions 使用前，呼叫 `initializeAppCheck`、`ReCaptchaEnterpriseProvider` 與 `isTokenAutoRefreshEnabled`。先保持後端非強制模式，記錄有效／無效／未知請求比例。[網頁整合文件](https://firebase.google.com/docs/app-check/web/recaptcha-enterprise-provider)
3. 驗證 Firefox／Chrome、手機、登入／重新登入、長時間分頁、跨分頁、附件上傳下載、權限撤銷與離線重試。加入沒有 token、過期 token、未核准會員持有效 App Check token 的拒絕測試，確認原授權邊界不變。
4. 先在一個 callable 設定 `enforceAppCheck: true`，確認正常會員可用且缺 token 請求被拒，再逐步擴至其他 callable、Firestore 和 Storage。每步保留回退配置；不要同時強制所有服務。[Functions enforcement 文件](https://firebase.google.com/docs/app-check/cloud-functions)
5. replay protection 的 limited-use token 與 `consumeAppCheckToken` 另行評估，需考慮額外 token 交換、延遲與 IAM；不能以它取代交易中的資格與衝突檢查。

## 用量與決策

key、token TTL、自動更新及開啟分頁數會影響驗證量。啟用前先由 Firebase Usage、reCAPTCHA metrics 及實際帳務確認費用與預算；本輪未取得驗證量或帳單明細，不宣稱零成本。本站使用 callable SDK，已有自動攜帶 App Check token 的整合路徑，無須自訂傳遞會員或身分資料。

完成的產物為導入決策、相依條件、驗收矩陣與回退順序；實際啟用需另安排版本與控制台設定，避免阻斷既有已登入會員。
