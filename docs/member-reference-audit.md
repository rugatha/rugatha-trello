# 會員參照檢查與指派修復方式

`scripts/audit-member-references.cjs` 使用既有 Firebase CLI 管理登入，唯讀查詢正式 `rugatha-trello`。它讀取所有會員、看板與牌卡（含封存），逐張讀取留言子集合，並處理分頁；不依賴可能過期的 `commentCount`。此為管理端資料檢查，不代表一般會員的安全規則授權測試，也不是跨集合的同一時間點快照。

```sh
node scripts/audit-member-references.cjs > /private/tmp/rugatha-member-audit.json
```

錯誤包含找不到會員的指派／留言作者、非陣列或無效 ID、重複指派、殘留 `legacyAssigneeIds`／`cardincharge` 及空白會員名稱。任何錯誤均以 exit code 1 結束；成功或僅有警告為 0。網路／認證失敗也回傳非零，不當成空資料通過。

停用或已失去看板權限的會員仍可能出現在歷史指派中，因此列為警告，不自動移除、不恢復權限、不依名稱猜測替代會員。檢查不會輸出信箱、憑證或留言內文；完整報告仍包含內部文件 ID 與少量抽查名稱，請放在私有位置。

## 修復計畫

先人工核對原始資料與會員身分，再針對要修復的牌卡明確指定完整 `assigneeIds`。例如私人檔案 `/private/tmp/assignment-repairs.json`：

```json
[
  {
    "path": "workspaces/main/boards/BOARD_ID/cards/CARD_ID",
    "assigneeIds": ["MEMBER_ID"]
  }
]
```

空陣列表示明確解除該牌卡全部指派。未列出的牌卡不變。

```sh
node scripts/audit-member-references.cjs --plan=/private/tmp/assignment-repairs.json \
  > /private/tmp/assignment-repair-plan.json
```

`--plan` 仍只讀取正式資料、產生計畫，不發出寫入。它拒絕未知牌卡、重複計畫／ID、缺少伺服器 `updateTime`，以及不存在、停用或沒有該看板權限的目標會員。計畫列出原陣列、新陣列與 `currentDocument.updateTime`，不會自動刪除無法判斷的參照。

正式修復須由可信任管理流程依核對後計畫執行：

1. 保存原牌卡完整備份及修復計畫；寫入前重新確認目標會員的有效狀態及看板權限。
2. 僅更新 `assigneeIds`、`updatedAt`、`updatedBy`。後兩者使用此次修改時間與執行者的有效會員 ID；不得新增 `cardincharge`。
3. 使用計畫中的伺服器 `updateTime` 作為寫入前置條件，並以欄位遮罩限制更新。若牌卡已變更，停止並重新讀取、比對及產生計畫，不強行覆寫。REST 寫入的欄位遮罩與前置條件行為見 [Firebase Write 文件](https://firebase.google.com/docs/firestore/reference/rest/v1beta1/Write)。計畫中的 `updateMask` 是欄位名稱清單，執行器須轉成 REST 的 `updateMask.fieldPaths`，不是直接提交整份計畫。
4. 再執行唯讀檢查，並在正式網站確認負責人名稱與同步結果。若要回復原指派，以當時最新版本建立新的回復計畫，不重送已過期的前置條件。

本工具沒有 `--apply` 模式。本輪正式檢查沒有缺失參照，因此不需資料修復；真正的管理寫入介面仍屬另一個未完成 P1 項目。

## 2026-10-07 驗證

- 正式唯讀核對完成於 11:30:58 UTC：14 位會員、6 個看板、658 張牌卡、391 筆指派、71 則留言；參照錯誤 0，沒有 `cardincharge` 或 `legacyAssigneeIds` 殘留，會員名稱皆非空。
- 6 則警告來自 3 張牌卡：2 位既有會員目前不是 active 且沒有該看板權限，每張各產生 2 則警告。保留原歷史指派，未調整角色或授權。
- Firefox 以既有 Owner 在 GitHub Pages 正式站抽查：3D 的 Ian 牌卡顯示負責人名稱；World Building 的 Trinix 牌卡三則留言作者為兩位現有會員名稱，負責人及 14 位會員選項均為名稱，身分欄位未顯示原始 UID。
- 原始留言文字內的 Trello `@user…` 提及仍保持原文；本次驗證的是牌卡指派、留言作者與會員名稱欄位，不改寫歷史留言內文。
- 新增 7 項自動化測試，涵蓋無效／缺失／重複參照、封存牌卡、歷史指派警告、分頁、零計數留言與修復計畫防護；全套 76 項應用測試通過。

本輪未部署網站、修改正式資料或執行修復寫入。
