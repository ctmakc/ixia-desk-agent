#!/usr/bin/env python3
"""Cuts the recorded clips into the submission video by the marks record.py logged.
Per scene: edge-tts voice line -> the clip window between two marks -> sped up (with a visible
"xN" label) if the window is longer than the line, or held on its last frame if shorter.
Subtitles and speed labels are one ASS file burned in; an SRT is written for YouTube.
Usage: python3 video/build.py   -> video/out/ixia-desk-agent-demo.mp4 (+ .srt)"""
import json, os, pathlib, re, subprocess

HERE = pathlib.Path(__file__).resolve().parent
OUT = pathlib.Path(os.environ.get('VIDEO_OUT', HERE / 'out'))
REC, WORK = OUT / 'rec', OUT / 'work'; WORK.mkdir(parents=True, exist_ok=True)
EDGE = os.environ.get('EDGE_TTS', '/data/venvs/edge-tts/bin/edge-tts')
VOICE = os.environ.get('VOICE', 'en-US-AndrewNeural')
FPS, PAD = 30, 0.7
SC = json.load(open(HERE / 'scenes.json'))

def sh(cmd): return subprocess.run(cmd, check=True, capture_output=True, text=True).stdout
def dur(f): return float(sh(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', str(f)]))

def mark_time(clip, sel):
    """'click_run' | 'row:<text>' (first row whose kind+msg contains text) | 'row#blocked:2' (2nd blocked row),
    optionally followed by '+1.5' / '-0.8'."""
    m = re.match(r'^(.*?)([+-]\d+(?:\.\d+)?)?$', sel); base, off = m.group(1), float(m.group(2) or 0)
    marks = json.load(open(REC / f'{clip}.json'))['marks']
    if base.startswith('row#'):
        kind, n = base[4:].split(':'); hits = [x for x in marks if x['k'] == 'row' and x['kind'].lower() == kind]
        return hits[int(n) - 1]['s'] + off
    if base.startswith('row:'):
        t = base[4:].lower(); return next(x['s'] for x in marks if x['k'] == 'row' and t in (x['kind'] + ' ' + x['msg']).lower()) + off
    return next(x['s'] for x in marks if x['k'] == base) + off

def ts(t):  # ASS time
    h, r = divmod(t, 3600); m, s = divmod(r, 60); return f'{int(h)}:{int(m):02d}:{s:05.2f}'
def srt_ts(t):
    ms = int(round(t * 1000)); h, ms = divmod(ms, 3600000); m, ms = divmod(ms, 60000); s, ms = divmod(ms, 1000); return f'{h:02d}:{m:02d}:{s:02d},{ms:03d}'

segs, subs, labels, t = [], [], [], 0.0
for i, s in enumerate(SC):
    mp3 = WORK / f'{i:02d}-{s["id"]}.mp3'
    if not mp3.exists() or s.get('retts'):
        subprocess.run([EDGE, '--voice', VOICE, '--rate', s.get('rate', '+0%'), '--text', s['vo'], '--write-media', str(mp3)], check=True, capture_output=True)
    vo = dur(mp3); target = vo + PAD
    mp4 = WORK / f'{i:02d}-{s["id"]}.mp4'
    if 'still' in s:
        sh(['ffmpeg', '-y', '-loop', '1', '-framerate', str(FPS), '-i', str(HERE / s['still']), '-t', f'{target:.3f}',
            '-vf', 'scale=1920:1080,format=yuv420p', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', str(mp4)])
        speed = 1.0
    else:
        a, b = mark_time(s['clip'], s['from']), mark_time(s['clip'], s['to']); win = max(0.5, b - a)
        speed = win / target if win > target * 1.1 else 1.0
        vf = f'setpts=(PTS-STARTPTS)/{speed:.4f}' + (f',tpad=stop_mode=clone:stop_duration={target - win:.3f}' if speed == 1.0 and win < target else '')
        sh(['ffmpeg', '-y', '-ss', f'{a:.3f}', '-t', f'{win:.3f}', '-i', str(REC / f'{s["clip"]}.webm'),
            '-vf', vf + f',fps={FPS},scale=1920:1080,format=yuv420p', '-t', f'{target:.3f}', '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', str(mp4)])
    segs.append((mp4, mp3, target))
    if speed > 1.05: labels.append((t, t + target, f'×{speed:.1f}'))
    # subtitles: sentences timed by character share inside the voice line
    parts = [p for p in re.split(r'(?<=[.!?])\s+', s['vo'].strip()) if p]; total = sum(len(p) for p in parts); c = t
    for p in parts:
        d = vo * len(p) / total; subs.append((c, c + d, p)); c += d
    t += target

# concat video and audio
(WORK / 'v.txt').write_text(''.join(f"file '{m}'\n" for m, _, _ in segs))
sh(['ffmpeg', '-y', '-f', 'concat', '-safe', '0', '-i', str(WORK / 'v.txt'), '-c', 'copy', str(WORK / 'video.mp4')])
pads = []
for m, a, tg in segs:
    w = a.with_suffix('.wav'); sh(['ffmpeg', '-y', '-i', str(a), '-af', f'apad=whole_dur={tg:.3f}', '-ar', '48000', '-ac', '2', str(w)]); pads.append(w)
(WORK / 'a.txt').write_text(''.join(f"file '{w}'\n" for w in pads))
sh(['ffmpeg', '-y', '-f', 'concat', '-safe', '0', '-i', str(WORK / 'a.txt'), '-c', 'pcm_s16le', str(WORK / 'audio.wav')])

ass = ["[Script Info]", "ScriptType: v4.00+", "PlayResX: 1920", "PlayResY: 1080", "", "[V4+ Styles]",
       "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
       "Style: Sub,Archivo,44,&H00FFFFFF,&H00FFFFFF,&H00160F0C,&HB0160F0C,0,0,0,0,100,100,0,0,3,14,0,2,220,220,46,1",
       "Style: Speed,JetBrains Mono,40,&H00FFFFFF,&H00FFFFFF,&H00FF4823,&H00FF4823,1,0,0,0,100,100,0,0,3,10,0,9,40,40,40,1",
       "", "[Events]", "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text"]
ass += [f"Dialogue: 0,{ts(a)},{ts(b)},Sub,,0,0,0,,{x}" for a, b, x in subs]
ass += [f"Dialogue: 1,{ts(a)},{ts(b)},Speed,,0,0,0,,{x} speed" for a, b, x in labels]
(WORK / 'subs.ass').write_text('\n'.join(ass) + '\n')
final = OUT / 'ixia-desk-agent-demo.mp4'
sh(['ffmpeg', '-y', '-i', str(WORK / 'video.mp4'), '-i', str(WORK / 'audio.wav'), '-vf', f"ass={WORK / 'subs.ass'}",
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-c:a', 'aac', '-b:a', '160k', '-shortest', '-movflags', '+faststart', str(final)])
(OUT / 'ixia-desk-agent-demo.srt').write_text(''.join(f'{i}\n{srt_ts(a)} --> {srt_ts(b)}\n{x}\n\n' for i, (a, b, x) in enumerate(subs, 1)))
print(f'{final}  {dur(final):.1f} s, {len(SC)} scenes, sped-up: {[(round(a,1), x) for a, b, x in labels]}')
