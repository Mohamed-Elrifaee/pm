$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Resolve-Path (Join-Path $scriptDir "..")
$imageName = "pm-mvp:local"
$containerName = "pm-mvp-app"
$envFile = Join-Path $projectRoot ".env"

Set-Location $projectRoot

$existing = docker ps -a --format '{{.Names}}' | Select-String -SimpleMatch $containerName
if ($existing) {
  docker rm -f $containerName | Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw "Failed to remove existing container '$containerName'."
  }
}

docker build -t $imageName -f Dockerfile .
if ($LASTEXITCODE -ne 0) {
  throw "Docker build failed."
}

if (Test-Path $envFile) {
  docker run -d --name $containerName --env-file $envFile -p 8000:8000 $imageName | Out-Null
} else {
  docker run -d --name $containerName -p 8000:8000 $imageName | Out-Null
}
if ($LASTEXITCODE -ne 0) {
  throw "Docker run failed."
}

Write-Host "Container '$containerName' started."
Write-Host "Open http://127.0.0.1:8000"
