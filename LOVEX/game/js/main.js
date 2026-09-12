// ---------- 可配置项 ----------
const CONFIG = {
  // 你们认识第一天的日期（进游戏的密码）。改这里就行。
  PASSWORDS: ['20260826', '2026-08-26', '2026/08/26', '8月26日'],
  SIGN: '—— 你的小江'
};

// 关卡照片（9/11 没有可用照片，用手绘卡片）
const PHOTOS = { 1: 'photos/1.jpg', 2: 'photos/2.jpg', 3: 'photos/3.jpg', 4: 'photos/4.jpg', 5: 'photos/5.jpg', 6: 'photos/6.jpg', 7: 'photos/7.jpg', 8: 'photos/8.jpg', 9: 'photos/9.jpg', 10: 'photos/10.jpg' };
// 每关可收集的真实表情包
const STICKERS = ['stickers/1.jpg', 'stickers/2.jpg', 'stickers/3.jpg', 'stickers/4.gif', 'stickers/5.jpg', 'stickers/6.jpg', 'stickers/7.jpg', 'stickers/8.png', 'stickers/9.gif', 'stickers/10.gif', 'stickers/11.png'];
// 路边木牌：[格子x, 格子y, 文字]
const SIGNS = {
  1: [[7, 13, '那天风很大'], [33, 13, '原来是你在想我']],
  2: [[6, 13, '两个风象星座'], [40, 10, '你在想我吗']],
  3: [[6, 13, '讲了十个小时'], [32, 13, '越听越好听']],
  4: [[5, 13, '你累不累呀'], [52, 13, '在我心里跑来跑去']],
  5: [[10, 13, '静静是谁'], [42, 13, '你说喜欢我不就得了']],
  6: [[6, 13, '那封信，我看了'], [46, 13, '我喜欢你，是真的']],
  7: [[5, 13, '你出生那天我在哪'], [42, 13, '现在火速找到你了']],
  8: [[5, 13, '五点二十，看邮箱'], [58, 13, '好想抱着你睡']],
  9: [[5, 13, '一百分'], [50, 13, '我喜欢你的眼睛']],
  10: [[6, 13, '你的心就是钥匙'], [41, 12, '先找到那颗心']],
  11: [[8, 13, '今天有点冷'], [46, 13, '好想抱抱你']]
};

const $ = id => document.getElementById(id);
const cv = $('cv');
const ctx = cv.getContext('2d');

let game = null;
let levelIndex = 0;
let hearts = [];
let stickers = [];
let paused = true;
let soundOn = true;
let endPhase = 0;
let starRecord = {};
try { starRecord = JSON.parse(localStorage.getItem('lovex_stars') || '{}'); } catch (e) { }

// ---------- 自适应尺寸：canvas 按实际显示大小渲染，保证任何窗口/全屏都锐利 ----------
function layout() {
  const r = cv.getBoundingClientRect();
  if (!r.width || !r.height) return;
  // 大屏时限制 DPR，避免分辨率过高拖慢帧率
  const dpr = Math.min(window.devicePixelRatio || 1, r.width > 1100 ? 1.5 : 2);
  const w = Math.max(1, Math.round(r.width * dpr));
  const h = Math.max(1, Math.round(r.height * dpr));
  if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
  ctx.setTransform(w / 960, 0, 0, h / 540, 0, 0);
  const st = $('stage');
  if (st) st.classList.toggle('big', r.width > 1000);
}
layout();
window.addEventListener('resize', layout);
document.addEventListener('fullscreenchange', layout);
if (window.ResizeObserver) { try { new ResizeObserver(layout).observe(cv); } catch (e) { } }

// ---------- 全屏 ----------
function toggleFs() {
  const st = $('stage');
  if (!st) return;
  const req = st.requestFullscreen || st.webkitRequestFullscreen || st.msRequestFullscreen;
  const exit = document.exitFullscreen || document.webkitExitFullscreen || document.msExitFullscreen;
  if (!document.fullscreenElement && !document.webkitFullscreenElement) { if (req) req.call(st); }
  else { if (exit) exit.call(document); }
}
$('fsBtn').addEventListener('click', toggleFs);

// ---------- 资源 ----------
const IMG = {};
function loadImg(key, src) {
  const im = new Image();
  im.onload = () => { IMG[key] = im; };
  im.onerror = () => { };
  im.src = src;
  return im;
}
Object.keys(PHOTOS).forEach(k => loadImg('p' + k, PHOTOS[k]));
STICKERS.forEach((s, i) => loadImg('s' + (i + 1), s));
// 头像：加载成功才写进 DOM，失败则保持隐藏
[['me', 'avatars/me.jpg'], ['her', 'avatars/her.jpg']].forEach(([k, src]) => {
  const im = loadImg(k, src);
  im.onload = () => {
    const el = $(k === 'me' ? 'avMe' : 'avHer');
    if (el) el.src = src;
  };
});

// ---------- 进度 ----------
function loadProgress() { try { return JSON.parse(localStorage.getItem('lovex_progress') || '{}'); } catch (e) { return {}; } }
function saveProgress(idx, hs, st) {
  try { localStorage.setItem('lovex_progress', JSON.stringify({ idx, hearts: hs, stickers: st })); } catch (e) { }
}

function transition(fn) {
  const t = $('trans');
  if (!t) { fn(); return; }
  t.classList.add('on');
  setTimeout(() => { fn(); t.classList.remove('on'); }, 380);
}

// ---------- 密码页 ----------
$('gateBtn').addEventListener('click', checkGate);
$('gateInput').addEventListener('keydown', e => { if (e.key === 'Enter') checkGate(); });
function checkGate() {
  const v = $('gateInput').value.trim();
  if (CONFIG.PASSWORDS.includes(v)) {
    Sfx.init();
    $('gate').classList.add('hidden');
    showTitle();
  } else {
    $('gateErr').textContent = '不对哦，是我们认识那天的日期';
    $('gateInput').value = '';
    setTimeout(() => $('gateErr').textContent = '', 2200);
  }
}

// ---------- 标题页 ----------
function showTitle() {
  const p = loadProgress();
  hearts = p.hearts || []; stickers = p.stickers || [];
  levelIndex = Math.min(p.idx || 0, LEVELS.length - 1);
  const btn = $('startBtn');
  btn.textContent = levelIndex > 0 ? `继续第 ${levelIndex + 1} 关` : '出 发';
  $('title').classList.remove('hidden');
  renderMap();

  let restart = $('restartLink');
  if (restart) restart.remove();
  if (levelIndex > 0 || hearts.length) {
    restart = document.createElement('p');
    restart.id = 'restartLink';
    restart.className = 'foot';
    restart.style.cursor = 'pointer';
    restart.textContent = '从头开始';
    restart.onclick = () => {
      levelIndex = 0; hearts = []; stickers = []; saveProgress(0, [], []);
      btn.textContent = '出 发'; restart.remove(); renderMap();
    };
    btn.parentNode.appendChild(restart);
  }
}

function renderMap() {
  const box = $('map');
  if (!box) return;
  box.innerHTML = '';
  for (let i = 0; i < LEVELS.length; i++) {
    const d = document.createElement('b');
    d.className = 'dot' + (hearts.includes(i) ? ' got' : '') + (i === levelIndex ? ' cur' : '');
    d.textContent = i + 1;
    d.title = LEVELS[i].date;
    if (hearts.includes(i) || i <= levelIndex) {
      d.onclick = () => { levelIndex = i; $('title').classList.add('hidden'); startLevel(i); };
    }
    box.appendChild(d);
  }
}

$('startBtn').addEventListener('click', () => {
  $('title').classList.add('hidden');
  startLevel(levelIndex);
});

// ---------- 关卡 ----------
function startLevel(i) {
  levelIndex = i;
  endPhase = 0;
  const lv = LEVELS[i];
  if (!lv.signs) lv.signs = [];
  game = new Game(cv, lv, { sticker: IMG['s' + lv.id] || null });
  game.onClear = onLevelClear;
  game.onHeart = () => updateHud();
  game.onStar = () => { updateStarHud(); toast('★'); };
  game.onItem = type => {
    updateBuffHud();
    toast(type === 'milk' ? '喝杯牛奶 · 能挡一次'
      : (type === 'food' ? '吃了口热的 · 什么都不怕'
        : 'token 跟上来了 · 帮你捡星星'));
  };
  game.onStomp = () => toast('踩扁了');
  game.onShieldBreak = () => toast('护盾碎了');
  game.onBossDown = () => {
    toast('「' + (game.boss ? game.boss.name : '') + '」散开了');
    Sfx.clear();
  };
  game.onSticker = id => {
    if (!stickers.includes(id - 1)) stickers.push(id - 1);
    updateHud();
    toast('收集到一张表情包');
  };
  paused = false;
  Sfx.startBgm();

  $('hud').classList.remove('hidden');
  $('hudLevel').textContent = `第 ${i + 1} 关`;
  $('hudDate').textContent = lv.date;
  updateHud();

  const tip = $('hudTip');
  tip.textContent = lv.tip;
  tip.classList.add('show');
  setTimeout(() => tip.classList.remove('show'), 3400);

  if (isTouch()) $('touch').classList.remove('hidden');
  $('soundBtn').classList.remove('hidden');
  $('fsBtn').classList.remove('hidden');
  layout();
}

function updateHud() {
  let s = '';
  for (let i = 0; i < LEVELS.length; i++) {
    s += `<span style="opacity:${hearts.includes(i) ? 1 : .22}">♥</span>`;
  }
  $('hudHearts').innerHTML = s;
  updateStarHud();
}

function updateStarHud() {
  const el = $('hudStars');
  if (!el || !game) return;
  let s = '';
  for (const st of game.stars) s += st.got ? '★' : '☆';
  el.textContent = s;
}

function updateBuffHud() {
  const el = $('hudBuff');
  if (!el || !game) return;
  const p = game.player;
  let s = '';
  if (p.shield > 0) s += '<b class="bf b1">盾</b>';
  if (p.boost > 0) s += '<b class="bf b2">暖</b>';
  if (p.cat > 0) s += '<b class="bf b3">猫</b>';
  el.innerHTML = s;
}

let toastTimer = null;
function toast(msg) {
  const el = $('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 1800);
}

function onLevelClear() {
  paused = true;
  const lv = LEVELS[levelIndex];
  if (!hearts.includes(levelIndex)) hearts.push(levelIndex);
  const got = game.stars.filter(s => s.got).length;
  starRecord[levelIndex] = Math.max(starRecord[levelIndex] || 0, got);
  saveProgress(Math.min(levelIndex + 1, LEVELS.length - 1), hearts, stickers);
  try { localStorage.setItem('lovex_stars', JSON.stringify(starRecord)); } catch (e) { }
  setTimeout(() => {
    $('hud').classList.add('hidden');
    showCard(lv);
  }, 850);
}

// ---------- 回忆卡片 ----------
function showCard(lv) {
  const img = $('cardImg'), no = $('cardNoPhoto');
  img.style.display = 'none'; no.style.display = 'flex';
  no.innerHTML = heartSvg();
  const p = IMG['p' + lv.id];
  if (p) { img.src = p.src; img.style.display = 'block'; no.style.display = 'none'; }
  else if (PHOTOS[lv.id]) {
    const probe = loadImg('p' + lv.id, PHOTOS[lv.id]);
    probe.onload = () => { img.src = probe.src; img.style.display = 'block'; no.style.display = 'none'; };
  }

  $('cardDate').textContent = lv.date;
  $('cardTitle').textContent = lv.title;
  const box = $('cardLines');
  box.innerHTML = '';
  lv.lines.forEach((t, i) => {
    const el = document.createElement('p');
    el.textContent = t;
    el.style.animationDelay = (i * 0.22) + 's';
    box.appendChild(el);
  });
  $('cardBtn').textContent = levelIndex >= LEVELS.length - 1 ? '看最后一样东西' : '继续走';
  $('card').classList.remove('hidden');
}

function heartSvg() {
  return '<svg width="54" height="54" viewBox="0 0 24 24"><path d="M12 21C4 15 1 10 3.2 6.4C5 3.5 8.4 3.8 10.4 6.2L12 8L13.6 6.2C15.6 3.8 19 3.5 20.8 6.4C23 10 20 15 12 21Z" fill="#F0C9B0"/></svg>';
}

function cardNext() {
  if ($('card').classList.contains('hidden')) return;
  $('card').classList.add('hidden');
  if (levelIndex >= LEVELS.length - 1) showEnding();
  else transition(() => startLevel(levelIndex + 1));
}
$('cardBtn').addEventListener('click', cardNext);

// ---------- 结局：三幕 ----------
let endRAF = null, endT = 0;
function showEnding() {
  endPhase = 3;
  $('ending').classList.remove('hidden');
  endT = 0;
  const hw = $('endHearts');
  hw.innerHTML = '';
  const heart = '<svg viewBox="0 0 24 24"><path d="M12 21C4 15 1 10 3.2 6.4C5 3.5 8.4 3.8 10.4 6.2L12 8L13.6 6.2C15.6 3.8 19 3.5 20.8 6.4C23 10 20 15 12 21Z" fill="#E8577E"/></svg>';
  for (let i = 0; i < LEVELS.length; i++) {
    const el = document.createElement('i');
    el.style.animationDelay = (i * 0.1) + 's';
    el.innerHTML = heart;
    hw.appendChild(el);
  }
  act1();
}

function act1() {
  const box = $('endText');
  box.innerHTML = '';
  ENDING.act1.forEach((t, i) => {
    const p = document.createElement('p');
    p.textContent = t || ' ';
    p.style.animationDelay = (0.35 + i * 0.7) + 's';
    box.appendChild(p);
  });
  setTimeout(() => { box.innerHTML = ''; act2(0); }, 1100 + ENDING.act1.length * 700);
}

function act2(i) {
  const wrap = $('endSlide');
  if (i >= LEVELS.length) { act3(); return; }
  const lv = LEVELS[i];
  const src = IMG['p' + lv.id] ? IMG['p' + lv.id].src : (PHOTOS[lv.id] || null);
  wrap.innerHTML = '';
  const card = document.createElement('div');
  card.className = 'slide';
  if (src) {
    const im = document.createElement('img');
    im.src = src; card.appendChild(im);
  } else {
    const ph = document.createElement('div');
    ph.className = 'slide-ph';
    ph.innerHTML = heartSvg();
    card.appendChild(ph);
  }
  const cap = document.createElement('div');
  cap.className = 'slide-cap';
  cap.innerHTML = `<span class="d">${lv.date}</span><span class="t">${lv.title}</span>`;
  card.appendChild(cap);
  wrap.appendChild(card);
  requestAnimationFrame(() => card.classList.add('in'));
  setTimeout(() => {
    card.classList.remove('in'); card.classList.add('out');
    setTimeout(() => act2(i + 1), 400);
  }, 2000);
}

function act3() {
  $('endSlide').innerHTML = '';
  $('endText').innerHTML = '';
  $('ending').classList.add('see');   // 露出 canvas 上的星空
  $('endFinalBox').classList.remove('hidden');
  endT = 0;
  const step = () => {
    endT++;
    drawEndScene(endT);
    if (endT === 150) { $('endFinal').textContent = ENDING.final; $('endFinal').classList.add('in'); }
    if (endT === 205) { $('endFinalSub').textContent = ENDING.finalSub; $('endFinalSub').classList.add('in'); }
    if (endT === 235) {
      const got = Object.keys(starRecord).reduce((a, k) => a + (starRecord[k] || 0), 0);
      const all = LEVELS.length * 3;
      const el = $('endStars');
      if (el) {
        el.textContent = got >= all ? '33 颗星，一颗不落' : `路上的星星　${got} / ${all}`;
        el.classList.remove('hidden');
      }
    }
    if (endT === 265) {
      $('endSign').textContent = CONFIG.SIGN;
      $('endSign').classList.remove('hidden');
      $('endAgain').classList.remove('hidden');
    }
    endRAF = requestAnimationFrame(step);
  };
  step();
}

function drawEndScene(t) {
  const c = ctx;
  c.save();
  c.clearRect(0, 0, 960, 540);
  const g = c.createLinearGradient(0, 0, 0, 540);
  g.addColorStop(0, '#1E2748'); g.addColorStop(0.65, '#2E3A63'); g.addColorStop(1, '#4A3F63');
  c.fillStyle = g; c.fillRect(0, 0, 960, 540);

  for (let i = 0; i < 90; i++) {
    const x = (i * 137.5) % 960, y = (i * 71.3) % 380;
    c.globalAlpha = 0.2 + (0.4 + 0.6 * Math.sin(t * 0.04 + i)) * 0.6;
    c.fillStyle = '#fff';
    c.beginPath(); c.arc(x, y, 1.5, 0, 7); c.fill();
  }
  c.globalAlpha = 1;

  c.fillStyle = 'rgba(255,246,224,.92)';
  c.beginPath(); c.arc(790, 96, 38, 0, 7); c.fill();
  c.globalAlpha = 0.1; c.beginPath(); c.arc(790, 96, 70, 0, 7); c.fill(); c.globalAlpha = 1;

  c.fillStyle = '#3E4A6B';
  c.beginPath(); c.moveTo(0, 470);
  for (let x = 0; x <= 960; x += 24) c.lineTo(x, 462 + Math.sin(x * 0.012) * 8);
  c.lineTo(960, 540); c.lineTo(0, 540); c.closePath(); c.fill();
  c.fillStyle = '#5A6E8C';
  c.beginPath(); c.moveTo(0, 486);
  for (let x = 0; x <= 960; x += 24) c.lineTo(x, 480 + Math.sin(x * 0.014 + 1) * 7);
  c.lineTo(960, 540); c.lineTo(0, 540); c.closePath(); c.fill();

  const k = Math.min(1, t / 150);
  const ease = 1 - Math.pow(1 - k, 3);
  const midX = 480;
  const bx = 300 + (midX - 44 - 300) * ease;
  const gx = 660 - (660 - (midX + 44)) * ease;
  const bob = Math.sin(t * 0.09) * 2;
  drawMini(c, bx, 470 + bob, '#F5A55A', '#3B2A20', 1);
  drawMini(c, gx, 470 - bob * 0.6, '#F2A0B5', '#4A3428', -1);

  if (k >= 1) {
    const a = 0.22 + 0.18 * Math.sin(t * 0.08);
    c.fillStyle = `rgba(255,214,150,${a})`;
    c.beginPath(); c.arc(midX, 452, 60 + Math.sin(t * 0.05) * 6, 0, 7); c.fill();
    c.save(); c.translate(midX, 420 + Math.sin(t * 0.06) * 3);
    c.fillStyle = '#E8577E';
    c.beginPath(); c.moveTo(0, 9);
    c.bezierCurveTo(-15, -4, -10, -17, 0, -9);
    c.bezierCurveTo(10, -17, 15, -4, 0, 9);
    c.fill(); c.restore();
  }
  c.restore();
}

function drawMini(c, x, y, cloth, hair, face) {
  c.save(); c.translate(x, y); c.scale(face, 1);
  c.fillStyle = cloth;
  c.beginPath(); c.moveTo(-11, 0); c.lineTo(-7, -26); c.lineTo(7, -26); c.lineTo(11, 0); c.closePath(); c.fill();
  c.fillStyle = '#FFE0C8';
  c.beginPath(); c.arc(0, -36, 11, 0, 7); c.fill();
  c.fillStyle = hair;
  c.beginPath(); c.arc(0, -38, 11.6, Math.PI, Math.PI * 2); c.fill();
  c.fillStyle = '#3B2A20';
  c.beginPath(); c.arc(-3.6, -35, 1.7, 0, 7); c.fill();
  c.beginPath(); c.arc(3.6, -35, 1.7, 0, 7); c.fill();
  c.fillStyle = 'rgba(232,87,126,.35)';
  c.beginPath(); c.arc(-7, -31, 2.6, 0, 7); c.fill();
  c.restore();
}

$('endAgain').addEventListener('click', () => {
  if (endRAF) cancelAnimationFrame(endRAF);
  endPhase = 0;
  $('ending').classList.add('hidden');
  $('ending').classList.remove('see');
  $('endFinalBox').classList.add('hidden');
  $('endFinal').classList.remove('in');
  $('endFinalSub').classList.remove('in');
  $('endSign').classList.add('hidden');
  $('endAgain').classList.add('hidden');
  levelIndex = 0;
  transition(() => startLevel(0));
});

// ---------- 输入 ----------
const keyMap = {
  ArrowLeft: 'left', a: 'left', A: 'left',
  ArrowRight: 'right', d: 'right', D: 'right',
  ' ': 'jump', w: 'jump', W: 'jump', ArrowUp: 'jump'
};
window.addEventListener('keydown', e => {
  if (!$('card').classList.contains('hidden') && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); cardNext(); return; }
  if (e.key === 'Escape' && game) { paused = !paused; $('pauseTip').classList.toggle('hidden', !paused); return; }
  if (e.key === 'f' || e.key === 'F') { toggleFs(); return; }
  if ((e.key === 'r' || e.key === 'R') && game && !paused) {
    game.player.x = game.spawn.x; game.player.y = game.spawn.y;
    game.player.vx = 0; game.player.vy = 0; toast('回到起点'); return;
  }
  const k = keyMap[e.key];
  if (!k) return;
  e.preventDefault();
  Sfx.init();
  if (!paused) Input.set(k, true);
});
window.addEventListener('keyup', e => {
  const k = keyMap[e.key];
  if (!k) return;
  e.preventDefault();
  Input.set(k, false);
});

function isTouch() { return ('ontouchstart' in window) || navigator.maxTouchPoints > 0; }
if (isTouch()) {
  document.querySelectorAll('.tbtn').forEach(b => {
    const k = b.dataset.k;
    const on = e => { e.preventDefault(); Sfx.init(); if (!paused) Input.set(k, true); };
    const off = e => { e.preventDefault(); Input.set(k, false); };
    b.addEventListener('pointerdown', on);
    b.addEventListener('pointerup', off);
    b.addEventListener('pointercancel', off);
    b.addEventListener('pointerleave', off);
  });
}

$('soundBtn').addEventListener('click', () => {
  soundOn = !soundOn;
  Sfx.enabled = soundOn; Sfx.bgmOn = soundOn;
  if (soundOn) Sfx.startBgm(); else Sfx.stopBgm();
  $('soundBtn').classList.toggle('off', !soundOn);
});

// ---------- 主循环 ----------
let tick = 0;
function loop() {
  if (game && !paused) game.update();
  if (game && endPhase === 0) game.draw();
  if (game && ++tick % 6 === 0) updateBuffHud();
  requestAnimationFrame(loop);
}
loop();
window.addEventListener('keydown', e => { if (e.key === ' ') e.preventDefault(); }, { passive: false });
