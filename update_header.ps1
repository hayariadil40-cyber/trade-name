$template = Get-Content "header_source.html" -Raw

foreach($file in Get-ChildItem -Filter *.html) {
    if($file.Name -in "sidebar_source.html", "header_source.html") { continue }
    
    $content = Get-Content $file.FullName -Raw
    
    # 1. Search for existing header
    if ($content -match '(?si)<header.*?</header>') {
        
        # 2. Extract existing title
        $title = "Trade Desk"
        if ($content -match '(?si)<header[^>]*>.*?<h1[^>]*>(.*?)</h1>') {
            $title = $matches[1] -replace '<[^>]+>', ''
            $title = $title.Trim()
        } elseif ($content -match '(?si)<h1[^>]*>(.*?)</h1>') {
            # Se non trova l'H1 nell'header, lo cerca ovunque ma potrebbe essere rischioso. 
            # In questo caso previene errore.
            $title = $matches[1] -replace '<[^>]+>', ''
            $title = $title.Trim()
        }
        
        # 3. Replace template placeholder with extracted title
        $newHeader = $template -replace '\{TITLE\}', $title
        
        # 4. Replace in file
        $content = $content -replace '(?si)<header.*?</header>', $newHeader
        
        Set-Content $file.FullName $content -Encoding UTF8
        Write-Host "Aggiornato $($file.Name) (Titolo: $title)"
    } else {
        Write-Host "Nessun header trovato in $($file.Name). Ignorato."
    }
}
