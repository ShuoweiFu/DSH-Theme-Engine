<div align="center">

[中文](README.md) · **[English](README.en.md)**

# DSH Theme Engine

**One plugin, three background modules: liquid glass, Wallpaper Engine, elysia395 compatible.**

[![version](https://img.shields.io/github/v/tag/ShuoweiFu/DSH-Theme-Engine?style=flat-square&label=version&color=8fd6a0)](https://github.com/ShuoweiFu/DSH-Theme-Engine/tags)
[![license](https://img.shields.io/badge/license-Apache--2.0-8fd6a0?style=flat-square)](LICENSE)
[![platform](https://img.shields.io/badge/platform-Windows%2010%20%7C%2011-5a544a?style=flat-square)](#compatibility-and-limitations)
[![stars](https://img.shields.io/github/stars/ShuoweiFu/DSH-Theme-Engine?style=flat-square&label=stars&color=ffd84a)](https://github.com/ShuoweiFu/DSH-Theme-Engine/stargazers)

</div>

![DSH Theme Engine](docs/screenshot.png)

<p align="center"><sub>A real screenshot: wallpaper, liquid glass, settings page and frost all live at once.</sub></p>

---

## What it is

DSH Theme Engine is the theme engine for DeepSeek Harness. It mirrors your desktop — or whatever Wallpaper Engine is currently playing — behind the DSH window, then makes panels, the sidebar, the composer and text float on glass.

Three switchable background modules ship in one plugin: **liquid glass** (built in), **wallpaper engine** (reads your local Steam / Wallpaper Engine library, with a property sheet modelled on WE itself), and **elysia395 compatible** (appears only when the elysia395 plugin is detected). They are mutually exclusive: exactly one provides the background. The **island** is a separate overlay and can stay on with any of them.

Blur is done on the GPU: both WebGL and WebGPU backends share the same **13-tap Poisson-kernel Gaussian**, ping-ponged to reach large radii. There is no CSS-only mode and no `filter` pretending to be frosted glass.

The plugin registers no agent tools and injects no prompt text, so it **adds no model token cost**.

Current version **v.26.11.21.175000**.

## Ecosystem

- **Wallpaper Engine** (Steam AppID `431960`): reads `libraryfolders.vdf`, `workshop/431960/*/project.json` and WE's own `config.json`, and understands video / scene / web projects. Scene and web wallpapers are switched by asking WE itself (`wallpaper64.exe -control openWallpaper`), then captured back from the live desktop.
- **elysia395 / dsh-wallpaper-engine**: the third background module exists for compatibility with it — **[https://github.com/elysia395/dsh-wallpaper-engine](https://github.com/elysia395/dsh-wallpaper-engine)**. When that plugin is detected, an "elysia395 compatible" branch appears in settings. Both can be installed; only one module supplies the background at a time.

> **Machines with and without Wallpaper Engine get two different UIs.** When WE is missing, the wallpaper centre renders no library grid, no search, no type filters and no "open WE / Steam" buttons — only a status line, the Steam store link, the property sheet and local-file picking. No dead buttons.

## Highlights

- **Wallpaper centre (Wallpaper-Engine style)**: library grid (video / scene / web, previews, search, type filters), property sheet and presets. The sheet maps one-to-one onto WE's own property panel: **alignment** (cover / contain / stretch / pixel), **position X/Y**, **flip X/Y**, **playback speed** (0.25–2.00×), **volume**, **mute**, and reset to defaults. Presets can be named, saved, loaded, deleted, exported as JSON and pasted back in (up to 24). Video wallpapers are pinned directly; scene and web wallpapers are handed to WE and then captured.
- **Loop black-frame guard**: when a video loops back to 0:00 it often decodes a near-black frame, and uploading it on the 110 ms timer is exactly the "black flash" you see. The plugin reuses `isBlackSwap` from the ink detector: a near-black frame is rejected only right after a bright one, and never more than twice in a row — so dark wallpapers and genuine fades are untouched.
- **Wallpaper & capture**: a persistent `Windows.Graphics.Capture` stream at 8 fps that only encodes when the screen actually changes — zero encoding, zero repaint when the desktop is still. Supports WE scene / video wallpapers, static images, local videos and gif / apng animations.
- **Occluded-window compositing**: browsers, editors and players sitting under DSH are cropped by screen coordinates and pasted back behind the glass, so you never have to move a window. Rounded corners and transparent regions use premultiplied alpha — no black edges.
- **Shader blur**: 1–4 ping-pong passes of the 13-tap Gaussian on WebGL; a separate WGSL premultiplied blur pass on WebGPU. At maximum `blur` it is a wide, smooth falloff, not a truncated CSS blur.
- **Live wallpapers**: local video and gif / apng are uploaded frame by frame at ~9 fps (`texSubImage2D` / `copyExternalImageToTexture`), so the scene behind the glass keeps moving. Frame upload stops the moment the page is hidden or paused.
- **Per-module appearance**: each background module stores its own blur, saturation, flow, colour mode, custom colour, auto light/dark and ink values — plus its own bucket per colour mode — so switching modules never overwrites the other. The wallpaper module can also disable liquid glass and show the raw wallpaper.
- **Five colour modes**: auto / light / dark / custom / intelligent. Intelligent samples the dominant colour from whatever is behind the glass (image, video or live desktop capture) and flips light/dark by luminance thresholds, with a 240 ms transition that yields immediately to manual edits.
- **Sound-reactive**: local playlists (mp3 / flac / wav / ogg / m4a / aac / opus, 0.25–2.0× speed, volume) or system audio capture (analysis only, never replayed). Audio energy drives the shader: the surface rises on bass, highlights breathe.
- **Adaptive ink**: switches between black and white text by background luminance (WCAG 7:1 target), and stops overriding once you pick a colour yourself. The text caret takes the **inverse** of the ink — white caret on dark text, black caret on light text.
- **Two backends**: WebGL (best compatibility) / WebGPU (experimental), falling back to WebGL silently when WebGPU is unavailable.
- **Performance guard**: iGPU / balanced / beast presets; frame-time over budget → lower resolution → drop occluded compositing → static translucent mask → disable, five escalating levels.
- **Native main view**: the sidebar gains one row, "Theme Engine". Clicking it renders the settings page as a full page in the main work area, like the built-in Plugins page.

## Settings page and modules

Click **Theme Engine** in the sidebar. Five tabs sit at the top:

| Tab | Contents |
| --- | --- |
| Liquid glass | Appearance (wallpaper toggle, blur, saturation, tint, frost, dim, flow) + colour modes + render/status |
| Wallpaper engine | Glass toggle, the same appearance block (stored in the wallpaper module's own copy), the wallpaper centre (library + property sheet + presets) and the audio panel |
| elysia395 compatible | Appears only when [the elysia395 wallpaper engine](https://github.com/elysia395/dsh-wallpaper-engine) is detected; its settings will be absorbed here |
| Island | Independent overlay switch; never affects the active background module |
| Plugin manager | Version, GitHub / npm links, update check (npm / git / GitHub) and wallpaper status |

The first three are mutually exclusive; the island can be enabled alongside any of them.

## Hardware tiers

The plugin reads the GPU string silently at startup (`WEBGL_debug_renderer_info`, local only, never uploaded) and applies the tier below. **Read the table before forcing a high frame rate.**

| GPU | Detect hints | Default preset | Backend | FPS | Dynamic resolution | Occlusion compositing |
| --- | --- | --- | --- | --- | --- | --- |
| Intel Iris Xe / UHD / HD, AMD Radeon / Vega APU, Apple M series | `Intel`, `Iris`, `UHD`, `Radeon Graphics`, `Vega`, `Apple M*` | 🛡 iGPU safe | WebGL | 30 FPS | ✅ | ✅ |
| Unknown / VM / software rendering | `SwiftShader`, `llvmpipe`, `Microsoft Basic Render` | 🛡 iGPU safe | WebGL | 30 FPS | ✅ | ✅ |
| GTX 10 / 16, RTX 20 / 30, RX 5000–7000, Arc A | `GTX`, `RTX 20/30`, `RX 5xxx–7xxx` | ⚖ Balanced | WebGL | 60 FPS | ✅ | ✅ |
| RTX 40 / 50, RX 9000, Arc B, RTX A | `RTX 40xx/50xx`, `RX 9xxx` | 🔥 Beast | WebGPU (WebGL fallback) | 144 FPS | ❌ | ✅ |

> What forcing high frame rates on an iGPU really does: i7-12700H + Iris Xe + 10 GB LPDDR5, frame cap removed and dynamic resolution disabled, 10 minutes of continuous rendering → GPU at 96 °C, then a blue screen. An iGPU has no dedicated VRAM; every frame above 40 FPS just makes heat. Hence three safeguards: pick a tier from the GPU on first run; warn when you exceed the cap manually; fall back to a safe profile after 5 s over budget or on `webglcontextlost`.

## Quick start

Requires **Windows 10 20348+ / Windows 11** and **DSH Desktop**. Building the client needs only Node.js (no third-party deps); rebuilding the native helper needs `clang++` from MSYS2 UCRT64.

**Install (release bundle)**

Grab the latest `.tgz` from [Releases](https://github.com/ShuoweiFu/DSH-Theme-Engine/releases) and install it inside DSH:

```
plugin_manager install_bundle target="<path to the downloaded tgz>"
```

**Install (from source)**

```powershell
git clone https://github.com/ShuoweiFu/DSH-Theme-Engine.git
```

Then install the cloned folder as a bundle:

```
plugin_manager install_bundle target="<absolute path to the clone>"
```

Reload the page: a **Theme Engine** row appears in the sidebar, and its settings page opens in the main work area.

**Build**

```powershell
pnpm build:client    # client/src/*.js → client/client.js
pnpm build:capture   # tools/capture/lg-capture.cpp → bin/lg-capture.exe (maintainers only)
```

- `build:client` needs only Node.js; the built file is committed, so run it after UI changes.
- `build:capture` needs `clang++` (override with `LG_CLANG`). Users never need it — `bin/lg-capture.exe` ships prebuilt.

## Usage

1. Click **Theme Engine** in the sidebar; settings render as a full page.
2. Pick a background module at the top (an extra elysia395 branch appears when that plugin is installed).
3. Tune appearance and colour mode in the active branch; each module keeps its own copy.
4. In the wallpaper branch: the library sits on top (search, type filters, previews), the property sheet and presets below. Video cards apply instantly; scene / web cards ask WE to switch.
5. Turn off "liquid glass" to show the raw wallpaper.
6. Everything applies and saves immediately; reloading or restarting returns you to the session with settings intact.

> Host-side changes (`index.js`, `host/`) need a DSH restart to register new routes; client-only changes just need Ctrl+R.

## Settings reference

| Group | Setting | Default | Notes |
| --- | --- | --- | --- |
| Modules | Background module | Liquid glass | Liquid glass / Wallpaper engine / elysia395 compatible; mutually exclusive |
| Modules | Island | Off | Independent overlay, not part of the exclusivity |
| Appearance (per module) | Blur | 10 px | 0 px = pixel sharp; radius comes from the 13-tap multipass shader |
| Appearance (per module) | Saturation | 1.4 | Colour density of the glass layer |
| Appearance (per module) | Tint | 55% | Colour temperature / frost bias only, not thickness |
| Appearance (per module) | Frost | 34% | The only thickness control: 0% bare glass, 100% thick frost |
| Appearance (per module) | Ink | Auto | Black/white by luminance (WCAG 7:1); manual choice is never overridden |
| Appearance (per module) | Colour mode | Auto | Auto / light / dark / custom / intelligent; each keeps its own values |
| Appearance (per module) | Custom colour | #8ab4ff | Base colour for the custom mode |
| Appearance (per module) | Auto light/dark | On | Flips light/dark by luminance in auto and intelligent modes |
| Appearance (per module) | Wallpaper dim | 8% | Slight dim on bright wallpapers only |
| Appearance (per module) | Flow | 0.9 | 0 switches to render-on-demand, suspended when the mouse rests |
| Wallpaper | Liquid glass | On | Off shows the raw wallpaper with no glass layer |
| Wallpaper | WE library | Auto | Scans Steam `libraryfolders.vdf` and `workshop/431960/*/project.json`; video wallpapers apply directly |
| Wallpaper | Alignment | Cover | Cover / contain / stretch / pixel (matches WE's property panel) |
| Wallpaper | Position X/Y | 50 / 50 | 0–100 offset for any alignment |
| Wallpaper | Flip X/Y | Off | Horizontal / vertical mirror |
| Wallpaper | Playback speed | 1.00× | 0.25–2.00×, applied to the running video immediately |
| Wallpaper | Volume / mute | 0 / on | Wallpaper audio track; muting does not reload the video |
| Wallpaper | Presets | — | Name / save / load / delete / export JSON / paste import, up to 24 |
| Wallpaper | Local file | — | Image / video / gif / apng; video and animation stream over Range and are copied every 110 ms |
| Sound | Playlist | — | Sequential local audio with 0.25–2.0× speed and volume |
| Sound | System audio | — | Needs browser capture permission; analysis only, never replayed |
| Performance | Smart preset | Auto (per GPU) | iGPU safe / balanced / beast |
| Performance | Backend | WebGL | WebGL (recommended) / WebGPU (experimental) |
| Performance | Max FPS | 30 / 60 / 144 by tier | Unlimited only on high-end discrete GPUs |
| Performance | Dynamic resolution | On | Over budget → 1.0 → 0.8 → 0.65 → 0.5 |
| Performance | Occluded compositing | By tier | Disabling saves 0.02–0.06 s per capture |
| Performance | Wallpaper refresh | Auto | Persistent stream (8 fps): encode on change; 0.22 s digest check; 420 ms cross-fade |

## Performance baseline

| Item | Value (i7-12700H / Iris Xe / 2520×1680@150%) |
| --- | --- |
| Frame render (1680×1119, scale 1.0) | **16.9 ms** |
| Frame render (1344×895, scale 0.8, default) | **≈10–11 ms** |
| Plugin VRAM delta | **20–25 MB** (textures 6.8 MB + blur buffers 1.7 MB + back buffers) |
| Resident GPU memory (A/B) | on 286 MB / off 275 MB |
| One capture frame (WGC readback + compose + JPEG) | **≈32 ms mean** (15–60 ms), capped at 8 fps |
| One desktop composite (cold / one-shot) | 78–125 ms; 60–75 ms with occluded compositing off |
| End-to-end (window changes under DSH → glass updates) | **≈0.25–0.4 s** streaming; zero work when the desktop is still |

## Compatibility and limitations

- Primary monitor only; other screens are not mapped.
- Occluded UWP / DRM / minimised windows may yield empty surfaces: they are skipped rather than pasted black, but still listed in `apps`.
- If the GPU crashes outright only a static translucent mask remains (no refraction, no flow); a second crash within 10 minutes disables the plugin.
- Occluded-window compositing is Windows-only; elsewhere only static wallpaper files sync.
- Borderless capture (`IGraphicsCaptureSession3`) needs Windows 11 / 10 20348+; older systems get the yellow capture border back, and the background still refreshes.
- Minimised or fully hidden windows stop the render loop — Chromium behaviour, and a power saving one.
- Switching WE scene / web wallpapers relies on WE itself (`wallpaper64.exe -control openWallpaper`); without WE installed or running, those two types only show a hint. The property sheet and local files keep working.
- Playback speed / volume apply to HTML `<video>` wallpapers and animations; scene wallpapers are tuned inside WE.
- The elysia395 branch is still a placeholder: it appears once the plugin is detected, and settings takeover/migration is in progress.

## Development

Bug reports, compatibility notes, doc fixes and PRs are welcome. Please include host/plugin versions, OS, GPU, reproduction steps and redacted logs.

- [Implementation notes](docs/DETAIL.md): compositing, screen-space mapping, the five-layer guard, shader parameters, module data shapes.
- Builds: `node scripts/build-client.mjs`, `node scripts/build-capture.mjs`.

## Credits

- **Wallpaper Engine** (Steam AppID `431960`): the property sheet follows its interaction model and parameter semantics.
- **[elysia395/dsh-wallpaper-engine](https://github.com/elysia395/dsh-wallpaper-engine)**: the compatibility target of the third background module.
- Everyone who filed issues and sent PRs ❤️

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

| Path | Role |
| --- | --- |
| `index.js` | Host entry: `/liquid-glass/*` routes (including `/we/open`), capture scheduling, module state, update check |
| `host/` | Host capabilities: wallpaper detection, WE bridge (scan / preview / switch), persistent capture helper, PowerShell fallback, run wrapper, update check |
| `client/src/` | Front-end sources, concatenated `01` → `14` (13 = wallpaper centre / colour modes, 14 = audio matrix) |
| `client/client.js` | Build output, loaded by DSH via `exports["./client"]` |
| `tools/capture/lg-capture.cpp` | Native capture/compositing helper (WGC + GDI+) |
| `bin/lg-capture.exe` | Prebuilt helper shipped with the plugin |
| `docs/` | Implementation notes and screenshots |
| `scripts/` | The two build scripts |

## License

[Apache License 2.0](LICENSE) © DSH Theme Engine contributors

Released under Apache-2.0: commercial use, modification and redistribution are allowed with copyright and licence notices retained. See [LICENSE](LICENSE) and [NOTICE](NOTICE).