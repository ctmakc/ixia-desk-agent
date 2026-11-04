#!/usr/bin/env python3
"""Records the demo clips from the live desk (https://desk.ixia.online) with Playwright.
Each clip is a webm plus a JSON of marks: seconds from the clip start at which the page showed
something (run started, sandbox up, each refusal, approval card, result). build.py cuts by these marks.
Usage: python3 video/record.py [intro plain redteam]   (env DESK to point elsewhere)"""
import json, os, sys, time, pathlib
from playwright.sync_api import sync_playwright

HERE = pathlib.Path(__file__).resolve().parent
OUT = pathlib.Path(os.environ.get('VIDEO_OUT', HERE / 'out')); (OUT / 'rec').mkdir(parents=True, exist_ok=True)
DESK = os.environ.get('DESK', 'https://desk.ixia.online')
W, H = 1920, 1080

# Recording layout only: the timeline scrolls inside a box under the sandbox and follows the newest row,
# so the sandbox panel and the latest events share one screen. The page itself is unchanged.
REC_CSS = """
html{zoom:.92}
ol.tl{max-height:300px;overflow:auto;scroll-behavior:smooth}
#message{min-height:250px}
"""
WATCH_JS = """
(() => {
  window.__marks = [];
  const t0 = performance.now();
  const mark = (k, extra) => window.__marks.push({ k, s: (performance.now() - t0) / 1000, ...(extra || {}) });
  window.__mark = mark;
  const tl = document.getElementById('tl');
  new MutationObserver((ms) => {
    for (const m of ms) for (const n of m.addedNodes) {
      if (n.nodeType !== 1) continue;
      const kind = n.querySelector('.k')?.textContent || '', msg = n.querySelector('.m')?.textContent || '';
      mark('row', { kind, msg: msg.slice(0, 140) });
    }
    tl.scrollTop = tl.scrollHeight;
  }).observe(tl, { childList: true });
  const ap = document.getElementById('approval');
  new MutationObserver(() => { if (ap.classList.contains('show')) mark('approval_card'); }).observe(ap, { attributes: true });
  const res = document.getElementById('result');
  new MutationObserver(() => { if (res.className.includes('show')) mark('result'); }).observe(res, { attributes: true });
})();
"""

def clip(name, fn):
    with sync_playwright() as p:
        b = p.chromium.launch()
        c = b.new_context(viewport={'width': W, 'height': H}, record_video_dir=str(OUT / 'rec' / name), record_video_size={'width': W, 'height': H})
        pg = c.new_page(); v0 = time.time()   # the page's video starts with the page
        pg.goto(DESK + '/', wait_until='load'); pg.add_style_tag(content=REC_CSS); pg.evaluate(WATCH_JS)
        offset = time.time() - v0             # marks are counted from here; add this to get video time
        pg.evaluate("window.__mark('page_ready')")
        info = fn(pg) or {}
        marks = pg.evaluate('window.__marks')
        c.close(); b.close()
    d = OUT / 'rec' / name
    vids = [f for f in os.listdir(d) if f.endswith('.webm')]
    os.replace(d / vids[0], OUT / 'rec' / f'{name}.webm')
    json.dump({'offset': round(offset, 3), 'marks': marks, **info}, open(OUT / 'rec' / f'{name}.json', 'w'), indent=1, ensure_ascii=False)
    print('recorded', name, len(marks), 'marks', info)

def run_sample(pg, n, show_text_ms=0):
    pg.click(f'#samples li:nth-child({n}) button'); pg.wait_for_timeout(700)
    if show_text_ms:
        pg.evaluate("window.__mark('text_shown')")
        pg.evaluate("document.getElementById('message').scrollTop = 0"); pg.wait_for_timeout(show_text_ms)
    pg.evaluate("window.__mark('click_run')"); pg.click('#go')
    pg.wait_for_selector('#approval.show', timeout=180_000); pg.wait_for_timeout(2200)
    pg.evaluate("window.__mark('click_approve')"); pg.click('#ap-yes')
    pg.wait_for_selector('#result.show', timeout=180_000); pg.wait_for_timeout(5000)
    pg.evaluate("window.__mark('end')")
    return {'run': pg.evaluate("document.getElementById('rid').textContent")}

def c_intro(pg):
    pg.wait_for_timeout(2500); pg.hover('#samples li:nth-child(1) button'); pg.wait_for_timeout(1500)
    pg.hover('#samples li:nth-child(4) button'); pg.wait_for_timeout(1500); pg.hover('#door'); pg.wait_for_timeout(2500)
    pg.evaluate("window.__mark('end')")

def c_plain(pg): return run_sample(pg, 1)
def c_redteam(pg): return run_sample(pg, 4, show_text_ms=4500)

CLIPS = {'intro': c_intro, 'plain': c_plain, 'redteam': c_redteam}
for name in (sys.argv[1:] or list(CLIPS)):
    clip(name, CLIPS[name])
