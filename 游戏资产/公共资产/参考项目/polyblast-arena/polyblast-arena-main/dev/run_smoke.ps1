# Runs the headless smoke test and fails on script errors that Godot's exit
# code misses (a GDScript error can abort a coroutine without failing the run).
# Usage: powershell -File dev\run_smoke.ps1 [-Godot <path-to-godot-console-exe>]
param(
    [string]$Godot = ""
)
$repo = Split-Path $PSScriptRoot -Parent

if (-not $Godot) {
    $bundledGodot = Join-Path (Split-Path $repo -Parent) "tools\godot\Godot_v4.7-stable_win64_console.exe"
    if (Test-Path -LiteralPath $bundledGodot) {
        $Godot = $bundledGodot
    } else {
        $godotCommand = Get-Command godot4, godot -ErrorAction SilentlyContinue | Select-Object -First 1
        if (-not $godotCommand) {
            Write-Error "Godot 4.7 was not found. Pass its console executable with -Godot <path>."
            exit 1
        }
        $Godot = $godotCommand.Source
    }
}

$out = & $Godot --headless --path $repo --script res://dev/smoke_test.gd 2>&1 | Out-String
Write-Host $out
$hasErrors = $out -match "SCRIPT ERROR"
$passed = $out -match "=== smoke: PASS ==="
if ($LASTEXITCODE -ne 0 -or $hasErrors -or -not $passed) {
    Write-Host ">>> SMOKE FAILED (exit=$LASTEXITCODE scriptErrors=$hasErrors passed=$passed)"
    exit 1
}
Write-Host ">>> SMOKE OK"
exit 0
