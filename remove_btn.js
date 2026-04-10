const fs = require('fs');
let html = fs.readFileSync('dettaglio_sessione.html', 'utf8');

// The button has a lucide plus icon, "Asset", and "ml-auto" which pushes it to the right
html = html.replace(/<button[^>]*>.*?data-lucide=\"plus\".*?Asset.*?<\/button>/s, '');
fs.writeFileSync('dettaglio_sessione.html', html, 'utf8');
console.log('Button removed successfully.');
