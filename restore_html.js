const fs = require('fs');
let html = fs.readFileSync('dettaglio_sessione.html', 'utf8');

const brokenSection = `<div class="ml-auto hidden md:flex items-center gap-4">
                    
                    </div>

                    <!-- Contenitori Tab (Le Finestre Specifiche) -->`;

const restoredSection = `<div class="ml-auto hidden md:flex items-center gap-4">
                    <button class="bg-[#161920] border border-tp-border hover:border-tp-accent text-tp-text hover:text-tp-accent px-4 py-2 rounded-lg text-xs font-bold uppercase transition-colors tracking-widest shadow-sm">
                        <i data-lucide="save" class="inline w-3 h-3 mb-0.5 mr-1 text-tp-muted"></i> Salva Updates
                    </button>
                </div>
            </div>
        </header>

        <!-- CONTENT -->
        <div class="flex-1 overflow-y-auto p-6 md:p-10 scroll-smooth custom-scroll">
            <div class="max-w-6xl mx-auto flex flex-col gap-8 pb-20">
                
                <!-- BREADCRUMB / MEGA TITOLO SESSIONE -->
                <div class="flex flex-col md:flex-row md:items-center justify-between gap-6 border-b border-tp-border pb-6">
                    <div class="flex items-center gap-5">
                        <div class="w-16 h-16 rounded-2xl bg-gradient-to-br from-[#20c997]/20 to-[#0a0c10] border border-[#20c997]/40 flex items-center justify-center shrink-0 shadow-[0_0_20px_rgba(32,201,151,0.15)] relative overflow-hidden group">
                            <i data-lucide="sun" class="w-8 h-8 text-[#20c997] group-hover:scale-110 transition-transform"></i>
                            <div class="absolute inset-0 bg-[#20c997] opacity-0 group-hover:opacity-10 transition-opacity"></div>
                        </div>
                        <div class="flex flex-col">
                            <h1 class="text-4xl font-black font-display tracking-tight text-white flex items-center gap-3">ASIA SESSION</h1>
                            <div class="flex items-center gap-3 text-xs text-tp-muted font-bold tracking-widest uppercase mt-2">
                                <span class="bg-[#161920] px-2 py-0.5 rounded border border-tp-border whitespace-nowrap">02/04/2026</span>
                                <span><i data-lucide="clock" class="inline w-3 h-3 mb-0.5 text-[#20c997]"></i> 00:00 - 08:00</span>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- TABS DELLE COIN PER MULTI-ANALISI -->
                <div>
                    <!-- Menu Tabs -->
                    <div class="flex gap-2 border-b border-tp-border/50 pb-0 overflow-x-auto custom-scroll">
                        <button onclick="changeTab('xauusd')" id="tab-xauusd" class="asset-tab bg-[#0a0c10] text-tp-accent border border-[#20c997] border-b-transparent rounded-t-lg px-6 py-3 text-xs font-bold uppercase tracking-widest min-w-[120px] transition-colors relative">
                            XAUUSD
                            <div class="absolute bottom-0 left-0 right-0 h-[2px] bg-tp-bg bg-[#20c997] transform translate-y-[1px]"></div>
                        </button>
                        <button onclick="changeTab('eurusd')" id="tab-eurusd" class="asset-tab text-tp-muted hover:text-white bg-[#050608] border border-transparent border-b-transparent hover:border-tp-border hover:bg-[#0a0c10] rounded-t-lg px-6 py-3 text-xs font-bold uppercase tracking-widest min-w-[120px] transition-colors">EURUSD</button>
                        <button onclick="changeTab('us30')" id="tab-us30" class="asset-tab text-tp-muted hover:text-white bg-[#050608] border border-transparent border-b-transparent hover:border-tp-border hover:bg-[#0a0c10] rounded-t-lg px-6 py-3 text-xs font-bold uppercase tracking-widest min-w-[120px] transition-colors">US30</button>
                    </div>

                    <!-- Contenitori Tab (Le Finestre Specifiche) -->`;

if (html.includes(brokenSection)) {
    html = html.replace(brokenSection, restoredSection);
    fs.writeFileSync('dettaglio_sessione.html', html, 'utf8');
    console.log("Restoration successful!");
} else {
    console.log("Could not find broken section to restore. Check regex.");
}
