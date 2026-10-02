# rugatha-trello

Trello 風格的看板網站。Google 登入使用 Firebase Authentication；正式會員名冊由 Firebase Firestore 管理。

## 執行

在專案目錄執行 `python3 -m http.server 8000`，然後開啟 `http://127.0.0.1:8000`。Firebase Authentication 的 Google 登入網域須已授權。主畫面依登入會員的 `accessboard` 直接讀寫 Firestore；未登入或未核准時不載入看板。

## 會員資料

會員主資料位於 `workspaces/main/members/{memberId}`，包含穩定 `id`、顯示名稱 `name`、已核對的 Google 信箱 `emails`、角色 `role`、狀態 `status` 與唯一的看板存取清單 `accessboard`。牌卡以 `assigneeIds` 指向會員，留言以 `memberId` 指向作者；會員文件不再保存重複的牌卡清單。同一人可以有多個信箱。登入時透過私人 `memberLookup/{email}` 找到 member ID；該索引只保存 `memberId`。

網站不可藉由選擇本機使用者取得會員身分。未核准的 Google 帳號不能讀取 Firestore 工作空間。角色、信箱、看板權限與牌卡掛名僅可由可信任的管理流程修改。

## 看板與牌卡

主畫面唯一資料來源為 `workspaces/main/boards/{boardId}`，欄位與牌卡分別位於 `columns`、`cards` 子集合，牌卡的待辦、留言及附件由各自子集合載入。搜尋與篩選涵蓋所有已載入的授權看板牌卡，沒有 50 張上限。重新整理按鈕會從伺服器重新讀取；目前尚未提供即時訂閱。

編輯採 Firestore transaction，只寫入變更欄位，檢查同欄位是否被其他成員修改；離線、衝突或權限錯誤時顯示失敗並還原畫面。交易行為參考 [Firebase 官方文件](https://firebase.google.com/docs/firestore/manage-data/transactions)。

看板可封存／復原，牌卡與附件移除採 `archived: true`，保留子文件；牌卡與附件復原目前需可信任的管理流程。Viewer 僅可閱讀；Owner／Admin／Editor 可編輯，刪除空欄位僅限 Owner／Admin。看板建立及牌卡負責人變更仍由管理流程處理，附件上傳暫緩。

已移除 `data.json`、IndexedDB 看板讀寫與匯入流程，以及獨立雲端視窗。網站不會載入或覆蓋舊瀏覽器看板。Firebase 登入偏好仍使用 localStorage，並非看板資料。Git 歷史與既有瀏覽器儲存不在此次清理範圍；正式站部署後仍需確認舊 `data.json` URL 不再提供內容。

## 驗證

執行 `node --experimental-vm-modules --test tests/*.test.mjs`。測試涵蓋資料映射、子文件保留、差異寫入、衝突／離線失敗及超過 50 張牌卡的載入；Firebase 呼叫以模擬介面驗證，並非正式 Firestore 權限測試。

尚待正式站 Google 登入、各角色實際讀寫、雙帳號衝突及部署後 URL 檢查。完整後續工作見 `to-do.md`。
