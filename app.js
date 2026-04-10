/**
 * Trade Desk App Logic
 * Architettura Vanilla in stile "componentizzato", facile da re-implementare in React/Cursor.
 */

document.addEventListener('DOMContentLoaded', function() {
    initCharts();
    initKanbanCounters();
    initNomiDiAllah();
});

// ==========================================
// 1. Chart.js Implementations
// ==========================================
function initCharts() {
    // ---- A. Win Rate Gauge Chart (Semicerchio in alto a destra) ----
    const gaugeCtx = document.getElementById('gaugeChart');
    if (gaugeCtx) {
        new Chart(gaugeCtx.getContext('2d'), {
            type: 'doughnut',
            data: {
                labels: ['Vince', 'Perde'],
                datasets: [{
                    data: [67, 33],
                    backgroundColor: [
                        '#20c997', // tp-accent
                        '#252932'  // tp-border
                    ],
                    borderWidth: 0,
                    circumference: 180, // Semicerchio esatto
                    rotation: 270,      // Ruota l'angolo d'inizio
                    cutout: '80%'       // Spessore barra
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: { enabled: false }
                },
                animation: {
                    animateScale: true,
                    animateRotate: true
                }
            }
        });
    }

    // ---- B. Paniere USD Line Chart (Colonna Sinistra) ----
    const paniereCtx = document.getElementById('paniereChart');
    if (paniereCtx) {
        Chart.defaults.color = '#848d97';
        Chart.defaults.font.family = 'Inter';
        
        new Chart(paniereCtx.getContext('2d'), {
            type: 'line',
            data: {
                labels: ['06:00', '08:00', '10:00', '12:00', '14:00', '16:00', 'Now'],
                datasets: [{
                    label: 'Forza USD (%)',
                    // Simulate percentage strength: 0 = neutral, positive = strong USD, negative = weak USD
                    data: [-0.4, 0.1, -0.6, 0.8, 1.4, 1.8, 2.1],
                    borderColor: '#f8fafc', // colore linea contrastante (bianco spento)
                    borderWidth: 2,
                    tension: 0.1, // Linee rigide in stile disegno a mano o leggermente smussate
                    pointRadius: 0,
                    pointHoverRadius: 4,
                    pointBackgroundColor: '#f8fafc',
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        backgroundColor: '#161920',
                        titleColor: '#f8fafc',
                        bodyColor: '#f8fafc',
                        borderColor: '#252932',
                        borderWidth: 1,
                        displayColors: false,
                    }
                },
                scales: {
                    x: {
                        display: true,
                        grid: { display: false, drawBorder: false },
                        ticks: { font: { size: 9 }, color: '#848d97' }
                    },
                    y: {
                        display: true,
                        position: 'right',
                        grid: {
                            color: 'rgba(255,255,255,0.05)',
                            drawBorder: false
                        },
                        ticks: { 
                            font: { size: 9 }, 
                            color: '#848d97',
                            callback: function(value) { return value > 0 ? '+' + value + '%' : value + '%'; }
                        }
                    }
                },
                interaction: {
                    mode: 'index',
                    intersect: false,
                },
            }
        });
    }

    // Inizializza Analisi Charts se la UI esiste
    if (document.getElementById('equityChart')) {
        initAnalisiCharts();
    }
}

// Logic to Record USD Strength Snapshot
window.recordDollarStrength = function() {
    const logLists = document.querySelectorAll('.dollar-strength-log');
    if(logLists.length === 0) return;
    
    // Fake current value calculation context
    const currentVal = "+2.1%"; 
    const now = new Date();
    const timeStr = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
    
    const entryHtml = `
        <li class="flex items-center justify-between text-xs p-2 bg-[#0a0c10] border border-tp-border rounded-lg mb-2">
            <div class="flex items-center gap-2">
                <i data-lucide="clock" class="w-3.5 h-3.5 text-tp-muted"></i>
                <span class="font-bold text-tp-text">${timeStr}</span>
            </div>
            <span class="font-bold text-tp-accent bg-tp-accent/10 px-2 py-0.5 rounded border border-tp-accent/20">${currentVal}</span>
        </li>
    `;
    
    logLists.forEach(list => {
        list.insertAdjacentHTML('afterbegin', entryHtml);
        lucide.createIcons({ root: list });
    });
    
    // Optional feedback feeling
    console.log("Snapshot Forza Dollaro registrato a", timeStr);
}

// ==========================================
// 2. Kanban Drag & Drop Logic (Vanilla HTML5)
// ==========================================
// Questa logica serve per poter prendere i task dalla colonna e rilasciarli in un'altra.

let draggedItem = null;

// Chiamata quando inizio a trascinare una card
window.drag = function(ev) {
    draggedItem = ev.target;
    ev.dataTransfer.setData("text", ev.target.id);
    ev.target.style.opacity = '0.4'; // Visual feedback
}

// Chiamata quando l'elemento viene trascinato sopra una zona valida (le colonne)
window.allowDrop = function(ev) {
    ev.preventDefault();
    // Aggiunge classe hover (bordo) se ev.currentTarget è una kanban-column
    const col = ev.currentTarget;
    if (col && col.classList.contains('kanban-column')) {
        col.classList.add('drag-over');
    }
}

// Rimuove visual feedback quando esco dalla colonna
document.querySelectorAll('.kanban-column').forEach(col => {
    col.addEventListener('dragleave', (ev) => {
        ev.currentTarget.classList.remove('drag-over');
    });
});

// Chiamata quando l'elemento viene "rilasciato" nella colonna
window.drop = function(ev) {
    ev.preventDefault();
    const column = ev.currentTarget;
    
    // Rimuove lo stato visivo di hover
    column.classList.remove('drag-over');
    
    // Ripristino l'opacità
    if (draggedItem) {
        draggedItem.style.opacity = '1';
    }

    if (!draggedItem) return;

    // Trovo il contenitore (div interno della colonna che regge le card)
    const container = column.querySelector('.kanban-container');
    if (container) {
        container.appendChild(draggedItem);
        
        // --- Opzionale: Update logico dei dati ---
        const newStatus = column.getAttribute('data-status'); // 'todo', 'progress', 'done'
        
        // Se è done, aggiungo stili di barra testuale ecc
        const pTag = draggedItem.querySelector('p');
        const badge = draggedItem.querySelector('.text-tp-muted');
        
        if (newStatus === 'done') {
            if(pTag) pTag.classList.add('line-through');
            draggedItem.classList.add('opacity-60');
            if(badge) badge.innerHTML = '<span class="text-tp-accent text-xs">Done</span>';
        } else {
            if(pTag) pTag.classList.remove('line-through');
            draggedItem.classList.remove('opacity-60');
            if(badge) badge.innerHTML = '<span>#TX</span><i data-lucide="align-left" class="w-3 h-3"></i>';
            // Reinizializzo l'eventuale icona inserita via string
            lucide.createIcons({ root: badge }); 
        }

        // Aggiorno i contatori numerici sopra le colonne
        initKanbanCounters();
    }
    
    draggedItem = null;
}

// Funzione helper per contare e aggiornare i badge numerici delle tre colonne
function initKanbanCounters() {
    document.querySelectorAll('.kanban-column').forEach(col => {
        const cardsCount = col.querySelectorAll('.kanban-card').length;
        const badge = col.querySelector('.count-badge');
        if (badge) {
            badge.innerText = cardsCount;
        }
    });
}

// ==========================================
// 3. Status Indicators & Tag System Logic
// ==========================================
// PREDISPOSIZIONE PER CURSOR: Sistema logico di valutazione Tag

const TAG_CONFIG = {
    mindset: { positive: ['focussed', 'calm', 'disciplined'], negative: ['revenge-trading', 'tired', 'fomo'] },
    market: { positive: ['trend-clear', 'support-held'], negative: ['chop', 'unpredictable'] },
    volatility: { high: ['news', 'cpi', 'high-vol'], low: ['ranging', 'consolidation', 'low-vol'] }
};

// Quando l'utente nel db back-end aggiorna i tag, Cursor dovrà invocare questa funzione:
window.parseDayTagsAndUpdateUI = function(activeTags) {
    let mindsetScore = 0;
    let marketScore = 0;
    let isHighVol = false;

    activeTags.forEach(tag => {
        if (TAG_CONFIG.mindset.positive.includes(tag)) mindsetScore++;
        if (TAG_CONFIG.mindset.negative.includes(tag)) mindsetScore--;
        if (TAG_CONFIG.market.positive.includes(tag)) marketScore++;
        if (TAG_CONFIG.market.negative.includes(tag)) marketScore--;
        if (TAG_CONFIG.volatility.high.includes(tag)) isHighVol = true;
    });

    updateMindsetIcon(mindsetScore);
    updateMarketIcon(marketScore);
    updateVolatilityIcon(isHighVol);
}

// Aggiorna faccia 1 (Personale)
function updateMindsetIcon(score) {
    const wrapper = document.getElementById('mindset-icon-wrapper');
    if(!wrapper) return;
    
    let iconName = 'meh';
    let colorClass = 'tp-warning'; // giallo

    if(score > 0) { iconName = 'smile'; colorClass = 'tp-accent'; }        // verde
    else if(score < 0) { iconName = 'frown'; colorClass = 'tp-loss'; }     // rosso
    
    wrapper.innerHTML = `<i data-lucide="${iconName}" class="w-7 h-7 text-${colorClass} transition-all duration-300 transform scale-110"></i>`;
    lucide.createIcons({ root: wrapper });
}

// Aggiorna faccia 2 (Contesto mercato)
function updateMarketIcon(score) {
    const wrapper = document.getElementById('market-icon-wrapper');
    if(!wrapper) return;
    
    let iconName = 'meh';
    let colorClass = 'tp-warning'; 

    if(score > 0) { iconName = 'smile'; colorClass = 'tp-accent'; }
    else if(score < 0) { iconName = 'frown'; colorClass = 'tp-loss'; }
    
    wrapper.innerHTML = `<i data-lucide="${iconName}" class="w-7 h-7 text-${colorClass} transition-all duration-300 transform scale-110"></i>`;
    lucide.createIcons({ root: wrapper });
}

// Aggiorna Simbolo Dollaro (Volatilità)
function updateVolatilityIcon(isHigh) {
    const wrapper = document.getElementById('volatility-icon-wrapper');
    if(!wrapper) return;
    
    if(isHigh) {
        wrapper.innerHTML = `<i data-lucide="dollar-sign" class="w-7 h-7 text-tp-loss drop-shadow-[0_0_10px_rgba(244,63,94,0.8)] transition-all duration-300 transform scale-110"></i>`;
    } else {
        wrapper.innerHTML = `<i data-lucide="dollar-sign" class="w-7 h-7 text-tp-accent drop-shadow-[0_0_8px_rgba(32,201,151,0.6)] transition-all duration-300"></i>`;
    }
    lucide.createIcons({ root: wrapper });
    
    // reset animazione scalamento dopo pochi ms (effetto "pop")
    setTimeout(() => {
        const icon = wrapper.querySelector('svg');
        if(icon) icon.classList.remove('scale-110');
    }, 200);
}

// Ciclo dimostrativo attivato dal pulsantino in UI
let demoState = 0;
window.demoTagUpdate = function() {
    demoState = (demoState + 1) % 4;
    let mockTags = [];
    
    if (demoState === 1) {
        // Pessima giornata, volatilità altissima
        mockTags = ['tired', 'chop', 'news']; 
    } else if (demoState === 2) {
        // Giornata Ok ma neutra
        mockTags = ['calm', 'chop', 'low-vol']; 
    } else if (demoState === 3) {
        // Giornata Perfetta
        mockTags = ['focussed', 'trend-clear', 'low-vol']; 
    } else {
        // Ritorno default
        mockTags = ['calm', 'trend-clear', 'low-vol'];
    }
    
    console.log("Simulazione Tag in corso:", mockTags);
    parseDayTagsAndUpdateUI(mockTags);
}

// ==========================================
// 4. Analisi Hub Chart.js Implementations
// ==========================================
function initAnalisiCharts() {
    // -- A. Equity Curve (Main Banner) --
    const equityCtx = document.getElementById('equityChart');
    if (equityCtx) {
        const labels = Array.from({length: 50}, (_, i) => i + 1);
        let balance = 100000;
        const dataPoints = labels.map(() => {
            balance += (Math.random() * 1500) - 500;
            return balance;
        });

        new Chart(equityCtx.getContext('2d'), {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Account Balance ($)',
                    data: dataPoints,
                    borderColor: '#20c997',
                    backgroundColor: 'rgba(32, 201, 151, 0.1)',
                    borderWidth: 2,
                    fill: true,
                    tension: 0.4,
                    pointRadius: 0,
                    pointHoverRadius: 6,
                    pointBackgroundColor: '#20c997'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        backgroundColor: '#161920',
                        titleColor: '#f8fafc',
                        bodyColor: '#f8fafc',
                        borderColor: '#252932',
                        borderWidth: 1,
                        displayColors: false
                    }
                },
                scales: {
                    x: { grid: { display: false, drawBorder: false }, ticks: { display: false } },
                    y: { position: 'right', grid: { color: 'rgba(255,255,255,0.05)', drawBorder: false }, ticks: { color: '#848d97'} }
                },
                interaction: { mode: 'index', intersect: false }
            }
        });
    }

    // -- B. Winrate Pie Chart --
    const winrateCtx = document.getElementById('winratePieChart');
    if (winrateCtx) {
        new Chart(winrateCtx.getContext('2d'), {
            type: 'doughnut',
            data: {
                labels: ['XAUUSD', 'US30', 'EURUSD'],
                datasets: [{
                    data: [5500, 3200, 1100],
                    backgroundColor: ['#20c997', '#eab308', '#f43f5e'],
                    borderWidth: 0,
                    hoverOffset: 10
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                cutout: '75%',
                plugins: {
                    legend: {
                        position: 'right',
                        labels: { color: '#f8fafc', usePointStyle: true, padding: 20 }
                    }
                }
            }
        });
    }

    // -- C. Push Moments (Bar Chart) --
    const pushMomentsCtx = document.getElementById('pushMomentsChart');
    if (pushMomentsCtx) {
        new Chart(pushMomentsCtx.getContext('2d'), {
            type: 'bar',
            data: {
                labels: ['London Open', 'London Lunch', 'NY Open', 'NY PM', 'Asia'],
                datasets: [{
                    label: 'Net PnL ($)',
                    data: [4200, -800, 6500, 1200, -300],
                    backgroundColor: function(context) {
                        if (context.dataset && context.dataset.data) {
                            const val = context.dataset.data[context.dataIndex];
                            return val > 0 ? 'rgba(32, 201, 151, 0.8)' : 'rgba(244, 63, 94, 0.8)';
                        }
                        return 'rgba(32, 201, 151, 0.8)';
                    },
                    borderRadius: 4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    x: { grid: { display: false, drawBorder: false }, ticks: { color: '#848d97'} },
                    y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#848d97'} }
                }
            }
        });
    }
}

// ==========================================
// 5. Global Header Clock & Timeline Logic
// ==========================================
function updateClock() {
    const now = new Date();
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    
    const clockEl = document.getElementById('digital-clock');
    if(clockEl) clockEl.textContent = `${hours}:${minutes}:${seconds}`;

    const m = now.getMinutes();
    const s = now.getSeconds();
    
    // helper per far lampeggiare di giallo un elemento
    const checkBlink = (id, isClosing) => {
        const el = document.getElementById(id);
        if(!el) return;
        if(isClosing) {
            el.classList.add('bg-tp-warning', 'text-[#0a0c10]', 'animate-pulse');
            el.classList.remove('bg-tp-panel', 'text-tp-muted');
        } else {
            el.classList.remove('bg-tp-warning', 'text-[#0a0c10]', 'animate-pulse');
            el.classList.add('bg-tp-panel', 'text-tp-muted');
        }
    };

    // Lampeggiano negli ultimi 10 secondi della loro chiusura matematica:
    checkBlink('tf-5m', (m % 5 === 4) && s >= 50);
    checkBlink('tf-15m', (m % 15 === 14) && s >= 50);
    checkBlink('tf-30m', (m % 30 === 29) && s >= 50);
    checkBlink('tf-1h', (m === 59) && s >= 50);
    checkBlink('tf-4h', ((now.getHours() % 4 === 3) && m === 59 && s >= 50));
}

// Avvia l'orologio globale se l'elemento esiste
document.addEventListener('DOMContentLoaded', () => {
    if (document.getElementById('digital-clock')) {
        setInterval(updateClock, 1000);
        updateClock();
        
        // Setup initial timeline demo
        const progress = document.getElementById('timeline-progress');
        const dot = document.getElementById('timeline-dot');
        if(progress && dot) {
            progress.style.width = '45%';
            dot.style.left = '45%';
        }
    }
});

// ==========================================
// 6. Navigation Active State Logic
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    let path = window.location.pathname;
    let page = path.split("/").pop();
    if (page === "" || page === "/") page = "index.html";
    
    // Setup aliases per le sottopagine
    if (page === "dettaglio_strategia.html") page = "strategie.html";
    if (page === "dettaglio_cronaca.html") page = "cronache.html";
    if (page === "dettaglio_giornata.html") page = "giornaliero.html";
    if (page === "dettaglio_settimana.html") page = "settimanale.html";
    if (page === "dettaglio_trade.html") page = "tabella_trades.html";
    
    const navLinks = document.querySelectorAll('nav a');
    navLinks.forEach(link => {
        const href = link.getAttribute('href');
        if (href === page || (page === "sessioni.html" && href === "sessioni.html")) {
            // Apply active styles
            link.classList.remove('text-[#848d97]', 'hover:bg-[#161920]', 'hover:text-white');
            link.classList.add('text-tp-accent', 'bg-tp-accent/10', 'border', 'border-tp-accent/20', 'hover:bg-tp-accent/20');
            
            const icon = link.querySelector('i');
            if (icon) {
                icon.classList.remove('text-tp-muted', 'hover:text-white');
                icon.classList.add('text-tp-accent');
            }
            
            const span = link.querySelector('span');
            if (span) {
                span.classList.remove('text-tp-muted', 'hover:text-white');
                span.classList.add('text-tp-text');
            }
        }
    });
});

// ==========================================
// 7. Global Modal Interactions (Mindset & Volatilità)
// ==========================================
window.selectMindset = function(btn, type) {
    const container = btn.closest('.flex'); 
    if(!container) return;
    
    container.querySelectorAll('.mindset-btn').forEach(b => {
        b.classList.remove('text-tp-accent', 'text-tp-warning', 'text-tp-loss', 'bg-tp-border/30');
        b.classList.add('text-tp-muted');
    });
    btn.classList.remove('text-tp-muted');
    btn.classList.add('bg-tp-border/30');
    if(type === 'positive') btn.classList.add('text-tp-accent');
    if(type === 'neutral') btn.classList.add('text-tp-warning');
    if(type === 'negative') btn.classList.add('text-tp-loss');
};

window.selectVol = function(btn, type) {
    const container = btn.closest('.flex'); 
    if(!container) return;
    
    container.querySelectorAll('.vol-btn').forEach(b => {
        b.classList.remove('text-tp-accent', 'text-tp-warning', 'text-tp-loss', 'bg-tp-border/30');
        b.classList.add('text-tp-muted');
    });
    btn.classList.remove('text-tp-muted');
    btn.classList.add('bg-tp-border/30');
    if(type === 'low') btn.classList.add('text-tp-accent');
    if(type === 'med') btn.classList.add('text-tp-warning');
    if(type === 'high') btn.classList.add('text-tp-loss');
};

// ==========================================
// 8. Relazionatore Universale & Data Propagation
// ==========================================
/**
 * Simula la propagazione dei dati verso l'archivio Sessioni
 * Nel mondo reale questa funzione invierebbe i dati ad un Database via API o Supabase.
 */
window.propagateSessionData = function() {
    console.log("Inizializzazione Propagazione Dati...");
    
    // Mostra un feedback visivo (simuliamo salvataggio)
    const btn = event.currentTarget;
    const originalText = btn.innerHTML;
    btn.innerHTML = '<i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i> Collegamento Inviato...';
    lucide.createIcons({ root: btn });
    
    setTimeout(() => {
        btn.innerHTML = '<i data-lucide="check" class="w-4 h-4"></i> Dati Relazionati!';
        lucide.createIcons({ root: btn });
        
        // Chiude la modale dopo un secondo
        setTimeout(() => {
            const modal = document.getElementById('modal-analisi-sessione');
            if(modal) modal.classList.remove('open');
            btn.innerHTML = originalText;
            lucide.createIcons({ root: btn });
            
            // Reindirizza opzionalmente alla pagina sessioni per vedere il risultato
            // window.location.href = 'sessioni.html';
        }, 1200);
    }, 1500);
}

// ==========================================
// 9. Database dei Nomi di Allah & Rotazione Giornaliera
// ==========================================
const ALLAH_NAMES = [
    { trans: "Ar-Rahman", arab: "الرَّحْمَنُ", meaning: "Il Compassionevole", desc: "Lascia che la compassione guidi oggi le tue azioni sul mercato, evitando avidità e FOMO." },
    { trans: "Ar-Rahim", arab: "الرَّحِيمُ", meaning: "Il Misericordioso", desc: "Colui che elargisce misericordia costante. Sii indulgente con te stesso anche quando un trade va male." },
    { trans: "Al-Malik", arab: "الْمَلِكُ", meaning: "Il Sovrano", desc: "L'Assoluto detentore del potere. Ricorda che non puoi controllare il mercato, ma puoi dominare le tue reazioni." },
    { trans: "Al-Quddus", arab: "الْقُدُّوسُ", meaning: "Il Puro", desc: "Mantieni le tue intenzioni e il tuo piano di trading liberi da distrazioni e pensieri negativi." },
    { trans: "As-Salam", arab: "السَّلاَمُ", meaning: "La Pace", desc: "Ricerca la pace interiore mentre tradi. Se provi ansia, allontanati dallo schermo." },
    { trans: "Al-Mu'min", arab: "الْمُؤْمِنُ", meaning: "Il Fedele", desc: "Abbi fiducia nel processo e nella tua strategia. La disciplina nel lungo termine ripaga." },
    { trans: "Al-Muhaymin", arab: "الْمُهَيْمِنُ", meaning: "Il Custode", desc: "Proteggi il tuo capitale come la cosa più sacra del tuo arsenale. Usa sempre lo stop loss." },
    { trans: "Al-Aziz", arab: "الْعَزِيزُ", meaning: "L'Eccelso", desc: "Il mercato è imponente, ma tu mantieni dignità e forza mentale di fronte a ogni reiezione." },
    { trans: "Al-Jabbar", arab: "الْجَبَّارُ", meaning: "Il Riparatore", desc: "Ogni loss è un'opportunità logica per correggere e tornare operativamente più forti." },
    { trans: "Al-Mutakabbir", arab: "الْمُتَكَبِّرُ", meaning: "Il Supremo", desc: "Evita l'arroganza dopo una winning streak. L'umiltà ti protegge dalla rovina improvvisa." },
    { trans: "Al-Khaliq", arab: "الْخَالِقُ", meaning: "Il Creatore", desc: "Crea opportunità aspettando che il setup perfetto si manifesti con estrema chiarezza." },
    { trans: "Al-Bari", arab: "الْبَارِئُ", meaning: "L'Evolutore", desc: "Evolvi costantemente. Il mercato muta ogni anno, e il tuo vantaggio matematico deve adattarsi con esso." },
    { trans: "Al-Musawwir", arab: "الْمُصَوِّرُ", meaning: "Il Modellatore", desc: "Visualizza la tua esecuzione perfetta (Playbook) prima di cliccare il tasto Buy o Sell sulla piattaforma." },
    { trans: "Al-Ghaffar", arab: "الْغَفَّارُ", meaning: "Il Perdonatore", desc: "Perdonati per l'errore operativo di ieri. Oggi è un nuovo giorno con zero PnL emotivo." },
    { trans: "Al-Qahhar", arab: "الْقَهَّارُ", meaning: "Il Dominatore", desc: "Domina impulsività e debolezza psicologica prima che queste distruggano il tuo conto." },
    { trans: "Al-Wahhab", arab: "الْوَهَّابُ", meaning: "Il Donatore", desc: "Accetta profitti inaspettati come veri doni statistici del mercato, non come tue infallibili profezie." },
    { trans: "Ar-Razzaq", arab: "الرَّزَّاقُ", meaning: "Il Provveditore", desc: "Le occasioni sui grafici scorrono costanti e infinite. Non forzare ingressi in mercati ostili." },
    { trans: "Al-Fattah", arab: "الْفَتَّاحُ", meaning: "Colui che apre", desc: "Rimani a mente aperta ad interpretare la reale Price Action, osservandola oggettivamente, non quello che speri accada." },
    { trans: "Al-Alim", arab: "اَلْعَلِيْمُ", meaning: "L'Onnisciente", desc: "Studia profondamente i tuoi dati tramite l'Analisi Avanzata, perché ti avvicineranno all'Eccellenza Operativa reale." },
    { trans: "Al-Qabid", arab: "الْقَابِضُ", meaning: "Colui che trattiene", desc: "Trattieni l'avidità oggi. Focalizzati sulla protezione cieca del portafoglio." },
    { trans: "Al-Basit", arab: "الْبَاسِطُ", meaning: "Colui che espande", desc: "Lascia correre i winning trades. Quando il setup esplode in tuo favore, abbi la pazienza pura di espanderlo senza ansia da incasso prematuro." },
    { trans: "Al-Khafid", arab: "الْخَافِضُ", meaning: "Colui che abbassa", desc: "Abbassa il tuo rischio (es. mezza size) se ti trovi in preda alla losing streak, riporterai l'equilibrio." },
    { trans: "Ar-Rafi", arab: "الرَّافِعُ", meaning: "Colui che innalza", desc: "Innalza prepotentemente i tuoi standard di trading. Non scendere mai a compromessi per la noia sull'attesa dell'ingresso perfetto." },
    { trans: "Al-Mu'izz", arab: "الْمُعِزُّ", meaning: "Il Datore di Onore", desc: "L'onore del buon trader è fare il suo dovere ed eseguire il modello di trading senza interferenza psicologica." } // Limitato a 24 Nomi di Allah a scopi dimostrativi, gli altri 75 possono essere aggiunti a quest'array nativo
];

function initNomiDiAllah() {
    const titleEl = document.getElementById('allah-title');
    if (!titleEl) return; // Non siamo nella dashboard
    
    // Trova il giorno dell'anno corrente (1-365) per rotare consistentemente ogni giorno
    const now = new Date();
    const start = new Date(now.getFullYear(), 0, 0);
    const diff = (now - start) + ((start.getTimezoneOffset() - now.getTimezoneOffset()) * 60 * 1000);
    const oneDay = 1000 * 60 * 60 * 24;
    const dayOfYear = Math.floor(diff / oneDay);
    
    // Ruota i nomi in loop
    const nameIndex = dayOfYear % ALLAH_NAMES.length;
    const targetName = ALLAH_NAMES[nameIndex];
    
    const indexEl = document.getElementById('allah-index');
    if (indexEl) indexEl.textContent = 'Nome Del Giorno (' + (nameIndex + 1) + '/' + ALLAH_NAMES.length + ')';
    
    const bgEl = document.getElementById('allah-bg-text');
    if (bgEl) bgEl.textContent = targetName.arab;
    
    titleEl.textContent = targetName.trans;
    
    const transEl = document.getElementById('allah-translation');
    if (transEl) transEl.textContent = targetName.meaning;
    
    const descEl = document.getElementById('allah-desc');
    if (descEl) descEl.textContent = targetName.desc;
}
