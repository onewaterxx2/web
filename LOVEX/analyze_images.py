# -*- coding: utf-8 -*-
# 结合 OpenCV 人脸检测、色调分析与聊天上下文，给每张图打标签
import json, re, os, io, cv2, numpy as np
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
    msgs[i] = {"t": t, "txt": txt, "kind": kind, "who": 1 if o.get("s") == 1 else 0}

def ctx(i, span=4):
    out = []
    for j in range(max(1, i - span), i + span + 1):
        if j == i or j not in msgs:
            continue
        m = msgs[j]
        if m["kind"] == "text" and m["txt"]:
            out.append(("我" if m["who"] == 1 else "她") + "：" + m["txt"][:24])
    return " | ".join(out[:5])

SENS = ['黑丝', '丝袜', '脱', '洗澡', '光着', '胸', '内衣', '裸', '摸你', '亲你', '插', '硬']
CATS = [
    ("猫", r'猫|token|喵|主子'),
    ("天空", r'云|晚霞|天空|霞|夕阳|太阳|这个天|好看吧|天气好'),
    ("食物", r'吃|饭|外卖|面|粉|牛肉|抄手|馒头|鱼|香|好吃|饿|干饭|餐|菜|汤|粥|牛奶|布丁|早餐|午餐|晚餐'),
    ("截图", r'天气|截图|游戏|网站|邮件|小说|抖音|知乎|度|°'),
    ("人像", r'帅|好看|漂亮|可爱|拍|照片|穿|染|妆|双马尾|你本人|腹肌|眼睛'),
]
def classify(c):
    for name, pat in CATS:
        if re.search(pat, c):
            return name
    return "其他"

face_cascade = cv2.CascadeClassifier(cv2.data.haarcascades + 'haarcascade_frontalface_default.xml')
profile = cv2.CascadeClassifier(cv2.data.haarcascades + 'haarcascade_profileface.xml')

img_dir = os.path.join(base, "images")
files = [f for f in os.listdir(img_dir) if f.lower().endswith((".jpg", ".jpeg", ".png"))]

rows = []
for fn in files:
    m = re.match(r"(\d+)_", fn)
    if not m:
        continue
    i = int(m.group(1))
    path = os.path.join(img_dir, fn)
    info = msgs.get(i, {})
    c = ctx(i)
    cat = classify(c)
    sens = [w for w in SENS if w in c]
    faces, w_, h_ = 0, 0, 0
    avg = (0, 0, 0)
    try:
        # OpenCV 的 imread 不支持中文路径，改用 numpy 读取后解码
        img = cv2.imdecode(np.fromfile(path, dtype=np.uint8), cv2.IMREAD_COLOR)
        if img is not None:
            h_, w_ = img.shape[:2]
            small = cv2.resize(img, (min(640, w_), int(h_ * min(640, w_) / w_))) if w_ else img
            gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
            f1 = face_cascade.detectMultiScale(gray, 1.12, 5, minSize=(28, 28))
            f2 = profile.detectMultiScale(gray, 1.12, 5, minSize=(28, 28))
            faces = max(len(f1), len(f2))
            b, g, r = img[:, :, 0].mean(), img[:, :, 1].mean(), img[:, :, 2].mean()
            avg = (int(r), int(g), int(b))
    except Exception as e:
        pass
    rows.append({
        "f": fn, "i": i, "t": info.get("t", "?"), "who": info.get("who", -1),
        "cat": cat, "faces": faces, "w": w_, "h": h_, "rgb": avg,
        "ctx": c, "sens": sens,
        "kb": os.path.getsize(path) // 1024
    })

rows.sort(key=lambda r: r["i"])

out = ["=== 图片素材分析（人脸检测 + 色调 + 聊天上下文）===", ""]
for r in rows:
    flag = " [!敏感]" if r["sens"] else ""
    who = {1: "我", 0: "她", -1: "?"}[r["who"]]
    lt = "横" if r["w"] >= r["h"] else "竖"
    out.append(f"[{r['cat']}] {r['t']} {who}发 {r['w']}x{r['h']}({lt}) 人脸{r['faces']} RGB{r['rgb']} {r['kb']}KB{flag}")
    out.append(f"    {r['f']}")
    if r["ctx"]:
        out.append(f"    {r['ctx'][:110]}")
    out.append("")

cnt = defaultdict(int)
for r in rows:
    cnt[r["cat"]] += 1
out.append("=== 汇总 ===")
for k, v in sorted(cnt.items(), key=lambda x: -x[1]):
    out.append(f"  {k}: {v}")
out.append(f"  含人脸: {sum(1 for r in rows if r['faces']>0)}")
out.append(f"  敏感上下文: {sum(1 for r in rows if r['sens'])}")

dst = r"C:\Users\20319\Desktop\LOVEX\assets_report.txt"
with io.open(dst, "w", encoding="utf-8") as f:
    f.write("\n".join(out))
with io.open(r"C:\Users\20319\Desktop\LOVEX\assets.json", "w", encoding="utf-8") as f:
    f.write(json.dumps(rows, ensure_ascii=False, indent=1))

print("图片", len(rows), "| 分类:", dict(cnt))
print("含人脸:", sum(1 for r in rows if r['faces'] > 0), "| 敏感:", sum(1 for r in rows if r['sens']))
print("报告:", dst)
