# 바탕화면에 '방문기록' 바로가기를 만든다(이미 있으면 새로 고친다).
# 바로가기는 start-app.vbs를 실행해, 검은 창 없이 앱을 시작하고 브라우저를 연다.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$desktop = [Environment]::GetFolderPath('Desktop')
$lnkPath = Join-Path $desktop '방문기록.lnk'

$shell = New-Object -ComObject WScript.Shell
$lnk = $shell.CreateShortcut($lnkPath)
$lnk.TargetPath = Join-Path $env:SystemRoot 'System32\wscript.exe'
$lnk.Arguments = '"' + (Join-Path $root 'start-app.vbs') + '"'
$lnk.WorkingDirectory = $root
$lnk.IconLocation = (Join-Path $root 'assets\app.ico') + ',0'
$lnk.Description = '방문기록 - 네이버 블로그 임시저장 테스트'
$lnk.Save()
Write-Output "바탕화면에 바로가기를 만들었습니다: $lnkPath"
