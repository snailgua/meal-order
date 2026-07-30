# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 開發指令

```bash
npm run dev        # 啟動 dev server（Turbopack）
npm run build      # 生產建置
npm run lint       # ESLint（next core-web-vitals + typescript）
npm test           # Node test runner（tsx）
npm start          # 啟動生產 server
```

變更後至少執行 `npm test`、`npm run lint` 與 `npm run build`。

## 路徑別名

`@/*` → `./src/*`（tsconfig paths），所有 import 使用 `@/lib/...`、`@/components/...` 等。

---

# 部門訂餐與對帳 Web App — 完整開發 Prompt

## 一、專案概述

請幫我開發一個**手機友善的 Web App**，用於公司部門內部的**團體訂餐**與**付款追蹤**。

### 背景

目前部門約 50–60 人，每天由一位自願者負責統一幫大家訂餐。過去是在 LINE 群組裡用「接龍」方式收集訂單，負責人再自行統計品項數量、先墊付全額，事後自行追蹤每個人有沒有還錢。這個流程既混亂又容易漏帳，因此需要一個專屬的 Web App 來取代。

### 核心目標

1. 讓訂餐負責人能快速開一張訂單、上傳菜單、收集大家的訂餐內容、自動統計品項與總價。
2. 讓所有參與訂餐的人都能方便地查看自己該付多少錢、付給誰、以及完成付款確認。
3. 讓負責人能輕鬆追蹤誰已付款、誰還沒付。

---

## 二、技術架構

| 項目       | 選擇                                                         |
| ---------- | ------------------------------------------------------------ |
| 前端框架   | Next.js（React）                                             |
| 樣式       | Tailwind CSS                                                 |
| 資料儲存   | Google Sheets 作為資料庫（透過 Google Sheets API 讀寫）       |
| API 認證   | Google Service Account（金鑰硬編在環境變數中）               |
| 部署       | Vercel（或類似平台）                                         |
| 使用者辨識 | 信任制，不設帳號/登入系統；使用者每次手動輸入自己的名字       |
| 裝置適配   | Mobile-first 響應式設計，手機與桌機皆可正常操作               |

### Google Sheets 結構建議

需要至少以下工作表（Sheets）：

- **訂餐場次表**：紀錄每一次訂餐的場次資訊（場次 ID、日期、標題、負責人姓名、負責人銀行名稱、負責人銀行帳號、QR Code 圖片連結、轉帳連結（選填）、狀態：開放/已關閉、建立時間）
- **訂單明細表**：紀錄每一筆個人訂單（場次 ID、姓名、品項名稱、價格、備註、建立時間、最後修改時間）
- **付款追蹤表**：紀錄每一筆應付帳款的狀態（場次 ID、付款人姓名、收款人姓名、金額、付款人是否標記已付、收款人是否確認收到、核銷時間）

---

## 三、頁面與功能規格

### 頁面 A：今日訂餐（首頁）

此頁面是 App 的主入口，顯示**今天所有的訂餐場次**，按建立時間排序（最新在上）。

#### A-1. 場次列表

- 顯示今天所有訂餐場次的卡片，每張卡片顯示：
  - 標題（例如「3/21 午餐 — 池上便當」）
  - 負責人姓名
  - 狀態標籤（開放中 / 已關閉）
  - 目前已訂餐人數
- 點擊卡片可進入該場次的詳細頁面

#### A-2. 建立新訂餐場次

頁面上方或明顯位置有一個「**開新訂單**」按鈕，點擊後進入建立流程：

負責人需填寫以下欄位：

| 欄位                | 必填 | 說明                                          |
| ------------------- | ---- | --------------------------------------------- |
| 訂餐標題            | ✅   | 例如「3/21 午餐 — 池上便當」                   |
| 負責人姓名          | ✅   | 負責訂餐與收款的人                             |
| 銀行名稱            | ✅   | 例如「國泰世華」                               |
| 銀行帳號            | ✅   | 負責人的銀行帳號，供大家轉帳用                 |
| 收款 QR Code 圖片   | 選填 | 上傳一張圖片，供大家用網路銀行掃碼轉帳         |
| 轉帳連結            | 選填 | 銀行 App 的深層連結，點擊可直接跳轉至轉帳頁面 |
| 菜單圖片            | 選填 | 可上傳**多張**圖片，供大家參考菜單內容         |

#### A-3. 場次詳細頁面

進入某一個訂餐場次後，頁面分為以下區塊：

**① 場次資訊區**

- 顯示標題、負責人姓名、負責人收款資訊（銀行名稱＋帳號）
- 若有 QR Code 圖片，顯示出來
- 若有轉帳連結，顯示為可點擊的按鈕
- 若有菜單圖片，以可展開/滑動的方式顯示（支援多張）

**② 訂餐填單區**

- 如果場次狀態為「**開放中**」，顯示一個表單讓使用者填寫：
  - 你的名字（自由輸入文字）
  - 品項名稱（自由輸入文字）
  - 價格（數字輸入）
  - 備註（選填，自由文字，例如「配菜不要芹菜」）
- 送出後，該筆訂單出現在下方的訂單列表中
- 如果場次狀態為「**已關閉**」，隱藏填單表單，顯示「訂餐已截止」提示，且**不允許新增訂單**

**③ 訂單列表區**

- 以列表或表格方式顯示所有已提交的訂單，每筆顯示：
  - 姓名、品項、價格、備註（若有）
- **編輯功能**：每一筆訂單旁邊有「編輯」和「刪除」按鈕
  - 填單本人和負責人都可以修改或刪除（信任制，不做身份驗證）
  - 負責人可修改品項名稱（用於統一不一致的寫法，例如把「控肉飯」改成「爌肉飯」）

**④ 統計摘要區**

- 自動即時統計，顯示在頁面下方或側邊：
  - 各品項的數量與小計，例如：
    ```
    香嫩爌肉飯 ×7 — $700（其中 1 份：不要芹菜）
    香嫩滷排骨飯 ×1 — $100
    清蒸鱈魚排飯 ×2 — $220
    ```
  - 備註要呈現在對應品項下方，格式為「其中 N 份：備註內容」
  - 最底部顯示：**總計 N 份，共 $X,XXX**
- **「複製摘要」按鈕**：點擊後將摘要文字複製到剪貼簿，格式如下（每個品項換行）：
  ```
  香嫩爌肉飯 ×7（1份不要芹菜）
  香嫩滷排骨飯 ×1
  清蒸鱈魚排飯 ×2
  香煎鮭魚排飯 ×1
  現炸排骨飯 ×2
  總計：13 份，共 $1,370
  ```

**⑤ 關閉訂餐按鈕**

- 負責人可以點擊「**關閉訂餐**」按鈕，將場次狀態改為「已關閉」
- 關閉後，填單表單消失，不允許再新增任何訂單
- 關閉的同時，自動為每一筆訂單在「付款追蹤表」中建立一筆應付帳款紀錄

---

### 頁面 B：付款追蹤（追債頁面）

此頁面用於追蹤所有未核銷的應付帳款，**所有人看到同一份完整清單**。

#### B-1. 未付款清單

- 顯示**所有尚未核銷的帳款**，不限於今天，包含過去所有天的累積欠款
- 每一筆紀錄顯示：
  - 付款人姓名（誰欠錢）
  - 收款人姓名（欠誰的錢）
  - 品項名稱
  - 金額
  - 訂餐場次標題與日期（方便辨識是哪一天、哪一餐的）
  - 收款人的銀行名稱＋帳號（方便付款人直接轉帳）
  - 若該場次有 QR Code，提供可查看的入口
  - 若該場次有轉帳連結，提供可點擊的按鈕
- **不同場次、不同收款人的欠款要分開顯示**
  - 例如：小明週一欠 A $100、週三欠 B $120，這是兩筆獨立的紀錄
- 建議以「收款人」分組顯示，讓付款人可以快速看到自己欠某人多少錢

#### B-2. 付款確認流程（雙重確認機制）

每一筆帳款有兩個確認步驟：

1. **付款人標記「我已轉帳」**：付款人在自己的那一筆帳款上點擊按鈕，標記已付款
2. **收款人確認「我已收到」**：收款人看到對方已標記付款後，確認收到款項，點擊打勾按鈕進行核銷

- 只有當**兩邊都確認**後，該筆帳款才會被核銷
- 核銷後的紀錄從未付款清單中移除（但資料保留在 Google Sheets 中）
- 因為是信任制，按鈕不做身份驗證，任何人都可以點（靠信任）

#### B-3. 狀態顯示

每筆帳款的狀態應以視覺化方式清楚區分：

| 狀態                         | 顯示方式             |
| ---------------------------- | -------------------- |
| 雙方都尚未確認               | 紅色 / 未付款標籤     |
| 付款人已標記付款，收款人未確認 | 黃色 / 待確認標籤     |
| 雙方都已確認（已核銷）        | 綠色 / 已完成（然後從清單隱藏） |

#### B-4. 資料保留

- 已核銷的紀錄保留 **3 個月**，超過 3 個月後可自動清除（或由定期腳本處理）
- 未核銷的紀錄永遠顯示，直到被核銷為止

---

## 四、UI/UX 設計原則

1. **Mobile-first**：所有操作必須在手機上流暢完成，按鈕大小、間距適合觸控
2. **簡潔直覺**：部門同事非技術人員，介面要直覺好懂，不需要教學就能上手
3. **中文介面**：所有文字皆為**繁體中文**
4. **即時更新**：多人同時使用時，訂單列表和統計摘要應即時反映最新資料（透過輪詢或即時同步機制）
5. **底部導覽列**：四個頁面（怎麼用？/ 今日訂餐 / 付款追蹤 / 回報問題）之間用底部 Tab 切換，預設進入「今日訂餐」

---

## 五、非功能性需求

1. 圖片上傳（菜單、QR Code）：因為 Google Sheets 無法直接存圖片，可考慮將圖片上傳至 Google Drive 同一個帳號下，再在 Sheets 中存放圖片的公開連結
2. 資料同步：前端定時輪詢 Google Sheets（例如每 5–10 秒），確保多人同時使用時資料一致
3. 錯誤處理：網路斷線、API 請求失敗時要有友善的提示訊息
4. SEO 不重要：這是內部工具，不需要 SEO 優化

---

## 六、MVP 優先級建議

如果需要分階段開發，建議優先順序：

1. **P0（必須有）**：建立場次 → 填寫訂單 → 訂單列表 → 品項統計與複製摘要 → 關閉訂餐
2. **P1（核心）**：付款追蹤頁面 → 雙重確認機制 → 未付款清單
3. **P2（重要）**：菜單圖片上傳 → QR Code 與轉帳連結 → 訂單編輯/刪除
4. **P3（Nice to have）**：已核銷紀錄自動清除 → 資料即時輪詢優化

---

## 七、實作狀態與技術備忘（2026-07-30 更新）

### 功能完成度

P0–P3 所有功能皆已完成。另外新增以下功能：

- **建立即關閉（對帳模式）**：實際使用上大家仍在 LINE 接龍點餐，app 主要用來銷帳。因此建立場次時**若有預先輸入訂單，匯入成功後前端會自動 PATCH 關閉場次**，直接產生付款追蹤紀錄；沒有預輸入訂單則維持「開放中」。需要線上加點可到場次頁「重新開放訂餐」。
- **預先輸入訂單**：建立場次時，團主可預先輸入訂單，支援兩種方式：
  - **轉錄匯入（含 AI 智慧解析）**：支援**貼上文字**或**上傳截圖**兩種方式，場次頁也可事後匯入。文字輸入按「解析文字」後先用 regex parser（`src/lib/parseTranscript.ts`）嘗試，支援每行「姓名 品項 價格」、「你訂」平台、餐盒平台等已知格式。**若 regex 無法解析或有上傳截圖，自動使用 Gemini AI 多模態解析**（`/api/parse-ai`），可處理任意格式的文字及圖片（LINE 接龍截圖、菜單截圖等）。**截圖支援一次多張**（前端先各自縮圖壓縮，一次請求送出，跨圖重複的訂單只算一筆）。按鈕會顯示「AI 解析中...」提示。解析結果可逐筆編輯、刪除後再匯入。
  - **解析結果是累加的**（可以分批貼文字、分批上傳截圖）。因此**已經吃進草稿的輸入一定要從來源清掉**：成功解析後清空輸入框（只留解析失敗的行）、清空已選截圖。少做這步的話重複按一次「解析文字」就會把同一份接龍變成兩份訂單。
  - **手動新增**：按「手動新增一筆訂單」逐筆輸入姓名、品項、價格、備註。兩種方式可混合使用，共用同一份訂單列表。完全空白的列在匯入時直接忽略（按了「手動新增」卻沒填不該讓整批被拒、讓團主完全建不了場次）。
- **場次資訊可編輯**：標題、負責人姓名、銀行名稱、銀行帳號、收款 QR Code（上傳/更換/移除）、轉帳連結、菜單圖片（多張上傳/移除）皆可在場次頁面直接編輯。圖片上傳使用樣式化按鈕（虛線框），非原生 file input。**編輯標題或負責人時會同步更新訂單明細表和付款追蹤表**。
- **付款追蹤頁面改進**：
  - 以收款人分組，同一收款人底下的欠款按**付款人姓名排序**，同一人的多筆品項合併顯示（名字只出現一次，附合計金額）。
  - 合計金額以大字深綠粗體顯示，個別品項價格以小字灰色顯示，視覺上區分。
  - QR Code 和銀行資訊使用該收款人**最新場次**的資料，確保團主更新 QR Code 後舊帳款也能看到新的。
  - **付款頁直接更新 QR Code**：收款人卡片上有「更新 QR Code / 設定 QR Code」按鈕，點擊後上傳新圖會 PATCH 該收款人**最新場次**的 QR（因為 QR 常有時限，需頻繁更新）。信任制，不驗證身份。
  - 「我已轉帳」和「確認收到」按鈕同時顯示；團主按「確認收到」即直接核銷，不需付款人先標記。付款頁可一鍵複製收款人銀行帳號。
  - 已標記轉帳但尚未核銷的欠款有「**按錯了**」可撤銷標記（`payerUndo`）。信任制下誤按很常見，而「已標記付款」會讓來源訂單再也不能修改或刪除，沒有回頭路只能人工改 Sheet。
  - **欠款只在核銷或刪除時才會從清單消失**。場次重新開放中的欠款照常顯示並可確認，只加上「金額可能還會變動」提示；場次列遺失的孤兒欠款也照常顯示、可核銷。靜默隱藏會讓人以為帳已經清掉。
- **Email 通知**：問題回報送出後自動寄 email 通知管理者（透過 nodemailer + Gmail SMTP）。環境變數：`SMTP_EMAIL`, `SMTP_PASSWORD`, `NOTIFICATION_EMAIL`。
- **時區修正**：所有 API 時間戳使用 `Asia/Taipei` 時區（`toLocaleString("zh-TW", { timeZone: "Asia/Taipei" })`），非 UTC。
- **圖片全螢幕檢視**：QR Code 和菜單圖片點擊後以全螢幕 modal 放大檢視。
- **自動輪詢**：首頁、場次頁與付款頁透過 `usePolling`（`src/lib/usePolling.ts`）每 15 秒刷新，**分頁切到背景時停止輪詢、回前景立刻補抓一次**。每次輪詢是 2 次 Sheets 讀取，很容易撞到配額（見「已知注意事項 1d」）。畫面顯示最後更新時間與錯誤狀態。
- **自動清理**：進入付款追蹤頁時自動呼叫 cleanup API，做兩件事：
  - 同一訂單 ID 若殘留多列未核銷付款就去重（留最有付款進度的那列）。reconcile 只在該場次再被動到時才收斂，沒人再碰的舊場次會一直重複計費。
  - 3 個月前、**已有訂單 ID** 的核銷列清除付款個資並壓成封存標記（`[1]` 欄寫 `__ARCHIVED_PAYMENT__`），保留 sessionId/orderId/核銷狀態，避免日後對帳把已付訂單重新建成欠款。沒有訂單 ID 的核銷列會被跳過 —— 封存會清掉內容比對用的欄位，壓了就沒東西能讓 reconcile 認出「這筆已經付過」，寧可留著個資也不能讓舊欠款復活。
- **使用教學頁面**（`/guide`）：流程圖風格說明訂餐與付款流程，含信任制提醒、Google Sheet 連結。
- **問題回報頁面**（`/feedback`）：表單寫入 Google Sheets「問題回報表」，問題類型下拉選單（Bug 回報/功能建議/其他），支援多張截圖上傳（GCS）。送出後寄 email 通知。
- **底部導覽列 4 tab**：怎麼用？→ 今日訂餐（預設）→ 付款追蹤 → 回報問題
- **localStorage 記憶姓名**：使用者名字存在 `localStorage("userName")`，訂餐表單與問題回報表單自動帶入。

### 實際技術架構

| 項目 | 實際選擇 |
|------|---------|
| 框架 | Next.js 16 (App Router, Turbopack) |
| 語言 | TypeScript |
| 樣式 | Tailwind CSS v4 |
| 資料庫 | Google Sheets API (`googleapis` package) |
| 圖片儲存 | **Google Cloud Storage**（非 Google Drive，Drive 對 Service Account 有 storage quota 限制） |
| AI 解析 | **Google Gemini 2.5 Flash**（`@google/generative-ai` SDK），用於轉錄匯入的 fallback 解析 |
| 部署 | Vercel（已部署） |
| UI 風格 | emerald/stone 配色，Apple Podcasts 風格，rounded-2xl 卡片 |

### Google Sheets 欄位對照（API 使用 array index，改欄位必須同步改 API）

**訂餐場次表：**
`[0]場次ID [1]日期 [2]標題 [3]負責人姓名 [4]負責人銀行名稱 [5]負責人銀行帳號 [6]QR Code圖片連結 [7]轉帳連結 [8]狀態 [9]建立時間 [10]菜單圖片連結(逗號分隔) [11]版本(最後成功 mutation 的 requestId)`

**訂單明細表：**
`[0]場次ID [1]日期 [2]標題 [3]負責人姓名 [4]姓名 [5]品項名稱 [6]價格 [7]備註 [8]建立時間 [9]最後修改時間 [10]訂單ID`

**付款追蹤表：**
`[0]場次ID [1]日期 [2]標題 [3]付款人姓名 [4]收款人姓名 [5]金額 [6]品項名稱 [7]備註 [8]付款人是否標記已付 [9]收款人是否確認收到 [10]核銷時間 [11]付款人標記時間 [12]訂單ID(來源訂單)`

**問題回報表：**
`[0]回報時間 [1]姓名 [2]類型 [3]描述 [4]截圖連結(逗號分隔) [5]回覆(人工填寫)`

### 關鍵檔案結構

帳務正確性的核心都在 `src/lib/`，且刻意寫成**純函式 + 有測試**，因為這裡算錯就是真的金錢糾紛。
API route 只負責取鎖、讀資料、呼叫 planner、原子套用。

```
src/lib/                     # ★ 帶 .test.ts 的都是純函式，改動前先看測試守住什麼契約
├── sheets.ts                # Sheets 存取層：getRows / appendRow(s) / updateCells /
│                            #   applyAtomicSheetMutations（單一 batchUpdate 原子套用）/
│                            #   tombstone 工具（isDeletedRow, isTombstoneFor）/ 429 退避重試
├── reconcilePayments.ts     # ★ 對帳核心。planReconcilePayments() 是純函式，回傳 mutation 計畫
├── paymentRules.ts          # ★ 付款狀態判定（isSettledPayment / hasPaymentConfirmation / 欄位同步）
├── resourceLock.ts          # 跨 instance 寫入鎖（GCS ifGenerationMatch=0）
├── sessionVersion.ts        # ★ 場次 CAS 三態判定：apply / replay / conflict
├── inputValidation.ts       # ★ 輸入正規化與 requestId 格式驗證（idempotencyKey）
├── sheetSchema.ts           # ★ 工作表 header schema 與相容變體（setup-sheets 用）
├── requestId.ts             # ★ newRequestId()：時間戳 + UUID，含非 secure context fallback
├── maintenance.ts           # sheetWritesPaused()：SHEETS_MAINTENANCE_MODE 開關
├── usePolling.ts            # 輪詢 hook，分頁切背景時停止
├── compressImage.ts         # 截圖上傳前的縮圖壓縮（避開 Vercel 4.5MB body 上限）
├── parseTranscript.ts       # 轉錄文字 regex 解析（首頁與場次頁共用）
└── storage.ts               # GCS 圖片上傳

src/app/
├── page.tsx                 # 首頁：場次列表 + 建立新場次（含轉錄匯入、建立即關閉）
├── session/[id]/page.tsx    # 場次詳細：訂餐表單 + 轉錄匯入 + 訂單列表 + 統計摘要 + 關閉/重開
├── payments/page.tsx        # 付款追蹤：未付款清單 + 雙重確認 + 按錯了 + 更新 QR
├── guide/page.tsx           # 使用教學
├── feedback/page.tsx        # 問題回報
└── api/
    ├── sessions/route.ts      # GET(今日場次), POST(建立，requestId 冪等)
    ├── sessions/[id]/route.ts # GET, PATCH(狀態/資訊，CAS + reconcile), DELETE(整場 tombstone)
    ├── orders/route.ts        # GET, POST, PUT, DELETE（皆取鎖 + ID 定位 + 同步付款列）
    ├── orders/batch/route.ts  # POST(批次匯入，轉錄匯入用)
    ├── payments/route.ts      # GET(未核銷), PATCH(payerConfirm / receiverConfirm / payerUndo)
    ├── feedback/route.ts      # POST(寫入問題回報表 + email 通知)
    ├── parse-ai/route.ts      # POST(Gemini 解析文字/多張圖片)
    ├── upload/route.ts        # POST(上傳圖片到 GCS)
    └── cleanup/route.ts       # POST(重複未核銷列去重 + 90 天前核銷列壓成封存標記)

src/components/BottomNav.tsx  # 底部導覽列（4 tab）
src/types/index.ts            # Session / Order / Payment 型別

scripts/                      # 都不是自動執行的，需要時手動跑
├── setup-sheets.ts           # 初始化工作表（header 不相容時零寫入中止）
├── backfill-order-ids.ts     # 一次性補訂單ID（預設 dry-run，--apply 需 maintenance flags）
└── compact-tombstones.ts     # 清除累積的 __DELETED__ 空列（預設 dry-run，--apply 才刪）
```

### 已知注意事項

1. **欄位索引硬編碼**：所有 API route 使用 `row[N]` 存取 Google Sheets 欄位，若在 Google Sheets 中新增/刪除/移動欄位，必須同步更新對應的 API route
1a. **以訂單ID定位，不用列號**：訂單有不可變的 `[10]訂單ID`，付款列以 `[12]訂單ID` 對應來源訂單。建立場次、單筆訂單與批次匯入由前端產生 timestamped UUID `requestId`，伺服器用它產生 deterministic ID 並辨識失敗重送，避免 append 成功但回應遺失後重複建單。訂單 PUT/DELETE 與付款 PATCH 優先用 ID 定位；無 ID 的舊資料退回「rowIndex + 內容驗證」（客戶端帶 `original`/`expected`），找不到回 409。`scripts/backfill-order-ids.ts` 預設只 dry-run；apply 前必須停寫、備份並帶齊 maintenance flags
1b. **付款列一致性靠 `planReconcilePayments()`**（`src/lib/reconcilePayments.ts`）：以訂單為準冪等對帳（已核銷/已有付款證據的衝突列保留、未確認列同步/刪重複/刪孤兒、缺的補建）。同一場次的訂單、場次狀態與付款 mutation 會先用 GCS generation precondition 取得跨 instance lock；需跨表變更時再用單一 Sheets `batchUpdate` 原子套用，避免關閉/新增、修改/付款同時交錯或只成功一半。場次 PATCH 另以 `[11]版本` 做 CAS，避免關閉→重開後舊關閉請求才抵達的 stale retry。已有人標記付款後不可修改或刪除來源訂單，也不可更換團主

**改 reconcile 前務必知道的三條不變式**（都是踩過的坑，`reconcilePayments.test.ts` 有守住）：
   - **刪除與補建同進退**：`createMissing` 為 false 時（超過 90 天保留期）**也不可以刪除**配不到訂單的列。只刪不補會讓 reconcile 淨減少欠款 —— 錢就這樣不見了。換團主這種「刪一列補一列」的成對操作要傳 `allowArchivedCreate`，否則舊場次會只刪不補
   - **有付款證據的孤兒列會被保留，補建時要先扣掉它**：否則同一餐出現兩列欠款、付款頁合計加倍
   - **已核銷列（含封存標記）永不改動**，但要在 Pass 1 先佔用對應訂單，重開再關才不會為已付清的訂單重建欠款
1c. **刪除採 tombstone，不做實體刪列**：刪除會把 A 欄改成 `__DELETED__`；有 immutable ID 的資源使用 `__DELETED__:<ID>` 保留 durable key，其餘欄位清空。這既避免後續列號位移，也防止已刪資源被延遲的舊 POST 重新建立。**代價是 Sheet 上會慢慢累積這些空列**，團主在 Google Sheet 上會直接看到。要清掉用 `npx tsx scripts/compact-tombstones.ts`（預設 dry-run，`--apply` 才實際刪除）：它只刪「位於最後一筆真實資料之後」的 tombstone，所以真實列的列號不會變動，即使有人正在使用也安全；夾在資料中間的會跳過，那種要先讓部署進入 `SHEETS_MAINTENANCE_MODE=1` 再離線處理
1d. **Sheets 429 是常態，不是意外**：實測撞到的是 **`Read requests per minute per user` = 60 次/分鐘**（不是 300/分鐘/專案那條）。因為全 app 共用一組 service account，所有請求都算同一個 "user"，所以要拿 **60/分鐘** 來估算，不是 300。而一次輪詢就是 2 次讀取 → 大約 5 個人同時開著頁面就吃滿。因應方式：`src/lib/sheets.ts` 的每個 API 呼叫都包了指數退避重試（429/5xx，最多 4 次，實測會退避到 20 秒，所以各 route 需要 `maxDuration = 60`）；前端靠 `usePolling` 在背景分頁停止輪詢減量。**新增讀取路徑前先算一下它會讓每分鐘多幾次讀取**，能合併成一次 `getRows` 就不要拆兩次
1e. **requestId 一律用 `newRequestId()`**（`src/lib/requestId.ts`），不要直接寫 `crypto.randomUUID()`：它只在 secure context 存在，手機連區網 dev server（http）或舊 in-app 瀏覽器會是 undefined，少了 fallback 整個 app 會完全無法寫入。格式必須通過 `idempotencyKey()` 驗證，`requestId.test.ts` 有守住這個契約
1f. **寫入只走 `updateCells` / `applyAtomicSheetMutations`**：`sheets.ts` 還留著 `updateRow()` 與 `deleteRow()`，但**目前沒有任何呼叫端，也不該再用**。`updateRow` 是整列覆寫，兩人同時動同一列會互相蓋掉對方剛寫入的欄位（付款確認就是這樣被蓋掉過）；`deleteRow` 雖然已改成 tombstone，但它是單獨一次寫入，無法和其他表的變更放進同一個原子 batch。同理 `reconcilePayments()`（async 版）也已無呼叫端，一律改用 `planReconcilePayments()` 拿計畫、再交給 `applyAtomicSheetMutations` 一次套用
2. **圖片需公開讀取**：GCS bucket 必須授予 `allUsers` 為 Storage Object Viewer，否則圖片 URL 會 403
3. **文字自動 trim**：所有使用者輸入的文字欄位（姓名、品項、備註、標題等）在寫入 Sheets 前會自動 `.trim()`
4. **信任制操作警告**：「我已轉帳」會提示付款人姓名確認、「確認收到」和「重新開放訂餐」和「關閉訂餐」按鈕會跳 confirm 警告，提醒只有團主/收款人才該點
4a. **信任制要留回頭路**：沒有登入系統，誤按是常態。任何「按了就再也改不了」的操作都要有撤銷途徑，否則只能人工改 Google Sheet（「我已轉帳」的「按錯了」就是為此而加）。同理，寫入失敗時不要把使用者剛填的草稿丟掉 —— 場次資訊編輯遇到 409 會保留草稿（裡面可能有剛上傳的 QR 圖）並讓他直接重試
5. **Hydration 問題**：若改了 layout 或首頁文字後出現 hydration mismatch，需 `mv .next ~/.Trash/` 再重啟 dev server
6. **環境變數**：`.env.local` 包含 `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_PRIVATE_KEY`, `GOOGLE_SHEET_ID`, `GCS_BUCKET_NAME`, `SMTP_EMAIL`, `SMTP_PASSWORD`, `NOTIFICATION_EMAIL`, `GEMINI_API_KEY`。另有選用的 `SHEETS_MAINTENANCE_MODE=1`：設了之後**所有寫入 API 一律回 503**，供離線維護（例如壓縮 Sheet）時用。注意 `GCS_BUCKET_NAME` 現在是所有寫入的硬性前提（拿不到寫入鎖就不寫），不只用於圖片上傳
7. **localStorage**：使用者名字會存在 `localStorage("userName")` 中，下次自動帶入
8. **對正式資料動手前先稽核**：Sheet 就是正式資料庫，沒有 staging。本機 dev server 也連同一份 Sheet，所以跑端到端測試會產生真實列 —— 測完要把測試場次刪掉，需要時再用 `compact-tombstones.ts` 清空列

---

## 測試慣例

`npm test` 跑的是 Node test runner（透過 tsx），測試檔與被測檔放在一起：`src/lib/*.test.ts`。

只對**純函式**寫測試，不 mock Google API。所以帳務判斷都刻意抽成純函式（`planReconcilePayments`、`paymentRules`、`decideSessionMutation`、`inputValidation`、`sheetSchema`），API route 只負責 I/O 與組裝。加新的帳務規則時把邏輯放進這些純函式裡，才測得到。

現有測試守住的契約（改動這些行為前先讀對應測試）：
- `reconcilePayments.test.ts` —— 對帳的三條不變式（見「已知注意事項 1b」）、舊場次不重建欠款、封存標記仍佔用訂單、重複計費防護
- `paymentRules.test.ts` —— 同步欄位時不可抹掉付款證據
- `sessionVersion.test.ts` —— CAS 三態；關閉→重開後舊關閉重送必須被拒
- `requestId.test.ts` —— `newRequestId()` 產出的格式必須通過伺服器端 `idempotencyKey()`，含沒有 `crypto.randomUUID` 的 fallback 路徑
- `sheets.test.ts` / `sheetSchema.test.ts` —— tombstone 語意、header 相容變體

---

## CLAUDE.md 維護原則

**meal-order 專屬注意**：
- 「Google Sheets 欄位對照」section 是**硬編碼依賴的事實來源** —— 改了就要同步改 API route 中的 `row[N]` 索引，以及 `src/lib/sheetSchema.ts`。指令正確性在這裡是 critical
- 「實作狀態與技術備忘」會隨功能演進而老化，加新功能時順便檢查舊段落是否還準確
- 寫進本檔的數字（配額、上限、保留天數）要來自實測或程式碼常數，不要憑印象 —— 曾經把 Sheets 讀取額度寫成 300/分鐘/專案，實際綁住我們的是 60/分鐘/user，差了 5 倍
