# rugatha-trello

Trello 風格的看板網站。Google 登入使用 Firebase Authentication；正式會員名冊由 Firebase Firestore 管理。

## 執行

在專案目錄執行 `python3 -m http.server 8000`，然後開啟 `http://127.0.0.1:8000`。Firebase Authentication 的 Google 登入網域須已授權。瀏覽器本機看板仍是過渡版；「雲端看板」讀取 Firestore。

## 會員資料

唯一的會員資料來源是 `workspaces/main/members/{memberId}`，其中 `id` 是穩定識別、`name` 是顯示名稱、`emails` 是已核對的 Google 信箱、`accessboard` 是可存取看板 ID 清單、`cardincharge` 是掛名牌卡 ID 清單，另有 `role` 與 `status`。同一人可以有多個信箱。登入時只透過私人 `memberLookup/{email}` 找到 member ID；該索引只保存 `memberId`，不是第二份名冊。

網站不可藉由選擇本機使用者取得會員身分。未核准的 Google 帳號不能讀取 Firestore 工作空間。角色、信箱、看板權限與牌卡掛名僅可由可信任的管理流程修改。

`data.json` 暫時只作為本機看板／牌卡種子，不含會員名冊或會員對照；原始 Trello 匯入檔與私人信箱 CSV 不應放在 Git。既有 Git 歷史仍可能保留過去已提交的舊資料，需另行規劃歷史清理與遠端同步。

## 尚待完成

- Firestore 規則已部署；仍需在 Firebase Authentication 確認網站授權網域，並完成 Google 登入端到端驗證。
- 將既有雲端牌卡與留言中的舊會員欄位改為單一 `memberId`，清理舊的 Firestore 邀請、名冊與別名欄位。
- 將本機看板／牌卡編輯整合至 Firestore；圖片上傳與 Storage 依先前約定暫緩。
