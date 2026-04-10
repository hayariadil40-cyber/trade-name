const fs = require('fs');

const giornataHtml = fs.readFileSync('dettaglio_giornata.html', 'utf8');
const giornalieroHtml = fs.readFileSync('giornaliero.html', 'utf8');
let sessioneHtml = fs.readFileSync('dettaglio_sessione.html', 'utf8');

// 1. Extract Categorizzatore from dettaglio_giornata.html
// Looking for: <!-- Destinazione Focus / Categorizzatore Esteso -->
const startCat = giornataHtml.indexOf('<!-- Destinazione Focus / Categorizzatore Esteso -->');
// It ends before: <!-- Screenshot Input -->
const endCat = giornataHtml.indexOf('<!-- Screenshot Input -->');
let catBlock = giornataHtml.substring(startCat, endCat).trim();

// 2. Extract MonitoraSmile from giornaliero.html
// Looking for: <!-- Monitoraggio Comportamentale (Live) -->
const startSmile = giornalieroHtml.indexOf('<!-- Monitoraggio Comportamentale (Live) -->');
// It ends before: <!-- Modal Footer (Action Buttons) -->
const endSmile = giornalieroHtml.indexOf('<!-- Modal Footer (Action Buttons) -->');
let smileBlock = giornalieroHtml.substring(startSmile, endSmile).trim();

// Add grid columns classes so they fit side by side in dettaglio_sessione
catBlock = catBlock.replace('class="flex-1"', 'class="flex-1 bg-tp-bg border border-tp-border rounded-xl p-4"');

// 3. Replace the entire "BLOCCO INFERIORE" in dettaglio_sessione.html
const startTarget = sessioneHtml.indexOf('<!-- BLOCCO INFERIORE');
const endTarget = sessioneHtml.indexOf('</div>\n        </div>\n    </main>');

if (startTarget !== -1 && endTarget !== -1 && catBlock && smileBlock) {
    const newBottomBlock = `<!-- BLOCCO INFERIORE: Categorizzatore & MonitoraSmile -->
                <div class="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-4">
                    
                    ${catBlock}

                    ${smileBlock}

                `;
    
    const newSessioneHtml = sessioneHtml.substring(0, startTarget) + newBottomBlock + sessioneHtml.substring(endTarget);
    fs.writeFileSync('dettaglio_sessione.html', newSessioneHtml, 'utf8');
    console.log('Successfully updated dettaglio_sessione.html with standard modules.');
} else {
    console.log('Error locating blocks.');
    console.log({ startTarget, endTarget, hasCat: !!catBlock, hasSmile: !!smileBlock });
}
