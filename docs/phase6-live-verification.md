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
