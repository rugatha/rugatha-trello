# 通知與留言標註後端部署（2026-10-16）

本次依使用者「部署」授權，發布 Firebase 專案 `rugatha-trello`、區域 `asia-east1` 的以下內容：

- 新增 `management:listMentionMembers` 與 `management:postComment`。
- 更新 `management:setManagedAssignees`，在指派交易中建立通知。
- 發布 `firestore.rules`，包含私人通知讀取與已讀狀態更新限制。

## 正式環境驗證

三支函式均經 Cloud Functions v2 API 確認為 `ACTIVE`，Cloud Run HTTP 入口允許 callable 呼叫，程式內仍要求已驗證的 Firebase 身分與會員／看板權限。以 `https://rugatha.github.io` 作為 Origin 的 OPTIONS 預檢皆回傳 204，CORS Origin 正確。格式有效的匿名 POST 皆回傳 401／`UNAUTHENTICATED`，未建立任何正式測試留言、通知或指派。部署前兩支新端點回傳 404，這是此次 @ 名單顯示 `internal` 的原因。

正式 Firestore ruleset 重讀後，與本機 `firestore.rules` 逐字一致。

本機測試：130 項應用測試、42 項 Firestore 規則測試、36 項管理／留言端點整合測試通過。尚未以正式登入會員實際送出標註留言。

Firebase CLI 在確認三支函式發布成功後，因 `asia-east1` Artifact Registry 未設定映像清理政策而回傳非零狀態。此為既有專案設定；本次未修改映像保存政策。已另以正式 API 與 HTTP 請求確認發布結果。

本次僅部署以上後端與規則，未推送 Git 提交或發布 GitHub Pages 前端。

## 後續：作者編輯／刪除留言

`manageComment`、前端作者操作按鈕與編輯草稿流程已完成，133 項應用測試及 38 項後端整合測試通過。使用者明確同意後，已於 2026-10-16 發布 `management:manageComment`（asia-east1、Node.js 22）。此功能不需要變更 Firestore 規則。

正式 API 確認端點為 `ACTIVE`，callable HTTP 入口可呼叫，GitHub Pages Origin 的 OPTIONS 預檢回傳 204；格式有效的匿名編輯與刪除請求皆回傳 401／`UNAUTHENTICATED`。驗證未寫入或修改任何正式留言。本次同樣遇到既有映像清理政策警告，已另行確認部署成功，未修改映像保存設定。未發布 GitHub Pages 前端。
