# 相依漏洞追蹤與回歸（2026-10-10）

已更新現有版本範圍內相依（Firebase CLI 15.32.1 → 15.33.0），並鎖定可驗證相容的修補版本。未使用 `npm audit fix --force` 的 Firebase SDK／規則測試大版本降版。

| 範圍 | 更新前 | 修補後 |
| --- | --- | --- |
| 本機測試／部署工具 | 16 項（12 high、4 moderate） | 5 項（3 high、2 moderate） |
| Functions 部署相依 | 8 項 moderate | 0 項 |

修補內容：Firestore 測試 SDK 的 gRPC 1.9.16 改為 1.14.6；FTP 傳遞相依改為 basic-ftp 6.2.3；gaxios、teeny-request、Storage、google-gax 中的 UUID 改為保留 CommonJS 支援的 11.1.1。Overrides 只限制指定相依路徑；應用本身不使用 uuid 的 buffer 寫入介面。

來源：[gRPC 官方安全公告](https://github.com/grpc/grpc-node/security/advisories/GHSA-m9gg-hp2v-232j)、[basic-ftp 官方安全公告](https://github.com/patrickjuchli/basic-ftp/security/advisories/GHSA-c475-qrg2-pj4r)、[UUID 官方安全公告](https://github.com/uuidjs/uuid/security/advisories/GHSA-w5hq-g745-h8pq)。

## 未修補項目

剩餘 5 項 audit 條目來自兩個底層公告及其依賴祖先，不代表五個互不相關漏洞：

- `braces@3.0.3` 經 chokidar／firebase-tools 引入。2026-10-10 官方 npm 的最新 braces 仍是 3.0.3，沒有可直接套用的修補版；不能用同版本 override 隱藏報告。[公告](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)
- Pub/Sub 的 OpenTelemetry core 1.30.1；修補需 core ≥2.8.0。避免強制把 Pub/Sub 舊版的 core 換成未經上游確認的另一主要版本，待 Firebase CLI／Pub/Sub 更新依賴鏈。測試工具不接受外部不可信 Baggage 標頭；此限制不能視為漏洞消失。[官方公告](https://github.com/open-telemetry/opentelemetry-js/security/advisories/GHSA-8988-4f7v-96qf)

## 持續追蹤

`.github/workflows/checks.yml` 在 main 推送、PR、手動與每週一執行回歸；使用 demo Firebase 專案，不使用正式憑證或資料。audit JSON 保留 14 天供比較，不因已有已知漏洞就中止報告收集。`.github/dependabot.yml` 每週檢查根目錄、Functions 與 Actions 更新。

上游修補到達後先更新 lockfile／必要 override，再重跑下列回歸；每次審查 audit 條目的實際底層原因，不以總數減少代替相容性驗證。網頁 CDN SDK 目前仍為 12.19.0；此次 Node 傳遞相依修補不等同網頁 SDK 更新。

本輪相依變更後：100 項應用、35 項 Firestore 規則、17 項 Storage 規則、31 項管理端點、8 項附件生命週期全部通過。Functions 的正式重新部署與線上驗證另記階段六。
