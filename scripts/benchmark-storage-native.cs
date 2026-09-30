using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;

public static class StorageNativeBenchmark {
  public static int Main(string[] args) {
    if (args.Length == 0) return 2;
    long files = 0, folders = 0, bytes = 0, errors = 0;
    var pending = new Stack<string>(); pending.Push(Path.GetFullPath(args[0]));
    var timer = Stopwatch.StartNew();
    while (pending.Count > 0) {
      var folder = pending.Pop(); folders++;
      IEnumerable<string> entries;
      try { entries = Directory.EnumerateFileSystemEntries(folder); }
      catch { errors++; continue; }
      try {
        foreach (var entry in entries) {
          try {
            var attributes = File.GetAttributes(entry);
            if ((attributes & FileAttributes.ReparsePoint) != 0) continue;
            if ((attributes & FileAttributes.Directory) != 0) pending.Push(entry);
            else { files++; bytes += new FileInfo(entry).Length; }
          } catch { errors++; }
        }
      } catch { errors++; }
    }
    timer.Stop();
    Console.WriteLine("{\"files\":" + files + ",\"folders\":" + folders + ",\"bytes\":" + bytes + ",\"errors\":" + errors + ",\"elapsedMs\":" + timer.Elapsed.TotalMilliseconds.ToString("F2", System.Globalization.CultureInfo.InvariantCulture) + "}");
    return 0;
  }
}
