// Read-only icon resources. No executable is started and no renderer-supplied path is accepted.
using System;
using System.IO;
using System.Linq;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using System.Text.RegularExpressions;
using System.Xml;

static class WindowsProgramIcon {
  [DllImport("shell32.dll", CharSet=CharSet.Unicode, EntryPoint="ExtractIconExW")]
  static extern uint ExtractIconEx(string file, int index, out IntPtr large, out IntPtr small, uint count);
  [DllImport("user32.dll")] static extern bool DestroyIcon(IntPtr icon);
  static string Value(Dictionary<string,object> p,string key){object value;return p.TryGetValue(key,out value)&&value!=null?Convert.ToString(value):"";}
  static string LocalPath(string value){try{value=Environment.ExpandEnvironmentVariables(value.Trim().Trim('"'));if(!Path.IsPathRooted(value)||value.StartsWith("\\\\")||value.IndexOf('\0')>=0)return "";return Path.GetFullPath(value);}catch{return "";}}
  static string Png(Image image){
    if(image.Width>4096||image.Height>4096)return "";
    using(var bitmap=new Bitmap(32,32,PixelFormat.Format32bppArgb))using(var graphics=Graphics.FromImage(bitmap))using(var output=new MemoryStream()){
      graphics.Clear(Color.Transparent);graphics.InterpolationMode=System.Drawing.Drawing2D.InterpolationMode.HighQualityBicubic;
      float scale=Math.Min(32f/image.Width,32f/image.Height);int w=Math.Max(1,(int)(image.Width*scale)),h=Math.Max(1,(int)(image.Height*scale));
      graphics.DrawImage(image,(32-w)/2,(32-h)/2,w,h);bitmap.Save(output,ImageFormat.Png);
      return "data:image/png;base64,"+Convert.ToBase64String(output.ToArray());
    }
  }
  static string FileImage(string file,int index){
    try{
      file=LocalPath(file);if(file==""||!File.Exists(file))return "";
      string extension=Path.GetExtension(file).ToLowerInvariant();
      if(new[]{".png",".jpg",".jpeg",".bmp"}.Contains(extension)){
        if(new FileInfo(file).Length>16*1024*1024)return "";
        using(var stream=File.OpenRead(file))using(var image=Image.FromStream(stream))return Png(image);
      }
      if(!new[]{".ico",".exe",".dll"}.Contains(extension))return "";
      if(extension==".ico"&&new FileInfo(file).Length>4*1024*1024)return "";
      IntPtr large=IntPtr.Zero,small=IntPtr.Zero;
      try{
        uint count=ExtractIconEx(file,index,out large,out small,1);
        if(count==0||count==uint.MaxValue||large==IntPtr.Zero&&small==IntPtr.Zero)return "";
        using(var icon=Icon.FromHandle(large!=IntPtr.Zero?large:small))using(var bitmap=icon.ToBitmap())return Png(bitmap);
      }finally{if(large!=IntPtr.Zero)DestroyIcon(large);if(small!=IntPtr.Zero&&small!=large)DestroyIcon(small);}
    }catch{return "";}
  }
  static string DisplayIcon(string value){
    value=value.Trim().TrimStart('@');int index=0;
    var match=Regex.Match(value,@",\s*(-?\d+)\s*$");
    if(match.Success){if(!int.TryParse(match.Groups[1].Value,out index))return "";value=value.Substring(0,match.Index);}
    return FileImage(value,index);
  }
  static bool Under(string file,string root){return file.StartsWith(root.TrimEnd('\\')+"\\",StringComparison.OrdinalIgnoreCase);}
  static string PackageLogo(string root){
    try{
      var manifest=Path.Combine(root,"AppxManifest.xml");if(!File.Exists(manifest)||new FileInfo(manifest).Length>2*1024*1024)return "";
      var logos=new List<string>();var settings=new XmlReaderSettings{DtdProcessing=DtdProcessing.Prohibit,XmlResolver=null};
      using(var reader=XmlReader.Create(manifest,settings))while(reader.Read())if(reader.NodeType==XmlNodeType.Element){
        foreach(var attribute in new[]{"Square44x44Logo","Square30x30Logo","Logo","Square150x150Logo"}){var logo=reader.GetAttribute(attribute);if(!string.IsNullOrEmpty(logo)&&!logo.StartsWith("ms-resource:",StringComparison.OrdinalIgnoreCase))logos.Add(logo);}
      }
      foreach(var logo in logos.Distinct()){
        string file=LocalPath(Path.Combine(root,logo));if(file==""||!Under(file,root))continue;
        var exact=FileImage(file,0);if(exact!="")return exact;
        var dir=Path.GetDirectoryName(file);if(!Directory.Exists(dir))continue;
        foreach(var variant in Directory.EnumerateFiles(dir,Path.GetFileNameWithoutExtension(file)+".*"+Path.GetExtension(file)).Take(40).OrderBy(f=>f.IndexOf("targetsize-32",StringComparison.OrdinalIgnoreCase)>=0?0:f.IndexOf("scale-100",StringComparison.OrdinalIgnoreCase)>=0?1:2)){
          var result=FileImage(variant,0);if(result!="")return result;
        }
      }
    }catch{}
    return "";
  }
  static IEnumerable<string> Executables(string root,string name){
    var files=new List<string>();var stack=new Stack<Tuple<string,int>>();stack.Push(Tuple.Create(root,0));int visited=0;
    while(stack.Count>0&&visited++<80&&files.Count<200){var current=stack.Pop();try{
      if((File.GetAttributes(current.Item1)&FileAttributes.ReparsePoint)!=0)continue;
      files.AddRange(Directory.EnumerateFiles(current.Item1,"*.exe").Take(200-files.Count));
      if(current.Item2<3)foreach(var dir in Directory.EnumerateDirectories(current.Item1).Take(30))stack.Push(Tuple.Create(dir,current.Item2+1));
    }catch{}}
    string normalized=Regex.Replace(name.ToLowerInvariant(),@"[^\p{L}\p{N}]","");
    return files.Where(f=>!Regex.IsMatch(Path.GetFileName(f),"(?i)(unins|uninstall|setup|crash|report|helper|redist)"))
      .OrderBy(f=>{string stem=Regex.Replace(Path.GetFileNameWithoutExtension(f).ToLowerInvariant(),@"[^\p{L}\p{N}]","");return normalized!=""&&(stem==normalized||normalized.Contains(stem)&&stem.Length>4)?0:1;})
      .ThenBy(f=>Regex.IsMatch(Path.GetFileName(f),"(?i)(launcher|bootstrap)")?1:0).ThenBy(f=>f.Length);
  }
  public static string Read(Dictionary<string,object> program){
    string explicitIcon=Value(program,"icon"), root=LocalPath(Value(program,"location"));
    bool uninstallIcon=Regex.IsMatch(explicitIcon,"(?i)(unins|uninstall|setup)[^\\\\]*\\.exe");
    if(!uninstallIcon){var icon=DisplayIcon(explicitIcon);if(icon!="")return icon;}
    if(root!=""&&root.Length>3&&Directory.Exists(root)){
      var logo=PackageLogo(root);if(logo!="")return logo;
      foreach(var file in Executables(root,Value(program,"name"))){var icon=FileImage(file,0);if(icon!="")return icon;}
    }
    if(uninstallIcon){var icon=DisplayIcon(explicitIcon);if(icon!="")return icon;}
    return "";
  }
}
