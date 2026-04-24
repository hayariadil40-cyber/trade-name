# Routine Peter EOD — 17:15 Casablanca
# Digest giornata completa con metriche + confronto vs baseline 30gg.

. "$PSScriptRoot\routine-common.ps1"

$today = Get-TodayCasaIso
Write-RoutineLog 'peter-eod' "===== Run per $today ====="

# Giornata corrente
$tradesOggi = @(Invoke-SbGet "trades?select=asset,direzione,esito,pnl,pips,screenshot_url,strategia_id,data&data=gte.${today}T00:00:00&data=lte.${today}T23:59:59&order=data.asc")

$giornata = Invoke-SbGet "giornate?select=mindset,volatilita,note_domani,fajr,stato&data=eq.$today&limit=1"
$giornata = if ($giornata -and $giornata.Count -gt 0) { $giornata[0] } else { $null }

$reperti = @(Invoke-SbGet "bias?select=asset,direzione,tipo&data=eq.$today")

# Baseline 30 gg (escluso oggi)
$inizio30gg = (Get-Date).ToUniversalTime().AddDays(-30).ToString('yyyy-MM-ddTHH:mm:ssZ')
$fineIeri = (Get-Date -Hour 0 -Minute 0 -Second 0).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
$trades30 = @(Invoke-SbGet "trades?select=esito,pnl&data=gte.$inizio30gg&data=lt.$fineIeri")

# Metriche oggi
$nOggi  = $tradesOggi.Count
$winsOggi = @($tradesOggi | Where-Object { $_.esito -eq 'win' }).Count
$lossOggi = @($tradesOggi | Where-Object { $_.esito -eq 'loss' }).Count
$decOggi  = $winsOggi + $lossOggi
$wrOggi   = if ($decOggi -gt 0) { [Math]::Round(($winsOggi / $decOggi) * 100, 1) } else { $null }
$pnlOggi  = if ($nOggi -gt 0) { [Math]::Round((($tradesOggi | Measure-Object -Property pnl -Sum).Sum), 2) } else { 0 }
$noScrOggi = @($tradesOggi | Where-Object { -not $_.screenshot_url }).Count
$noStratOggi = @($tradesOggi | Where-Object { -not $_.strategia_id }).Count

# Baseline 30gg
$n30 = $trades30.Count
$wins30 = @($trades30 | Where-Object { $_.esito -eq 'win' }).Count
$loss30 = @($trades30 | Where-Object { $_.esito -eq 'loss' }).Count
$dec30  = $wins30 + $loss30
$wr30   = if ($dec30 -gt 0) { [Math]::Round(($wins30 / $dec30) * 100, 1) } else { $null }
$pnl30  = if ($n30 -gt 0) { [Math]::Round((($trades30 | Measure-Object -Property pnl -Sum).Sum), 2) } else { 0 }
$avgPnl30 = if ($n30 -gt 0) { [Math]::Round(($pnl30 / $n30), 2) } else { 0 }

Write-RoutineLog 'peter-eod' "oggi trade=$nOggi wr=$wrOggi pnl=$pnlOggi | 30gg trade=$n30 wr=$wr30"

$systemPrompt = @"
Sei PETER, analista comportamentale del trading dell'utente. Scrivi in italiano.

IDENTITA: analitico, clinico, obiettivo. Zero toni motivazionali, zero coaching da palestra, zero parolacce.
Commenti i FATTI. Non presumere pattern. Se suggerisci una tendenza, cita il campione (n).

CONTESTO: chiusura giornata (17:15 Casablanca). Ti do i dati di oggi + baseline ultimi 30 giorni (escluso oggi) per confronto oggettivo.

OUTPUT:
- 8-14 righe. HTML Telegram: <b>, <i>. Max 1 emoji all'inizio se serve.
- Struttura:
  1) Riepilogo numerico giornata (n trade, WR, net PnL).
  2) Confronto con baseline 30gg (solo se n >= 10, altrimenti salta il confronto).
  3) Compilazione: screenshot/strategia mancanti. Segnalali.
  4) Coerenza con reperti/bias scritti oggi.
  5) 1 riga operativa finale (es. "prima di chiudere: completa giornaliero e note domani"). Neutra, non motivazionale.

Se nOggi = 0: riconoscilo e chiedi riflessione breve (senza giudizio).
Se baseline n < 10: nota che il confronto non e ancora statisticamente robusto.
"@

$payload = @{
    data = $today
    oggi = @{
        n_trade = $nOggi
        wins = $winsOggi
        losses = $lossOggi
        winrate_pct = $wrOggi
        net_pnl = $pnlOggi
        senza_screenshot = $noScrOggi
        senza_strategia = $noStratOggi
        mindset = if ($giornata) { $giornata.mindset } else { $null }
        stato_giornata = if ($giornata) { $giornata.stato } else { 'non_aperta' }
        note_domani_scritte = ($giornata -and $giornata.note_domani)
        reperti_creati = $reperti.Count
    }
    baseline_30gg = @{
        n_trade = $n30
        winrate_pct = $wr30
        net_pnl = $pnl30
        pnl_medio_per_trade = $avgPnl30
    }
    trade_dettaglio_oggi = @($tradesOggi | ForEach-Object {
        @{ asset = $_.asset; direzione = $_.direzione; esito = $_.esito; pnl = $_.pnl; pips = $_.pips }
    })
}
$payloadJson = $payload | ConvertTo-Json -Depth 10 -Compress

try {
    $text = Invoke-Claude -SystemPrompt $systemPrompt -UserPrompt "Dati in JSON:`n$payloadJson" -MaxTokens 1800
    Write-RoutineLog 'peter-eod' "Claude OK ($($text.Length) char)"
} catch {
    Write-RoutineLog 'peter-eod' "ERRORE Claude: $($_.Exception.Message)"
    throw
}

$EM_MOON = [char]::ConvertFromUtf32(0x1F319)
$msg = "$EM_MOON <b>Peter - EOD $today</b>`n`n$text"
$tg = Send-Telegram -Text $msg -ParseMode 'HTML'
Write-RoutineLog 'peter-eod' "Telegram: $($tg.Ok) id=$($tg.MessageId)"

Write-AssistantMessage -Assistente 'peter' -Contenuto $text -Slot 'peter-eod' `
    -Metadata @{ data = $today; n_oggi = $nOggi; wr_oggi = $wrOggi; pnl_oggi = $pnlOggi; telegram_message_id = $tg.MessageId }

Write-RoutineEvent -Slot 'peter-eod' -Tipo 'ai-debrief' -Assistente 'peter' `
    -Payload @{ n_oggi = $nOggi; wr_oggi = $wrOggi; pnl_oggi = $pnlOggi; output = $text } `
    -TelegramSent $tg.Ok -TelegramMessageId ([long]($tg.MessageId | ForEach-Object { if ($_) { $_ } else { 0 } }))

Write-RoutineLog 'peter-eod' "===== Fine ====="
