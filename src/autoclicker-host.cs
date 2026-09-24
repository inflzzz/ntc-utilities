using System;
using System.Collections;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;
using System.Web.Script.Serialization;

public static class NtcAutoClickHost
{
    [StructLayout(LayoutKind.Sequential)]
    private struct Point { public int X; public int Y; }

    [StructLayout(LayoutKind.Sequential)]
    private struct MouseInputData { public int X; public int Y; public uint Data; public uint Flags; public uint Time; public UIntPtr ExtraInfo; }

    [StructLayout(LayoutKind.Explicit)]
    private struct InputUnion { [FieldOffset(0)] public MouseInputData Mouse; }

    [StructLayout(LayoutKind.Sequential)]
    private struct InputRecord { public uint Type; public InputUnion Union; }

    [StructLayout(LayoutKind.Sequential)]
    private struct MouseHookInfo { public Point Point; public uint MouseData; public uint Flags; public uint Time; public UIntPtr ExtraInfo; }

    [StructLayout(LayoutKind.Sequential)]
    private struct KeyboardHookInfo { public uint VirtualKey; public uint ScanCode; public uint Flags; public uint Time; public UIntPtr ExtraInfo; }

    [StructLayout(LayoutKind.Sequential)]
    private struct NativeMessage { public IntPtr Window; public uint Message; public UIntPtr WParam; public IntPtr LParam; public uint Time; public Point Point; }

    private delegate IntPtr LowLevelMouseProc(int code, IntPtr message, IntPtr data);
    private delegate IntPtr LowLevelKeyboardProc(int code, IntPtr message, IntPtr data);

    [DllImport("user32.dll")] private static extern short GetAsyncKeyState(int key);
    [DllImport("user32.dll")] private static extern short GetKeyState(int key);
    [DllImport("user32.dll", SetLastError = true)] private static extern uint SendInput(uint inputCount, [In] InputRecord[] inputs, int inputSize);
    [DllImport("user32.dll")] private static extern void keybd_event(byte key, byte scan, uint flags, UIntPtr extra);
    [DllImport("user32.dll")] private static extern bool GetCursorPos(out Point point);
    [DllImport("user32.dll")] private static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] private static extern int GetSystemMetrics(int index);
    [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
    [DllImport("ntdll.dll")] private static extern int NtSetTimerResolution(uint desiredResolution, byte setResolution, out uint actualResolution);
    [DllImport("user32.dll", SetLastError = true)] private static extern IntPtr SetWindowsHookEx(int hook, LowLevelMouseProc callback, IntPtr module, uint threadId);
    [DllImport("user32.dll", SetLastError = true)] private static extern IntPtr SetWindowsHookEx(int hook, LowLevelKeyboardProc callback, IntPtr module, uint threadId);
    [DllImport("user32.dll")] private static extern IntPtr CallNextHookEx(IntPtr hook, int code, IntPtr message, IntPtr data);
    [DllImport("user32.dll")] private static extern bool UnhookWindowsHookEx(IntPtr hook);
    [DllImport("user32.dll")] private static extern int GetMessage(out NativeMessage message, IntPtr window, uint minimum, uint maximum);
    [DllImport("user32.dll")] private static extern bool PostThreadMessage(uint threadId, uint message, UIntPtr wParam, IntPtr lParam);
    [DllImport("kernel32.dll")] private static extern uint GetCurrentThreadId();

    private const uint InputMouse = 0;
    private const uint LeftDown = 0x0002, LeftUp = 0x0004, RightDown = 0x0008, RightUp = 0x0010, MiddleDown = 0x0020, MiddleUp = 0x0040;
    private const uint KeyUp = 0x0002;
    private const double MinimumClickIntervalMs = 2.0;
    // The session counter is cumulative; refresh once per second so it isn't mistaken for half the configured CPS.
    private const double StateReportIntervalMs = 1000.0;
    private static readonly ConcurrentQueue<string> Input = new ConcurrentQueue<string>();
    private static readonly JavaScriptSerializer Json = new JavaScriptSerializer();
    private static readonly Stopwatch Clock = Stopwatch.StartNew();
    private static readonly Random Random = new Random();
    private static readonly object OutputLock = new object();
    private static readonly object PickerLock = new object();
    private static readonly ManualResetEvent MouseHookReady = new ManualResetEvent(false);
    private static readonly LowLevelMouseProc MouseHookCallbackReference = MouseHookCallback;
    private static readonly LowLevelKeyboardProc KeyboardHookCallbackReference = KeyboardHookCallback;
    private static Dictionary<string, object> settings = new Dictionary<string, object>();
    private static bool running, paused, shuttingDown, zoneDrawing, previousHotkey, recorderFocused, swallowPickerRightUp;
    private static bool shiftDown, leftShiftDown, rightShiftDown, controlDown, leftControlDown, rightControlDown;
    private static volatile bool stopRequested;
    private static string picker = "", statusMessage = "Pronto", processMessage = "";
    private static string zoneAction = "stop";
    private static Point zoneStart;
    private static long runClicks, totalClicks;
    private static double startedAt, nextClickAt, nextReportAt, nextPickerPreviewAt;
    private static bool timerResolutionHeld;
    private static int pointIndex, pointRemaining = -1;
    private static bool pausedByZone, previousStartZone;
    private static int lastPointX = int.MinValue, lastPointY = int.MinValue;
    private static int lastBaseX, lastBaseY;
    private static IntPtr mouseHook;
    private static IntPtr keyboardHook;
    private static uint mouseHookThreadId;

    public static void Run()
    {
        Thread hookThread = new Thread(MouseHookLoop);
        hookThread.IsBackground = true;
        hookThread.Name = "NtcAutoClickerPickerHook";
        hookThread.Start();
        if (!MouseHookReady.WaitOne(3000) || mouseHook == IntPtr.Zero)
            Emit("error", new Dictionary<string, object> { { "message", "Não foi possível iniciar a seleção de pontos e zonas. Verifique as permissões do Windows." } });
        if (keyboardHook == IntPtr.Zero)
            Emit("error", new Dictionary<string, object> { { "message", "O Shift e o Ctrl podem não ser reconhecidos durante a seleção. Reinicie o Auto-clicker para tentar novamente." } });
        Thread reader = new Thread(ReadInput);
        reader.IsBackground = true;
        reader.Start();
        EmitState();
        while (!shuttingDown)
        {
            DrainCommands();
            if (shuttingDown) break;
            UpdateHotkey();
            double now = Clock.Elapsed.TotalMilliseconds;
            if (running || Boolean(settings, "stopZonesEnabled", false))
            {
                bool safetyTriggered = CheckSafety();
                if (running && safetyTriggered)
                {
                    Stop("Parado por uma proteção de segurança.");
                }
                else if (running && !paused && now >= nextClickAt)
                {
                    double interval = BaseInterval();
                    int cycles = BatchCycleCount(interval);
                    double batchInterval = 0;
                    for (int i = 0; i < cycles; i++) batchInterval += NextInterval();
                    nextClickAt += batchInterval;
                    try
                    {
                        if (CanBatchMouseInputs(interval)) RunFastMouseBatch(cycles);
                        else for (int i = 0; i < cycles && running; i++) RunCycle();
                    }
                    catch (Exception error) { Stop("Falha ao enviar entrada: " + error.Message); }
                    now = Clock.Elapsed.TotalMilliseconds;
                    if (running && now - nextClickAt >= batchInterval) nextClickAt = now + NextInterval();
                }
            }
            if (picker.Length > 0) UpdatePicker();
            if (now >= nextReportAt) { EmitState(); nextReportAt = now + StateReportIntervalMs; }
            if (!running) Thread.Sleep(8);
            else WaitForNextCycle();
        }
        ReleaseInputs();
        SetTimerResolution(false);
        running = false;
        if (mouseHookThreadId != 0) PostThreadMessage(mouseHookThreadId, 0x0012, UIntPtr.Zero, IntPtr.Zero);
        EmitState();
    }

    private static void ReadInput()
    {
        try
        {
            string line;
            while ((line = Console.ReadLine()) != null)
            {
                try
                {
                    Dictionary<string, object> command = Json.Deserialize<Dictionary<string, object>>(line);
                    string type = Text(command, "type", "");
                    if ((type == "active" && !Boolean(command, "active", false)) || type == "shutdown" || type == "suspend") stopRequested = true;
                }
                catch { }
                Input.Enqueue(line);
            }
        }
        catch { }
    }

    private static void DrainCommands()
    {
        string line;
        while (Input.TryDequeue(out line))
        {
            try
            {
                Dictionary<string, object> command = Json.Deserialize<Dictionary<string, object>>(line);
                string type = Text(command, "type", "");
                if (type == "configure")
                {
                    settings = Dict(command, "settings");
                    totalClicks = (long)Number(settings, "totalClicks", totalClicks);
                    Point cursor;
                    if (GetCursorPos(out cursor)) { lastBaseX = cursor.X; lastBaseY = cursor.Y; }
                    lastPointX = int.MinValue; lastPointY = int.MinValue;
                    EmitState();
                }
                else if (type == "active") SetActive(Boolean(command, "active", false), "Pelo NTC");
                else if (type == "pick-point") BeginPick("point", "stop");
                else if (type == "pick-zone") BeginPick("zone", Text(command, "action", "stop"));
                else if (type == "picker-point") HandlePickedPoint(command);
                else if (type == "picker-delete-point") HandleDeletePoint(command);
                else if (type == "picker-zone-finish") HandlePickedZone(command);
                else if (type == "list-processes") new Thread(EmitProcessList) { IsBackground = true }.Start();
                else if (type == "recording") { recorderFocused = Boolean(command, "active", false); previousHotkey = false; }
                else if (type == "suspend") Stop("Pausado enquanto o computador suspende.");
                else if (type == "shutdown") { Stop("Encerrando."); shuttingDown = true; }
            }
            catch (Exception error) { Emit("error", new Dictionary<string, object> { { "message", error.Message } }); }
        }
    }

    private static void UpdateHotkey()
    {
        if (picker.Length > 0 || recorderFocused) { previousHotkey = false; return; }
        string[] tokens = Text(settings, "hotkey", "F6").Split('+');
        if (tokens.Length == 0) return;
        int key = VirtualKey(tokens[tokens.Length - 1]);
        bool down = key > 0 && IsDown(key);
        bool modifiers = true;
        for (int i = 0; i < tokens.Length - 1; i++)
        {
            string modifier = tokens[i].Trim().ToUpperInvariant();
            if (modifier == "CONTROL" || modifier == "CTRL") modifiers &= IsDown(0x11);
            else if (modifier == "ALT") modifiers &= IsDown(0x12);
            else if (modifier == "SHIFT") modifiers &= IsDown(0x10);
            else if (modifier == "WINDOWS" || modifier == "WIN") modifiers &= IsDown(0x5B) || IsDown(0x5C);
        }
        bool pressed = down && modifiers;
        string mode = Text(settings, "mode", "Toggle");
        if (mode == "Hold") SetActive(pressed, "Segurando " + Text(settings, "hotkey", "F6"));
        else if (pressed && !previousHotkey) SetActive(!running, "Atalho " + Text(settings, "hotkey", "F6"));
        previousHotkey = pressed;
    }

    private static void SetActive(bool active, string reason)
    {
        if (active == running) return;
        running = active;
        paused = false;
        pausedByZone = false;
        previousStartZone = false;
        if (active)
        {
            SetTimerResolution(true);
            runClicks = 0;
            startedAt = Clock.Elapsed.TotalMilliseconds;
            nextClickAt = startedAt;
            pointIndex = 0;
            pointRemaining = -1;
            statusMessage = reason;
        }
        else
        {
            ReleaseInputs();
            SetTimerResolution(false);
            statusMessage = reason == "Pelo NTC" ? "Pronto para iniciar pelo atalho " + Text(settings, "hotkey", "F6") + "." : reason;
        }
        EmitState();
    }

    private static void Stop(string reason)
    {
        if (!running && !paused) return;
        running = false;
        paused = false;
        pausedByZone = false;
        ReleaseInputs();
        SetTimerResolution(false);
        statusMessage = reason;
        EmitState();
    }

    private static void BeginPick(string type, string action)
    {
        if (running) SetActive(false, type == "point" ? "Parado para marcar uma posição." : "Parado para desenhar uma zona.");
        lock (PickerLock)
        {
            picker = type;
            zoneAction = action;
            zoneDrawing = false;
            swallowPickerRightUp = false;
        }
        nextPickerPreviewAt = 0;
        statusMessage = type == "point" ? "Clique com o botão direito para marcar. Segure Shift + botão direito para adicionar outro; Ctrl + botão direito apaga o mais próximo. Esc cancela." : "Arraste com o botão direito para desenhar. Esc cancela.";
        Emit("picker", new Dictionary<string, object> { { "active", true }, { "kind", type }, { "action", action }, { "message", statusMessage } });
        EmitState();
    }

    private static void UpdatePicker()
    {
        string kind;
        lock (PickerLock) kind = picker;
        if (kind.Length == 0) return;
        if (IsDown(0x1B))
        {
            lock (PickerLock) { kind = picker; picker = ""; zoneDrawing = false; swallowPickerRightUp = false; }
            statusMessage = "Seleção cancelada.";
            Emit("picker", new Dictionary<string, object> { { "active", false }, { "cancelled", true }, { "kind", kind }, { "message", statusMessage } });
            EmitState();
            return;
        }
        Point point;
        if (!GetCursorPos(out point)) return;
        EmitPickerPreview(point);
    }

    private static void EmitPickerPreview(Point point)
    {
        double now = Clock.Elapsed.TotalMilliseconds;
        if (now < nextPickerPreviewAt) return;
        nextPickerPreviewAt = now + 16;
        string kind, action;
        bool drawing;
        Point start;
        lock (PickerLock) { kind = picker; action = zoneAction; drawing = zoneDrawing; start = zoneStart; }
        if (kind.Length == 0) return;
        Emit("preview", new Dictionary<string, object> {
            { "kind", kind }, { "action", action }, { "cursorX", point.X }, { "cursorY", point.Y },
            { "drawing", drawing }, { "startX", start.X }, { "startY", start.Y }
        });
    }

    private static void HandlePickedPoint(Dictionary<string, object> command)
    {
        bool keepPicking = Boolean(command, "shift", false);
        lock (PickerLock)
        {
            if (picker != "point") return;
            if (!keepPicking) picker = "";
        }
        int x = (int)Number(command, "x", 0), y = (int)Number(command, "y", 0);
        Emit("point", new Dictionary<string, object> { { "x", x }, { "y", y } });
        statusMessage = keepPicking ? "Ponto adicionado. Segure Shift + botão direito para marcar outro; Ctrl + botão direito apaga o mais próximo." : "Posição adicionada.";
        Emit("picker", new Dictionary<string, object> { { "active", keepPicking }, { "kind", "point" }, { "message", statusMessage } });
        EmitState();
    }

    private static void HandleDeletePoint(Dictionary<string, object> command)
    {
        lock (PickerLock) if (picker != "point") return;
        Emit("delete-point", new Dictionary<string, object> { { "x", Number(command, "x", 0) }, { "y", Number(command, "y", 0) } });
    }

    private static void HandlePickedZone(Dictionary<string, object> command)
    {
        Point start = new Point { X = (int)Number(command, "startX", 0), Y = (int)Number(command, "startY", 0) };
        Point end = new Point { X = (int)Number(command, "x", 0), Y = (int)Number(command, "y", 0) };
        string action;
        lock (PickerLock)
        {
            if (picker != "zone") return;
            picker = "";
            zoneDrawing = false;
            action = zoneAction;
        }
        int x = Math.Min(start.X, end.X), y = Math.Min(start.Y, end.Y);
        int width = Math.Max(1, Math.Abs(start.X - end.X)), height = Math.Max(1, Math.Abs(start.Y - end.Y));
        if (width < 8 || height < 8)
        {
            statusMessage = "A zona ficou pequena demais; tente desenhar uma área maior.";
            Emit("picker", new Dictionary<string, object> { { "active", false }, { "cancelled", true }, { "kind", "zone" }, { "message", statusMessage } });
        }
        else
        {
            Emit("zone", new Dictionary<string, object> { { "x", x }, { "y", y }, { "width", width }, { "height", height }, { "action", action } });
            statusMessage = "Zona configurada.";
            Emit("picker", new Dictionary<string, object> { { "active", false }, { "kind", "zone" }, { "message", statusMessage } });
        }
        EmitState();
    }

    private static void MouseHookLoop()
    {
        mouseHookThreadId = GetCurrentThreadId();
        mouseHook = SetWindowsHookEx(14, MouseHookCallbackReference, IntPtr.Zero, 0);
        keyboardHook = SetWindowsHookEx(13, KeyboardHookCallbackReference, IntPtr.Zero, 0);
        MouseHookReady.Set();
        if (mouseHook == IntPtr.Zero && keyboardHook == IntPtr.Zero) return;
        NativeMessage message;
        while (GetMessage(out message, IntPtr.Zero, 0, 0) > 0) { }
        if (mouseHook != IntPtr.Zero) UnhookWindowsHookEx(mouseHook);
        if (keyboardHook != IntPtr.Zero) UnhookWindowsHookEx(keyboardHook);
        mouseHook = IntPtr.Zero;
        keyboardHook = IntPtr.Zero;
    }

    private static IntPtr KeyboardHookCallback(int code, IntPtr message, IntPtr data)
    {
        if (code >= 0)
        {
            int kind = message.ToInt32();
            bool down = kind == 0x0100 || kind == 0x0104;
            bool up = kind == 0x0101 || kind == 0x0105;
            if (down || up)
            {
                KeyboardHookInfo info = (KeyboardHookInfo)Marshal.PtrToStructure(data, typeof(KeyboardHookInfo));
                bool pressed = down;
                lock (PickerLock)
                {
                    switch ((int)info.VirtualKey)
                    {
                        case 0x10: shiftDown = pressed || leftShiftDown || rightShiftDown; break;
                        case 0xA0: leftShiftDown = pressed; shiftDown = pressed || rightShiftDown; break;
                        case 0xA1: rightShiftDown = pressed; shiftDown = pressed || leftShiftDown; break;
                        case 0x11: controlDown = pressed || leftControlDown || rightControlDown; break;
                        case 0xA2: leftControlDown = pressed; controlDown = pressed || rightControlDown; break;
                        case 0xA3: rightControlDown = pressed; controlDown = pressed || leftControlDown; break;
                    }
                }
            }
        }
        return CallNextHookEx(keyboardHook, code, message, data);
    }

    private static IntPtr MouseHookCallback(int code, IntPtr message, IntPtr data)
    {
        if (code >= 0)
        {
            int kind = message.ToInt32();
            if (kind == 0x0204 || kind == 0x0205 || kind == 0x0206)
            {
                MouseHookInfo info = (MouseHookInfo)Marshal.PtrToStructure(data, typeof(MouseHookInfo));
                lock (PickerLock)
                {
                    if (kind == 0x0205 && swallowPickerRightUp)
                    {
                        swallowPickerRightUp = false;
                        if (picker == "zone" && zoneDrawing)
                        {
                            zoneDrawing = false;
                            Input.Enqueue(Json.Serialize(new Dictionary<string, object> {
                                { "type", "picker-zone-finish" }, { "startX", zoneStart.X }, { "startY", zoneStart.Y },
                                { "x", info.Point.X }, { "y", info.Point.Y }
                            }));
                        }
                        return new IntPtr(1);
                    }
                    if ((kind == 0x0204 || kind == 0x0206) && picker.Length > 0)
                    {
                        swallowPickerRightUp = true;
                        if (picker == "point")
                        {
                            bool remove = keyboardHook == IntPtr.Zero ? IsDown(0x11) : controlDown;
                            Input.Enqueue(Json.Serialize(new Dictionary<string, object> {
                                { "type", remove ? "picker-delete-point" : "picker-point" }, { "x", info.Point.X }, { "y", info.Point.Y },
                                { "shift", keyboardHook == IntPtr.Zero ? IsDown(0x10) : shiftDown }
                            }));
                        }
                        else if (picker == "zone" && !zoneDrawing)
                        {
                            zoneStart = info.Point;
                            zoneDrawing = true;
                        }
                        return new IntPtr(1);
                    }
                }
            }
        }
        return CallNextHookEx(mouseHook, code, message, data);
    }

    private static bool CheckSafety()
    {
        Point p;
        if (!GetCursorPos(out p)) return false;
        if (Boolean(settings, "taskSwitcherStopEnabled", true) && ((IsDown(0x12) && IsDown(0x09)) || ((IsDown(0x5B) || IsDown(0x5C)) && IsDown(0x09))))
        {
            Stop("Parado ao abrir a visão de tarefas.");
            return true;
        }
        string process = ForegroundProcess();
        if (Boolean(settings, "processListEnabled", false))
        {
            object raw;
            IEnumerable entries = settings.TryGetValue("processListEntries", out raw) ? raw as IEnumerable : null;
            bool listed = false;
            if (entries != null) foreach (object item in entries)
            {
                Dictionary<string, object> entry = item as Dictionary<string, object>;
                if (entry != null && Boolean(entry, "enabled", true) && String.Equals(Text(entry, "name", ""), process, StringComparison.OrdinalIgnoreCase)) listed = true;
            }
            bool allowed = Text(settings, "processListMode", "whitelist") == "whitelist" ? listed : !listed;
            if (!allowed) { paused = true; processMessage = "Pausado fora dos aplicativos permitidos."; return false; }
            if (processMessage.Length > 0) { processMessage = ""; if (paused && !pausedByZone) paused = false; }
        }
        else if (processMessage.Length > 0) { processMessage = ""; if (paused && !pausedByZone) paused = false; }
        int vx = GetSystemMetrics(76), vy = GetSystemMetrics(77), vw = GetSystemMetrics(78), vh = GetSystemMetrics(79);
        int left = (int)Number(settings, "edgeStopLeft", 40), right = (int)Number(settings, "edgeStopRight", 40), top = (int)Number(settings, "edgeStopTop", 40), bottom = (int)Number(settings, "edgeStopBottom", 40);
        if (Boolean(settings, "edgeStopEnabled", true) && (p.X <= vx + left || p.X >= vx + vw - right || p.Y <= vy + top || p.Y >= vy + vh - bottom))
        {
            Stop("Parado perto da borda da tela.");
            return true;
        }
        if (Boolean(settings, "cornerStopEnabled", true))
        {
            int tl = (int)Number(settings, "cornerStopTL", 50), tr = (int)Number(settings, "cornerStopTR", 50), bl = (int)Number(settings, "cornerStopBL", 50), br = (int)Number(settings, "cornerStopBR", 50);
            if ((p.X <= vx + tl && p.Y <= vy + tl) || (p.X >= vx + vw - tr && p.Y <= vy + tr) || (p.X <= vx + bl && p.Y >= vy + vh - bl) || (p.X >= vx + vw - br && p.Y >= vy + vh - br))
            {
                Stop("Parado em um canto de segurança.");
                return true;
            }
        }
        if (Boolean(settings, "stopZonesEnabled", false))
        {
            object raw;
            IEnumerable zones = settings.TryGetValue("stopZones", out raw) ? raw as IEnumerable : null;
            bool inPause = false, inStart = false;
            if (zones != null) foreach (object item in zones)
            {
                Dictionary<string, object> zone = item as Dictionary<string, object>;
                if (zone == null || p.X < Number(zone, "x", 0) || p.Y < Number(zone, "y", 0) || p.X > Number(zone, "x", 0) + Number(zone, "width", 0) || p.Y > Number(zone, "y", 0) + Number(zone, "height", 0)) continue;
                string action = Text(zone, "action", "stop");
                if (action == "stop") { Stop("Parado dentro de uma zona de segurança."); return true; }
                if (action == "pause") inPause = true;
                if (action == "start") inStart = true;
            }
            if (inPause) { paused = true; pausedByZone = true; statusMessage = "Pausado dentro de uma zona."; }
            else if (pausedByZone) { paused = false; pausedByZone = false; statusMessage = "Retomado fora da zona."; }
            if (inStart && !previousStartZone && !running) SetActive(true, "Ativado ao entrar na zona de início.");
            previousStartZone = inStart;
        }
        return false;
    }

    private static void RunCycle()
    {
        double interval = BaseInterval();
        Point original, target;
        GetCursorPos(out original);
        target = original;
        bool usingFixedPoint = false;
        if (Boolean(settings, "clickPointsEnabled", false))
        {
            object raw;
            IEnumerable points = settings.TryGetValue("clickPoints", out raw) ? raw as IEnumerable : null;
            if (points != null)
            {
                List<object> pointList = new List<object>();
                foreach (object item in points) pointList.Add(item);
                if (pointList.Count == 0) return;
                if (pointIndex >= pointList.Count) pointIndex = 0;
                Dictionary<string, object> point = pointList[pointIndex] as Dictionary<string, object>;
                if (point != null)
                {
                    usingFixedPoint = true;
                    target.X = (int)Number(point, "x", original.X);
                    target.Y = (int)Number(point, "y", original.Y);
                    int radius = (int)Number(point, "radius", 0);
                    if (radius > 0) { double angle = Random.NextDouble() * Math.PI * 2, distance = Math.Sqrt(Random.NextDouble()) * radius; target.X += (int)Math.Round(Math.Cos(angle) * distance); target.Y += (int)Math.Round(Math.Sin(angle) * distance); }
                    if (pointRemaining < 0) pointRemaining = (int)Number(point, "clicks", 1);
                }
            }
        }
        if (!usingFixedPoint)
        {
            if (original.X == lastPointX && original.Y == lastPointY) { target.X = lastBaseX; target.Y = lastBaseY; }
            else { lastBaseX = original.X; lastBaseY = original.Y; }
        }
        if (Number(settings, "offset", 0) > 0 && Random.Next(100) < Number(settings, "offsetChance", 100))
        {
            double angle = Random.NextDouble() * Math.PI * 2, distance = Math.Sqrt(Random.NextDouble()) * Number(settings, "offset", 0);
            target.X += (int)Math.Round(Math.Cos(angle) * distance); target.Y += (int)Math.Round(Math.Sin(angle) * distance);
        }
        if (IsUnsafeTarget(target)) return;
        if (target.X != lastPointX || target.Y != lastPointY)
        {
            MoveCursor(original, target);
            lastPointX = target.X; lastPointY = target.Y;
        }
        double cps = 1000.0 / Math.Max(1, interval);
        double duty = Number(settings, "dutyCycle", 45) / 100.0;
        if (!Boolean(settings, "dutyCycleEnabled", true)) duty = 0.01;
        if (cps > 500) duty = Math.Min(duty, 0.01);
        else if (cps >= 200) duty = Math.Min(duty, 0.30);
        else if (cps >= 100) duty = Math.Min(duty, 0.70);
        else if (cps >= 50) duty = Math.Min(duty, 0.98);
        int clickCount = Boolean(settings, "doubleClickEnabled", false) && cps < 11 ? 2 : 1;
        double gap = clickCount > 1 ? Math.Min(Number(settings, "doubleClickGapMs", 45), Math.Max(0, interval / 3)) : 0;
        // Match Blur's millisecond hold timing: sub-millisecond holds become an immediate down/up pair.
        double hold = Math.Max(0, Math.Min(1000, Math.Floor(interval * duty)));
        if (clickCount > 1) hold = Math.Max(0, Math.Min(hold, Math.Floor((interval - gap) / 2)));
        for (int index = 0; index < clickCount && running; index++)
        {
            if (Text(settings, "inputType", "mouse") == "keyboard") PressKey(Text(settings, "keyboardKey", "A"), Text(settings, "keyboardKeyCase", "lower"));
            else PressMouse(Text(settings, "mouseButton", "Left"), hold);
            runClicks++; totalClicks++;
            if (pointRemaining > 0) pointRemaining--;
            settings["totalClicks"] = totalClicks;
            if (Boolean(settings, "clickLimitEnabled", false) && runClicks >= Number(settings, "clickLimit", 1000)) { Stop("Limite de cliques atingido."); break; }
            if (Boolean(settings, "doubleClickEnabled", false) && index == 0 && clickCount > 1) WaitMilliseconds(gap);
        }
        AdvancePointIfNeeded();
        CheckTimeLimit();
    }

    private static bool CanBatchMouseInputs(double interval)
    {
        if (Text(settings, "inputType", "mouse") != "mouse" ||
            Boolean(settings, "doubleClickEnabled", false) ||
            Boolean(settings, "speedRandomizationEnabled", false) ||
            Boolean(settings, "clickPointsEnabled", false) ||
            Number(settings, "offset", 0) > 0 || Number(settings, "smoothing", 0) > 0) return false;

        double cps = 1000.0 / Math.Max(1, interval);
        double duty = Number(settings, "dutyCycle", 45) / 100.0;
        if (!Boolean(settings, "dutyCycleEnabled", true)) duty = 0.01;
        if (cps > 500) duty = Math.Min(duty, 0.01);
        else if (cps >= 200) duty = Math.Min(duty, 0.30);
        else if (cps >= 100) duty = Math.Min(duty, 0.70);
        else if (cps >= 50) duty = Math.Min(duty, 0.98);
        return Math.Floor(Math.Max(0, Math.Min(1000, interval * duty))) < 1;
    }

    private static void RunFastMouseBatch(int requestedClicks)
    {
        Point cursor;
        if (!GetCursorPos(out cursor) || IsUnsafeTarget(cursor)) return;

        int clicks = requestedClicks;
        if (Boolean(settings, "clickLimitEnabled", false))
        {
            int remaining = Math.Max(0, (int)Number(settings, "clickLimit", 1000) - (int)runClicks);
            clicks = Math.Min(clicks, remaining);
            if (clicks == 0) { Stop("Limite de cliques atingido."); return; }
        }

        string button = Text(settings, "mouseButton", "Left");
        uint down = button == "Right" ? RightDown : button == "Middle" ? MiddleDown : LeftDown;
        uint up = button == "Right" ? RightUp : button == "Middle" ? MiddleUp : LeftUp;
        SendMouseClickBatch(down, up, clicks);
        runClicks += clicks;
        totalClicks += clicks;
        settings["totalClicks"] = totalClicks;

        if (Boolean(settings, "clickLimitEnabled", false) && runClicks >= Number(settings, "clickLimit", 1000))
            Stop("Limite de cliques atingido.");
        CheckTimeLimit();
    }

    private static void CheckTimeLimit()
    {
        if (!Boolean(settings, "timeLimitEnabled", false)) return;
        double limit = Number(settings, "timeLimit", 60) * (Text(settings, "timeLimitUnit", "s") == "h" ? 3600000 : Text(settings, "timeLimitUnit", "s") == "m" ? 60000 : 1000);
        if (Clock.Elapsed.TotalMilliseconds - startedAt >= limit) Stop("Limite de tempo atingido.");
    }

    private static bool IsUnsafeTarget(Point target)
    {
        int vx = GetSystemMetrics(76), vy = GetSystemMetrics(77), vw = GetSystemMetrics(78), vh = GetSystemMetrics(79);
        int left = (int)Number(settings, "edgeStopLeft", 40), right = (int)Number(settings, "edgeStopRight", 40);
        int top = (int)Number(settings, "edgeStopTop", 40), bottom = (int)Number(settings, "edgeStopBottom", 40);
        if (Boolean(settings, "edgeStopEnabled", true) && (target.X <= vx + left || target.X >= vx + vw - right || target.Y <= vy + top || target.Y >= vy + vh - bottom))
        {
            Stop("Ponto de clique bloqueado pela proteção de borda.");
            return true;
        }
        if (Boolean(settings, "cornerStopEnabled", true))
        {
            int tl = (int)Number(settings, "cornerStopTL", 50), tr = (int)Number(settings, "cornerStopTR", 50);
            int bl = (int)Number(settings, "cornerStopBL", 50), br = (int)Number(settings, "cornerStopBR", 50);
            if ((target.X <= vx + tl && target.Y <= vy + tl) || (target.X >= vx + vw - tr && target.Y <= vy + tr) ||
                (target.X <= vx + bl && target.Y >= vy + vh - bl) || (target.X >= vx + vw - br && target.Y >= vy + vh - br))
            {
                Stop("Ponto de clique bloqueado pela proteção dos cantos.");
                return true;
            }
        }
        if (Boolean(settings, "stopZonesEnabled", false))
        {
            object raw;
            IEnumerable zones = settings.TryGetValue("stopZones", out raw) ? raw as IEnumerable : null;
            if (zones != null) foreach (object item in zones)
            {
                Dictionary<string, object> zone = item as Dictionary<string, object>;
                if (zone == null) continue;
                if (target.X >= Number(zone, "x", 0) && target.Y >= Number(zone, "y", 0) &&
                    target.X <= Number(zone, "x", 0) + Number(zone, "width", 0) && target.Y <= Number(zone, "y", 0) + Number(zone, "height", 0) &&
                    (Text(zone, "action", "stop") == "stop" || Text(zone, "action", "stop") == "pause"))
                {
                    Stop("Ponto de clique bloqueado por uma zona de segurança.");
                    return true;
                }
            }
        }
        return false;
    }

    private static void AdvancePointIfNeeded()
    {
        if (!Boolean(settings, "clickPointsEnabled", false) || pointRemaining != 0) return;
        object raw;
        IEnumerable rawPoints = settings.TryGetValue("clickPoints", out raw) ? raw as IEnumerable : null;
        List<object> points = new List<object>();
        if (rawPoints != null) foreach (object item in rawPoints) points.Add(item);
        if (points.Count == 0) return;
        pointIndex++;
        pointRemaining = -1;
        if (pointIndex >= points.Count)
        {
            if (Boolean(settings, "stopWhenComplete", false)) { Stop("Todos os pontos foram concluídos."); return; }
            pointIndex = 0;
        }
        lastPointX = int.MinValue;
    }

    private static void MoveCursor(Point from, Point to)
    {
        int smoothing = (int)Number(settings, "smoothing", 0);
        if (smoothing <= 0) { SetCursorPos(to.X, to.Y); return; }
        int steps = Math.Max(2, Math.Min(24, smoothing / 4));
        for (int i = 1; i <= steps && running; i++)
        {
            SetCursorPos(from.X + (to.X - from.X) * i / steps, from.Y + (to.Y - from.Y) * i / steps);
            Thread.Sleep(1);
        }
    }

    private static void PressMouse(string button, double hold)
    {
        uint down = button == "Right" ? RightDown : button == "Middle" ? MiddleDown : LeftDown;
        uint up = button == "Right" ? RightUp : button == "Middle" ? MiddleUp : LeftUp;
        if (hold <= 0)
        {
            SendMouseClick(down, up);
            return;
        }
        SendMouseInput(down);
        try { WaitMilliseconds(hold); }
        finally { SendMouseInput(up); }
    }

    private static InputRecord CreateMouseInput(uint flags)
    {
        return new InputRecord {
            Type = InputMouse,
            Union = new InputUnion { Mouse = new MouseInputData { Flags = flags, ExtraInfo = UIntPtr.Zero } }
        };
    }

    private static void SendMouseInput(uint flags)
    {
        InputRecord[] input = new InputRecord[] { CreateMouseInput(flags) };
        if (SendInput(1, input, Marshal.SizeOf(typeof(InputRecord))) != 1)
            throw new InvalidOperationException("O Windows não aceitou a entrada do mouse (erro " + Marshal.GetLastWin32Error() + ").");
    }

    private static void SendMouseClick(uint down, uint up)
    {
        SendMouseClickBatch(down, up, 1);
    }

    private static void SendMouseClickBatch(uint down, uint up, int count)
    {
        InputRecord[] inputs = new InputRecord[count * 2];
        for (int i = 0; i < count; i++)
        {
            inputs[i * 2] = CreateMouseInput(down);
            inputs[i * 2 + 1] = CreateMouseInput(up);
        }
        if (SendInput((uint)inputs.Length, inputs, Marshal.SizeOf(typeof(InputRecord))) != inputs.Length)
            throw new InvalidOperationException("O Windows não aceitou o clique do mouse (erro " + Marshal.GetLastWin32Error() + ").");
    }

    private static void PressKey(string keyName, string casing)
    {
        int key = VirtualKey(keyName);
        if (key <= 0) return;
        bool desiredUpper = casing == "upper";
        bool caps = (GetKeyState(0x14) & 1) != 0;
        bool shift = desiredUpper != caps;
        if (shift) keybd_event(0x10, 0, 0, UIntPtr.Zero);
        keybd_event((byte)key, 0, 0, UIntPtr.Zero);
        try { Thread.Sleep(2); }
        finally
        {
            keybd_event((byte)key, 0, KeyUp, UIntPtr.Zero);
            if (shift) keybd_event(0x10, 0, KeyUp, UIntPtr.Zero);
        }
    }

    private static void ReleaseInputs()
    {
        try { SendMouseInput(LeftUp); } catch { }
        try { SendMouseInput(RightUp); } catch { }
        try { SendMouseInput(MiddleUp); } catch { }
        keybd_event(0x10, 0, KeyUp, UIntPtr.Zero);
    }

    private static double NextInterval()
    {
        double interval = BaseInterval();
        if (Boolean(settings, "speedRandomizationEnabled", false))
        {
            double spread = Math.Max(0, Math.Min(200, Number(settings, "speedRandomization", 35))) / 100.0;
            interval *= Math.Max(0.25, 1.0 + Gaussian() * spread / 3.0);
        }
        return Math.Max(MinimumClickIntervalMs, interval);
    }

    private static int BatchCycleCount(double interval)
    {
        double cps = 1000.0 / Math.Max(MinimumClickIntervalMs, interval);
        if (cps > 500) return 3;
        if (cps >= 50) return 2;
        return 1;
    }

    private static void SetTimerResolution(bool enabled)
    {
        if (enabled == timerResolutionHeld) return;
        uint actualResolution;
        int status = NtSetTimerResolution(10000, (byte)(enabled ? 1 : 0), out actualResolution);
        if (status == 0) timerResolutionHeld = enabled;
    }

    private static void WaitForNextCycle()
    {
        if (!running || paused)
        {
            Thread.Sleep(8);
            return;
        }
        double remaining = nextClickAt - Clock.Elapsed.TotalMilliseconds;
        if (remaining <= 0) { Thread.SpinWait(100); return; }
        if (!timerResolutionHeld || remaining <= MinimumClickIntervalMs - 0.5) { Thread.SpinWait(100); return; }
        int sleep = (int)Math.Min(5, Math.Max(1, Math.Floor(remaining - 1.0)));
        Thread.Sleep(sleep);
    }

    private static double BaseInterval()
    {
        if (Text(settings, "rateInputMode", "rate") == "duration")
        {
            double ms = Number(settings, "durationHours", 0) * 3600000 + Number(settings, "durationMinutes", 0) * 60000 + Number(settings, "durationSeconds", 0) * 1000 + Number(settings, "durationMilliseconds", 100);
            return Math.Max(MinimumClickIntervalMs, ms);
        }
        double unit = Text(settings, "clickInterval", "s") == "d" ? 86400000 : Text(settings, "clickInterval", "s") == "h" ? 3600000 : Text(settings, "clickInterval", "s") == "m" ? 60000 : 1000;
        return Math.Max(MinimumClickIntervalMs, unit / Math.Max(1, Number(settings, "clickSpeed", 10)));
    }

    private static double Gaussian()
    {
        double u1 = 1.0 - Random.NextDouble(), u2 = 1.0 - Random.NextDouble();
        return Math.Sqrt(-2.0 * Math.Log(u1)) * Math.Sin(2.0 * Math.PI * u2);
    }

    private static void WaitMilliseconds(double milliseconds)
    {
        if (milliseconds <= 0) return;
        double deadline = Clock.Elapsed.TotalMilliseconds + milliseconds;
        while (running)
        {
            if (stopRequested) { DrainCommands(); stopRequested = false; }
            double remaining = deadline - Clock.Elapsed.TotalMilliseconds;
            if (remaining <= 0) break;
            if (timerResolutionHeld && remaining > 1.5)
            {
                int sleep = (int)Math.Min(5, Math.Max(1, Math.Floor(remaining - 1.0)));
                Thread.Sleep(sleep);
            }
            else Thread.SpinWait(80);
        }
    }

    private static bool IsDown(int key) { return (GetAsyncKeyState(key) & 0x8000) != 0; }
    private static int VirtualKey(string value)
    {
        string key = value.Trim().ToUpperInvariant();
        if (key.Length == 1)
        {
            char c = key[0];
            if (c >= 'A' && c <= 'Z' || c >= '0' && c <= '9') return c;
        }
        if (key.Length >= 2 && key[0] == 'F')
        {
            int f; if (Int32.TryParse(key.Substring(1), out f) && f >= 1 && f <= 24) return 0x70 + f - 1;
        }
        if (key.StartsWith("NUMPAD") && key.Length == 7 && key[6] >= '0' && key[6] <= '9') return 0x60 + key[6] - '0';
        switch (key)
        {
            case "SPACE": return 0x20; case "TAB": return 0x09; case "ENTER": return 0x0D; case "ESCAPE": return 0x1B;
            case "BACKSPACE": return 0x08; case "INSERT": return 0x2D; case "DELETE": return 0x2E; case "HOME": return 0x24;
            case "END": return 0x23; case "PAGEUP": return 0x21; case "PAGEDOWN": return 0x22; case "UP": return 0x26;
            case "DOWN": return 0x28; case "LEFT": return 0x25; case "RIGHT": return 0x27; case "PRINTSCREEN": return 0x2C;
            case "CAPSLOCK": return 0x14; case "NUMLOCK": return 0x90; case "SCROLLLOCK": return 0x91; case "PAUSE": return 0x13;
            case "PLUS": return 0xBB; case "MINUS": return 0xBD; case "DECIMAL": return 0x6E; case "MULTIPLY": return 0x6A;
            case "ADD": return 0x6B; case "SUBTRACT": return 0x6D; case "DIVIDE": return 0x6F;
            default: return 0;
        }
    }

    private static string ForegroundProcess()
    {
        uint processId;
        GetWindowThreadProcessId(GetForegroundWindow(), out processId);
        try { return Process.GetProcessById((int)processId).ProcessName; }
        catch { return ""; }
    }

    private static void EmitProcessList()
    {
        List<Dictionary<string, object>> items = new List<Dictionary<string, object>>();
        HashSet<string> seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        Process[] processes;
        try { processes = Process.GetProcesses(); }
        catch { Emit("processes", new Dictionary<string, object> { { "items", items }, { "message", "Não foi possível ler os aplicativos abertos." } }); return; }
        foreach (Process process in processes)
        {
            try
            {
                string name = process.ProcessName;
                string title = process.MainWindowTitle == null ? "" : process.MainWindowTitle.Trim();
                if (String.IsNullOrWhiteSpace(name) || String.IsNullOrWhiteSpace(title) || !seen.Add(name)) continue;
                items.Add(new Dictionary<string, object> { { "name", name }, { "displayName", title }, { "pid", process.Id } });
            }
            catch { }
            finally { try { process.Dispose(); } catch { } }
        }
        items.Sort((a, b) => String.Compare(Text(a, "displayName", ""), Text(b, "displayName", ""), StringComparison.CurrentCultureIgnoreCase));
        Emit("processes", new Dictionary<string, object> { { "items", items } });
    }

    private static void EmitState()
    {
        string status = !running ? "Parado" : paused ? "Pausado" : "Ativo";
        string message = processMessage.Length > 0 ? processMessage : statusMessage;
        Emit("state", new Dictionary<string, object> {
            { "active", running }, { "paused", paused }, { "runClicks", runClicks }, { "totalClicks", totalClicks },
            { "status", status }, { "message", message }, { "hotkey", Text(settings, "hotkey", "F6") }, { "picker", picker }
        });
    }

    private static void Emit(string type, Dictionary<string, object> payload)
    {
        payload["type"] = type;
        lock (OutputLock)
        {
            try { Console.Out.WriteLine(Json.Serialize(payload)); Console.Out.Flush(); }
            catch { }
        }
    }

    private static Dictionary<string, object> Dict(Dictionary<string, object> source, string key)
    {
        object value;
        return source != null && source.TryGetValue(key, out value) && value is Dictionary<string, object> ? (Dictionary<string, object>)value : new Dictionary<string, object>();
    }

    private static string Text(Dictionary<string, object> source, string key, string fallback)
    {
        object value;
        return source != null && source.TryGetValue(key, out value) && value != null ? Convert.ToString(value) : fallback;
    }

    private static double Number(Dictionary<string, object> source, string key, double fallback)
    {
        object value;
        double result;
        return source != null && source.TryGetValue(key, out value) && Double.TryParse(Convert.ToString(value), out result) ? result : fallback;
    }

    private static bool Boolean(Dictionary<string, object> source, string key, bool fallback)
    {
        object value;
        if (source == null || !source.TryGetValue(key, out value) || value == null) return fallback;
        try { return Convert.ToBoolean(value); } catch { return fallback; }
    }
}
