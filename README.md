# rugatha-trello

Trello 風格的看板網站。Google 登入使用 Firebase Authentication；正式會員名冊由 Firebase Firestore 管理。

## 執行

在專案目錄執行 `python3 -m http.server 8000`，然後開啟 `http://127.0.0.1:8000`。Firebase Authentication 的 Google 登入網域須已授權。主畫面依登入會員的 `accessboard` 直接讀寫 Firestore；未登入或未核准時不載入看板。

## 會員資料

會員主資料位於 `workspaces/main/members/{memberId}`，包含穩定 `id`、顯示名稱 `name`、已核對的 Google 信箱 `emails`、角色 `role`、狀態 `status` 與唯一的看板存取清單 `accessboard`。牌卡以 `assigneeIds` 指向會員，留言以 `memberId` 指向作者；會員文件不再保存重複的牌卡清單。同一人可以有多個信箱。登入時透過私人 `memberLookup/{email}` 找到 member ID；該索引只保存 `memberId`。新版規則限定只能讀取自己的會員文件；一般名冊由 `listDisplayMembers` 回傳 ID／名稱，信箱與授權不提供給其他一般會員。

網站不可藉由選擇本機使用者取得會員身分。未核准的 Google 帳號不能讀取 Firestore 工作空間。角色、信箱、看板權限與牌卡掛名僅可由可信任的管理流程修改。新看板授權與牌卡指派使用伺服器端管理端點，會員邀請、核准、停用與角色／看板授權管理介面已完成本機測試，尚未部署。見 [會員管理](docs/member-management.md)。

登入後以 [Firestore 即時訂閱](https://firebase.google.com/docs/firestore/query-data/listen) 監聽目前會員文件。角色或看板授權更新時，立即清空舊看板及編輯視窗，再載入最新授權內容；會員停用、刪除或訂閱失敗則清除資格。權限變更時未送出的草稿不保留。站內重新整理會向伺服器重讀會員索引、會員資料與名冊，也可用來重試失敗的會員訂閱。

## 看板與牌卡

主畫面唯一資料來源為 `workspaces/main/boards/{boardId}`，欄位與牌卡分別位於 `columns`、`cards` 子集合，牌卡的待辦、留言及附件由各自子集合載入。搜尋與篩選涵蓋所有已載入的授權看板牌卡，沒有 50 張上限。重新整理按鈕會從伺服器重新讀取；已訂閱授權看板的變更，只重新載入有異動的看板；編輯視窗開啟時暫緩套用更新。

編輯採 Firestore transaction，只寫入變更欄位，檢查同欄位是否被其他成員修改；離線、衝突或權限錯誤時顯示失敗並還原畫面。交易行為參考 [Firebase 官方文件](https://firebase.google.com/docs/firestore/manage-data/transactions)。

看板可封存／復原，牌卡與附件移除採 `archived: true`，保留子文件。每個看板的「封存項目」列出已封存牌卡與附件；Owner／Admin／Editor 可復原，Viewer 僅可閱讀。刪除空欄位僅限 Owner／Admin。看板建立與牌卡負責人變更已接上 Owner／Admin 專用的 Cloud Functions 管理介面；需先部署管理端點才可使用。實作、權限與部署方式見 [看板管理](docs/board-management.md)。附件上傳暫緩。

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

2026-10-04 第二輪權限測試：Firestore 規則禁止客戶端變更既有 `assigneeIds`，新牌卡只能未指派；複製牌卡不保留負責人，原牌卡不受影響。可信任管理流程仍可指派。新增各角色封存／復原與既有登入狀態下撤銷看板權限測試，目前 42 項應用測試、25 項規則測試通過。

看板設定提供五種共用配色（森林綠、暖沙色、鼠尾草綠、奶茶色、玫瑰灰），同步儲存於看板的 `color` 欄位。Owner／Admin／Editor 可修改，Viewer 與一般會員唯讀；規則拒絕非預設色值。標題、背景、導覽色點隨看板切換，文字與焦點框配合深淺色調整。45 項應用測試及 30 項規則測試通過，涵蓋失敗還原與角色限制。

2026-10-05 Firefox 雙帳號驗證：Owner 與 Editor 在 localhost:8001 連接正式 Firebase，確認看板說明雙向同步、編輯中保留草稿，以及看板／牌卡同欄位衝突不覆蓋另一帳號的寫入；測試說明已還原空字串。Editor 無法刪除階段，Owner 可見刪除操作；兩者指派控制皆停用。修正儲存失敗提示被即時同步狀態蓋掉的問題：失敗原因保留至手動重新整理、下次儲存或切換帳號。

2026-10-05 附件讀取優化：`attachmentCount === 0` 的牌卡不再於初次載入查詢附件，改在開啟該看板「封存項目」時補讀；同次看板載入期間重開清單不重讀，重新整理／即時同步重新載入該看板後會失效。正附件數及缺少計數的舊牌卡維持原流程，以保留封面及編輯功能。封存附件載入失敗可關閉重試，舊帳號／已關閉視窗的延遲回應不會更新畫面。

正式 Firebase 唯讀量測：6 個看板、658 張牌卡（462 張未封存），初次附件查詢 462 → 122，整體查詢 612 → 272；讀回文件均為 1,489 份，少了 340 次空查詢。這是伺服器查詢量測，並非 Firebase 帳單數字。細節、限制與重跑方式見 [附件讀取評估](docs/attachment-read-audit.md)。56 項應用測試通過；尚未部署。

Trello 備份附件遷移與重跑方式見 [附件遷移](docs/attachment-migration.md)。遷移使用既有牌卡附件連結欄位；一般使用者從介面新增上傳仍未開放。

會員參照檢查可執行 `node scripts/audit-member-references.cjs`；逐筆核對所有指派與留言作者，僅讀取正式資料。修復計畫產生方式、歷史指派警告與 2026-10-07 正式站顯示驗證見 [會員參照檢查](docs/member-reference-audit.md)。

P2 Storage 路徑、20 MiB／MIME 限制與生命週期見 [Storage 設計](docs/storage-design.md)。`npm run test:storage-rules` 使用本機 Firestore＋Storage 模擬器驗證會員／看板權限；16 項測試通過，規則尚未部署。前端上傳及舊下載 token 切換仍待完成，既有 token 連結不具會員撤權效果。

看板管理測試：`npm ci --prefix functions` 安裝後，`npm run test:management` 以 demo 專案啟動 Auth／Firestore／Functions 模擬器，驗證 Owner／Admin 管理流程及越權拒絕。本輪 86 項應用、32 項 Firestore 規則與 16 項管理端點整合測試通過；部署與正式站驗證仍待完成。

2026-10-08 階段三完成：86 項應用、33 項 Firestore 規則、31 項管理端點整合測試，以及 Firefox 14 項會員介面測試通過。會員管理與名冊讀取變更尚未部署；部署順序與測試範圍見 [會員管理](docs/member-management.md)。

### 階段四附件

新附件採暫存上傳、可信任完成與原子計數；圖片預覽與下載使用 Firebase 身分驗證及短期 Blob URL。Storage 原檔封存保留、過期暫存由排程清理。架構與正式切換工具見 [Storage 設計](docs/storage-design.md)，測試與正式驗證進度見 [附件生命週期](docs/attachment-lifecycle.md)。
