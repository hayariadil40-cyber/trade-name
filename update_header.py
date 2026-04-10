import os
import re

html_dir = r"C:\Users\Adil\.gemini\antigravity\scratch\trade-desk"

header_template = """        <!-- ==============================================
             HEADER UNIVERSALE
             ============================================== -->
        <header class="flex justify-between items-center px-8 py-5 border-b border-tp-border bg-tp-panel shadow-md z-10 flex-shrink-0 w-full relative">
            
            <!-- 1. LEFT: Page Title & Quick Actions -->
            <div class="flex items-center gap-4 w-auto min-w-max">
                <div>
                    <h1 class="text-xl font-bold tracking-tight text-white mb-1" id="page-global-title">{TITLE}</h1>
                    <div class="flex gap-2 mt-1">
                        <a href="analisi.html" class="flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded bg-tp-accent/10 border border-tp-accent text-tp-accent hover:bg-tp-accent hover:text-[#0a0c10] transition-colors"><i data-lucide="bar-chart-2" class="w-3 h-3"></i> Analisi</a>
                        <a href="tabella_trades.html" class="flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded bg-tp-bg text-tp-muted border border-tp-border hover:text-white transition-colors"><i data-lucide="crosshair" class="w-3 h-3"></i> Tab Trades</a>
                    </div>
                </div>
            </div>

            <!-- 2. CENTER: Timeline (Cronoprogramma) -->
            <div class="hidden lg:flex items-center flex-1 max-w-3xl mx-8 gap-6">
                <!-- Digital Clock & TFs -->
                <div class="flex flex-col items-center justify-center shrink-0">
                    <span id="digital-clock" class="text-xl font-display font-bold text-white tracking-widest tabular-nums leading-none">00:00:00</span>
                    <div class="flex gap-1 mt-1.5">
                        <span id="tf-5m" class="px-1.5 py-0.5 text-[9px] font-bold bg-tp-panel rounded text-tp-muted transition-colors">5m</span>
                        <span id="tf-15m" class="px-1.5 py-0.5 text-[9px] font-bold bg-tp-panel rounded text-tp-muted transition-colors">15m</span>
                        <span id="tf-30m" class="px-1.5 py-0.5 text-[9px] font-bold bg-tp-panel rounded text-tp-muted transition-colors">30m</span>
                        <span id="tf-1h" class="px-1.5 py-0.5 text-[9px] font-bold bg-tp-panel rounded text-tp-muted transition-colors">1h</span>
                        <span id="tf-4h" class="px-1.5 py-0.5 text-[9px] font-bold bg-tp-panel rounded text-tp-muted transition-colors">4h</span>
                    </div>
                </div>

                <!-- Timeline Container -->
                <div class="flex-col flex-1 relative w-full">
                    <div class="flex justify-between text-[10px] font-bold uppercase tracking-widest text-tp-muted mb-2 px-2">
                        <span>Asia (00-09)</span>
                        <span class="text-tp-text">London (09-11)</span>
                        <span>Sport (11-12)</span>
                        <span>New York (14-17)</span>
                        <span>End</span>
                    </div>
                    <!-- Track Base -->
                    <div class="h-2 w-full bg-tp-bg rounded-full border border-tp-border/50 relative">
                        <!-- Progress Fill -->
                        <div id="timeline-progress" class="absolute left-0 top-0 bottom-0 bg-tp-accent/50 rounded-full" style="width: 45%;"></div>
                        <!-- Time Cursor Dot -->
                        <div id="timeline-dot" class="timeline-cursor absolute top-1/2 -ml-2 -mt-2 w-4 h-4 bg-tp-accent rounded-full border-[3px] border-[#0e1116]" style="left: 45%;"></div>
                        <!-- Mock Markers -->
                        <div class="absolute left-[30%] top-0 bottom-0 w-px bg-tp-border"></div>
                        <div class="absolute left-[40%] top-0 bottom-0 w-px bg-tp-border"></div>
                        <div class="absolute left-[45%] top-0 bottom-0 w-px bg-tp-border"></div>
                        <div class="absolute left-[65%] top-0 bottom-0 w-px bg-tp-border"></div>
                    </div>
                </div>
            </div>

            <!-- 3. RIGHT: Indicators + Win Rate -->
            <div class="flex items-center gap-6 w-auto shrink-0 justify-end">
                <div class="hidden xl:flex items-center gap-5 bg-[#0a0c10] border border-tp-border/50 px-5 py-3 rounded-xl shadow-inner h-16">
                    <div class="flex flex-col items-center gap-1 group relative w-10">
                        <i id="mindset-icon-wrapper" data-lucide="smile" class="w-6 h-6 text-tp-accent"></i>
                    </div>
                    <div class="w-px h-8 bg-tp-border/50"></div>
                    <div class="flex flex-col items-center gap-1 group relative w-10">
                        <i id="market-icon-wrapper" data-lucide="meh" class="w-6 h-6 text-tp-warning"></i>
                    </div>
                    <div class="w-px h-8 bg-tp-border/50"></div>
                    <div class="flex flex-col items-center gap-1 group relative w-10">
                        <i id="volatility-icon-wrapper" data-lucide="dollar-sign" class="w-6 h-6 text-tp-loss drop-shadow-[0_0_8px_rgba(244,63,94,0.6)]"></i>
                    </div>
                </div>
                <!-- Mini Gauge -->
                <div class="flex items-center gap-3 text-right">
                    <div class="flex flex-col">
                        <span class="text-[10px] text-tp-muted font-bold uppercase tracking-widest">Win Rate</span>
                        <span class="text-xl font-bold text-tp-accent drop-shadow-[0_0_3px_rgba(32,201,151,0.5)]">67%</span>
                    </div>
                    <div class="w-10 h-10 rounded-full border-[4px] border-tp-border border-t-tp-accent border-r-tp-accent flex items-center justify-center transform -rotate-45"></div>
                </div>
            </div>
        </header>"""

for file_name in os.listdir(html_dir):
    if not file_name.endswith('.html') or file_name == 'sidebar_source.html':
        continue
        
    file_path = os.path.join(html_dir, file_name)
    with open(file_path, 'r', encoding='utf-8') as f:
        content = f.read()

    # Find the header block
    header_match = re.search(r'<header.*?</header>', content, flags=re.DOTALL)
    
    if header_match:
        old_header = header_match.group(0)
        
        # Try to extract the title from an <h1> tag
        h1_match = re.search(r'<h1[^>]*>(.*?)</h1>', old_header, flags=re.DOTALL)
        if h1_match:
            # Clean up the title in case it has nested tags (like spans) or newlines
            title = re.sub(r'<[^>]+>', '', h1_match.group(1)).strip().replace('\n', ' ')
        else:
            # Fallback title based on filename
            title = file_name.replace('.html', '').replace('_', ' ').title()
            
        new_header = header_template.replace('{TITLE}', title)
        new_content = content[:header_match.start()] + new_header + content[header_match.end():]
        
        with open(file_path, 'w', encoding='utf-8') as f:
            f.write(new_content)
        print(f"Updated header in {file_name} with title: '{title}'")
    else:
        print(f"No <header> found in {file_name}")

