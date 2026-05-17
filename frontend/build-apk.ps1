# build-apk.ps1 — Pipeline completo: web build -> cap sync -> APK -> copia a public/downloads
#
# Uso:
#   npm run android:apk                  → build normal (update opcional)
#   npm run android:apk -- --required    → marca el update como obligatorio en la app
#   npm run android:apk -- --changelog "Nuevas notificaciones, fix de icono"
#
param(
    [switch]$required,
    [string]$changelog = ""
)
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# ── 0. Asegurar JAVA_HOME (usa el JDK bundleado de Android Studio) ──────────
if (-not $env:JAVA_HOME -or -not (Test-Path $env:JAVA_HOME)) {
    $candidates = @(
        "C:\Program Files\Android\Android Studio\jbr",
        "C:\Program Files\Android\Android Studio\jre"
    )
    foreach ($c in $candidates) {
        if (Test-Path "$c\bin\java.exe") { $env:JAVA_HOME = $c; break }
    }
    if (-not $env:JAVA_HOME) { throw "No se encontro Java. Instala Android Studio o configura JAVA_HOME." }
    $env:PATH = "$env:JAVA_HOME\bin;$env:PATH"
    Write-Host ">> JAVA_HOME auto: $env:JAVA_HOME" -ForegroundColor DarkCyan
}

$root        = $PSScriptRoot                                      # frontend/
$gradle      = Join-Path $root "android\gradlew.bat"
$apkSrc      = Join-Path $root "android\app\build\outputs\apk\debug\electrogv.apk"
$apkDst      = Join-Path $root "public\downloads\electrogv.apk"
$buildGradle = Join-Path $root "android\app\build.gradle"
$versionJson = Join-Path $root "public\version.json"
$utf8NoBom   = [System.Text.UTF8Encoding]::new($false)

# ── 1. Auto-incrementar versionCode en build.gradle ────────────────────────
$gradleContent = [System.IO.File]::ReadAllText($buildGradle)
$match         = [regex]::Match($gradleContent, 'versionCode\s+(\d+)')
$oldCode       = [int]$match.Groups[1].Value
$newCode       = $oldCode + 1
$gradleContent = $gradleContent -replace "versionCode\s+$oldCode", "versionCode $newCode"
[System.IO.File]::WriteAllText($buildGradle, $gradleContent, $utf8NoBom)
Write-Host ">> versionCode: $oldCode -> $newCode" -ForegroundColor Cyan

# ── 2. Build web (Vite + TypeScript) ───────────────────────────────────────
Write-Host "`n>> npm run build..." -ForegroundColor Cyan
npm run build
if ($LASTEXITCODE -ne 0) { throw "npm build fallo" }

# ── 3. Capacitor sync ──────────────────────────────────────────────────────
Write-Host "`n>> cap sync android..." -ForegroundColor Cyan
npx cap sync android
if ($LASTEXITCODE -ne 0) { throw "cap sync fallo" }

# ── 4. Gradle assembleDebug ────────────────────────────────────────────────
Write-Host "`n>> Gradle assembleDebug..." -ForegroundColor Cyan
Push-Location (Join-Path $root "android")
& $gradle assembleDebug
$exitCode = $LASTEXITCODE
Pop-Location
if ($exitCode -ne 0) { throw "Gradle build fallo" }

# ── 5. Copiar APK a public/downloads ───────────────────────────────────────
if (-not (Test-Path $apkSrc)) { throw "APK no encontrado en: $apkSrc" }
$null = New-Item -ItemType Directory -Path (Split-Path $apkDst) -Force
Copy-Item $apkSrc $apkDst -Force
$sizeMB = [math]::Round((Get-Item $apkDst).Length / 1MB, 1)

# ── 6. Actualizar public/version.json ──────────────────────────────────────
$versionData = [ordered]@{
    minVersionCode = $newCode
    versionName    = "1.0"
    required       = [bool]$required
    changelog      = $changelog
    apkUrl         = "/downloads/electrogv.apk"
}
$versionJson_content = $versionData | ConvertTo-Json -Depth 2
[System.IO.File]::WriteAllText($versionJson, $versionJson_content, $utf8NoBom)
$requiredLabel = if ($required) { "OBLIGATORIA" } else { "opcional" }

Write-Host "`n==========================================" -ForegroundColor Green
Write-Host "  APK listo: public/downloads/electrogv.apk" -ForegroundColor Green
Write-Host "  Tamano: ${sizeMB} MB   |   versionCode: $newCode" -ForegroundColor Green
Write-Host "  Actualizacion: $requiredLabel" -ForegroundColor Green
Write-Host "==========================================" -ForegroundColor Green
Write-Host ""
Write-Host "Proximo paso: git add -A && git commit -m 'apk: v$newCode' && git push"
Write-Host "Vercel servira el APK en /downloads/electrogv.apk y version.json en /version.json"
