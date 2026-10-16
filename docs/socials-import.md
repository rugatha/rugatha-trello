# Socials 看板補入

> 2026-10-16 清理更新：依使用者授權，本文提及的本機 `attachments_export/` 備份與稽核檔已移除，階段六專用測試工具亦已移除。以下保留歷史執行紀錄，不代表相關本機檔案仍存在。

來源為私人 `import/socials-trello.json` 與 `attachments_export/trello-backup/manifest.json` 的 Socials 附件。來源 JSON 已加入忽略追蹤，完整計畫、缺檔清單及驗證結果存於忽略追蹤的 `attachments_export/socials-import/`。

## 匯入方式

```sh
node scripts/import-socials.cjs --local-only
node scripts/import-socials.cjs
node scripts/import-socials.cjs --apply
node scripts/import-socials.cjs --apply --complete-missing  # 補齊已標記缺檔的附件
node scripts/import-socials.cjs --verify
node scripts/verify-socials-import.cjs attachments_export/maintenance/PRE_IMPORT/snapshot.json
```

以來源 ID 建立 `trello-67f015af195310d43826dd8c`；既有同 ID 文件須逐欄一致，否則拒絕覆寫。保留欄位與卡片順序、標籤、說明、日期、完成狀態、封面、待辦分組與勾選，以及來源留言。待辦按來源 checklist／check item 的位置排序。留言作者透過既有 Trello action ID 與 Firestore 作者 ID 的歷史對照確認，保留來源作者資訊。

附件只按看板／卡片／附件 ID 對應。Storage 以 `ifGenerationMatch=0` 新增，無下載 token，使用 `private, no-store`，核對大小與 MD5 並逐檔授權下載校驗。缺檔保留原附件名稱、ID 與來源 URL，標示 `missing_local_file`；不偽造替代檔案。卡片計數包含缺檔紀錄。補檔需先加入私人備份 manifest，再使用 `--apply --complete-missing`；只允許原狀態為缺檔、其他來源欄位完全一致的附件轉為 Storage，採 `updateTime` 前置條件。

先完成子文件，再新增看板與 active Owner 的看板權限。既有角色、其他會員與其他看板不調整。使用者之後可透過會員管理開通其他成員。

## 來源限制

JSON 的卡片留言統計共 111 則，但 `actions` 的最近 1,000 筆紀錄只包含 3 則 `commentCard` 與 5 則 `copyCommentCard`，共可取得 8 則，仍少 103 則。逐卡片缺額記錄在私人 `result.json` 的 `commentGaps`。若需要補齊歷史留言，需額外提供完整留言來源。

## 2026-10-11 正式結果

- 已新增 3 欄、174 張卡片、1,065 項待辦、來源可取得的 8 則留言及 177 筆附件，共 1,428 份文件。
- 原備份有 176 個檔案；使用者補上最後一張 PNG 後，以來源大小與 PNG 簽章核對，加入私人備份及 manifest，再完成對應缺檔文件的 Storage 更新。177 個檔案均逐檔下載校驗通過，缺檔清單為空。
- 全部 174 張卡片的待辦完成數與封面參照無誤。正式重讀全部新文件逐欄一致，Owner 看板權限已確認。
- 104 項既有應用測試通過。此輪未修改前端或規則，不需要重新部署網站。
- 匯入前的 1,611 份既有文件及 221 個既有 Storage 物件比對零差異；唯一預期異動為 Owner 增加 Socials 看板權限，新增物件共 177 個。
- 雲端與私人備份確認成功後，已依指示刪除 `temp/plus-c07-chpt03.png` 及空的 `temp/` 資料夾；附件備份保留。清理證據存於私人 `temp-cleanup.json`。

## 留言缺漏複核

初次匯入只辨識一般留言，漏掉來源內 5 則複製卡片留言；已修正解析器，使用 `idOriginalCommenter` 保留原作者，並補上 5 則、調整三張卡片的計數與一則既有留言的排序。所有寫入均以版本／不存在前置條件保護，重讀逐欄確認。真正缺少於匯出來源的留言數修正為 103 則。

Trello 官方說明單一看板 JSON 只包含最近 1,000 筆操作；完整留言可由 Premium 工作空間設定的整個工作空間匯出取得，或由 REST API 針對卡片的 `commentCard,copyCommentCard` 操作分頁讀取。補入時依留言 ID 去重，再核對每卡片實際計數。

參考：[官方匯出說明](https://support.atlassian.com/trello/docs/exporting-data-from-trello/)、[API 分頁說明](https://developer.atlassian.com/cloud/trello/guides/rest-api/api-introduction/)。
