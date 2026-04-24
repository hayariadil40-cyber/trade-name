# Routine Nudge — Notifiche temporali semplici (Livello 1)
# Invocato dal Task Scheduler con parametro -Slot
# Esempio: powershell -File routine-nudge.ps1 -Slot "london-open"

param(
    [Parameter(Mandatory=$true)][string]$Slot
)

. "$PSScriptRoot\routine-common.ps1"

# ===== Definizione messaggi per ogni slot =====
$messages = @{
    'pre-london'   = @{
        text = "<b>PRE LONDRA</b> - 30 min`n`nHai creato la scheda sessione Londra? Bias scritto? Alert TV impostati?"
        emoji = [char]::ConvertFromUtf32(0x23F3)  # hourglass
    }
    'london-open'  = @{
        text = "<b>LONDON OPEN</b>`n`nStop 11:00 - Max 3 trade`nStato emotivo OK prima di operare?"
        emoji = [char]::ConvertFromUtf32(0x1F7E2)  # green circle
    }
    'london-30'    = @{
        text = "30 min al <b>STOP LONDRA</b> (11:00). Se hai operato, compila trade (screenshot + strategia)."
        emoji = [char]::ConvertFromUtf32(0x23F0)  # alarm clock
    }
    'london-stop'  = @{
        text = "<b>STOP LONDRA</b>`n`nGestisci solo aperti. Nessun nuovo trade.`nCompila gli ultimi trade ora."
        emoji = [char]::ConvertFromUtf32(0x1F534)  # red circle
    }
    'pre-ny'       = @{
        text = "<b>PRE NY</b> - 60 min`n`nScheda sessione NY creata? Bias NY? Monitor pre-NY completato? Alert TV?"
        emoji = [char]::ConvertFromUtf32(0x23F3)
    }
    'ny-open'      = @{
        text = "<b>NY OPEN</b>`n`nStop 16:30 - Max 3 trade`nStato emotivo OK prima di operare?"
        emoji = [char]::ConvertFromUtf32(0x1F7E2)
    }
    'ny-30'        = @{
        text = "30 min al <b>STOP NY</b> (16:30). Compila i trade gia fatti (screenshot + strategia)."
        emoji = [char]::ConvertFromUtf32(0x23F0)
    }
    'ny-stop'      = @{
        text = "<b>STOP NY</b>`n`nGestisci solo aperti. Nessun nuovo trade.`nCompila gli ultimi trade ora."
        emoji = [char]::ConvertFromUtf32(0x1F534)
    }
    'hard-stop'    = @{
        text = "<b>HARD STOP 17:00</b>`n`nChiudi le carte. Nessuna occhiata al mercato.`n`n- Giornaliero completato?`n- Mindset registrato?`n- Note per domani scritte?`n- Venerdi: Weekly review!"
        emoji = [char]::ConvertFromUtf32(0x1F6D1)  # stop sign
    }
}

if (-not $messages.ContainsKey($Slot)) {
    Write-RoutineLog 'nudge' "Slot sconosciuto: $Slot"
    throw "Slot sconosciuto: $Slot (disponibili: $($messages.Keys -join ', '))"
}

$m = $messages[$Slot]
$fullText = "$($m.emoji) $($m.text)"

Write-RoutineLog $Slot "Invio nudge"

$tgResult = Send-Telegram -Text $fullText -ParseMode 'HTML'

if ($tgResult.Ok) {
    Write-RoutineLog $Slot "Telegram OK message_id=$($tgResult.MessageId)"
} else {
    Write-RoutineLog $Slot "Telegram KO: $($tgResult.Error)"
}

Write-RoutineEvent -Slot $Slot -Tipo 'nudge' -Payload @{ text = $m.text } `
    -TelegramSent $tgResult.Ok -TelegramMessageId ([long]($tgResult.MessageId | ForEach-Object { if ($_) { $_ } else { 0 } }))
