<div align="center">

**[中文](README.md)** · [English](README.en.md)

# DSH Theme Engine

**桌面在玻璃后面，壁纸归你管。**

[![version](https://img.shields.io/github/v/tag/ShuoweiFu/DSH-Theme-Engine?style=flat-square&label=version&color=8fd6a0)](https://github.com/ShuoweiFu/DSH-Theme-Engine/tags)
[![license](https://img.shields.io/badge/license-Apache--2.0-8fd6a0?style=flat-square)](LICENSE)
[![platform](https://img.shields.io/badge/platform-Windows%2010%2020348%2B%20%7C%2011-5a544a?style=flat-square)](#已知边界)
[![stars](https://img.shields.io/github/stars/ShuoweiFu/DSH-Theme-Engine?style=flat-square&label=stars&color=ffd84a)](https://github.com/ShuoweiFu/DSH-Theme-Engine/stargazers)

当前版本 **v.26.11.21.175000** · Apache-2.0 · 只跑在 Windows 上的 DSH 桌面版

</div>

![界面](docs/screenshot.png)

---

## 它解决什么问题

DSH 的界面是方的、不透明的、和桌面无关。这个插件做三件事：

1. **把背景换掉** —— 桌面实时捕获，或者你指定的图片 / 视频 / gif，或者 Wallpaper Engine 正在播的那张。
2. **让界面浮起来** —— 面板、侧边栏、输入框都变成同一块玻璃：GPU shader 做的大半径模糊、按背景亮度自动定文字黑白、光标取文字的反色。
3. **让你能管壁纸** —— 一个对着 Wallpaper Engine 属性栏做的中枢：库、搜索、类型筛选、对齐方式、位置、翻转、倍速、音量、预设导入导出。

插件不注册 agent 工具、不往提示里塞字，**不花你一个 token**。

## 三种背景，同一时间只开一种

| 模块 | 背景从哪来 | 什么时候出现 |
| --- | --- | --- |
| 液态玻璃背景 | 本机桌面捕获，或你指的文件 / URL | 一直有（内置） |
| 壁纸引擎 | 你本机 Steam 里的 Wallpaper Engine 库；场景 / 网页交给 WE 播放后捕获 | 一直有；没装 WE 时是简化形态 |
| elysia395 兼容 | [elysia395/dsh-wallpaper-engine](https://github.com/elysia395/dsh-wallpaper-engine) | 检测到那个插件才出现 |

三者互斥——同一时刻只有一块玻璃在供背景。**灵动岛**不属于它们，是独立叠加层，开哪个背景都能开。

## 三十秒上手

前提：Windows 10 20348+ / Windows 11、DSH 桌面版。

```powershell
# 装：Release 包
plugin_manager install_bundle target="<下载的 .tgz>"

# 装：源码
git clone https://github.com/ShuoweiFu/DSH-Theme-Engine.git
plugin_manager install_bundle target="<clone 出来的绝对路径>"
```

刷新页面 → 侧边栏多一行 **主题引擎** → 点开，设置页整页铺在右侧主工作区。

改 `client/` 只需 Ctrl+R；改 `index.js` 或 `host/` 必须重启 DSH，否则新路由不存在。

## 壁纸中枢：照着 Wallpaper Engine 做的

壁纸引擎分支从上到下就是一条流水线：**开关 → 库 → 属性 → 预设 → 本地文件**。

### 库

扫描 Steam 的 `libraryfolders.vdf`，再读 `steamapps/workshop/431960/*/project.json` 与 WE 自己的 `config.json`，把视频 / 场景 / 网页三类项目列成缩略图网格，带搜索框和类型筛选。每条都标了类型；场景与网页项目多一枚金色 `WE` 角标，因为它们的画面只能由 WE 本体渲染。

### 属性

和 WE 右侧属性栏一一对应，改完立刻作用到当前壁纸：

| 项 | 取值 | 作用 |
| --- | --- | --- |
| 对齐方式 | 覆盖 / 适应 / 拉伸 / 逐像素 | 壁纸铺满屏幕的方式；逐像素只放大不插值，适合像素画 |
| 位置 X / Y | 0–100 | 任意对齐方式下都能平移，50/50 为居中 |
| 翻转 X / Y | 开 / 关 | 水平、垂直镜像 |
| 播放速度 | 0.25–2.00× | 视频壁纸与动态图的播放倍率 |
| 音量 | 0–1 | 壁纸自带音轨 |
| 静音 | 开 / 关 | 只切 `muted`，不重新加载视频，所以不会闪一下 |
| 恢复默认 | — | 一次把上面全部拉回初始值 |

对齐、位置、翻转由片元着色器里的 `uFit` / `uPan` / `uFlip` 直接算 UV，不经过 CSS，所以和玻璃模糊是同一趟采样，不额外开一条渲染链路。

### 预设

命名保存当前这一组参数，支持加载、删除、导出成 JSON、把 JSON 粘回来导入，最多 24 条。预设只存壁纸参数，不存壁纸本身——换机器照样能用，只要把参数带上。

### 没装 Wallpaper Engine 的样子

这是刻意的：**检测不到 WE 就换一套界面**。库网格、搜索、类型筛选、「打开 WE」「Steam 商店」按钮全部不渲染，只留

- 一行状态说明（未检测到 WE）
- Steam 商店入口（想装的时候点）
- 完整的属性面板（本地视频和图片同样吃对齐、位置、翻转、倍速）
- 本地文件选择器

不会出现一排点了没反应的按钮。

### 场景 / 网页壁纸怎么切

这两类自己渲染不了，插件会调

```
wallpaper64.exe -control openWallpaper -file <project.json>
```

让 WE 本体换壁纸，`invalidate()` 清缓存后等 1200 ms 再复核一次 WE 状态，然后照常从桌面捕获进玻璃。返回 `{ ok, switched, id, title, type, file }`，界面按结果给提示。

## 「循环播放黑一下」是怎么没的

视频循环回到 0:00 时，解码器常会先吐一帧近黑再继续。插件用 110 ms 的定时器把当前帧 `texSubImage2D` 上传纹理——只要那一帧是黑的，玻璃后面就会黑一下。

修法不是"见到黑就丢"（那会把夜景壁纸和真正的淡出一起吃掉），而是复用墨色检测里已有的 `isBlackSwap`：

- 只有在**上一帧是亮的**、这一帧突然低于黑度阈值时才拒
- 最多连拒 2 帧，第 3 帧无论多黑都放行，避免卡死在黑帧上
- 暗色壁纸本来就一直暗，永远不会命中这条规则

WebGL 与 WebGPU 两条上传路径都加了这道闸。

## 玻璃本身

- **模糊**：13-tap 泊松核高斯。WebGL 端 1–4 次 ping-pong 把半径堆到最大；WebGPU 端是独立 WGSL 前置通道。`背景模糊` 拉满时是平滑的大半径过渡，不是被截断的 CSS blur。
- **遮挡窗口**：DSH 下面压着的浏览器、编辑器、播放器按屏幕坐标裁出来贴回玻璃背后，圆角与透明区按预乘 alpha 合成，不贴黑边。截图一次 0.02–0.06 s，可关。
- **文字**：按背景亮度在黑白之间切换，目标对比度 WCAG 7:1。手动选了颜色之后就不再自动改写。
- **光标**：取墨色的**反色**——深色字配白光标，浅色字配黑光标。CSS 只有 `caret-color` 可调，所以这是能做到的最稳妥方案。
- **五种颜色模式**：自动 / 浅色 / 深色 / 自定义 / 智能取色。智能取色从后方画面取主色染玻璃，按亮度阈值切深浅；切模式有 240 ms 过渡，你一拖滑块动画立刻让位。
- **按模块分开存**：每个背景模块各有自己的一份外观参数，每种颜色模式再各存一份，切来切去谁也不覆盖谁。

## 性能：先看档位，再开帧率

启动时静默读一次显卡字符串（`WEBGL_debug_renderer_info`，本地读、不上传），套用下表。

| 显卡 | 默认档 | 后端 | 帧率 | 动态降分辨率 |
| --- | --- | --- | --- | --- |
| Intel Iris Xe / UHD / HD、AMD Radeon / Vega APU、Apple M 系 | 🛡 核显保命 | WebGL | 30 | ✅ |
| 未知 / 虚拟机 / 软件渲染（SwiftShader、llvmpipe） | 🛡 核显保命 | WebGL | 30 | ✅ |
| GTX 10 / 16、RTX 20 / 30、RX 5000–7000、Arc A | ⚖ 独显均衡 | WebGL | 60 | ✅ |
| RTX 40 / 50、RX 9000、Arc B、RTX A | 🔥 火神狂暴 | WebGPU（回落 WebGL） | 144 | ❌ |

> 实测过的反面教材：i7-12700H + Iris Xe + 10 GB LPDDR5，解除帧率限制并关掉动态分辨率，连续 10 分钟后 GPU 96 °C，蓝屏。核显没有独立显存，超过 40 FPS 的每一帧只是在发热。

所以有五层保命：帧时间超预算 → 降分辨率（1.0 → 0.8 → 0.65 → 0.5）→ 关遮挡合成 → 静态半透明遮罩 → 自动关闭；连续 5 秒超预算或 `webglcontextlost` 直接回落安全档。

| 基线（i7-12700H / Iris Xe / 2520×1680@150%） | 数值 |
| --- | --- |
| 单帧渲染 1680×1119（scale 1.0） | 16.9 ms |
| 单帧渲染 1344×895（scale 0.8，默认） | ≈10–11 ms |
| 插件显存增量 | 20–25 MB |
| 捕获一帧（WGC + 合成 + JPEG） | ≈32 ms 均值（8 fps 上限） |
| 桌面静止时 | 零编码、零重绘 |

## 设置项速查

**外观**（每个模块各一份）：背景模糊 10 px、饱和度 1.4、玻璃着色 55%、霜面浓度 34%（唯一控制厚度的滑条）、壁纸压暗 8%、液态流动 0.9（0 = 按需渲染）、文字颜色自动、颜色模式自动、自定义颜色 `#8ab4ff`、按壁纸自动深浅开。

**壁纸**：启用液态玻璃开、WE 库自动读取、对齐覆盖、位置 50/50、翻转关、速度 1.00×、音量 0、静音开、预设最多 24 条、本地文件支持图片 / 视频 / gif / apng。

**声音**：本机播放列表（mp3 / flac / wav / ogg / m4a / aac / opus，0.25–2.0×，音量可调），或系统音频（需授权，**只做分析，不二次播放**）。能量实时喂给 shader，低音落下时液面起伏。

**性能**：智能预设跟随显卡、后端 WebGL / WebGPU、最大帧率按档 30 / 60 / 144、自动降分辨率开、遮挡合成按档、壁纸刷新自动（8 fps 流 + 0.22 s digest + 420 ms 交叉淡入）。

## 已知边界

- 只映射主显示器。
- 被遮挡的 UWP / DRM / 最小化窗口可能是空表面：跳过不贴黑，但 `apps` 里仍会列出。
- 无边框捕获要 Windows 11 / 10 20348+；更老系统上系统黄框会回来，背景照常刷新。
- 窗口最小化时 Chromium 会停渲染循环，这是浏览器行为，也顺带省电。
- 场景 / 网页壁纸的切换依赖 WE 本体；WE 没装或没运行时这两类只给提示。
- 倍速 / 音量只作用于 `<video>` 类壁纸与动态图；场景壁纸的播放参数得进 WE 调。
- 非 Windows 平台没有遮挡合成，只能同步静态壁纸文件。
- elysia395 分支目前是占位：检测到就出现，接管与迁移还在做。

## 生态

- **Wallpaper Engine**（Steam AppID `431960`）：库扫描、项目类型判断、属性语义都照它来；场景 / 网页靠它播放。
- **[elysia395/dsh-wallpaper-engine](https://github.com/elysia395/dsh-wallpaper-engine)**：第三种背景模块的兼容目标。装了两个可以共存，但同一时间只有一个在供背景。

## 开发

```powershell
pnpm build:client    # client/src/*.js → client/client.js（只要 Node.js，无第三方依赖）
pnpm build:capture   # tools/capture/lg-capture.cpp → bin/lg-capture.exe（要 clang++，可用 LG_CLANG 指定）
```

| 路径 | 作用 |
| --- | --- |
| `index.js` | 宿主入口：`/liquid-glass/*` 路由（含 `/we/open`）、捕获调度、模块状态、更新检查 |
| `host/` | 壁纸识别、WE 桥（扫描 / 预览 / 切换）、常驻捕获助手、PowerShell 回退、更新检查 |
| `client/src/` | 前端源码，`01` → `14` 顺序拼接（13 = 壁纸中枢与颜色模式，14 = 音频矩阵） |
| `client/client.js` | 构建产物，DSH 通过 `exports["./client"]` 加载 |
| `tools/capture/lg-capture.cpp` | 原生捕获 / 合成助手（WGC + GDI+） |
| `bin/lg-capture.exe` | 预编译助手，随插件分发 |
| `docs/DETAIL.md` | 合成原理、屏幕空间映射、五层保命、着色器参数、模块数据形状 |

提 issue 请带上宿主 / 插件版本、系统、显卡、复现步骤和脱敏日志。

## 许可

[Apache License 2.0](LICENSE) © DSH Theme Engine contributors

允许商用、修改、再分发，需保留版权与许可声明；详见 [LICENSE](LICENSE) 与 [NOTICE](NOTICE)。