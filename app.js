/**
 * Trade Desk App Logic - Header Dinamico Globale
 * Gestisce: Clock, Timeline, Win Rate, MonitoraSmile, TF badges, Navigation
 */

// ==========================================
// 1. INIT
// ==========================================
document.addEventListener('DOMContentLoaded', function() {
    // Abilita correttore ortografico italiano su tutti i campi di testo
    document.querySelectorAll('input[type="text"], textarea').forEach(function(el) {
        el.setAttribute('spellcheck', 'true');
        el.setAttribute('lang', 'it');
    });

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

    // Auto-refresh se la tab era in background da più di 5 minuti
    let _tdLastVisible = Date.now();
    document.addEventListener('visibilitychange', function() {
        if (document.visibilityState === 'visible') {
            if (Date.now() - _tdLastVisible > 5 * 60 * 1000) location.reload();
        } else {
            _tdLastVisible = Date.now();
        }
    });
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
    // Broker 4H chiude 01/05/09/13/17/21 broker = 23/03/07/11/15/19 Casa (broker-2h): blink nell'ora precedente
    checkBlink('tf-4h', ((now.getHours() % 4 === 2) && m === 59 && s >= 50));
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

    // Render labels: layout flex originale (justify-between), solo l'attivo evidenziato con accent + glow + scale
    if (labelsContainer) {
        // Reset eventuali stili lasciati dalla versione precedente con position absolute
        labelsContainer.style.position = '';
        labelsContainer.style.display = '';
        labelsContainer.style.minHeight = '';

        var labels = labelsContainer.querySelectorAll('span');
        // Rebuild se conta diversa o se gli span avevano la vecchia classe timeline-label (cambio layout)
        var needsRebuild = labels.length !== blocks.length || (labels[0] && labels[0].classList.contains('timeline-label'));

        if (needsRebuild) {
            labelsContainer.innerHTML = blocks.map(function(b) {
                return '<span class="text-tp-muted" style="transition:color .25s ease, text-shadow .25s ease, transform .25s ease, opacity .25s ease;">' + b.title + '</span>';
            }).join('');
            labels = labelsContainer.querySelectorAll('span');
        } else {
            for (var ii = 0; ii < labels.length; ii++) {
                if (labels[ii].textContent !== blocks[ii].title) labels[ii].textContent = blocks[ii].title;
            }
        }

        // Trova blocco corrente
        var currentIdx = -1;
        for (var i = 0; i < blocks.length; i++) {
            var bStart = timeToMinutes(blocks[i].start);
            var bEnd = timeToMinutes(blocks[i].end);
            if (totalMinutes >= bStart && totalMinutes < bEnd) { currentIdx = i; break; }
        }

        for (var i = 0; i < labels.length; i++) {
            var lbl = labels[i];
            // Reset stili inline che potrebbero essere stati impostati prima
            lbl.style.padding = '';
            lbl.style.background = '';
            lbl.style.border = '';
            lbl.style.borderRadius = '';
            lbl.style.boxShadow = '';
            lbl.style.zIndex = '';
            lbl.classList.remove('text-white', 'text-tp-muted', 'opacity-30', 'opacity-40', 'opacity-60');

            if (i === currentIdx) {
                // Attivo: colore accent + doppio glow (accent + bianco interno) + leggero scale
                lbl.style.color = '#20c997';
                lbl.style.textShadow = '0 0 10px rgba(32,201,151,0.95), 0 0 3px rgba(255,255,255,0.7)';
                lbl.style.opacity = '1';
                lbl.style.transform = 'scale(1.18)';
                lbl.style.transformOrigin = 'center bottom';
            } else {
                // Inattivi: muted + bassa opacity, struttura immutata
                lbl.style.color = '';
                lbl.style.textShadow = 'none';
                lbl.style.opacity = '0.3';
                lbl.style.transform = 'scale(1)';
                lbl.classList.add('text-tp-muted');
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

        // Winrate standard: win / (win + loss). Breakeven neutro, running esclusi.
        var wins = trades.filter(function(t) { return t.esito === 'win'; }).length;
        var losses = trades.filter(function(t) { return t.esito === 'loss'; }).length;
        var decided = wins + losses;
        if (decided === 0) return;
        var winrate = Math.round((wins / decided) * 100);

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

        // Per-coin volatility pills in #volatility-coins
        var coinsDiv = document.getElementById('volatility-coins');
        if (coinsDiv) {
            try {
                var wlResult = await db.from('watchlist').select('simbolo, volatilita_auto').eq('active', true).order('simbolo');
                var wlRows = wlResult.data || [];
                var coinAbbr = { XAUUSD:'XAU', US30:'US30', GER30:'GER', NAS100:'NAS', BTCUSD:'BTC', EURUSD:'EUR', GBPUSD:'GBP', USDJPY:'JPY', USDCHF:'CHF', AUDUSD:'AUD' };
                var volColorMap = { high:'#20c997', medium:'#eab308', low:'#f43f5e' };
                // Tachimetro SVG: pivot (14,14), raggio 11, arco da sinistra a destra passando per il top
                // Lancetta: low=sinistra (3,14), medium=centro alto (14,3), high=destra (25,14)
                var volNeedleMap = { high:{x:25,y:14}, medium:{x:14,y:3}, low:{x:3,y:14} };
                var html = '';
                wlRows.forEach(function(r) {
                    var abbr = coinAbbr[r.simbolo] || r.simbolo.slice(0, 3);
                    var color = volColorMap[r.volatilita_auto] || '#848d97';
                    var nd = volNeedleMap[r.volatilita_auto] || {x:14,y:3};
                    html += '<div class="flex flex-col items-center gap-0.5" title="' + r.simbolo + ' — ' + (r.volatilita_auto || 'n.d.') + '">' +
                        '<svg viewBox="0 0 28 15" width="22" height="12" style="overflow:visible">' +
                        '<path d="M3,14 A11,11 0 0,1 25,14" fill="none" stroke="rgba(255,255,255,0.1)" stroke-width="1.8" stroke-linecap="round"/>' +
                        '<line x1="14" y1="14" x2="' + nd.x + '" y2="' + nd.y + '" stroke="' + color + '" stroke-width="1.6" stroke-linecap="round" style="filter:drop-shadow(0 0 3px ' + color + ')"/>' +
                        '<circle cx="14" cy="14" r="1.8" fill="' + color + '" style="filter:drop-shadow(0 0 3px ' + color + ')"/>' +
                        '</svg>' +
                        '<span style="font-size:8px;line-height:1;color:' + color + ';font-weight:600;letter-spacing:0.02em">' + abbr + '</span>' +
                        '</div>';
                });
                coinsDiv.innerHTML = html;
            } catch(e) { /* watchlist non disponibile */ }
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

// ==========================================
// 8. FLOATING CHAT WIDGET
// ==========================================
(function() {
    // Non mostrare il widget nelle pagine chat dedicate
    if (window.location.pathname.includes('dede.html') || window.location.pathname.includes('steve.html') || window.location.pathname.includes('login.html')) return;

    var EDGE_URL = 'https://fzxjbxeadiqwfpctiyom.supabase.co/functions/v1/chat-ai';
    var ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ6eGpieGVhZGlxd2ZwY3RpeW9tIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUyNDUyNTQsImV4cCI6MjA5MDgyMTI1NH0.WpJjZrHgY33aydqpLyN-Jh9wrQmMLLVsb7lp41_y9Z0';
    var chatHistory = [];
    var chatMode = 'giornaliero';
    var isOpen = false;
    var ASSISTANT = 'rodrigo';
    var CUTOFF_KEY = 'td_chat_rodrigo_cutoff';

    function _getCutoffIso() {
        var c = localStorage.getItem(CUTOFF_KEY);
        return c || new Date(Date.now() - 48 * 3600 * 1000).toISOString();
    }
    function _userBubble(content) {
        return '<div class="ai-msg-user" style="border-radius:8px;padding:10px 12px;margin-left:auto;max-width:85%"><div style="font-size:12px;color:rgba(248,250,252,0.9);line-height:1.5;white-space:pre-wrap">' + aiEscape(content) + '</div></div>';
    }
    function _aiBubble(content, slotLabel, timestampIso) {
        var badge = '';
        if (slotLabel) {
            var ora = timestampIso ? new Date(timestampIso).toLocaleTimeString('it-IT',{hour:'2-digit',minute:'2-digit'}) : '';
            badge = '<span style="font-size:9px;color:#a78bfa;background:rgba(139,92,246,0.1);border:1px solid rgba(139,92,246,0.2);border-radius:4px;padding:2px 6px;margin-left:8px;text-transform:uppercase;letter-spacing:0.05em;font-weight:700">' + slotLabel + (ora ? ' ' + ora : '') + '</span>';
        }
        return '<div class="ai-msg-ai" style="border-radius:8px;padding:10px 12px"><div style="display:flex;gap:8px;align-items:flex-start"><div style="background:rgba(139,92,246,0.1);padding:4px;border-radius:6px;flex-shrink:0"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#a78bfa" stroke-width="2"><path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/></svg></div><div style="flex:1;font-size:12px;color:rgba(248,250,252,0.9);line-height:1.5;white-space:pre-wrap"><div style="margin-bottom:4px">' + badge + '</div>' + aiFormat(content) + '</div></div></div>';
    }
    async function _loadChatFromDb() {
        if (typeof db === 'undefined' || !db) return;
        try {
            var res = await db.from('assistant_messages')
                .select('created_at, ruolo, contenuto, sorgente, slot')
                .eq('assistente', ASSISTANT)
                .gt('created_at', _getCutoffIso())
                .order('created_at', { ascending: true })
                .limit(200);
            if (res.error) return;
            var rows = res.data || [];
            chatHistory = [];
            var container = document.getElementById('ai-chat-msgs');
            if (!container) return;
            if (rows.length === 0) return;
            var html = '';
            rows.forEach(function(m) {
                if (m.ruolo === 'user') {
                    chatHistory.push({ role: 'user', content: m.contenuto });
                    html += _userBubble(m.contenuto);
                } else {
                    if (m.sorgente === 'chat') chatHistory.push({ role: 'assistant', content: m.contenuto });
                    html += _aiBubble(m.contenuto, m.sorgente === 'routine' ? (m.slot || 'routine') : null, m.created_at);
                }
            });
            container.innerHTML = html;
            container.scrollTop = container.scrollHeight;
        } catch(e) { console.warn('widget load:', e); }
    }
    async function _persistMessage(ruolo, contenuto) {
        if (typeof db === 'undefined' || !db) return;
        try {
            await db.from('assistant_messages').insert({
                assistente: ASSISTANT,
                ruolo: ruolo,
                sorgente: 'chat',
                contenuto: contenuto
            });
        } catch(e) { console.warn('widget persist:', e); }
    }

    // Inject CSS
    var style = document.createElement('style');
    style.textContent = `
        #ai-fab { position:fixed; bottom:24px; right:24px; z-index:9999; width:52px; height:52px; border-radius:16px; background:linear-gradient(135deg,#8b5cf6,#6d28d9); border:none; cursor:pointer; box-shadow:0 4px 20px rgba(139,92,246,0.4); display:flex; align-items:center; justify-content:center; transition:all 0.3s; }
        #ai-fab:hover { transform:scale(1.08); box-shadow:0 6px 28px rgba(139,92,246,0.6); }
        #ai-fab.has-chat { animation: fab-pulse 2s infinite; }
        @keyframes fab-pulse { 0%,100%{box-shadow:0 4px 20px rgba(139,92,246,0.4)} 50%{box-shadow:0 4px 28px rgba(139,92,246,0.7)} }
        #ai-chat-widget { position:fixed; bottom:88px; right:24px; z-index:9998; width:400px; max-width:calc(100vw - 48px); max-height:75vh; background:#0a0c10; border:1px solid #252932; border-radius:16px; box-shadow:0 8px 40px rgba(0,0,0,0.6); display:none; flex-direction:column; overflow:hidden; }
        #ai-chat-widget.open { display:flex; }
        #ai-chat-widget .ai-msg-user { background:rgba(32,201,151,0.08); border-left:3px solid #20c997; }
        #ai-chat-widget .ai-msg-ai { background:rgba(22,25,32,0.8); border-left:3px solid #8b5cf6; }
        .ai-typing-dot { animation: ai-blink 1.4s infinite both; }
        .ai-typing-dot:nth-child(2) { animation-delay:0.2s; }
        .ai-typing-dot:nth-child(3) { animation-delay:0.4s; }
        @keyframes ai-blink { 0%,80%,100%{opacity:0} 40%{opacity:1} }
    `;
    document.head.appendChild(style);

    // Inject HTML
    var fabHtml = '<button id="ai-fab" onclick="toggleAiChat()"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/></svg></button>';

    var widgetHtml = '<div id="ai-chat-widget">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid #252932;background:#161920">' +
            '<div style="display:flex;align-items:center;gap:8px"><div style="background:rgba(139,92,246,0.15);padding:6px;border-radius:8px"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#8b5cf6" stroke-width="2"><path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/></svg></div><span style="font-size:13px;font-weight:700;color:#f8fafc">Rodrigo</span></div>' +
            '<div style="display:flex;gap:6px;align-items:center">' +
                '<button onclick="clearAiChat()" style="background:none;border:1px solid #252932;border-radius:6px;padding:4px 8px;cursor:pointer;color:#848d97;font-size:9px;font-weight:700"">PULISCI</button>' +
                '<button onclick="toggleAiChat()" style="background:none;border:none;cursor:pointer;color:#848d97;padding:4px"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg></button>' +
            '</div>' +
        '</div>' +
        '<div id="ai-chat-msgs" style="flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:8px;min-height:400px;max-height:calc(75vh - 120px)">' +
            '<div class="ai-msg-ai" style="border-radius:8px;padding:10px 12px"><div style="display:flex;gap:8px;align-items:flex-start"><div style="background:rgba(139,92,246,0.1);padding:4px;border-radius:6px;flex-shrink:0"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#a78bfa" stroke-width="2"><path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/></svg></div><span style="font-size:12px;color:rgba(248,250,252,0.9);line-height:1.5">Ciao! Sono Rodrigo, il tuo assistente giornaliero. Come posso aiutarti?</span></div></div>' +
        '</div>' +
        '<div style="padding:10px 12px;border-top:1px solid #252932;background:#161920">' +
            '<div style="display:flex;gap:8px;background:#0B0E14;border:1px solid #252932;border-radius:10px;padding:6px">' +
                '<textarea id="ai-chat-input" rows="1" placeholder="Scrivi..." style="flex:1;background:transparent;border:none;outline:none;font-size:13px;color:#f8fafc;padding:4px 8px;resize:none;line-height:1.5;max-height:40vh;overflow-y:auto;font-family:inherit" spellcheck="true" lang="it" oninput="this.style.height=\'auto\';this.style.height=Math.min(this.scrollHeight, window.innerHeight*0.4)+\'px\'" onkeydown="if(event.key===\'Enter\' && !event.shiftKey){event.preventDefault();sendAiChat()}"></textarea>' +
                '<button id="ai-send-btn" onclick="sendAiChat()" style="background:#20c997;border:none;border-radius:8px;padding:6px 14px;cursor:pointer;color:#0a0c10;font-weight:700;font-size:12px;white-space:nowrap">Invia</button>' +
            '</div>' +
        '</div>' +
    '</div>';

    document.addEventListener('DOMContentLoaded', function() {
        var wrapper = document.createElement('div');
        wrapper.innerHTML = fabHtml + widgetHtml;
        document.body.appendChild(wrapper);

        // Carica da DB (routine + chat interattive)
        _loadChatFromDb();
        // Refresh silenzioso ogni 60s per catturare messaggi routine mentre il widget resta aperto
        setInterval(_loadChatFromDb, 60 * 1000);
    });

    // --- Mobile sidebar drawer (cross-page auto-injection) ---
    window.toggleMobileSidebar = function() {
        var sb = document.getElementById('td-sidebar');
        var bd = document.getElementById('td-backdrop');
        if (!sb || !bd) return;
        sb.classList.toggle('mobile-open');
        bd.classList.toggle('hidden');
    };

    function initMobileSidebar() {
        // Trova la sidebar standard e assegna l'id se manca (per pagine non ancora taggate)
        var aside = document.querySelector('aside.w-16');
        if (!aside) return; // pagine senza sidebar (login)
        if (!aside.id) aside.id = 'td-sidebar';

        // Inietta CSS responsive una sola volta
        if (!document.getElementById('td-mobile-css')) {
            var s = document.createElement('style');
            s.id = 'td-mobile-css';
            s.textContent = '@media (max-width:1023px){' +
                '#td-sidebar{transform:translateX(-100%);width:16rem !important;transition:transform .25s ease}' +
                '#td-sidebar.mobile-open{transform:translateX(0)}' +
                '#td-sidebar.mobile-open .opacity-0{opacity:1 !important}' +
                '#td-sidebar.mobile-open a{width:calc(100% - 2rem) !important}' +
                '#td-mobile-fab{position:fixed;top:10px;left:10px;z-index:60;width:40px;height:40px;border-radius:10px;background:rgba(22,25,32,0.92);border:1px solid #252932;color:#f8fafc;display:flex;align-items:center;justify-content:center;cursor:pointer;backdrop-filter:blur(8px)}' +
            '}' +
            '@media (min-width:1024px){#td-mobile-fab{display:none !important}}';
            document.head.appendChild(s);
        }

        // Backdrop
        if (!document.getElementById('td-backdrop')) {
            var bd = document.createElement('div');
            bd.id = 'td-backdrop';
            bd.className = 'hidden fixed inset-0 bg-black/60 z-40 lg:hidden';
            bd.addEventListener('click', window.toggleMobileSidebar);
            document.body.appendChild(bd);
        }

        // Hamburger floating: solo se nessun bottone inline gia chiama toggleMobileSidebar
        var inline = document.querySelector('button[onclick*="toggleMobileSidebar"]');
        if (!inline && !document.getElementById('td-mobile-fab')) {
            var fab = document.createElement('button');
            fab.id = 'td-mobile-fab';
            fab.setAttribute('aria-label', 'Apri menu');
            fab.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>';
            fab.addEventListener('click', window.toggleMobileSidebar);
            document.body.appendChild(fab);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initMobileSidebar);
    } else {
        initMobileSidebar();
    }

    window.toggleAiChat = function() {
        isOpen = !isOpen;
        var widget = document.getElementById('ai-chat-widget');
        widget.classList.toggle('open', isOpen);
        if (isOpen) {
            var msgs = document.getElementById('ai-chat-msgs');
            msgs.scrollTop = msgs.scrollHeight;
            setTimeout(function() { document.getElementById('ai-chat-input').focus(); }, 100);
        }
    };

    window.clearAiChat = function() {
        // Imposta cutoff: i messaggi precedenti restano in DB ma non vengono mostrati
        localStorage.setItem(CUTOFF_KEY, new Date().toISOString());
        chatHistory = [];
        document.getElementById('ai-chat-msgs').innerHTML = '<div class="ai-msg-ai" style="border-radius:8px;padding:10px 12px"><div style="display:flex;gap:8px;align-items:flex-start"><div style="background:rgba(139,92,246,0.1);padding:4px;border-radius:6px;flex-shrink:0"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#a78bfa" stroke-width="2"><path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/></svg></div><span style="font-size:12px;color:rgba(248,250,252,0.9);line-height:1.5">Chat pulita. Come posso aiutarti?</span></div></div>';
    };

    function aiEscape(text) {
        var div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    function aiFormat(text) {
        text = text.replace(/\*\*(.*?)\*\*/g, '<strong style="color:#f8fafc">$1</strong>');
        text = text.replace(/^### (.*)/gm, '<div style="color:#f8fafc;font-weight:700;margin-top:8px">$1</div>');
        text = text.replace(/^## (.*)/gm, '<div style="color:#f8fafc;font-weight:700;font-size:13px;margin-top:8px">$1</div>');
        text = text.replace(/^- (.*)/gm, '<span style="color:#20c997;margin-right:4px">•</span> $1');
        text = text.replace(/^\d+\. (.*)/gm, '<span style="color:#20c997;margin-right:4px">→</span> $1');
        return text;
    }

    window.sendAiChat = async function() {
        var input = document.getElementById('ai-chat-input');
        var msg = input.value.trim();
        if (!msg) return;

        var container = document.getElementById('ai-chat-msgs');
        var sendBtn = document.getElementById('ai-send-btn');

        // User msg
        container.innerHTML += _userBubble(msg);
        _persistMessage('user', msg);

        input.value = '';
        input.style.height = 'auto';
        input.disabled = true;
        sendBtn.disabled = true;
        sendBtn.textContent = '...';

        // Typing
        container.innerHTML += '<div id="ai-typing" class="ai-msg-ai" style="border-radius:8px;padding:10px 12px"><div style="display:flex;gap:4px;padding:4px 0"><div class="ai-typing-dot" style="width:6px;height:6px;background:#a78bfa;border-radius:50%"></div><div class="ai-typing-dot" style="width:6px;height:6px;background:#a78bfa;border-radius:50%"></div><div class="ai-typing-dot" style="width:6px;height:6px;background:#a78bfa;border-radius:50%"></div></div></div>';
        container.scrollTop = container.scrollHeight;

        try {
            var response = await fetch(EDGE_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + ANON_KEY },
                body: JSON.stringify({ message: msg, history: chatHistory, mode: chatMode })
            });
            var data = await response.json();

            var typing = document.getElementById('ai-typing');
            if (typing) typing.remove();

            if (data.error) {
                container.innerHTML += '<div class="ai-msg-ai" style="border-radius:8px;padding:10px 12px"><span style="font-size:12px;color:#f43f5e">Errore: ' + aiEscape(data.error) + '</span></div>';
            } else {
                container.innerHTML += _aiBubble(data.reply, null, null);
                chatHistory.push({ role: 'user', content: msg });
                chatHistory.push({ role: 'assistant', content: data.reply });
                _persistMessage('assistant', data.reply);
            }
        } catch(e) {
            var typing = document.getElementById('ai-typing');
            if (typing) typing.remove();
            container.innerHTML += '<div class="ai-msg-ai" style="border-radius:8px;padding:10px 12px"><span style="font-size:12px;color:#f43f5e">Errore: ' + aiEscape(e.message) + '</span></div>';
        }

        container.scrollTop = container.scrollHeight;
        input.disabled = false;
        sendBtn.disabled = false;
        sendBtn.textContent = 'Invia';
        input.focus();
    };
})();

// ==========================================
// 9. LOSS ALERT POPUP (Realtime)
// ==========================================
(function() {
    var STORAGE_KEY = 'td_dismissed_loss_alerts';
    var dismissedLocal;
    try { dismissedLocal = new Set(JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')); }
    catch (e) { dismissedLocal = new Set(); }

    function injectStyles() {
        if (document.getElementById('loss-alert-styles')) return;
        var style = document.createElement('style');
        style.id = 'loss-alert-styles';
        style.textContent = [
            '.loss-alert-overlay{position:fixed;inset:0;background:rgba(0,0,0,0.85);backdrop-filter:blur(8px);z-index:99999;display:flex;align-items:center;justify-content:center;padding:20px;animation:lossAlertFadeIn 0.3s ease}',
            '@keyframes lossAlertFadeIn{from{opacity:0}to{opacity:1}}',
            '.loss-alert-card{background:linear-gradient(135deg,#1a0e0e 0%,#161920 100%);border:2px solid #f43f5e;border-radius:16px;padding:40px;max-width:640px;width:100%;box-shadow:0 0 80px rgba(244,63,94,0.45);text-align:center;animation:lossAlertScale 0.4s cubic-bezier(0.34,1.56,0.64,1)}',
            '@keyframes lossAlertScale{from{transform:scale(0.85);opacity:0}to{transform:scale(1);opacity:1}}',
            '.loss-alert-badge{display:inline-block;background:rgba(244,63,94,0.12);color:#f43f5e;border:1px solid rgba(244,63,94,0.4);border-radius:999px;padding:6px 14px;font-size:11px;font-weight:800;letter-spacing:0.12em;text-transform:uppercase;margin-bottom:24px}',
            '.loss-alert-frase{font-size:18px;line-height:1.65;color:#f8fafc;font-weight:500;font-style:italic;margin:0 0 32px 0}',
            '.loss-alert-btn{background:linear-gradient(135deg,#f43f5e 0%,#dc2626 100%);color:white;border:none;padding:14px 36px;border-radius:10px;font-size:13px;font-weight:800;letter-spacing:0.1em;text-transform:uppercase;cursor:pointer;transition:transform 0.15s,box-shadow 0.15s;font-family:inherit}',
            '.loss-alert-btn:hover{transform:translateY(-2px);box-shadow:0 10px 25px rgba(244,63,94,0.4)}',
            '.loss-alert-btn:active{transform:translateY(0)}'
        ].join('\n');
        document.head.appendChild(style);
    }

    function persistDismissed() {
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify([].slice.call(dismissedLocal))); } catch (e) {}
    }

    function showAlert(alert) {
        if (!alert || !alert.id) return;
        if (dismissedLocal.has(alert.id)) return;
        // Evita duplicati: se gia mostrato in questa pagina
        if (document.getElementById('loss-alert-' + alert.id)) return;
        injectStyles();

        var overlay = document.createElement('div');
        overlay.className = 'loss-alert-overlay';
        overlay.id = 'loss-alert-' + alert.id;

        var sessione = (alert.sessione || '').toUpperCase();
        var count = alert.count_in_sessione || 0;
        var frase = alert.frase || '';

        overlay.innerHTML =
            '<div class="loss-alert-card">' +
                '<div class="loss-alert-badge">Stop Loss #' + count + ' &mdash; sessione ' + sessione + '</div>' +
                '<p class="loss-alert-frase">' + frase + '</p>' +
                '<button class="loss-alert-btn" type="button">Ho capito</button>' +
            '</div>';
        document.body.appendChild(overlay);

        var btn = overlay.querySelector('.loss-alert-btn');
        btn.addEventListener('click', async function() {
            dismissedLocal.add(alert.id);
            persistDismissed();
            try {
                if (typeof db !== 'undefined' && db) {
                    await db.from('loss_alerts').update({ dismissed_at: new Date().toISOString() }).eq('id', alert.id);
                }
            } catch (e) { console.warn('loss_alert dismiss:', e); }
            overlay.style.animation = 'lossAlertFadeIn 0.2s ease reverse';
            setTimeout(function() { overlay.remove(); }, 200);
        });

        // ESC per chiudere
        document.addEventListener('keydown', function escHandler(ev) {
            if (ev.key === 'Escape' && document.body.contains(overlay)) {
                btn.click();
                document.removeEventListener('keydown', escHandler);
            }
        });
    }

    async function loadPending() {
        if (typeof db === 'undefined' || !db) return;
        try {
            // Solo non-dismissed di oggi (Casablanca date) - per non mostrare alert vecchi
            var todayCasa = new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Casablanca' });
            var res = await db.from('loss_alerts')
                .select('*')
                .is('dismissed_at', null)
                .eq('data_casa', todayCasa)
                .order('created_at', { ascending: true });
            if (res.error || !res.data) return;
            res.data.forEach(function(a) { showAlert(a); });
        } catch (e) { console.warn('loss_alerts loadPending:', e); }
    }

    function subscribe() {
        if (typeof db === 'undefined' || !db) return;
        try {
            db.channel('loss_alerts_realtime')
                .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'loss_alerts' }, function(payload) {
                    showAlert(payload['new']);
                })
                .subscribe();
        } catch (e) { console.warn('loss_alerts subscribe:', e); }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() { loadPending(); subscribe(); });
    } else {
        loadPending(); subscribe();
    }
})();

// ==========================================
// 10. CANDELA 4H REMINDER
// ==========================================
(function() {
    var CLOSE_HOURS_CASA = [3, 7, 11, 15, 19];
    var STORAGE_KEY = 'td_candle4h_shown';

    function getShown() {
        try { return new Set(JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')); }
        catch (e) { return new Set(); }
    }
    function markShown(key) {
        var shown = getShown();
        shown.add(key);
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(shown))); } catch (e) {}
    }

    function isWeekday() {
        var day = new Date().toLocaleDateString('en-US', { timeZone: 'Africa/Casablanca', weekday: 'short' });
        return day !== 'Sat' && day !== 'Sun';
    }

    function getCasaTime() {
        var now = new Date();
        var parts = new Intl.DateTimeFormat('en-CA', {
            timeZone: 'Africa/Casablanca',
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', hour12: false
        }).formatToParts(now);
        var get = function(t) { return parseInt((parts.find(function(p) { return p.type === t; }) || {}).value || '0', 10); };
        var date = (parts.find(function(p) { return p.type === 'year'; }) || {}).value + '-' +
                   String(get('month')).padStart(2, '0') + '-' +
                   String(get('day')).padStart(2, '0');
        return { hour: get('hour'), minute: get('minute'), date: date };
    }

    function injectStyles() {
        if (document.getElementById('candle4h-styles')) return;
        var style = document.createElement('style');
        style.id = 'candle4h-styles';
        style.textContent = [
            '.candle4h-overlay{position:fixed;inset:0;background:rgba(0,0,0,0.85);backdrop-filter:blur(8px);z-index:99999;display:flex;align-items:center;justify-content:center;padding:20px;animation:c4hFadeIn 0.3s ease}',
            '@keyframes c4hFadeIn{from{opacity:0}to{opacity:1}}',
            '.candle4h-card{background:linear-gradient(135deg,#1a1200 0%,#161920 100%);border:2px solid #f59e0b;border-radius:16px;padding:40px;max-width:540px;width:100%;box-shadow:0 0 80px rgba(245,158,11,0.4);text-align:center;animation:c4hScale 0.4s cubic-bezier(0.34,1.56,0.64,1)}',
            '@keyframes c4hScale{from{transform:scale(0.85);opacity:0}to{transform:scale(1);opacity:1}}',
            '.candle4h-badge{display:inline-block;background:rgba(245,158,11,0.12);color:#f59e0b;border:1px solid rgba(245,158,11,0.4);border-radius:999px;padding:6px 14px;font-size:11px;font-weight:800;letter-spacing:0.12em;text-transform:uppercase;margin-bottom:24px}',
            '.candle4h-title{font-size:22px;font-weight:700;color:#f8fafc;margin:0 0 8px 0}',
            '.candle4h-sub{font-size:13px;color:#94a3b8;margin:0 0 32px 0}',
            '.candle4h-btn{background:linear-gradient(135deg,#f59e0b 0%,#d97706 100%);color:#0f172a;border:none;padding:14px 36px;border-radius:10px;font-size:13px;font-weight:800;letter-spacing:0.1em;text-transform:uppercase;cursor:pointer;transition:transform 0.15s,box-shadow 0.15s;font-family:inherit}',
            '.candle4h-btn:hover{transform:translateY(-2px);box-shadow:0 10px 25px rgba(245,158,11,0.4)}',
            '.candle4h-btn:active{transform:translateY(0)}'
        ].join('\n');
        document.head.appendChild(style);
    }

    function showAlert(closeHour, alertKey) {
        if (document.getElementById('candle4h-overlay')) return;
        injectStyles();
        var closeTime = String(closeHour).padStart(2, '0') + ':00';
        var overlay = document.createElement('div');
        overlay.className = 'candle4h-overlay';
        overlay.id = 'candle4h-overlay';
        overlay.innerHTML =
            '<div class="candle4h-card">' +
                '<div class="candle4h-badge">Candela 4H</div>' +
                '<p class="candle4h-title">Chiude alle ' + closeTime + '</p>' +
                '<p class="candle4h-sub">5 minuti alla chiusura &mdash; guarda il grafico.</p>' +
                '<button class="candle4h-btn" type="button">Ho visto</button>' +
            '</div>';
        document.body.appendChild(overlay);

        var btn = overlay.querySelector('.candle4h-btn');
        btn.addEventListener('click', function() {
            markShown(alertKey);
            overlay.style.animation = 'c4hFadeIn 0.2s ease reverse';
            setTimeout(function() { overlay.remove(); }, 200);
        });
        document.addEventListener('keydown', function escHandler(ev) {
            if (ev.key === 'Escape' && document.body.contains(overlay)) {
                btn.click();
                document.removeEventListener('keydown', escHandler);
            }
        });
    }

    function check() {
        if (!isWeekday()) return;
        var t = getCasaTime();
        for (var i = 0; i < CLOSE_HOURS_CASA.length; i++) {
            var closeHour = CLOSE_HOURS_CASA[i];
            if (t.hour === closeHour - 1 && t.minute >= 55) {
                var key = t.date + '_4h_' + closeHour;
                if (!getShown().has(key)) showAlert(closeHour, key);
                break;
            }
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() { check(); setInterval(check, 30000); });
    } else {
        check(); setInterval(check, 30000);
    }
})();

// ==========================================
// 11. TRADE LOCKOUT COUNTDOWN
// ==========================================
(function() {
    var LOCKOUT_MS  = 13 * 60 * 1000;
    var STORAGE_KEY = 'td_lockout_last_close';

    function getLastClose() {
        var v = localStorage.getItem(STORAGE_KEY);
        return v ? new Date(v).getTime() : 0;
    }

    function setLastClose(isoStr) {
        var ts = new Date(isoStr).getTime();
        if (ts > getLastClose()) localStorage.setItem(STORAGE_KEY, isoStr);
    }

    function injectStyles() {
        if (document.getElementById('lockout-styles')) return;
        var s = document.createElement('style');
        s.id = 'lockout-styles';
        s.textContent =
            '#lockout-badge{display:none;align-items:center;gap:5px;background:rgba(244,63,94,0.1);' +
            'border:1px solid rgba(244,63,94,0.35);border-radius:8px;padding:3px 10px;' +
            'font-size:12px;font-weight:700;color:#f43f5e;font-family:monospace;margin-left:12px;' +
            'transition:background 0.3s}' +
            '#lockout-badge.active{display:flex}' +
            '#lockout-badge.pulse{animation:lk-pulse 1s infinite}' +
            '@keyframes lk-pulse{0%,100%{opacity:1}50%{opacity:0.55}}';
        document.head.appendChild(s);
    }

    function injectBadge() {
        if (document.getElementById('lockout-badge')) return;
        var clockEl = document.getElementById('digital-clock');
        if (!clockEl) return;
        var badge = document.createElement('div');
        badge.id = 'lockout-badge';
        badge.title = 'Lockout attivo: attendi prima del prossimo trade';
        badge.innerHTML =
            '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">' +
            '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>' +
            '<span id="lockout-countdown">00:00</span>';
        clockEl.insertAdjacentElement('afterend', badge);
    }

    function tick() {
        var badge = document.getElementById('lockout-badge');
        if (!badge) return;
        var lastClose = getLastClose();
        if (!lastClose) { badge.classList.remove('active', 'pulse'); return; }
        var remaining = LOCKOUT_MS - (Date.now() - lastClose);
        if (remaining <= 0) { badge.classList.remove('active', 'pulse'); return; }
        var mins = Math.floor(remaining / 60000);
        var secs = Math.floor((remaining % 60000) / 1000);
        var cd = document.getElementById('lockout-countdown');
        if (cd) cd.textContent = String(mins).padStart(2, '0') + ':' + String(secs).padStart(2, '0');
        badge.classList.add('active');
        badge.classList.toggle('pulse', remaining < 60000);
        badge.style.background = remaining < 60000
            ? 'rgba(244,63,94,0.22)'
            : 'rgba(244,63,94,0.1)';
    }

    async function initFromDb() {
        if (typeof db === 'undefined' || !db) return;
        try {
            var res = await db.from('trades').select('created_at').order('created_at', { ascending: false }).limit(1).maybeSingle();
            if (res.data && res.data.created_at) setLastClose(res.data.created_at);
        } catch(e) { console.warn('lockout init:', e); }
    }

    function subscribeRealtime() {
        if (typeof db === 'undefined' || !db) return;
        try {
            db.channel('lockout_trades_ch')
                .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'trades' }, function(payload) {
                    if (payload.new && payload.new.created_at) {
                        setLastClose(payload.new.created_at);
                        tick();
                    }
                })
                .subscribe();
        } catch(e) { console.warn('lockout subscribe:', e); }
    }

    document.addEventListener('DOMContentLoaded', function() {
        injectStyles();
        injectBadge();
        initFromDb().then(function() { tick(); });
        subscribeRealtime();
        setInterval(tick, 1000);
    });
})();

// ==========================================
// Navigazione: vai al dettaglio della giornata di oggi (crea se manca)
// ==========================================
window.goToIpotesiOggi = function(ev) {
    if (ev && ev.preventDefault) ev.preventDefault();
    var today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Africa/Casablanca' });
    window.location.href = 'ipotesi.html?date=' + today;
};

window.goToSessioniOggi = function(ev) {
    if (ev && ev.preventDefault) ev.preventDefault();
    var today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Africa/Casablanca' });
    window.location.href = 'sessioni.html?date=' + today;
};

window.goToBiasOggi = async function(ev) {
    if (ev && ev.preventDefault) ev.preventDefault();
    if (typeof db === 'undefined' || !db) return;
    try {
        var today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Africa/Casablanca' });
        var existing = await db.from('bias').select('id').eq('data', today).order('created_at', { ascending: true }).limit(1).maybeSingle();
        if (existing.data && existing.data.id) {
            window.location.href = 'dettaglio_bias.html?id=' + existing.data.id;
        } else {
            window.location.href = 'bias.html';
        }
    } catch(e) {
        console.error('goToBiasOggi:', e);
    }
};

window.goToOggi = async function(ev) {
    if (ev && ev.preventDefault) ev.preventDefault();
    if (typeof db === 'undefined' || !db) { console.warn('goToOggi: db non disponibile'); return; }
    try {
        var today = new Date().toISOString().split('T')[0];
        var existing = await db.from('giornate').select('id').eq('data', today).maybeSingle();
        if (existing.data && existing.data.id) {
            window.location.href = 'dettaglio_giornata.html?id=' + existing.data.id;
            return;
        }
        var created = await db.from('giornate').insert({ data: today, stato: 'nuovo' }).select().single();
        if (created.error) { alert('Errore creazione giornata: ' + created.error.message); return; }
        window.location.href = 'dettaglio_giornata.html?id=' + created.data.id;
    } catch (e) {
        console.error('goToOggi:', e);
        alert('Errore: ' + e.message);
    }
};
