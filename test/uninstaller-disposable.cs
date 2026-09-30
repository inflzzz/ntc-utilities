using System;
using System.IO;
using Microsoft.Win32;
class DisposableUninstaller {
  static void Main(string[] a) {
    if(a.Length==0){string sidecar=System.Reflection.Assembly.GetExecutingAssembly().Location+".fixture";if(!File.Exists(sidecar))throw new Exception("Fixture configuration required.");a=File.ReadAllLines(sidecar);}
    if(a.Length<3||!a[1].StartsWith("NTC-Disposable-"))throw new Exception("Fixture key required.");
    string root=Path.GetFullPath(a[2]);string allowed=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"ntc-uninstaller-tests");
    if(!root.StartsWith(allowed+"\\",StringComparison.OrdinalIgnoreCase))throw new Exception("Fixture scope required.");
    string key="Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\"+a[1];
    if(a[0]=="lock"){using(var stream=new FileStream(Path.Combine(root,"locked.bin"),FileMode.Open,FileAccess.Read,FileShare.None)){Console.WriteLine("ready");Console.ReadLine();}return;}
    if(a[0]=="uninstall"){using(var b=RegistryKey.OpenBaseKey(RegistryHive.CurrentUser,RegistryView.Registry64))b.DeleteSubKeyTree(key,false);return;}
    if(a[0]=="install"){
      Directory.CreateDirectory(root);string exe=Path.Combine(root,"fixture.exe");File.Copy(System.Reflection.Assembly.GetExecutingAssembly().Location,exe,true);File.WriteAllBytes(Path.Combine(root,"payload.bin"),new byte[]{1,2,3,4});
      using(var b=RegistryKey.OpenBaseKey(RegistryHive.CurrentUser,RegistryView.Registry64))using(var k=b.CreateSubKey(key)){k.SetValue("DisplayName","Fixture monitorada");k.SetValue("InstallLocation",root);k.SetValue("UninstallString","\""+exe+"\" uninstall "+a[1]+" \""+root+"\"");}
      using(var b=RegistryKey.OpenBaseKey(RegistryHive.CurrentUser,RegistryView.Registry64))using(var k=b.CreateSubKey("Software\\Microsoft\\Windows\\CurrentVersion\\Run")){k.SetValue(a[1],"\""+exe+"\"");}
    }
  }
}
