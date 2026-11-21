# Liquid Glass · 液态玻璃

把 **DeepSeek Harness 的背景换成你桌面壁纸本身**，并把面板变成会流动的半透明玻璃 —— 文字与面板悬空在液态玻璃上，玻璃后面就是桌面上真实的那张壁纸。

![Liquid Glass 效果](screenshot.png)

## 核心思路：映射真实壁纸，而不是在窗口里重画一张

Web / Electron 做不到真正的「透视窗口」（只有 macOS 的 DWM 级 API 才能），所以这里的做法是：**把桌面壁纸的原始像素按屏幕坐标映射到窗口内**。着色器用 `uWin` / `uScreen` / `uScale` / `uDpr` 把每个片元换算成「桌面上的哪个像素」，再做折射、色散与流动，因此窗口里的画面与窗口外桌面上的壁纸严格对齐 —— 换窗口位置、改变窗口大小、动态分辨率降级都不会让画面错位。

## 壁纸来源优先级（host 半）

1. **Wallpaper Engine 视频壁纸（最佳）**：读 `wallpaper64.exe` 的 `config.json`（UTF-8，不按 ANSI 读），取 `general.wallpaperconfig.selectedwallpapers.Monitor0.file` 指向的 mp4/webm，在 `/liquid-glass/wallpaper` 用 HTTP Range 提供。客户端用隐藏 `<video>` seek 到约 18% 处取一帧（2048 长边，`createImageBitmap` 后上传纹理），既拿得到壁纸原始画面，又**完全不含桌面图标**，也不用每秒截图。
2. **Wallpaper Engine 场景/网页壁纸**：没有可读的静态帧，退回桌面抓取（`Windows.Graphics.Capture` 抓 `Progman`，转 JPEG q82，缓存 `%TEMP%\dsh-liquid-glass\wallpaper.jpg`，700 ms 过期）。
3. **普通静态壁纸**：`SystemParametersInfo(SPI_GETDESKWALLPAPER)` / `HKCU\Control Panel\Desktop` / `TranscodedWallpaper` 给出的图片文件，直接读文件，同样**不含桌面图标**。
4. **兜底**：桌面抓取（只有这一步的图里会带桌面图标）。

macOS / Linux 仍走 `System Events` / `gsettings` 的静态路径。

## 背景来源：真实桌面 / 壁纸本体

侧边栏分组里的「背景来源」决定 `source` 查询参数，host 与 client 都按它取图：

- **真实桌面（含图标，默认）**：`source=desktop`。优先截图整个桌面（`Windows.Graphics.Capture` 抓 `Progman`，含桌面图标），映射到窗口里与外面的桌面 1:1 对齐 —— 看起来就是真·透视，图标也是「真」的。
- **壁纸本体（无图标）**：`source=wallpaper`。跳过一切截图，只用壁纸文件 / WE 视频帧，因此画面里永远不会有桌面图标。

两种模式共用同一套屏幕空间映射：`uWin`（窗口左上角在屏幕上的位置）+ `uScreen`（屏幕尺寸）+ `uScale` / `uDpr`，每个片元换算成「桌面上的哪个物理像素」，所以图标大小与桌面完全一致，不放大、不缩小、不镜像。纹理上传时 `UNPACK_FLIP_Y_WEBGL = false`，并在采样前做一次 `uv.y = 1 - uv.y`（GL 的 `gl_FragCoord` 从下往上、纹理行从上往下），镜像就是这么修掉的。

## 窗口后面有应用：合成「被遮住的那一层」，而不是暂停

`/liquid-glass/gate`（保留做诊断）每次由 `%TEMP%\dsh-liquid-glass\gate.ps1` 枚举 z-order 得到：先按标题 `*DeepSeek Harness*` 定位 DSH 主窗口，再扫描它**下方**的可见窗口，跳过 `Progman / WorkerW / Shell_TrayWnd / ApplicationFrameWindow / IME …` 等外壳类，也跳过**同进程**（`pid` 相同）与**同标题**的自家窗口，要求与 DSH 窗口的重叠面积 ≥ 40000 px²。

真正的显示路径是打包的 C++ 助手 `bin/lg-capture.exe`（源码 `tools/capture/lg-capture.cpp`）：它以「屏幕尺寸」建画布，先用 `Windows.Graphics.Capture` 对 `Progman` 取一帧作为底图（含图标），再按 z-order **从最底层往上**把所有位于 DSH 下方、可见、与 DSH 窗口有重叠、且不是外壳/自家窗口的应用窗口逐个用 WGC 捕获后贴上去，最后整幅缩到长边 1600 存 JPEG q82。于是 `/liquid-glass/wallpaper` 给出的就是「DSH 遮住的真实画面」：窗口后面若是浏览器/编辑器，玻璃里透出的就是那个应用的实际像素；若只有壁纸，就是壁纸本身。

`PowerShell` 版 `composite.ps1`（`PrintWindow` 路线）仍然保留，但只在助手不可用时兜底 —— 它是旧版偶尔闪黑的来源，正常路径不会再走到。

- 没有应用在下面时：合成图 = 桌面，`appsBehind: false`。
- 有应用在下面时：`appsBehind: true` 且 `apps` 列出类名/标题/位置，玻璃继续流动、继续渲染，**不会暂停**。
- 小窗口（< 80×50 或面积 < 8000 px²）、任务栏/输入法/边缘 UI 等外壳窗口不参与合成，避免 4 px 的 Edge 输入条把界面判成「有应用」。
- 窗口最小化 / 切到其它虚拟桌面时页面本来就是 `hidden`，由第一层熔断停帧；这不影响合成图。

## 硬件自适应与智能预设

启动时用 `WEBGL_debug_renderer_info` 读一次 `UNMASKED_RENDERER_WEBGL`（失败则退回 `gl.RENDERER`），读到的字符串在本地分类，不联网、不上报。探测用的临时 WebGL 上下文读完立刻 `WEBGL_lose_context` 释放，不会整个会话多占一个 context。

| 档位 | 判定特征 | 引擎 | 帧率 | 动态分辨率 | 遮挡窗口合成 | 截图间隔 |
| --- | --- | --- | --- | --- | --- | --- |
| 核显保命档（`igpu`，未知/软件渲染也归这里） | `Intel` `Iris` `UHD` `Radeon Graphics` `Vega` `Apple M*` `Mali` `Adreno` `SwiftShader` `llvmpipe` | WebGL | 30 | 开 | 开 | 桌面变化时（约 1.1 s 探测一次） |
| 独显均衡档（`balanced`） | `GTX` `RTX`（非 40/50）`RX 5xxx–7xxx` `Arc A` | WebGL | 60 | 开 | 开 | 桌面变化时（约 1.1 s 探测一次） |
| 火神狂暴档（`beast`） | `RTX 40xx/50xx` `RX 9xxx` `Arc B` | WebGPU（不可用回落 WebGL） | 144 | 关 | 开 | 桌面变化时（约 1.1 s 探测一次） |

预设只写性能参数（`renderMode / fps / autoScale / behind`），不碰观感（`source / tint / saturation / dim / blur / flow / veil / ink`），所以切档不会把用户调好的玻璃改掉。`refreshSec` 从 0.15 起只剩兼容用途：抓取时机完全由窗口指纹决定。

**兜底**：手动把帧率设到超过档位上限时 → 面板显示 ⚠；运行中连续 5 秒 `stats().ms` 超出预算（`max(30, 1000/fps × 1.4)`）→ 自动回落到本机安全档并把 `preset` 写回该档；`webglcontextlost` 时同样先回落再降级到 CSS。回落事件通过 `GET /liquid-glass/log?msg=preset: ...` 记录在 `/state` 的 `clientError` 里。

`behind=0` 会传给宿主，助手收到 `0` 时跳过逐窗口捕获，只保留桌面底图（壁纸 + 图标），省下每次 0.02–0.06 秒。

## 代码结构

宿主（Node，真正的 ESM，可直接相对 import）：

| 文件 | 职责 |
| --- | --- |
| `index.js` | 只留 `apply()` 与路由装配：/state /wallpaper /log /gate，取源顺序与 700 ms TTL |
| `host/paths.js` | 缓存目录、TTL、各脚本路径、`bin/lg-capture.exe` 位置 |
| `host/scripts.js` | 四个内联 PowerShell 兜底脚本（抓屏、探测、合成、macOS 壁纸） |
| `host/run.js` | `run` / `runPowerShellFile` 两个进程帮助函数 |
| `host/helper.js` | 常驻助手：spawn、行协议、捕获、发布、暗帧闸门、`captureStats` |
| `host/wallpaper.js` | 壁纸探测、Wallpaper Engine 识别、MIME、文件流 |

客户端（浏览器，单文件产物，由源码拼接生成）：

| 文件 | 职责 |
| --- | --- |
| `client/client.js` | **构建产物**，不要手改；由 `node scripts/build-client.mjs` 生成 |
| `client/src/01-bootstrap.js` … `12-apply.js` | 按职责切开的 14 个片段，顺序即拼接顺序 |
| `scripts/build-client.mjs` | 零依赖拼接器（`--check` 只校验不写） |

原生助手：`tools/capture/lg-capture.cpp`（C++ / WGC）→ `node scripts/build-capture.mjs` → `bin/lg-capture.exe`。

助手不直接跑打包里的 exe：`host/helper.js` 的 `prepareRunCopy()` 会把它按 `大小-mtime` 复制成 `%TEMP%\dsh-liquid-glass\lg-capture-<size>-<mtime>.exe` 再启动，这样重编 `bin/lg-capture.exe` 不会被运行中的进程锁住，也不用先停插件；同版本副本已存在时直接复用。流式运行时宿主不再做按需捕获（`captureStats.streaming` 就接管暂存文件），避免两个捕获者抢同一个 stage。帧率可在不改会话的前提下原地调整：`--serve` 的 `fps <1-30>` 命令只改 `std::atomic<int> fps`，会话与帧池保持存活，因此不会因为调频闪一次捕获边框；宿主按 `/log` 里客户端 `perf:` 的渲染状态调用 `setStreamFps()`（窗口暂停 2 fps、掉帧到目标 60% 以下 4 fps、正常 8 fps）。

## 成本与性能取舍

- 合成由**打包的 C++ 助手**完成：`bin/lg-capture.exe`（源码 `tools/capture/lg-capture.cpp`，`node scripts/build-capture.mjs` 重新编译），以 `--serve` 模式常驻，通过 stdin 收 `"<behind> <输出路径>"` 并回一行 JSON。0.17 起它跑的是**常驻捕获引擎**：`stream <fps> <behind> <force> <stage>` 启动后，每个 tick 从帧池里 drain 掉排队帧、合成、算 16×16 亮度指纹，只有画面真的变化时才编码 JPEG 并向 stdout 推一行 `{"event":"frame",...}`（宿主收到才 rename 发布）。单帧「读回 + 合成 + 编码」**30–60 ms**（1600 px / q82；桌面静止时 0 编码）；进程冷启动一次约 190 ms。助手不存在时依次回退一次性进程与 PowerShell 合成（1.5–4.2 s）。
- 为什么换掉 `PrintWindow`：Windows 11 的桌面壁纸由 explorer 通过 DirectComposition 合成到一个 `WorkerW` 层，`PrintWindow(Progman, PW_RENDERFULLCONTENT)` 在桌面被别的窗口遮住、或 DWM 恰好没有这一帧时会**只交回图标层、壁纸层是黑的**（实测同一命令行连测 10 次全黑、再 12 次全亮），亮度约 0.048，正好落在旧客户端 0.06 的绝对阈值之外，于是黑帧被发布又挂上屏幕 —— 这就是「壁纸不定时闪一下黑」。`Windows.Graphics.Capture` 直接读 DWM 的窗口表面，40 次连测全部 `lum 0.8308` 无黑帧，且对**被完全遮挡**的窗口也能拿到内容（实测 QQ 被浏览器全遮住仍是 4/4 有画面）。`WorkerW` 本身不接受 `CreateForWindow`（`E_INVALIDARG`），所以基底抓的是 `Progman`。0.17 又补了两件事：`ensure()` 在 `StartCapture` 之前 QI `IGraphicsCaptureSession3` 并 `put_IsBorderRequired(false)`，把系统的黄色「正在捕获」边框关掉（需要 Windows 11 / 10 20348+；没有该接口就保持旧行为，只有 WGC 建流失败才退 `PrintWindow`）；引擎自己对偶发的「只有图标层」暗帧（实测 10 s 里 4/45 帧 `lum≈0.027`）先按住不发布，连续约 1 s 都暗才接受。
- 端到端延迟：流式模式下宿主 `/state` 只缓存 **120 ms**，客户端跟着 `streaming` 标志把轮询从 1.1 s 切到 **0.22 s**，并且只在 `digest` 变化时才 `setWallpaper`（同一张图不重传、不重绘，避免旧版「每秒重传纹理」的抖动）。所以「窗口在 DSH 下面动一下 → 玻璃里跟上」≈ **0.25–0.4 s**，桌面完全静止时引擎不编码、页面也不重绘。旧实现无条件按 `refreshSec` 秒重抓，每抓一次亮暗就跳一下，这才是「壁纸每隔几秒闪一下」的根因。
- 合成本身仍只在 `mode === 'desktop'` 时执行；`mode === 'wallpaper'` 完全不走截图。
- 合成输出宽度 1600 px、JPEG q82（旧参数 2048 / q88 的单帧约 418 KB，现在约 220 KB，位图显存也小 40%）。
- 关掉「合成被遮挡的窗口」后只画桌面底图（不含图标层之上的应用），单次约 60–75 ms。

### 为什么没用 `desktopCapturer`

`desktopCapturer` 抓的是「屏幕」或「某个窗口」的**可见内容**：屏幕源会把 DSH 自己一起拍进去，窗口源拿不到被我们窗口遮住的部分，而且返回的是缩略图尺寸的位图。本插件的全部意义是「透出被遮住的桌面/应用」，只有按窗口抓取表面能拿到被遮挡的真实像素 —— 早期用 `PrintWindow(PW_RENDERFULLCONTENT)`，0.16 起换成 `Windows.Graphics.Capture`（对遮挡窗口同样给内容，且不会偶发丢壁纸层），仍在本机合成，单次 90 ms 级。另外 `MediaStream` + `requestVideoFrameCallback` 需要持续编码整屏视频流，对核显的固定开销比「按需一次的静态合成」高得多；本插件的常驻引擎只在画面变化时编码（8 fps 上限、q82），静止时仍是零编码。

### 单帧成本（实测）

关闭合成、只测着色器：120 帧 + `readPixels` 强制同步，`gl.finish()` 会把 GPU 排队但不会同步，必须 1 px 回读才能得到闭环节拍。

| 配置 | 单帧耗时 | 说明 |
| --- | --- | --- |
| 1680×1119（scale 1.0） | 16.9 ms | 旧默认，DPR 1.5 时曾是 2520×1679 |
| 1344×895（scale 0.8） | ≈10–11 ms | 现在 40 fps 及以下的默认档 |
| 捕获流一帧（WGC 读回 + 合成 + JPEG） | **≈32 ms 均值**（15–60 ms） | 8 fps 上限；画面没变就跳过编码 |

显存归属实测（同一时刻、窗口最小化、插件开/关）：插件开 286 MB、关 275 MB，常驻约 11 MB；运行中约 321 MB。纹理 1600×1067 ≈ 6.8 MB，模糊预渲染同尺寸 ≈ 6.8 MB，加上 `preserveDrawingBuffer` 的副本，整块约 20–25 MB —— 百 MB/GB 级的占用来自 Chromium 合成器与桌面上的其他程序（本次采样时 bilibili 的 GPU 进程单独占了 72.6%）。

### 清晰度与「液态感」的平衡

`0.11` 系列为了追性能把折射调到 0.012、色散 0.0016、焦散换成 analytic 0.055，观感变成一层死板的灰玻璃；`0.12` 回到 0.8 的配方，`0.13` 保留它并把 0.11 的高级功能接回来：

- 模糊在**全分辨率 FBO** 里用 13-tap poisson 核做一次，半径 `min(12, blur × 0.75 × cssScale)`；`背景模糊 = 0` 时直接释放模糊目标、采样原纹理 —— 像素级清晰，没有任何重采样。锐利模式换图时也会先把旧纹理拷进快照做 420 ms 交叉淡入，不会硬切。
- 域扭曲振幅 0.05（1600 px 纹理上约 80 px 的位移）、涟漪 0.012、色散 0.004、焦散用解析式 `0.5 + 0.5·sin(p.x·1.7 + t·0.9)·sin(p.y·1.3 − t·0.7)`（0.11 的公式，但强度保留 0.8 的 `× 0.22`；0.11 的 0.055 会把水感乘没）、高光带 0.03。WebGL 与 WGSL 两份着色器逐项对齐。
- 想更锐利就把「背景模糊」拉到 0；想更平静就降低「液态流动」。

### 文字颜色

`0.13` 把 0.11 的「自适应黑白字」接回来，但重写成不会闪的版本：

- 采样：`measureInk()` 把同一张壁纸位图缩到 24×24，取 24% 右侧区域（聊天文字所在列）的平均亮度 `content` 与全图标准差 `busy`。一次 24×24 的 `drawImage`，不碰 GPU 循环。
- 决策：`decideInk()` 先把「壁纸亮度 × (1 − α) + 霜面色 × α」按 sRGB 合成，再算黑字/白字两种候选的 WCAG 对比度，目标是 **7:1**（5:1 在图标后面仍会糊）；若当前霜面不够，就只把霜面加到够用，用户的「霜面浓度」是下限，自动值只能加不能减。
- 防闪：采样值按 0.02 量化后比较，只有真正改变决策的样本才会进 state；token 层再用 `JSON.stringify(glassTokens(...))` 做签名，签名没变就不 dispose/重建调色板。旧版每次壁纸刷新都重建 `--dsw-alias-label-*`，等于每秒让整个 transcript 重绘一次 —— 这是「一闪一闪」的主因，0.13 用两道闸门挡掉了。
- 提示里显示采样到的亮度百分比，方便判断自动值靠不靠谱；下拉可强制深色/浅色。
- 手动选择不做二次加工：`inkContrast()` 与「4.5:1 自动改色」在 0.14.0 删除。你选浅色就是浅色字；可读性交给输入框/面板自己的底色（见下一条），而不是偷偷改你的颜色。
- 文本框（composer）的底色跟着文字颜色走：`--lg-composer-bg` 由 token 层按最终采纳的墨色算出 —— `light` 墨（白字）给 `rgba(12,14,20, 0.42 + 0.33 × veil)` 的深色玻璃，`dark` 墨（黑字）给 `rgba(255,255,255, 0.06 + 0.5 × veil)` 的浅色玻璃，白字在黑地上才有对比度。DSH 自己的 composer 卡片是硬编码 `rgb(255,255,255)`（CSS-module 类 `*_card`），与主题 token 无关，0.13.3 起用 `[class*="_card"]:has([contenteditable="true"])` 把它接回 `--lg-composer-bg`。

### 不黑屏的六道保险

1. GPU 引擎出图前 canvas `opacity: 0`，首帧 `drawArrays` / `submit` 完成后才淡入 —— 不会有「先黑一下再出画面」。
2. 壁纸层的 `body::before` 在 GPU 模式下只承担「首帧前的启动遮罩 / 第五层保护触发后的静态半透明遮罩」：GPU 画布出图后由画布独占壁纸，遮罩退居其后。
3. 合成失败（助手崩溃、GDI+ 报错、超时）时继续用磁盘上的上一帧，`/state` 会带 `captureError` 但不影响显示。
4. **宿主侧亮度闸门**：助手会把它刚合成的那一帧的 8×8 网格平均亮度（`lum`）写进 JSON；若亮度突然从 >0.12 掉到 <0.05，宿主直接丢弃这一帧、不 rename、继续供应上一张，并把原因写进 `captureError`。连续两次后第三次仍然相信（真的换成深色壁纸时不会被一直拦）。引擎内部还会先按住 8 个 tick 的纯暗帧，所以这两道闸门实际上很少需要开火。
5. **客户端相对闸门**：万一还有近黑帧溜过（PowerShell 回退、解码问题），客户端 `isBlackSwap()` 用「上一张**已接受**帧」比较，被拒帧不更新基准值，所以不会出现「拒一次之后基准变黑、后面全放行」的老 bug；连拒 2 次后接受，避免和用户真实换的深色壁纸打架。
6. `webglcontextlost` → 立刻切**静态半透明遮罩**（主题色薄纱，不黑屏）+ 底部提示条；10 分钟内第二次 → 自动关闭插件。

## 液态玻璃层（client 半）

两种 GPU 渲染引擎可在设置里自由切换，切换即时生效（重建渲染器，无需重启）；模糊全部由引擎自己的 shader 前置通道完成，不存在「纯 CSS 渲染」这条混合回退路径：

- **WebGL**（默认，推荐）：全屏 canvas 垫在 `<body>` 下（`z-index: -2`），对壁纸做**域扭曲（fbm domain warp）+ 指针涟漪 + 色散（chromatic dispersion）+ 焦散与高光**。
- **WebGPU**（实验）：同一套屏幕空间管线用 WGSL 重写（全屏三角形 + `copyExternalImageToTexture` + 独立的 13-tap 模糊 prepass），接口与 WebGL 渲染器完全一致（`start/stop/dispose/setParams/setTargetFps/setAutoScale/setPaused/wake/stats/setWallpaper`），因此五层防护照常工作；拿不到 adapter、初始化失败或 `device.lost` 时自动退回 WebGL，而不是退回 CSS。
- **显卡彻底崩溃**：不再有「纯 CSS 渲染」兜底；第五层保护直接触发静态半透明遮罩（同一套主题 token，文字保持清晰），不会黑屏。

`#root` 通过 `theme.overrideTokens()` 把 `--dsw-alias-bg-base / bg-layer-1 / bg-layer-2 / bg-overlay / sidebar-fill / border-l1 / border-l2` 调成半透明，让 DSH 自己的面板、侧边栏、弹窗都透出壁纸；窗口边缘还有内阴影与高光构成的「玻璃厚度」。设置页文案跟随 DSH 语言（`locale` 服务的 `getSnapshot().active` + `subscribe`）。

### 只算一次：着色器内模糊，关掉合成器 backdrop-filter

WebGL / WebGPU 模式下 `#root` 的 `backdrop-filter` 被强制置为 `none`：壁纸先由引擎自己**在离屏 FBO / storage texture 里做 13-tap 泊松高斯模糊**，主着色器直接采样这张已模糊的纹理。13-tap 单次只能覆盖约 10 texel，所以同一个核会 ping-pong 1–4 次：滑杆值先映射成目标半径（含 DPI 像素比换算），再由目标半径决定 pass 数，每次 pass 的半径始终落在核的良好采样区间内 —— 这就是「模糊拉到 100% 仍然丝滑」而不是被硬夹死或糊成带状的原因。之前是「合成器模糊真实壁纸 + WebGL 再渲染一层玻璃」两套像素流水线同时跑，等于同一屏幕算两遍 —— 这是之前 GPU 负载翻倍的主因。现在合成器不再重复模糊；静态遮罩也没有 backdrop-filter。

另外两处降载：canvas 长边按 **CSS 像素**渲染（`dpr` 上限 1，1.5 倍屏从此不再多算 2.25 倍片元，壁纸本来就模糊，肉眼无差）；色散的两张额外采样在静止（flow < 0.02）时用 `step()` 归零。

### 通透度（`veil` + `tint` 双旋钮）

`0.13` 按 hybrid 规格把 0.11 的「霜面浓度」（`veil`，0–100%）接回来，作为**唯一**控制面板厚度的旋钮；`tint`（玻璃着色）只负责色温与整体偏白（浅色主题）或偏冷（深色主题）：

- 面板：`base = 0.02 + 0.45 × veil`、`lift = 0.02 + 0.05 × veil`、色温系数 `tintLift = 0.9 + 0.2 × tint`；`bg-base = base × tintLift`、`bg-layer-1 = (base + lift) × tintLift`、`bg-layer-2 = (base + 2.4 × lift) × tintLift`、`sidebar-fill = (0.02 + 0.38 × veil) × tintLift`、`bg-overlay = 0.06 + 0.86 × veil`（暗色主题整体再厚 0.03、overlay `0.1 + 0.85 × veil`）。`bg-overlay` 在 0.13.0–0.13.2 曾是 `0.5 + 0.42 × veil`，即使 `veil = 0` 也留半层白霜，弹层/菜单会与裸玻璃的 0.02 脱节；0.13.3 改成从 0.06 起跳，最厚档（0.92）观感不变。
- 输入框：DSH 的 composer 卡片把底色调成**硬编码纯白**（`rgb(255,255,255)`，来自 CSS-module 类 `*_card`，与主题 token 无关），叠在玻璃上就是一块白板，白色占位符/正文直接消失。0.13.3 先用 `[class*="_card"]:has([contenteditable="true"]), [class*="_card"]:has(textarea)` 把它接回 layer-1（`veil = 0` 时 0.043 白霜）；0.14.0 起改为 `background: var(--lg-composer-bg, var(--dsw-alias-bg-layer-1)) !important`：文字颜色为浅色时给 `rgba(12,14,20,0.42 + 0.33 × veil)` 的深色玻璃框，深色时给 `rgba(255,255,255,0.06 + 0.5 × veil)` 的浅色玻璃框，所以「白字配白框」不会同时出现；`data-lg-suppressed` 模式下仍保留原白卡。
- 曲线对齐：`veil = 100%`、`tint = 100%` 时 `bg-base ≈ 0.52`，与 0.8 原配方在 tint 100% 的厚度**完全一致**；`veil = 0%` 时降到 0.02，接近裸玻璃。一键恢复的默认值就是 `veil 100% / tint 100%`，所以接回滑条不会把用户刚验收的玻璃再改一版。
- 0.11 的公式是 `0.02 + 0.30 × veil`，最厚也只有 0.32，再叠加被调暗的 sheen/bevel/扫光，整块玻璃就变成一张几乎全透的黑纸 —— 0.13 重新标定了斜率，而不是照抄那条曲线。高光层（指针光斑）与扫光保留 0.8 的 0.55 / 0.14。

## 设置入口（左侧边栏 → 主工作区）

设置不再占用 DSH 的系统设置页，也不再内联进侧边栏。`v.26.11.21.154004` 起，左侧边栏只多出一行极简的全局导航项（水滴图标 + 「液态玻璃」），它走 DSH 原生的全局面板机制：`sidebar.panellist` 注册同 id 的导航行（`order: 20`，label 走 locale thunk），`main` keyed 槽注册同 `key` 的页面组件；点击时 sidebar 调 `layout.selectPanel("liquid-glass")`，AppFrame 用 `renderSlot("main", {}, { entryKey })` 把设置页**整页**渲染到右侧主工作区 —— 与原生「插件」「自动化任务」页同一套骨架、同一套设置行样式（0.5px 分隔线、原生开关、34px 输入控件）。刷新后 `activePanelId` 不持久化，自动回到会话。

`shell.overlay` 只保留玻璃背景层：`<style>`、壁纸 canvas 与自适应 ink 采样都由它承载。旧的 `nav.panelList` portal / 800ms `place()` / 内联折叠表单已彻底删除，不再有「把大表单塞进窄边栏」这条路。

为什么不是占用槽位：会话列表下方的 `sidebar.workspaces.directoryFlow` 是 **single 且已被占用** 的「选择工作区目录」交互洞（`replaceRisk: shadows-shipped-ui`），注册进去会换掉自带的目录选择流程；`sidebar.panellist` 的 id 映射的是**主面板**，点它只会切换主视图，无法就地展开。所以这一行由插件自己挂到真实的 `nav.panelList` 末尾，用 `react-dom` 的 portal 渲染自己的宿主（不接管 DSH 的 React 树）；React 重排后用 800 ms 一次的 `place()` 自愈。`shell.overlay` 里只剩玻璃背景层与这个 portal 宿主。

面板内容：总开关、壁纸同步、**背景来源**（真实桌面 / 壁纸本体）、**渲染引擎**（WebGL / WebGPU；模糊都由引擎 shader 完成）、背景模糊、饱和度、玻璃着色、霜面浓度、文字颜色、壁纸压暗、液态流动强度、帧率上限、动态分辨率，以及实时指标（渲染模式 / 目标帧率 / 渲染分辨率 / 累计帧数）。设置保存在 `localStorage` 键 `dsh-liquid-glass.settings.v3`。0.11 的预设曾把 `flow / refreshSec / blur / saturation / behind` 一起改写，连 `.v2` 备份键都被覆盖，等于「用户设置被吃掉」。0.12 起预设只写引擎 / 帧率 / 分辨率 / 遮挡合成；首次加载时若没有 `dsh-liquid-glass.recovered-0.13` 标记，会把恢复出的用户原值（`blur 0 / saturation 1.4 / tint 1 / veil 1 / dim 0 / refreshSec 5 / flow 1.5 / fps 30 / autoScale`）写入 v3 与 v2 并打标记，之后 v3 就是权威。`veil 1` 是特意选的：它等于 0.8 配方在 `tint 1` 的厚度，接回滑条不会重新做一遍观感。

## 版本号

版本号按 `v.<年>.<月>.<日>.<时><分><秒>`（西安授时，UTC+8）递增，写进 UI、本文档与 GitHub Release；`package.json` 的 `version` 必须是合法 semver，所以用同一天的日期加时间作预发布号（例如 `26.11.21-152253`），展示时再加 `v.` 前缀与点号。

## 性能保护（核显保命）

1. **生命周期熔断**：窗口隐藏 / 被完全遮挡 / 失去焦点 → 立刻停 rAF；回来等 300 ms 防抖再恢复，避免 Alt+Tab 抖 GPU。
2. **帧率上限**：24 / 30 / 40 / 48 / 60 / 90 / 120 / 144 / 无限制，默认 30。
3. **动态分辨率**：连续 10 帧超预算 → 1.0 → 0.8 → 0.65 → 0.5 逐级降；流畅 300 帧后再升回。画面因屏幕空间映射而不会跳位。默认从 0.8 起步，且目标帧率 ≤ 40 时 0.8 就是上限 —— 全分辨率在这个帧率下只是多花两倍片元。
4. **按需渲染**：「液态流动」为 0 且鼠标静止 1.5 秒 → 完全挂起；移动/滚动/拖动立即唤醒。指针涟漪另有一层判断：鼠标静止 2.5 秒后 `uRipple` 归零，整屏跳过 `sin/exp`。
5. **逃生舱**：`webglcontextlost` → 冻结并切**静态半透明遮罩**（主题色薄纱，不黑屏）+ 底部提示；10 分钟内第二次则自动关闭插件，可在提示条或侧边栏里的「液态玻璃」那行重试。纹理长边上限 2048；换帧时旧纹理先拷进快照、交叉淡入结束后再 `deleteTexture`，既不会闪也不会泄漏。
6. **重测尺寸**：窗口还原 / 缩放 / 从隐藏恢复时重新测量画布，避免停在 300×150 的默认后备缓冲（那会让整个着色器按 300×150 跑而被 CSS 拉伸）。

## 与苹果「液态玻璃」的差距

iOS 26 的 Liquid Glass 是 RenderServer 的 GPU 着色器：SDF（`CASDFLayer` / `CASDFElementLayer`）驱动折射位移，`_UIMultiLayer` 做高光与阴影，形状之间还能 metaball 融合。本插件用 WebGL 片元着色器近似了**折射扭曲、色散与高光**，但没有 SDF 场，玻璃边缘不会像苹果那样把背后的形状「挤」出物理正确的变形；`backdrop-filter` 本身也不做位移。视觉上接近，性质上是着色器近似。

## 配置

`cordis.patch.yml` 里的 `config.wallpaperPath` 为空时自动跟随系统壁纸；填绝对路径（png / jpg / webp / gif / bmp / mp4）可固定一个来源。

```yaml
- insert:
    - id: liquid-glass
      name: 'dsh-liquid-glass'
      config:
        wallpaperPath: 'D:\Pictures\glass.jpg'
```

## 已知限制

- 视频壁纸只取**一帧**，不会播放；换壁纸后要等下一次桌面变化（或窗口获得焦点）才重新取帧。
- 只支持主显示器；副屏不拼接。
- 合成对「最小化」或受保护内容（DRM 视频、部分游戏）可能贴出黑块：WGC 对这类窗口返回空表面，会被跳过而不是贴黑；它们仍会出现在 `apps` 里但不含画面。
- 合成结果只在画面变化时更新：把窗口拖到 DSH 下面约 0.25–0.4 s 后玻璃里出现它；桌面完全静止时引擎不编码（客户端仍每 0.22 s 比对一次 digest）。
- 壁纸接口监听本机地址但**未做额外鉴权**：同一台机器上能访问该端口的人也能取到壁纸。介意请只在可信环境启用。
- 非 Wallpaper Engine 且桌面图标可见时，若走到截图兜底，图里会带图标（前三档来源不会）。
- WebGL 不可用（驱动 / 远程桌面）时不再有 CSS 壁纸回退：直接进入第五层静态半透明遮罩（不黑屏），并允许 10 分钟内从提示条重试。
- 面板内部若有硬编码的不透明色，仍会挡住背景；需要 DSH 把该处改成主题 token。
- 截图先写到 `wallpaper.stage.jpg`，成功后再 `rename()` 覆盖 `wallpaper.jpg`：客户端要么读到上一张完整 JPEG，要么读到新的一张，不会读到写了一半的文件（半写 JPEG 会解码成黑带，看起来就是壁纸闪一下黑）。
- 桌面捕获依赖 `Windows.Graphics.Capture`（Windows 10 1903+）：更老的系统上助手退到 `PrintWindow`，那时仍可能偶发丢壁纸层，建议把「背景来源」切成壁纸本体。0.17 的无边框（`IGraphicsCaptureSession3`）同样要 Windows 11 / 10 20348+，更老的系统上黄色捕获边框会回来（功能不受影响）。
- 0.16 起闪黑有三道闸门：引擎按住连续的纯暗帧、宿主拒收「突然变暗」的合成帧（`captureError` 里出现 `discarded a dark capture`）、客户端再按「上一张已接受帧」拒收一次（诊断里的 `capture.refused`）。桌面静止时不会周期性地重抓，因此不会周期性闪。


## 壁纸中枢（Wallpaper Engine 桥）

v.26.11.21.154004 起，设置页的「壁纸引擎」分支直接读本机 Wallpaper Engine 的壁纸库，不复制其代码、不修改其配置：

- 路径发现：注册表 HKCU\Software\Valve\Steam 的 SteamPath，加上每个 Steam 库根目录下 steamapps\libraryfolders.vdf 的 path 列表；路径统一清洗（反斜杠、盘符大小写）。
- 库扫描：<root>\steamapps\workshop\content\431960\<id>\project.json，取 title / type / file / preview / tags；场景缺 file 时回落到 scene.pkg，网页回落到 index.html。
- 设置读取：WE 安装目录 config.json 的 users.<user>.general.wallpaperconfig.selectedwallpapers.Monitor0.file，用于标记当前壁纸；wproperties 里保留 schemecolor，供后续智能取色使用。
- 应用：视频项目直接把文件路径作为壁纸来源（source=we&path=…），由 Range 流式读取；场景 / 网页项目无法直接读帧，自动切回实时桌面捕获（source=desktop），由 WE 继续播放画面。
- 自定义文件：source=file&path=…，图片 / 视频皆可，图片一次性读取、视频 Range 流式读取。
- 拉起入口：/liquid-glass/launch?target=steam|we 用 steam:// 协议打开 Steam 或 Wallpaper Engine；商店入口给出微软商店搜索链接，不硬编码包 ID。

## 声临其境（音频矩阵）

v.26.11.21.154004 起，设置页新增「声音」分组：

- 本地播放列表：客户端 `<audio>` 元素按顺序循环，源走 `/liquid-glass/media?path=…`（Range 流式，不整段读入）；支持 mp3 / flac / wav / ogg / m4a / aac / opus，倍速 1.0–2.0、音量 0–1。
- 系统音频：`getDisplayMedia({ audio: true })` 取音轨后只接 `AnalyserNode`，不接扬声器，避免二次播放；授权失败时按钮回落并给出中文提示。
- 律动：`audioBeat()` 用 RMS×2.1 + 低频能量×0.95 做快攻慢放包络，返回值经 `onBeat` 回调写进两个后端的 `uBeat` uniform；片元着色器把 warp / ripple / caustic / band 四项乘以 `(1 + uBeat × 系数)`，低音落下时液面起伏、高光呼吸。
- 播放被浏览器自动播放策略拦截时提示「点试听开始播放」，用户点按钮即恢复。

## 活体动态壁纸（任务 8）

v.26.11.21.154805 起，视频与动态图壁纸不再只截第一帧，而是真正的「活体玻璃」：

- 客户端 `createLiveWallpaper(url, kind)` 在屏幕外挂一个 `<video muted loop playsInline>`（或 `<img>` 解 gif / apng），首帧就绪后由 `liveWallpaperFrame()` 画进一块 ≤1600 px 的 canvas。
- 渲染器每 110 ms 用 `texSubImage2D`（WebGL）或 `copyExternalImageToTexture`（WebGPU）更新同一张壁纸纹理，并重跑模糊前置通道，所以模糊后的波浪 / 人像仍然在动。
- 宿主把 gif / apng 归为 `kind: "animation"`，与 `video` 一样走 Range 流式路由；本机文件、WE 视频壁纸与自定义路径共用这条通道。
- 页面隐藏或渲染暂停时停止拷帧（不耗 GPU）；切换静态壁纸、切换后端或 dispose 时销毁隐藏元素与定时器。
- 换源仍由前端 0.22 s 的 digest 轮询驱动：视频换了、gif 改了，画面立刻跟着换，不必等 6 s 的静态刷新。

## 四象模式与智能取色

v.26.11.21.154004 起，设置页「外观」分组新增颜色模式，玻璃的底色不再只有跟随系统主题一种选择：

- 浅色 / 深色：强制使用对应的亮/暗 token 色板，文字颜色同步取反，保证壁纸很亮或很暗时仍然可读。
- 自定义颜色：用一个 `#rrggbb` 基色给玻璃染色；`glassTokens(..., { base })` 把基色与白/黑按固定比例混合出四层表面色，透明度曲线保持不变，所以「霜面浓度」的手感不变。
- 智能化：客户端对当前壁纸取主色——图片走 `createImageBitmap` 采样，视频 seek 到 30% 处抓一帧，场景/网页壁纸因为只有实时桌面捕获，直接采样捕获图——再交给同一套 `glassTokens`；亮度高于 0.62 切浅色、低于 0.34 切深色。
- 「按壁纸自动深浅」开关控制 auto / intelligent 两档是否按亮度自动切换明暗；关掉后只跟随系统主题。
- WE 模式自动深浅（任务 13）由同一条链路完成：WE 壁纸同样进入 `state.url`，智能化采样的是 WE 正在播放的画面。

## 三分支设置与模块架构（v.26.11.21.165200）

主题引擎是一个总插件，内部是四个可独立选择的能力：内置液态玻璃背景、壁纸引擎、elysia395 壁纸引擎兼容、灵动岛。前三个都是「背景来源」，同一时间只能启用一个；灵动岛是叠加层，独立开关。侧边栏入口统一叫「主题引擎」（Theme Engine）。

设置页顶部是三枚分支标签：**液态玻璃背景 / 壁纸引擎 / elysia395 兼容**（未检测到 elysia395 时不出现第三枚），右侧是独立的「灵动岛」开关。每个分支只渲染自己的设置，互不混排：

- **液态玻璃背景**：外观组（壁纸同步、背景模糊、饱和度、玻璃着色、霜面浓度、文字颜色、壁纸压暗、液态流动）+ 四象颜色模式 + 渲染与状态（硬件、智能预设、渲染引擎、帧率上限、动态分辨率、遮挡合成、文字颜色策略、版本与实时指标）。
- **壁纸引擎**：精简的 WE 壁纸选择器——状态行（未检测 / 运行中 / 未运行 + 当前壁纸）、搜索、类型筛选（全部 / 视频 / 场景 / 网页）、刷新、打开 WE / Steam、微软商店入口、缩略图网格（预览图 + WE 金标 + 类型标签，点击即应用）、自定义文件行（浏览 / 清除）。不再摆放 WE 本体的属性、预设、播放列表、播放控制等控件，那些功能仍由 Wallpaper Engine 负责，本插件只负责选源与渲染。
- **elysia395 兼容**：检测到该插件安装后才出现，用于接管它的 DSH 设置入口（后续版本完善）。

公共页脚保留「更新与下载」与「壁纸状态」两组。宿主通过 `/liquid-glass/state` 的 `elysia` 字段（读 profile 的依赖与 node_modules）决定是否显示第三枚标签。切换分支时会自动把背景来源指向对应模块（壁纸引擎 → WE 源；液态玻璃 → 真实桌面），互斥由界面直接保证。


## 外观模式：每模式独立设置（v.26.11.21.165900）

v.26.11.21.165900 起，「外观模式（四象）」区改成「模式选择器 + 该模式自己的设置块」：选哪个模式，就只渲染那个模式的设置，未选中的模式一个控件都不渲染。

- **每模式各存一份值**：`settings.modeValues` 给 auto / light / dark / custom / intelligent 各存一个桶，桶里只放外观相关的 6 个键（`tint`、`veil`、`dim`、`ink`、`customColor`、`autoInvert`）。切换模式时把目标桶装载回 top-level，top-level 始终是当前桶的镜像。
- **渲染与性能参数不进桶**：`blur / saturation / fps / refreshSec / flow / preset / renderMode / behind / source / audio` 仍由「智能预设 + 硬件档位」统一治理，避免切一次模式帧率跟着变。
- **存储兼容**：仍是 `dsh-liquid-glass.settings.v3`，只增量加了 `modeValues` 字段。老配置首次启动时用当前 top-level 值填满五个桶，视觉零变化；缺桶 / 桶内缺键各自回落默认，不抛错、不清空其它桶。
- **切换动画**：面板用 180ms 淡入 + 上移；玻璃颜色用 240ms rAF 数值插值（`tint / veil / dim / base`，easeOutCubic），每帧复用既有的 `glassTokens` 与 `overrideTokens`，不做 CSS transition。集显、系统「减少动效」或页面隐藏时直接跳到终值；动画中拖动任意滑杆会立刻取消动画并落到手动值（手动优先）。
- **智能取色不锁定**：采样跟着壁纸走，「重新取色」只是重算一次；`autoInvert` 只在 auto / intelligent 下显示（light / dark 下强制模式已经接管，开关无效所以不渲染）。
- **文案补齐**：`locale/zh.json`、`locale/en.json` 现在完整包含 `client/src/02-locale.js` 的全部键（各 216 个），修复了此前 `modesGroup`、`mode_*` 等键落空、界面显示原始 key 的问题。

## 五个选项框：灵动岛与插件管理（v.26.11.21.170813）

设置页顶部的选项框调整为五个：**液态玻璃背景 / 壁纸引擎 / elysia395 兼容（安装后才出现） / 灵动岛 / 插件管理**。灵动岛不再以右侧小开关的形式游离在分支之外，而是和三个背景模块并列成独立选项框，点进去只有自己的开关与说明；它是叠加层，开启后不会替换当前背景模块，也不参与三选一的互斥。

- **灵动岛**：独立开关 + 施工中说明。位置、尺寸与动画等参数留待后续版本，现在只有「是否启用」这一项，因此不会占位未实现控件。
- **插件管理**：本插件的自管理页——版本号、GitHub 仓库与 npm 包直达链接、检查更新（npm / git / GitHub 三渠道，每行给出下载入口）、以及壁纸运行状态与刷新、恢复默认设置。这些原本散落在页脚的内容集中到该选项框，其他分支只保留与本模块直接相关的设置。
- 分支选择是纯视图状态（`tab`），不会写进持久化设置；只有三个背景模块会写 `settings.module` 并同步 `source`。因此点开灵动岛或插件管理不会改变当前背景来源。
