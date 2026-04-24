# Letture Mattina Trade Desk
# Esegue ogni mattina alle 07:05 Casablanca via Task Scheduler:
# 1) Chiama Anthropic API con web_search per raccogliere news rilevanti delle ultime 24h
# 2) Claude filtra/sintetizza in italiano e tagga ogni articolo per tema
# 3) UPSERT su articoli_daily (chiave url -> no duplicati tra run)
# 4) Invia 1 messaggio Telegram per articolo nuovo

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

# ===== Carica secrets =====
$secretsPath = Join-Path $PSScriptRoot 'letture-mattina.secrets.ps1'
if (-not (Test-Path $secretsPath)) { throw "Secrets non trovati: $secretsPath" }
. $secretsPath

# ===== Logging =====
$logDir = Join-Path $PSScriptRoot 'logs'
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir | Out-Null }
$logFile = Join-Path $logDir ("letture-$(Get-Date -Format 'yyyy-MM-dd').log")
function Log($msg) {
    $line = "[$(Get-Date -Format 'HH:mm:ss')] $msg"
    Write-Host $line
    Add-Content -Path $logFile -Value $line -Encoding UTF8
}

$tz        = [System.TimeZoneInfo]::FindSystemTimeZoneById('Morocco Standard Time')
$nowUtc    = [DateTime]::UtcNow
$todayCasa = [System.TimeZoneInfo]::ConvertTimeFromUtc($nowUtc, $tz).ToString('yyyy-MM-dd')

Log "===== Letture mattina per $todayCasa ====="

# ===== Prompt Claude =====
$systemPrompt = @"
Sei un assistente che prepara la rassegna stampa mattutina per un trader (focus: forex, macro, indici USA/EU, oro, crypto quando muove i mercati).

OBIETTIVO: trova articoli pubblicati nelle ULTIME 24 ORE dalle seguenti 8 fonti principali, filtra per rilevanza e produci un JSON strutturato.

FONTI PRIORITARIE (usa web_search con 'site:dominio ...' o cerca per nome fonte):
1. Bloomberg (bloomberg.com)
2. Reuters (reuters.com)
3. Financial Times (ft.com)
4. CNBC (cnbc.com)
5. ForexLive (forexlive.com)
6. ZeroHedge (zerohedge.com)
7. The Information (theinformation.com) - solo AI/big tech business
8. Axios (axios.com) - solo politica USA che impatta mercati

TEMI DA COPRIRE (cerca attivamente):
- macro: Fed, BCE, BoE, BoJ, dati macro (CPI, NFP, PMI), banche centrali, politica monetaria
- forza_indici: forex majors (EURUSD, GBPUSD, USDJPY, DXY), oro (XAUUSD), indici (SP500, Nasdaq, DAX, Dow)
- geopolitica: Trump dichiarazioni/policy, Iran, Israele, guerre, sanzioni, tariffe, elezioni che muovono mercati
- ai_tech: SOLO in chiave economica -> earnings Nvidia/Apple/Microsoft/Google/Meta/Tesla, bilanci, CEO changes, nuovi modelli AI (es. Claude Opus 4.7, GPT-5), bolla AI, IPO tech, capex datacenter

REGOLE SELEZIONE:
- SOLO articoli pubblicati <24h (se una fonte non ha niente di fresco, saltala)
- Scarta gossip, sport, lifestyle, listicles ("10 modi per..."), advertorial
- Scarta duplicati: se la stessa news e su piu fonti, tieni solo la piu autorevole
- Quantita dinamica: 4-15 articoli totali. Giornate tranquille -> meno. Giornate volatili -> fino a 15.
- Quota per tema indicativa: macro 30%, forex_indici 20%, geopolitica 25%, ai_tech 25%

OUTPUT: rispondi SOLO con un JSON valido in questa forma esatta, niente testo prima o dopo:
{
  "articoli": [
    {
      "titolo_it": "titolo tradotto/riassunto in italiano, max 90 caratteri",
      "sommario_it": "2-3 frasi in italiano che catturano la sostanza e l'impatto mercati",
      "fonte": "Bloomberg | Reuters | FT | CNBC | ForexLive | ZeroHedge | TheInformation | Axios | Altro",
      "url": "url originale",
      "data_pubblicazione": "YYYY-MM-DD (data pubblicazione articolo, non di oggi se e di ieri)",
      "tag_tema": ["macro" | "forex_indici" | "geopolitica" | "ai_tech"] (1-2 tag),
      "rilevanza": 1-5 (5=breakout che sposta i mercati ora, 1=contesto utile ma poco urgente)
    }
  ]
}

Non aggiungere commenti, markdown, backticks. SOLO JSON valido.
"@

$userPrompt = "Data di oggi: $todayCasa (Casablanca / UTC+1). Prepara la rassegna mattutina."

# ===== Chiamata Anthropic API =====
$headers = @{
    'x-api-key'         = $ANTHROPIC_API_KEY
    'anthropic-version' = '2023-06-01'
    'content-type'      = 'application/json'
}

$body = @{
    model      = 'claude-sonnet-4-6'
    max_tokens = 8000
    system     = $systemPrompt
    messages   = @(@{ role = 'user'; content = $userPrompt })
    tools      = @(@{
        type        = 'web_search_20250305'
        name        = 'web_search'
        max_uses    = 12
    })
} | ConvertTo-Json -Depth 10 -Compress

$bodyBytes = [System.Text.Encoding]::UTF8.GetBytes($body)

Log "Chiamata Anthropic API (model=sonnet-4-6, max_uses=12)..."
try {
    $resp = Invoke-RestMethod -Method Post -Uri 'https://api.anthropic.com/v1/messages' -Headers $headers -Body $bodyBytes -TimeoutSec 300
} catch {
    $err = $_.Exception.Message
    try { $errBody = $_.ErrorDetails.Message } catch { $errBody = '' }
    Log "ERRORE Anthropic: $err | $errBody"
    throw
}

# Estrai text finale (ultimo content block di tipo text)
$finalText = ''
foreach ($block in $resp.content) {
    if ($block.type -eq 'text') { $finalText = $block.text }
}
if (-not $finalText) { Log "Nessun text block in risposta"; throw "No text in response" }

# Parsa JSON (gestisci eventuali wrapper ```json)
$cleanJson = $finalText -replace '^\s*```(?:json)?\s*', '' -replace '\s*```\s*$', ''
try {
    $parsed = $cleanJson | ConvertFrom-Json
} catch {
    Log "JSON invalido: $cleanJson"
    throw "Parse JSON fallito: $_"
}

$articoli = @($parsed.articoli)
Log "Ricevuti $($articoli.Count) articoli dalla chiamata AI."

if ($articoli.Count -eq 0) {
    Log "Nessun articolo, fine."
    exit 0
}

# ===== Upsert su Supabase =====
$sbHeaders = @{
    'apikey'        = $SUPABASE_SERVICE_KEY
    'Authorization' = "Bearer $SUPABASE_SERVICE_KEY"
    'Content-Type'  = 'application/json'
    'Prefer'        = 'return=representation,resolution=merge-duplicates'
}

$EM_NEWS   = [char]::ConvertFromUtf32(0x1F4F0)
$EM_LINK   = [char]::ConvertFromUtf32(0x1F517)
$EM_TARGET = [char]::ConvertFromUtf32(0x1F3AF)
$TAG_EMOJI = @{
    'macro'         = [char]::ConvertFromUtf32(0x1F4CA)
    'forex_indici'  = [char]::ConvertFromUtf32(0x1F4B1)
    'geopolitica'   = [char]::ConvertFromUtf32(0x1F30D)
    'ai_tech'       = [char]::ConvertFromUtf32(0x1F916)
}

$nNuovi = 0
$nEsistenti = 0

foreach ($a in $articoli) {
    $url = [string]$a.url
    if (-not $url) { continue }

    $dataPub = if ($a.data_pubblicazione) { [string]$a.data_pubblicazione } else { $todayCasa }
    $tags    = @($a.tag_tema)
    $rel     = [int]$a.rilevanza
    if ($rel -lt 1) { $rel = 1 }
    if ($rel -gt 5) { $rel = 5 }

    $record = [ordered]@{
        titolo      = [string]$a.titolo_it
        sommario    = [string]$a.sommario_it
        fonte       = [string]$a.fonte
        url         = $url
        data        = $dataPub
        tag_tema    = $tags
        rilevanza   = $rel
    }

    $recordJson  = @($record) | ConvertTo-Json -Depth 10 -Compress
    $recordBytes = [System.Text.Encoding]::UTF8.GetBytes($recordJson)

    try {
        # upsert on_conflict=url -> se esiste gia non duplica
        $sbResp = Invoke-RestMethod -Method Post `
            -Uri "$SUPABASE_URL/rest/v1/articoli_daily?on_conflict=url" `
            -Headers $sbHeaders -Body $recordBytes

        # sbResp e un array con il record scritto. Determina se era nuovo:
        # se created_at del record == ora run (entro 5s) -> nuovo. Altrimenti esistente.
        $isNew = $false
        if ($sbResp -and $sbResp.Count -gt 0) {
            $createdAt = [DateTime]::Parse($sbResp[0].created_at).ToUniversalTime()
            $delta = ($nowUtc - $createdAt).TotalSeconds
            if ($delta -lt 120 -and $delta -gt -120) { $isNew = $true }
        }

        if ($isNew) {
            $nNuovi++
            Log "NUOVO: [$($record.fonte)] $($record.titolo.Substring(0, [Math]::Min(60, $record.titolo.Length)))"

            # Invia Telegram solo per articoli nuovi
            $temaEmoji = ''
            foreach ($t in $tags) { if ($TAG_EMOJI.ContainsKey($t)) { $temaEmoji += $TAG_EMOJI[$t] + ' ' } }
            $tagLabel = ($tags -join ' · ')
            $stars = ('*' * $rel)

            $msg  = "$EM_NEWS $temaEmoji<b>$([System.Net.WebUtility]::HtmlEncode($record.titolo))</b>`n"
            $msg += "<i>$($record.fonte)</i> · <code>$tagLabel</code> · $stars`n`n"
            $msg += "$([System.Net.WebUtility]::HtmlEncode($record.sommario))`n`n"
            $msg += "$EM_LINK <a href=""$url"">Leggi originale</a>"

            $tgBody = @{
                chat_id = $TELEGRAM_CHAT_ID
                parse_mode = 'HTML'
                text = $msg
                disable_web_page_preview = $true
            } | ConvertTo-Json -Compress
            $tgBytes = [System.Text.Encoding]::UTF8.GetBytes($tgBody)

            try {
                Invoke-RestMethod -Method Post -Uri "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/sendMessage" `
                    -ContentType 'application/json; charset=utf-8' -Body $tgBytes | Out-Null
            } catch {
                Log "Telegram KO per $url : $_"
            }
            Start-Sleep -Milliseconds 1500  # rate limit Telegram
        } else {
            $nEsistenti++
        }
    } catch {
        Log "ERRORE upsert $url : $_"
    }
}

Log "Done. Nuovi: $nNuovi | Gia presenti: $nEsistenti | Totale ricevuti: $($articoli.Count)"

# Messaggio riepilogo finale Telegram (solo se qualcosa di nuovo)
if ($nNuovi -gt 0) {
    $summary = "$EM_TARGET <b>Rassegna mattina $todayCasa</b>`n$nNuovi nuovi articoli inviati sopra."
    $tgSummary = @{
        chat_id = $TELEGRAM_CHAT_ID
        parse_mode = 'HTML'
        text = $summary
    } | ConvertTo-Json -Compress
    $tgSummaryBytes = [System.Text.Encoding]::UTF8.GetBytes($tgSummary)
    try {
        Invoke-RestMethod -Method Post -Uri "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/sendMessage" `
            -ContentType 'application/json; charset=utf-8' -Body $tgSummaryBytes | Out-Null
    } catch { Log "Riepilogo Telegram KO: $_" }
}

Log "===== Letture mattina completata ====="
