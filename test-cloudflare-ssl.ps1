# Test CloudFlare Worker SSL Connection
# Run this script after 30 minutes to check if SSL certificates have propagated

$workerUrl = "https://titiler-cdn-proxy.christopher-guth1.workers.dev/"

Write-Host "Testing CloudFlare Worker SSL connection..." -ForegroundColor Cyan
Write-Host "URL: $workerUrl`n" -ForegroundColor Gray

try {
    $response = Invoke-WebRequest -Uri $workerUrl -Method Head -ErrorAction Stop
    Write-Host "✅ SSL is working!" -ForegroundColor Green
    Write-Host "   Status: $($response.StatusCode)" -ForegroundColor Green
    Write-Host "   Server: $($response.Headers['Server'])" -ForegroundColor Gray
    Write-Host "`n✨ You can enable CloudFlare CDN now:" -ForegroundColor Yellow
    Write-Host "   1. Edit .env and uncomment the CloudFlare Worker URL" -ForegroundColor Yellow
    Write-Host "   2. Restart dev server with: npm run dev" -ForegroundColor Yellow
} catch {
    $errorMessage = $_.Exception.Message
    
    if ($errorMessage -like "*HandshakeFailure*" -or $errorMessage -like "*SSL*") {
        Write-Host "⏳ SSL certificates still propagating..." -ForegroundColor Yellow
        Write-Host "   This is normal. CloudFlare needs 30-60 minutes to provision certs." -ForegroundColor Gray
        Write-Host "   Try running this script again in 15 minutes." -ForegroundColor Gray
    } else {
        Write-Host "❌ Unexpected error:" -ForegroundColor Red
        Write-Host "   $errorMessage" -ForegroundColor Red
    }
}

Write-Host "`n📝 Current configuration:" -ForegroundColor Cyan
if (Test-Path ".env") {
    $envContent = Get-Content ".env" | Select-String "VITE_TITILER_URL"
    Write-Host "   $envContent" -ForegroundColor Gray
} else {
    Write-Host "   .env file not found" -ForegroundColor Red
}
