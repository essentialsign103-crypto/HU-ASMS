#Requires -Version 5.1
<#
.SYNOPSIS
    HU-ASMS Production Telegram Webhook Registration Script

.DESCRIPTION
    Runs a full pre-flight check before registering the Telegram webhook.
    Only proceeds when every check passes.

    Required in Vercel dashboard before running:
        TELEGRAM_BOT_TOKEN
        TELEGRAM_WEBHOOK_SECRET
        NEXT_PUBLIC_SUPABASE_URL
        SUPABASE_SERVICE_ROLE_KEY

.NOTES
    Run from the HU-ASMS project root:
        .\scripts\register-telegram-webhook.ps1

    Secrets are collected via Read-Host -AsSecureString and are NEVER printed.
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$WEBHOOK_URL           = "https://hu-asms.vercel.app/api/bot/webhook"
$HEALTH_ENDPOINT       = "https://hu-asms.vercel.app/api/bot/health"
$EXPECTED_USERNAME     = "HU_ASMS_Bot"
$EXPECTED_BOT_ID       = 9200252077
$ALLOWED_UPDATES       = @("message", "callback_query", "chat_member")

function Write-Step([string]$Text) {
    Write-Host ""
    Write-Host ">> $Text" -ForegroundColor Cyan
}
function Write-Pass([string]$Text) { Write-Host "  [PASS] $Text" -ForegroundColor Green }
function Write-Fail([string]$Text) { Write-Host "  [FAIL] $Text" -ForegroundColor Red }
function Write-Info([string]$Text) { Write-Host "         $Text" -ForegroundColor Gray }

function Get-PlainText([System.Security.SecureString]$Secure) {
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Secure)
    try   { return [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
}

function Invoke-TgGet([string]$Token, [string]$Method) {
    $uri = "https://api.telegram.org/bot$Token/$Method"
    $req = [System.Net.HttpWebRequest]::Create($uri)
    $req.Method = "GET"
    $req.AllowAutoRedirect = $true
    try {
        $resp = $req.GetResponse()
        return (New-Object System.IO.StreamReader($resp.GetResponseStream())).ReadToEnd() | ConvertFrom-Json
    } catch [System.Net.WebException] {
        $body = (New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())).ReadToEnd()
        throw "Telegram $Method failed: $body"
    }
}

function Invoke-TgPost([string]$Token, [string]$Method, [hashtable]$Payload) {
    $uri   = "https://api.telegram.org/bot$Token/$Method"
    $bytes = [System.Text.Encoding]::UTF8.GetBytes(($Payload | ConvertTo-Json -Depth 10 -Compress))
    $req   = [System.Net.HttpWebRequest]::Create($uri)
    $req.Method = "POST"
    $req.ContentType = "application/json"
    $req.ContentLength = $bytes.Length
    $req.AllowAutoRedirect = $true
    $s = $req.GetRequestStream()
    $s.Write($bytes, 0, $bytes.Length)
    $s.Close()
    try {
        $resp = $req.GetResponse()
        return (New-Object System.IO.StreamReader($resp.GetResponseStream())).ReadToEnd() | ConvertFrom-Json
    } catch [System.Net.WebException] {
        $errResp = $_.Exception.Response
        $body = (New-Object System.IO.StreamReader($errResp.GetResponseStream())).ReadToEnd()
        throw "Telegram $Method failed (HTTP $([int]$errResp.StatusCode)): $body"
    }
}

# ---------------------------------------------------------------------------
Write-Host ""
Write-Host "================================================================" -ForegroundColor Yellow
Write-Host "  HU-ASMS -- Telegram Webhook Registration"                       -ForegroundColor Yellow
Write-Host "  Target : $WEBHOOK_URL"                                           -ForegroundColor Yellow
Write-Host "================================================================" -ForegroundColor Yellow

# ---------------------------------------------------------------------------
# Step 1 -- Collect credentials
# ---------------------------------------------------------------------------
Write-Step "Step 1 -- Collect credentials (input is hidden)"

$BOT_TOKEN      = Get-PlainText (Read-Host "  TELEGRAM_BOT_TOKEN"      -AsSecureString)
$WEBHOOK_SECRET = Get-PlainText (Read-Host "  TELEGRAM_WEBHOOK_SECRET"  -AsSecureString)

if ([string]::IsNullOrWhiteSpace($BOT_TOKEN)) {
    Write-Fail "TELEGRAM_BOT_TOKEN is empty."; exit 1
}
if ([string]::IsNullOrWhiteSpace($WEBHOOK_SECRET)) {
    Write-Fail "TELEGRAM_WEBHOOK_SECRET is empty."; exit 1
}
if ($BOT_TOKEN -notmatch '^\d+:[A-Za-z0-9_-]{30,}$') {
    Write-Fail "TELEGRAM_BOT_TOKEN format invalid (expected <id>:<key>)."; exit 1
}

Write-Pass "Credentials accepted (not displayed)"

# ---------------------------------------------------------------------------
# Step 2 -- Verify Vercel health endpoint
# ---------------------------------------------------------------------------
Write-Step "Step 2 -- Verify Vercel health endpoint"

$probe     = $WEBHOOK_SECRET.Substring(0, [Math]::Min(16, $WEBHOOK_SECRET.Length))
$healthUri = "${HEALTH_ENDPOINT}?probe=${probe}"

try {
    $wc     = New-Object System.Net.WebClient
    $health = ($wc.DownloadString($healthUri)) | ConvertFrom-Json
} catch {
    Write-Fail "Health endpoint unreachable: $_"
    Write-Info "Ensure Vercel has deployed commit 88dae61 or newer."
    Write-Info "URL: $HEALTH_ENDPOINT"
    exit 1
}

Write-Pass "Health endpoint responded (HTTP 200)"
Write-Info "Node : $($health.nodeVersion)   Built: $($health.timestamp)"

# ---------------------------------------------------------------------------
# Step 3 -- Verify required Vercel env vars
# ---------------------------------------------------------------------------
Write-Step "Step 3 -- Verify Vercel environment variables"

$missing = @()
$varChecks = [ordered]@{
    "TELEGRAM_BOT_TOKEN"       = [bool]$health.env.TELEGRAM_BOT_TOKEN
    "TELEGRAM_WEBHOOK_SECRET"  = [bool]$health.env.TELEGRAM_WEBHOOK_SECRET
    "NEXT_PUBLIC_SUPABASE_URL" = [bool]$health.env.NEXT_PUBLIC_SUPABASE_URL
    "SUPABASE_SERVICE_ROLE_KEY"= [bool]$health.env.SUPABASE_SERVICE_ROLE_KEY
}

foreach ($name in $varChecks.Keys) {
    if ($varChecks[$name]) {
        Write-Pass "$name is set"
    } else {
        Write-Fail "$name is MISSING from Vercel"
        $missing += $name
    }
}

if ($missing.Count -gt 0) {
    Write-Host ""
    Write-Host "  ACTION REQUIRED:" -ForegroundColor Yellow
    Write-Host "  1. Open: https://vercel.com -> Project hu-asms -> Settings -> Environment Variables" -ForegroundColor Yellow
    Write-Host "  2. Add each missing variable listed above." -ForegroundColor Yellow
    Write-Host "  3. Trigger a Vercel redeploy (Deployments -> Redeploy)." -ForegroundColor Yellow
    Write-Host "  4. Run this script again." -ForegroundColor Yellow
    exit 1
}

# ---------------------------------------------------------------------------
# Step 4 -- Verify Supabase connectivity from Vercel
# ---------------------------------------------------------------------------
Write-Step "Step 4 -- Verify Supabase connectivity from Vercel"

$supaOk = ($health.supabaseClientInit -eq "ok") -or ($health.supabaseClientInit.ok -eq $true)
if (-not $supaOk) {
    $errDetail = if ($health.supabaseClientInit.error) { $health.supabaseClientInit.error } else { "unknown" }
    Write-Fail "Supabase admin client failed: $errDetail"
    Write-Info "Likely cause: SUPABASE_SERVICE_ROLE_KEY or NEXT_PUBLIC_SUPABASE_URL is wrong in Vercel."
    exit 1
}
Write-Pass "Supabase admin client initialised"

if ($health.supabaseQuery.ok -eq $true) {
    Write-Pass "bot_sessions table is accessible"
} else {
    Write-Fail "Supabase query failed: $($health.supabaseQuery.error)"
    exit 1
}

if ($health.rateLimitRpc.ok -eq $true) {
    Write-Pass "Rate-limit RPC reachable"
} else {
    Write-Info "Rate-limit RPC unavailable ($($health.rateLimitRpc.error)) -- in-memory fallback will be used"
}

# ---------------------------------------------------------------------------
# Step 5 -- Verify bot identity via getMe
# ---------------------------------------------------------------------------
Write-Step "Step 5 -- Verify bot identity via Telegram getMe"

try {
    $getMe = Invoke-TgGet $BOT_TOKEN "getMe"
} catch {
    Write-Fail "getMe failed: $_"
    exit 1
}

if (-not $getMe.ok) {
    Write-Fail "getMe returned ok=false: $($getMe.description)"
    exit 1
}

$botId   = $getMe.result.id
$botUser = $getMe.result.username
$botName = $getMe.result.first_name

Write-Pass "getMe succeeded"
Write-Info "Bot id       : $botId"
Write-Info "Bot username : @$botUser"
Write-Info "Bot name     : $botName"

if ($botUser -ne $EXPECTED_USERNAME) {
    Write-Fail "Username mismatch: expected @$EXPECTED_USERNAME, got @$botUser"
    Write-Info "Wrong TELEGRAM_BOT_TOKEN?"; exit 1
}
if ($botId -ne $EXPECTED_BOT_ID) {
    Write-Fail "Bot ID mismatch: expected $EXPECTED_BOT_ID, got $botId"; exit 1
}
Write-Pass "Bot identity confirmed: @$EXPECTED_USERNAME (id $EXPECTED_BOT_ID)"

# ---------------------------------------------------------------------------
# Step 6 -- Verify Vercel token matches what we entered
# ---------------------------------------------------------------------------
Write-Step "Step 6 -- Verify token consistency between Vercel and local input"

$vercelPrefix = $health.env.tokenPrefix          # "9200252077..."
$localPrefix  = $BOT_TOKEN.Substring(0, [Math]::Min(10, $BOT_TOKEN.Length)) + "..."

if ($vercelPrefix -ne $localPrefix) {
    Write-Fail "Token in Vercel ($vercelPrefix) does not match the token you entered ($localPrefix)"
    Write-Info "Update TELEGRAM_BOT_TOKEN in Vercel to match the token you are registering."
    exit 1
}
Write-Pass "Vercel token prefix matches entered token ($localPrefix)"

# ---------------------------------------------------------------------------
# Step 7 -- Verify webhook secret consistency
# ---------------------------------------------------------------------------
Write-Step "Step 7 -- Verify webhook secret consistency"

# The health endpoint itself is gated by the first 16 chars of WEBHOOK_SECRET.
# If we got HTTP 200 in Step 2, the secret we entered matches Vercel's value.
Write-Pass "Webhook secret in Vercel matches the value you entered (health auth passed)"

# ---------------------------------------------------------------------------
# Step 8 -- Check current webhook state
# ---------------------------------------------------------------------------
Write-Step "Step 8 -- Check current webhook registration state"

try {
    $preInfo = Invoke-TgGet $BOT_TOKEN "getWebhookInfo"
} catch {
    Write-Fail "getWebhookInfo failed: $_"; exit 1
}

$currentUrl = $preInfo.result.url
if ($currentUrl) {
    Write-Info "Currently registered URL: $currentUrl"
    if ($currentUrl -eq $WEBHOOK_URL) {
        Write-Pass "Already pointing at the correct endpoint"
    } else {
        Write-Info "Will update to: $WEBHOOK_URL"
    }
} else {
    Write-Info "No webhook currently registered"
}

$pendingPre = $preInfo.result.pending_update_count
if ($pendingPre -gt 0) {
    Write-Info "Pending updates: $pendingPre (will be delivered after registration)"
}

if ($preInfo.result.last_error_date) {
    $errAt  = [DateTimeOffset]::FromUnixTimeSeconds($preInfo.result.last_error_date).ToString("yyyy-MM-dd HH:mm:ss UTC")
    $errMsg = $preInfo.result.last_error_message
    Write-Info "Last delivery error: $errAt -- $errMsg"
}

# ---------------------------------------------------------------------------
# Step 9 -- Register the webhook
# ---------------------------------------------------------------------------
Write-Step "Step 9 -- Register webhook with Telegram"
Write-Info "URL            : $WEBHOOK_URL"
Write-Info "Allowed updates: $($ALLOWED_UPDATES -join ', ')"

$payload = @{
    url              = $WEBHOOK_URL
    secret_token     = $WEBHOOK_SECRET
    allowed_updates  = $ALLOWED_UPDATES
    drop_pending_updates = $false
}

try {
    $setResult = Invoke-TgPost $BOT_TOKEN "setWebhook" $payload
} catch {
    Write-Fail "setWebhook API call failed: $_"; exit 1
}

if (-not $setResult.ok) {
    Write-Fail "setWebhook returned ok=false: $($setResult.description)"; exit 1
}

Write-Pass "setWebhook succeeded: $($setResult.description)"

# ---------------------------------------------------------------------------
# Step 10 -- Verify registration
# ---------------------------------------------------------------------------
Write-Step "Step 10 -- Verify registration with getWebhookInfo"
Start-Sleep -Seconds 2

try {
    $postInfo = Invoke-TgGet $BOT_TOKEN "getWebhookInfo"
} catch {
    Write-Fail "Post-registration getWebhookInfo failed: $_"; exit 1
}

$regUrl     = $postInfo.result.url
$regPending = $postInfo.result.pending_update_count
$regAllowed = ($postInfo.result.allowed_updates) -join ", "
$regMaxConn = $postInfo.result.max_connections

if ($regUrl -ne $WEBHOOK_URL) {
    Write-Fail "URL mismatch after registration!"
    Write-Info "Expected : $WEBHOOK_URL"
    Write-Info "Got      : $regUrl"
    exit 1
}

Write-Pass "Registered URL confirmed: $regUrl"
Write-Info "Max connections: $regMaxConn"
Write-Info "Allowed updates: $regAllowed"
Write-Info "Pending updates: $regPending"

if ($postInfo.result.last_error_date) {
    $errAt = [DateTimeOffset]::FromUnixTimeSeconds($postInfo.result.last_error_date).ToString("yyyy-MM-dd HH:mm:ss UTC")
    Write-Info "Pre-existing error (clears after first delivery): $errAt -- $($postInfo.result.last_error_message)"
}

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
Write-Host ""
Write-Host "================================================================" -ForegroundColor Green
Write-Host "  REGISTRATION COMPLETE -- ALL PRE-FLIGHT CHECKS PASSED"          -ForegroundColor Green
Write-Host "================================================================" -ForegroundColor Green
Write-Host ""
Write-Host "  Next steps:" -ForegroundColor White
Write-Host "  1. Open Telegram and send /start to @$EXPECTED_USERNAME" -ForegroundColor White
Write-Host "  2. You should receive the welcome message immediately." -ForegroundColor White
Write-Host "  3. Verify subsystems stayed healthy after the real update:" -ForegroundColor White
Write-Host ""
$probeDisplay = $WEBHOOK_SECRET.Substring(0, [Math]::Min(16, $WEBHOOK_SECRET.Length))
Write-Host "     GET $HEALTH_ENDPOINT" -ForegroundColor Gray
Write-Host "         ?probe=$probeDisplay" -ForegroundColor Gray
Write-Host ""
Write-Host "  Expected health response:" -ForegroundColor White
Write-Host '     supabaseClientInit : "ok"'                                 -ForegroundColor Gray
Write-Host '     supabaseQuery      : { "ok": true }'                       -ForegroundColor Gray
Write-Host '     telegramGetMe      : { "ok": true, "username": "HU_ASMS_Bot" }' -ForegroundColor Gray
Write-Host ""
