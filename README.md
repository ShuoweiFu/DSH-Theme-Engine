# DSH Theme Engine

[![version](https://img.shields.io/badge/version-v.26.11.21.011937-blue)](https://github.com/ShuoweiFu/DSH-Theme-Engine/releases)
[![license](https://img.shields.io/badge/license-Apache--2.0-green)](LICENSE)
[![platform](https://img.shields.io/badge/platform-Windows%2010%20%7C%2011-lightgrey)](#硬件兼容性)

> Liquid glass for DeepSeek Harness — your desktop wallpaper lives behind the UI, and the whole window behaves like a piece of frosted, slightly liquid glass.

把 DSH 的界面变成一层会流动的液态玻璃：桌面壁纸（含 Wallpaper Engine 动态壁纸）实时同步到窗口背后，面板、侧边栏、输入框和文字像悬空在玻璃上；窗口后面压着别的应用时，被遮住的那一块也会被合成进来。

模糊不是 CSS 滤镜糊出来的：两种 GPU 后端（WebGL / WebGPU）都用自己的 **13-tap 泊松核高斯**，多次 ping-pong 覆盖大半径；第五层保护触发时退到一层静态半透明遮罩，绝不黑屏。

当前版本 **v.26.11.21.011937**（版本号按 `v.年月日.时分秒`，西安授时）。

![Liquid Glass 效果](docs/screenshot.png)

---

## 特性

- **真实桌面当背景**：走 `Windows.Graphics.Capture` 常驻捕获流，默认 8 fps，画面真的变化才编码推帧；桌面静止时零编码、零重绘。
- **被遮挡窗口也合成**：DSH 下面压着的应用（浏览器、编辑器、视频）按屏幕坐标裁剪后贴回玻璃背后，不用把窗口挪开。
- **Shader 完成的模糊**：WebGL 端 1–4 次 ping-pong 的 13-tap 高斯；WebGPU 端独立的 WGSL 模糊前置通道。半径映射随 `背景模糊` 滑杆连续变化，不是截断的 CSS blur。
- **自动文字颜色**：按背景亮度在黑白字之间切换（WCAG 7:1 目标），手动选择后不再被自动改写。
- **硬件自适应**：启动时静默识别显卡，套用核显保命 / 独显均衡 / 火神狂暴三档，不冒进。
- **五层性能保护**：帧时间超预算 → 降分辨率 → 关遮挡合成 → 静态半透明兜底 → 自动关闭；第二次崩溃不黑屏。
- **原生主视图**：侧边栏只留一行「液态玻璃」，点开后设置页像原生「插件」页一样整页铺在右侧主工作区，刷新后回到会话。

## 安装

要求：Windows 10 20348+ / Windows 11、DSH 桌面版。

```powershell
git clone https://github.com/ShuoweiFu/DSH-Theme-Engine.git
```

然后在 DSH 里把 clone 出来的目录装成 bundle：

```
plugin_manager install_bundle target="<clone 出来的绝对路径>"
```

刷新页面后，侧边栏「插件」「自动化任务」下面会出现一行 **液态玻璃**。点它，设置页进入右侧主工作区。首次启动会自动按显卡选档，不需要手动配置。

## 硬件兼容性

**先看表再开高帧率。** 插件启动时会静默读取显卡型号（`WEBGL_debug_renderer_info`，本地读取、不上传），自动套用下表档位。

| 你用的显卡 | 检测特征 | 默认预设 | 引擎 | 帧率 | 动态降分辨率 | 遮挡窗口合成 |
| --- | --- | --- | --- | --- | --- | --- |
| Intel Iris Xe / UHD / HD，AMD Radeon / Vega APU，Apple M 系列 | `Intel`, `Iris`, `UHD`, `Radeon Graphics`, `Vega`, `Apple M*` | 🛡 核显保命档 | WebGL | 30 FPS | ✅ | ✅ |
| 未知 / 虚拟机 / 软件渲染 | `SwiftShader`, `llvmpipe`, `Microsoft Basic Render` | 🛡 核显保命档 | WebGL | 30 FPS | ✅ | ✅ |
| GTX 10 / 16 系、RTX 20 / 30 系、RX 5000–7000、Arc A 系 | `GTX`, `RTX 20/30`, `RX 5xxx–7xxx` | ⚖ 独显均衡档 | WebGL | 60 FPS | ✅ | ✅ |
| RTX 40 / 50 系、RX 9000 系、Arc B 系、RTX A 系 | `RTX 40xx/50xx`, `RX 9xxx` | 🔥 火神狂暴档 | WebGPU（不可用自动回落 WebGL） | 144 FPS | ❌ | ✅ |

> **核显强开高帧率的真实结局**：一台 i7-12700H + Iris Xe + 10 GB LPDDR5 的笔记本，手动解除帧率限制并关掉动态分辨率，连续渲染 10 分钟后 GPU 96 °C，随后蓝屏。核显没有独立显存，它借系统内存带宽、和 CPU 抢同一个散热模组——超过 40 FPS 的每一帧只是在发热。
>
> 所以插件不是只写一句警告：首次启动按显卡套档；手动超出档位上限会显示 ⚠；连续 5 秒帧时间超预算或 `webglcontextlost` 时自动回落到安全配置。

## 设置项

| 分组 | 项 | 默认 | 说明 |
| --- | --- | --- | --- |
| 预设 | 智能预设 | 自动（跟随显卡） | 核显保命 / 独显均衡 / 火神狂暴 |
| 外观 | 背景来源 | 真实桌面（含图标） | 「壁纸本体」只取壁纸原图，不含桌面图标 |
| 外观 | 背景模糊 | 10 px | 0 px = 像素级清晰；半径由 shader 的 13-tap 多 pass 完成 |
| 外观 | 饱和度 | 1.4 | 玻璃层的色彩浓度 |
| 外观 | 玻璃着色 | 55% | 只调色温与霜白偏向，不决定厚度 |
| 外观 | 霜面浓度 | 34% | 唯一控制面板厚度的滑条：0% = 裸玻璃，100% = 最厚白霜 |
| 外观 | 文字颜色 | 自动 | 按背景亮度在黑白字间切换（WCAG 7:1）；手动选择后不再改写 |
| 外观 | 壁纸压暗 | 8% | 只在壁纸很亮时压一点，避免文字发飘 |
| 外观 | 液态流动 | 0.9 | 0 时进入按需渲染，鼠标静止即挂起 |
| 性能 | 渲染引擎 | WebGL | WebGL（推荐）/ WebGPU（实验） |
| 性能 | 最大帧率 | 按档位 30 / 60 / 144 | 无限制只在高端独显上可选 |
| 性能 | 自动降分辨率 | 开 | 帧时间超预算 → 1.0 → 0.8 → 0.65 → 0.5 |
| 性能 | 合成被遮挡的窗口 | 按档位 | 关掉可省每次截图 0.02–0.06 s |
| 性能 | 壁纸刷新 | 自动 | 常驻捕获流（默认 8 fps）：变化才编码；页面 0.22 s 一次 digest 检查；换图交叉淡入 420 ms |

## 工作原理

```
┌──────────────────────── 宿主（Node, index.js + host/） ────────────────────────┐
│  本机路由 /liquid-glass/{state,wallpaper,gate,log}                              │
│  lg-capture.exe (C++/WGC) ──常驻流──▶ 桌面帧 + 遮挡窗口合成 → JPEG 帧            │
│  壁纸识别：Wallpaper Engine（64/32 位）· 静态图片 · 动态视频                     │
└──────────────────────────────────┬──────────────────────────────────────────────┘
                                   │ HTTP（仅 127.0.0.1）
┌──────────────────────────────────▼──────────────────────────────────────────────┐
│  客户端（client/client.js，12 个模块按序拼接）                                   │
│  GlassLayer：shell.overlay 覆盖层，渲染「背景玻璃 + 主题 token」                 │
│  设置页：main 槽 key=liquid-glass + sidebar.panellist 同名入口                   │
│  WebGL：Blur 双重缓冲 ping-pong · WebGPU：WGSL blur prepass                      │
└─────────────────────────────────────────────────────────────────────────────────┘
```

- **捕获**：`Windows.Graphics.Capture` 常驻流，`tools/capture/lg-capture.cpp` 负责枚举窗口、合成被遮挡区域、编码 JPEG；DSH 窗口本身排除在外。
- **合成**：按屏幕坐标把窗口内容裁进画布，圆角/透明区按预乘 alpha 做 source-over，不贴黑边。
- **渲染**：背景纹理先过模糊通道，再用主题 token 叠霜面、着色、压暗；文字颜色由对比度决策实时切换。
- **保护**：帧时间监控 → 降分辨率 → 停遮挡合成 → 静态半透明遮罩 → 自动关闭，逐层保命。

更细的屏幕空间映射、五层保护阈值、着色器参数见 [docs/DETAIL.md](docs/DETAIL.md)。

## 从源码构建

```powershell
pnpm build:client    # client/src/*.js → client/client.js
pnpm build:capture   # tools/capture/lg-capture.cpp → bin/lg-capture.exe（仅维护者需要）
```

- `build:client` 只需要 Node.js，无第三方依赖；产物已随仓库提交，改 UI 后跑它即可。
- `build:capture` 需要 MSYS2 UCRT64 的 `clang++`，也可用环境变量 `LG_CLANG` 指定编译器。普通用户无需编译，`bin/lg-capture.exe` 已随仓库打包。

## 仓库结构

| 路径 | 作用 |
| --- | --- |
| `index.js` | 宿主插件入口：`/liquid-glass/*` 本地路由、捕获调度与状态缓存 |
| `host/` | 宿主能力：壁纸识别、常驻捕获助手、PowerShell 回退、运行封装 |
| `client/src/` | 前端源码，`01` → `12` 按序拼接 |
| `client/client.js` | 构建产物，DSH 通过 `exports["./client"]` 加载 |
| `tools/capture/lg-capture.cpp` | 原生捕获/合成助手（WGC + GDI+） |
| `bin/lg-capture.exe` | 预编译助手，随插件分发 |
| `docs/` | 实现细节与截图 |
| `scripts/` | 两个构建脚本 |

## 权限与隐私

- 显卡型号只在浏览器内读取一次，用于选档位，**不会**发送到任何服务器。
- 桌面截图由随插件打包的本地助手在本机生成，经 `http://127.0.0.1` 本地路由提供给页面（仅监听回环地址，不校验登录）。
- 没有任何遥测。

## 已知限制

- 只支持主显示器；多屏时其它屏幕不会被映射。
- 被遮挡的 UWP / DRM / 已最小化窗口可能抓到空表面：跳过不贴黑，`apps` 里仍列出。
- 显卡彻底崩溃时只剩一层静态半透明遮罩（没有折射与流动）；10 分钟内第二次崩溃会自动关闭插件。
- 非 Windows 平台暂不支持「被遮挡窗口合成」，只能同步静态壁纸文件。
- 无边框捕获（`IGraphicsCaptureSession3`）需要 Windows 11 / 10 20348+；更老系统上系统黄框会回来，背景照常刷新。
- 窗口最小化 / 完全不可见时 Chromium 会停掉渲染循环，这是浏览器行为，也是省电设计。

## FAQ

**为什么看不到壁纸？**
先确认插件已启用（侧边栏有「液态玻璃」行），再看 `/liquid-glass/state` 的 `clientError`。若提示静态遮罩，说明显卡渲染失败，等冷却后点「重新尝试」。

**会不会把我的屏幕截图传出去？**
不会。捕获、合成、编码全部在本机完成，页面只从 `127.0.0.1` 取帧。

**为什么 100% 模糊时帧率会掉？**
模糊半径越大，ping-pong pass 数越多（最多 4 次）。核显档建议 10–20 px。

**怎么卸载？**

```
plugin_manager set_bundle target=dsh-theme-engine enabled=false
```

再删掉 profile 里对应的 `node_modules` junction 与依赖项即可。

## 版本与发布

- `package.json` 用 `26.11.21-011937`（无 `v` 前缀）。
- UI、日志、文档、Git tag 统一用 `v.26.11.21.011937`。
- 项目原名 `dsh-liquid-glass`（DSH Liquid Glass），现名 **DSH Theme Engine**；内部路由 `/liquid-glass` 与侧边栏显示名「液态玻璃」保留，避免破坏已存设置。

## License

[Apache License 2.0](LICENSE) © DSH Theme Engine contributors

本项目基于 Apache License 2.0 发布：允许商用、修改、再分发，需保留版权与许可声明；详见 [LICENSE](LICENSE) 与 [NOTICE](NOTICE)。
