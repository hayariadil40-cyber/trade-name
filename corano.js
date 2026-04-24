// ============================================
// CORANO WIDGET - alquran.cloud API
// Arabo (quran-uthmani) + Italiano (Piccardo)
// Cache 24h in localStorage per evitare chiamate ripetute
// ============================================

const CORANO_CONFIG_KEY = 'td_corano_config';
const CORANO_CACHE_PREFIX = 'td_corano_cache_';
const CORANO_CACHE_MS = 24 * 60 * 60 * 1000; // 24h
const CORANO_DEFAULT = { sura: 18, ayah_da: 1, ayah_a: 4 };

function _escapeCoranoHtml(s) {
    return (s || '').replace(/[<>&"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]));
}

async function _fetchCoranoSurah(sura) {
    const cacheKey = CORANO_CACHE_PREFIX + sura;
    try {
        const cached = JSON.parse(localStorage.getItem(cacheKey) || 'null');
        if (cached && cached.ts && (Date.now() - cached.ts) < CORANO_CACHE_MS) {
            return cached.data;
        }
    } catch(e) {}

    const res = await fetch('https://api.alquran.cloud/v1/surah/' + sura + '/editions/quran-uthmani,it.piccardo');
    const json = await res.json();
    if (json.code !== 200 || !Array.isArray(json.data) || json.data.length < 2) {
        throw new Error('alquran.cloud risposta non valida');
    }
    localStorage.setItem(cacheKey, JSON.stringify({ ts: Date.now(), data: json.data }));
    return json.data;
}

async function loadCoranoWidget(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    let config = CORANO_DEFAULT;
    try {
        const saved = await (typeof getSetting === 'function'
            ? getSetting(CORANO_CONFIG_KEY, CORANO_DEFAULT)
            : Promise.resolve(JSON.parse(localStorage.getItem(CORANO_CONFIG_KEY) || 'null') || CORANO_DEFAULT));
        if (saved && saved.sura) config = saved;
    } catch(e) { console.warn('corano config:', e); }

    try {
        const data = await _fetchCoranoSurah(config.sura);
        const arabic = data[0];
        const italian = data[1];
        const from = Math.max(1, parseInt(config.ayah_da) || 1);
        const to = Math.min(arabic.numberOfAyahs, parseInt(config.ayah_a) || from);

        // Flusso continuo arabo: tutti i versetti concatenati, separati solo dal numero calligrafico ﴿n﴾
        const parts = [];
        for (let i = from; i <= to; i++) {
            const a = arabic.ayahs[i - 1];
            if (!a) continue;
            parts.push(_escapeCoranoHtml(a.text) + ' <span class="text-tp-accent">﴿' + a.numberInSurah + '﴾</span>');
        }

        container.innerHTML =
            '<div class="flex items-center justify-between mb-3 pb-2 border-b border-tp-border/40">' +
                '<div class="flex items-center gap-2">' +
                    '<i data-lucide="book-open-text" class="w-4 h-4 text-tp-accent"></i>' +
                    '<h3 class="text-xs font-bold uppercase tracking-widest text-tp-muted">Sura ' + arabic.number + ' - ' + _escapeCoranoHtml(arabic.englishName) + ' &middot; Versetti ' + from + '-' + to + '</h3>' +
                '</div>' +
                '<span class="text-[11px] text-tp-accent/80" dir="rtl" style="font-family: \'Amiri\', serif;">' + _escapeCoranoHtml(arabic.name) + '</span>' +
            '</div>' +
            '<p dir="rtl" class="text-tp-text/95" style="font-family: \'Amiri\', \'Noto Naskh Arabic\', \'Traditional Arabic\', serif; font-size: 1.75rem; line-height: 2.1;">' +
                parts.join(' ') +
            '</p>';

        if (typeof lucide !== 'undefined') lucide.createIcons({ root: container });
    } catch (err) {
        console.warn('Corano widget error:', err);
        container.innerHTML =
            '<div class="flex items-center gap-2 text-xs text-tp-muted italic">' +
                '<i data-lucide="book-open-text" class="w-4 h-4"></i>' +
                'Corano non caricato: ' + _escapeCoranoHtml(err.message || 'errore di rete') +
            '</div>';
        if (typeof lucide !== 'undefined') lucide.createIcons({ root: container });
    }
}

window.loadCoranoWidget = loadCoranoWidget;
