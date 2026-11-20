// wgc-probe —one-shot Windows.Graphics.Capture probe for dsh-liquid-glass.
//
//   wgc-probe <window-handle-in-decimal|display> <out.bmp>
//
// Captures a single frame of a window (any HWND, including occluded ones) or of
// the primary display, writes a 32-bit BMP and prints one JSON line with size,
// mean luminance and timing so a caller can tell black frames from real ones.
#include <windows.h>
#include <d3d11.h>
#include <dxgi1_6.h>
#include <stdio.h>
#include <string.h>

#include <roapi.h>
#include <winstring.h>
#include <windows.graphics.capture.h>
#include <windows.graphics.capture.interop.h>
#include <windows.graphics.directx.direct3d11.h>
#include <windows.graphics.directx.direct3d11.interop.h>

using namespace ABI::Windows::Graphics::Capture;
using namespace ABI::Windows::Graphics::DirectX;
using namespace ABI::Windows::Graphics::DirectX::Direct3D11;

namespace {

template <class T>
struct Com {
  T* p = nullptr;
  Com() = default;
  Com(const Com&) = delete;
  Com& operator=(const Com&) = delete;
  ~Com() { if (p) p->Release(); }
  T** operator&() { return &p; }
  T* operator->() const { return p; }
  T* get() const { return p; }
  explicit operator bool() const { return p != nullptr; }
  void reset() { if (p) { p->Release(); p = nullptr; } }
  HRESULT as(REFIID iid, void** out) {
    if (!p) return E_POINTER;
    return p->QueryInterface(iid, out);
  }
};

void jsonEscape(const char* in, char* out, size_t cap) {
  size_t o = 0;
  for (size_t i = 0; in[i] && o + 2 < cap; i++) {
    char c = in[i];
    if (c == '"' || c == '\\') { out[o++] = '\\'; out[o++] = c; }
    else if ((unsigned char)c < 0x20) { out[o++] = ' '; }
    else out[o++] = c;
  }
  out[o] = 0;
}

bool writeBmp(const char* path, const unsigned char* bgra, int w, int h, int pitch) {
  FILE* f = fopen(path, "wb");
  if (!f) return false;
  const int rowBytes = w * 4;
  const int imageBytes = rowBytes * h;
  unsigned char header[54] = {0};
  header[0] = 'B';
  header[1] = 'M';
  const unsigned int fileBytes = 54u + (unsigned int)imageBytes;
  memcpy(header + 2, &fileBytes, 4);
  const unsigned int pixelOffset = 54;
  memcpy(header + 10, &pixelOffset, 4);
  const unsigned int dibSize = 40;
  memcpy(header + 14, &dibSize, 4);
  const int width = w;
  memcpy(header + 18, &width, 4);
  const int height = -h; // top-down
  memcpy(header + 22, &height, 4);
  const unsigned short planes = 1, bpp = 32;
  memcpy(header + 26, &planes, 2);
  memcpy(header + 28, &bpp, 2);
  const unsigned int compression = 0;
  memcpy(header + 30, &compression, 4);
  memcpy(header + 34, &imageBytes, 4);
  fwrite(header, 1, 54, f);
  for (int y = 0; y < h; y++) fwrite(bgra + (size_t)y * pitch, 1, rowBytes, f);
  fclose(f);
  return true;
}

struct Capture {
  Com<ID3D11Device> d3d;
  Com<ID3D11DeviceContext> ctx;
  Com<IDirect3DDevice> winrtDevice;
  Com<IGraphicsCaptureItemInterop> interop;
};

bool initCapture(Capture& cap) {
  UINT flags = D3D11_CREATE_DEVICE_BGRA_SUPPORT;
  D3D_FEATURE_LEVEL level = D3D_FEATURE_LEVEL_11_0;
  HRESULT hr = D3D11CreateDevice(nullptr, D3D_DRIVER_TYPE_HARDWARE, nullptr, flags, nullptr, 0,
                                 D3D11_SDK_VERSION, &cap.d3d, &level, &cap.ctx);
  if (FAILED(hr)) {
    printf("{\"ok\":false,\"error\":\"D3D11CreateDevice 0x%08lx\"}\n", (unsigned long)hr);
    return false;
  }
  Com<IDXGIDevice> dxgi;
  if (FAILED(cap.d3d->QueryInterface(__uuidof(IDXGIDevice), (void**)&dxgi))) {
    printf("{\"ok\":false,\"error\":\"IDXGIDevice\"}\n");
    return false;
  }
  if (FAILED(CreateDirect3D11DeviceFromDXGIDevice(dxgi.get(), (IInspectable**)&cap.winrtDevice))) {
    printf("{\"ok\":false,\"error\":\"CreateDirect3D11DeviceFromDXGIDevice\"}\n");
    return false;
  }
  HSTRING_HEADER hdr;
  HSTRING name;
  const wchar_t* cls = L"Windows.Graphics.Capture.GraphicsCaptureItem";
  if (FAILED(WindowsCreateStringReference(cls, (UINT32)wcslen(cls), &hdr, &name))) return false;
  if (FAILED(RoGetActivationFactory(name, __uuidof(IGraphicsCaptureItemInterop), (void**)&cap.interop))) {
    printf("{\"ok\":false,\"error\":\"RoGetActivationFactory(GraphicsCaptureItem)\"}\n");
    return false;
  }
  return true;
}

// Creates a capture item for a window or the primary display.
bool makeItem(Capture& cap, HWND hwnd, bool display, Com<IGraphicsCaptureItem>& item, const char** err) {
  HRESULT hr;
  if (display) {
    HMONITOR monitor = MonitorFromPoint({0, 0}, MONITOR_DEFAULTTOPRIMARY);
    hr = cap.interop->CreateForMonitor(monitor, __uuidof(IGraphicsCaptureItem), (void**)&item);
  } else {
    hr = cap.interop->CreateForWindow(hwnd, __uuidof(IGraphicsCaptureItem), (void**)&item);
  }
  if (FAILED(hr) || !item) {
    static char msg[128];
    snprintf(msg, sizeof msg, "CreateFor%s 0x%08lx", display ? "Monitor" : "Window", (unsigned long)hr);
    *err = msg;
    return false;
  }
  return true;
}

} // namespace

HWND findProgman() {
  HWND found = nullptr;
  EnumWindows(
      [](HWND h, LPARAM p) -> BOOL {
        char cls[64] = "";
        GetClassNameA(h, cls, sizeof cls);
        if (_stricmp(cls, "Progman") == 0) {
          *(HWND*)p = h;
          return FALSE;
        }
        return TRUE;
      },
      (LPARAM)&found);
  return found;
}

// BitBlt the whole screen into a BMP —used to see whether the capture border is
// actually drawn while a session is running.
bool grabScreen(const char* path) {
  HDC screen = GetDC(nullptr);
  if (!screen) return false;
  const int w = GetSystemMetrics(SM_CXSCREEN);
  const int h = GetSystemMetrics(SM_CYSCREEN);
  HDC mem = CreateCompatibleDC(screen);
  HBITMAP bmp = CreateCompatibleBitmap(screen, w, h);
  HGDIOBJ old = SelectObject(mem, bmp);
  const BOOL copied = BitBlt(mem, 0, 0, w, h, screen, 0, 0, SRCCOPY);
  bool ok = false;
  if (copied) {
    BITMAPINFO bi{};
    bi.bmiHeader.biSize = sizeof(BITMAPINFOHEADER);
    bi.bmiHeader.biWidth = w;
    bi.bmiHeader.biHeight = -h;
    bi.bmiHeader.biPlanes = 1;
    bi.bmiHeader.biBitCount = 32;
    bi.bmiHeader.biCompression = BI_RGB;
    unsigned char* pixels = (unsigned char*)malloc((size_t)w * h * 4);
    if (pixels && GetDIBits(mem, bmp, 0, (UINT)h, pixels, &bi, DIB_RGB_COLORS)) {
      ok = writeBmp(path, pixels, w, h, w * 4);
    }
    free(pixels);
  }
  SelectObject(mem, old);
  DeleteObject(bmp);
  DeleteDC(mem);
  ReleaseDC(nullptr, screen);
  return ok;
}

// Border probe: start a real Progman session, ask for a borderless session,
// then grab the screen so the caller can check the yellow rectangle.
int runBorderTest(const char* out) {
  SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
  HRESULT hr = RoInitialize(RO_INIT_MULTITHREADED);
  if (FAILED(hr) && hr != RPC_E_CHANGED_MODE) return 1;

  Capture cap;
  if (!initCapture(cap)) return 1;
  HWND progman = findProgman();
  if (!progman) {
    printf("{\"ok\":false,\"error\":\"no Progman\"}\n");
    return 1;
  }
  const char* err = "";
  Com<IGraphicsCaptureItem> item;
  if (!makeItem(cap, progman, false, item, &err)) {
    printf("{\"ok\":false,\"error\":\"%s\"}\n", err);
    return 1;
  }
  ABI::Windows::Graphics::SizeInt32 size{};
  item->get_Size(&size);

  Com<IDirect3D11CaptureFramePool> pool;
  HSTRING_HEADER ph;
  HSTRING poolName;
  const wchar_t* poolCls = L"Windows.Graphics.Capture.Direct3D11CaptureFramePool";
  WindowsCreateStringReference(poolCls, (UINT32)wcslen(poolCls), &ph, &poolName);
  Com<IDirect3D11CaptureFramePoolStatics2> poolStatics;
  if (FAILED(RoGetActivationFactory(poolName, __uuidof(IDirect3D11CaptureFramePoolStatics2), (void**)&poolStatics))) return 1;
  hr = poolStatics->CreateFreeThreaded(cap.winrtDevice.get(), DirectXPixelFormat_B8G8R8A8UIntNormalized, 2, size, &pool);
  if (FAILED(hr)) return 1;

  Com<IGraphicsCaptureSession> session;
  if (FAILED(pool->CreateCaptureSession(item.get(), &session))) return 1;
  Com<IGraphicsCaptureSession2> s2;
  if (SUCCEEDED(session->QueryInterface(__uuidof(IGraphicsCaptureSession2), (void**)&s2)) && s2)
    s2->put_IsCursorCaptureEnabled(FALSE);

  Com<IGraphicsCaptureSession3> s3;
  const HRESULT q3 = session->QueryInterface(__uuidof(IGraphicsCaptureSession3), (void**)&s3);
  boolean before = TRUE;
  HRESULT getBefore = E_NOINTERFACE;
  HRESULT putAfter = E_NOINTERFACE;
  boolean after = TRUE;
  if (SUCCEEDED(q3) && s3) getBefore = s3->get_IsBorderRequired(&before);

  // Ask for a borderless session *before* starting; some builds freeze the
  // choice at StartCapture.
  if (SUCCEEDED(q3) && s3) putAfter = s3->put_IsBorderRequired(FALSE);
  const HRESULT started = session->StartCapture();
  if (SUCCEEDED(q3) && s3) s3->get_IsBorderRequired(&after);

  Sleep(2600); // long enough for the border to be painted if it is going to be
  const bool grabbed = grabScreen(out);
  printf("{\"ok\":true,\"session3\":0x%08lx,\"getBefore\":0x%08lx,\"before\":%d,\"putAfter\":0x%08lx,\"after\":%d,"
         "\"start\":0x%08lx,\"grabbed\":%s,\"size\":[%ld,%ld]}\n",
         (unsigned long)q3, (unsigned long)getBefore, (int)before, (unsigned long)putAfter, (int)after,
         (unsigned long)started, grabbed ? "true" : "false", (long)size.Width, (long)size.Height);
  return 0;
}

int main(int argc, char** argv) {
  if (argc >= 2 && _stricmp(argv[1], "plain") == 0) {
    SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
    const bool ok = grabScreen(argc >= 3 ? argv[2] : "plain-screen.bmp");
    printf("{\"ok\":%s}\n", ok ? "true" : "false");
    return ok ? 0 : 1;
  }
  if (argc >= 2 && _stricmp(argv[1], "border") == 0) {
    return runBorderTest(argc >= 3 ? argv[2] : "border-screen.bmp");
  }
  if (argc < 3) {
    printf("{\"ok\":false,\"error\":\"usage: wgc-probe <hwnd|display> <out.bmp>\"}\n");
    return 2;
  }
  SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
  HRESULT hr = RoInitialize(RO_INIT_MULTITHREADED);
  if (FAILED(hr) && hr != RPC_E_CHANGED_MODE) {
    printf("{\"ok\":false,\"error\":\"RoInitialize 0x%08lx\"}\n", (unsigned long)hr);
    return 1;
  }

  const bool display = _stricmp(argv[1], "display") == 0;
  HWND hwnd = display ? nullptr : (HWND)(ULONG_PTR)strtoull(argv[1], nullptr, 10);
  const char* outPath = argv[2];

  Capture cap;
  if (!initCapture(cap)) return 1;

  const char* err = "";
  Com<IGraphicsCaptureItem> item;
  if (!makeItem(cap, hwnd, display, item, &err)) {
    printf("{\"ok\":false,\"error\":\"%s\"}\n", err);
    return 1;
  }
  ABI::Windows::Graphics::SizeInt32 size{};
  item->get_Size(&size);

  Com<IDirect3D11CaptureFramePool> pool;
  HSTRING_HEADER ph;
  HSTRING poolName;
  const wchar_t* poolCls = L"Windows.Graphics.Capture.Direct3D11CaptureFramePool";
  if (FAILED(WindowsCreateStringReference(poolCls, (UINT32)wcslen(poolCls), &ph, &poolName))) return 1;
  Com<IDirect3D11CaptureFramePoolStatics2> poolStatics;
  if (FAILED(RoGetActivationFactory(poolName, __uuidof(IDirect3D11CaptureFramePoolStatics2), (void**)&poolStatics))) {
    printf("{\"ok\":false,\"error\":\"frame pool statics\"}\n");
    return 1;
  }
  hr = poolStatics->CreateFreeThreaded(cap.winrtDevice.get(), DirectXPixelFormat_B8G8R8A8UIntNormalized, 2, size, &pool);
  if (FAILED(hr)) {
    printf("{\"ok\":false,\"error\":\"CreateFreeThreaded 0x%08lx\"}\n", (unsigned long)hr);
    return 1;
  }

  Com<IGraphicsCaptureSession> session;
  hr = pool->CreateCaptureSession(item.get(), &session);
  if (FAILED(hr)) {
    printf("{\"ok\":false,\"error\":\"CreateCaptureSession 0x%08lx\"}\n", (unsigned long)hr);
    return 1;
  }
  Com<IGraphicsCaptureSession2> session2;
  if (SUCCEEDED(session->QueryInterface(__uuidof(IGraphicsCaptureSession2), (void**)&session2)) && session2)
    session2->put_IsCursorCaptureEnabled(FALSE);

  const DWORD started = GetTickCount();
  hr = session->StartCapture();
  if (FAILED(hr)) {
    printf("{\"ok\":false,\"error\":\"StartCapture 0x%08lx\"}\n", (unsigned long)hr);
    return 1;
  }

  Com<IDirect3D11CaptureFrame> frame;
  while (!frame && GetTickCount() - started < 4000) {
    hr = pool->TryGetNextFrame(&frame);
    if (FAILED(hr)) break;
    if (!frame) Sleep(5);
  }
  const DWORD firstFrameMs = GetTickCount() - started;
  if (!frame) {
    printf("{\"ok\":false,\"error\":\"no frame in 4000 ms\",\"firstFrameMs\":%lu}\n", (unsigned long)firstFrameMs);
    return 1;
  }

  Com<IDirect3DSurface> surface;
  frame->get_Surface(&surface);
  Com<Windows::Graphics::DirectX::Direct3D11::IDirect3DDxgiInterfaceAccess> access;
  hr = surface.as(__uuidof(Windows::Graphics::DirectX::Direct3D11::IDirect3DDxgiInterfaceAccess), (void**)&access);
  Com<ID3D11Texture2D> texture;
  if (SUCCEEDED(hr) && access) hr = access->GetInterface(__uuidof(ID3D11Texture2D), (void**)&texture);
  if (FAILED(hr) || !texture) {
    printf("{\"ok\":false,\"error\":\"frame texture 0x%08lx\"}\n", (unsigned long)hr);
    return 1;
  }

  D3D11_TEXTURE2D_DESC desc{};
  texture->GetDesc(&desc);
  D3D11_TEXTURE2D_DESC sdesc = desc;
  sdesc.Usage = D3D11_USAGE_STAGING;
  sdesc.BindFlags = 0;
  sdesc.CPUAccessFlags = D3D11_CPU_ACCESS_READ;
  sdesc.MiscFlags = 0;
  Com<ID3D11Texture2D> staging;
  if (FAILED(cap.d3d->CreateTexture2D(&sdesc, nullptr, &staging))) {
    printf("{\"ok\":false,\"error\":\"staging texture\"}\n");
    return 1;
  }
  const DWORD beforeCopy = GetTickCount();
  cap.ctx->CopyResource(staging.get(), texture.get());
  D3D11_MAPPED_SUBRESOURCE mapped{};
  if (FAILED(cap.ctx->Map(staging.get(), 0, D3D11_MAP_READ, 0, &mapped))) {
    printf("{\"ok\":false,\"error\":\"map\"}\n");
    return 1;
  }
  const int w = (int)desc.Width;
  const int h = (int)desc.Height;
  const double copyMs = (double)(GetTickCount() - beforeCopy);

  // Mean luminance over a coarse grid, plus how much of it is "black".
  const unsigned char* data = (const unsigned char*)mapped.pData;
  double sum = 0;
  long long samples = 0, dark = 0;
  for (int y = 0; y < h; y += 7) {
    const unsigned char* row = data + (size_t)y * mapped.RowPitch;
    for (int x = 0; x < w; x += 7) {
      const unsigned char* px = row + (size_t)x * 4;
      const double luma = (0.114 * px[0] + 0.587 * px[1] + 0.299 * px[2]) / 255.0;
      sum += luma;
      samples++;
      if (luma < 0.02) dark++;
    }
  }
  const bool wrote = writeBmp(outPath, data, w, h, (int)mapped.RowPitch);
  cap.ctx->Unmap(staging.get(), 0);
  { Com<ABI::Windows::Foundation::IClosable> c; if (SUCCEEDED(session.as(__uuidof(ABI::Windows::Foundation::IClosable), (void**)&c)) && c) c->Close(); }

  char cls[256] = "";
  char title[256] = "";
  if (!display) {
    GetClassNameA(hwnd, cls, sizeof cls);
    GetWindowTextA(hwnd, title, sizeof title);
    char e1[512], e2[512];
    jsonEscape(cls, e1, sizeof e1);
    jsonEscape(title, e2, sizeof e2);
    printf("{\"ok\":%s,\"w\":%d,\"h\":%d,\"lum\":%.4f,\"dark\":%.4f,\"firstFrameMs\":%lu,\"copyMs\":%.1f,"
           "\"cls\":\"%s\",\"title\":\"%s\"}\n",
           wrote ? "true" : "false", w, h, samples ? sum / samples : 0, samples ? (double)dark / samples : 0,
           (unsigned long)firstFrameMs, copyMs, e1, e2);
  } else {
    printf("{\"ok\":%s,\"w\":%d,\"h\":%d,\"lum\":%.4f,\"dark\":%.4f,\"firstFrameMs\":%lu,\"copyMs\":%.1f,"
           "\"cls\":\"display\",\"title\":\"\"}\n",
           wrote ? "true" : "false", w, h, samples ? sum / samples : 0, samples ? (double)dark / samples : 0,
           (unsigned long)firstFrameMs, copyMs);
  }
  return wrote ? 0 : 1;
}