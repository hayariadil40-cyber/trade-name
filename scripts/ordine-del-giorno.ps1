# Ordine del giorno — Trade Desk
# Esegue ogni mattina alle 07:00 Casablanca via Task Scheduler:
# 1) Legge da Supabase: macro oggi, bias aperti, ultimi 5 trade, forza USD
# 2) Compone ordine del giorno JSON + narrativa template-based
# 3) Salva su giornate.ordine_del_giorno (UPSERT)
# 4) Manda messaggio Telegram

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

# ===== Carica secrets (gitignored) =====
$secretsPath = Join-Path $PSScriptRoot 'ordine-del-giorno.secrets.ps1'
if (-not (Test-Path $secretsPath)) {
    throw "Secrets non trovati: $secretsPath"
}
. $secretsPath

# ===== Logging =====
$logDir = Join-Path $PSScriptRoot 'logs'
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir | Out-Null }
$logFile = Join-Path $logDir ("ordine-del-giorno-$(Get-Date -Format 'yyyy-MM-dd').log")
function Log($msg) {
    $line = "[$(Get-Date -Format 'HH:mm:ss')] $msg"
    Write-Host $line
    Add-Content -Path $logFile -Value $line -Encoding UTF8
}

# ===== Date in timezone Casablanca =====
$tz = [System.TimeZoneInfo]::FindSystemTimeZoneById('Morocco Standard Time')
$nowUtc = [DateTime]::UtcNow
$todayCasa = [System.TimeZoneInfo]::ConvertTimeFromUtc($nowUtc, $tz)
$today = $todayCasa.ToString('yyyy-MM-dd')
$nowIso = $nowUtc.ToString('yyyy-MM-ddTHH:mm:ssZ')
$yesterdayIso = $nowUtc.AddHours(-24).ToString('yyyy-MM-ddTHH:mm:ssZ')

Log "===== Ordine del giorno per $today (now=$nowIso UTC) ====="

# ===== Headers Supabase =====
$sbHeaders = @{
    'apikey'        = $SUPABASE_SERVICE_KEY
    'Authorization' = "Bearer $SUPABASE_SERVICE_KEY"
}

function Get-SupabaseData($path) {
    try {
        return Invoke-RestMethod -Uri "$SUPABASE_URL/rest/v1/$path" -Headers $sbHeaders -Method Get
    } catch {
        Log "ERRORE GET $path : $_"
        return @()
    }
}

# ===== 1. Macro eventi oggi =====
$macro = Get-SupabaseData "allert?select=titolo,ora_evento,impatto,valuta,note&data_evento=eq.$today&order=ora_evento.asc"
if ($null -eq $macro) { $macro = @() } elseif ($macro -isnot [array]) { $macro = @($macro) }
Log "Macro eventi oggi: $($macro.Count)"

# ===== 2. Bias aperti (esito IS NULL) =====
$bias = Get-SupabaseData "bias?select=asset,direzione,data,commento&esito=is.null&order=data.desc&limit=10"
if ($null -eq $bias) { $bias = @() } elseif ($bias -isnot [array]) { $bias = @($bias) }
Log "Bias aperti: $($bias.Count)"

# ===== 3. Ultimi 5 trade =====
$trades = Get-SupabaseData "trades?select=asset,direzione,data,pnl,esito,rr_reale&order=data.desc&limit=5"
if ($null -eq $trades) { $trades = @() } elseif ($trades -isnot [array]) { $trades = @($trades) }
Log "Ultimi trade: $($trades.Count)"

# ===== 4. Forza USD =====
$usdNow = Get-SupabaseData "forza_usd?select=usd_strength,created_at&order=created_at.desc&limit=1"
$usdYesterday = Get-SupabaseData "forza_usd?select=usd_strength,created_at&created_at=lte.$yesterdayIso&order=created_at.desc&limit=1"

$usdVal = if ($usdNow -and $usdNow.Count -gt 0) { [double]$usdNow[0].usd_strength } else { $null }
$usdPrev = if ($usdYesterday -and $usdYesterday.Count -gt 0) { [double]$usdYesterday[0].usd_strength } else { $null }
$usdDelta = $null
$usdTrend = 'n/d'
if ($null -ne $usdVal -and $null -ne $usdPrev) {
    $usdDelta = $usdVal - $usdPrev
    if ($usdDelta -gt 0.005) { $usdTrend = 'in rafforzamento' }
    elseif ($usdDelta -lt -0.005) { $usdTrend = 'in indebolimento' }
    else { $usdTrend = 'stabile' }
}
Log "USD strength: valore=$usdVal trend=$usdTrend delta=$usdDelta"

# ===== 5. Composizione narrativa (template) =====
$narrativaParts = @("Giornata del $today.")

$macroHigh = @($macro | Where-Object { $_.impatto -in @('High','high','alto','Alto') })
if ($macroHigh.Count -gt 0) {
    $nUsd = @($macroHigh | Where-Object { $_.valuta -eq 'USD' }).Count
    $extra = if ($nUsd -gt 0) { ", $nUsd su USD (riflesso atteso su XAUUSD inverso e indici USA)." } else { "." }
    $narrativaParts += "In agenda $($macroHigh.Count) eventi ad alto impatto$extra"
} else {
    $narrativaParts += "Nessun evento macro ad alto impatto in calendario oggi."
}

if ($usdTrend -ne 'n/d') {
    $valR = [Math]::Round($usdVal, 4)
    $delR = [Math]::Round($usdDelta, 4)
    $narrativaParts += "Dollaro $usdTrend (valore $valR, delta 24h $delR)."
}

if ($bias.Count -gt 0) {
    $narrativaParts += "$($bias.Count) bias ancora aperti da rivalutare."
}

# Streak analysis sugli ultimi trade
$streakWin = 0
$streakLoss = 0
foreach ($t in $trades) {
    if ($t.esito -eq 'win') {
        if ($streakLoss -gt 0) { break }
        $streakWin++
    } elseif ($t.esito -eq 'loss') {
        if ($streakWin -gt 0) { break }
        $streakLoss++
    } else { break }
}
if ($streakLoss -ge 3) {
    $narrativaParts += "ATTENZIONE: $streakLoss loss consecutivi negli ultimi trade - valuta riduzione size e pausa."
} elseif ($streakWin -ge 3) {
    $narrativaParts += "Momentum positivo ($streakWin win consecutivi). Attenzione all overconfidence."
}

$narrativaText = $narrativaParts -join ' '

# ===== Watchlist (heuristic) =====
$watchlist = New-Object System.Collections.Generic.List[string]
if ($usdTrend -eq 'in indebolimento') {
    $watchlist.Add("XAUUSD: bias long favorito da USD in debolezza") | Out-Null
} elseif ($usdTrend -eq 'in rafforzamento') {
    $watchlist.Add("XAUUSD: short favorito con USD in rafforzamento, attenzione a rimbalzi") | Out-Null
}
foreach ($b in ($bias | Select-Object -First 3)) {
    $watchlist.Add("$($b.asset): bias $($b.direzione) aperto - verifica validita") | Out-Null
}
if ($macroHigh.Count -gt 0) {
    $orari = ($macroHigh | ForEach-Object { if ($_.ora_evento) { $_.ora_evento.Substring(0,5) } else { '?' } }) -join ', '
    $watchlist.Add("Volatilita attesa intorno a: $orari") | Out-Null
}

# ===== 6. Costruisci JSON ordine_del_giorno =====
$ordineDelGiorno = [ordered]@{
    generato_alle = $nowIso
    macro_oggi = @(
        $macro | ForEach-Object {
            [ordered]@{
                titolo  = $_.titolo
                ora     = if ($_.ora_evento) { $_.ora_evento.Substring(0,5) } else { '' }
                impatto = $_.impatto
                valuta  = $_.valuta
                note    = $_.note
            }
        }
    )
    bias_aperti = @(
        $bias | ForEach-Object {
            $com = $_.commento
            if ($com -and $com.Length -gt 200) { $com = $com.Substring(0,200) + '...' }
            [ordered]@{
                asset     = $_.asset
                direzione = $_.direzione
                commento  = $com
            }
        }
    )
    ultimi_trade = @(
        $trades | ForEach-Object {
            [ordered]@{
                asset     = $_.asset
                direzione = $_.direzione
                pnl       = $_.pnl
                esito     = $_.esito
            }
        }
    )
    usd_strength = [ordered]@{
        valore    = $usdVal
        trend_24h = $usdTrend
        delta     = $usdDelta
    }
    narrativa = $narrativaText
    watchlist = @($watchlist)
}

# ===== 7. UPSERT su Supabase =====
$writeHeaders = @{
    'apikey'        = $SUPABASE_SERVICE_KEY
    'Authorization' = "Bearer $SUPABASE_SERVICE_KEY"
    'Content-Type'  = 'application/json'
    'Prefer'        = 'return=representation'
}

$patchBody = @{ ordine_del_giorno = $ordineDelGiorno } | ConvertTo-Json -Depth 10 -Compress
$patchBytes = [System.Text.Encoding]::UTF8.GetBytes($patchBody)

try {
    $patchResp = Invoke-RestMethod -Method Patch -Uri "$SUPABASE_URL/rest/v1/giornate?data=eq.$today" -Headers $writeHeaders -Body $patchBytes
    if ($null -eq $patchResp -or $patchResp.Count -eq 0) {
        Log "Nessun record per oggi, creo nuovo."
        $postBody = @{ data = $today; stato = 'nuovo'; ordine_del_giorno = $ordineDelGiorno } | ConvertTo-Json -Depth 10 -Compress
        $postBytes = [System.Text.Encoding]::UTF8.GetBytes($postBody)
        $postResp = Invoke-RestMethod -Method Post -Uri "$SUPABASE_URL/rest/v1/giornate" -Headers $writeHeaders -Body $postBytes
        Log "Record creato id=$($postResp[0].id)"
    } else {
        Log "Ordine del giorno salvato su record id=$($patchResp[0].id)"
    }
} catch {
    Log "ERRORE salvataggio Supabase: $_"
    throw
}

# ===== 8. Manda Telegram =====
# Emoji costruite via code points per evitare problemi di encoding del file PS
$EM_SUNRISE = [char]::ConvertFromUtf32(0x1F305)  # sunrise
$EM_CHART   = [char]::ConvertFromUtf32(0x1F4CA)  # bar chart
$EM_COMPASS = [char]::ConvertFromUtf32(0x1F9ED)  # compass
$EM_TREND   = [char]::ConvertFromUtf32(0x1F4C8)  # chart up
$EM_DOLLAR  = [char]::ConvertFromUtf32(0x1F4B5)  # dollar
$EM_TARGET  = [char]::ConvertFromUtf32(0x1F3AF)  # target

$macroLines = if ($macro.Count -gt 0) {
    ($macro | ForEach-Object {
        $ora = if ($_.ora_evento) { $_.ora_evento.Substring(0,5) } else { '--:--' }
        "- $ora <b>$($_.titolo)</b> [$($_.impatto)/$($_.valuta)]"
    }) -join "`n"
} else { "<i>nessun evento</i>" }

$biasLines = if ($bias.Count -gt 0) {
    ($bias | ForEach-Object { "- <b>$($_.asset)</b> $($_.direzione)" }) -join "`n"
} else { "<i>nessuno</i>" }

$tradeNetPnl = if ($trades.Count -gt 0) { [Math]::Round((($trades | Measure-Object -Property pnl -Sum).Sum), 2) } else { 0 }
$tradeLines = if ($trades.Count -gt 0) {
    ($trades | ForEach-Object {
        $p = if ($_.pnl -ge 0) { "+$($_.pnl)" } else { "$($_.pnl)" }
        "- $($_.asset) $($_.direzione) <b>$p</b> ($($_.esito))"
    }) -join "`n"
} else { "<i>nessun trade</i>" }

$watchLines = if ($watchlist.Count -gt 0) {
    ($watchlist | ForEach-Object { "&gt; $_" }) -join "`n"
} else { "<i>nessuno spunto</i>" }

$usdValStr = if ($null -ne $usdVal) { [Math]::Round($usdVal, 4).ToString() } else { 'n/d' }

$msg = "$EM_SUNRISE <b>Ordine del Giorno</b> - <i>$today</i>`n`n"
$msg += "$narrativaText`n`n"
$msg += "$EM_CHART <b>Macro Oggi</b>: $($macro.Count) eventi`n"
$msg += "$macroLines`n`n"
$msg += "$EM_COMPASS <b>Bias Aperti</b>: $($bias.Count)`n"
$msg += "$biasLines`n`n"
$msg += "$EM_TREND <b>Ultimi 5 trade</b>: net PnL <b>$tradeNetPnl</b>`n"
$msg += "$tradeLines`n`n"
$msg += "$EM_DOLLAR <b>Forza USD</b>: $usdValStr ($usdTrend)`n`n"
$msg += "$EM_TARGET <b>Watchlist</b>:`n"
$msg += "$watchLines"

$tgBody = @{
    chat_id    = $TELEGRAM_CHAT_ID
    parse_mode = 'HTML'
    text       = $msg
} | ConvertTo-Json
$tgBytes = [System.Text.Encoding]::UTF8.GetBytes($tgBody)

try {
    $tgResp = Invoke-RestMethod -Method Post -Uri "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/sendMessage" -ContentType 'application/json; charset=utf-8' -Body $tgBytes
    Log "Telegram OK message_id=$($tgResp.result.message_id)"
} catch {
    Log "ERRORE Telegram: $_"
    throw
}

Log "===== Ordine del giorno completato ====="
