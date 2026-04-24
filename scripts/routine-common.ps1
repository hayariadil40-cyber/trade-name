# Routine Common — Helper condivisi per tutte le routine Trade Desk
# Dot-source da ogni script routine: . "$PSScriptRoot\routine-common.ps1"

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

# ===== Carica secrets =====
$secretsPath = Join-Path $PSScriptRoot 'routine.secrets.ps1'
if (-not (Test-Path $secretsPath)) { throw "Secrets non trovati: $secretsPath" }
. $secretsPath

# ===== Logging =====
$script:LogDir = Join-Path $PSScriptRoot 'logs'
if (-not (Test-Path $script:LogDir)) { New-Item -ItemType Directory -Path $script:LogDir | Out-Null }

function Get-RoutineLogPath {
    return Join-Path $script:LogDir ("routine-$(Get-Date -Format 'yyyy-MM-dd').log")
}

function Write-RoutineLog {
    param([string]$Slot, [string]$Msg)
    $line = "[$(Get-Date -Format 'HH:mm:ss')] [$Slot] $Msg"
    Write-Host $line
    Add-Content -Path (Get-RoutineLogPath) -Value $line -Encoding UTF8
}

# ===== Date helpers (Casablanca) =====
function Get-CasablancaDate {
    $tz = [System.TimeZoneInfo]::FindSystemTimeZoneById('Morocco Standard Time')
    return [System.TimeZoneInfo]::ConvertTimeFromUtc([DateTime]::UtcNow, $tz)
}
function Get-TodayCasaIso {
    return (Get-CasablancaDate).ToString('yyyy-MM-dd')
}

# ===== Telegram =====
function Send-Telegram {
    param(
        [Parameter(Mandatory=$true)][string]$Text,
        [string]$ParseMode = 'HTML',
        [bool]$DisableWebPreview = $true
    )
    $body = @{
        chat_id                  = $TELEGRAM_CHAT_ID
        parse_mode               = $ParseMode
        text                     = $Text
        disable_web_page_preview = $DisableWebPreview
    } | ConvertTo-Json -Compress
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($body)
    try {
        $resp = Invoke-RestMethod -Method Post `
            -Uri "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/sendMessage" `
            -ContentType 'application/json; charset=utf-8' -Body $bytes
        return [PSCustomObject]@{ Ok = $true; MessageId = $resp.result.message_id }
    } catch {
        return [PSCustomObject]@{ Ok = $false; MessageId = $null; Error = $_.Exception.Message }
    }
}

# ===== Supabase helpers =====
function Get-SbHeaders {
    return @{
        'apikey'        = $SUPABASE_SERVICE_KEY
        'Authorization' = "Bearer $SUPABASE_SERVICE_KEY"
        'Content-Type'  = 'application/json'
    }
}

function Invoke-SbGet {
    param([Parameter(Mandatory=$true)][string]$Path)
    try {
        return Invoke-RestMethod -Uri "$SUPABASE_URL/rest/v1/$Path" -Headers (Get-SbHeaders) -Method Get
    } catch {
        Write-RoutineLog 'supabase' "ERRORE GET $Path : $($_.Exception.Message)"
        return @()
    }
}

function Invoke-SbPost {
    param(
        [Parameter(Mandatory=$true)][string]$Path,
        [Parameter(Mandatory=$true)][object]$Record
    )
    $body = $Record | ConvertTo-Json -Depth 10 -Compress
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($body)
    try {
        $headers = Get-SbHeaders
        $headers['Prefer'] = 'return=representation'
        return Invoke-RestMethod -Uri "$SUPABASE_URL/rest/v1/$Path" -Headers $headers -Method Post -Body $bytes
    } catch {
        Write-RoutineLog 'supabase' "ERRORE POST $Path : $($_.Exception.Message)"
        return $null
    }
}

# ===== Assistant messages (chat DB condivisa) =====
function Write-AssistantMessage {
    param(
        [Parameter(Mandatory=$true)][ValidateSet('peter','rodrigo','steve')][string]$Assistente,
        [Parameter(Mandatory=$true)][string]$Contenuto,
        [ValidateSet('assistant','user')][string]$Ruolo = 'assistant',
        [ValidateSet('routine','chat')][string]$Sorgente = 'routine',
        [string]$Slot = $null,
        [hashtable]$Metadata = @{}
    )
    $record = [ordered]@{
        assistente = $Assistente
        ruolo      = $Ruolo
        sorgente   = $Sorgente
        slot       = $Slot
        contenuto  = $Contenuto
        metadata   = $Metadata
    }
    Invoke-SbPost -Path 'assistant_messages' -Record $record | Out-Null
}

# ===== Audit routine_events =====
function Write-RoutineEvent {
    param(
        [Parameter(Mandatory=$true)][string]$Slot,
        [Parameter(Mandatory=$true)][string]$Tipo,
        [string]$Assistente = $null,
        [hashtable]$Payload = @{},
        [bool]$TelegramSent = $false,
        [long]$TelegramMessageId = 0
    )
    $record = [ordered]@{
        slot          = $Slot
        tipo          = $Tipo
        assistente    = $Assistente
        payload       = $Payload
        telegram_sent = $TelegramSent
    }
    if ($TelegramMessageId -gt 0) { $record.telegram_message_id = $TelegramMessageId }
    Invoke-SbPost -Path 'routine_events' -Record $record | Out-Null
}

# ===== Anthropic API helper =====
function Invoke-Claude {
    param(
        [Parameter(Mandatory=$true)][string]$SystemPrompt,
        [Parameter(Mandatory=$true)][string]$UserPrompt,
        [string]$Model = 'claude-sonnet-4-6',
        [int]$MaxTokens = 2000,
        [switch]$WithWebSearch,
        [int]$WebSearchUses = 5
    )
    $headers = @{
        'x-api-key'         = $ANTHROPIC_API_KEY
        'anthropic-version' = '2023-06-01'
        'content-type'      = 'application/json'
    }
    $bodyObj = @{
        model      = $Model
        max_tokens = $MaxTokens
        system     = $SystemPrompt
        messages   = @(@{ role = 'user'; content = $UserPrompt })
    }
    if ($WithWebSearch) {
        $bodyObj.tools = @(@{ type = 'web_search_20250305'; name = 'web_search'; max_uses = $WebSearchUses })
    }
    $body = $bodyObj | ConvertTo-Json -Depth 10 -Compress
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($body)
    try {
        # Usa Invoke-WebRequest e decodifica manualmente UTF-8 (Invoke-RestMethod in PS 5.1
        # decodifica response con Latin-1 per default -> caratteri accentati/emoji si corrompono)
        $resp = Invoke-WebRequest -Method Post -Uri 'https://api.anthropic.com/v1/messages' `
            -Headers $headers -Body $bytes -TimeoutSec 300 -UseBasicParsing
        $raw = if ($resp.Content -is [byte[]]) {
            [System.Text.Encoding]::UTF8.GetString($resp.Content)
        } else {
            # Se gia string, re-encode assumendo sia stata letta come Latin-1
            [System.Text.Encoding]::UTF8.GetString([System.Text.Encoding]::GetEncoding('ISO-8859-1').GetBytes($resp.Content))
        }
        $parsed = $raw | ConvertFrom-Json
        $text = ''
        foreach ($block in $parsed.content) {
            if ($block.type -eq 'text') { $text = $block.text }
        }
        return $text
    } catch {
        $err = $_.Exception.Message
        Write-RoutineLog 'anthropic' "ERRORE: $err"
        throw
    }
}
