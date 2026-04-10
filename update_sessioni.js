const fs = require('fs');

const html = fs.readFileSync('sessioni.html', 'utf8');

const newGrid = `<div id="session-grid" class="flex flex-col gap-3">
                    
    <!-- Table Header (Optional but good for rows) -->
    <div class="hidden md:flex items-center px-4 py-2 text-[10px] font-bold text-tp-muted uppercase tracking-widest border-b border-tp-border/50 sticky top-0 bg-[#0e1116] z-10">
        <div class="w-1/4">Data Sessione</div>
        <div class="w-[15%]">Asset Coin</div>
        <div class="w-1/4">VolatilitÃ  / Range</div>
        <div class="w-[15%]">Bias Result</div>
        <div class="w-1/4 text-right">Azione</div>
    </div>

    <!-- Row Asia -->
    <div class="session-card transition-all" data-session="asia">
        <div onclick="window.location.href='dettaglio_sessione.html'" class="bg-tp-panel hover:bg-tp-panelHover border border-tp-border hover:border-[#20c997] rounded-xl p-4 transition-all cursor-pointer group flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-sm relative overflow-hidden">
            <div class="absolute w-1 bg-[#20c997] left-0 top-0 bottom-0 opacity-80"></div>
            
            <div class="flex items-center gap-4 w-1/4 pl-2">
                <div class="w-10 h-10 rounded-lg bg-tp-bg flex items-center justify-center border border-[#20c997]/20 text-[#20c997] shrink-0">
                    <i data-lucide="sun" class="w-5 h-5"></i>
                </div>
                <div class="flex flex-col">
                    <span class="text-sm font-bold text-white group-hover:text-[#20c997] transition-colors">Asia Session</span>
                    <span class="text-[10px] text-tp-muted font-black tracking-widest">02 APRILE 2026</span>
                </div>
            </div>

            <div class="w-[15%] flex items-center gap-2">
                <span class="text-xs font-bold text-tp-text">XAUUSD</span>
                <span class="text-[9px] bg-tp-border/50 px-1.5 py-0.5 rounded text-tp-muted">+2</span>
            </div>

            <div class="flex items-center gap-4 w-1/4">
                <div class="flex flex-col">
                    <span class="text-[10px] font-bold text-tp-muted uppercase">Range: <span class="text-white">65 Pips</span></span>
                    <div class="flex mt-1 text-tp-muted gap-0.5">
                        <i data-lucide="dollar-sign" class="w-3.5 h-3.5 text-tp-muted"></i>
                    </div>
                </div>
            </div>

            <div class="w-[15%]">
                <span class="bg-[#20c997]/10 text-[#20c997] border border-[#20c997]/30 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider">LONG</span>
            </div>

            <div class="w-1/4 flex justify-end items-center gap-4 border-t md:border-none border-tp-border pt-3 md:pt-0">
                <i data-lucide="smile" class="w-5 h-5 text-[#20c997] drop-shadow-[0_0_5px_rgba(32,201,151,0.5)]"></i>
                <button class="bg-tp-border/50 hover:bg-[#20c997]/20 text-tp-text hover:text-[#20c997] px-3 py-1.5 rounded-lg text-xs font-bold transition-colors">Dettagli</button>
            </div>
        </div>
    </div>

    <!-- Row London -->
    <div class="session-card transition-all" data-session="london">
        <div onclick="window.location.href='dettaglio_sessione.html'" class="bg-tp-panel hover:bg-tp-panelHover border border-tp-border hover:border-purple-500/50 rounded-xl p-4 transition-all cursor-pointer group flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-sm relative overflow-hidden">
            <div class="absolute w-1 bg-purple-500 left-0 top-0 bottom-0 opacity-80"></div>
            
            <div class="flex items-center gap-4 w-1/4 pl-2">
                <div class="w-10 h-10 rounded-lg bg-tp-bg flex items-center justify-center border border-purple-500/20 text-purple-400 shrink-0">
                    <i data-lucide="cloud-rain" class="w-5 h-5"></i>
                </div>
                <div class="flex flex-col">
                    <span class="text-sm font-bold text-white group-hover:text-purple-400 transition-colors">London Session</span>
                    <span class="text-[10px] text-tp-muted font-black tracking-widest">02 APRILE 2026</span>
                </div>
            </div>

            <div class="w-[15%] flex items-center gap-2">
                <span class="text-xs font-bold text-tp-text">EURUSD</span>
            </div>

            <div class="flex items-center gap-4 w-1/4">
                <div class="flex flex-col">
                    <span class="text-[10px] font-bold text-tp-muted uppercase">Range: <span class="text-white">120 Pips</span></span>
                    <div class="flex mt-1 text-tp-muted gap-0.5">
                        <i data-lucide="dollar-sign" class="w-3.5 h-3.5 text-purple-400"></i>
                        <i data-lucide="dollar-sign" class="w-3.5 h-3.5 text-purple-400 -ml-1"></i>
                        <i data-lucide="dollar-sign" class="w-3.5 h-3.5 text-purple-400 -ml-1"></i>
                    </div>
                </div>
            </div>

            <div class="w-[15%]">
                <span class="bg-[#20c997]/10 text-[#20c997] border border-[#20c997]/30 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider">LONG</span>
            </div>

            <div class="w-1/4 flex justify-end items-center gap-4 border-t md:border-none border-tp-border pt-3 md:pt-0">
                <i data-lucide="smile" class="w-5 h-5 text-[#20c997]"></i>
                <button class="bg-tp-border/50 hover:bg-purple-500/20 text-tp-text hover:text-purple-400 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors">Dettagli</button>
            </div>
        </div>
    </div>

    <!-- Row NY -->
    <div class="session-card transition-all" data-session="ny">
        <div onclick="window.location.href='dettaglio_sessione.html'" class="bg-tp-panel hover:bg-tp-panelHover border border-tp-border hover:border-tp-loss/50 rounded-xl p-4 transition-all cursor-pointer group flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-sm relative overflow-hidden">
            <div class="absolute w-1 bg-tp-loss left-0 top-0 bottom-0 opacity-80"></div>
            
            <div class="flex items-center gap-4 w-1/4 pl-2">
                <div class="w-10 h-10 rounded-lg bg-tp-bg flex items-center justify-center border border-tp-loss/20 text-tp-loss shrink-0">
                    <i data-lucide="tower-control" class="w-5 h-5"></i>
                </div>
                <div class="flex flex-col">
                    <span class="text-sm font-bold text-white group-hover:text-tp-loss transition-colors">New York Session</span>
                    <span class="text-[10px] text-tp-muted font-black tracking-widest">02 APRILE 2026</span>
                </div>
            </div>

            <div class="w-[15%] flex items-center gap-2">
                <span class="text-xs font-bold text-tp-text">US30</span>
                <span class="text-[9px] bg-tp-border/50 px-1.5 py-0.5 rounded text-tp-muted">+1</span>
            </div>

            <div class="flex items-center gap-4 w-1/4">
                <div class="flex flex-col">
                    <span class="text-[10px] font-bold text-tp-muted uppercase">Range: <span class="text-white">450 Pips</span></span>
                    <div class="flex mt-1 text-tp-muted gap-0.5">
                        <i data-lucide="dollar-sign" class="w-3.5 h-3.5 text-[#eab308]"></i>
                        <i data-lucide="dollar-sign" class="w-3.5 h-3.5 text-[#eab308] -ml-1"></i>
                    </div>
                </div>
            </div>

            <div class="w-[15%]">
                <span class="bg-tp-loss/10 text-tp-loss border border-tp-loss/30 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider">SHORT</span>
            </div>

            <div class="w-1/4 flex justify-end items-center gap-4 border-t md:border-none border-tp-border pt-3 md:pt-0">
                <i data-lucide="frown" class="w-5 h-5 text-tp-loss"></i>
                <button class="bg-tp-border/50 hover:bg-tp-loss/20 text-tp-text hover:text-tp-loss px-3 py-1.5 rounded-lg text-xs font-bold transition-colors">Dettagli</button>
            </div>
        </div>
    </div>

</div>`;

let newHtml = html.replace(/<div id="session-grid"[\s\S]*?<!-- REPLICA ALTRI GIORNI\.\.\. -->[\s\S]*?<\/div>\s*<\/div>/, newGrid);

fs.writeFileSync('sessioni.html', newHtml, 'utf8');
console.log("Updated sessioni.html");
