# 備份、還原與監測計畫（2026-10-10）

本輪完成實際私人備份、隔離還原演練、唯讀用量／錯誤基準與後續維護方案。沒有對正式資料執行還原，也沒有啟用新的付費備份或改寫計費設定。

## 現況與已驗證工具

正式 Firestore 位於 asia-east1，目前沒有 scheduled backup，PITR 未啟用；Storage 未啟用 object versioning，soft delete 保留 7 天。這些現況由官方 API 唯讀盤點，私人的完整回應保存在 Git 忽略目錄。

- `node scripts/backup-workspace.cjs`：遍歷 `workspaces/main` 所有子集合（包含缺少父文件的子集合），保存原始 Firestore 型別、Storage 物件 generation、中繼資料與檔案。檔名以雜湊命名，快照與物件都有 SHA-256，檔案 mode 0600、目錄 0700，全部在 `attachments_export/maintenance/`，禁止公開提交。
- `node scripts/restore-backup-drill.cjs <私人備份目錄>`：只接受 `demo-rugatha-trello`、固定 127.0.0.1 Firestore／Storage 模擬器與私人備份路徑。要求空模擬器，以 create 前置條件寫入；不清除既有資料，不支援正式還原。
- `node scripts/inspect-operations.cjs`：唯讀盤點備份、Storage 保留、Functions、App Check 與 billingEnabled。
- `node scripts/monitor-operations.cjs`：唯讀查詢最近 24 小時指標與後端 ERROR。原始紀錄可能包含私人內容，只保存於忽略目錄；stdout 僅回傳數量和可用性。

2026-10-10 部署前快照：6 看板、38 欄位、662 牌卡、481 待辦、71 留言、288 附件文件、14 會員、12 登入索引及 1 個附件上傳紀錄，共 1,574 份 Firestore 文件。Storage 共 219 物件、136,054,212 bytes。備份後，使用者要求將指定信箱調整為名單外，該登入索引另行私人備份及移除；部署後比對需計入此已授權異動。

實際隔離演練：1,574 份文件欄位全數相同、219 個物件下載 SHA-256 全數相同；正式寫入為 0。演練使用 Node 24／Java 21 的 demo 模擬器，證據為私人 `restore-drill.json`。此為資料層還原，不是 Firebase Auth 帳號、IAM、索引或整個 Google Cloud 專案的災難復原演練。跨文件快照不是同一時間點的原子備份；正式災難復原應使用 managed backup/export。

## 備份與演練安排

建議由 Owner 核對帳務後設定 Firestore 每日保留 14 天、每週保留 8 週的 managed backups；有誤刪即時回復需求時另評估 PITR。備份／還原有獨立費用；managed backup 還原至新的資料庫，不直接覆蓋現有 default。[Firestore 官方備份文件](https://firebase.google.com/docs/firestore/backups)

Storage 現有 soft delete 只涵蓋有限時間的刪除回復，不能代替離線副本。每週保存帶 generation 的完整物件快照，保留最近 8 次；異地加密副本由 Owner 存入私人備份位置。本機備份目前只在此電腦，不宣稱已有異地保護。若日後啟用 object versioning，先規劃 noncurrent 版本保留／生命週期，再按實際帳務評估費用。[Storage versioning](https://cloud.google.com/storage/docs/object-versioning)、[soft delete](https://cloud.google.com/storage/docs/soft-delete)

每月演練一次及重大資料遷移前後重做：確認快照雜湊 → 新 demo 模擬器還原 → 全量欄位／檔案校驗 → 授權拒絕與附件抽樣 → 記錄時間及結果。規則、Functions、前端與 lockfile 由 Git 版本追蹤；Auth／IAM 設定需另外私人匯出清單。正式還原時使用新資料庫與測試 bucket，經差異審查後再切換；不能拿舊會員快照覆蓋後續授權變動。

## 用量、錯誤與費用核對

2026-10-09 09:14 至 2026-10-10 09:14（Asia/Taipei）唯讀 Monitoring 抽樣：Firestore read_count 24,249、write_count 233；Storage API 1,254 requests；Cloud Run 38 requests；後端 ERROR 1 筆。所有 query 沒有 nextPageToken。這些是操作指標，可能含測試／備份、延遲回報與系統請求；不能換算成 Firebase 帳單或推斷錯誤嚴重程度。

維護流程：每日檢查後端 ERROR、5xx 比例、附件 cleanup 成功、未完成上傳數、前端失敗回報；每週比較 read/write/request 基準與 Storage bytes；每月對照 Firebase Usage、Cloud Billing SKU／發票及預算。異常觸發條件先用過去 7 天正常基準的 2 倍、連續 10 分鐘 5xx >5%、cleanup 48 小時未成功；正式告警收件人與預算金額由 Owner 指定後再設定，不猜測私人聯絡人或金額。

目前僅確認 billingEnabled=true，未取得發票明細或實際金額；費用評估必須核對帳務後完成，不以程式查詢數宣稱實際成本。[Firestore 計費](https://firebase.google.com/docs/firestore/pricing)、[Cloud Monitoring 指標](https://cloud.google.com/monitoring/api/metrics_gcp)
