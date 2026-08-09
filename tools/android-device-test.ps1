[CmdletBinding()]
param(
  [ValidateSet('info', 'status', 'reverse', 'open', 'reload', 'screenshot', 'record', 'logcat', 'help')]
  [string]$Action = 'help',
  [string]$Url = 'http://127.0.0.1:5173/?debug=1',
  [ValidateRange(1, 180)] [int]$DurationSeconds = 20,
  [string]$OutputDirectory = (Join-Path $env:TEMP 'guitar-coach-device-test')
)

$ErrorActionPreference = 'Stop'
$candidates = @(
  (Join-Path $env:LOCALAPPDATA 'Android\Sdk\platform-tools\adb.exe'),
  $(if ($env:ANDROID_HOME) { Join-Path $env:ANDROID_HOME 'platform-tools\adb.exe' }),
  $(if ($env:ANDROID_SDK_ROOT) { Join-Path $env:ANDROID_SDK_ROOT 'platform-tools\adb.exe' }),
  'C:\Android\platform-tools\adb.exe'
)
$adb = $candidates | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -First 1
if (-not $adb -and (Test-Path -LiteralPath 'C:\Android\platform-tools\adb.exe')) { $adb = 'C:\Android\platform-tools\adb.exe' }
if (-not $adb) { throw 'adb.exe not found. Install Android SDK Platform Tools or set ANDROID_SDK_ROOT.' }
$chrome = 'com.android.chrome'

function Invoke-Adb([string[]]$Arguments) {
  & $adb @Arguments
  if ($LASTEXITCODE -ne 0) { throw "adb failed: $($Arguments -join ' ')" }
}
function Assert-Device {
  if (-not ((& $adb devices) -match '\sdevice$')) { throw 'No authorized Android device is connected over USB ADB.' }
}
function Open-App { Invoke-Adb @('shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', $Url, $chrome) }

switch ($Action) {
  'info' {
    Assert-Device
    [ordered]@{
      Manufacturer = (& $adb shell getprop ro.product.manufacturer).Trim()
      Model = (& $adb shell getprop ro.product.model).Trim()
      Android = (& $adb shell getprop ro.build.version.release).Trim()
      Display = (& $adb shell wm size | Select-Object -First 1).Trim()
      Chrome = ((& $adb shell pm list packages $chrome) -join '').Trim()
    } | Format-List
  }
  'status' { Invoke-Adb @('devices', '-l'); Invoke-Adb @('reverse', '--list') }
  'reverse' { Assert-Device; Invoke-Adb @('reverse', 'tcp:5173', 'tcp:5173'); Invoke-Adb @('reverse', '--list') }
  'open' { Assert-Device; Open-App }
  'reload' { Assert-Device; Invoke-Adb @('shell', 'am', 'force-stop', $chrome); Open-App }
  'screenshot' {
    Assert-Device; New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
    $remote = '/data/local/tmp/guitar-coach-screen.png'
    $local = Join-Path $OutputDirectory ("screen-{0}.png" -f (Get-Date -Format 'yyyyMMdd-HHmmss'))
    Invoke-Adb @('shell', 'screencap', '-p', $remote); Invoke-Adb @('pull', $remote, $local); Invoke-Adb @('shell', 'rm', $remote)
    Write-Output $local
  }
  'record' {
    Assert-Device; New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
    $remote = '/data/local/tmp/guitar-coach-test.mp4'
    $local = Join-Path $OutputDirectory ("record-{0}.mp4" -f (Get-Date -Format 'yyyyMMdd-HHmmss'))
    Invoke-Adb @('shell', 'screenrecord', '--time-limit', "$DurationSeconds", $remote); Invoke-Adb @('pull', $remote, $local); Invoke-Adb @('shell', 'rm', $remote)
    Write-Output $local
  }
  'logcat' {
    Assert-Device; New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
    $local = Join-Path $OutputDirectory ("logcat-{0}.txt" -f (Get-Date -Format 'yyyyMMdd-HHmmss'))
    & $adb logcat -d -v time chromium:I cr_media:I MediaPipe:I '*:S' | Set-Content -LiteralPath $local -Encoding utf8
    Write-Output $local
  }
  'help' {
    Write-Output 'Actions: info, status, reverse, open, reload, screenshot, record, logcat'
    Write-Output 'Start Vite: npm --prefix web run dev -- --host 127.0.0.1 --port 5173'
    Write-Output "Phone URL: $Url"
  }
}
