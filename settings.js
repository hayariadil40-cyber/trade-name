// ============================================
// SETTINGS MANAGER - Supabase + localStorage fallback
// Legge/scrive su user_settings in Supabase
// ============================================

async function getSetting(chiave, defaultValue) {
    // Prima prova Supabase
    if (typeof db !== 'undefined' && db) {
        try {
            var result = await db.from('user_settings').select('valore').eq('chiave', chiave).single();
            if (result.data && result.data.valore !== null) {
                // Aggiorna anche localStorage come cache
                localStorage.setItem(chiave, JSON.stringify(result.data.valore));
                return result.data.valore;
            }
        } catch(e) {}
    }
    // Fallback localStorage
    try {
        var raw = localStorage.getItem(chiave);
        if (raw) return JSON.parse(raw);
    } catch(e) {}
    return defaultValue;
}

async function saveSetting(chiave, valore) {
    // Salva in localStorage come cache
    localStorage.setItem(chiave, JSON.stringify(valore));
    // Salva su Supabase
    if (typeof db !== 'undefined' && db) {
        try {
            await db.from('user_settings').upsert(
                { chiave: chiave, valore: valore, updated_at: new Date().toISOString() },
                { onConflict: 'chiave' }
            );
        } catch(e) { console.warn('saveSetting error:', e); }
    }
}
