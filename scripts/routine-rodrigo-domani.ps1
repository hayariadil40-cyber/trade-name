# Routine Rodrigo Domani — 21:00 Casablanca
# Prep per domani: calendario news, bias aperti da rivalutare, giornaliero/note pending.

. "$PSScriptRoot\routine-common.ps1"

$today    = Get-TodayCasaIso
# Prossima giornata operativa: salta sabato/domenica
$nextDay = (Get-CasablancaDate).AddDays(1)
while ($nextDay.DayOfWeek -eq [DayOfWeek]::Saturday -or $nextDay.DayOfWeek -eq [DayOfWeek]::Sunday) {
    $nextDay = $nextDay.AddDays(1)
}
$domani = $nextDay.ToString('yyyy-MM-dd')
$domaniLabel = $nextDay.ToString('dddd d MMMM', [System.Globalization.CultureInfo]::GetCultureInfo('it-IT'))
Write-RoutineLog 'rodrigo-domani' "===== Run per $today (prep prossima giornata operativa=$domani / $domaniLabel) ====="

# Calendario news di domani (high impact filtrati)
$macroDomani = @(Invoke-SbGet "allert?select=titolo,ora_evento,impatto,valuta,note&data_evento=eq.$domani&order=ora_evento.asc")
$macroAlti = @($macroDomani | Where-Object { $_.impatto -in @('alto','high','High','Alto') })

# Reperti aperti (senza esito) piu vecchi di 2 gg
$cutoff2gg = (Get-CasablancaDate).AddDays(-2).ToString('yyyy-MM-dd')
$biasVecchi = @(Invoke-SbGet "bias?select=asset,direzione,data&esito=is.null&data=lte.$cutoff2gg&order=data.asc&limit=10")

# Stato giornata oggi: e stata chiusa? Giornaliero compilato?
$giornataOggi = Invoke-SbGet "giornate?select=stato,mindset,note_domani&data=eq.$today&limit=1"
$giornataOggi = if ($giornataOggi -and $giornataOggi.Count -gt 0) { $giornataOggi[0] } else { $null }

# Trade oggi non compilati (no screenshot)
$tradesNonCompilati = @(Invoke-SbGet "trades?select=asset,direzione&data=gte.${today}T00:00:00&data=lte.${today}T23:59:59&screenshot_url=is.null")

Write-RoutineLog 'rodrigo-domani' "macro_alti=$($macroAlti.Count) bias_vecchi=$($biasVecchi.Count) non_compilati=$($tradesNonCompilati.Count)"

# Determina se e venerdi (per promemoria weekly)
$giornoSettimana = (Get-CasablancaDate).DayOfWeek  # 'Friday' = 5
$isFriday = ($giornoSettimana -eq 'Friday')

$systemPrompt = @"
Sei RODRIGO, assistente operativo giornaliero. Scrivi in italiano, tono pratico e sveglio.

CONTESTO: sono le 21:00 Casablanca. La giornata di trading di oggi e chiusa. Sto preparando l'utente per la prossima giornata operativa: $domaniLabel ($domani). Se la data salta il weekend (es. venerdi sera -> lunedi), menziona esplicitamente che si tratta della prossima apertura dei mercati.

OUTPUT:
- Max 10 righe. HTML Telegram: <b>, <i>.
- Struttura:
  1) Una riga di contesto breve (pending di oggi se ce ne sono, altrimenti "oggi chiuso pulito")
  2) Eventi macro high-impact di domani con orari (se ce ne sono)
  3) Reperti aperti da oltre 2 giorni da rivalutare (solo se ce ne sono)
  4) Promemoria weekly review (solo se oggi e venerdi)

REGOLE:
- Se non ci sono eventi high-impact, dillo brevemente e passa oltre.
- Zero parolacce. Tono da compagno operativo, non coach.
- Niente riempitivi. Se una sezione e vuota, saltala, non dire "nulla da segnalare".
- Non firmare.
"@

$payload = @{
    oggi = $today
    domani = $domani
    is_venerdi = $isFriday
    pending_oggi = @{
        giornata_non_chiusa = (-not $giornataOggi -or $giornataOggi.stato -ne 'completato')
        note_domani_mancanti = (-not $giornataOggi -or -not $giornataOggi.note_domani)
        trade_senza_screenshot = $tradesNonCompilati.Count
    }
    macro_domani = @($macroAlti | ForEach-Object {
        @{ ora = $_.ora_evento; titolo = $_.titolo; valuta = $_.valuta; impatto = $_.impatto }
    })
    bias_da_rivalutare = @($biasVecchi | ForEach-Object {
        @{ asset = $_.asset; direzione = $_.direzione; data = $_.data }
    })
}
$payloadJson = $payload | ConvertTo-Json -Depth 10 -Compress

try {
    $text = Invoke-Claude -SystemPrompt $systemPrompt -UserPrompt "Dati prep domani in JSON:`n$payloadJson" -MaxTokens 1200
    Write-RoutineLog 'rodrigo-domani' "Claude OK ($($text.Length) char)"
} catch {
    Write-RoutineLog 'rodrigo-domani' "ERRORE Claude: $($_.Exception.Message)"
    throw
}

$EM_TOMORROW = [char]::ConvertFromUtf32(0x1F4C5)
$msg = "$EM_TOMORROW <b>Prep $domaniLabel</b> - <i>Rodrigo</i>`n`n$text"
$tg = Send-Telegram -Text $msg -ParseMode 'HTML'
Write-RoutineLog 'rodrigo-domani' "Telegram: $($tg.Ok) id=$($tg.MessageId)"

Write-AssistantMessage -Assistente 'rodrigo' -Contenuto $text -Slot 'rodrigo-domani' `
    -Metadata @{ data = $today; domani = $domani; telegram_message_id = $tg.MessageId }

Write-RoutineEvent -Slot 'rodrigo-domani' -Tipo 'ai-prep' -Assistente 'rodrigo' `
    -Payload @{ macro_alti = $macroAlti.Count; bias_vecchi = $biasVecchi.Count; output = $text } `
    -TelegramSent $tg.Ok -TelegramMessageId ([long]($tg.MessageId | ForEach-Object { if ($_) { $_ } else { 0 } }))

Write-RoutineLog 'rodrigo-domani' "===== Fine ====="
