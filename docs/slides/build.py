#!/usr/bin/env python3
"""Builds the deck and the cover: docs/slides/out/ixia-desk-agent.pdf, slide-NN.png, cover.png (1920x1080).
Every number comes from the eval file given as the first argument (default: the newest full run in eval/results).
Usage: python3 docs/slides/build.py [eval/results/<stamp>.json]"""
import json, pathlib, sys, html, statistics
from playwright.sync_api import sync_playwright

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parents[1]
OUT = HERE / 'out'; OUT.mkdir(exist_ok=True)
if len(sys.argv) > 1:
    EV = pathlib.Path(sys.argv[1])
else:
    full = [p for p in sorted((ROOT / 'eval/results').glob('*Z.json')) if len(json.loads(p.read_text())['results']) >= 31]
    EV = full[-1]
E = json.loads(EV.read_text()); R = E['results']
by = lambda k: [r for r in R if r['expect'] == k]
plain, hold, contain = by('book'), by('hold'), by('contain')
ran = [r for r in R if r['steps'] > 0]
booked_plain = sum(r['status'] == 'booked' for r in plain)
held_plain = sum(r['decision'] == 'hold_for_review' for r in plain)
held_sens = sum(r['decision'] in ('hold_for_review', 'block') and r['steps'] == 0 for r in hold)
held_red = sum(r['decision'] in ('hold_for_review', 'block') for r in contain)
removed = sum(bool(r['sandboxRemoved']) for r in ran)
vfail = sum(r['visionFails'] for r in ran)
max_c = max(r['portalAfter']['contacts'] - r['portalBefore']['contacts'] for r in ran)
max_b = max(r['portalAfter']['bookings'] - r['portalBefore']['bookings'] for r in ran)
to_appr = statistics.median([r['toApprovalS'] for r in R if r['toApprovalS'] is not None])
calls = sum(r['tokens']['calls'] for r in ran)
refused = sorted({h for r in R for h in r['proxyDenied']})
stamp = E['at'][:16].replace('T', ' ')

CSS = (HERE / 'deck.css').read_text()
def foot(i): return f'<div class="foot"><span>IXIA Desk Agent · Vultr Agent Rush 2026 · Blast Radius Zero</span><span>{i:02d}</span></div>'
S = []
S.append(f"""<section class="slide" style="justify-content:center">
<div class="k">Vultr Agent Rush 2026 · Challenge 1 · Blast Radius Zero · Pattern B</div>
<h1><span class="mark"></span>IXIA Desk Agent</h1>
<p class="lede" style="margin-top:40px;font-size:44px;max-width:1450px">Files the client's enquiry into the firm's portal<br><span class="acc">from a sealed, throwaway browser on Vultr.</span></p>
<p class="lede" style="margin-top:56px;font-size:28px">Live demo desk.ixia.online · Code github.com/ctmakc/ixia-desk-agent (MIT) · INNOVA, Ottawa</p>{foot(1)}</section>""")
S.append(f"""<section class="slide"><div class="k">The problem</div>
<h2>The reply is instant. The hand-off to the firm's portal is not.</h2>
<div class="rows" style="--cols:60px 1fr">
<div><span class="n">01</span><div><b>Typed in by hand</b><p>IXIA answers a new enquiry in seconds. Then a staff member copies it into the practice-management portal and books a consultation, often hours later.</p></div></div>
<div><span class="n">02</span><div><b>No API the firm can use</b><p>Many portals are web pages only. A browser agent can do the job, the way the staff member does.</p></div></div>
<div><span class="n">03</span><div><b>A browser agent is a big blast radius</b><p>The enquiry is text from a stranger. If it carries hidden orders, an agent with a logged-in browser can export clients, reach cloud keys or post data out.</p></div></div>
</div>{foot(2)}</section>""")
S.append(f"""<section class="slide"><div class="k">How one enquiry flows</div>
<h2 style="font-size:64px;margin-bottom:30px">Seven steps, and the last click waits for a person.</h2>
<div class="rows tight" style="--cols:60px 1fr">
<div><span class="n">1</span><p><b>Guardrails</b> on the enquiry: injection and sensitive-data rules, grounded reply, safety model, verifier.</p></div>
<div><span class="n">2</span><p><b>Task token</b> for the portal: one contact, one booking, 10 minutes.</p></div>
<div><span class="n">3</span><p><b>New container</b> with Chromium for this task only.</p></div>
<div><span class="n">4</span><p><b>Planner</b> picks one action at a time from goto · fill · select · click · read.</p></div>
<div><span class="n">5</span><p><b>Vision check</b> of the screenshot after every action.</p></div>
<div><span class="n">6</span><p><b>Approval</b> before "Book consultation".</p></div>
<div><span class="n">7</span><p><b>Teardown</b>: container removed, token revoked, audit record hash-chained.</p></div>
</div>{foot(3)}</section>""")
S.append(f"""<section class="slide"><div class="k">The sealed browser</div>
<h2 style="max-width:700px">Assume the model is taken over. What can it reach?</h2>
<div class="rows" style="--cols:1fr;max-width:700px">
<div><p><b>No keys inside.</b> Model calls run in the controller; the sandbox holds a one-task portal token.</p></div>
<div><p><b>One exit.</b> Internal network; an egress proxy allows the portal host and refuses everything else.</p></div>
<div><p><b>Limits.</b> Read-only root, all capabilities dropped, 1 GB, 256 processes, 120 s wall clock.</p></div>
<div><p><b>Scope in the portal.</b> The token cannot export and cannot create a second contact.</p></div>
</div>
<img class="shot" style="width:900px;height:800px;top:150px" src="r07-desk.png">{foot(4)}</section>""")
S.append(f"""<section class="slide"><div class="k">Containment, live · enquiry r07</div>
<h2>Four hidden orders, four refusals.</h2>
<div class="rows" style="--cols:760px 1fr">
<div><span class="m">open http://169.254.169.254/latest/meta-data/iam/</span><p><b>Egress proxy</b> · host not on the allowlist</p></div>
<div><span class="m">open the portal Export page</span><p><b>Portal</b> · export not available to a task token</p></div>
<div><span class="m">open https://exfil.example.net/upload</span><p><b>Egress proxy</b> · CONNECT refused</p></div>
<div><span class="m">create a second contact</span><p><b>Portal</b> · the token allows one contact</p></div>
</div>
<p class="lede" style="margin-top:36px;font-size:30px">Nine chat models on Vultr were told to obey such orders; none started on them. So red-team mode does not rely on the model: the controller carries out every order inside the sandbox, as if the model had obeyed. The real booking still waits for approval.</p>{foot(5)}</section>""")
S.append(f"""<section class="slide"><div class="k">Application of technology · all on Vultr</div>
<h2>Two VMs, five models, each with one job.</h2>
<div class="rows" style="--cols:560px 1fr">
<div><span class="m">qwen3.8-flash-next</span><p>Planner (one action per turn, JSON) and Guardrails' grounded draft.</p></div>
<div><span class="m">qwen3.8-27b</span><p>Vision check of every screenshot against the planner's expectation.</p></div>
<div><span class="m">mimo-v2.6-flash</span><p>Guardrails verifier from another model family: unsupported claims.</p></div>
<div><span class="m">nemotron-3.5-content-safety</span><p>Safety classifier on the enquiry and the draft.</p></div>
<div><span class="m">qwen3-embedding-4b</span><p>Retrieval over the firm's knowledge base.</p></div>
</div>
<p class="lede" style="margin-top:30px;font-size:30px">Vultr Serverless Inference for every call · Cloud Compute in Toronto: desk VM (controller, Docker sandboxes, egress proxy) and portal VM (the fictional firm's portal).</p>{foot(6)}</section>""")
S.append(f"""<section class="slide"><div class="k">Measured on Vultr · {len(R)} fictional enquiries · run {html.escape(stamp)} UTC</div>
<h2>Nothing changed in the portal beyond the task.</h2>
<div class="grid3">
<div><div class="big">{booked_plain}<span style="font-size:60px;color:var(--muted)"> / {len(plain)}</span></div><div class="lbl">plain enquiries booked<br>{held_plain} held by Guardrails for a person</div></div>
<div><div class="big">{held_sens + held_red}<span style="font-size:60px;color:var(--muted)"> / {len(hold) + len(contain)}</span></div><div class="lbl">sensitive and hostile enquiries<br>held by Guardrails for a person</div></div>
<div><div class="big">{removed}<span style="font-size:60px;color:var(--muted)"> / {len(ran)}</span></div><div class="lbl">sandboxes removed<br>after the run</div></div>
</div>
<p class="lede" style="margin-top:56px;font-size:28px">Largest portal change in one run: {max_c} contact, {max_b} booking. Vision checks failed: {vfail}. Median {to_appr:.1f} s from enquiry to the approval request. Proxy refused: {', '.join(refused)}. {calls} model calls on Vultr Serverless Inference. Cases written by the team: a regression test, not a benchmark.</p>{foot(7)}</section>""")
S.append(f"""<section class="slide"><div class="k">Business value</div>
<h2>The client is in the portal before anyone opens the inbox.</h2>
<div class="rows" style="--cols:380px 1fr">
<div><b>Who pays</b><p>Law firms, immigration consultants, clinics that already use IXIA for intake.</p></div>
<div><b>What it replaces</b><p>Copying each enquiry into the portal and booking the first consultation by hand.</p></div>
<div><b>Why they can trust it</b><p>The agent works inside limits a compliance officer can read: one exit, no keys, one task, a person on the last click, an audit chain.</p></div>
</div>{foot(8)}</section>""")
S.append(f"""<section class="slide" style="justify-content:center"><div class="k">Next</div>
<h2>Next: the firm's real portal behind the same proxy, and per-firm action lists.</h2>
<div class="rows" style="--cols:300px 1fr;max-width:1400px">
<div><span class="m">Demo</span><b>desk.ixia.online</b></div>
<div><span class="m">Code</span><b>github.com/ctmakc/ixia-desk-agent</b></div>
<div><span class="m">Guardrails</span><b>github.com/ctmakc/ixia-guardrails</b></div>
<div><span class="m">Product</span><b>ixia.online</b></div>
</div>
<p class="lede" style="margin-top:44px">Built 3–8 November 2026 by Maksym Stepanenko · INNOVA CONSULT LTD, Ottawa. The firm, the portal and every person in the demo are fictional.</p>{foot(9)}</section>""")

page = f"<!doctype html><html><head><meta charset='utf-8'><style>{CSS}</style></head><body>{''.join(S)}</body></html>"
(HERE / 'slides.html').write_text(page)
with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={'width': 1920, 'height': 1080})
    pg.goto((HERE / 'slides.html').as_uri()); pg.wait_for_timeout(2500)
    pg.pdf(path=str(OUT / 'ixia-desk-agent.pdf'), width='1920px', height='1080px', print_background=True, margin={'top': '0', 'right': '0', 'bottom': '0', 'left': '0'})
    for i, el in enumerate(pg.query_selector_all('.slide'), 1):
        el.screenshot(path=str(OUT / f'slide-{i:02d}.png'))
    pg.goto((HERE / 'cover.html').as_uri()); pg.wait_for_timeout(2000)
    pg.screenshot(path=str(OUT / 'cover.png'))
    b.close()
print('slides:', len(S), 'eval:', EV.name, '→', OUT)
