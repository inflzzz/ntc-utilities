#define NOMINMAX
#define NTDDI_VERSION 0x0A00000F
#include <windows.h>
#include <tlhelp32.h>
#include <vector>
#include <string>
#include <iostream>
#include <sstream>
#include <algorithm>
#include <cmath>
#include <cstring>

// Persistent, per-session GDI gamma host. Its parent watchdog restores the
// captured ramp if Electron disappears. A small on-disk record covers helper
// termination before the watchdog can run; the next launch restores it.
struct MonitorState {
  std::wstring name;
  std::wstring label;
  int hdr = -1; // -1 unknown, 0 SDR, 1 HDR, 2 SDR/WCG, 3 legacy advanced color
  bool gamma = false;
  WORD baseline[768] = {};
  WORD last[768] = {};
  bool changed = false;
  bool nativeApplied = false;
};
struct BackupMonitor { WCHAR name[32]; WORD ramp[768]; };
struct BackupHeader { DWORD magic; DWORD version; DWORD count; };
static const DWORD BACKUP_MAGIC = 0x4E54434C;
static std::vector<MonitorState> monitors;
static std::wstring backupPath;
static HANDLE guard = nullptr;
static HANDLE parentHandle = nullptr;

bool setNativeRamp(HDC dc, const WORD* desired) {
  // Internal Windows color-management export. Optional, system DLL only,
  // and never trusted without reading the resulting display ramp below.
  using ColorGammaSetter = BOOL(WINAPI*)(HDC, LPVOID, DWORD);
  static const HMODULE color = LoadLibraryExW(L"mscms.dll", nullptr, LOAD_LIBRARY_SEARCH_SYSTEM32);
  static const auto setter = color ? reinterpret_cast<ColorGammaSetter>(GetProcAddress(color, "InternalSetDeviceGammaRamp")) : nullptr;
  const bool ok = dc && setter && GetProcAddress(color, "InternalGetAppliedGammaRamp") && setter(dc, const_cast<WORD*>(desired), 0);
  if (GetEnvironmentVariableW(L"NTC_SCREEN_LIGHT_DEBUG", nullptr, 0)) std::cerr << "Color gamma setter: " << ok << " error " << GetLastError() << std::endl;
  return ok;
}

bool getNativeRamp(HDC dc, WORD* ramp) {
  using ColorGammaGetter = BOOL(WINAPI*)(HDC, LPVOID);
  static const HMODULE color = LoadLibraryExW(L"mscms.dll", nullptr, LOAD_LIBRARY_SEARCH_SYSTEM32);
  static const auto getter = color ? reinterpret_cast<ColorGammaGetter>(GetProcAddress(color, "InternalGetAppliedGammaRamp")) : nullptr;
  WORD buffer[16384] = {};
  if (!dc || !getter || !getter(dc, buffer)) return false;
  memcpy(ramp, buffer, 768 * sizeof(WORD));
  return true;
}

std::string utf8(const std::wstring& value) {
  if (value.empty()) return {};
  int length = WideCharToMultiByte(CP_UTF8, 0, value.c_str(), -1, nullptr, 0, nullptr, nullptr);
  std::string result(length ? length : 0, '\0');
  if (length > 1) WideCharToMultiByte(CP_UTF8, 0, value.c_str(), -1, &result[0], length, nullptr, nullptr);
  if (!result.empty()) result.pop_back();
  return result;
}
std::string clean(const std::wstring& value) {
  std::string result = utf8(value);
  std::replace(result.begin(), result.end(), '\t', ' ');
  std::replace(result.begin(), result.end(), '\n', ' ');
  return result;
}
HDC dcFor(const std::wstring& name) { return CreateDCW(L"DISPLAY", name.c_str(), nullptr, nullptr); }
bool setAndVerifyRamp(HDC dc, const WORD* desired) {
  if (!dc) return false;
  const bool native = setNativeRamp(dc, desired);
  if (!native && !SetDeviceGammaRamp(dc, const_cast<WORD*>(desired))) return false;
  WORD actual[768] = {};
  if (!(native ? getNativeRamp(dc, actual) : !!GetDeviceGammaRamp(dc, actual))) return false;
  for (int channel = 0; channel < 3; ++channel) {
    for (int point : { 64, 128, 192, 255 }) {
      if (abs(int(actual[channel * 256 + point]) - int(desired[channel * 256 + point])) > 1536) return false;
    }
  }
  return true;
}
bool isAttached(const std::wstring& name) {
  for (DWORD i = 0; i < 32; ++i) {
    DISPLAY_DEVICEW display = {};
    display.cb = sizeof(display);
    if (!EnumDisplayDevicesW(nullptr, i, &display, 0)) break;
    if (name == display.DeviceName && (display.StateFlags & DISPLAY_DEVICE_ATTACHED_TO_DESKTOP)) return true;
  }
  return false;
}

int advancedColorFor(const std::wstring& device) {
  UINT32 pathCount = 0, modeCount = 0;
  if (GetDisplayConfigBufferSizes(QDC_ONLY_ACTIVE_PATHS, &pathCount, &modeCount) != ERROR_SUCCESS) return -1;
  std::vector<DISPLAYCONFIG_PATH_INFO> paths(pathCount);
  std::vector<DISPLAYCONFIG_MODE_INFO> modes(modeCount);
  if (QueryDisplayConfig(QDC_ONLY_ACTIVE_PATHS, &pathCount, paths.data(), &modeCount, modes.data(), nullptr) != ERROR_SUCCESS) return -1;
  bool matched = false;
  bool unknown = false;
  for (UINT32 i = 0; i < pathCount; ++i) {
    DISPLAYCONFIG_SOURCE_DEVICE_NAME source = {};
    source.header.type = DISPLAYCONFIG_DEVICE_INFO_GET_SOURCE_NAME;
    source.header.size = sizeof(source);
    source.header.adapterId = paths[i].sourceInfo.adapterId;
    source.header.id = paths[i].sourceInfo.id;
    if (DisplayConfigGetDeviceInfo(&source.header) != ERROR_SUCCESS || device != source.viewGdiDeviceName) continue;
    matched = true;
    DISPLAYCONFIG_GET_ADVANCED_COLOR_INFO_2 color2 = {};
    color2.header.type = DISPLAYCONFIG_DEVICE_INFO_GET_ADVANCED_COLOR_INFO_2;
    color2.header.size = sizeof(color2);
    color2.header.adapterId = paths[i].targetInfo.adapterId;
    color2.header.id = paths[i].targetInfo.id;
    if (DisplayConfigGetDeviceInfo(&color2.header) == ERROR_SUCCESS) {
      if (color2.activeColorMode == DISPLAYCONFIG_ADVANCED_COLOR_MODE_HDR) return 1;
      if (color2.activeColorMode == DISPLAYCONFIG_ADVANCED_COLOR_MODE_WCG) return 2;
      if (color2.activeColorMode == DISPLAYCONFIG_ADVANCED_COLOR_MODE_SDR) continue;
      unknown = true;
      continue;
    }
    DISPLAYCONFIG_GET_ADVANCED_COLOR_INFO color = {};
    color.header.type = DISPLAYCONFIG_DEVICE_INFO_GET_ADVANCED_COLOR_INFO;
    color.header.size = sizeof(color);
    color.header.adapterId = paths[i].targetInfo.adapterId;
    color.header.id = paths[i].targetInfo.id;
    if (DisplayConfigGetDeviceInfo(&color.header) != ERROR_SUCCESS) { unknown = true; continue; }
    if (color.advancedColorEnabled || color.wideColorEnforced) return 3;
  }
  return matched && !unknown ? 0 : -1;
}

void enumerateMonitors() {
  monitors.clear();
  for (DWORD i = 0; i < 32; ++i) {
    DISPLAY_DEVICEW display = {};
    display.cb = sizeof(display);
    if (!EnumDisplayDevicesW(nullptr, i, &display, 0)) break;
    if (!(display.StateFlags & DISPLAY_DEVICE_ATTACHED_TO_DESKTOP)) continue;
    MonitorState item;
    item.name = display.DeviceName;
    item.label = display.DeviceString;
    item.hdr = advancedColorFor(item.name);
    HDC dc = dcFor(item.name);
    if (dc) {
      item.gamma = getNativeRamp(dc, item.baseline) || !!GetDeviceGammaRamp(dc, item.baseline);
      if (item.gamma) memcpy(item.last, item.baseline, sizeof(item.last));
      DeleteDC(dc);
    }
    monitors.push_back(item);
  }
}

bool backupOriginal() {
  HANDLE file = CreateFileW(backupPath.c_str(), GENERIC_WRITE, 0, nullptr, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL | FILE_FLAG_WRITE_THROUGH, nullptr);
  if (file == INVALID_HANDLE_VALUE) return false;
  BackupHeader header = { BACKUP_MAGIC, 1, static_cast<DWORD>(monitors.size()) };
  DWORD written = 0;
  bool ok = WriteFile(file, &header, sizeof(header), &written, nullptr) && written == sizeof(header);
  for (const auto& item : monitors) {
    BackupMonitor entry = {};
    wcsncpy_s(entry.name, item.name.c_str(), _TRUNCATE);
    memcpy(entry.ramp, item.baseline, sizeof(entry.ramp));
    ok = ok && WriteFile(file, &entry, sizeof(entry), &written, nullptr) && written == sizeof(entry);
  }
  FlushFileBuffers(file);
  CloseHandle(file);
  if (!ok) DeleteFileW(backupPath.c_str());
  return ok;
}

bool restoreFromBackup() {
  HANDLE file = CreateFileW(backupPath.c_str(), GENERIC_READ, FILE_SHARE_READ, nullptr, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, nullptr);
  if (file == INVALID_HANDLE_VALUE) return true;
  BackupHeader header = {};
  DWORD read = 0;
  bool ok = ReadFile(file, &header, sizeof(header), &read, nullptr) && read == sizeof(header) &&
    header.magic == BACKUP_MAGIC && header.version == 1 && header.count <= 32;
  std::vector<BackupMonitor> entries;
  if (ok) {
    entries.resize(header.count);
    for (auto& item : entries) {
      if (!ReadFile(file, &item, sizeof(item), &read, nullptr) || read != sizeof(item)) { ok = false; break; }
      item.name[31] = 0;
    }
  }
  CloseHandle(file);
  if (!ok) return false;
  for (const auto& item : entries) {
    // Never write a ramp when HDR state is unknown or enabled.
    if (advancedColorFor(item.name) != 0) { ok = false; continue; }
    HDC dc = dcFor(item.name);
    if (dc) { if (!setAndVerifyRamp(dc, item.ramp)) ok = false; DeleteDC(dc); }
    else ok = false;
  }
  if (ok) DeleteFileW(backupPath.c_str());
  return ok;
}

bool restoreAll() {
  bool ok = true;
  for (auto& item : monitors) {
    if (!item.changed) continue;
    if (!isAttached(item.name)) { item.changed = false; continue; }
    if (advancedColorFor(item.name) != 0) { ok = false; continue; }
    HDC dc = dcFor(item.name);
    if (!setAndVerifyRamp(dc, item.baseline)) ok = false;
    else { item.changed = false; item.nativeApplied = false; memcpy(item.last, item.baseline, sizeof(item.last)); }
    if (dc) DeleteDC(dc);
  }
  if (ok) DeleteFileW(backupPath.c_str());
  return ok;
}
bool restoreOne(size_t index) {
  if (index >= monitors.size()) return false;
  auto& item = monitors[index];
  if (!item.changed) return true;
  if (advancedColorFor(item.name) != 0) return false;
  HDC dc = dcFor(item.name);
  const bool ok = setAndVerifyRamp(dc, item.baseline);
  if (dc) DeleteDC(dc);
  if (ok) { item.changed = false; item.nativeApplied = false; memcpy(item.last, item.baseline, sizeof(item.last)); }
  return ok;
}
unsigned long long rampHash(const WORD* ramp) {
  unsigned long long value = 1469598103934665603ULL;
  for (int i = 0; i < 768; ++i) {
    value = (value ^ (ramp[i] & 255)) * 1099511628211ULL;
    value = (value ^ (ramp[i] >> 8)) * 1099511628211ULL;
  }
  return value;
}
void printRampStatus() {
  for (size_t i = 0; i < monitors.size(); ++i) {
    auto& item = monitors[i];
    WORD current[768] = {};
    HDC dc = dcFor(item.name);
    bool readable = dc && (getNativeRamp(dc, current) || !!GetDeviceGammaRamp(dc, current));
    if (dc) DeleteDC(dc);
    std::cout << "S\t" << i << '\t' << rampHash(item.baseline) << '\t' << (readable ? rampHash(current) : 0) << '\t' << (item.nativeApplied ? "native" : "gdi") << std::endl;
    dc = dcFor(item.name);
    WORD native[768] = {};
    if (getNativeRamp(dc, native)) std::cout << "N\t" << i << '\t' << rampHash(native) << '\t' << native[64] << '\t' << native[320] << '\t' << native[576] << std::endl;
    if (dc) DeleteDC(dc);
  }
  std::cout << "END" << std::endl;
}

double kelvinComponent(int kelvin, int channel) {
  double temp = kelvin / 100.0;
  if (channel == 0) return temp <= 66 ? 255 : std::max(0.0, std::min(255.0, 329.698727446 * pow(temp - 60, -0.1332047592)));
  if (channel == 1) return temp <= 66 ? std::max(0.0, std::min(255.0, 99.4708025861 * log(temp) - 161.1195681661)) :
    std::max(0.0, std::min(255.0, 288.1221695283 * pow(temp - 60, -0.0755148492)));
  return temp >= 66 ? 255 : temp <= 19 ? 0 : std::max(0.0, std::min(255.0, 138.5177312231 * log(temp - 10) - 305.0447927307));
}
bool apply(size_t index, int kelvin, int intensity, int dim, std::string& reason) {
  if (index >= monitors.size()) { reason = "monitor-invalid"; return false; }
  auto& item = monitors[index];
  item.hdr = advancedColorFor(item.name);
  if (item.hdr != 0) { reason = item.hdr > 0 ? "hdr-active" : "hdr-unknown"; return false; }
  if (!item.gamma) { reason = "gamma-unsupported"; return false; }
  if (kelvin < 1200 || kelvin > 6500 || intensity < 0 || intensity > 100 || dim < 0 || dim > 50) { reason = "range-invalid"; return false; }
  if (!item.changed && !backupOriginal()) { reason = "backup-failed"; return false; }
  WORD ramp[768];
  for (int channel = 0; channel < 3; ++channel) {
    double relative = kelvinComponent(kelvin, channel) / kelvinComponent(6500, channel);
    double factor = (1.0 - intensity / 100.0) + (intensity / 100.0) * std::min(1.0, relative);
    factor *= 1.0 - dim / 100.0;
    for (int i = 0; i < 256; ++i) {
      double value = item.baseline[channel * 256 + i] * factor;
      ramp[channel * 256 + i] = static_cast<WORD>(std::max(0.0, std::min(65535.0, floor(value + 0.5))));
    }
  }
  HDC dc = dcFor(item.name);
  if (!dc) { reason = "device-unavailable"; return false; }
  const bool native = setNativeRamp(dc, ramp);
  bool ok = native || !!SetDeviceGammaRamp(dc, ramp);
  WORD readback[768] = {};
  if (ok) ok = native ? getNativeRamp(dc, readback) : !!GetDeviceGammaRamp(dc, readback);
  DeleteDC(dc);
  if (ok) {
    for (int c = 0; c < 3 && ok; ++c) for (int i : { 64, 128, 192, 255 }) {
      if (abs(int(readback[c * 256 + i]) - int(ramp[c * 256 + i])) > 1536) {
        if (GetEnvironmentVariableW(L"NTC_SCREEN_LIGHT_DEBUG", nullptr, 0)) std::cerr << "Gamma readback channel " << c << " point " << i << ": " << readback[c * 256 + i] << " expected " << ramp[c * 256 + i] << std::endl;
        ok = false; break;
      }
    }
  }
  if (!ok) {
    reason = "gamma-not-confirmed";
    HDC restore = dcFor(item.name);
    if (restore) { setAndVerifyRamp(restore, item.baseline); DeleteDC(restore); }
    return false;
  }
  memcpy(item.last, ramp, sizeof(ramp));
  item.changed = true;
  item.nativeApplied = native;
  reason = native ? "applied-native" : "applied-gdi";
  return true;
}

std::string foreground() {
  HWND window = GetForegroundWindow();
  if (!window) return "F\t\t0";
  DWORD pid = 0;
  GetWindowThreadProcessId(window, &pid);
  HANDLE process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid);
  WCHAR path[32768] = {};
  DWORD size = 32768;
  if (!process || !QueryFullProcessImageNameW(process, 0, path, &size)) path[0] = 0;
  if (process) CloseHandle(process);
  RECT bounds = {}, monitorBounds = {};
  MONITORINFO info = { sizeof(info) };
  bool fullscreen = GetWindowRect(window, &bounds) && GetMonitorInfoW(MonitorFromWindow(window, MONITOR_DEFAULTTONEAREST), &info);
  if (fullscreen) {
    monitorBounds = info.rcMonitor;
    const LONG_PTR style = GetWindowLongPtrW(window, GWL_STYLE);
    fullscreen = !(style & WS_CAPTION) && bounds.left <= monitorBounds.left + 2 && bounds.top <= monitorBounds.top + 2 &&
      bounds.right >= monitorBounds.right - 2 && bounds.bottom >= monitorBounds.bottom - 2;
  }
  return "F\t" + clean(path) + "\t" + (fullscreen ? "1" : "0");
}
void listProcesses() {
  HANDLE snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
  if (snapshot == INVALID_HANDLE_VALUE) { std::cout << "END" << std::endl; return; }
  PROCESSENTRY32W entry = {};
  entry.dwSize = sizeof(entry);
  DWORD listed = 0;
  if (Process32FirstW(snapshot, &entry)) do {
    if (listed >= 200) break;
    HANDLE process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, entry.th32ProcessID);
    WCHAR file[32768] = {};
    DWORD size = 32768;
    if (process && QueryFullProcessImageNameW(process, 0, file, &size)) {
      std::cout << "P\t" << clean(file) << std::endl;
      ++listed;
    }
    if (process) CloseHandle(process);
  } while (Process32NextW(snapshot, &entry));
  CloseHandle(snapshot);
  std::cout << "END" << std::endl;
}

DWORD WINAPI parentWatchdog(LPVOID) {
  if (!parentHandle) return 0;
  WaitForSingleObject(parentHandle, INFINITE);
  WaitForSingleObject(guard, INFINITE);
  restoreAll();
  ReleaseMutex(guard);
  ExitProcess(0);
}

int wmain(int argc, wchar_t** argv) {
  if (argc != 3) return 2;
  const DWORD parentPid = wcstoul(argv[1], nullptr, 10);
  backupPath = argv[2];
  parentHandle = OpenProcess(SYNCHRONIZE, FALSE, parentPid);
  if (!parentHandle) return 3;
  guard = CreateMutexW(nullptr, FALSE, nullptr);
  if (!restoreFromBackup()) { std::cout << "ERROR\trecovery-failed" << std::endl; return 4; }
  enumerateMonitors();
  CreateThread(nullptr, 0, parentWatchdog, nullptr, 0, nullptr);
  std::cout << "READY\t" << monitors.size() << std::endl;
  std::string command;
  while (std::getline(std::cin, command)) {
    WaitForSingleObject(guard, INFINITE);
    if (command == "LIST") {
      for (size_t i = 0; i < monitors.size(); ++i) {
        auto& item = monitors[i];
        std::cout << "D\t" << i << '\t' << clean(item.name) << '\t' << clean(item.label) << '\t' << item.hdr << '\t' << (item.gamma ? 1 : 0) << std::endl;
      }
      std::cout << "END" << std::endl;
    } else if (command == "STATUS") {
      printRampStatus();
    } else if (command == "REPROBE") {
      bool restored = restoreAll();
      if (restored) enumerateMonitors();
      std::cout << (restored ? "OK\treprobed" : "ERROR\trestore-failed") << std::endl;
    } else if (command == "RESTORE") {
      std::cout << (restoreAll() ? "OK\trestored" : "ERROR\trestore-failed") << std::endl;
    } else if (command.compare(0, 14, "RESTORE_INDEX\t") == 0) {
      size_t index = 0;
      std::istringstream fields(command.substr(14)); fields >> index;
      std::cout << (!fields.fail() && restoreOne(index) ? "OK\trestored" : "ERROR\trestore-failed") << std::endl;
    } else if (command == "FOREGROUND") {
      std::cout << foreground() << std::endl;
    } else if (command == "PROCESSES") {
      listProcesses();
    } else if (command == "EXIT") {
      std::cout << (restoreAll() ? "OK\texit" : "ERROR\trestore-failed") << std::endl;
      ReleaseMutex(guard);
      break;
    } else if (command.compare(0, 6, "APPLY\t") == 0) {
      std::istringstream fields(command.substr(6));
      size_t index = 0; int kelvin = 0, intensity = 0, dim = 0;
      fields >> index >> kelvin >> intensity >> dim;
      std::string reason;
      const bool ok = !fields.fail() && apply(index, kelvin, intensity, dim, reason);
      std::cout << (ok ? "OK\t" : "ERROR\t") << (reason.empty() ? "invalid-command" : reason) << std::endl;
    } else std::cout << "ERROR\tunknown-command" << std::endl;
    ReleaseMutex(guard);
  }
  WaitForSingleObject(guard, INFINITE);
  restoreAll();
  ReleaseMutex(guard);
  CloseHandle(parentHandle);
  CloseHandle(guard);
  return 0;
}
