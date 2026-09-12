# -*- coding: utf-8 -*-
# 扫描微信素材，用「图片所在消息的上下文」推断内容并分类
import json, re, os, io
from collections import defaultdict

base = r"C:\Users\20319\Desktop\LOVEX\微信聊天记录"
src = os.path.join(base, "texts", "私聊_姐姐.html")

with io.open(src, "r", encoding="utf-8") as f:
    lines = f.readlines()

buf, started = [], False
for ln in lines:
    s = ln.strip()
    if not started:
        if s.startswith("window.WEFLOW_DATA"):
            started = True
        continue
    if s.startswith("]"):
        break
    s2 = s.rstrip(",")
    if s2.startswith("{"):
        try:
            buf.append(json.loads(s2))
        except Exception:
            pass

def parse(o):
    b = o.get("b", "")
    m = re.search(r'<div class="message-time">(.*?)</div>', b)
    t = m.group(1) if m else ""
    txts = re.findall(r'<div class="message-text">(.*?)</div>', b, re.S)
    txt = re.sub(r"\s+", " ", " ".join(x.strip() for x in txts)).strip()
    kind = "text"
    if 'class="message-media emoji' in b or '动画表情' in b:
        kind = "emoji"
    elif '.wav' in b:
        kind = "voice"
    elif '.mp4' in b:
        kind = "video"
    elif '<img' in b:
        kind = "image"
    return t, txt, kind

msgs = {}
for o in buf:
    i = o.get("i")
    t, txt, kind = parse(o)
    msgs[i] = {"t": t, "txt": txt, "kind": kind, "who": 1 if o.get("s") == 1 else 0, "raw": o.get("b", "")}

# 图片文件名 -> 消息序号
img_dir = os.path.join(base, "images")
files = [f for f in os.listdir(img_dir) if f.lower().endswith((".jpg", ".png", ".jpeg"))]

SENS = ['黑丝', '丝袜', '脱', '洗澡', '光着', '胸', '内衣', '裸', '色', '摸', '亲', '抱', '睡']


def ctx(i, span=4):
    out = []
    for j in range(max(1, i - span), i + span + 1):
        if j == i or j not in msgs:
            continue
        m = msgs[j]
        if m["kind"] == "text" and m["txt"]:
            out.append(("我" if m["who"] == 1 else "她") + "：" + m["txt"][:26])
    return " | ".join(out[:6])


def classify(c):
    if re.search(r'猫|token|喵|主子', c):
        return "猫"
    if re.search(r'云|晚霞|天空|天好看|霞|夕阳|太阳|这个天', c):
        return "天空"
    if re.search(r'吃|饭|外卖|面|粉|牛肉|抄手|馒头|鱼|香|好吃|饿|干饭|餐|菜|汤|粥|牛奶|布丁', c):
        return "食物"
    if re.search(r'天气|截图|游戏|网站|邮件|度|°|小说|抖音|知乎', c):
        return "截图"
    if re.search(r'帅|好看|漂亮|可爱|拍|照片|穿|染|妆|双马尾|你本人', c):
        return "人像/待确认"
    return "其他"


rows = []
for f in files:
    m = re.match(r"(\d+)_", f)
    if not m:
        continue
    i = int(m.group(1))
    info = msgs.get(i, {})
    c = ctx(i)
    size = os.path.getsize(os.path.join(img_dir, f)) // 1024
    cat = classify(c)
    sens = [w for w in SENS if w in c]
    rows.append({
        "f": f, "i": i, "t": info.get("t", "?"), "who": info.get("who", -1),
        "cat": cat, "size": size, "ctx": c, "sens": sens
    })

rows.sort(key=lambda r: r["i"])

out = ["=== 图片素材清单（按聊天上下文推断分类）===",
       "说明：含敏感上下文的已标记 [!]，人像类需你确认后再用\n"]
for r in rows:
    flag = " [!]" if r["sens"] else ""
    who = {1: "我", 0: "她", -1: "?"}[r["who"]]
    out.append(f"[{r['cat']}] {r['t']} {who}发 {r['size']}KB{flag}")
    out.append(f"    {r['f']}")
    if r["ctx"]:
        out.append(f"    上下文: {r['ctx'][:120]}")
    out.append("")

# 表情包统计
emo_dir = os.path.join(base, "emojis")
emos = sorted(os.listdir(emo_dir))
out.append(f"\n=== 表情包：共 {len(emos)} 个 ===")
out.append("（斗图用的，基本都可安全使用，我按出现顺序挑 11 张）")

# 头像
av_dir = os.path.join(base, "texts", "avatars")
out.append(f"\n=== 头像 ===")
for a in sorted(os.listdir(av_dir)):
    out.append("  " + a)

# 视频
v_dir = os.path.join(base, "videos")
out.append(f"\n=== 视频：{len(os.listdir(v_dir))} 个 ===")

dst = r"C:\Users\20319\Desktop\LOVEX\assets_report.txt"
with io.open(dst, "w", encoding="utf-8") as f:
    f.write("\n".join(out))

# 摘要
cnt = defaultdict(int)
for r in rows:
    cnt[r["cat"]] += 1
print("图片总数:", len(rows))
for k, v in cnt.items():
    print(f"  {k}: {v}")
print("已写入:", dst)
