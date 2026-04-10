import os
import re

html_dir = r"C:\Users\Adil\.gemini\antigravity\scratch\trade-desk"

sidebar_html = """    <!-- Sidebar Universale -->
    <aside class="w-16 hover:w-64 border-r border-tp-border flex flex-col flex-shrink-0 bg-tp-bg transition-all duration-300 z-50 absolute h-full lg:relative group">
        <!-- Logo Area Team Design -->
        <div class="h-24 flex items-center justify-center lg:justify-start px-3 gap-4 border-b border-tp-border/50 overflow-hidden cursor-default w-full">
            <div class="w-10 h-10 rounded-xl bg-gradient-to-br from-[#161920] to-[#0a0c10] border border-[#20c997]/50 flex items-center justify-center shadow-[0_0_10px_rgba(32,201,151,0.2)] shrink-0 group-hover:rotate-3 transition-transform duration-300 mx-auto group-hover:mx-0">
                <span class="text-lg font-black text-transparent bg-clip-text bg-gradient-to-r from-[#20c997] to-white tracking-tighter">TD</span>
            </div>
            <span class="text-xl font-extrabold tracking-tighter uppercase font-display select-none opacity-0 group-hover:opacity-100 whitespace-nowrap transition-opacity duration-300">Trade<span class="text-[#20c997] ml-1">Desk</span></span>
        </div>
        
        <!-- Navigation Links Universali -->
        <nav class="flex-1 overflow-x-hidden overflow-y-auto py-6 space-y-2 flex flex-col w-full group">
            <a href="index.html" class="flex items-center gap-4 px-0 lg:px-4 py-3 rounded-lg text-[#848d97] hover:bg-[#161920] hover:text-white transition-colors w-12 group-hover:w-[calc(100%-2rem)] mx-auto relative overflow-hidden flex-shrink-0">
                <div class="w-12 h-full absolute left-0 flex items-center justify-center z-10"><i data-lucide="layout-dashboard" class="w-5 h-5 shrink-0"></i></div>
                <span class="opacity-0 group-hover:opacity-100 font-bold text-xs uppercase tracking-widest whitespace-nowrap transition-opacity duration-300 absolute left-14">Dashboard</span>
            </a>
            
            <a href="giornaliero.html" class="flex items-center gap-4 px-0 lg:px-4 py-3 rounded-lg text-[#848d97] hover:bg-[#161920] hover:text-white transition-colors w-12 group-hover:w-[calc(100%-2rem)] mx-auto relative overflow-hidden flex-shrink-0">
                <div class="w-12 h-full absolute left-0 flex items-center justify-center z-10"><i data-lucide="calendar" class="w-5 h-5 shrink-0"></i></div>
                <span class="opacity-0 group-hover:opacity-100 font-bold text-xs uppercase tracking-widest whitespace-nowrap transition-opacity duration-300 absolute left-14">Giornaliero</span>
            </a>
            
            <a href="tabella_trades.html" class="flex items-center gap-4 px-0 lg:px-4 py-3 rounded-lg text-[#848d97] hover:bg-[#161920] hover:text-white transition-colors w-12 group-hover:w-[calc(100%-2rem)] mx-auto relative overflow-hidden flex-shrink-0">
                <div class="w-12 h-full absolute left-0 flex items-center justify-center z-10"><i data-lucide="crosshair" class="w-5 h-5 shrink-0"></i></div>
                <span class="opacity-0 group-hover:opacity-100 font-bold text-xs uppercase tracking-widest whitespace-nowrap transition-opacity duration-300 absolute left-14">Tab Trade</span>
            </a>

            <a href="sessioni.html" class="flex items-center gap-4 px-0 lg:px-4 py-3 rounded-lg text-[#848d97] hover:bg-[#161920] hover:text-white transition-colors w-12 group-hover:w-[calc(100%-2rem)] mx-auto relative overflow-hidden flex-shrink-0">
                <div class="w-12 h-full absolute left-0 flex items-center justify-center z-10"><i data-lucide="sun" class="w-5 h-5 shrink-0"></i></div>
                <span class="opacity-0 group-hover:opacity-100 font-bold text-xs uppercase tracking-widest whitespace-nowrap transition-opacity duration-300 absolute left-14">Sessioni</span>
            </a>
            
            <a href="analisi.html" class="flex items-center gap-4 px-0 lg:px-4 py-3 rounded-lg text-[#848d97] hover:bg-[#161920] hover:text-white transition-colors w-12 group-hover:w-[calc(100%-2rem)] mx-auto relative overflow-hidden flex-shrink-0">
                <div class="w-12 h-full absolute left-0 flex items-center justify-center z-10"><i data-lucide="bar-chart-2" class="w-5 h-5 shrink-0"></i></div>
                <span class="opacity-0 group-hover:opacity-100 font-bold text-xs uppercase tracking-widest whitespace-nowrap transition-opacity duration-300 absolute left-14">Grafici Area</span>
            </a>
            
            <div class="w-8 group-hover:w-[calc(100%-3rem)] border-t border-[#252932]/50 my-2 mx-auto transition-all duration-300"></div>
            
            <a href="allert.html" class="flex items-center gap-4 px-0 lg:px-4 py-3 rounded-lg text-[#848d97] hover:bg-[#161920] hover:text-white transition-colors w-12 group-hover:w-[calc(100%-2rem)] mx-auto relative overflow-hidden flex-shrink-0">
                <div class="w-12 h-full absolute left-0 flex items-center justify-center z-10"><i data-lucide="bell" class="w-5 h-5 shrink-0"></i></div>
                <span class="opacity-0 group-hover:opacity-100 font-bold text-xs uppercase tracking-widest whitespace-nowrap transition-opacity duration-300 absolute left-14">Eventi</span>
            </a>

            <a href="strategie.html" class="flex items-center gap-4 px-0 lg:px-4 py-3 rounded-lg text-[#848d97] hover:bg-[#161920] hover:text-white transition-colors w-12 group-hover:w-[calc(100%-2rem)] mx-auto relative overflow-hidden flex-shrink-0">
                <div class="w-12 h-full absolute left-0 flex items-center justify-center z-10"><i data-lucide="target" class="w-5 h-5 shrink-0"></i></div>
                <span class="opacity-0 group-hover:opacity-100 font-bold text-xs uppercase tracking-widest whitespace-nowrap transition-opacity duration-300 absolute left-14">Strategie</span>
            </a>

            <a href="cronache.html" class="flex items-center gap-4 px-0 lg:px-4 py-3 rounded-lg text-[#848d97] hover:bg-[#161920] hover:text-white transition-colors w-12 group-hover:w-[calc(100%-2rem)] mx-auto relative overflow-hidden flex-shrink-0">
                <div class="w-12 h-full absolute left-0 flex items-center justify-center z-10"><i data-lucide="book-open" class="w-5 h-5 shrink-0"></i></div>
                <span class="opacity-0 group-hover:opacity-100 font-bold text-xs uppercase tracking-widest whitespace-nowrap transition-opacity duration-300 absolute left-14">Cronache</span>
            </a>
            
            <a href="settimanale.html" class="flex items-center gap-4 px-0 lg:px-4 py-3 rounded-lg text-[#848d97] hover:bg-[#161920] hover:text-white transition-colors w-12 group-hover:w-[calc(100%-2rem)] mx-auto relative overflow-hidden flex-shrink-0">
                <div class="w-12 h-full absolute left-0 flex items-center justify-center z-10"><i data-lucide="calendar-days" class="w-5 h-5 shrink-0"></i></div>
                <span class="opacity-0 group-hover:opacity-100 font-bold text-xs uppercase tracking-widest whitespace-nowrap transition-opacity duration-300 absolute left-14">Weekly</span>
            </a>
            
            <div class="w-8 group-hover:w-[calc(100%-3rem)] border-t border-[#252932]/50 my-2 mx-auto transition-all duration-300"></div>

            <a href="impostazioni.html" class="flex items-center gap-4 px-0 lg:px-4 py-3 rounded-lg text-[#848d97] hover:bg-[#161920] hover:text-white transition-colors w-12 group-hover:w-[calc(100%-2rem)] mx-auto relative overflow-hidden flex-shrink-0">
                <div class="w-12 h-full absolute left-0 flex items-center justify-center z-10"><i data-lucide="settings" class="w-5 h-5 shrink-0"></i></div>
                <span class="opacity-0 group-hover:opacity-100 font-bold text-xs uppercase tracking-widest whitespace-nowrap transition-opacity duration-300 absolute left-14">Impostazioni</span>
            </a>
        </nav>
    </aside>"""

# Read all HTML files
for file_name in os.listdir(html_dir):
    if file_name.endswith('.html'):
        file_path = os.path.join(html_dir, file_name)
        with open(file_path, 'r', encoding='utf-8') as f:
            content = f.read()

        # Clean regex to find <aside> block replacing everything
        # Some asides had comments like <!-- Sidebar --> before them, but we'll regex just <aside>...</aside>
        
        # Regex search for <aside ...> until </aside>
        new_content = re.sub(r'<aside.*?</aside>', sidebar_html, content, flags=re.DOTALL)
        
        if new_content != content:
            with open(file_path, 'w', encoding='utf-8') as f:
                f.write(new_content)
            print(f"Updated {file_name}")
        else:
            print(f"Failed to find or change <aside> in {file_name}")
