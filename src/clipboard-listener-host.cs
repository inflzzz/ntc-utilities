using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;

public static class NtcClipboardListenerHost
{
    private const int WmClipboardUpdate = 0x031D;
    private const int WmApp = 0x8000;
    private const int WmStop = WmApp + 63;
    private const uint CfHDrop = 15;
    private static readonly JavaScriptSerializer Json = new JavaScriptSerializer();
    private static readonly object OutputLock = new object();
    private static ListenerWindow listenerWindow;
    private static ApplicationContext application;
    private static bool isListening;

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool AddClipboardFormatListener(IntPtr window);
    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool RemoveClipboardFormatListener(IntPtr window);
    [DllImport("user32.dll")]
    private static extern bool IsClipboardFormatAvailable(uint format);
    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool PostMessage(IntPtr window, int message, IntPtr wParam, IntPtr lParam);

    public static void Run()
    {
        Console.OutputEncoding = new UTF8Encoding(false);
        application = new ApplicationContext();
        listenerWindow = new ListenerWindow();
        var reader = new Thread(ReadCommands) { IsBackground = true, Name = "NtcClipboardCommands" };
        reader.Start();

        if (!SetListening(true))
        {
            Emit("error", new Dictionary<string, object> { { "message", "O Windows não permitiu observar alterações da área de transferência." } });
            application.ExitThread();
        }
        else
        {
            Emit("ready", new Dictionary<string, object>());
        }

        Application.Run(application);
        SetListening(false);
        listenerWindow.Dispose();
        listenerWindow = null;
    }

    private static void ReadCommands()
    {
        try
        {
            string line;
            while (true)
            {
                line = Console.ReadLine();
                if (line == null) { RequestStop(); return; }
                int message;
                switch (line.Trim().ToLowerInvariant())
                {
                    case "stop": message = WmStop; break;
                    default: continue;
                }
                ListenerWindow current = listenerWindow;
                if (current == null || !PostMessage(current.Handle, message, IntPtr.Zero, IntPtr.Zero))
                {
                    if (message == WmStop) return;
                    Emit("error", new Dictionary<string, object> { { "message", "Não foi possível encerrar o observador da área de transferência." } });
                }
                if (message == WmStop) return;
            }
        }
        catch { RequestStop(); }
    }

    private static void RequestStop()
    {
        ListenerWindow current = listenerWindow;
        if (current == null) return;
        try { PostMessage(current.Handle, WmStop, IntPtr.Zero, IntPtr.Zero); }
        catch { }
    }

    private static bool SetListening(bool enabled)
    {
        if (listenerWindow == null) return false;
        if (enabled == isListening) return true;
        bool succeeded = enabled
            ? AddClipboardFormatListener(listenerWindow.Handle)
            : RemoveClipboardFormatListener(listenerWindow.Handle);
        if (succeeded) isListening = enabled;
        return succeeded;
    }

    private static void OnWindowMessage(ListenerWindow window, ref Message message)
    {
        if (message.Msg == WmClipboardUpdate)
        {
            Emit("change", new Dictionary<string, object> { { "files", IsClipboardFormatAvailable(CfHDrop) } });
            return;
        }
        if (message.Msg == WmStop)
        {
            SetListening(false);
            window.ReleaseHandle();
            application.ExitThread();
            return;
        }
        window.Forward(ref message);
    }

    private static void Emit(string type, Dictionary<string, object> payload)
    {
        payload["type"] = type;
        lock (OutputLock)
        {
            try { Console.WriteLine(Json.Serialize(payload)); Console.Out.Flush(); }
            catch { }
        }
    }

    private sealed class ListenerWindow : NativeWindow, IDisposable
    {
        public ListenerWindow()
        {
            var parameters = new CreateParams { Caption = "NTC Utilities Clipboard Listener", ClassName = "STATIC" };
            CreateHandle(parameters);
        }

        public void Forward(ref Message message) { base.WndProc(ref message); }

        protected override void WndProc(ref Message message)
        {
            OnWindowMessage(this, ref message);
        }

        public void Dispose()
        {
            if (Handle != IntPtr.Zero) DestroyHandle();
        }
    }
}
