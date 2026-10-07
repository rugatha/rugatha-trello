# 資料安全盤點與後續處理

盤點時間：2026-10-07。正式資料檢查採唯讀；未改寫 Git 歷史或刪除瀏覽器資料。測試帳號另依使用者指示暫時改為 `pending`，原狀態已有私人備份，測試後已還原 active／Viewer。

## 遷移內容逐筆比對

來源為切換前的 `07af3b7b16e6442bc2e10e74d17a6d637ad1a4c7:data.json`。執行 `node scripts/audit-migration-content.cjs`，使用既有 Firebase CLI 管理登入，讀取全部看板、牌卡及三種子集合，包含封存牌卡與計數為零的子集合，支援分頁。

| 子集合 | 來源筆數 | 正式筆數 | 結果 |
| --- | ---: | ---: | --- |
| 待辦 | 481 | 481 | ID 與來源所有欄位一致 |
| 留言 | 71 | 71 | ID、文字及時間一致 |
| 附件 | 282 | 287 | 原 282 筆一致；另 5 筆均可對應較新的附件備份 |

本輪最後讀取時間為 15:53 UTC；沒有缺漏牌卡、內容差異、計數錯誤、附件遷移欄位錯誤或無法解釋的新增項目。Storage 遷移後的 URL 改比對 `sourceUrl`，型別、大小、外部連結旗標、bucket 及路徑另外對照附件 manifest 與本機檔案。未重新下載所有 Storage 物件；逐檔下載校驗記錄見 [附件遷移](attachment-migration.md)。來源已移除留言作者欄位，作者完整性另見 [會員參照檢查](member-reference-audit.md)。

快照與詳細報告存放於被 Git 忽略的 `attachments_export/stage-one-audit/`，檔案權限為 `0600`，不可部署或提交。這是跨多次讀取的比對，不是資料庫同一時間點的原子快照；有持續編輯時應於維護時段重跑。工具不會自動修正差異。

## 舊瀏覽器資料備份與差異處理計畫

舊版使用 IndexedDB：資料庫 `boardly-workspace`、object store `data`、key `workspace`。資料依瀏覽器、設定檔及 origin 隔離；正式站、localhost 不同連接埠、一般與私密視窗不可視為同一份資料。

1. 每位使用者列出曾使用的瀏覽器／設定檔／網址；保留舊設定檔，不清除網站資料。私密視窗若已關閉，資料可能無法找回。
2. 在原 origin 的開發者工具 Storage／Application 面板確認上述資料庫與 key。優先使用瀏覽器提供的匯出；如沒有匯出功能，可在該頁主控台執行下方唯讀程式。
3. 將匯出 JSON 放入私人備份位置，記錄 origin、瀏覽器、時間、位元組數與 SHA-256，另存一份到存取受限的備份位置。驗證 JSON 可解析、`boards` 為陣列、看板／牌卡 ID 不重複；保留附件 base64 與舊會員對照資料。
4. 使用共同遷移來源、瀏覽器匯出、最新 Firestore 快照做三方比對，以看板／牌卡／子項目 ID 對應，不以標題猜測。先正規化 `assignees`／`assigneeIds`、作者 ID、附件 `url`／`sourceUrl` 及排序欄位；不把雲端新增的系統欄位視為使用者修改。
5. 分別列出僅本機修改、僅雲端修改、雙方同欄位修改、本機新增與缺漏 ID。缺漏項目只標記供確認，不解讀為刪除指令；無可靠會員 ID 對照時保留待人工處理。
6. 先交付差異報告，再逐項確認合併；未確認前不匯入、不覆蓋。正式寫入須符合目前權限，使用 transaction／updateTime 防止覆寫新變更，保留每筆原值與回復計畫。
7. 合併後重載與比對完成，再由資料持有人決定舊資料保存期限。不得以版本升級或首次登入自動清除 IndexedDB。

以下程式只讀取舊資料並下載備份；若資料庫不存在，中止開啟交易，避免建立新資料庫。尚未在使用者的舊瀏覽器資料上執行。

```js
(async () => {
  const database = await new Promise((resolve, reject) => {
    const request = indexedDB.open('boardly-workspace');
    request.onupgradeneeded = () => request.transaction.abort();
    request.onerror = () => reject(new Error('找不到既有資料庫或無法讀取；未建立新資料庫'));
    request.onblocked = () => reject(new Error('資料庫被其他分頁阻擋'));
    request.onsuccess = () => resolve(request.result);
  });
  try {
    const workspace = await new Promise((resolve, reject) => {
      const request = database.transaction('data', 'readonly')
        .objectStore('data').get('workspace');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    if (!workspace || !Array.isArray(workspace.boards)) throw new Error('找不到有效的 workspace');
    const text = JSON.stringify({exportedAt: new Date().toISOString(), origin: location.origin, workspace});
    const url = URL.createObjectURL(new Blob([text], {type: 'application/json'}));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'boardly-local-backup-' + Date.now() + '.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  } finally {
    database.close();
  }
})();
```

本項完成的是備份與比對計畫；尚未收集或合併任何人的舊瀏覽器資料。

## Git 歷史曝光範圍與清理計畫

GitHub API 本輪確認 repository 為 public、可見 fork 數為 0。正式 Pages 首頁回應 200；`data.json`、`new_member_info.csv`、`import/3d.json` 回應 404，但匿名存取初始提交的舊 `data.json` 仍回應 200。移除目前版本檔案不會清除 Git 歷史，可見 fork 為 0 也不能證明無人複製過資料。

本機歷史可見的待清理範圍包括：

- `data.json`：看板內容、待辦、留言、附件連結及舊會員顯示資料；初始版本包含 13 筆會員顯示資料。
- `import/*.json`：原始 Trello 匯出、作者／會員欄位及附件來源連結。
- `new_member_info.csv`：會員匯入資料；另須掃描所有 ref 的其他 CSV 別名。
- `import-report.json` 與 `.DS_Store`：盤點是否包含私人名稱、路徑或匯入資訊後一併清理。
- 歷史程式、文件及提交內容中可能重複出現的私人信箱或 token URL：需在私人報告列出位置，不將敏感字串複製進公開文件。

相關歷史：初始資料於 `9f64817` 加入；會員資料清理涉及 `07af3b7`，主畫面切換與來源移除為 `61baf1a`，仍追蹤的會員 CSV 清理為 `f146bc8`。這些是提交日期紀錄，不代表能證明整段期間的實際 repository 可見性。

執行順序：

1. 在私人位置建立完整 mirror／bundle 備份及獨立來源備份，記錄 refs 與校驗碼，實際測試可還原。確認遷移備份足以支援資料比對後才清理。
2. 列出分支、標籤、PR refs、Pages 發佈產物、Actions artifacts、release 附件與其他 clone 的處理清單。協調暫停推送、分支保護及維護窗口。
3. 在隔離 mirror 中移除上述敏感檔案的所有歷史版本，掃描其他檔案殘留；檢查應用建置、測試與新 clone 不再含目標內容。此階段先產生可供審查的 refs 前後對照。
4. 確認後才覆寫遠端 refs，重建乾淨 Pages 發佈，通知協作者重新 clone，避免舊分支重新帶回資料。視需要請 GitHub 處理殘留的快取／PR 引用。
5. 對實際外洩的可授權連結或憑證安排撤銷／替換；Firebase 公開用戶端設定不可直接當作管理密鑰。既有 Storage token 的切換由附件階段處理。
6. 通知 repository 管理者與受影響資料持有人：說明資料種類、已確認的公開可取得方式、處理範圍與仍無法排除的副本；不聲稱已證明有人下載。此輪僅制定通知內容與對象，未對外發送。

本輪完成評估與處理計畫，未建立完整 Git 備份、改寫歷史、強制推送、撤銷連結或寄送通知。實際清理另列待辦。

## 公開站點與存取限制

匿名 HTTP 檢查：正式 Firestore 工作空間與會員集合均回應 403。原始資料從 Pages 移除，但公開 Git 歷史仍可取得，故不能宣稱未核准者已完全無法取得舊資料。

規則要求已驗證信箱、有效會員索引、會員 `status == active` 及對應看板授權；前端測試涵蓋未核准者不載入會員編輯介面。本輪 79 項應用測試、31 項 Firestore 規則測試通過。Firefox 的 localhost:8001 連接正式 Firebase，已確認測試帳號 Google 登入成功，但顯示「尚未取得工作空間權限」、看板清單為空、新增／編輯／封存停用。重新載入後仍受阻擋。網路監控器顯示自己的 memberLookup 僅回傳 memberId，接續會員讀取 target 被移除並回傳 code 7／Missing or insufficient permissions；WebChannel 外層 HTTP 200 不代表資料讀取成功。

尚未完成：GitHub Pages 同帳號複測、以該未核准帳號直接讀取看板／牌卡／完整會員集合，以及完全沒有會員索引的新帳號情境。主控台唯讀探測因使用者切換視窗而未確認執行，不列為已通過；規則模擬器已涵蓋相應讀取拒絕。

依使用者指示，測試會員已從 `active` 改為 `pending`，保留 Viewer 角色與原看板清單，且確認只有該測試信箱對應此會員。私人備份 `attachments_export/stage-one-audit/pending-member-before.json` 保存修改前文件與伺服器版本。完成上述檢查後，僅將 `status` 還原為 `active`，使用最新 updateTime 前置條件並重讀驗證；全部會員欄位與原備份一致，原 Viewer 角色與授權保留。還原確認存於同目錄的 `pending-member-restored.json`。後續已觀察到原 Viewer 在 localhost 恢復載入 3D 看板，寫入控制維持停用。
