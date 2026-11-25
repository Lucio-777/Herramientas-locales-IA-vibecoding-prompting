' ==============================================================================
' VibeCoding - Lanzador 100% Silencioso (Zero-Touch Windows Startup)
' Ejecuta start-ai-ecosystem.ps1 sin mostrar ventana de consola (Estilo 0)
' ==============================================================================

Set fso = CreateObject("Scripting.FileSystemObject")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
startScript = fso.BuildPath(scriptDir, "start-ai-ecosystem.ps1")

Set WshShell = CreateObject("WScript.Shell")
strCommand = "powershell.exe -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & startScript & """"
WshShell.Run strCommand, 0, False
