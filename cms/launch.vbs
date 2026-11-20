' Starts the Portfolio CMS without a console window.
' Used by the desktop shortcut. Safe to double-click.
Option Explicit
Dim sh, fso, root
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))
sh.CurrentDirectory = root
If Not fso.FolderExists(root & "\node_modules") Then
  ' First run on this machine: install packages in a visible window.
  sh.Run "cmd /c echo Installing packages for Portfolio CMS... && npm install", 1, True
End If
sh.Run "cmd /c node cms\server.js", 0, False
