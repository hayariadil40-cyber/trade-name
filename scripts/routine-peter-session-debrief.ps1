# Routine Peter Debrief Sessione — invocato a fine Londra (11:15) o fine NY (16:45)
# Parametro: -Sessione 'londra' | 'ny'
# Analizza i trade della sessione e produce un debrief analitico firmato Peter.

param(
    [Parameter(Mandatory=$true)][ValidateSet('londra','ny')][string]$Sessione
)

. "$PSScriptRoot\routine-common.ps1"

$today = Get-TodayCasaIso
$slot = "peter-debrief-$Sessione"
Write-RoutineLog $slot "===== Run per $today ($Sessione) ====="

# ===== Finestra orari sessione (Casablanca) =====
$tz = [System.TimeZoneInfo]::FindSystemTimeZoneById('Morocco Standard Time')
$casa = Get-CasablancaDate
function New-UnspecifiedDateTime([int]$y, [int]$m, [int]$d, [int]$h, [int]$mi) {
    return New-Object DateTime ($y, $m, $d, $h, $mi, 0, [DateTimeKind]::Unspecified)
}

if ($Sessione -eq 'londra') {
    $winStartCasa = New-UnspecifiedDateTime $casa.Year $casa.Month $casa.Day 8 0
    $winEndCasa   = New-UnspecifiedDateTime $casa.Year $casa.Month $casa.Day 11 30
    $sessLabel    = 'LONDRA'
    $sessHoursLabel = '08:00-11:30 Casa'
} else {
    $winStartCasa = New-UnspecifiedDateTime $casa.Year $casa.Month $casa.Day 12 30
    $winEndCasa   = New-UnspecifiedDateTime $casa.Year $casa.Month $casa.Day 17 0
    $sessLabel    = 'NY'
    $sessHoursLabel = '12:30-17:00 Casa'
}

$winStartUtc = [System.TimeZoneInfo]::ConvertTimeToUtc($winStartCasa, $tz).ToString('yyyy-MM-ddTHH:mm:ssZ')
$winEndUtc   = [System.TimeZoneInfo]::ConvertTimeToUtc($winEndCasa, $tz).ToString('yyyy-MM-ddTHH:mm:ssZ')

# ===== Raccolta dati =====
$trades = Invoke-SbGet "trades?select=id,asset,direzione,entry_price,exit_price,stop_loss,take_profit,pips,pnl,esito,screenshot_url,strategia_id,mood,note,data&data=gte.$winStartUtc&data=lte.$winEndUtc&order=data.asc"
$trades = @($trades)

# Mindset e volatilita della giornata
$giornata = Invoke-SbGet "giornate?select=mindset,volatilita&data=eq.$today&limit=1"
$giornata = if ($giornata -and $giornata.Count -gt 0) { $giornata[0] } else { $null }

# Bias di oggi: commenti_giornata (testo narrativo) + coin_data (aggiornamenti per asset)
$biasRaw = Invoke-SbGet "bias?select=coin_data,commenti_giornata&data=eq.$today&stato=eq.aperto&limit=1"
$biasRaw = if ($biasRaw -and $biasRaw.Count -gt 0) { $biasRaw[0] } else { $null }

$coinData = $null
if ($biasRaw -and $biasRaw.coin_data) {
    $coinData = if ($biasRaw.coin_data -is [string]) {
        $biasRaw.coin_data | ConvertFrom-Json
    } else {
        $biasRaw.coin_data
    }
}

# Ipotesi collegate ai trade della sessione (via trade_id)
$ipotesiByTrade = @{}
foreach ($t in $trades) {
    if (-not $t.id) { continue }
    $ip = Invoke-SbGet "ipotesi_trading?select=trade_id,stato,direzione,check_list_flagged,dove_entro_flagged,dove_esco_sl_flagged,dove_esco_tp_flagged,note&trade_id=eq.$($t.id)&limit=1"
    if ($ip -and $ip.Count -gt 0) { $ipotesiByTrade[$t.id] = $ip[0] }
}

Write-RoutineLog $slot "trades=$($trades.Count) mindset=$($giornata.mindset) bias=$($null -ne $biasRaw) ipotesi=$($ipotesiByTrade.Count)"

# ===== Calcolo metriche base =====
$nTrade  = $trades.Count
$wins    = @($trades | Where-Object { $_.esito -eq 'win' }).Count
$losses  = @($trades | Where-Object { $_.esito -eq 'loss' }).Count
$decisi  = $wins + $losses
$winrate = if ($decisi -gt 0) { [Math]::Round(($wins / $decisi) * 100, 1) } else { $null }
$netPnl  = if ($nTrade -gt 0) { [Math]::Round((($trades | Measure-Object -Property pnl -Sum).Sum), 2) } else { 0 }
$noScreen = @($trades | Where-Object { -not $_.screenshot_url -or $_.screenshot_url -eq '' }).Count
$noStrat  = @($trades | Where-Object { -not $_.strategia_id }).Count

# ===== Se zero trade, messaggio breve =====
if ($nTrade -eq 0) {
    $EM_NOTE = [char]::ConvertFromUtf32(0x1F4DD)
    $zeroText = "Nessun trade registrato nella finestra $sessHoursLabel.`nSe hai rispettato il piano senza setup validi, va bene. Se hai lasciato passare opportunita, segnalalo nelle note."
    $msg = "$EM_NOTE <b>Peter - Debrief $sessLabel</b>`n`n$zeroText"
    $tg = Send-Telegram -Text $msg -ParseMode 'HTML'
    Write-AssistantMessage -Assistente 'peter' -Contenuto $zeroText -Slot $slot `
        -Metadata @{ sessione = $Sessione; data = $today; n_trade = 0; telegram_message_id = $tg.MessageId }
    Write-RoutineEvent -Slot $slot -Tipo 'ai-debrief' -Assistente 'peter' `
        -Payload @{ n_trade = 0 } -TelegramSent $tg.Ok `
        -TelegramMessageId ([long]($tg.MessageId | ForEach-Object { if ($_) { $_ } else { 0 } }))
    Write-RoutineLog $slot "Zero trade, messaggio breve inviato."
    return
}

# ===== Prompt Claude =====
$systemPrompt = @"
Sei PETER, analista comportamentale del trading dell'utente. Scrivi in italiano.

IDENTITA:
- Analitico, clinico, obiettivo. Non coach da palestra. Non motivazionale. Non empatico.
- Commenti i FATTI: metriche, compilazione, rispetto del piano, distribuzione degli esiti.
- NON presumere pattern. Se un'osservazione emerge dai dati, esplicita il campione ("n=4, campione debole da confermare").
- Zero parolacce, zero termini volgari o colloquiali pesanti.

CONTESTO: debrief di fine sessione $sessLabel (finestra $sessHoursLabel) appena chiusa.

FOCUS ANALITICO (in ordine di priorita):
1. Performance oggettiva: n trade, WR, net PnL, RR se ricavabile
2. Compilazione: screenshot mancanti, strategia non collegata -> sollevali
3. Rispetto del piano: max 3 trade per sessione -> segnala se superato
4. Coerenza bias/trade: confronta direzione di ogni trade con gli aggiornamenti bias dell'asset (campo aggiornamenti per asset in bias_oggi). Se trade long su XAU ma aggiornamenti indicano short -> segnala incongruenza. Se bias non compilato, dillo esplicitamente senza giudicare.
5. Rispetto ipotesi: ogni trade ha un campo ipotesi_collegata con i flag della checklist (check_list, entry, sl, tp). Segnala flag non rispettati. Se ipotesi assente per un trade, segnalalo come gap.
6. Mindset dichiarato (campo mindset_giornata) vs esito sessione.

REGOLE OUTPUT:
- Tra 6 e 12 righe.
- HTML Telegram: <b>, <i>. No markdown, no emoji se non necessarie (max 1 all'inizio).
- Dati numerici con precisione ragionevole (1 decimale per percentuali, 2 per PnL).
- Nessuna conclusione moraleggiante. Finisci con una riga operativa neutra, non con una frase d'incoraggiamento.
"@

# Costruisci payload trade con ipotesi embedded
$payloadTrades = @($trades | ForEach-Object {
    $tid = $_.id
    $ip  = $ipotesiByTrade[$tid]
    [ordered]@{
        asset        = $_.asset
        direzione    = $_.direzione
        entry        = $_.entry_price
        exit         = $_.exit_price
        sl           = $_.stop_loss
        tp           = $_.take_profit
        pips         = $_.pips
        pnl          = $_.pnl
        esito        = $_.esito
        ha_screenshot = [bool]($_.screenshot_url)
        ha_strategia  = [bool]($_.strategia_id)
        mood         = $_.mood
        note         = $_.note
        ora          = $_.data
        ipotesi_collegata = if ($ip) { [ordered]@{
            stato         = $ip.stato
            direzione     = $ip.direzione
            check_list    = $ip.check_list_flagged
            entry_ok      = $ip.dove_entro_flagged
            sl_ok         = $ip.dove_esco_sl_flagged
            tp_ok         = $ip.dove_esco_tp_flagged
            note          = $ip.note
        }} else { $null }
    }
})

# Reperti bias: aggiornamenti per asset (ultimi 3) + slot H4 correnti
$reperti = if ($coinData) {
    @($coinData.PSObject.Properties | ForEach-Object {
        $assetName = $_.Name
        $assetData = $_.Value
        $agg = @()
        if ($assetData.aggiornamenti) {
            $allAgg = @($assetData.aggiornamenti)
            $agg = if ($allAgg.Count -gt 3) { $allAgg[-3..-1] } else { $allAgg }
            $agg = @($agg | ForEach-Object { @{ ora = $_.ora; testo = $_.testo; direzione = $_.direzione } })
        }
        @{
            asset           = $assetName
            aggiornamenti   = $agg
            bias_h4_slots   = $assetData.bias_h4
        }
    })
} else { @() }

$payload = @{
    sessione        = $Sessione
    data            = $today
    finestra_orari  = $sessHoursLabel
    metriche        = @{
        n_trade                 = $nTrade
        wins                    = $wins
        losses                  = $losses
        winrate_pct             = $winrate
        net_pnl                 = $netPnl
        trade_senza_screenshot  = $noScreen
        trade_senza_strategia   = $noStrat
        max_per_sessione        = 3
        superato_max            = ($nTrade -gt 3)
    }
    mindset_giornata    = if ($giornata) { $giornata.mindset }   else { $null }
    volatilita_giornata = if ($giornata) { $giornata.volatilita } else { $null }
    commenti_bias       = if ($biasRaw)  { $biasRaw.commenti_giornata } else { $null }
    bias_oggi           = $reperti
    trade               = $payloadTrades
}
$payloadJson = $payload | ConvertTo-Json -Depth 10 -Compress

$userPrompt = "Dati sessione $sessLabel in JSON (analizza SOLO questi, non inventare):`n$payloadJson"

# ===== Chiamata Claude =====
try {
    $text = Invoke-Claude -SystemPrompt $systemPrompt -UserPrompt $userPrompt -MaxTokens 1500
    Write-RoutineLog $slot "Claude OK ($($text.Length) char)"
} catch {
    Write-RoutineLog $slot "ERRORE Claude: $($_.Exception.Message)"
    throw
}

$EM_CHART = [char]::ConvertFromUtf32(0x1F4CA)
$msg = "$EM_CHART <b>Peter - Debrief $sessLabel</b>`n`n$text"

$tg = Send-Telegram -Text $msg -ParseMode 'HTML'
Write-RoutineLog $slot "Telegram: $($tg.Ok) id=$($tg.MessageId)"

Write-AssistantMessage -Assistente 'peter' -Contenuto $text -Slot $slot `
    -Metadata @{ sessione = $Sessione; data = $today; n_trade = $nTrade; winrate = $winrate; net_pnl = $netPnl; telegram_message_id = $tg.MessageId }

Write-RoutineEvent -Slot $slot -Tipo 'ai-debrief' -Assistente 'peter' `
    -Payload @{ n_trade = $nTrade; winrate = $winrate; net_pnl = $netPnl; output = $text } `
    -TelegramSent $tg.Ok `
    -TelegramMessageId ([long]($tg.MessageId | ForEach-Object { if ($_) { $_ } else { 0 } }))

Write-RoutineLog $slot "===== Fine ====="
