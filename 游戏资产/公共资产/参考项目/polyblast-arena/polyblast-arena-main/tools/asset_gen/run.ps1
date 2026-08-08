# Runs asset generation scripts headless through Blender and gates on QA lines.
# Usage: powershell -File tools\asset_gen\run.ps1 [-Only gen_pickups.py]
param(
    [string]$Only = "",
    [string]$Blender = "C:\Program Files\Blender Foundation\Blender 5.1\blender.exe"
)
$here = $PSScriptRoot
$scripts = Get-ChildItem $here -Filter "gen_*.py" | Sort-Object Name
if ($Only -ne "") { $scripts = $scripts | Where-Object { $_.Name -like $Only } }
if (-not $scripts) { Write-Host "no scripts matched"; exit 1 }

$failed = @()
foreach ($s in $scripts) {
    Write-Host "=== $($s.Name) ==="
    $out = & $Blender --background --factory-startup --python $s.FullName 2>&1 | Out-String
    $ok = ($out -match "GEN_DONE") -and ($out -notmatch "ASSET_FAIL") -and ($out -notmatch "Traceback")
    $out -split "`n" | Where-Object { $_ -match "^(ASSET_OK|ASSET_FAIL|GEN_DONE|Error|Traceback)" } | ForEach-Object { Write-Host $_ }
    if (-not $ok) {
        $failed += $s.Name
        # print the tail so the error is visible
        ($out -split "`n" | Select-Object -Last 30) | ForEach-Object { Write-Host $_ }
    }
}
if ($failed.Count -gt 0) { Write-Host ">>> ASSET GEN FAILED: $($failed -join ', ')"; exit 1 }
Write-Host ">>> ASSET GEN OK ($($scripts.Count) scripts)"
exit 0
