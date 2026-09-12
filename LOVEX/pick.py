# -*- coding: utf-8 -*-
# 挑选可用素材：排除敏感与截图，按天挑图，压缩后输出到 game/
import json, os, io, shutil, cv2, numpy as np
from collections import defaultdict

ROOT = r"C:\Users\20319\Desktop\LOVEX"
SRC = os.path.join(ROOT, "微信聊天记录")
GAME = os.path.join(ROOT, "game")

rows = json.load(io.open(os.path.join(ROOT, "assets.json"), encoding="utf-8"))

# 1) 过滤：排除敏感上下文、截图
# 人工复核排除：上下文涉及私密内容的
EXCLUDE = ['160_28ba5945acc93ab0413dd75ea1d63517.jpg']
# 人工指定：9/1 改用明确安全的一张（她那天说"等你过来带你吃"）
FORCE = {'2026-09-01': '71_698d99d4d49014eae6a134076f337515.jpg'}
ok = [r for r in rows if not r["sens"] and r["cat"] != "截图" and r["f"] not in EXCLUDE]
print("可用图片:", len(ok), "/", len(rows))

# 2) 按天分组
by_day = defaultdict(list)
for r in ok:
    by_day[r["t"][:10]].append(r)

order = {"猫": 0, "人像": 1, "食物": 2, "其他": 3}
picks = []
for d in sorted(by_day):
    items = sorted(by_day[d], key=lambda x: (order.get(x["cat"], 9), -x["kb"]))
    pick = items[0]
    if d in FORCE:
        hit = [x for x in items if x["f"] == FORCE[d]]
        if hit:
            pick = hit[0]
    picks.append((d, pick))
    print(f"  {d}: {pick['cat']} 人脸{pick['faces']} {pick['ctx'][:46]}")

# 3) 复制到 photos/ 并压缩（长边 ≤960px，JPEG 质量 84）
os.makedirs(os.path.join(GAME, "photos"), exist_ok=True)
manifest = {}
for i, (d, r) in enumerate(picks, 1):
    src = os.path.join(SRC, "images", r["f"])
    img = cv2.imdecode(np.fromfile(src, dtype=np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        continue
    h, w = img.shape[:2]
    scale = min(1.0, 960 / max(w, h))
    if scale < 1.0:
        img = cv2.resize(img, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)
    dst = os.path.join(GAME, "photos", f"{i}.jpg")
    ok_enc, buf = cv2.imencode(".jpg", img, [int(cv2.IMWRITE_JPEG_QUALITY), 84])
    if ok_enc:
        buf.tofile(dst)
        manifest[i] = {
            "date": d, "src": r["f"], "cat": r["cat"],
            "faces": r["faces"], "ctx": r["ctx"][:70]
        }
print("\n已输出照片:", len(manifest))

# 4) 表情包：挑 11 个（优先中等体积的 gif/图片，跳过超大）
emo_src = os.path.join(SRC, "emojis")
emos = [f for f in os.listdir(emo_src) if f.lower().endswith((".gif", ".jpg", ".jpeg", ".png"))]
emos = sorted(emos, key=lambda f: os.path.getsize(os.path.join(emo_src, f)))
mid = emos[len(emos) // 3: len(emos) // 3 + 40]
step = max(1, len(mid) // 11)
chosen = mid[::step][:11]
os.makedirs(os.path.join(GAME, "stickers"), exist_ok=True)
for i, f in enumerate(chosen, 1):
    shutil.copy2(os.path.join(emo_src, f), os.path.join(GAME, "stickers", f"{i}{os.path.splitext(f)[1]}"))
print("已输出表情包:", len(chosen))

# 5) 头像
av_src = os.path.join(SRC, "texts", "avatars")
os.makedirs(os.path.join(GAME, "avatars"), exist_ok=True)
for f in os.listdir(av_src):
    img = cv2.imdecode(np.fromfile(os.path.join(av_src, f), dtype=np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        continue
    img = cv2.resize(img, (160, 160), interpolation=cv2.INTER_AREA)
    name = "me.jpg" if "1qv0ugeued9h22" in f else "her.jpg"
    ok_enc, buf = cv2.imencode(".jpg", img, [int(cv2.IMWRITE_JPEG_QUALITY), 88])
    if ok_enc:
        buf.tofile(os.path.join(GAME, "avatars", name))
print("头像已输出")

io.open(os.path.join(GAME, "photos", "manifest.json"), "w", encoding="utf-8").write(
    json.dumps(manifest, ensure_ascii=False, indent=1))
io.open(os.path.join(ROOT, "photos_manifest.json"), "w", encoding="utf-8").write(
    json.dumps(manifest, ensure_ascii=False, indent=1))
print("\n清单:", os.path.join(ROOT, "photos_manifest.json"))
