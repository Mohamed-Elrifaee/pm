$ErrorActionPreference = "Stop"

$containerName = "pm-mvp-app"

$existing = docker ps -a --format '{{.Names}}' | Select-String -SimpleMatch $containerName
if ($existing) {
  docker rm -f $containerName | Out-Null
  Write-Host "Container '$containerName' stopped and removed."
} else {
  Write-Host "Container '$containerName' is not running."
}
