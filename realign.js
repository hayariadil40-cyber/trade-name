const fs = require('fs');
let html = fs.readFileSync('dettaglio_sessione.html', 'utf8');

// Replace the grid with flex-row so they are side-by-side ALWAYS on desktop, and ensure they are same height
const regex = /<div class="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-4">/;
html = html.replace(regex, '<div class="flex flex-col lg:flex-row gap-6 mt-4 items-stretch">');

// Ensure Categorizzatore and MonitoraSmile are flex cols that stretch
html = html.replace('<!-- Destinazione Focus / Categorizzatore Esteso -->\n                    <div class="flex-1 bg-tp-bg border border-tp-border rounded-xl p-4">', '<!-- Destinazione Focus / Categorizzatore Esteso -->\n                    <div class="flex-[0.8] bg-tp-bg border border-tp-border rounded-xl p-4 flex flex-col justify-between">');
html = html.replace('<!-- Monitoraggio Comportamentale (Live) -->\n                    <div class="bg-tp-bg border border-tp-border rounded-xl p-4">', '<!-- Monitoraggio Comportamentale (Live) -->\n                    <div class="flex-[1.2] bg-tp-bg border border-tp-border rounded-xl p-4 flex flex-col justify-between">');

// Now, to make MonitoraSmile fit "in a single row" with Categorizzatore without looking terribly long, 
// let's put the Note (Textarea) side-by-side with the smilies!
// Find the inner flex container of MonitoraSmile:
const smileInner = `<div class="flex flex-col gap-4">
                            <div class="flex flex-wrap items-center gap-4">`;
                            
const newSmileInner = `<div class="flex flex-col xl:flex-row gap-4 h-full">
                            <div class="flex flex-col justify-center gap-4 xl:w-1/2">
                                <div class="flex flex-wrap items-center gap-4">`;

html = html.replace(smileInner, newSmileInner);

const smileTextArea = `</div>
                            <div class="flex flex-col gap-1.5 mt-2">
                                <span class="text-[9px] text-tp-muted font-bold uppercase tracking-widest">Note di Apertura / Riflessioni su come mi sento</span>
                                <textarea class="w-full bg-[#0a0c10] border border-tp-border rounded-lg p-3 text-xs text-tp-text/90 outline-none min-h-[90px] resize-none placeholder-tp-muted/50 focus:border-tp-accent transition-colors shadow-inner" placeholder="Digita qui pensieri prima di affrontare i mercati..."></textarea>
                            </div>
                        </div>`;
                        
const newSmileTextArea = `</div>
                            </div>
                            <div class="flex flex-col gap-1.5 xl:w-1/2 h-full">
                                <span class="text-[9px] text-tp-muted font-bold uppercase tracking-widest">Annotazione / Riflessioni Live</span>
                                <textarea class="w-full h-full bg-[#0a0c10] border border-tp-border rounded-lg p-3 text-xs text-tp-text/90 outline-none resize-none placeholder-tp-muted/50 focus:border-tp-accent transition-colors shadow-inner" placeholder="Pazienza pagata o saltata? Scrivi l'emotività qui..."></textarea>
                            </div>
                        </div>`;

html = html.replace(smileTextArea, newSmileTextArea);

fs.writeFileSync('dettaglio_sessione.html', html, 'utf8');
console.log('Fixed alignment and compactness.');
