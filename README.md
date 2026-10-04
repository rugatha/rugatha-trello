# rugatha-trello

Trello 風格的看板網站。Google 登入使用 Firebase Authentication；正式會員名冊由 Firebase Firestore 管理。

## 執行

在專案目錄執行 `python3 -m http.server 8000`，然後開啟 `http://127.0.0.1:8000`。Firebase Authentication 的 Google 登入網域須已授權。主畫面依登入會員的 `accessboard` 直接讀寫 Firestore；未登入或未核准時不載入看板。

## 會員資料

會員主資料位於 `workspaces/main/members/{memberId}`，包含穩定 `id`、顯示名稱 `name`、已核對的 Google 信箱 `emails`、角色 `role`、狀態 `status` 與唯一的看板存取清單 `accessboard`。牌卡以 `assigneeIds` 指向會員，留言以 `memberId` 指向作者；會員文件不再保存重複的牌卡清單。同一人可以有多個信箱。登入時透過私人 `memberLookup/{email}` 找到 member ID；該索引只保存 `memberId`。

網站不可藉由選擇本機使用者取得會員身分。未核准的 Google 帳號不能讀取 Firestore 工作空間。角色、信箱、看板權限與牌卡掛名僅可由可信任的管理流程修改。

## 看板與牌卡

主畫面唯一資料來源為 `workspaces/main/boards/{boardId}`，欄位與牌卡分別位於 `columns`、`cards` 子集合，牌卡的待辦、留言及附件由各自子集合載入。搜尋與篩選涵蓋所有已載入的授權看板牌卡，沒有 50 張上限。重新整理按鈕會從伺服器重新讀取；已訂閱授權看板的變更，只重新載入有異動的看板；編輯視窗開啟時暫緩套用更新。

編輯採 Firestore transaction，只寫入變更欄位，檢查同欄位是否被其他成員修改；離線、衝突或權限錯誤時顯示失敗並還原畫面。交易行為參考 [Firebase 官方文件](https://firebase.google.com/docs/firestore/manage-data/transactions)。

看板可封存／復原，牌卡與附件移除採 `archived: true`，保留子文件。每個看板的「封存項目」列出已封存牌卡與附件；Owner／Admin／Editor 可復原，Viewer 僅可閱讀。刪除空欄位僅限 Owner／Admin。看板建立及牌卡負責人變更仍由管理流程處理，附件上傳暫緩。

已移除 `data.json`、IndexedDB 看板讀寫與匯入流程，以及獨立雲端視窗。網站不會載入或覆蓋舊瀏覽器看板。顯示名稱以 Firestore 會員的 `name` 為準，既有非空名稱視為已完成設定；同一會員的不同 Google 信箱共用名稱。名稱更新成功才關閉設定視窗，不再依賴 localStorage 或覆寫 Google 個人資料。Git 歷史與既有瀏覽器儲存不在此次清理範圍；2026-10-02 已驗證正式站舊 `data.json` URL 回傳 404。

## 驗證

執行 `node --experimental-vm-modules --test tests/*.test.mjs`。測試涵蓋資料映射、子文件保留、差異寫入、封存復原、衝突／離線失敗及超過 50 張牌卡的載入；Firebase 呼叫以模擬介面驗證，並非正式 Firestore 權限測試。

已完成單一帳號正式站讀寫、封存復原及同帳號跨分頁同步驗證；仍待各角色、雙帳號衝突及最新變更部署後驗證。完整後續工作見 `to-do.md`。

### Firestore 安全規則測試

使用 Node.js 24 與 Java 21，先執行 `npm ci`，再執行 `npm run test:rules`。此指令啟動本機 Firestore 模擬器並使用 `demo-rugatha-trello`；測試資料只寫入模擬器，完成後自動關閉，不連接正式資料庫。首次執行會下載官方模擬器。測試依 [Firebase 官方測試方式](https://firebase.google.com/docs/firestore/security/test-rules-emulator) 使用 `@firebase/rules-unit-testing`。

16 項規則測試涵蓋 Owner／Admin／Editor／Viewer／一般會員、無看板權限、停用／未核准／未驗證信箱與未登入狀態，以及會員自我提權防護、多個信箱對應同一會員、留言作者與刪除限制。留言更新必須保留作者、內容為 1–5000 字；具編輯權限的作者可刪除自己的留言。這些測試不取代正式站多帳號驗證，規則修改仍須另行部署。

macOS 若系統的 Java 或 Firebase CLI 是舊版，可使用專案的 npm 指令及 Homebrew Java，例如：
`PATH=/opt/homebrew/opt/node@24/bin:/opt/homebrew/opt/openjdk@21/bin:$PATH npm run test:rules`。

2026-10-03 新增的測試依賴經 `npm audit` 回報 16 項相依漏洞（4 moderate、12 high，含上游套件的傳遞相依）；目前僅用於本機測試，不由網站載入。未採用 audit 建議的跨主要版本降版，後續需追蹤上游修補。

登入回歸測試另涵蓋未驗證信箱、停用會員、登出期間的非同步讀寫及快速切換帳號；已登入但未核准者顯示「尚未取得工作空間權限」。舊登入請求的延遲錯誤不會干擾新帳號。

2026-10-04 補上切換帳號期間的儲存／封存復原競態防護：舊請求的完成或失敗不再干擾新帳號視窗、提示及寫入鎖定狀態。41 項應用測試與 16 項模擬器規則測試通過。
