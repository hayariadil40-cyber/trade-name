# Routine Rodrigo Morning — 07:30 Casablanca
# Legge stato giornata, checklist, briefing, reperti; invia su Telegram un messaggio operativo firmato Rodrigo.

. "$PSScriptRoot\routine-common.ps1"

$today = Get-TodayCasaIso
Write-RoutineLog 'rodrigo-morning' "===== Run per $today ====="

# ===== Raccolta dati =====
$giornata = Invoke-SbGet "giornate?select=stato,mindset,note_domani,fajr,briefing,checklist_stato&data=eq.$today&limit=1"
$giornata = if ($giornata -and $giornata.Count -gt 0) { $giornata[0] } else { $null }

$reperti = Invoke-SbGet "bias?select=asset,direzione,tipo,created_at&data=eq.$today&order=created_at.desc"

$allertOggi = Invoke-SbGet "allert?select=titolo,ora_evento,impatto,valuta&data_evento=eq.$today&impatto=in.(alto,high)&order=ora_evento.asc"

# Articoli letture di oggi (gia curati) — prendi solo i top per rilevanza
$casa = Get-CasablancaDate
$tzCasa = [System.TimeZoneInfo]::FindSystemTimeZoneById('Morocco Standard Time')
$inizioOggiCasa = New-Object DateTime ($casa.Year, $casa.Month, $casa.Day, 0, 0, 0, [DateTimeKind]::Unspecified)
$inizioOggiUtc = ([System.TimeZoneInfo]::ConvertTimeToUtc($inizioOggiCasa, $tzCasa)).ToString('yyyy-MM-ddTHH:mm:ssZ')
$articoli = Invoke-SbGet "articoli_daily?select=titolo,fonte,tag_tema,rilevanza&created_at=gte.$inizioOggiUtc&order=rilevanza.desc.nullslast&limit=5"

Write-RoutineLog 'rodrigo-morning' "giornata stato=$($giornata.stato) reperti=$($reperti.Count) macro=$($allertOggi.Count) articoli=$($articoli.Count)"

# ===== Prompt =====
$systemPrompt = @"
Sei RODRIGO, assistente operativo giornaliero di un trader. Ti rivolgi all'utente in italiano.

IDENTITA:
- Compagno operativo pratico e sveglio. Mai lungo. Zero motivational speech, zero frasi fatte.
- Bacchetti con professionalita: "ti manca X", "hai Y aperto alle Z", "ricorda W prima delle H".
- Zero parolacce, zero termini volgari. Tono sempre rispettoso.

CONTESTO: sono le 07:30 Casablanca. La giornata di trading inizia a breve (pre-Londra alle 08:30, apertura 09:00).

OBIETTIVO DEL MESSAGGIO:
1. Saluto breve
2. Stato checklist / giornata (fajr, reperto creato, compilazione)
3. Segnale eventi macro rilevanti di oggi
4. Richiami operativi su cosa fare prima dell'apertura Londra

REGOLE OUTPUT:
- Massimo 8 righe.
- Usa HTML Telegram semplice: <b>bold</b>, <i>italic</i>. Niente markdown.
- Elenchi con trattini (-) brevi, max 1 riga ciascuno.
- Se mancano cose, segnalale chiaramente. Se tutto in ordine, di' "setup OK".
- Non firmare alla fine.
"@

$payload = @{
    data_oggi = $today
    giornata_stato = if ($giornata) { $giornata.stato } else { 'NON_APERTA' }
    fajr = if ($giornata) { $giornata.fajr } else { $null }
    note_domani_ieri = if ($giornata) { $giornata.note_domani } else { $null }
    briefing_disponibile = ($giornata -and $giornata.briefing)
    reperti_oggi = @($reperti | ForEach-Object { @{ asset = $_.asset; direzione = $_.direzione; tipo = $_.tipo } })
    macro_high_impact_oggi = @($allertOggi | ForEach-Object { @{ ora = $_.ora_evento; titolo = $_.titolo; valuta = $_.valuta } })
    top_articoli = @($articoli | ForEach-Object { @{ titolo = $_.titolo; tema = $_.tag_tema; rilevanza = $_.rilevanza } })
}
$payloadJson = $payload | ConvertTo-Json -Depth 10 -Compress

$userPrompt = "Dati della giornata di oggi in JSON (usa questi, non inventare):`n$payloadJson"

# ===== Chiamata Claude =====
try {
    $text = Invoke-Claude -SystemPrompt $systemPrompt -UserPrompt $userPrompt -MaxTokens 1200
    Write-RoutineLog 'rodrigo-morning' "Claude OK ($($text.Length) char)"
} catch {
    Write-RoutineLog 'rodrigo-morning' "ERRORE Claude: $($_.Exception.Message)"
    throw
}

$EM_SUN = [char]::ConvertFromUtf32(0x1F31E)
$msg = "$EM_SUN <b>Buongiorno</b> - <i>Rodrigo</i>`n`n$text"

$tg = Send-Telegram -Text $msg -ParseMode 'HTML'
Write-RoutineLog 'rodrigo-morning' "Telegram: $($tg.Ok) id=$($tg.MessageId)"

Write-AssistantMessage -Assistente 'rodrigo' -Contenuto $text -Slot 'rodrigo-morning' `
    -Metadata @{ data = $today; telegram_message_id = $tg.MessageId }

Write-RoutineEvent -Slot 'rodrigo-morning' -Tipo 'ai-nudge' -Assistente 'rodrigo' `
    -Payload @{ output = $text } -TelegramSent $tg.Ok `
    -TelegramMessageId ([long]($tg.MessageId | ForEach-Object { if ($_) { $_ } else { 0 } }))

Write-RoutineLog 'rodrigo-morning' "===== Fine ====="
