param()
$ErrorActionPreference='Stop'
$projectRoot=Split-Path $PSScriptRoot -Parent
$previousPassword=$env:DB_PASSWORD
Push-Location (Join-Path $projectRoot 'backend')
try {
 $env:DB_PASSWORD=(Get-Content (Join-Path $projectRoot '.env') | Where-Object {$_ -match '^DB_PASSWORD='}) -replace '^DB_PASSWORD=', ''
 if(!$env:DB_PASSWORD){throw 'Falta DB_PASSWORD en .env.'}
 npm.cmd run build
 if($LASTEXITCODE -ne 0){throw 'No se pudo compilar la API.'}
 npm.cmd run migrate
 if($LASTEXITCODE -ne 0){throw 'No se pudo preparar la base de datos.'}
 npm.cmd start
} finally {$env:DB_PASSWORD=$previousPassword;Pop-Location}
