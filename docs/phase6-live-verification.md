# 階段六正式站部署與補驗

2026-10-10 進行中；每個完整項目通過後，立即更新 `to-do.md`。模擬器、localhost 連接正式 Firebase、GitHub Pages 實際工作階段分開記錄。

## 部署

- 依序更新 9 個 management codebase Functions、GitHub Pages 前端、Firestore 私人會員文件規則。
- Functions 9 個更新成功、0 個失敗。CLI 因尚無 Artifact Registry 自動清理政策而回傳非零；沒有使用 `--force` 擅自設定刪除政策。
- Pages 核對 `app.js`、`auth.js`、`index.html`、`style.css` 與正式驗證模組 SHA-256 一致；規則發布成功。
- GitHub Pages 部署與新增的 Regression and dependency review workflow 均成功。
- 新看板建立的權限訂閱可能先於 callable 回覆；修正此競態與重新載入後選取，並保留不同 Google 帳號的舊回覆隔離。
- Google 登入加上帳號選擇器，避免自動沿用唯一既有 Google 工作階段。

## 已取得證據

- 最新應用測試 103 項、Firestore 35 項、Storage 17 項、管理整合 31 項、附件生命週期 8 項通過。
- Firefox GitHub Pages：名單外與 Pending 無看板；直接看板讀取、顯示名冊與管理端點拒絕。
- Firefox GitHub Pages：一般會員及 Viewer 可讀本人會員文件；會員集合列出、他人私人文件、自行提高角色、管理私人名冊、建立看板、指派、牌卡／留言／待辦直接寫入與附件上傳遭拒。
- Firefox localhost 連接正式 Firebase 的 Owner：隔離看板建立及三個預設欄位、指派／取消、防重複重試、過期指派衝突、虛構邀請／核准／角色及看板調整／停用通過。
- 同一 localhost Owner：零附件初次省略、封存附件延遲查詢、復原計數 1 通過；測試附件再封存。

## 測試資料與帳號

只使用「階段六驗證 20261010」隔離看板，保留既有歷史看板與子文件。虚構邀請使用 `example.invalid`，沒有寄送郵件，測試後停用。新增牌卡、附件及看板採封存清理，不永久刪除。

使用者已明確同意將指定測試信箱暫時切換 Pending／Member／Viewer／Editor／Admin，只授權隔離測試看板。原會員與登入索引的備份位於 Git 忽略的私人維護目錄；完成後必須逐欄恢復原會員，移除該登入索引，維持使用者要求的名單外狀態。

既有 Google 帳號移除登入索引，只代表無索引情境；不能當作全新 Google 帳號首次 OAuth 登入。首次登入及多信箱驗證仍需要實際可登入的合適帳號。

## GitHub Pages 補驗紀錄

- Chrome 真實 Owner 工作階段：三欄看板、指派／同請求重試／取消、虛構邀請／核准／角色與範圍調整／停用、零附件延遲查詢及復原通過。
- Firefox 真實測試會員：Pending／Member／Viewer／Editor／Admin 的私人文件與管理端點矩陣通過；Admin 建立第二個隔離看板，只選本人與 Owner，建立後自動選取，Chrome Owner 可見。
- Owner 與 Admin 同時建立相同指派版本的草稿，Owner 先成功送出後，Admin 得到 `functions/aborted`；Editor／Viewer 無法呼叫指派端點。
- Owner 與 Editor 同時持有牌卡標題草稿，Owner 先送出後，Editor 過期草稿得到資料衝突拒絕。測試已等待非同步操作完成，避免把尚未建立的草稿誤認為衝突。
- Viewer 無重新整理即接收 Owner 新標題；實際拖曳未改變所在欄位，伺服器欄位一致；零附件封存清單可讀、復原按鈕停用。
- Editor 輸入未送出留言後降級 Viewer：編輯視窗即時關閉，重開留言輸入為空。撤銷主測試看板後只保留第二隔離看板；停用後所有內容清空；恢復授權後站內重新整理成功。受限 CLI 只調整已核准的測試會員及兩個隔離看板，角色變動由正式站訂閱接收。
- 既有測試帳號暫設空白名稱，再透過 Firefox「重讀會員」進入名稱設定；儲存後載入工作區成功。這是首次工作區設定的模擬，沒有刪除 Authentication 帳號，不能當作新 Google OAuth 或實際多信箱驗證。
- Editor 與 Owner 皆完成本人留言新增／更新／刪除、待辦新增／勾選／刪除、跨欄排序、過期資料拒絕及牌卡封存／復原；另一帳號訂閱觀察父牌卡計數與欄位變化。
- 早期一次 Editor 新增後立即重讀未找到新子文件，伺服器寫入存在。加入直接伺服器／載入計數診斷後，空白牌卡重現集合查詢回傳零筆，而直接文件讀取確認父計數 1／子文件存在。一次性載入改用同一 Firebase app 的 Firestore Lite REST 讀取，訂閱及交易維持完整 SDK；不依賴既有即時查詢視圖，沒有新增逐牌卡補讀或取消零計數省略。104 項單元回歸通過，包含舊即時查詢視圖仍為零的首次子文件重讀情境；待正式站驗證。

原測試牌卡的孤立測試子文件保留，最後採封存。自動核准審查拒絕清除子文件的 CLI 操作，理由是永久刪除不可由產品介面復原；沒有執行該操作，也不以其他方式清除這些子文件。

FireStore Lite 的 REST-only、無離線快取及無快照訂閱特性依據 [Firebase 官方文件](https://firebase.google.com/docs/firestore/solutions/firestore-lite)；既有查詢視圖重用是本次觀測及 [SDK snapshot-listener 實作](https://github.com/firebase/firebase-js-sdk/blob/main/packages/firestore/src/core/firestore_client.ts) 的推論，不宣稱已確認上游缺陷。
