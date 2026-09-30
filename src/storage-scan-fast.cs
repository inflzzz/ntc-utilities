using System;
using System.Collections.Generic;
using System.IO;
using System.Diagnostics;
using System.Text;
using System.Threading;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;

internal static class StorageScanFast
{
    private const uint FileListDirectory = 0x0001;
    private const uint FileShareRead = 0x00000001;
    private const uint FileShareWrite = 0x00000002;
    private const uint FileShareDelete = 0x00000004;
    private const uint OpenExisting = 3;
    private const uint FileFlagBackupSemantics = 0x02000000;
    private const int FileIdBothDirectoryInfo = 10;
    private const int FileIdBothDirectoryRestartInfo = 11;
    private const int ErrorNoMoreFiles = 18;
    private const uint FileAttributeDirectory = 0x10;
    private const uint FileAttributeReparsePoint = 0x400;
    private const int BufferSize = 1024 * 1024;
    private const int FileNameOffset = 104;
    private static readonly object OutputLock = new object();
    private static readonly object WorkLock = new object();
    private static readonly Queue<FolderJob> WorkQueue = new Queue<FolderJob>();
    private static BinaryWriter Output;
    private static bool Finished;
    private static int UnsupportedEntry;
    private static int FatalError;
    private static int ActiveWorkers;
    private static int NextId;
    private static long ApiTicks;
    private static long BatchCalls;
    private static long DirectoryCount;

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern SafeFileHandle CreateFileW(string name, uint access, uint share, IntPtr security, uint creation, uint flags, IntPtr template);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GetFileInformationByHandleEx(SafeFileHandle handle, int infoClass, IntPtr buffer, uint size);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool GetVolumePathNameW(string fileName, StringBuilder volumePathName, uint bufferLength);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool GetVolumeInformationW(string rootPathName, StringBuilder volumeNameBuffer, uint volumeNameSize, IntPtr volumeSerialNumber, IntPtr maximumComponentLength, IntPtr fileSystemFlags, StringBuilder fileSystemNameBuffer, uint fileSystemNameSize);

    private sealed class FolderJob
    {
        public string Path;
        public int Id;
        public int ParentId;
        public FolderJob(string path, int id, int parentId) { Path = path; Id = id; ParentId = parentId; }
    }

    private static string ExtendedPath(string value)
    {
        string full = Path.GetFullPath(value);
        if (full.StartsWith("\\\\?\\", StringComparison.Ordinal)) return full;
        if (full.StartsWith("\\\\", StringComparison.Ordinal)) return "\\\\?\\UNC\\" + full.Substring(2);
        return "\\\\?\\" + full;
    }

    private static bool IsNtfs(string root)
    {
        StringBuilder volumePath = new StringBuilder(32768);
        StringBuilder fileSystemName = new StringBuilder(64);
        if (!GetVolumePathNameW(Path.GetFullPath(root), volumePath, (uint)volumePath.Capacity)) return false;
        if (!GetVolumeInformationW(volumePath.ToString(), null, 0, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, fileSystemName, (uint)fileSystemName.Capacity)) return false;
        return String.Equals(fileSystemName.ToString(), "NTFS", StringComparison.OrdinalIgnoreCase);
    }

    private static void WriteRecord(byte kind, int id, int parentId, long size, long allocation, long modified, ulong fileId, uint attributes, string name)
    {
        if (name == null) name = String.Empty;
        if (name.Length > UInt16.MaxValue) name = name.Substring(0, UInt16.MaxValue);
        byte[] nameBytes = Encoding.Unicode.GetBytes(name);
        lock (OutputLock)
        {
            Output.Write(kind); Output.Write(id); Output.Write(parentId); Output.Write(size); Output.Write(allocation);
            Output.Write(modified); Output.Write(fileId); Output.Write(attributes); Output.Write((ushort)name.Length); Output.Write(nameBytes);
        }
    }

    private static int WriteEntry(byte kind, int parentId, long size, long allocation, long modified, ulong fileId, uint attributes, string name)
    {
        if (name == null) name = String.Empty;
        if (name.Length > UInt16.MaxValue) name = name.Substring(0, UInt16.MaxValue);
        byte[] nameBytes = Encoding.Unicode.GetBytes(name);
        lock (OutputLock)
        {
            int id = NextId++;
            Output.Write(kind); Output.Write(id); Output.Write(parentId); Output.Write(size); Output.Write(allocation);
            Output.Write(modified); Output.Write(fileId); Output.Write(attributes); Output.Write((ushort)name.Length); Output.Write(nameBytes);
            return id;
        }
    }

    private static void QueueFolder(FolderJob folder)
    {
        lock (WorkLock)
        {
            if (Finished || UnsupportedEntry != 0 || FatalError != 0) return;
            WorkQueue.Enqueue(folder);
            Monitor.PulseAll(WorkLock);
        }
    }

    private static void ScanFolder(FolderJob folder, IntPtr buffer)
    {
        Interlocked.Increment(ref DirectoryCount);
        WriteRecord(6, folder.Id, folder.ParentId, 0, 0, 0, 0, 0, String.Empty);
        using (SafeFileHandle handle = CreateFileW(folder.Path, FileListDirectory, FileShareRead | FileShareWrite | FileShareDelete, IntPtr.Zero, OpenExisting, FileFlagBackupSemantics, IntPtr.Zero))
        {
            if (handle.IsInvalid)
            {
                int error = Marshal.GetLastWin32Error();
                if (folder.Id == 0) Interlocked.Exchange(ref FatalError, error == 0 ? 1 : error);
                else WriteRecord(4, 0, folder.Id, error, 0, 0, 0, 0, folder.Path);
                return;
            }

            bool directoryHadRecords = false;
            bool restart = true;
            while (Interlocked.CompareExchange(ref UnsupportedEntry, 0, 0) == 0 && Interlocked.CompareExchange(ref FatalError, 0, 0) == 0)
            {
                int infoClass = restart ? FileIdBothDirectoryRestartInfo : FileIdBothDirectoryInfo;
                restart = false;
                Stopwatch callTimer = Stopwatch.StartNew();
                bool succeeded = GetFileInformationByHandleEx(handle, infoClass, buffer, BufferSize);
                callTimer.Stop(); Interlocked.Add(ref ApiTicks, callTimer.Elapsed.Ticks); Interlocked.Increment(ref BatchCalls);
                if (!succeeded)
                {
                    int error = Marshal.GetLastWin32Error();
                    if (error == ErrorNoMoreFiles) break;
                    if (folder.Id == 0 && !directoryHadRecords) Interlocked.Exchange(ref FatalError, error == 0 ? 1 : error);
                    else WriteRecord(4, 0, folder.Id, error, 0, 0, 0, 0, folder.Path);
                    break;
                }

                int offset = 0;
                while (offset >= 0 && offset + FileNameOffset <= BufferSize && Interlocked.CompareExchange(ref UnsupportedEntry, 0, 0) == 0)
                {
                    IntPtr item = IntPtr.Add(buffer, offset);
                    int nextOffset = Marshal.ReadInt32(item, 0);
                    int nameBytes = Marshal.ReadInt32(item, 60);
                    if (nameBytes < 0 || (nameBytes & 1) != 0 || offset + FileNameOffset + nameBytes > BufferSize) break;
                    string name = Marshal.PtrToStringUni(IntPtr.Add(item, FileNameOffset), nameBytes / 2);
                    if (name != "." && name != "..")
                    {
                        long size = Marshal.ReadInt64(item, 40);
                        long allocation = Marshal.ReadInt64(item, 48);
                        long modified = Marshal.ReadInt64(item, 24);
                        uint attributes = unchecked((uint)Marshal.ReadInt32(item, 56));
                        ulong fileId = unchecked((ulong)Marshal.ReadInt64(item, 96));
                        bool reparse = (attributes & FileAttributeReparsePoint) != 0;
                        bool directory = (attributes & FileAttributeDirectory) != 0;
                        // File reparse points are resolved individually by the JS worker with lstat.
                        // Do not abort the whole volume scan because a single placeholder/link needs exact classification.
                        byte kind = reparse && !directory ? (byte)7 : reparse ? (byte)3 : directory ? (byte)1 : (byte)2;
                        int id = WriteEntry(kind, folder.Id, size, allocation, modified, fileId, attributes, name);
                        directoryHadRecords = true;
                        if (directory && !reparse) QueueFolder(new FolderJob(folder.Path.TrimEnd('\\') + "\\" + name, id, folder.Id));
                    }
                    if (nextOffset == 0) break;
                    if (nextOffset < FileNameOffset || offset + nextOffset <= offset) break;
                    offset += nextOffset;
                }
            }
        }
    }

    private static void WorkerLoop()
    {
        IntPtr buffer = Marshal.AllocHGlobal(BufferSize);
        try
        {
            while (true)
            {
                FolderJob folder = null;
                lock (WorkLock)
                {
                    while (WorkQueue.Count == 0 && !Finished && UnsupportedEntry == 0 && FatalError == 0)
                    {
                        if (ActiveWorkers == 0) { Finished = true; Monitor.PulseAll(WorkLock); break; }
                        Monitor.Wait(WorkLock);
                    }
                    if (Finished || UnsupportedEntry != 0 || FatalError != 0) break;
                    folder = WorkQueue.Dequeue(); ActiveWorkers++;
                }
                try { ScanFolder(folder, buffer); }
                catch { Interlocked.Exchange(ref FatalError, 1); }
                finally
                {
                    lock (WorkLock)
                    {
                        ActiveWorkers--;
                        if ((WorkQueue.Count == 0 && ActiveWorkers == 0) || UnsupportedEntry != 0 || FatalError != 0) { Finished = true; WorkQueue.Clear(); }
                        Monitor.PulseAll(WorkLock);
                    }
                }
            }
        }
        finally { Marshal.FreeHGlobal(buffer); }
    }

    private static int Scan(string root)
    {
        if (!IsNtfs(root)) return 3;
        Stopwatch overall = Stopwatch.StartNew();
        ApiTicks = BatchCalls = DirectoryCount = 0; NextId = 1; ActiveWorkers = 0; Finished = false; UnsupportedEntry = FatalError = 0; WorkQueue.Clear();
        using (BinaryWriter writer = new BinaryWriter(new BufferedStream(Console.OpenStandardOutput(), 1024 * 1024)))
        {
            Output = writer;
            lock (WorkLock) WorkQueue.Enqueue(new FolderJob(ExtendedPath(root), 0, -1));
            int workerCount = Math.Min(4, Math.Max(2, Environment.ProcessorCount));
            Thread[] workers = new Thread[workerCount];
            for (int index = 0; index < workers.Length; index++) { workers[index] = new Thread(WorkerLoop); workers[index].IsBackground = true; workers[index].Start(); }
            for (int index = 0; index < workers.Length; index++) workers[index].Join();
            if (UnsupportedEntry != 0 || FatalError != 0)
            {
                WriteRecord(8, 0, 0, FatalError != 0 ? FatalError : UnsupportedEntry, 0, 0, 0, 0, "native_helper_scan_failed");
                writer.Flush(); return 2;
            }
            overall.Stop();
            long cpuTicks = Process.GetCurrentProcess().TotalProcessorTime.Ticks;
            long peakWorkingSet = Process.GetCurrentProcess().PeakWorkingSet64;
            WriteRecord(5, (int)Math.Min((long)Int32.MaxValue, DirectoryCount), (int)Math.Min((long)Int32.MaxValue, BatchCalls), ApiTicks, overall.Elapsed.Ticks, cpuTicks, unchecked((ulong)Math.Max(0, peakWorkingSet)), 0, String.Empty);
            writer.Flush();
            Output = null;
            return 0;
        }
    }

    public static int Main(string[] args)
    {
        if (args.Length != 1) return 64;
        try { return Scan(args[0]); }
        catch (IOException) { return 74; }
        catch (Exception error)
        {
            try { Console.Error.WriteLine(error.GetType().Name + ": " + error.Message); } catch { }
            return 70;
        }
    }
}
