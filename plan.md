# ZeroCanvas — 實作計畫

## 專案概述

**目標**：讓平板在瀏覽器上手寫的內容，即時同步顯示到電腦瀏覽器（投影用），完全無後端、P2P 架構。

**技術堆疊**
- React 19 + Vite 7 + TypeScript
- **MUI (Material UI v7)** — 全站 UI 元件（`@mui/material` + `@mui/icons-material` + `@emotion/react`）
- PeerJS (WebRTC DataChannel) — 純 P2P，STUN/TURN 使用 PeerJS 公共 Cloud Server
- 部署目標：GitHub Pages / Cloudflare Pages（純靜態）

**角色定義**
| 角色 | 裝置 | 行為 |
|------|------|------|
| **Host**（主機/投影端） | 電腦 | 建立 Room，顯示 Room ID / QR Code，接收並渲染畫面 |
| **Client**（繪圖端） | 平板 | 掃描 QR Code 或輸入 Room ID 加入，繪圖並推送事件 |

---

## 實作進度總覽

| 模組 | 狀態 |
|------|------|
| A. PeerJS 連線核心 | ✅ 完成 |
| B. Canvas 繪圖引擎 | ✅ 完成（含座標正規化修正、iPad 手寫筆延遲修正）|
| C. 同步協議設計 | ✅ 完成（含多 Client 互相同步）|
| D. 顯示模式 Host/Client UI | ✅ 完成 |
| Bug 修正（6 項） | ✅ 全部修正 |
| E. UX 最佳化與部署 | ⏳ 部分完成（PWA Manifest、錯誤處理 UI）|
| F. 功能增強與修正（5 項） | ✅ 完成（F1~F5 全部實作）|

---

## A. PeerJS 連線核心 ✅

**目的**：管理 P2P 連線生命週期，提供角色選擇與 Room 管理。

### 實作細節
- [x] 建立 `src/hooks/usePeer.ts` — 封裝 PeerJS 初始化、銷毀、事件監聽
- [x] Host 模式：`peer.on('connection', ...)` 接受多個 Client 連線（1 Host : N Clients）
- [x] Client 模式：`peer.connect(hostId)` 加入指定 Room
- [x] Room ID 產生邏輯：使用 6 位大寫英數字隨機碼（避免 PeerJS 預設 UUID 過長）
- [x] 連線狀態機：`idle` → `connecting` → `connected` → `disconnected` / `error`
- [x] 斷線自動重連：指數退避，最多重試 5 次
- [x] 建立 `src/types/peer.ts`：定義 `PeerRole`, `ConnectionState` 型別
- [x] QR Code 產生：使用 `qrcode` 套件，將連線 URL（含 Room ID）編碼成 QR
- [x] 連線 URL 格式：`https://yoursite.com/?room=XXXXXX&role=client`
- [x] `src/contexts/PeerContext.tsx`：React Context 提供全域連線狀態

---

## B. Canvas 繪圖引擎 ✅

**目的**：高效能的手寫繪圖體驗，支援壓力感應與多種工具。

### 實作細節
- [x] 建立 `src/components/DrawingCanvas.tsx` — 雙層 Canvas（底層靜態 + 上層動態預覽）
- [x] 使用 `PointerEvent`（支援 `pressure`, `tiltX`, `tiltY`）取代 MouseEvent/TouchEvent
- [x] 實作 **筆刷工具**：Catmull-Rom 曲線平滑（避免折線感），壓力控制筆觸寬度
- [x] 實作 **橡皮擦工具**：`destination-out` compositing，大小可調
- [x] 實作 **直線工具**：拖曳預覽（上層 canvas），放開時繪製到底層
- [x] 實作 **矩形工具**：同直線工具邏輯
- [x] 實作 **清除全部**：清空底層 canvas，並廣播 `clear` 事件
- [x] 顏色選擇器：常用色盤（8 色）+ 自訂 `<input type="color">`
- [x] 筆觸粗細：Slider（2px ~ 30px）
- [x] `src/hooks/useDrawing.ts`：封裝繪圖狀態與工具邏輯
- [x] `src/types/drawing.ts`：定義 `Tool`, `DrawMessage`, `Point`, `DrawStyle` 型別
- [x] 防止 iOS Safari 頁面捲動干擾繪圖（`touch-action: none`）
- [x] 高 DPI 支援：`devicePixelRatio` 縮放 canvas（ResizeObserver）
- [x] **座標正規化**：所有繪圖座標以 0~1 正規化傳送，接收端依自身 canvas 尺寸反正規化，確保跨裝置尺寸正確映射
- [x] **全螢幕 resize 保護**：ResizeObserver 觸發時先 `toDataURL()` 備份、resize 後縮放還原，防止內容清空
- [x] **筆觸粗細跨裝置一致**：lineWidth 乘上 `window.devicePixelRatio`，視覺粗細在任何 DPR 裝置相同

---

## C. 同步協議設計 ✅

**目的**：最小延遲地把繪圖操作從 Client 傳輸到 Host，並處理新加入者的狀態同步。

### 實作細節
- [x] 定義 `DrawMessage` 協議（JSON over DataChannel）：

```ts
type DrawMessage =
  | { type: 'stroke_start'; style: DrawStyle; point: Point }
  | { type: 'stroke_move'; points: Point[] }   // 批次點，減少訊息數
  | { type: 'stroke_end' }
  | { type: 'clear' }
  | { type: 'snapshot_request' }               // 新 client 請求全量同步
  | { type: 'snapshot'; dataUrl: string }      // Host 回傳 canvas PNG DataURL
```

- [x] **增量同步**：`stroke_move` 以 16ms（60fps）批次打包 points，不逐點傳送
- [x] **全量同步**：新 Client 連線後發送 `snapshot_request`，Host 以 `canvas.toDataURL()` 回傳
- [x] 建立 `src/services/syncService.ts`：序列化/反序列化 DrawMessage，呼叫 connection.send()
- [x] Host 接收訊息後，直接在 Host 的 canvas 重播繪圖操作（非轉傳圖片，保持矢量品質）
- [x] 多 Client 支援：Host 維護 `Map<peerId, DataConnection>` 管理所有連線
- [x] `reliable: true` DataChannel 保障訊息順序（PeerJS 預設）
- [x] 離線佇列：斷線期間繪圖事件入隊，重連後批次推送

---

## D. 顯示模式 (Host / Client UI) ✅

**目的**：根據角色呈現完全不同的 UI，Host 專注顯示，Client 專注繪圖。所有 UI 元件採用 **MUI** 實作。

### MUI 主題設定
- [x] 建立 `src/theme.ts`：自訂 MUI Theme（主色 `#7C4DFF`、深色模式、圓角 12px）
- [x] `App.tsx` 包裹 `<ThemeProvider>` + `<CssBaseline />`
- [ ] 使用 MUI `createTheme` 支援 `light` / `dark` 模式切換（目前固定深色，留待 E 階段）

### 實作細節

#### 進入點 / 角色選擇
- [x] `src/pages/LandingPage.tsx`：MUI `Box` + `Stack` 版面，`Button variant="contained"` 建立白板，`Button variant="outlined"` 加入白板
- [x] 加入白板：MUI `TextField` 輸入 Room ID + `Dialog` 彈窗流程
- [x] URL 參數路由：`?role=host` / `?role=client&room=XXXXXX`（無需 React Router，純 `URLSearchParams`）
- [x] 自動偵測：若 URL 含 `room` 參數則自動以 Client 模式加入

#### Host UI（投影/電腦端）
- [x] `src/pages/HostPage.tsx`：全螢幕白板顯示，MUI `Paper`-like 浮層顯示 QR Code + Room ID
- [x] MUI `Chip` 顯示連線人數（幾位 Client 已連線）
- [x] MUI `IconButton`（`FullscreenIcon` / `FullscreenExitIcon`）觸發 Fullscreen API
- [x] MUI `Tooltip` 提示各操作按鈕
- [x] 連線狀態：MUI `FiberManualRecord` 圖示 + `Chip` 指示燈（`ConnectionStatus` 元件）

#### Client UI（平板/繪圖端）
- [x] `src/pages/ClientPage.tsx`：全螢幕繪圖 canvas，左側浮動 `Toolbar` 工具列
- [x] 工具列使用 MUI `ToggleButtonGroup` + `ToggleButton` 切換工具（筆刷/橡皮擦/直線/矩形）
- [x] MUI `Slider` 控制筆觸粗細（2～30px）
- [x] MUI `Popover` 展開顏色選擇器（8 色預設色盤 + 自訂 `<input type="color">`）
- [x] MUI `IconButton`（`DeleteForeverIcon`）清除畫布
- [x] 連線狀態 MUI `Alert` Banner（頂部，斷線時顯示警告）
- [x] 離線緩衝：斷線期間繼續繪圖，重連後批次推送 missed events（SyncService Queue）

#### 共用元件
- [x] `src/components/ConnectionStatus.tsx`：MUI `Chip` with `color="success"/"warning"/"error"`
- [x] `src/components/QRCodeDisplay.tsx`：MUI `Card` + `CardContent` 包裹 QR Code + 複製按鈕
- [x] `src/components/Toolbar.tsx`：MUI `ToggleButtonGroup` 工具列，支援 vertical / horizontal 排版

---

## E. UX 最佳化與部署 ⏳

**目的**：讓整體體驗流暢、可部署到靜態主機。

### 實作細節
- [ ] **響應式 CSS**：平板橫向/縱向適配，工具列可收合
- [x] **PWA Manifest**：`public/manifest.json`，支援「加入主畫面」，standalone 模式（隱藏瀏覽器 UI）
- [ ] **深色/淺色模式切換**：MUI `createTheme` + toggle button，白板背景可切換白/黑
- [x] **Vite base 設定**：`vite.config.ts` 設定 `base` 以支援子路徑部署
- [ ] **GitHub Pages 部署**：`gh-pages` 套件 + `npm run deploy` 腳本
- [ ] **Cloudflare Pages 部署**：`public/_redirects` 設定
- [ ] **README.md**：使用說明、架構圖、部署步驟
- [x] **錯誤處理 UI**：連線失敗時顯示友善錯誤訊息與重試按鈕
- [ ] **複製 Room ID 按鈕**：一鍵複製連線網址到剪貼簿（QRCodeDisplay 已有，Host 頂部未加）

---

## 專案目錄結構（已實現）

```
src/
├── components/
│   ├── ConnectionStatus.tsx  ✅
│   ├── DrawingCanvas.tsx     ✅
│   ├── QRCodeDisplay.tsx     ✅
│   └── Toolbar.tsx           ✅
├── contexts/
│   └── PeerContext.tsx       ✅
├── hooks/
│   ├── useDrawing.ts         ✅
│   └── usePeer.ts            ✅
├── pages/
│   ├── ClientPage.tsx        ✅
│   ├── HostPage.tsx          ✅
│   └── LandingPage.tsx       ✅
├── services/
│   └── syncService.ts        ✅
├── types/
│   ├── drawing.ts            ✅
│   └── peer.ts               ✅
├── theme.ts                  ✅
├── App.tsx                   ✅
└── main.tsx                  ✅
```

---

## 相依套件

| 套件 | 版本 | 用途 |
|------|------|------|
| `peerjs` | ^1.5.5 | WebRTC P2P 連線 |
| `qrcode` | — | 產生 QR Code |
| `@types/qrcode` | — | qrcode TypeScript 型別 |
| `@mui/material` | 7.3.8 | UI 元件庫（Button、Dialog、Slider、ToggleButton…）|
| `@mui/icons-material` | 7.3.8 | MUI 官方 Material Icons |
| `@emotion/react` | 11.14.0 | MUI CSS-in-JS 引擎（必要） |
| `@emotion/styled` | 11.14.1 | MUI styled 元件支援（必要） |

---

## 部署注意事項

- PeerJS Cloud Server（`0.peerjs.com`）有連線數限制，Production 建議自架 [PeerServer](https://github.com/peers/peerjs-server) 或使用 Railway/Render 免費方案
- WebRTC 需 HTTPS（localhost 例外），部署到靜態主機時自動滿足
- DataChannel `reliable: true` 使用 SCTP，大型 snapshot（高解析度 canvas）可能需分片傳輸



---

## F. 功能增強與修正 ⏳

**目的**：改善核心體驗，新增必要功能，使單人模式與課堂模式皆能順暢使用。

### F1. QR Code 可收合至側邊

**問題**：QR Code 固定顯示於 Host 畫面右下角，教師在課堂投影時學生可能擅自掃碼加入。

**實作方向**：
- [x] QR Code 預設**收合**為側邊小按鈕（如右側邊緣露出一個小 Tab/把手）
- [x] 點擊 Tab 以 MUI `Drawer` 或 `Slide` 動畫展開 QR Code 面板
- [x] 展開面板包含原有內容：QR Code、Room ID、複製按鈕
- [x] 收合狀態時 Host 畫面完全乾淨，不洩漏 Room 資訊
- [x] 涉及檔案：`src/pages/HostPage.tsx`、`src/components/QRCodeDisplay.tsx`

### F2. 投影端（Host）加入繪圖工具

**問題**：單人使用時，必須同時開啟兩個分頁（一個 Host 顯示、一個 Client 繪圖），體驗不佳。

**實作方向**：
- [x] Host 畫面新增可顯示/隱藏的 `Toolbar`，與 Client 端共用同一元件
- [x] 預設**隱藏**工具列（投影展示模式不受干擾），透過浮動按鈕（如 MUI `Fab`）切換顯示
- [x] 顯示工具列後，Host canvas 切換為可繪圖模式（`readOnly: false`）
- [x] Host 本地繪圖事件同樣透過 SyncService 廣播給所有已連線 Client（雙向同步）
- [x] 隱藏工具列後，自動回到唯讀展示模式，避免誤觸
- [x] 涉及檔案：`src/pages/HostPage.tsx`、`src/components/DrawingCanvas.tsx`、`src/hooks/useDrawing.ts`

### F3. 無邊際垂直延伸畫布（Infinite Vertical Canvas）

**問題**：目前畫布固定為螢幕大小，書寫空間有限，無法如 Apple Freeform 般自由延伸。

**實作方向**：
- [x] 畫布邏輯高度改為**虛擬座標系統**，不再受限於螢幕可視區域
- [x] 實作垂直滾動/平移：支援滑鼠滾輪、觸控拖曳（雙指平移）瀏覽已繪製區域
- [x] 畫布在繪圖接近底部邊緣時自動向下延伸（或支援手動滾動到空白區域繼續繪製）
- [x] 座標系統從目前的 `0~1 正規化` 改為**虛擬世界座標**（viewport + offset），同步協議傳送世界座標
- [x] 同步協議需一併傳送 viewport 資訊，讓 Host/Client 能正確映射位置
- [x] **水平方向暫不延伸**，但架構預留水平擴展能力（未來可能升級為真正的無限畫布）
- [x] 涉及檔案：`src/hooks/useDrawing.ts`、`src/components/DrawingCanvas.tsx`、`src/types/drawing.ts`、`src/services/syncService.ts`

### F4. 線段擦除模式（Stroke Eraser）

**問題**：目前橡皮擦使用 `destination-out` compositing 逐像素擦除，無法整條線段移除，使用不直覺。

**實作方向**：
- [x] 繪圖引擎改為**保留所有筆跡物件**（Stroke Object Model），而非僅靠 canvas 像素
- [x] 每條筆跡儲存為 `StrokeObject { id, tool, style, points[], deleted }` 結構
- [x] 橡皮擦改為**線段擦除模式**：偵測擦除軌跡與哪些 StrokeObject 相交，將該整條筆跡標記為 `deleted`
- [x] 每次有筆跡新增/刪除後，重新繪製（redraw）整個 canvas（從 StrokeObject 陣列重播）
- [x] 同步協議擴充：新增 `stroke_delete { strokeId }` 訊息類型，通知其他端刪除對應筆跡
- [x] 效能考量：筆跡數量多時可考慮分層快取或 dirty region 最佳化（後續迭代）
- [x] 涉及檔案：`src/types/drawing.ts`、`src/hooks/useDrawing.ts`、`src/components/DrawingCanvas.tsx`、`src/services/syncService.ts`

### F5. 橡皮擦游標反映擦除寬度

**問題**：目前不論選什麼工具，游標皆為 `crosshair`，橡皮擦使用時無法直覺看出擦除範圍。

**實作方向**：
- [x] 橡皮擦啟用時，以**自訂 CSS cursor**（`cursor: url(...)` 或動態 canvas 產生的 Data URL）顯示圓圈游標
- [x] 圓圈直徑 = 當前橡皮擦寬度（`drawStyle.width`），隨 Slider 調整即時更新
- [x] 圓圈樣式：空心圓、半透明填充，讓使用者精確對位
- [x] 非橡皮擦工具維持原有 `crosshair` 游標
- [x] 涉及檔案：`src/components/DrawingCanvas.tsx`、`src/hooks/useDrawing.ts`

---

## 🐛 已修正 Bug 記錄

### Bug 1 — 繪圖端線條繪製後立即消失（已修正）
**根本原因**：
- `DrawingCanvas` overlay canvas 僅負責即時預覽，`onPointerUp` 清除 `currentPointsRef` 並清空 overlay，但**從未將筆跡寫入 static canvas**（只有 Host 收到遠端訊息才寫入）
- `ClientPage` 自建一個孤立的 `useDrawing` hook 給 Toolbar，`DrawingCanvas` 內部另有獨立 hook，兩者完全不相連，導致**工具/顏色/粗細切換無效**

**修正內容**：
- `useDrawing.ts`：新增 `staticCanvasRef` 選項，`onPointerUp` 在清空前 commit 完整筆跡至 static canvas
- `ClientPage.tsx`：移除孤立 `drawing` hook，改用 `internalHookRef` 持有 canvas 內部 hook；Toolbar 透過本地 `drawStyle` state 更新 UI 並同步呼叫 canvas hook setter

---

### Bug 2 — 投影端矩形顯示為線段（已修正）
**根本原因**：
Host 的 `applyMessage` 在 `stroke_move` 時一律呼叫 `catmullRomPoint`（曲線繪製），矩形只傳 2 點（起點 + 終點），catmullRom 畫兩點即為直線段。

**修正內容**：
- `applyMessage` 的 `stroke_move` 分支加入 tool 類型判斷：
  - `line` / `rect` → 呼叫 `drawShape()`（正確畫直線或 `strokeRect`）
  - `pen` / `eraser` → 維持 `catmullRomPoint` 曲線邏輯

---

### Bug 3 — 投影端進入全螢幕後畫面消失（已修正）
**根本原因**：
HTML Canvas 規範：只要賦值 `canvas.width` 或 `canvas.height`（即使相同值），畫布內容**必然清空**。全螢幕觸發 ResizeObserver → `resizeCanvas()` 重設維度 → 內容消失。

**修正內容**（`DrawingCanvas.tsx`）：
ResizeObserver 回呼改為三步驟：
1. `canvas.toDataURL()` 保存現有圖像
2. `resizeCanvas()` 重設維度（清空）
3. `new Image() → drawImage(img, 0, 0, newW, newH)` 縮放還原

---

### Bug 5 — iPad Apple Pencil 手寫延遲/卡頓（已修正）
**根本原因**：
- `currentPointsRef` 在 16ms 批次計時器觸發後才更新，overlay 渲染跟著延遲
- 缺少 `onPointerCancel`，Safari 嘗試判斷捲動手勢取消後狀態卡住
- 未使用 `getCoalescedEvents()`，Apple Pencil 中間位置遺失
- `touchstart`/`touchmove` 未阻止，Safari 系統手勢介入

**修正內容**：
- `onPointerMove` 立即將點寫入 `currentPointsRef`（不等計時器），16ms 批次僅用於網路傳輸
- 使用 `e.nativeEvent.getCoalescedEvents()` 捕捉 Apple Pencil 所有中間位置
- 新增 `onPointerCancel` / `onPointerLeave` 重置繪圖狀態
- Canvas 上以 `{ passive: false }` 監聽 `touchstart`/`touchmove` 並 `preventDefault()`

---

### Bug 6 — 多 Client 繪圖端無法互看對方內容（已修正）
**根本原因**：
- Host `handleMessage` 收到 Client A 的繪圖事件後只套用到自身 canvas，未轉發給其他 Client
- Client 的 `setOnMessage` 只處理 `snapshot` 型別，忽略其他繪圖訊息

**修正內容**：
- `SyncService` 新增 `relayToOthers(msg, excludePeerId, allPeerIds)`，對所有非發送者的 Client 逐一呼叫 `send()`
- `HostPage.handleMessage`：套用 canvas 後呼叫 `relayToOthers`，`connectedClients` 以 ref 追蹤避免 stale closure
- `ClientPage.setOnMessage`：改為接收並 `applyMessage` 所有訊息型別（stroke_start/move/end、clear、snapshot）
**根本原因**：
繪圖座標以**絕對 canvas 像素**（`clientX × DPR`）傳送。不同裝置 canvas 尺寸不同（平板 vs 投影機），接收端直接使用相同絕對座標繪製，造成位置錯誤；視窗 resize 後問題加劇。

**修正內容**（`useDrawing.ts`，全面重構座標系統）：

| 函式 | 修改前 | 修改後 |
|------|-------|-------|
| `getCanvasPoint` | `clientX × DPR`（絕對像素） | `clientX / rect.width`（**0~1 正規化**） |
| `catmullRomPoint(ctx, pts, canvas)` | 直接使用 pts x,y | 接受 `canvas` 參數，繪製前乘上 `canvas.width/height` 反正規化 |
| `drawShape(ctx, style, start, end, canvas)` | 直接使用 start/end | 接受 `canvas` 參數，反正規化後繪製 |
| `applyStrokeStyle` | `style.width` 直接作 lineWidth | `style.width × window.devicePixelRatio`，視覺粗細跨裝置一致 |
| `applyMessage` snapshot | `drawImage(img, 0, 0)` | `drawImage(img, 0, 0, canvas.width, canvas.height)` 縮放至新尺寸 |
