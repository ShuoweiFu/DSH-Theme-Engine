// lg-capture — Windows Graphics Capture based wallpaper compositor for the
// dsh-liquid-glass bundle.
//
// Why this exists: PrintWindow(Progman, PW_RENDERFULLCONTENT) occasionally
// hands back the desktop icon layer with a black wallpaper layer (the desktop
// wallpaper is drawn through DirectComposition and DWM does not always have a
// composited frame to replay). The plugin then published a near-black frame
// and the panel background flashed. WGC captures the window's actual content
// through DWM's capture pipeline, so the wallpaper layer arrives consistently.
//
// Protocol (identical to the previous LgCap helper, one JSON line per command):
//   --serve                     read commands from stdin, answer on stdout
//   "probe"                     cheap window enumeration fingerprint
//   "1 <out.jpg>"               capture desktop + windows hidden behind the DSH
//   "0 <out.jpg>"               capture the desktop layer only
//   <out.jpg> 1|0               one-shot capture (same as above)
//
// Build: clang++ -std=c++20 -O2 -o lg-capture.exe lg-capture.cpp \
//        -ld3d11 -ldxgi -lole32 -luuid -lruntimeobject -lgdiplus -lgdi32 -luser32

#define _WIN32_WINNT 0x0A00
#define WIN32_LEAN_AND_MEAN

#include <windows.h>
#include <shellapi.h>
#include <algorithm>
#include <atomic>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <iostream>
#include <cwchar>
#include <map>
#include <memory>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

#include <d3d11.h>
#include <gdiplus.h>
#include <inspectable.h>
#include <roapi.h>
#include <winstring.h>

#include <windows.foundation.h>
#include <windows.graphics.h>
#include <windows.graphics.capture.h>
#include <windows.graphics.directx.direct3d11.h>
#include <windows.graphics.directx.direct3d11.interop.h>

#include <windows.graphics.capture.interop.h>

#pragma comment(lib, "d3d11.lib")
#pragma comment(lib, "gdiplus.lib")

namespace WGC = ABI::Windows::Graphics::Capture;
namespace WGDevice = ABI::Windows::Graphics::DirectX::Direct3D11;
namespace WGDX = Windows::Graphics::DirectX::Direct3D11;
namespace WGPixel = ABI::Windows::Graphics::DirectX;

// ---------------------------------------------------------------------------
// Minimal COM ownership
// ---------------------------------------------------------------------------

template <class T>
struct Com {
  T* p = nullptr;
  Com() = default;
  Com(const Com&) = delete;
  Com& operator=(const Com&) = delete;
  Com(Com&& other) noexcept : p(other.p) { other.p = nullptr; }
  Com& operator=(Com&& other) noexcept {
    if (this != &other) {
      reset();
      p = other.p;
      other.p = nullptr;
    }
    return *this;
  }
  explicit operator bool() const { return p != nullptr; }
  ~Com() { reset(); }
  void reset() {
    if (p) {
      p->Release();
      p = nullptr;
    }
  }
  T* operator->() const { return p; }
  T** put() {
    reset();
    return &p;
  }
  bool ok() const { return p != nullptr; }
  HRESULT as(REFIID iid, void** out) const {
    if (!p) return E_POINTER;
    return p->QueryInterface(iid, out);
  }
  template <class U>
  Com<U> cast() const {
    Com<U> result;
    if (p) p->QueryInterface(__uuidof(U), (void**)&result.p);
    return result;
  }
};

// ---------------------------------------------------------------------------
// WinRT string + activation helpers
// ---------------------------------------------------------------------------

template <class I>
bool activate(const wchar_t* className, Com<I>& out) {
  // The caller may reuse a Com<> slot: release whatever it held before the
  // activation factory overwrites the pointer, otherwise the previous WinRT
  // object leaks on every call.
  out.reset();
  HSTRING_HEADER header;
  HSTRING name = nullptr;
  if (FAILED(WindowsCreateStringReference(className, (UINT32)wcslen(className), &header, &name))) return false;
  return SUCCEEDED(RoGetActivationFactory(name, __uuidof(I), (void**)&out.p));
}

static std::string toUtf8(const std::wstring& text) {
  if (text.empty()) return std::string();
  int needed = WideCharToMultiByte(CP_UTF8, 0, text.c_str(), (int)text.size(), nullptr, 0, nullptr, nullptr);
  std::string out((size_t)needed, '\0');
  WideCharToMultiByte(CP_UTF8, 0, text.c_str(), (int)text.size(), out.data(), needed, nullptr, nullptr);
  return out;
}

/**
 * Decode a UTF-8 command-line path into UTF-16. The old code widened the
 * narrow bytes one-for-one (std::wstring(begin, end)), which turned every
 * non-ASCII byte into a separate Latin-1 char, so a Chinese folder name never
 * resolved and the capture came back black.
 */
static std::wstring utf8ToWide(const std::string& text) {
  if (text.empty()) return std::wstring();
  int needed = MultiByteToWideChar(CP_UTF8, 0, text.c_str(), (int)text.size(), nullptr, 0);
  if (needed <= 0) return std::wstring();
  std::wstring out((size_t)needed, L'\0');
  MultiByteToWideChar(CP_UTF8, 0, text.c_str(), (int)text.size(), out.data(), needed);
  return out;
}

static std::string esc(const std::wstring& text, size_t limit = 60) {
  size_t cutLen = std::min(text.size(), limit);
  // Don't truncate in the middle of a surrogate pair: the high half alone is
  // not valid UTF-8 and shows up as a replacement glyph (emoji turned to ??).
  if (cutLen > 0 && cutLen < text.size() && text[cutLen - 1] >= 0xD800 && text[cutLen - 1] <= 0xDBFF) cutLen++;
  std::wstring cut = text.substr(0, cutLen);
  std::string out;
  out.reserve(cut.size() * 3);
  std::wstring pending;
  auto flush = [&out, &pending]() {
    if (!pending.empty()) {
      out += toUtf8(pending);
      pending.clear();
    }
  };
  for (wchar_t wc : cut) {
    if (wc == L'"' || wc == L'\\') {
      flush();
      out.push_back('\\');
      out.push_back((char)wc);
    } else if (wc < 0x20) {
      flush();
      out.push_back(' ');
    } else if (wc < 0x80) {
      flush();
      out.push_back((char)wc);
    } else {
      // Convert whole runs at once so surrogate pairs stay together.
      pending.push_back(wc);
    }
  }
  flush();
  return out;
}

static std::string nowJson(bool ok, const std::string& body) {
  return std::string("{\"ok\":") + (ok ? "true" : "false") + (body.empty() ? "" : "," + body) + "}";
}

static std::string errJson(const std::string& message) {
  return nowJson(false, "\"error\":\"" + message + "\"");
}

// Fixed six decimals, locale-independent. std::to_string(...).substr(0, 6)
// rounded the string itself, so 0.047619 became "0.0476" and any value below
// 0.0001 lost its significant digits entirely.
static std::string fixed6(double value) {
  char buffer[32];
  std::snprintf(buffer, sizeof(buffer), "%.6f", value);
  return buffer;
}

static void setDpiAware() {
  using Fn = BOOL(WINAPI*)(DPI_AWARENESS_CONTEXT);
  HMODULE user32 = GetModuleHandleW(L"user32.dll");
  auto set = user32 ? (Fn)GetProcAddress(user32, "SetProcessDpiAwarenessContext") : nullptr;
  if (set) {
    set(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
    return;
  }
  SetProcessDPIAware();
}

// ---------------------------------------------------------------------------
// Window enumeration
// ---------------------------------------------------------------------------

struct Win {
  HWND handle = nullptr;
  std::wstring cls;
  std::wstring title;
  DWORD pid = 0;
  RECT rect{0, 0, 0, 0};
  bool visible = false;
  int x() const { return rect.left; }
  int y() const { return rect.top; }
  int w() const { return rect.right - rect.left; }
  int h() const { return rect.bottom - rect.top; }
};

static BOOL CALLBACK collectWindow(HWND handle, LPARAM param) {
  auto* list = reinterpret_cast<std::vector<Win>*>(param);
  Win w;
  w.handle = handle;
  wchar_t buffer[512];
  buffer[0] = 0;
  GetClassNameW(handle, buffer, 512);
  w.cls = buffer;
  buffer[0] = 0;
  GetWindowTextW(handle, buffer, 512);
  w.title = buffer;
  GetWindowRect(handle, &w.rect);
  DWORD pid = 0;
  GetWindowThreadProcessId(handle, &pid);
  w.pid = pid;
  w.visible = IsWindowVisible(handle) != 0;
  list->push_back(std::move(w));
  return TRUE;
}

static std::vector<Win> listWindows() {
  std::vector<Win> list;
  list.reserve(256);
  EnumWindows(collectWindow, (LPARAM)&list);
  return list;
}

static const wchar_t* const kSkipClasses[] = {
    L"Progman", L"WorkerW", L"Shell_TrayWnd", L"Shell_SecondaryTrayWnd",
    L"Windows.UI.Core.CoreWindow", L"ApplicationFrameWindow",
    L"ApplicationManager_DesktopShellWindow", L"MultitaskingViewFrame",
    L"ForegroundStaging", L"XamlExplorerHostIslandWindow",
    L"Chrome_WidgetWin_0", L"IME", L"MSCTFIME UI", L"Default IME",
    L"TaskManagerWindow", L"NotifyIconOverflowWindow", L"TopLevelWindowForOverflowXamlIsland",
    L"Windows.Internal.Shell.TabProxyWindow", L"Windows.Internal.Shell.ShellHostWindow",
};

static bool isSkipClass(const std::wstring& cls) {
  for (const wchar_t* skip : kSkipClasses)
    if (cls == skip) return true;
  return false;
}

static int indexOfDsh(const std::vector<Win>& list, int& dshIndex) {
  dshIndex = -1;
  for (size_t i = 0; i < list.size(); i++) {
    const Win& c = list[i];
    if (dshIndex < 0 && c.cls == L"Chrome_WidgetWin_1" && c.title.find(L"DeepSeek Harness") != std::wstring::npos && c.w() > 300 &&
        c.h() > 300) {
      dshIndex = (int)i;
    }
  }
  return (int)list.size();
}

static int findProgman(const std::vector<Win>& list) {
  for (size_t i = 0; i < list.size(); i++)
    if (list[i].cls == L"Progman") return (int)i;
  return -1;
}

// ---------------------------------------------------------------------------
// Graphics capture session
// ---------------------------------------------------------------------------

class Capture {
 public:
  bool init() {
    if (device_) return true;
    UINT flags = D3D11_CREATE_DEVICE_BGRA_SUPPORT;
    D3D_FEATURE_LEVEL levels[] = {D3D_FEATURE_LEVEL_11_1, D3D_FEATURE_LEVEL_11_0, D3D_FEATURE_LEVEL_10_1};
    D3D_FEATURE_LEVEL got{};
    HRESULT hr = D3D11CreateDevice(nullptr, D3D_DRIVER_TYPE_HARDWARE, nullptr, flags, levels, 3,
                                   D3D11_SDK_VERSION, d3d_.put(), &got, context_.put());
    if (FAILED(hr)) {
      error_ = "D3D11CreateDevice";
      return false;
    }
    Com<IDXGIDevice> dxgi = d3d_.cast<IDXGIDevice>();
    if (!dxgi.ok()) return false;
    Com<::IInspectable> inspectable;
    if (FAILED(CreateDirect3D11DeviceFromDXGIDevice(dxgi.p, &inspectable.p))) {
      error_ = "CreateDirect3D11DeviceFromDXGIDevice";
      return false;
    }
    device_ = inspectable.cast<WGDevice::IDirect3DDevice>();
    if (!device_.ok()) {
      error_ = "IDirect3DDevice cast";
      return false;
    }
    if (!activate(L"Windows.Graphics.Capture.GraphicsCaptureItem", interop_)) {
      error_ = "activation GraphicsCaptureItem";
      return false;
    }
    return true;
  }

  const std::string& error() const { return error_; }

  /** Latest frame of a window (or the whole primary monitor when hwnd is null). */
  struct Stream {
    bool monitor = false;
    HWND hwnd = nullptr;
    Com<WGC::IGraphicsCaptureItem> item;
    Com<WGC::IDirect3D11CaptureFramePool> pool;
    Com<WGC::IGraphicsCaptureSession> session;
    Com<ID3D11Texture2D> texture;
    Com<ID3D11Texture2D> staging;
    int width = 0;
    int height = 0;
    bool started = false;
    int64_t lastGrab = 0;
    // What Windows said about the yellow "capturing" border.
    bool borderWanted = true;
    bool borderless = false;
    HRESULT borderHr = S_OK;
    // Set every time acquire() copies a new frame into `texture`.
    bool fresh = false;
    ULONGLONG lastFrame = 0;
  };

  Stream* streamFor(HWND hwnd, bool monitor) {
    Stream& s = monitor ? monitorStream_ : windows_[hwnd];
    s.monitor = monitor;
    s.hwnd = hwnd;
    return &s;
  }

  std::string hrText(const char* where, HRESULT hr) {
    char buffer[80];
    snprintf(buffer, sizeof(buffer), "%s 0x%08x", where, (unsigned)hr);
    return std::string(buffer);
  }

  bool ensure(Stream& s, int timeoutMs) {
    int w = 0, h = 0;
    if (!measure(s, w, h)) return false;
    if (s.started && s.pool.ok() && w == s.width && h == s.height) return true;

    s.session.reset();
    s.pool.reset();
    s.texture.reset();
    s.staging.reset();
    s.width = w;
    s.height = h;

    ABI::Windows::Graphics::SizeInt32 size{};
    size.Width = w;
    size.Height = h;

    if (!activate(L"Windows.Graphics.Capture.Direct3D11CaptureFramePool", poolStatics_)) {
      error_ = "activation Direct3D11CaptureFramePool";
      return false;
    }
    HRESULT hr = poolStatics_->CreateFreeThreaded(device_.p, WGPixel::DirectXPixelFormat_B8G8R8A8UIntNormalized, 2, size,
                                                 s.pool.put());
    if (FAILED(hr)) {
      error_ = hrText("CreateFreeThreaded", hr);
      return false;
    }
    hr = s.pool->CreateCaptureSession(s.item.p, s.session.put());
    if (FAILED(hr)) {
      error_ = hrText("CreateCaptureSession", hr);
      return false;
    }
    Com<WGC::IGraphicsCaptureSession2> session2 = s.session.cast<WGC::IGraphicsCaptureSession2>();
    if (session2.ok()) session2->put_IsCursorCaptureEnabled(false);
    // Ask Windows to skip the yellow "you are being captured" border. On builds
    // where the app lacks the capability this is ignored, so record what the
    // session actually reports so the host/user can see it.
    Com<WGC::IGraphicsCaptureSession3> session3 = s.session.cast<WGC::IGraphicsCaptureSession3>();
    if (session3.ok()) {
      boolean required = TRUE;
      session3->get_IsBorderRequired(&required);
      s.borderWanted = required != FALSE;
      s.borderHr = session3->put_IsBorderRequired(FALSE);
      boolean after = TRUE;
      session3->get_IsBorderRequired(&after);
      s.borderless = SUCCEEDED(s.borderHr) && after == FALSE;
    } else {
      s.borderWanted = true;
      s.borderless = false;
      s.borderHr = E_NOINTERFACE;
    }
    hr = s.session->StartCapture();
    if (FAILED(hr)) {
      error_ = hrText("StartCapture", hr);
      return false;
    }
    s.started = true;

    // Wait for the first frame so a caller never sees an empty texture.
    if (!acquire(s, timeoutMs > 0 ? timeoutMs : 400)) {
      error_ = "no first frame within " + std::to_string(timeoutMs > 0 ? timeoutMs : 400) + " ms";
      return false;
    }
    return true;
  }

  bool measure(Stream& s, int& w, int& h) {
    if (!s.item.ok()) {
      if (!interop_.ok()) return false;
      if (!s.hwnd) {
        HWND desktop = GetDesktopWindow();
        Com<WGC::IGraphicsCaptureItem> item;
        if (FAILED(interop_->CreateForMonitor(MonitorFromWindow(desktop, MONITOR_DEFAULTTOPRIMARY), __uuidof(WGC::IGraphicsCaptureItem),
                                              (void**)&item.p)))
          return false;
        s.item = std::move(item);
      } else {
        Com<WGC::IGraphicsCaptureItem> item;
        HRESULT itemHr = interop_->CreateForWindow(s.hwnd, __uuidof(WGC::IGraphicsCaptureItem), (void**)&item.p);
        if (FAILED(itemHr)) {
          error_ = hrText("CreateForWindow", itemHr);
          return false;
        }
        s.item = std::move(item);
      }
    }
    ABI::Windows::Graphics::SizeInt32 size{};
    HRESULT sizeHr = s.item->get_Size(&size);
    if (FAILED(sizeHr)) {
      error_ = hrText("get_Size", sizeHr);
      return false;
    }
    w = size.Width;
    h = size.Height;
    return w > 0 && h > 0;
  }

  bool acquire(Stream& s, int timeoutMs) {
    ULONGLONG deadline = GetTickCount64() + (ULONGLONG)(timeoutMs < 0 ? 0 : timeoutMs);
    for (;;) {
      Com<WGC::IDirect3D11CaptureFrame> frame;
      HRESULT hr = s.pool.ok() ? s.pool->TryGetNextFrame(&frame.p) : E_FAIL;
      if (hr == S_OK && frame.ok()) {
        Com<WGDevice::IDirect3DSurface> surface;
        frame->get_Surface(&surface.p);
        if (surface.ok()) {
          auto access = surface.cast<WGDX::IDirect3DDxgiInterfaceAccess>();
          Com<ID3D11Texture2D> source;
          if (access.ok() && SUCCEEDED(access->GetInterface(__uuidof(ID3D11Texture2D), (void**)&source.p)) && source.ok()) {
            D3D11_TEXTURE2D_DESC desc{};
            source->GetDesc(&desc);
            if (!s.texture.ok() || s.width != (int)desc.Width || s.height != (int)desc.Height) {
              s.texture.reset();
              s.staging.reset();
              s.width = (int)desc.Width;
              s.height = (int)desc.Height;
              D3D11_TEXTURE2D_DESC copy = desc;
              copy.Usage = D3D11_USAGE_DEFAULT;
              copy.CPUAccessFlags = 0;
              copy.BindFlags = 0;
              copy.MiscFlags = 0;
              if (FAILED(d3d_->CreateTexture2D(&copy, nullptr, s.texture.put()))) return false;
              D3D11_TEXTURE2D_DESC read = desc;
              read.Usage = D3D11_USAGE_STAGING;
              read.CPUAccessFlags = D3D11_CPU_ACCESS_READ;
              read.BindFlags = 0;
              read.MiscFlags = 0;
              if (FAILED(d3d_->CreateTexture2D(&read, nullptr, s.staging.put()))) return false;
            }
            context_->CopyResource(s.texture.p, source.p);
            s.lastGrab = GetTickCount64();
            return true;
          }
        }
        frame.reset();
      }
      if (GetTickCount64() >= deadline) return false;
      Sleep(3);
    }
  }

  /** CPU copy of the stream's latest frame (BGRA, top-down). */
  bool readback(Stream& s, std::vector<uint8_t>& pixels) {
    if (!s.texture.ok() || !s.staging.ok()) return false;
    context_->CopyResource(s.staging.p, s.texture.p);
    D3D11_MAPPED_SUBRESOURCE map{};
    if (FAILED(context_->Map(s.staging.p, 0, D3D11_MAP_READ, 0, &map))) return false;
    size_t stride = (size_t)s.width * 4;
    pixels.resize(stride * (size_t)s.height);
    for (int y = 0; y < s.height; y++) {
      memcpy(pixels.data() + stride * (size_t)y, (const uint8_t*)map.pData + map.RowPitch * (size_t)y, stride);
    }
    context_->Unmap(s.staging.p, 0);
    return true;
  }

  void drop(HWND hwnd) { windows_.erase(hwnd); }

  void dropAll() {
    windows_.clear();
    monitorStream_ = Stream{};
  }

  /**
   * Drop capture streams whose window is gone. `windows_` is append-only while
   * streaming, so every closed window used to leave its D3D textures behind
   * forever; prune on each frame build and cap the map as a backstop.
   */
  void prune(const std::vector<HWND>& live, size_t limit = 16) {
    for (auto it = windows_.begin(); it != windows_.end();) {
      if (std::find(live.begin(), live.end(), it->first) == live.end()) it = windows_.erase(it);
      else ++it;
    }
    while (windows_.size() > limit) windows_.erase(windows_.begin());
  }

  /**
   * Pull whatever frames the pool has queued (non-blocking, capped) so the
   * stream's texture really is the newest DWM composited frame before a
   * readback. Returns how many frames were consumed.
   */
  int drain(Stream& s, int max = 8) {
    int got = 0;
    for (int i = 0; i < max; i++) {
      if (!acquire(s, 0)) break;
      got++;
    }
    return got;
  }

  ID3D11Device* device() const { return d3d_.p; }

 private:
  Com<ID3D11Device> d3d_;
  Com<ID3D11DeviceContext> context_;
  Com<WGDevice::IDirect3DDevice> device_;
  Com<IGraphicsCaptureItemInterop> interop_;
  Com<WGC::IDirect3D11CaptureFramePoolStatics2> poolStatics_;
  Stream monitorStream_;
  std::map<HWND, Stream> windows_;
  std::string error_;
};

// ---------------------------------------------------------------------------
// PrintWindow fallback (old path, used when WGC refuses a window)
// ---------------------------------------------------------------------------

static bool printWindowToGdi(HWND hwnd, int x, int y, int w, int h, Gdiplus::Bitmap& canvas) {
  if (w <= 0 || h <= 0) return false;
  Gdiplus::Bitmap tile(w, h);
  {
    Gdiplus::Graphics tileGraphics(&tile);
    HDC dc = tileGraphics.GetHDC();
    BOOL ok = PrintWindow(hwnd, dc, 2);
    tileGraphics.ReleaseHDC(dc);
    if (!ok) return false;
  }
  Gdiplus::Graphics target(&canvas);
  target.DrawImage(&tile, x, y, w, h);
  return true;
}

// ---------------------------------------------------------------------------
// JPEG encoding through GDI+
// ---------------------------------------------------------------------------

static int encoderClsid(const wchar_t* mime, CLSID* clsid) {
  UINT count = 0;
  UINT size = 0;
  Gdiplus::GetImageEncodersSize(&count, &size);
  if (!size) return -1;
  std::vector<uint8_t> buffer(size);
  auto* codecs = (Gdiplus::ImageCodecInfo*)buffer.data();
  if (Gdiplus::GetImageEncoders(count, size, codecs) != Gdiplus::Ok) return -1;
  for (UINT i = 0; i < count; i++) {
    if (wcscmp(codecs[i].MimeType, mime) == 0) {
      *clsid = codecs[i].Clsid;
      return (int)i;
    }
  }
  return -1;
}

static bool saveJpeg(Gdiplus::Bitmap& canvas, const std::wstring& path, int targetW) {
  int w = (int)canvas.GetWidth();
  int h = (int)canvas.GetHeight();
  int targetH = targetW == w ? h : (int)llround((double)h * targetW / w);
  if (targetW <= 0 || targetH <= 0) return false;
  CLSID jpeg{};
  if (encoderClsid(L"image/jpeg", &jpeg) < 0) return false;
  Gdiplus::EncoderParameters params(1);
  params.Parameter[0].Guid = Gdiplus::EncoderQuality;
  params.Parameter[0].Type = Gdiplus::EncoderParameterValueTypeLong;
  params.Parameter[0].NumberOfValues = 1;
  ULONG quality = 82;
  params.Parameter[0].Value = &quality;
  if (targetW == w) return canvas.Save(path.c_str(), &jpeg, &params) == Gdiplus::Ok;
  Gdiplus::Bitmap scaled(targetW, targetH);
  {
    Gdiplus::Graphics graphics(&scaled);
    graphics.SetInterpolationMode(Gdiplus::InterpolationModeHighQualityBicubic);
    graphics.SetPixelOffsetMode(Gdiplus::PixelOffsetModeHighQuality);
    graphics.DrawImage(&canvas, 0, 0, targetW, targetH);
  }
  return scaled.Save(path.c_str(), &jpeg, &params) == Gdiplus::Ok;
}

// ---------------------------------------------------------------------------
// Compose
// ---------------------------------------------------------------------------

struct Composer {
  Capture capture;

  struct Frame {
    std::vector<uint8_t> pixels;
    int w = 0;
    int h = 0;
    std::vector<Win> used;
    std::string note;
    const char* engine = "wgc";
    double lum = 0;
    double dark = 0;
    bool borderless = false;
  };

  /**
   * Grab the desktop layer and, when `behind` is set, every window that sits
   * below the DSH window and overlaps it. All capture streams are persistent:
   * once a window has been captured it keeps its frame pool and session alive,
   * so repeated calls are cheap and always use the newest composited frame.
   */
  bool buildFrame(bool behind, Frame& f) {
    // Frames are reused by the streaming loop (33 MB per tick was pure churn),
    // so every per-frame field must start from a clean slate.
    f.used.clear();
    f.note.clear();
    f.engine = "wgc";
    std::vector<Win> list = listWindows();
    {
      std::vector<HWND> live;
      live.reserve(list.size());
      for (const Win& w : list) live.push_back((HWND)w.handle);
      capture.prune(live);
    }
    int dshIndex = -1;
    indexOfDsh(list, dshIndex);
    int progmanIndex = findProgman(list);
    if (progmanIndex < 0) {
      f.note = "Progman not found";
      return false;
    }
    if (!capture.init()) {
      f.note = "capture init: " + capture.error();
      return false;
    }

    bool haveBase = false;
    // The desktop layer is the Progman window itself (wallpaper + icons), just
    // like the old PrintWindow call, but taken through WGC so DWM always has a
    // composited frame to hand over.
    auto* desktop = capture.streamFor((HWND)list[progmanIndex].handle, false);
    if (capture.ensure(*desktop, 700)) {
      capture.drain(*desktop);
      haveBase = capture.readback(*desktop, f.pixels);
      f.w = desktop->width;
      f.h = desktop->height;
      f.borderless = desktop->borderless;
      if (!haveBase) f.note = "desktop readback failed";
    } else {
      f.note = "desktop encode failed: " + capture.error();
    }
    if (!haveBase) {
      // A monitor item is the second best base: crop it to the screen rect.
      auto* monitor = capture.streamFor(nullptr, true);
      if (capture.ensure(*monitor, 700)) {
        capture.drain(*monitor);
      }
      if (monitor->started && capture.readback(*monitor, f.pixels)) {
        f.w = monitor->width;
        f.h = monitor->height;
        haveBase = true;
        f.note = "monitor base";
        f.engine = "wgc-monitor";
        f.borderless = monitor->borderless;
      }
    }
    if (!haveBase) return false;

    if (behind && dshIndex >= 0) {
      const Win& dsh = list[dshIndex];
      for (int j = (int)list.size() - 1; j > dshIndex; j--) {
        const Win& c = list[j];
        if (!c.visible) continue;
        if (c.pid == dsh.pid) continue;
        if (c.title == dsh.title) continue;
        if (c.title.find(L"DeepSeek Harness") != std::wstring::npos) continue;
        if (isSkipClass(c.cls)) continue;
        if (c.w() < 80 || c.h() < 50) continue;
        if (c.w() * c.h() < 8000) continue;
        if (IsIconic(c.handle)) continue;
        int ox = std::max(0, std::min(dsh.x() + dsh.w(), c.x() + c.w()) - std::max(dsh.x(), c.x()));
        int oy = std::max(0, std::min(dsh.y() + dsh.h(), c.y() + c.h()) - std::max(dsh.y(), c.y()));
        if ((long long)ox * oy <= 0) continue;

        auto* stream = capture.streamFor(c.handle, false);
        std::vector<uint8_t> windowPixels;
        if (!capture.ensure(*stream, 250)) {
          capture.drop(c.handle);
          continue;
        }
        capture.drain(*stream);
        if (!capture.readback(*stream, windowPixels)) {
          // A window WGC refuses (closing, protected, ...) simply stays out of
          // the composite; the desktop layer underneath is still correct.
          capture.drop(c.handle);
          continue;
        }
        // Scale from the window's own content size to its placement rect.
        blitScaled(f.pixels, f.w, f.h, windowPixels, stream->width, stream->height, c.x(), c.y(), c.w(), c.h());
        f.used.push_back(c);
      }
    }

    // Cheap luminance sample of the composed frame: the host uses it to refuse
    // a black swap before it ever reaches the renderer.
    double sum = 0;
    int dark = 0;
    int samples = 0;
    for (int gy = 0; gy < 8; gy++) {
      int y = std::min(f.h - 1, (int)((gy + 0.5) * f.h / 8));
      for (int gx = 0; gx < 8; gx++) {
        int x = std::min(f.w - 1, (int)((gx + 0.5) * f.w / 8));
        const uint8_t* p = f.pixels.data() + ((size_t)y * (size_t)f.w + (size_t)x) * 4;
        double luma = (0.114 * p[0] + 0.587 * p[1] + 0.299 * p[2]) / 255.0;
        sum += luma;
        if (luma < 0.06) dark++;
        samples++;
      }
    }
    f.lum = samples ? sum / samples : 0;
    f.dark = samples ? (double)dark / samples : 0;
    return true;
  }

  std::string encodeFrame(Frame& f, const std::wstring& outPath, int elapsedMs) {
    Gdiplus::Bitmap canvas(f.w, f.h, f.w * 4, PixelFormat32bppRGB, f.pixels.data());
    int targetW = std::min(1600, f.w);
    if (!saveJpeg(canvas, outPath, targetW)) return errJson("save failed");
    int targetH = (int)llround((double)f.h * targetW / f.w);
    std::string body = payload(targetW, targetH, elapsedMs, f.used, f.engine, f.note);
    body += ",\"lum\":" + fixed6(f.lum);
    body += ",\"dark\":" + fixed6(f.dark);
    body += ",\"borderless\":";
    body += f.borderless ? "true" : "false";
    return nowJson(true, body);
  }

  /** On-demand capture: one composed frame, written straight to `outPath`. */
  std::string compose(const std::wstring& outPath, bool behind) {
    if (outPath.empty()) return errJson("missing output path");
    RECT screen{};
    screen.right = GetSystemMetrics(SM_CXSCREEN);
    screen.bottom = GetSystemMetrics(SM_CYSCREEN);
    int screenW = screen.right;
    int screenH = screen.bottom;
    if (screenW <= 0 || screenH <= 0) return errJson("bad screen size");
    ULONGLONG started = GetTickCount64();

    Frame frame;
    if (!buildFrame(behind, frame)) {
      // No WGC base: fall back to the legacy PrintWindow desktop.
      std::vector<Win> list = listWindows();
      int progmanIndex = findProgman(list);
      if (progmanIndex < 0) return errJson("Progman not found");
      Gdiplus::Bitmap legacy(screenW, screenH);
      Gdiplus::Graphics graphics(&legacy);
      graphics.Clear(Gdiplus::Color(24, 24, 24));
      if (!printWindowToGdi(list[progmanIndex].handle, 0, 0, screenW, screenH, legacy))
        return errJson("desktop capture failed: " + (frame.note.empty() ? std::string("wgc") : frame.note));
      int targetW = std::min(1600, screenW);
      if (!saveJpeg(legacy, outPath, targetW)) return errJson("save failed");
      return nowJson(true, payload(targetW, 0, (int)(GetTickCount64() - started), {}, "printwindow", "printwindow fallback"));
    }
    return encodeFrame(frame, outPath, (int)(GetTickCount64() - started));
  }

  static void blitScaled(std::vector<uint8_t>& dst, int dw, int dh, const std::vector<uint8_t>& src, int sw, int sh, int dx, int dy,
                         int dwin, int dhin) {
    if (sw <= 0 || sh <= 0 || dwin <= 0 || dhin <= 0) return;
    int x0 = std::max(0, dx);
    int y0 = std::max(0, dy);
    int x1 = std::min(dw, dx + dwin);
    int y1 = std::min(dh, dy + dhin);
    for (int y = y0; y < y1; y++) {
      double sy = (double)(y - dy) * sh / dhin;
      int syi = std::min(sh - 1, std::max(0, (int)sy));
      const uint8_t* srcRow = src.data() + (size_t)syi * (size_t)sw * 4;
      uint8_t* dstRow = dst.data() + (size_t)y * (size_t)dw * 4;
      for (int x = x0; x < x1; x++) {
        double sx = (double)(x - dx) * sw / dwin;
        int sxi = std::min(sw - 1, std::max(0, (int)sx));
        const uint8_t* s = srcRow + (size_t)sxi * 4;
        uint8_t* d = dstRow + (size_t)x * 4;
        // DWM/WGC frames are premultiplied BGRA. Compositing them as opaque
        // turned every rounded corner and every transparent window region into
        // a black fringe; source-over keeps the desktop visible through them.
        const int a = s[3];
        if (a >= 254) {
          d[0] = s[0];
          d[1] = s[1];
          d[2] = s[2];
        } else if (a > 0) {
          const int inv = 255 - a;
          d[0] = (uint8_t)std::min(255, (int)s[0] + d[0] * inv / 255);
          d[1] = (uint8_t)std::min(255, (int)s[1] + d[1] * inv / 255);
          d[2] = (uint8_t)std::min(255, (int)s[2] + d[2] * inv / 255);
        }
        d[3] = 255;
      }
    }
  }

  static std::string payload(int width, int height, int ms, const std::vector<Win>& apps, const char* engine, const std::string& note = std::string()) {
    std::string body = "\"width\":" + std::to_string(width) + ",\"height\":" + std::to_string(height);
    body += ",\"ms\":{\"shell\":0,\"apps\":" + std::to_string(ms) + ",\"scale\":0,\"save\":0}";
    body += ",\"engine\":\"" + std::string(engine) + "\"";
    if (!note.empty()) body += ",\"note\":\"" + note + "\"";
    body += ",\"appsBehind\":";
    body += apps.empty() ? "false" : "true";
    body += ",\"apps\":[";
    for (size_t i = 0; i < apps.size(); i++) {
      const Win& a = apps[i];
      if (i) body += ',';
      body += "{\"cls\":\"" + esc(a.cls) + "\",\"title\":\"" + esc(a.title) + "\"";
      body += ",\"x\":" + std::to_string(a.x()) + ",\"y\":" + std::to_string(a.y());
      body += ",\"w\":" + std::to_string(a.w()) + ",\"h\":" + std::to_string(a.h()) + "}";
    }
    body += "]";
    return body;
  }
};

// ---------------------------------------------------------------------------
// Live streaming engine
//
// One persistent session per window (kept alive by Capture::Stream), a worker
// thread that keeps pulling whatever frames the free-threaded pool has, and a
// JPEG written to the host's stage path whenever the picture actually changed.
// The host renames the stage file into place, so a reader never sees a partial
// image.
// ---------------------------------------------------------------------------

static std::mutex g_out;

static void emit(const std::string& line) {
  std::lock_guard<std::mutex> lock(g_out);
  fwrite(line.data(), 1, line.size(), stdout);
  fputc('\n', stdout);
  fflush(stdout);
}

struct Engine {
  Composer* composer = nullptr;
  std::mutex busy;  // serialises capture work with on-demand capture commands
  std::thread worker;
  std::atomic<bool> stop{false};
  bool running = false;
  std::atomic<int> fps{8};
  bool behind = true;
  bool force = false;  // publish every tick even when the picture looks the same
  std::wstring path;
  std::vector<uint8_t> hash;
  uint64_t seq = 0;
  int darkRun = 0;
  double lastLum = -1;
  Composer::Frame frame;  // reused: its pixel buffer is the 33 MB allocation

  void loop() {
    ULONGLONG next = GetTickCount64();
    while (!stop.load()) {
      // Re-read every pass: a `fps` command retunes the engine in place, so the
      // frontend can ask for a cheaper stream without tearing the capture
      // session down (rebuilding it would flash the capture border).
      const ULONGLONG interval = (ULONGLONG)std::max(40, 1000 / std::max(1, fps.load()));
      const ULONGLONG now = GetTickCount64();
      if (now >= next) {
        next = now + interval;
        std::lock_guard<std::mutex> lock(busy);
        const ULONGLONG started = GetTickCount64();
        if (composer->buildFrame(behind, frame)) {
          // DWM sometimes hands back a desktop frame without the wallpaper
          // layer: icons are there but everything around them is black. That
          // frame has roughly 1/20th of the normal light, so hold the picture
          // the user already sees and retry on the next tick. Darkness is only
          // accepted once it persists for about a second, which keeps a real
          // switch to a dark wallpaper from being blocked forever.
          const bool dark = frame.lum >= 0 && frame.lum < 0.05;
          darkRun = dark ? darkRun + 1 : 0;
          if (dark && darkRun < 8) continue;
          // 16x16 luminance fingerprint: skip the JPEG encode when a still
          // desktop produced the exact same picture as last time.
          std::vector<uint8_t> sig(256);
          for (int gy = 0; gy < 16; gy++) {
            int y = std::min(frame.h - 1, (int)((gy + 0.5) * frame.h / 16));
            for (int gx = 0; gx < 16; gx++) {
              int x = std::min(frame.w - 1, (int)((gx + 0.5) * frame.w / 16));
              const uint8_t* p = frame.pixels.data() + ((size_t)y * (size_t)frame.w + (size_t)x) * 4;
              sig[(size_t)gy * 16 + (size_t)gx] = (uint8_t)(0.114 * p[0] + 0.587 * p[1] + 0.299 * p[2]);
            }
          }
          if (force || sig != hash) {
            hash = std::move(sig);
            const int elapsed = (int)(GetTickCount64() - started);
            std::string written = composer->encodeFrame(frame, path, elapsed);
            if (written.find("\"ok\":true") != std::string::npos) {
              seq++;
              lastLum = frame.lum;
              std::string event = "{\"event\":\"frame\",\"seq\":" + std::to_string(seq);
              event += ",\"lum\":" + fixed6(frame.lum);
              event += ",\"dark\":" + fixed6(frame.dark);
              event += ",\"borderless\":";
              event += frame.borderless ? "true" : "false";
              event += ",\"apps\":" + std::to_string(frame.used.size());
              event += ",\"w\":" + std::to_string(frame.w) + ",\"h\":" + std::to_string(frame.h);
              event += ",\"ms\":" + std::to_string(elapsed) + "}";
              emit(event);
            }
          }
        }
      }
      // GetTickCount64 ticks every ~15.6 ms, so Sleep(4) burned CPU while
      // still rounding to the same tick. Sleep until the next frame instead,
      // capped at one frame so `stop` / `fps` commands stay responsive.
      const ULONGLONG wake = GetTickCount64();
      if (wake < next) Sleep((DWORD)std::min<ULONGLONG>(next - wake, 16));
      else Sleep(1);
    }
  }

  bool start(int targetFps, bool composeBehind, bool alwaysPublish, const std::wstring& outPath) {
    halt();
    fps.store(std::max(1, std::min(30, targetFps)));
    behind = composeBehind;
    force = alwaysPublish;
    path = outPath;
    hash.clear();
    seq = 0;
    stop = false;
    worker = std::thread([this] { loop(); });
    running = true;
    return true;
  }

  void halt() {
    if (!running) return;
    stop = true;
    if (worker.joinable()) worker.join();
    running = false;
    stop = false;
  }
};

// ---------------------------------------------------------------------------
// Probe
// ---------------------------------------------------------------------------

static std::string probe() {
  std::vector<Win> list = listWindows();
  std::wstring text;
  bool dsh = false;
  int active = 0;
  for (const Win& c : list) {
    if (c.visible && !IsIconic(c.handle) && c.w() >= 40 && c.h() >= 30) active++;
  }
  for (const Win& c : list) {
    if (isSkipClass(c.cls)) continue;
    if (!c.visible) continue;
    if (c.w() < 40 || c.h() < 30) continue;
    if (IsIconic(c.handle)) continue;
    if (c.cls == L"Chrome_WidgetWin_1" && c.title.find(L"DeepSeek Harness") != std::wstring::npos && c.w() > 300) dsh = true;
    text += c.cls + L"|" + std::to_wstring(c.pid) + L"|" + std::to_wstring(c.x()) + L"|" + std::to_wstring(c.y()) + L"|" +
            std::to_wstring(c.w()) + L"|" + std::to_wstring(c.h()) + L";";
  }
  uint32_t hash = 2166136261u;
  for (char ch : toUtf8(text)) {
    hash ^= (uint8_t)ch;
    hash *= 16777619u;
  }
  char hex[16];
  snprintf(hex, sizeof(hex), "%08x", hash);
  std::string body = "\"fingerprint\":\"" + std::string(hex) + "\",\"active\":" + std::to_string(active);
  body += ",\"dsh\":";
  body += dsh ? "true" : "false";
  return nowJson(true, body);
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

int main(int argc, char** argv) {
  setDpiAware();
  ULONG_PTR token = 0;
  Gdiplus::GdiplusStartupInput input;
  if (Gdiplus::GdiplusStartup(&token, &input, nullptr) != Gdiplus::Ok) {
    fputs(errJson("GDI+ startup failed\n").c_str(), stdout);
    return 1;
  }
  RoInitialize(RO_INIT_MULTITHREADED);

  auto* composer = new Composer();

  auto oneShot = [&](const std::string& rest, bool behind) -> std::string {
    return composer->compose(utf8ToWide(rest), behind);
  };

  if (argc >= 2 && std::string(argv[1]) == "--serve") {
    Engine engine;
    engine.composer = composer;
    std::string line;
    while (std::getline(std::cin, line)) {
      size_t begin = line.find_first_not_of(" \t\r\n");
      if (begin == std::string::npos) continue;
      size_t end = line.find_last_not_of(" \t\r\n");
      std::string command = line.substr(begin, end - begin + 1);
      if (command == "quit") break;
      std::string answer;
      if (command == "probe") {
        answer = probe();
      } else if (command.rfind("stream ", 0) == 0) {
        // stream <fps> <behind 0|1> <force 0|1> <stage path>
        std::string rest = command.substr(7);
        size_t s1 = rest.find(' ');
        size_t s2 = s1 == std::string::npos ? std::string::npos : rest.find(' ', s1 + 1);
        size_t s3 = s2 == std::string::npos ? std::string::npos : rest.find(' ', s2 + 1);
        if (s3 == std::string::npos) {
          answer = errJson("usage: stream <fps> <0|1> <0|1> <path>");
        } else {
          const int fps = atoi(rest.substr(0, s1).c_str());
          const bool behind = rest.substr(s1 + 1, s2 - s1 - 1) == "1";
          const bool force = rest.substr(s2 + 1, s3 - s2 - 1) == "1";
          const std::string path = rest.substr(s3 + 1);
          engine.start(fps > 0 ? fps : 8, behind, force, utf8ToWide(path));
          answer = nowJson(true, "\"streaming\":true,\"fps\":" + std::to_string(engine.fps.load()) + ",\"behind\":" +
                                    (engine.behind ? "true" : "false") + ",\"force\":" + (engine.force ? "true" : "false"));
        }
      } else if (command.rfind("fps ", 0) == 0) {
        // Retune the running engine in place: no session rebuild, no border
        // flash, no dropped frames.
        const int want = std::max(1, std::min(30, atoi(command.c_str() + 4)));
        engine.fps.store(want);
        answer = nowJson(true, "\"fps\":" + std::to_string(want));
      } else if (command == "stop") {
        engine.halt();
        answer = nowJson(true, "\"streaming\":false");
      } else if (command == "version") {
        answer = nowJson(true, "\"version\":\"wgc-2\"");
      } else if (command.size() > 2 && (command[0] == '0' || command[0] == '1') && command[1] == ' ') {
        std::lock_guard<std::mutex> lock(engine.busy);
        answer = oneShot(command.substr(2), command[0] == '1');
      } else if (command.find(' ') != std::string::npos) {
        size_t space = command.rfind(' ');
        std::string path = command.substr(0, space);
        std::string flag = command.substr(space + 1);
        std::lock_guard<std::mutex> lock(engine.busy);
        answer = oneShot(path, flag == "1");
      } else {
        answer = errJson("unknown command");
      }
      emit(answer);
    }
    engine.halt();
    return 0;
  }

  // One-shot: <out> [behind]. argv[] is decoded in the process ANSI code page,
  // so a non-ASCII output path would be mangled before it ever reaches GDI+;
  // read the UTF-16 command line instead.
  int wideArgc = 0;
  LPWSTR* wideArgv = CommandLineToArgvW(GetCommandLineW(), &wideArgc);
  std::wstring out;
  bool behind = false;
  if (wideArgv) {
    if (wideArgc >= 2) out = wideArgv[1];
    behind = wideArgc >= 3 && std::wstring(wideArgv[2]) == L"1";
    LocalFree(wideArgv);
  }
  if (out.empty()) {
    fputs(errJson("missing output path").c_str(), stdout);
    return 1;
  }
  if (out == L"version") {
    emit(nowJson(true, "\"version\":\"wgc-2\""));
    return 0;
  }
  std::string answer = composer->compose(out, behind);
  emit(answer);
  return 0;
}
