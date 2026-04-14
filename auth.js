// ============================================
// AUTH CHECK - Includi in ogni pagina per proteggere
// Aggiungere: <script src="auth.js"></script> dopo supabase-config.js
// ============================================

(async function() {
    // Skip se siamo nella pagina login
    if (window.location.pathname.includes('login.html')) return;

    // Aspetta che db sia disponibile
    if (typeof db === 'undefined' || !db) return;

    try {
        var { data } = await db.auth.getSession();
        if (!data.session) {
            window.location.href = 'login.html';
        }
    } catch(e) {
        window.location.href = 'login.html';
    }
})();
