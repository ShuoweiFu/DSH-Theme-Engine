<div align="center">

[中文](README.md) · **[English](README.en.md)**

# DSH Theme Engine

**Your desktop sits behind glass. Your wallpapers obey you.**

[![version](https://img.shields.io/github/v/tag/ShuoweiFu/DSH-Theme-Engine?style=flat-square&label=version&color=8fd6a0)](https://github.com/ShuoweiFu/DSH-Theme-Engine/tags)
[![license](https://img.shields.io/badge/license-Apache--2.0-8fd6a0?style=flat-square)](LICENSE)
[![platform](https://img.shields.io/badge/platform-Windows%2010%2020348%2B%20%7C%2011-5a544a?style=flat-square)](#known-edges)
[![stars](https://img.shields.io/github/stars/ShuoweiFu/DSH-Theme-Engine?style=flat-square&label=stars&color=ffd84a)](https://github.com/ShuoweiFu/DSH-Theme-Engine/stargazers)

Version **v.26.11.21.175000** · Apache-2.0 · DSH Desktop on Windows only

</div>

![Interface](docs/screenshot.png)

---

## What problem this solves

DSH is square, opaque and unrelated to your desktop. This plugin does three things:

1. **Replaces the background** — a live desktop capture, a picture / video / gif you point at, or whatever Wallpaper Engine is playing right now.
2. **Lifts the interface off it** — panels, sidebar and composer all become the same sheet of glass: wide-radius blur on the GPU, text that picks black or white from the background luminance, and a caret that takes the inverse of that ink.
3. **Hands you the wallpaper controls** — a centre built against Wallpaper Engine's own property panel: library, search, type filters, alignment, position, flip, speed, volume, preset import/export.

The plugin registers no agent tools and injects no prompt text, so it **costs you zero tokens**.

## Three backgrounds, one at a time

| Module | Where the background comes from | When it exists |
| --- | --- | --- |
| Liquid glass | Live desktop capture, or a file / URL you pick | Always (built in) |
| Wallpaper engine | Your local Steam / Wallpaper Engine library; scene and web projects are played by WE, then captured | Always; a reduced shape when WE is missing |
| elysia395 compatible | [elysia395/dsh-wallpaper-engine](https://github.com/elysia395/dsh-wallpaper-engine) | Only when that plugin is detected |

They are mutually exclusive: one sheet of glass supplies the background at any moment. The **island** is not one of them — it is an independent overlay and can be on with any module.

## Thirty seconds to running

Requirements: Windows 10 20348+ / Windows 11, DSH Desktop.

```powershell
# from a release bundle
plugin_manager install_bundle target="<downloaded .tgz>"

# from source
git clone https://github.com/ShuoweiFu/DSH-Theme-Engine.git
plugin_manager install_bundle target="<absolute path to the clone>"
```

Reload the page: a **Theme Engine** row appears in the sidebar. Click it and the settings page fills the main work area.

Client-only changes need a Ctrl+R. Changes to `index.js` or `host/` need a DSH restart, otherwise the new routes simply do not exist.

## The wallpaper centre, modelled on Wallpaper Engine

The wallpaper branch is one top-to-bottom pipeline: **switch → library → property sheet → presets → local file**.

### Library

It reads Steam's `libraryfolders.vdf`, then `steamapps/workshop/431960/*/project.json` plus WE's own `config.json`, and lists video / scene / web projects as a preview grid with search and type filters. Type is labelled on every card; scene and web projects also carry a gold `WE` badge, because only WE itself can render them.

### Property sheet

One-to-one with WE's right-hand panel; edits apply to the wallpaper already on screen:

| Control | Range | What it does |
| --- | --- | --- |
| Alignment | cover / contain / stretch / pixel | How the wallpaper fills the screen; pixel scales without interpolation, for pixel art |
| Position X / Y | 0–100 | Pans under any alignment; 50/50 is centred |
| Flip X / Y | on / off | Horizontal and vertical mirror |
| Playback speed | 0.25–2.00× | Rate for video wallpapers and animations |
| Volume | 0–1 | The wallpaper's own audio track |
| Mute | on / off | Toggles `muted` only, so the video is never reloaded and never flashes |
| Reset | — | Returns every control above to its default in one click |

Alignment, position and flip are computed as UVs inside the fragment shader (`uFit`, `uPan`, `uFlip`), not in CSS — they ride the same sampling pass as the glass blur instead of opening a second render path.

### Presets

Name and save the current parameter set, load, delete, export it as JSON, or paste JSON back in — up to 24. A preset stores numbers, not the wallpaper, so it travels between machines.

### What it looks like without Wallpaper Engine

Deliberately different: **no WE, different UI**. The grid, search, type filters, "open WE" and "Steam store" buttons are not rendered at all. What remains is

- a status line saying WE was not detected
- the Steam store link, if you want to install it
- the full property sheet (local video and images honour alignment, position, flip and speed too)
- the local file picker

Nothing that looks clickable but does nothing.

### How scene and web wallpapers switch

Those two cannot be rendered by the client, so the plugin runs

```
wallpaper64.exe -control openWallpaper -file <project.json>
```

asks WE to switch, calls `invalidate()` on its cache, waits 1200 ms and re-reads WE state before capturing the desktop again. It returns `{ ok, switched, id, title, type, file }`, and the UI reports the outcome.

## Where the "black flash on loop" went

When a video loops back to 0:00, the decoder often emits a near-black frame first. The plugin uploads the current frame with `texSubImage2D` on a 110 ms timer — so that one frame blacks out the glass for a moment.

The fix is not "drop every dark frame" (that would eat night-time wallpapers and genuine fades). It reuses `isBlackSwap` from the ink detector:

- reject only when the **previous frame was bright** and this one drops under the black threshold
- never reject more than two frames in a row; the third uploads no matter how dark, so playback can never get stuck
- a dark wallpaper is dark throughout and never trips the rule

Both upload paths — WebGL and WebGPU — have the guard.

## The glass itself

- **Blur**: 13-tap Poisson-kernel Gaussian. WebGL ping-pongs it 1–4 times to build radius; WebGPU runs a dedicated WGSL pre-pass. At maximum `blur` you get a wide, smooth falloff, not a truncated CSS blur.
- **Occluded windows**: browsers, editors and players sitting under DSH are cropped by screen coordinates and pasted back behind the glass; rounded corners and transparent regions use premultiplied alpha, so no black edges. One capture costs 0.02–0.06 s and can be switched off.
- **Text**: flips between black and white by background luminance, targeting WCAG 7:1. Once you pick a colour by hand, nothing overrides it.
- **Caret**: the **inverse** of the ink — white on dark text, black on light text. CSS only exposes `caret-color`, so this is the most reliable form of it.
- **Five colour modes**: auto / light / dark / custom / intelligent. Intelligent samples the dominant colour from whatever is behind the glass and flips light/dark by luminance; switching animates over 240 ms and yields the moment you drag a slider.
- **Stored per module**: every background module keeps its own appearance values, and every colour mode keeps its own bucket inside that, so switching never overwrites the other.

## Performance: read the tier before forcing FPS

The GPU string is read once at startup (`WEBGL_debug_renderer_info`, locally, never uploaded) and mapped to a tier.

| GPU | Default tier | Backend | FPS | Dynamic resolution |
| --- | --- | --- | --- | --- |
| Intel Iris Xe / UHD / HD, AMD Radeon / Vega APU, Apple M | 🛡 iGPU safe | WebGL | 30 | ✅ |
| Unknown / VM / software (SwiftShader, llvmpipe) | 🛡 iGPU safe | WebGL | 30 | ✅ |
| GTX 10 / 16, RTX 20 / 30, RX 5000–7000, Arc A | ⚖ Balanced | WebGL | 60 | ✅ |
| RTX 40 / 50, RX 9000, Arc B, RTX A | 🔥 Beast | WebGPU (falls back to WebGL) | 144 | ❌ |

> A measured counter-example: i7-12700H + Iris Xe + 10 GB LPDDR5, frame cap lifted and dynamic resolution off — 10 minutes later the GPU sat at 96 °C and the machine blue-screened. An iGPU has no dedicated VRAM; every frame above 40 FPS is just heat.

Hence five layers of protection: over-budget frame time → lower resolution (1.0 → 0.8 → 0.65 → 0.5) → drop occlusion compositing → static translucent mask → disable; five seconds over budget or a `webglcontextlost` drops straight to the safe profile.

| Baseline (i7-12700H / Iris Xe / 2520×1680@150%) | Value |
| --- | --- |
| Frame render 1680×1119 (scale 1.0) | 16.9 ms |
| Frame render 1344×895 (scale 0.8, default) | ≈10–11 ms |
| Plugin VRAM delta | 20–25 MB |
| One capture frame (WGC + compose + JPEG) | ≈32 ms mean (8 fps cap) |
| Desktop at rest | no encoding, no repaint |

## Settings at a glance

**Appearance** (one copy per module): blur 10 px, saturation 1.4, tint 55%, frost 34% (the only thickness slider), wallpaper dim 8%, flow 0.9 (0 = render on demand), ink auto, colour mode auto, custom colour `#8ab4ff`, auto light/dark on.

**Wallpaper**: liquid glass on, WE library auto, alignment cover, position 50/50, flip off, speed 1.00×, volume 0, mute on, up to 24 presets, local files in image / video / gif / apng.

**Sound**: local playlists (mp3 / flac / wav / ogg / m4a / aac / opus, 0.25–2.0×, volume) or system audio (permission required, **analysis only, never replayed**). Energy feeds the shader live — the surface rises on bass.

**Performance**: smart preset follows the GPU, backend WebGL / WebGPU, max FPS 30 / 60 / 144 by tier, dynamic resolution on, occlusion compositing by tier, wallpaper refresh auto (8 fps stream + 0.22 s digest + 420 ms cross-fade).

## Known edges

- Maps the primary monitor only.
- Occluded UWP / DRM / minimised windows may be empty surfaces: skipped rather than pasted black, still listed in `apps`.
- Borderless capture needs Windows 11 / 10 20348+; older systems get the yellow capture border back, and the background keeps refreshing.
- Minimised windows stop the render loop — Chromium behaviour, and a power saving one.
- Switching scene / web wallpapers depends on WE itself; without WE installed or running those two types only show a hint.
- Speed and volume apply to `<video>` wallpapers and animations; scene wallpapers are tuned inside WE.
- Non-Windows platforms get no occlusion compositing — static wallpaper files only.
- The elysia395 branch is a placeholder: it appears when detected, and settings takeover/migration is still in progress.

## Ecosystem

- **Wallpaper Engine** (Steam AppID `431960`): library scanning, project typing and property semantics all follow it; scene and web wallpapers are played by it.
- **[elysia395/dsh-wallpaper-engine](https://github.com/elysia395/dsh-wallpaper-engine)**: the compatibility target of the third module. Both can be installed; only one supplies the background at a time.

## Development

```powershell
pnpm build:client    # client/src/*.js → client/client.js (Node.js only, no third-party deps)
pnpm build:capture   # tools/capture/lg-capture.cpp → bin/lg-capture.exe (needs clang++, override with LG_CLANG)
```

| Path | Role |
| --- | --- |
| `index.js` | Host entry: `/liquid-glass/*` routes (including `/we/open`), capture scheduling, module state, update check |
| `host/` | Wallpaper detection, WE bridge (scan / preview / switch), persistent capture helper, PowerShell fallback, update check |
| `client/src/` | Front-end sources concatenated `01` → `14` (13 = wallpaper centre and colour modes, 14 = audio matrix) |
| `client/client.js` | Build output, loaded by DSH through `exports["./client"]` |
| `tools/capture/lg-capture.cpp` | Native capture / compositing helper (WGC + GDI+) |
| `bin/lg-capture.exe` | Prebuilt helper shipped with the plugin |
| `docs/DETAIL.md` | Compositing, screen-space mapping, the five-layer guard, shader parameters, module data shapes |

Please include host/plugin versions, OS, GPU, reproduction steps and redacted logs in issues.

## License

[Apache License 2.0](LICENSE) © DSH Theme Engine contributors

Commercial use, modification and redistribution are allowed with copyright and licence notices retained. See [LICENSE](LICENSE) and [NOTICE](NOTICE).