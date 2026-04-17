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
    checkBlink('tf-4h', ((now.getHours() % 4 === 1) && m === 59 && s >= 50));
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

    // Inject CSS
    var style = document.createElement('style');
    style.textContent = `
        #ai-fab { position:fixed; bottom:24px; right:24px; z-index:9999; width:52px; height:52px; border-radius:16px; background:linear-gradient(135deg,#8b5cf6,#6d28d9); border:none; cursor:pointer; box-shadow:0 4px 20px rgba(139,92,246,0.4); display:flex; align-items:center; justify-content:center; transition:all 0.3s; }
        #ai-fab:hover { transform:scale(1.08); box-shadow:0 6px 28px rgba(139,92,246,0.6); }
        #ai-fab.has-chat { animation: fab-pulse 2s infinite; }
        @keyframes fab-pulse { 0%,100%{box-shadow:0 4px 20px rgba(139,92,246,0.4)} 50%{box-shadow:0 4px 28px rgba(139,92,246,0.7)} }
        #ai-chat-widget { position:fixed; bottom:88px; right:24px; z-index:9998; width:400px; max-height:75vh; background:#0a0c10; border:1px solid #252932; border-radius:16px; box-shadow:0 8px 40px rgba(0,0,0,0.6); display:none; flex-direction:column; overflow:hidden; }
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
            '<div style="display:flex;align-items:center;gap:8px"><div style="background:rgba(139,92,246,0.15);padding:6px;border-radius:8px"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#8b5cf6" stroke-width="2"><path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/></svg></div><span style="font-size:13px;font-weight:700;color:#f8fafc">Sofi</span></div>' +
            '<div style="display:flex;gap:6px;align-items:center">' +
                '<button onclick="clearAiChat()" style="background:none;border:1px solid #252932;border-radius:6px;padding:4px 8px;cursor:pointer;color:#848d97;font-size:9px;font-weight:700"">PULISCI</button>' +
                '<button onclick="toggleAiChat()" style="background:none;border:none;cursor:pointer;color:#848d97;padding:4px"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg></button>' +
            '</div>' +
        '</div>' +
        '<div id="ai-chat-msgs" style="flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:8px;min-height:400px;max-height:calc(75vh - 120px)">' +
            '<div class="ai-msg-ai" style="border-radius:8px;padding:10px 12px"><div style="display:flex;gap:8px;align-items:flex-start"><div style="background:rgba(139,92,246,0.1);padding:4px;border-radius:6px;flex-shrink:0"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#a78bfa" stroke-width="2"><path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/></svg></div><span style="font-size:12px;color:rgba(248,250,252,0.9);line-height:1.5">Ciao! Sono Sofi, la tua assistente giornaliera. Come posso aiutarti?</span></div></div>' +
        '</div>' +
        '<div style="padding:10px 12px;border-top:1px solid #252932;background:#161920">' +
            '<div style="display:flex;gap:8px;background:#0B0E14;border:1px solid #252932;border-radius:10px;padding:6px">' +
                '<input id="ai-chat-input" type="text" placeholder="Scrivi..." style="flex:1;background:transparent;border:none;outline:none;font-size:13px;color:#f8fafc;padding:4px 8px" spellcheck="true" lang="it" onkeydown="if(event.key===\'Enter\'){event.preventDefault();sendAiChat()}">' +
                '<button id="ai-send-btn" onclick="sendAiChat()" style="background:#20c997;border:none;border-radius:8px;padding:6px 14px;cursor:pointer;color:#0a0c10;font-weight:700;font-size:12px;white-space:nowrap">Invia</button>' +
            '</div>' +
        '</div>' +
    '</div>';

    document.addEventListener('DOMContentLoaded', function() {
        var wrapper = document.createElement('div');
        wrapper.innerHTML = fabHtml + widgetHtml;
        document.body.appendChild(wrapper);

        // Restore chat
        try {
            var saved = JSON.parse(localStorage.getItem('td_chat'));
            if (saved && saved.date === new Date().toISOString().split('T')[0]) {
                chatHistory = saved.history || [];
                if (saved.widgetHtml) {
                    document.getElementById('ai-chat-msgs').innerHTML = saved.widgetHtml;
                }
            }
        } catch(e) {}
    });

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
        chatHistory = [];
        localStorage.removeItem('td_chat');
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
        container.innerHTML += '<div class="ai-msg-user" style="border-radius:8px;padding:10px 12px;margin-left:auto;max-width:85%"><div style="font-size:12px;color:rgba(248,250,252,0.9);line-height:1.5">' + aiEscape(msg) + '</div></div>';

        input.value = '';
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
                container.innerHTML += '<div class="ai-msg-ai" style="border-radius:8px;padding:10px 12px"><div style="display:flex;gap:8px;align-items:flex-start"><div style="background:rgba(139,92,246,0.1);padding:4px;border-radius:6px;flex-shrink:0"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#a78bfa" stroke-width="2"><path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/></svg></div><div style="font-size:12px;color:rgba(248,250,252,0.9);line-height:1.5;white-space:pre-wrap">' + aiFormat(data.reply) + '</div></div></div>';
                chatHistory.push({ role: 'user', content: msg });
                chatHistory.push({ role: 'assistant', content: data.reply });
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

        // Salva
        localStorage.setItem('td_chat', JSON.stringify({
            date: new Date().toISOString().split('T')[0],
            history: chatHistory,
            widgetHtml: container.innerHTML
        }));
    };
})();
