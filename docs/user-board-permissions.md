# 會員與看板權限對照

## 2026-10-12 已套用

依使用者提供的 `user-board-permissions-2026-10-12.csv`，完成正式 Firestore 的身份與看板授權調整。匯入涵蓋 14 位會員、7 個看板；13 位會員有變更，授權總數由 77 項調整為 30 項。

- Owner 保留原身份、狀態與七個看板的權限。
- 其餘 13 位會員皆為 Editor；`member-01`、`member-09`、`member-10`、`member-13` 由 Viewer 調整為 Editor。
- 每位會員的看板授權均依 CSV 的 1／0 設定；已封存看板維持封存。
- `member-13` 維持 `unlinked`，儲存 3D 看板授權；仍需連結信箱及有效會員狀態才能登入使用。
- 會員姓名、信箱、信箱 lookup、看板文件及內容均保持原樣。

套用工具為 `scripts/apply-member-permissions.cjs`：先驗證會員 ID、看板 ID、角色、狀態、0／1 值、姓名與信箱，並逐筆核對原始快照與正式會員的版本。修改前備份後，以 Firestore 原子 commit 及版本前置條件更新；未變更會員、看板與 lookup 也納入版本檢查。完成後讀回所有會員與看板及 lookup，確認授權與身份一致且其餘資料不變。

私人修改前後備份及驗證紀錄保留於 Git 忽略的 `attachments_export/maintenance/member-permissions-2026-10-12T04-41-54.478Z/`。套用及驗證成功後，依使用者要求刪除整個 `import/` 及其中全部檔案；該資料夾原本未納入 Git 或網站部署。

未來匯入需使用新的正式資料快照，不能沿用本次已刪除且已過期的快照。授權由正式 Firestore 即時提供，這次無需更改 Firebase 規則或 Functions。

## 已完成的會員清理

正式資料已將 `member-01` 的「陳威辰」改為「威辰」，保留原 ID、信箱、角色、狀態及看板授權。名稱更動不重寫历史稽核紀錄。

移除兩個「階段六測試邀請」會員：`invited-13d33ae5-9f51-45fc-88e0-694901e64ede`、`invited-75368aad-00c0-4477-98e0-dc345cca1423`，以及各自的信箱 lookup。確認依據：驗證文件記錄為虛構邀請、信箱為 `example.invalid`、狀態 disabled、沒有看板授權；完整讀取七個看板的 836 張牌卡及 79 則留言，沒有任何會員 ID 引用。其他會員和 lookup 修改前後逐筆一致。

備份及修改後資料：`attachments_export/maintenance/account-cleanup-2026-10-11T12-32-00-951Z/`。歷史管理收據保留供稽核。
