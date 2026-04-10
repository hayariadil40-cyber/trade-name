const fs = require('fs');
const html = fs.readFileSync('index.html', 'utf8');

const divRegex = /<div[^>]*class="[^"]*(fixed|absolute)[^"]*inset-0[^"]*"[^>]*>/g;
let match;
console.log("--- Modals in index.html ---");
while ((match = divRegex.exec(html)) !== null) {
    let tag = match[0];
    let idMatch = tag.match(/id="([^"]+)"/);
    console.log(idMatch ? idMatch[1] : "No ID");
}

console.log("--- Checking keywords ---");
if(html.includes('Notizia')) console.log('Contains Notizia');
if(html.includes('Processi')) console.log('Contains Processi');
if(html.includes('Allert')) console.log('Contains Allert');
