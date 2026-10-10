# 看板建立與負責人管理

2026-10-10 Cloud Functions 與新版前端已部署，Chrome Owner／Firefox Admin 建立、授權範圍、指派／取消及雙帳號衝突通過；詳細結果見 [階段六驗證](phase6-live-verification.md)。權限依使用者決定：只有有效的 Owner／Admin 能建立看板或修改負責人，Editor 保持既有牌卡編輯能力，Viewer／一般會員唯讀。

## 操作方式

Owner／Admin 點側欄「新增看板」，填寫名稱、說明與配色，選擇其他可存取的會員。建立者自動取得權限，可另選最多 40 位有效會員；每人的原角色不變。一次建立看板、待辦／進行中／已完成三個欄位及會員 `accessboard`，不會留下只有看板或只有授權的半成品。沒有任何既有看板的 Owner／Admin 也能建立第一個看板。

牌卡詳情的「管理負責人」會重新載入當下可指派的會員與最新指派。只接受有效且已有該看板權限的會員，最多 40 位；無效的歷史指派會保留顯示並提示取消，不會在開啟視窗時自動改寫。看板或牌卡封存後不接受新的指派修改。複製牌卡仍清空副本負責人。

送出期間鎖定寫入，失敗保留表單與錯誤提示。相同內容重試沿用同一 request ID，避免回應遺失造成重複看板／寫入；改變內容會使用新的 request ID。關閉後重新開啟屬於新的操作，遇到逾時應先查看看板清單再另建。切換帳號或收到會員授權變動時，舊回應不能改寫新帳號畫面。

## 可信任寫入邊界

前端 `management.js` 使用 Firebase Callable SDK；管理程式位於 `functions/`，部署區域 `asia-east1`，執行環境 Node.js 22。Callable 自動驗證並附帶 Firebase 身分，服務再於 transaction 內重新讀取 `memberLookup` 與會員資料，要求已驗證信箱、active 狀態與 Owner／Admin 角色，不相信前端傳入的角色或會員 ID。機制依據 [Callable 官方文件](https://firebase.google.com/docs/functions/callable)。

| 端點 | 用途 | 伺服器檢查 |
| --- | --- | --- |
| `listManagementMembers` | 建立看板或指派時的會員選單 | 操作者角色；指派時另查操作者的看板授權及封存狀態。僅回傳 ID、名稱與可指派旗標 |
| `createManagedBoard` | 新建看板與授權 | 名稱／說明／色值、有效會員、ID 唯一性、重試內容一致性 |
| `setManagedAssignees` | 更新牌卡指派 | 操作者看板授權、未封存牌卡、每位目標會員的狀態與看板權限，以及 `expectedAssigneeIds` 是否仍與目前值相同 |

所有權限檢查與寫入在同一 transaction，會員授權同時變動會觸發重新讀取與驗證；兩筆同時指派只允許一筆提交，另一筆回傳衝突。依據 [Firestore transaction 文件](https://firebase.google.com/docs/firestore/manage-data/transactions)。

`workspaces/main/managementRequests/{hash}` 保存操作者 ID、操作種類、內容雜湊、結果及建立時間，與寫入一起提交。hash 包含 Auth UID 與 UUID v4 request ID；保留紀錄供重試，不設自動清除。現行 Firestore 規則沒有允許客戶端讀寫此集合，也仍禁止客戶端自行授權或改寫 `assigneeIds`。本輪未放寬 Firestore 規則，並新增對偽造操作紀錄的拒絕測試。

## 安裝與驗證

主專案應用測試沿用 Node.js 24；Functions 的部署 runtime 為 Node.js 22，對應 [Firebase 支援版本](https://firebase.google.com/docs/functions/manage-functions#set_nodejs_version)。需 Java 21 執行 Firestore 模擬器。

```sh
npm ci
npm ci --prefix functions
npm test
npm run test:rules
npm run test:management
```

`test:management` 只啟動 `demo-rugatha-trello` 的 Auth、Firestore、Functions 模擬器。使用虛構 email/password 帳號取得模擬器 ID token，透過真正的 callable HTTP 端點送出請求，不連線正式資料。連接埠：Auth 9099、Firestore 8080、Functions 5001。Functions 測試使用 Node.js 22 時，可讓 `node@22` 位於 PATH 最前面；主專案測試維持 Node.js 24。

管理端點整合測試亦已使用與部署相同的 Node.js 22 複跑通過。

本輪結果：86 項應用測試、32 項 Firestore 規則測試、16 項管理端點整合測試通過。涵蓋：未登入／未驗證／未核准／停用／Editor／Viewer／一般會員拒絕；Owner／Admin 建立；無看板管理員建立；並行授權不遺失；有效／無效／歷史指派；重試、防止偽造欄位、衝突與同時寫入。

Firefox 另使用獨立本機虛構資料預覽，確認新增表單、授權勾選、建立後三個欄位、管理負責人表單，以及指派後牌卡頭像更新。這個預覽未連接正式 Firebase，不視為正式站驗證。

## 部署與回歸

先部署後端，再發佈新版 GitHub Pages 前端。Functions 需專案符合 Blaze 與部署權限要求，參考 [Firebase 部署說明](https://firebase.google.com/docs/functions/get-started)。2026-10-10 已更新管理端點，僅以隔離看板和經使用者授權的測試會員驗證；未變更計費方案。

```sh
# 於 Functions 依賴已安裝、專案與計費已確認後執行
npx firebase deploy --only functions:management --project rugatha-trello
```

本輪無 Firestore 規則修改需要部署。端點尚未部署或無法連線時，前端顯示管理服務未就緒，不能完成操作。

部署後需用正式 Owner／Admin 建立專用測試看板，確認指定 Viewer 可見而未指定會員不可見，並驗證指派／取消、即時同步、衝突及撤權後的拒絕。新看板授權會透過會員訂閱重新載入，可能在 callable 回應之前關閉建立視窗；已修正同一會員授權更新的競態，正式建立後會自動選取新看板。測試資料的清理需限定新建的測試範圍，不能還原整份會員文件而覆蓋後續授權變更。
