/**
 * Trade Desk App Logic - Header Dinamico Globale
 * Gestisce: Clock, Timeline, Win Rate, MonitoraSmile, TF badges, Navigation
 */

// ==========================================
// 1. INIT
// ==========================================
document.addEventListener('DOMContentLoaded', function() {
    // Clock & TF blink
    if (document.getElementById('digital-clock')) {
        setInterval(updateClock, 1000);
        updateClock();
    }

    // Timeline dinamica da localStorage
    updateTimeline();
    setInterval(updateTimeline, 10000); // aggiorna ogni 10s

    // Win Rate da Supabase
    updateHeaderWinRate();

    // MonitoraSmile da Supabase
    updateHeaderSmile();
    setInterval(updateHeaderSmile, 30000); // aggiorna ogni 30s

    // Navigation active state
    initNavActiveState();

    // Lucide icons
    if (typeof lucide !== 'undefined') lucide.createIcons();
});

// ==========================================
// 2. CLOCK & TF BLINK
// ==========================================
function updateClock() {
    const now = new Date();
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');

    const clockEl = document.getElementById('digital-clock');
    if (clockEl) clockEl.textContent = hours + ':' + minutes + ':' + seconds;

    const m = now.getMinutes();
    const s = now.getSeconds();

    const checkBlink = function(id, isClosing) {
        const el = document.getElementById(id);
        if (!el) return;
        if (isClosing) {
            el.classList.add('bg-tp-warning', 'text-[#0a0c10]', 'animate-pulse');
            el.classList.remove('bg-tp-panel', 'text-tp-muted');
        } else {
            el.classList.remove('bg-tp-warning', 'text-[#0a0c10]', 'animate-pulse');
            el.classList.add('bg-tp-panel', 'text-tp-muted');
        }
    };

    checkBlink('tf-5m', (m % 5 === 4) && s >= 50);
    checkBlink('tf-15m', (m % 15 === 14) && s >= 50);
    checkBlink('tf-30m', (m % 30 === 29) && s >= 50);
    checkBlink('tf-1h', (m === 59) && s >= 50);
    checkBlink('tf-4h', ((now.getHours() % 4 === 3) && m === 59 && s >= 50));
}

// ==========================================
// 3. TIMELINE DINAMICA (da localStorage)
// ==========================================
function updateTimeline() {
    const progress = document.getElementById('timeline-progress');
    const dot = document.getElementById('timeline-dot');
    if (!progress || !dot) return;

    // Leggi blocchi da localStorage (cache di Supabase)
    var blocksJson = localStorage.getItem('td_timeline_blocks');
    var blocks;
    if (blocksJson) {
        try { blocks = JSON.parse(blocksJson); } catch(e) { blocks = null; }
    }
    // Se il valore e wrappato in un oggetto (da settings.js), unwrap
    if (blocks && !Array.isArray(blocks)) blocks = null;
    if (!blocks || !blocks.length) {
        blocks = [
            { start: '00:00', end: '09:00', title: 'Asia' },
            { start: '09:00', end: '14:00', title: 'London' },
            { start: '14:00', end: '17:00', title: 'New York' },
            { start: '17:00', end: '23:59', title: 'End' }
        ];
    }

    // Ordina per start
    blocks.sort(function(a, b) { return a.start.localeCompare(b.start); });

    // Aggiorna labels della timeline — cerca il div con gli span label sopra la track bar
    var trackBar = document.getElementById('timeline-progress');
    if (!trackBar) return;
    var trackParent = trackBar.parentElement; // il div .relative che contiene la barra
    var timelineWrapper = trackParent ? trackParent.parentElement : null; // il wrapper flex-col
    var labelsContainer = null;
    if (timelineWrapper) {
        // Il primo child del wrapper che contiene span è il container dei label
        for (var ci = 0; ci < timelineWrapper.children.length; ci++) {
            var child = timelineWrapper.children[ci];
            if (child !== trackParent && child.querySelectorAll('span').length >= 2) {
                labelsContainer = child;
                break;
            }
        }
    }

    if (labelsContainer) {
        var labels = labelsContainer.querySelectorAll('span');
        // Se il numero di label non corrisponde ai blocchi, ricostruisci
        if (labels.length !== blocks.length) {
            labelsContainer.innerHTML = blocks.map(function(b) {
                return '<span class="text-tp-muted opacity-40">' + b.title + '</span>';
            }).join('');
            labels = labelsContainer.querySelectorAll('span');
        } else {
            for (var i = 0; i < labels.length && i < blocks.length; i++) {
                labels[i].textContent = blocks[i].title;
            }
        }
    }

    // Calcola posizione attuale nella giornata
    var now = new Date();
    var totalMinutes = now.getHours() * 60 + now.getMinutes();

    // Primo blocco start e ultimo blocco end
    var dayStart = timeToMinutes(blocks[0].start);
    var dayEnd = timeToMinutes(blocks[blocks.length - 1].end);
    if (dayEnd <= dayStart) dayEnd = 1440; // midnight

    var range = dayEnd - dayStart;
    if (range <= 0) range = 1440;

    var pct = ((totalMinutes - dayStart) / range) * 100;
    pct = Math.max(0, Math.min(100, pct));

    progress.style.width = pct + '%';
    dot.style.left = pct + '%';

    // Evidenzia il blocco corrente
    if (labelsContainer) {
        var labels = labelsContainer.querySelectorAll('span');
        for (var i = 0; i < blocks.length && i < labels.length; i++) {
            var bStart = timeToMinutes(blocks[i].start);
            var bEnd = timeToMinutes(blocks[i].end);
            if (totalMinutes >= bStart && totalMinutes < bEnd) {
                labels[i].classList.add('text-white');
                labels[i].classList.remove('text-tp-muted', 'opacity-30', 'opacity-60');
                labels[i].style.textShadow = '0 0 5px rgba(255,255,255,0.8)';
                labels[i].style.transform = 'scale(1.1)';
            } else {
                labels[i].classList.remove('text-white');
                labels[i].classList.add('text-tp-muted');
                labels[i].style.opacity = '0.4';
                labels[i].style.textShadow = 'none';
                labels[i].style.transform = 'scale(1)';
            }
        }
    }

    // Aggiorna markers
    var trackEl = progress.parentElement;
    if (trackEl) {
        // Rimuovi vecchi markers
        trackEl.querySelectorAll('.timeline-marker').forEach(function(m) { m.remove(); });
        // Aggiungi markers per ogni confine blocco (escluso primo e ultimo)
        for (var i = 1; i < blocks.length; i++) {
            var markerPct = ((timeToMinutes(blocks[i].start) - dayStart) / range) * 100;
            var marker = document.createElement('div');
            marker.className = 'timeline-marker absolute top-0 bottom-0 w-px bg-tp-border/50';
            marker.style.left = markerPct + '%';
            trackEl.appendChild(marker);
        }
    }
}

function timeToMinutes(timeStr) {
    var parts = timeStr.split(':');
    return parseInt(parts[0]) * 60 + parseInt(parts[1] || 0);
}

// ==========================================
// 4. WIN RATE HEADER (da Supabase)
// ==========================================
async function updateHeaderWinRate() {
    if (typeof db === 'undefined' || !db) return;
    try {
        var result = await db.from('trades').select('esito');
        var trades = result.data;
        if (!trades || !trades.length) return;

        // Conta solo trades con esito compilato
        var completed = trades.filter(function(t) { return t.esito === 'win' || t.esito === 'loss' || t.esito === 'breakeven'; });
        var total = completed.length;
        if (total === 0) return;
        var wins = completed.filter(function(t) { return t.esito === 'win'; }).length;
        var winrate = Math.round((wins / total) * 100);

        // Aggiorna tutti gli elementi winrate nell'header
        document.querySelectorAll('header .text-2xl, header .text-xl').forEach(function(el) {
            if (el.textContent.includes('%')) {
                el.textContent = winrate + '%';
            }
        });

        // Aggiorna il ring SVG
        document.querySelectorAll('header path[stroke-dasharray]').forEach(function(path) {
            path.setAttribute('stroke-dasharray', winrate + ', 100');
        });
    } catch(e) {
        console.warn('Win rate header:', e);
    }
}

// ==========================================
// 5. MONITORASMILE HEADER (da Supabase)
// ==========================================
// Scala: ultimi N input → calcola score
// score > 0 = verde, score == 0 = viola, score < 0 = rosso
async function updateHeaderSmile() {
    if (typeof db === 'undefined' || !db) return;
    try {
        var result = await db.from('monitora_smile').select('mindset, volatilita, created_at').order('created_at', { ascending: false }).limit(10);
        var records = result.data;
        if (!records || !records.length) return;

        // Calcola score mindset: positive=+1, neutral=0, negative=-1
        var mindsetScore = 0;
        var mindsetCount = 0;
        records.forEach(function(r) {
            if (r.mindset) {
                mindsetCount++;
                if (r.mindset === 'positive') mindsetScore += 1;
                else if (r.mindset === 'negative') mindsetScore -= 1;
            }
        });

        // Calcola score volatilita: high=+1, medium=0, low=-1
        var volScore = 0;
        var volCount = 0;
        records.forEach(function(r) {
            if (r.volatilita) {
                volCount++;
                if (r.volatilita === 'high') volScore += 1;
                else if (r.volatilita === 'low') volScore -= 1;
            }
        });

        // Colori: score > 0 = verde (#20c997), score == 0 = viola (#8b5cf6), score < 0 = rosso (#f43f5e)
        function scoreToColor(score) {
            if (score > 0) return '#20c997';
            if (score < 0) return '#f43f5e';
            return '#8b5cf6';
        }

        function scoreToIcon(score) {
            if (score > 0) return 'smile';
            if (score < 0) return 'frown';
            return 'meh';
        }

        // Mindset icon (primo)
        var mindsetEl = document.getElementById('mindset-icon-wrapper');
        if (mindsetEl) {
            var avgMindset = mindsetCount > 0 ? mindsetScore / mindsetCount : 0;
            var mColor = scoreToColor(avgMindset > 0.3 ? 1 : avgMindset < -0.3 ? -1 : 0);
            var mIcon = scoreToIcon(avgMindset > 0.3 ? 1 : avgMindset < -0.3 ? -1 : 0);
            mindsetEl.setAttribute('data-lucide', mIcon);
            mindsetEl.style.color = mColor;
            mindsetEl.style.filter = 'drop-shadow(0 0 8px ' + mColor + '80)';
        }

        // Market icon (secondo) — usa lo stesso score mindset per ora
        var marketEl = document.getElementById('market-icon-wrapper');
        if (marketEl) {
            var avgMindset = mindsetCount > 0 ? mindsetScore / mindsetCount : 0;
            var mColor = scoreToColor(avgMindset > 0.3 ? 1 : avgMindset < -0.3 ? -1 : 0);
            var mIcon = scoreToIcon(avgMindset > 0.3 ? 1 : avgMindset < -0.3 ? -1 : 0);
            marketEl.setAttribute('data-lucide', mIcon);
            marketEl.style.color = mColor;
            marketEl.style.filter = 'drop-shadow(0 0 8px ' + mColor + '80)';
        }

        // Volatilita icon (terzo) — dollar sign, colora per score vol
        var volEl = document.getElementById('volatility-icon-wrapper');
        if (volEl) {
            var avgVol = volCount > 0 ? volScore / volCount : 0;
            var vColor = scoreToColor(avgVol > 0.3 ? 1 : avgVol < -0.3 ? -1 : 0);
            volEl.style.color = vColor;
            volEl.style.filter = 'drop-shadow(0 0 12px ' + vColor + '80)';
        }

        // Refresh lucide icons
        if (typeof lucide !== 'undefined') lucide.createIcons();

    } catch(e) {
        console.warn('MonitoraSmile header:', e);
    }
}

// ==========================================
// 6. NAVIGATION ACTIVE STATE
// ==========================================
function initNavActiveState() {
    var path = window.location.pathname;
    var page = path.split('/').pop();
    if (page === '' || page === '/') page = 'index.html';

    // Aliases per sottopagine
    if (page === 'dettaglio_strategia.html') page = 'strategie.html';
    if (page === 'dettaglio_cronaca.html') page = 'cronache.html';
    if (page === 'dettaglio_giornata.html') page = 'giornaliero.html';
    if (page === 'dettaglio_settimana.html') page = 'settimanale.html';
    if (page === 'dettaglio_trade.html') page = 'tabella_trades.html';
    if (page === 'dettaglio_sessione.html') page = 'sessioni.html';
    if (page === 'dettaglio_bias.html') page = 'bias.html';
    if (page === 'dettaglio_allert.html') page = 'allert.html';

    var navLinks = document.querySelectorAll('nav a');
    navLinks.forEach(function(link) {
        var href = link.getAttribute('href');
        if (href === page) {
            link.classList.add('bg-[#161920]');
            var icon = link.querySelector('i');
            if (icon) {
                icon.classList.remove('text-tp-muted');
                icon.classList.add('text-tp-accent');
            }
            var span = link.querySelector('span');
            if (span) {
                span.classList.remove('text-tp-muted');
                span.classList.add('text-tp-text');
            }
        }
    });
}

// ==========================================
// 7. GLOBAL MODAL INTERACTIONS
// ==========================================
window.selectMindset = function(btn, type) {
    var container = btn.closest('.flex');
    if (!container) return;
    container.querySelectorAll('.mindset-btn').forEach(function(b) {
        b.classList.remove('text-tp-accent', 'text-tp-warning', 'text-tp-loss', 'bg-tp-border/30');
        b.classList.add('text-tp-muted');
    });
    btn.classList.remove('text-tp-muted');
    if (type === 'positive') btn.classList.add('text-tp-accent');
    if (type === 'neutral') btn.classList.add('text-tp-warning');
    if (type === 'negative') btn.classList.add('text-tp-loss');
};

window.selectVol = function(btn, type) {
    var container = btn.closest('.flex');
    if (!container) return;
    container.querySelectorAll('.vol-btn').forEach(function(b) {
        b.classList.remove('text-tp-accent', 'text-tp-warning', 'text-tp-loss', 'bg-tp-border/30');
        b.classList.add('text-tp-muted');
    });
    btn.classList.remove('text-tp-muted');
    if (type === 'low') btn.classList.add('text-tp-loss');
    if (type === 'med' || type === 'medium') btn.classList.add('text-tp-warning');
    if (type === 'high') btn.classList.add('text-tp-accent');
};
