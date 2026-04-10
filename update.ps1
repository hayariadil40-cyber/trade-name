$sidebar = Get-Content "sidebar_source.html" -Raw
foreach($f in Get-ChildItem -Filter *.html) {
  if($f.Name -eq "sidebar_source.html") { continue }
  $c = Get-Content $f.FullName -Raw
  $c = $c -replace '(?si)<aside.*?</aside>', $sidebar
  Set-Content $f.FullName $c -Encoding UTF8
}
