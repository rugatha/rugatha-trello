# 專案結構與清理紀錄

2026-10-11：以程式引用、npm 指令、CI 設定及維護文件確認用途後整理。既有未提交的檔案修改保留。

| 位置 | 用途 |
| --- | --- |
| `index.html` | 網站入口，保留根目錄以支援 GitHub Pages |
| `src/` | 前端 ES modules 與 PWA 註冊程式 |
| `assets/` | CSS、原始圖示、縮小的 favicon 與安裝圖示 |
| `docs/` | 工作清單 `to-do.md`、設計、維護與驗證紀錄 |
| `functions/` | Firebase Functions 及其獨立 npm 相依 |
| `scripts/` | 匯入、備份、還原、稽核及瀏覽器驗證工具 |
| `tests/` | npm／CI 回歸、Firebase 規則與瀏覽器測試 |
| `import/` | 私人匯入資料，不提交 Git；Socials 工具已更新來源路徑 |
| `attachments_export/` | 私人附件、還原快照、遷移與稽核證據，不提交 Git |
| 根目錄設定 | README、npm manifest／lock、Firebase 設定與規則、PWA manifest／service worker／離線提示頁 |

## 已移除

- `firebase-debug.log`、`firestore-debug.log`：約 22.8 MB，未被應用程式或維護腳本讀取，是模擬器可重新產生的診斷輸出。
- 根目錄 `.DS_Store`：macOS 目錄顯示暫存，沒有程式引用。

## 確認後保留

- `tests/`：根目錄測試由 `npm test` 執行；規則、管理端點、附件生命週期由 `.github/workflows/checks.yml` 執行。瀏覽器 fixture 由測試頁或 `scripts/serve-phase5-test.py` 引用；即時測試仍是驗證與維護文件指定的工具。移除會失去有效回歸覆蓋。
- `attachments_export/`：約 832 MB，維護腳本直接讀取 manifest、修改前文件與還原快照；資料安全通知／伺服器清理仍有未結案事項。無法證明全部可以丟棄，因此沒有刪除或搬移，避免破壞既有計畫內保存的路徑。
- `import/socials-trello.json`：匯入、補檔及來源比對仍需要，也包含尚未完整取得的留言來源線索。
- `import/new_member_info.csv`：私人來源檔，僅無程式引用不足以確認使用者已不需要；已搬入忽略追蹤的匯入資料夾。
- `scripts/`：測試角色與帳號切換工具有還原功能並被驗證文件引用，其餘為持續維護或重跑比對工具。
- 原始圖示：保留以便未來重新產生不同尺寸。網站載入縮小圖示，不載入原始 1.4 MB PNG。

## PWA 行為

Manifest、圖示和註冊程式都使用相對 URL，支援 GitHub Pages 的專案子路徑。Worker 放在根目錄以涵蓋入口；只攔截工作空間首頁導覽，網路失敗才顯示 `offline.html`。快取只含靜態離線提示，不含登入資訊、Firestore 回應、附件、前端程式或看板畫面；更新仍從網路載入。測試頁不註冊 worker。

2026-10-12：安裝圖示改為滿版 PNG。`scripts/build-icons.py` 保留原圖案尺寸與顏色，在圓形外補上森林綠背景，填滿全部像素，不添加留白或縮小圖案。Manifest 提供 192／512 px 的 `icon-*-full.png`，分別宣告一般 `any` 和自適應 `maskable` 用途，支援平台直接裁切至圓形或圓角形狀。Apple Touch 使用 `apple-touch-icon-full.png`（180 px）；favicon 仍使用 32 px 透明 PNG。

新的安裝圖示使用新 URL，以更新圖示資產；保留前一版透明縮圖供仍快取舊 manifest 的安裝版本使用。圖示建置已核對 RGB／完全不透明、尺寸和四角填滿，以及圓形／圓角裁切預覽。系統可能仍保存已安裝的舊圖示，需要從正式網站重新安裝。用途與安全區域參考：[MDN icons](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest/Reference/icons)、[Chrome maskable icon](https://web.dev/articles/maskable-icon)。

原圖圓形外是黑色背景。使用者於 2026-10-11 明確同意改用程式精準去背後，以 `scripts/build-icons.py`（需 Pillow）從原圖建立透明版本：只移除連通外部背景並處理黑底反鋸齒邊緣，內部圖案及顏色保持原始 RGB。透明版不是重繪圖案；滿版版本從此圖案合成，192 px 約 56 KB、512 px 約 279 KB，32 px favicon 約 3 KB。

imagegen 內建模式曾嘗試去背，檢查發現色彩偏移與邊緣雜點，產物沒有用在網站。最後嘗試的提示如下，正式交付圖示以原圖及上述腳本生成，沒有使用 AI 產物：

> Create a production-ready transparent PNG app icon using the attached existing circular green and gold logo. Preserve the logo design exactly. Put the COMPLETE circular emblem centered in the square canvas, scaled to occupy 88 percent of the canvas width, leaving a uniform six percent completely transparent margin on all four sides. The canvas must have actual transparent alpha, not a black, white or checkerboard background. The outer gold circular rim must be a perfectly clean smooth circle with NO stray pixels, NO yellow/red edge speckles, NO ragged fringes, NO shadows, NO pixels anywhere in the transparent margin. Keep the entire interior of the circular emblem fully opaque. High-quality crisp antialiased circular edge for PWA app icon, green gold interior unchanged.

部署後仍需驗證正式 HTTPS 網站的安裝選項、圖示與首次載入後的離線啟動；本機測試不代表已部署。

## 本機驗證

- `npm test`：107 項通過（104 項既有回歸、3 項 worker 行為測試），0 失敗。
- Firefox 記憶體 fixture：色彩對比 30 項、手機／無障礙 36 項通過，沒有寫入正式 Firebase。修正測試伺服器對 `storage.js?v=20261010-rest` 的映射，避免漏載記憶體資料。
- 前端模組與樣式搬移前後內容一致；入口／模組路徑、工作清單相對連結及 manifest 圖示尺寸核對通過。
- `git diff --check` 通過；私人匯入檔仍被 Git 忽略。未重新部署或提交。
