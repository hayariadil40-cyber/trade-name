const fs = require('fs');
const files = fs.readdirSync('.');

for(let f of files) {
    if(f.endsWith('.html') || f === 'app.js' || f === 'update_sidebar.js') {
        let text = fs.readFileSync(f, 'utf8');
        
        let changed = false;
        
        if (text.includes('Grafici Area</span>')) {
            text = text.replace(/Grafici Area<\/span>/g, 'Analisi</span>');
            changed = true;
        }
        if (text.includes('>Grafici Area<')) {
            text = text.replace(/>Grafici Area</g, '>Analisi<');
            changed = true;
        }
        
        if (changed) {
            fs.writeFileSync(f, text, 'utf8');
            console.log('Sidebar updated in ' + f);
        }
    }
}

let analisi = fs.readFileSync('analisi.html', 'utf8');
let aChanged = false;

if (analisi.includes('War Room Analitica')) {
    analisi = analisi.replace('War Room Analitica', 'Analisi');
    aChanged = true;
}

const filterAnchor = `                        <a href="tabella_trades.html" class="flex items-center gap-1.5 text-[10px] font-bold px-2 py-1 rounded bg-tp-bg text-tp-muted border border-tp-border hover:bg-tp-border hover:text-white transition-colors"><i data-lucide="crosshair" class="w-3.5 h-3.5"></i> Tabella Trades</a>
                        <a href="giornaliero.html" class="flex items-center gap-1.5 text-[10px] font-bold px-2 py-1 rounded bg-tp-bg text-tp-muted border border-tp-border hover:bg-tp-border hover:text-white transition-colors"><i data-lucide="calendar" class="w-3.5 h-3.5"></i> Giornaliero</a>
                    </div>
                </div>
            </div>`;

if (analisi.includes(filterAnchor) && !analisi.includes('Tutto</button>')) {
    const newUI = filterAnchor + `
            <div class="flex gap-2.5 ml-8">
                <div class="flex items-center gap-2 bg-[#0a0c10] border border-tp-border p-1 rounded-xl">
                    <button class="filter-btn active px-4 py-1.5 rounded-lg text-xs font-bold uppercase transition-all tracking-wider border border-transparent bg-[#161920] text-white">Tutto</button>
                    <button class="filter-btn px-4 py-1.5 rounded-lg text-xs font-bold uppercase transition-all tracking-wider border border-transparent text-tp-muted hover:text-white">MT4</button>
                    <button class="filter-btn px-4 py-1.5 rounded-lg text-xs font-bold uppercase transition-all tracking-wider border border-transparent text-tp-muted hover:text-white">Bybit</button>
                </div>
            </div>`;
    analisi = analisi.replace(filterAnchor, newUI);
    aChanged = true;
    console.log('Filter UI added.');
}

if (aChanged) {
    fs.writeFileSync('analisi.html', analisi, 'utf8');
}
