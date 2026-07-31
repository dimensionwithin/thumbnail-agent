Option Explicit

Const WINDOW_HIDDEN = 0
Const DIALOG_TITLE = "DimensionWithin Thumbnail-Compositor"

Dim fileSystem, shell, scriptDirectory, servicePath, htmlPath
Dim pythonCommand, commandLine, runResult, errorMessage

Set fileSystem = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

scriptDirectory = fileSystem.GetParentFolderName(WScript.ScriptFullName)
servicePath = fileSystem.BuildPath(scriptDirectory, "thumbnail_service.py")
htmlPath = fileSystem.BuildPath(scriptDirectory, "thumbnail-compositor.html")

If Not fileSystem.FileExists(servicePath) Then
    ShowError "Die Startdatei ""thumbnail_service.py"" fehlt." & vbCrLf & _
              "Bitte den sichtbaren CMD-Launcher zur Diagnose verwenden."
    WScript.Quit 2
End If

If Not fileSystem.FileExists(htmlPath) Then
    ShowError "Die Datei ""thumbnail-compositor.html"" fehlt." & vbCrLf & _
              "Bitte den sichtbaren CMD-Launcher zur Diagnose verwenden."
    WScript.Quit 2
End If

pythonCommand = FindPythonCommand(fileSystem, shell)
If Len(pythonCommand) = 0 Then
    ShowError "Es wurde keine verwendbare Python-3-Installation gefunden." & vbCrLf & _
              "Bitte Python installieren oder den sichtbaren CMD-Launcher zur Diagnose verwenden."
    WScript.Quit 3
End If

commandLine = pythonCommand & " " & QuoteArgument(servicePath)
shell.CurrentDirectory = scriptDirectory

On Error Resume Next
runResult = shell.Run(commandLine, WINDOW_HIDDEN, False)
If Err.Number <> 0 Then
    errorMessage = Err.Description
    Err.Clear
    On Error GoTo 0
    ShowError "Der lokale Thumbnail-Dienst konnte nicht gestartet werden." & vbCrLf & _
              errorMessage & vbCrLf & _
              "Bitte den sichtbaren CMD-Launcher zur Diagnose verwenden."
    WScript.Quit 4
End If
On Error GoTo 0

WScript.Quit 0


Function FindPythonCommand(fso, wsh)
    Dim candidate, windowsDirectory, localPythonRoot, folder, pathEntry
    Dim pathValue, executableName

    localPythonRoot = wsh.ExpandEnvironmentStrings("%LocalAppData%\Python")
    If fso.FolderExists(localPythonRoot) Then
        For Each folder In fso.GetFolder(localPythonRoot).SubFolders
            If LCase(Left(folder.Name, 11)) = "pythoncore-" Then
                candidate = fso.BuildPath(folder.Path, "pythonw.exe")
                If fso.FileExists(candidate) Then
                    FindPythonCommand = QuoteArgument(candidate)
                    Exit Function
                End If
                candidate = fso.BuildPath(folder.Path, "python.exe")
                If fso.FileExists(candidate) Then
                    FindPythonCommand = QuoteArgument(candidate)
                    Exit Function
                End If
            End If
        Next
    End If

    windowsDirectory = wsh.ExpandEnvironmentStrings("%WINDIR%")
    candidate = fso.BuildPath(windowsDirectory, "pyw.exe")
    If fso.FileExists(candidate) Then
        FindPythonCommand = QuoteArgument(candidate) & " -3"
        Exit Function
    End If

    pathValue = wsh.ExpandEnvironmentStrings("%PATH%")
    For Each pathEntry In Split(pathValue, ";")
        If Len(pathEntry) > 0 Then
            For Each executableName In Array("pythonw.exe", "python.exe")
                candidate = fso.BuildPath(pathEntry, executableName)
                If fso.FileExists(candidate) Then
                    FindPythonCommand = QuoteArgument(candidate)
                    Exit Function
                End If
            Next
        End If
    Next

    FindPythonCommand = ""
End Function


Function QuoteArgument(value)
    QuoteArgument = """" & Replace(value, """", """""") & """"
End Function


Sub ShowError(message)
    MsgBox message, vbOKOnly + vbCritical, DIALOG_TITLE
End Sub
