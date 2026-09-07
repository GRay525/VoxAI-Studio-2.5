Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetParentFolderName(WScript.ScriptFullName)
electronDir = fso.BuildPath(root, "electron")
electronExe = fso.BuildPath(electronDir, "node_modules\electron\dist\electron.exe")

If Not fso.FileExists(electronExe) Then
  MsgBox "找不到 Electron。" & vbCrLf & vbCrLf & "请先运行 scripts\setup.cmd", 16, "VoxAI Studio"
  WScript.Quit 1
End If

Set sh = CreateObject("Wscript.Shell")
sh.CurrentDirectory = electronDir
sh.Run """" & electronExe & """ . --dev", 0, False
