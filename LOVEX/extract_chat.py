# -*- coding: utf-8 -*-
import json, re, os, io
from collections import Counter, defaultdict

base = r"C:\Users\20319\Desktop\LOVEX\微信聊天记录\texts"
src = os.path.join(base, "私聊_姐姐.html")

with io.open(src, "r", encoding="utf-8") as f:
    lines = f.readlines()

buf = []
started = False
for ln in lines:
    s = ln.strip()
    if not started:
        if s.startswith("window.WEFLOW_DATA"):
            started = True
        continue
    if s.startswith("]"):
        break
    s2 = s.rstrip(",")
    if not s2.startswith("{"):
        continue
    try:
        buf.append(json.loads(s2))
    except Exception:
        pass

def parse(o):
    b = o.get("b", "")
    m = re.search(r'<div class="message-time">(.*?)</div>', b)
    t = m.group(1) if m else ""
    txts = re.findall(r'<div class="message-text">(.*?)</div>', b, re.S)
    txt = " ".join(x.strip() for x in txts).strip()
    txt = re.sub(r"\s+", " ", txt)
    kind = None
    if ('class="message-media emoji' in b) or ('动画表情' in b) or txt.startswith('[表情'):
        kind = "emoji"
    elif '.wav' in b or '[语音]' in txt:
        kind = "voice"
    elif '.mp4' in b or '[视频]' in txt:
        kind = "video"
    elif '<img' in b or '[图片]' in txt:
        kind = "image"
    return t, txt, kind

recs = []
for o in buf:
    t, txt, kind = parse(o)
    if not t:
        continue
    date, tm = t.split(" ")
    recs.append({"date": date, "tm": tm, "who": 1 if o.get("s") == 1 else 0, "txt": txt, "kind": kind})

# 统计
by_date = defaultdict(lambda: [0, 0, 0, 0])  # 我, 她, 表情包, 图片语音
for r in recs:
    d = r["date"]
    by_date[d][0 if r["who"] == 1 else 1] += 1
    if r["kind"] == "emoji":
        by_date[d][2] += 1
    if r["kind"] in ("image", "voice", "video"):
        by_date[d][3] += 1

lines_out = ["=== 按天统计 (日期 | 我 | 她 | 表情包 | 图片语音视频 | 合计) ==="]
for d in sorted(by_date):
    a = by_date[d]
    lines_out.append("%s | 我%4d 她%4d | 表情%4d | 媒体%3d | 合计%4d" % (d, a[0], a[1], a[2], a[3], a[0] + a[1]))

# 纯文字对话
lines_out.append("\n\n=== 全部文字对话（已过滤纯图片/语音/视频）===")
prev = None
for r in recs:
    if r["kind"] in ("image", "voice", "video"):
        continue
    if r["date"] != prev:
        lines_out.append("\n----- %s -----" % r["date"])
        prev = r["date"]
    who = "我" if r["who"] == 1 else "她"
    if r["kind"] == "emoji":
        lines_out.append("%s %s: %s" % (r["tm"], who, r["txt"]))
    else:
        lines_out.append("%s %s: %s" % (r["tm"], who, r["txt"]))

full = "\n".join(lines_out)
with io.open(r"C:\Users\20319\Desktop\LOVEX\chat_clean.txt", "w", encoding="utf-8") as f:
    f.write(full)

# 她的话单独一份（重点素材）
her = ["=== 她说过的所有文字（按时间）==="]
for r in recs:
    if r["who"] == 1 or r["kind"] in ("image", "voice", "video"):
        continue
    her.append("%s %s: %s" % (r["date"][5:] + " " + r["tm"], "", r["txt"]))
with io.open(r"C:\Users\20319\Desktop\LOVEX\her_words.txt", "w", encoding="utf-8") as f:
    f.write("\n".join(her))

print("days:", len(by_date), "recs:", len(recs))
print("full size:", len(full), "her size:", sum(len(x) for x in her))
