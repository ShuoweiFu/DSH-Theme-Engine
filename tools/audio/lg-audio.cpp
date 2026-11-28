// lg-audio.exe - system loopback -> 128 spectrum floats on stdout, 60 lines/s.
//
// Wallpaper Engine gives audio-reactive wallpapers its analysis of the Windows
// loopback device. Chromium cannot offer that here: the plugin host is an
// Electron *utility* process, so session.setDisplayMediaRequestHandler() does
// not exist and getDisplayMedia() is refused. WASAPI is reachable from an
// ordinary process, so this helper does the capture and the FFT itself and the
// host relays the numbers to the page. Line format: 128 comma separated
// floats in 0..1, one line per frame.

#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <mmdeviceapi.h>
#include <audioclient.h>
#include <cmath>
#include <cstdio>
#include <vector>

// MinGW does not ship ksguid.lib, so the float subtype GUID is defined here.
static const GUID SUBTYPE_IEEE_FLOAT = { 0x00000003, 0x0000, 0x0010,
  { 0x80, 0x00, 0x00, 0xaa, 0x00, 0x38, 0x9b, 0x71 } };

static const int FFT_N = 256;
static const int BANDS = 128;

struct Complex { float re, im; };

static void fft(Complex* a, int n) {
  for (int i = 1, j = 0; i < n; ++i) {
    int bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { Complex t = a[i]; a[i] = a[j]; a[j] = t; }
  }
  for (int len = 2; len <= n; len <<= 1) {
    const double ang = -2.0 * 3.14159265358979323846 / len;
    const Complex w{ (float)std::cos(ang), (float)std::sin(ang) };
    for (int i = 0; i < n; i += len) {
      Complex cur{ 1.0f, 0.0f };
      for (int k = 0; k < len / 2; ++k) {
        const Complex u = a[i + k];
        const Complex v{ a[i + k + len / 2].re * cur.re - a[i + k + len / 2].im * cur.im,
                         a[i + k + len / 2].re * cur.im + a[i + k + len / 2].im * cur.re };
        a[i + k] = { u.re + v.re, u.im + v.im };
        a[i + k + len / 2] = { u.re - v.re, u.im - v.im };
        cur = { cur.re * w.re - cur.im * w.im, cur.re * w.im + cur.im * w.re };
      }
    }
  }
}

int main() {
  CoInitializeEx(nullptr, COINIT_MULTITHREADED);
  IMMDeviceEnumerator* enumerator = nullptr;
  if (FAILED(CoCreateInstance(__uuidof(MMDeviceEnumerator), nullptr, CLSCTX_ALL,
                              __uuidof(IMMDeviceEnumerator), (void**)&enumerator))) {
    std::fprintf(stderr, "no device enumerator\n");
    return 2;
  }
  IMMDevice* device = nullptr;
  if (FAILED(enumerator->GetDefaultAudioEndpoint(eRender, eConsole, &device))) {
    std::fprintf(stderr, "no default render device\n");
    return 3;
  }
  IAudioClient* client = nullptr;
  if (FAILED(device->Activate(__uuidof(IAudioClient), CLSCTX_ALL, nullptr, (void**)&client))) {
    std::fprintf(stderr, "no audio client\n");
    return 4;
  }
  WAVEFORMATEX* mix = nullptr;
  if (FAILED(client->GetMixFormat(&mix))) { std::fprintf(stderr, "no mix format\n"); return 5; }
  const int channels = mix->nChannels;
  const bool isFloat = mix->wFormatTag == WAVE_FORMAT_IEEE_FLOAT ||
                       (mix->wFormatTag == WAVE_FORMAT_EXTENSIBLE &&
                        IsEqualGUID(reinterpret_cast<WAVEFORMATEXTENSIBLE*>(mix)->SubFormat, SUBTYPE_IEEE_FLOAT));
  if (FAILED(client->Initialize(AUDCLNT_SHAREMODE_SHARED, AUDCLNT_STREAMFLAGS_LOOPBACK,
                                10000000, 0, mix, nullptr))) {
    std::fprintf(stderr, "loopback init failed\n");
    return 6;
  }
  IAudioCaptureClient* capture = nullptr;
  if (FAILED(client->GetService(__uuidof(IAudioCaptureClient), (void**)&capture))) {
    std::fprintf(stderr, "no capture client\n");
    return 7;
  }
  if (FAILED(client->Start())) { std::fprintf(stderr, "start failed\n"); return 8; }

  std::vector<float> window(FFT_N, 0.0f);
  std::vector<Complex> spec;
  spec.resize(FFT_N);
  float smooth[BANDS];
  for (int i = 0; i < BANDS; ++i) smooth[i] = 0.0f;
  std::printf("ready %d %d\n", channels, (int)mix->nSamplesPerSec);
  std::fflush(stdout);

  for (;;) {
    Sleep(10);
    UINT32 packet = 0;
    while (SUCCEEDED(capture->GetNextPacketSize(&packet)) && packet > 0) {
      BYTE* data = nullptr;
      UINT32 frames = 0;
      DWORD flags = 0;
      if (FAILED(capture->GetBuffer(&data, &frames, &flags, nullptr, nullptr))) break;
      if (flags & AUDCLNT_BUFFERFLAGS_SILENT) {
        for (int i = 0; i < FFT_N; ++i) window[i] = 0.0f;
      } else if (data && frames) {
        for (UINT32 f = 0; f < frames; ++f) {
          float mono = 0.0f;
          if (isFloat) {
            const float* frame = reinterpret_cast<const float*>(data) + (size_t)f * channels;
            for (int c = 0; c < channels; ++c) mono += frame[c];
          } else {
            const short* frame = reinterpret_cast<const short*>(data) + (size_t)f * channels;
            for (int c = 0; c < channels; ++c) mono += frame[c] / 32768.0f;
          }
          mono /= (float)channels;
          for (int i = 0; i < FFT_N - 1; ++i) window[i] = window[i + 1];
          window[FFT_N - 1] = mono;
        }
      }
      capture->ReleaseBuffer(frames);
    }

    for (int i = 0; i < FFT_N; ++i) {
      const float hann = 0.5f - 0.5f * std::cos(2.0f * 3.14159265358979323846f * i / (FFT_N - 1));
      spec[i] = { window[i] * hann, 0.0f };
    }
    fft(spec.data(), FFT_N);

    for (int b = 0; b < BANDS; ++b) {
      const float re = spec[b].re, im = spec[b].im;
      float mag = std::sqrt(re * re + im * im) / (FFT_N * 0.5f);
      // Log-ish response: music sits near -40 dB, so a linear FFT looks flat.
      float level = std::sqrt(mag) * 2.4f;
      if (level > 1.0f) level = 1.0f;
      smooth[b] = smooth[b] * 0.55f + level * 0.45f;
    }
    for (int b = 0; b < BANDS; ++b) std::printf(b ? ",%.3f" : "%.3f", smooth[b]);
    std::printf("\n");
    std::fflush(stdout);
  }
}


