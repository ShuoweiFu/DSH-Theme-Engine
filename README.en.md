<div align="center">

[中文](README.md) · **[English](README.en.md)**

# DSH Theme Engine

**Turn your desktop wallpaper into a layer of living liquid glass behind DeepSeek Harness.**

[![version](https://img.shields.io/github/v/tag/ShuoweiFu/DSH-Theme-Engine?style=flat-square&label=version&color=8fd6a0)](https://github.com/ShuoweiFu/DSH-Theme-Engine/tags)
[![license](https://img.shields.io/badge/license-Apache--2.0-8fd6a0?style=flat-square)](LICENSE)
[![platform](https://img.shields.io/badge/platform-Windows%2010%20%7C%2011-5a544a?style=flat-square)](#compatibility--limitations)
[![stars](https://img.shields.io/github/stars/ShuoweiFu/DSH-Theme-Engine?style=flat-square&label=stars&color=ffd84a)](https://github.com/ShuoweiFu/DSH-Theme-Engine/stargazers)

</div>

![DSH Theme Engine in action](docs/screenshot.png)

<p align="center"><sub>Real screenshot: wallpaper, liquid glass, settings page and frosted composer all active.</sub></p>

---

## Intro

Streams your real desktop — including **Wallpaper Engine** animated wallpapers — into the space behind the DSH window. Panels, sidebar, composer and text appear to float on glass. When another app sits behind DSH, the occluded region is composited back into the glass by screen coordinates.

Blur runs on the GPU: both backends (WebGL / WebGPU) share the same **13-tap Poisson-kernel Gaussian**, applied over multiple ping-pong passes for large radii. There is no CSS-only render mode, and no CSS `filter` pretending to be frosted glass.

The plugin registers no agent tools and injects no prompt text, so it adds **zero model token cost**.

Current version **v.26.11.21.011937**.

## Table of contents

<table>
  <tr>
    <td width="50%" valign="top">
      <ul>
        <li><a href="#features">Features</a> · <a href="#hardware-tiers">Hardware tiers</a></li>
        <li><a href="#quick-start">Quick start</a> · <a href="#usage">Usage</a></li>
        <li><a href="#settings">Settings</a> · <a href="#performance-baseline">Performance</a></li>
        <li><a href="#compatibility--limitations">Compatibility</a> · <a href="#development">Development</a></li>
      </ul>
    </td>
    <td width="50%" valign="top">
      <ul>
        <li>Version: <code>v.26.11.21.011937</code></li>
        <li>Platform: Windows 10 20348+ / Windows 11</li>
        <li>Host: DeepSeek Harness desktop</li>
        <li>License: <a href="LICENSE">Apache-2.0</a></li>
      </ul>
    </td>
  </tr>
</table>

## Features

- **Wallpaper &amp; capture**: a persistent `Windows.Graphics.Capture` stream at 8 fps, encoding only when the frame actually changes; zero encoding and zero redraws when the desktop is static. Supports WE Scene / Video, static images and video files.
- **Occluded-window compositing**: browsers, editors and players behind DSH are cropped by screen coordinates and composited back behind the glass. Rounded corners and transparent areas use premultiplied-alpha source-over, never black edges.
- **Shader blur**: WebGL does 1–4 ping-pong passes of a 13-tap Gaussian; WebGPU has its own WGSL blur prepass. At 100% `Background blur` you get a wide, smooth radius — not a clipped CSS blur.
- **Adaptive ink**: switches between black and white text based on background luminance (WCAG 7:1 target); manual choices are never overridden.
- **Dual backends**: WebGL (best compatibility) / WebGPU (experimental). If WebGPU is unavailable it falls back to WebGL automatically — no error toast, no black screen.
- **Performance guard**: three presets (iGPU-safe / discrete-balanced / overkill); frame budget exceeded → lower resolution → disable occlusion compositing → static translucent scrim → auto-disable. Five layers, each one safer than the last.
- **Native main view**: the sidebar gains a single row, **Liquid Glass**. Clicking it renders the settings page full-page in the right main workspace, exactly like the native Plugins page. Reloading returns to the conversation.

## Hardware tiers

On startup the GPU string is read locally (`WEBGL_debug_renderer_info`, never uploaded) and the matching tier is applied automatically. **Check the table before raising the frame cap.**

| GPU | Detection | Default preset | Engine | FPS | Dynamic resolution | Occlusion |
| --- | --- | --- | --- | --- | --- | --- |
| Intel Iris Xe / UHD / HD, AMD Radeon / Vega APU, Apple M series | `Intel`, `Iris`, `UHD`, `Radeon Graphics`, `Vega`, `Apple M*` | 🛡 iGPU-safe | WebGL | 30 FPS | ✅ | ✅ |
| Unknown / VM / software rendering | `SwiftShader`, `llvmpipe`, `Microsoft Basic Render` | 🛡 iGPU-safe | WebGL | 30 FPS | ✅ | ✅ |
| GTX 10 / 16, RTX 20 / 30, RX 5000–7000, Arc A | `GTX`, `RTX 20/30`, `RX 5xxx–7xxx` | ⚖ Balanced | WebGL | 60 FPS | ✅ | ✅ |
| RTX 40 / 50, RX 9000, Arc B, RTX A | `RTX 40xx/50xx`, `RX 9xxx` | 🔥 Overkill | WebGPU (falls back to WebGL) | 144 FPS | ❌ | ✅ |

> Real-world result of forcing high FPS on an iGPU: an i7-12700H + Iris Xe + 10 GB LPDDR5 laptop, with the frame cap removed and dynamic resolution off, reached 96 °C and blue-screened after 10 minutes. An iGPU has no dedicated VRAM — every frame above ~40 FPS just makes heat. That is why the plugin applies a tier on first launch, warns when you exceed it, and falls back automatically after 5 seconds over budget or on `webglcontextlost`.

## Quick start

Requirements: **Windows 10 20348+ / Windows 11** and the **DSH desktop app**. Building the client needs only Node.js (no third-party deps); building the native helper needs `clang++` from MSYS2 UCRT64.

**Install from source**

```powershell
git clone https://github.com/ShuoweiFu/DSH-Theme-Engine.git
```

Then install the cloned directory as a bundle inside DSH:

```
plugin_manager install_bundle target="<absolute path of the clone>"
```

Reload the page: a **Liquid Glass** row appears in the sidebar below Plugins and Scheduled Tasks. Click it and the settings page opens in the right main workspace.

**Build**

```powershell
pnpm build:client    # client/src/*.js → client/client.js
pnpm build:capture   # tools/capture/lg-capture.cpp → bin/lg-capture.exe (maintainers only)
```

- `build:client` needs only Node.js. The built bundle is committed, so run it after UI changes.
- `build:capture` needs `clang++` (override with `LG_CLANG`). End users do not need to compile; `bin/lg-capture.exe` ships with the repo.

## Usage

1. Click **Liquid Glass** in the sidebar; the settings page fills the right main workspace.
2. Pick a preset, or tune background blur, saturation, frost density, ink color and liquid flow.
3. Changes apply instantly and persist. Reloading or restarting returns you to the conversation; settings are kept.

## Settings

| Group | Item | Default | Notes |
| --- | --- | --- | --- |
| Preset | Smart preset | Auto (by GPU) | iGPU-safe / Balanced / Overkill |
| Appearance | Background source | Real desktop (with icons) | "Wallpaper only" excludes desktop icons |
| Appearance | Background blur | 10 px | 0 px = pixel-sharp; radius is produced by the shader's 13-tap passes |
| Appearance | Saturation | 1.4 | Color intensity of the glass layer |
| Appearance | Glass tint | 55% | Color temperature / frost bias only; does not set thickness |
| Appearance | Frost density | 34% | The only thickness control: 0% = bare glass, 100% = thickest frost |
| Appearance | Ink color | Auto | Switches black/white by background luminance (WCAG 7:1); manual choice is respected |
| Appearance | Wallpaper dim | 8% | Only dims very bright wallpapers to keep text readable |
| Appearance | Liquid flow | 0.9 | 0 = render on demand; fully idle when the mouse stops |
| Performance | Render engine | WebGL | WebGL (recommended) / WebGPU (experimental) |
| Performance | Max FPS | Tier default 30 / 60 / 144 | Unlimited is available only on high-end discrete GPUs |
| Performance | Dynamic resolution | On | Over budget → 1.0 → 0.8 → 0.65 → 0.5 |
| Performance | Composite occluded windows | By tier | Turning it off saves 0.02–0.06 s per capture |
| Performance | Wallpaper refresh | Auto | Persistent stream (8 fps): encode only on change; digest check every 0.22 s; 420 ms cross-fade |

## Performance baseline

| Item | Value (i7-12700H / Iris Xe / 2520×1680@150%) |
| --- | --- |
| Single frame (1680×1119, scale 1.0) | **16.9 ms** |
| Single frame (1344×895, scale 0.8, default tier) | **≈10–11 ms** |
| Plugin VRAM delta | **20–25 MB** (6.8 MB textures + 1.7 MB blur buffers + back buffers) |
| Resident GPU memory (A/B) | 286 MB on / 275 MB off |
| One capture frame (WGC readback + composite + JPEG) | **≈32 ms avg** (15–60 ms), capped at 8 fps |
| One desktop composite (cold / one-shot process) | 78–125 ms; 60–75 ms with occlusion off |
| End-to-end (window change under DSH → glass update) | **≈0.25–0.4 s** (streaming); zero work when static |

## Compatibility & limitations

- Primary monitor only; other screens are not mirrored.
- Occluded UWP / DRM / minimized windows may yield empty surfaces: they are skipped (no black blit) but still listed in `apps`.
- If the GPU crashes completely only a static translucent scrim remains (no refraction or flow); a second crash within 10 minutes disables the plugin.
- Non-Windows platforms do not support occluded-window compositing yet; only static wallpaper files are synchronized.
- Borderless capture (`IGraphicsCaptureSession3`) requires Windows 11 / 10 20348+; on older systems the yellow capture border returns but the background still refreshes.
- When the window is minimized or fully hidden, Chromium stops the render loop. That is browser behavior and a power-saving design.

## Development

Bug reports, compatibility feedback, doc fixes and feature PRs are welcome. Please include host/plugin version, OS, GPU model, reproduction steps and redacted logs.

- [Implementation details](docs/DETAIL.md): compositing, screen-space mapping, the five guard layers, shader parameters.
- [Repository layout](README.en.md#repository-layout): what each directory does.
- Build: `node scripts/build-client.mjs`, `node scripts/build-capture.mjs`.

## Credits

Thanks to all contributors ❤️

<a href="https://github.com/ShuoweiFu/DSH-Theme-Engine/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=ShuoweiFu/DSH-Theme-Engine" alt="Contributors">
</a>

<a href="https://star-history.com/#ShuoweiFu/DSH-Theme-Engine&Date">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=ShuoweiFu/DSH-Theme-Engine&type=Date&theme=dark">
    <img src="https://api.star-history.com/svg?repos=ShuoweiFu/DSH-Theme-Engine&type=Date" alt="Star History" width="720">
  </picture>
</a>

## Repository layout

| Path | Purpose |
| --- | --- |
| `index.js` | Host plugin entry: `/liquid-glass/*` local routes, capture scheduling and state cache |
| `host/` | Host capabilities: wallpaper detection, persistent capture helper, PowerShell fallback, run wrapper |
| `client/src/` | Client source, concatenated in order `01` → `12` |
| `client/client.js` | Built artifact loaded through `exports["./client"]` |
| `tools/capture/lg-capture.cpp` | Native capture/compositing helper (WGC + GDI+) |
| `bin/lg-capture.exe` | Prebuilt helper shipped with the plugin |
| `docs/` | Implementation details and screenshots |
| `scripts/` | The two build scripts |

## License

[Apache License 2.0](LICENSE) © DSH Theme Engine contributors

Released under the Apache License 2.0: commercial use, modification and redistribution are permitted provided the copyright and license notices are retained. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
