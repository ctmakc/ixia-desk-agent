# IXIA Desk Agent — design decision (03.11.2026)

Inheritance: IXIA family (IXIA Guardrails playground «THE GATE RAIL», 16.10.2026). Same tokens so a judge moving between guardrails.ixia.online and desk.ixia.online sees one product: cool drafting-grid background `#e8ebef` / dark `#0f1218`, Bricolage Grotesque 800 display + Archivo body + JetBrains Mono for every machine value, one blue `#2348ff`, semantic go/hold/block.

New signature: **THE CHAMBER** — the sandbox drawn as a closed, double-ruled box. Inside: the live screenshot of the agent's browser. The box has exactly one opening on its right edge, the *door* (egress proxy) with its allowlist printed on it; refused hosts stack up against the outside of the wall in block-red. Limits are printed on the chamber's frame like a nameplate (read-only · cap-drop ALL · 1 GB · 256 pids · 120 s). Teardown = the chamber outline collapses and is stamped REMOVED.

Layout primitive: 4/8 split. Left: intake (sample enquiries as ruled rows, red-team row visually fenced). Right: chamber + ruled timeline rows (time · kind · message · result · thumbnail).

Motion: chamber boot = outline draws in (stroke-dashoffset, 500 ms expo-out); each step row slides in from the chamber edge; denial = door flashes block-red twice; countdown bar along the frame bottom; teardown = scaleY collapse + stamp. Reduced motion → instant states.
