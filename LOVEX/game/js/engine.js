// 游戏引擎：物理 / 碰撞 / 渲染 / 音效
const TILE = 32;
const VW = 960, VH = 540; // 逻辑分辨率（画布按 DPR 放大，保持锐利）

// ---------- 音效 + BGM ----------
const Sfx = {
  ctx: null, enabled: true, bgmOn: true, bgmTimer: null, bgmStep: 0,
  init() {
    if (this.ctx) return;
    try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { }
  },
  tone(freq, dur, type = 'sine', vol = 0.16, delay = 0) {
    if (!this.enabled || !this.ctx) return;
    const t = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.ctx.destination);
    o.start(t); o.stop(t + dur + 0.02);
  },
  jump() { this.tone(420, 0.14, 'triangle', 0.10); this.tone(620, 0.12, 'sine', 0.06, 0.02); },
  land() { this.tone(180, 0.08, 'sine', 0.06); },
  heart() { this.tone(880, 0.12, 'sine', 0.12); this.tone(1320, 0.22, 'sine', 0.09, 0.09); },
  hurt() { this.tone(200, 0.18, 'sawtooth', 0.07); this.tone(120, 0.22, 'sine', 0.07, 0.05); },
  clear() { [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.5, 'sine', 0.11, i * 0.11)); },
  door() { [392, 523, 659].forEach((f, i) => this.tone(f, 0.7, 'sine', 0.10, i * 0.16)); },
  startBgm() {
    if (this.bgmTimer || !this.ctx || !this.bgmOn) return;
    const chords = [[523.25, 659.25, 783.99], [587.33, 698.46, 880], [493.88, 587.33, 739.99], [440, 523.25, 659.25]];
    this.bgmStep = 0;
    this.bgmTimer = setInterval(() => {
      if (!this.bgmOn || !this.enabled) return;
      const ch = chords[Math.floor(this.bgmStep / 4) % chords.length];
      const n = ch[this.bgmStep % 4 === 3 ? 2 : this.bgmStep % 4];
      this.tone(n, 1.8, 'sine', 0.04);
      if (this.bgmStep % 4 === 0) this.tone(ch[0] / 2, 2.2, 'sine', 0.032);
      this.bgmStep++;
    }, 950);
  },
  stopBgm() { if (this.bgmTimer) { clearInterval(this.bgmTimer); this.bgmTimer = null; } }
};

// ---------- 主题配色 ----------
const THEMES = {
  day:   { sky: '#BFE3F5', far: '#DCEFF8', mid: '#C7E6C9', near: '#9ED3AE', ground: '#C89A6B', grass: '#8CC63F', ink: '#3B2A20', glow: 'rgba(255,236,180,.92)' },
  dusk:  { sky: '#FFC4A0', far: '#FFD9BE', mid: '#F2B48C', near: '#DE8F68', ground: '#B57B52', grass: '#7FA83C', ink: '#4A2B1B', glow: 'rgba(255,190,120,.92)' },
  night: { sky: '#28325A', far: '#364270', mid: '#465484', near: '#556297', ground: '#6B5570', grass: '#5E8C5A', ink: '#F3E9E2', glow: 'rgba(255,246,224,.92)' },
  dawn:  { sky: '#FFDFC0', far: '#FFF0DC', mid: '#FFD3AE', near: '#F2B18C', ground: '#C08A62', grass: '#94BE55', ink: '#4A3020', glow: 'rgba(255,225,175,.95)' },
  rain:  { sky: '#93A9BA', far: '#B6C5D1', mid: '#9BAFBC', near: '#8299AA', ground: '#8B7A69', grass: '#6E9E63', ink: '#2E2A28', glow: 'rgba(200,215,230,.7)' }
};

// ---------- 输入 ----------
const Input = {
  left: false, right: false, jump: false, jumpPressed: false,
  set(k, v) { if (k === 'jump' && v && !this.jump) this.jumpPressed = true; this[k] = v; }
};

// ---------- 玩家 ----------
class Player {
  constructor(x, y) {
    this.w = 20; this.h = 26;
    this.x = x; this.y = y;
    this.vx = 0; this.vy = 0;
    this.onGround = false;
    this.jumps = 0; this.maxJumps = 2; this.jumpHold = 999;
    this.coyote = 0; this.buffer = 0;
    this.face = 1; this.anim = 0;
    this.standingOn = null;
    this.dead = false; this.squash = 1;
    this.invuln = 0;
    this.shield = 0; this.boost = 0; this.cat = 0;
    this.blink = 0; this.blinkTimer = 60 + Math.random() * 120;
  }
  get rect() { return { x: this.x, y: this.y, w: this.w, h: this.h }; }
}

function aabb(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

// ---------- 游戏 ----------
class Game {
  constructor(canvas, level, opts) {
    opts = opts || {};
    this.cv = canvas; this.ctx = canvas.getContext('2d');
    this.level = level;
    this.theme = THEMES[level.theme] || THEMES.day;
    this.tick = 0;

    this.plats = (level.platforms || []).map(p => ({ x: p[0] * TILE, y: p[1] * TILE, w: p[2] * TILE, h: p[3] * TILE }));
    this.movers = (level.movers || []).map(m => ({
      bx: m.x * TILE, by: m.y * TILE, w: m.w * TILE, h: m.h * TILE,
      axis: m.axis, range: m.range * TILE, speed: m.speed, t: Math.random() * Math.PI * 2,
      x: m.x * TILE, y: m.y * TILE, dx: 0, dy: 0
    }));
    this.clouds = (level.clouds || []).map(c => ({ x: c[0] * TILE, y: c[1] * TILE, w: c[2] * TILE, h: 22 }));
    this.hazards = (level.hazards || []).map(h => ({ x: h.x * TILE, y: h.y * TILE + TILE * 0.55, w: h.w * TILE, h: TILE * 0.45 }));
    this.signs = (level.signs || []).map(s => ({ x: s[0] * TILE, y: s[1] * TILE, text: s[2], shown: 0 }));

    this.heart = { x: level.heart[0] * TILE, y: level.heart[1] * TILE, got: false, bob: 0 };
    this.stars = (level.stars || []).map(s => ({ x: s[0] * TILE, y: s[1] * TILE, got: false, bob: Math.random() * 6 }));
    this.goal = { x: level.goal[0] * TILE, y: level.goal[1] * TILE };
    this.locked = !!level.locked;

    // 道具 / 小怪 / Boss（都与真实故事对应）
    this.items = (level.items || []).map(i => ({
      x: i[0] * TILE, y: i[1] * TILE, type: i[2], taken: false, bob: Math.random() * 6
    }));
    this.enemies = (level.enemies || []).map(e => ({
      x: e[0] * TILE, y: e[1] * TILE, bx: e[0] * TILE, by: e[1] * TILE,
      type: e[2], w: 28, h: 26, dead: false, t: Math.random() * 6.28, die: 0
    }));
    this.boss = level.boss ? {
      x: level.boss.x * TILE, y: level.boss.y * TILE,
      bx: level.boss.x * TILE, by: level.boss.y * TILE,
      name: level.boss.name, hp: level.boss.hp, maxHp: level.boss.hp,
      w: 72, h: 68, t: 0, hurt: 0, dead: false, vy: 0
    } : null;

    this.levelW = Math.max(level.goal[0] + 8, 58) * TILE;
    this.camX = 0;

    const s = level.spawn;
    this.player = new Player(s[0] * TILE, s[1] * TILE);
    this.spawn = { x: s[0] * TILE, y: s[1] * TILE };
    this.safe = { x: s[0] * TILE, y: s[1] * TILE };
    this.safeTimer = 0;

    this.state = 'play';
    this.deathTimer = 0; this.clearTimer = 0;
    this.particles = [];
    this.stuckTimer = 0; this.lastX = this.player.x;
    this.trailTimer = 0;
    this.shootingStar = null;

    this.stickerImg = opts.sticker || null;
    this.stickerGot = false;

    this.initAmbience();
  }

  // ---------- 氛围 ----------
  initAmbience() {
    const th = this.level.theme, R = Math.random;
    this.amb = [];
    if (th === 'night') {
      for (let i = 0; i < 30; i++) this.amb.push({ t: 'fly', x: R() * VW, y: R() * VH * 0.85, p: R() * 6.28, s: 0.5 + R() * 0.9 });
    } else if (th === 'rain') {
      for (let i = 0; i < 110; i++) this.amb.push({ t: 'rain', x: R() * (VW + 200) - 100, y: R() * VH, v: 7 + R() * 5, l: 12 + R() * 16 });
    } else if (th === 'dawn') {
      for (let i = 0; i < 14; i++) this.amb.push({ t: 'mist', x: R() * VW, y: VH * 0.42 + R() * VH * 0.45, w: 140 + R() * 220, a: 0.05 + R() * 0.07, v: 0.12 + R() * 0.22 });
    } else if (th === 'dusk') {
      for (let i = 0; i < 8; i++) this.amb.push({ t: 'bird', x: R() * VW, y: 50 + R() * 130, v: 0.35 + R() * 0.5, p: R() * 6.28 });
    } else {
      for (let i = 0; i < 24; i++) this.amb.push({ t: 'leaf', x: R() * VW, y: R() * VH, v: 0.28 + R() * 0.5, p: R() * 6.28, s: 1.8 + R() * 2.4 });
    }
  }

  updateAmbience() {
    for (const a of this.amb) {
      if (a.t === 'rain') { a.y += a.v; a.x -= 1.4; if (a.y > VH) { a.y = -24; a.x = Math.random() * (VW + 200) - 100; } }
      else if (a.t === 'fly') { a.p += 0.02; a.x += Math.sin(a.p) * 0.35; a.y += Math.cos(a.p * 0.7) * 0.28; }
      else if (a.t === 'mist') { a.x += a.v; if (a.x > VW + a.w) a.x = -a.w; }
      else if (a.t === 'bird') { a.x += a.v; a.p += 0.07; if (a.x > VW + 50) { a.x = -50; a.y = 50 + Math.random() * 130; } }
      else if (a.t === 'leaf') { a.y += a.v; a.p += 0.03; a.x += Math.sin(a.p) * 0.9; if (a.y > VH) { a.y = -12; a.x = Math.random() * VW; } }
    }
    if (this.level.theme === 'night') {
      if (!this.shootingStar && Math.random() < 0.005) {
        this.shootingStar = { x: Math.random() * VW * 0.7, y: Math.random() * 130, vx: 6, vy: 2.8, life: 55 };
      }
      if (this.shootingStar) {
        const s = this.shootingStar; s.x += s.vx; s.y += s.vy; s.life--;
        if (s.life <= 0) this.shootingStar = null;
      }
    }
  }

  // 受伤：有护盾先碎盾，无敌状态免疫
  hurtPlayer() {
    const p = this.player;
    if (this.state !== 'play' || p.invuln > 0 || p.boost > 0) return;
    if (p.shield > 0) {
      p.shield = 0; p.invuln = 45;
      Sfx.tone(320, 0.16, 'square', 0.07); Sfx.tone(180, 0.22, 'sine', 0.07, 0.05);
      for (let i = 0; i < 12; i++) this.particles.push({
        x: p.x + p.w / 2, y: p.y + p.h / 2, vx: (Math.random() - .5) * 5,
        vy: (Math.random() - .6) * 5, life: 26, c: '#FFE9A8'
      });
      if (this.onShieldBreak) this.onShieldBreak();
      return;
    }
    this.kill();
  }

  kill() {
    if (this.state !== 'play' || this.player.invuln > 0) return;
    this.state = 'dead'; this.deathTimer = 0;
    Sfx.hurt();
    for (let i = 0; i < 14; i++) this.particles.push({
      x: this.player.x + this.player.w / 2, y: this.player.y + this.player.h / 2,
      vx: (Math.random() - .5) * 6, vy: (Math.random() - .7) * 6, life: 40, c: '#F09595'
    });
  }

  respawn() {
    this.player.x = this.safe.x; this.player.y = this.safe.y;
    this.player.vx = 0; this.player.vy = 0;
    this.player.jumps = 0; this.player.invuln = 55;
    this.state = 'play';
  }

  update() {
    this.tick++;
    const p = this.player;

    if (this.state === 'dead') {
      this.deathTimer++;
      if (this.deathTimer > 34) this.respawn();
      this.updateParticles(); this.updateAmbience();
      return;
    }
    if (this.state === 'clear') { this.clearTimer++; this.updateParticles(); this.updateAmbience(); return; }

    for (const m of this.movers) {
      m.t += m.speed * 0.02;
      const off = Math.sin(m.t) * m.range;
      const nx = m.bx + (m.axis === 'x' ? off : 0);
      const ny = m.by + (m.axis === 'y' ? -Math.abs(off) * 0.9 : 0);
      m.dx = nx - m.x; m.dy = ny - m.y;
      m.x = nx; m.y = ny;
    }

    // 手感参数：速度中等偏慢，起步/刹车更平滑，空中仍可微调
    const onG = p.onGround;
    const acc = onG ? 0.62 : 0.52;
    const fric = onG ? 0.84 : 0.92;
    const maxS = 3.0;
    if (Input.left) { p.vx -= acc; p.face = -1; }
    if (Input.right) { p.vx += acc; p.face = 1; }
    if (!Input.left && !Input.right) p.vx *= fric;
    // 反向按键时给一点额外加速度，转向更跟手
    if (Input.left && p.vx > 0.6) p.vx -= acc * 0.8;
    if (Input.right && p.vx < -0.6) p.vx += acc * 0.8;
    p.vx = Math.max(-maxS, Math.min(maxS, p.vx));

    if (Input.jumpPressed) { p.buffer = 10; Input.jumpPressed = false; }
    if (p.buffer > 0) p.buffer--;
    if (p.onGround) { p.coyote = 10; } else if (p.coyote > 0) p.coyote--;

    if (p.buffer > 0) {
      if (p.onGround || p.coyote > 0) {
        p.vy = -10.4; p.jumps = 1; p.buffer = 0; p.coyote = 0; p.squash = 1.28; p.jumpHold = 0;
        Sfx.jump();
        for (let i = 0; i < 5; i++) this.particles.push({
          x: p.x + p.w / 2, y: p.y + p.h, vx: (Math.random() - .5) * 2.4, vy: Math.random() * 0.6,
          life: 18, c: '#E8D9C5'
        });
      } else if (p.jumps < p.maxJumps) {
        p.vy = -8.6; p.jumps++; p.buffer = 0; p.squash = 1.24; p.jumpHold = 0;
        Sfx.jump();
        for (let i = 0; i < 8; i++) this.particles.push({
          x: p.x + p.w / 2, y: p.y + p.h, vx: (Math.random() - .5) * 3.4, vy: Math.random() * 1.4,
          life: 24, c: '#FAC775'
        });
      }
    }
    // 不做松手截断：点按与按住高度一致，关卡距离才可靠

    // 非对称重力：上升轻、下落沉，更有重量感（也更真实）
    p.vy += (p.vy < 0 ? 0.42 : 0.56);
    if (p.vy > 11.5) p.vy = 11.5;

    if (p.standingOn) { p.x += p.standingOn.dx || 0; p.y += p.standingOn.dy || 0; }

    p.x += p.vx;
    for (const s of this.solids()) {
      if (aabb(p.rect, s)) {
        if (p.vx > 0) p.x = s.x - p.w; else if (p.vx < 0) p.x = s.x + s.w;
        p.vx = 0;
      }
    }
    if (p.x < 0) { p.x = 0; p.vx = 0; }
    if (p.x > this.levelW - p.w) { p.x = this.levelW - p.w; p.vx = 0; }

    const prevBottom = p.y + p.h;
    p.y += p.vy;
    p.onGround = false; p.standingOn = null;
    for (const s of this.solids(p.vy >= 0)) {
      if (aabb(p.rect, s)) {
        if (p.vy > 0 && prevBottom <= s.y + 6) {
          p.y = s.y - p.h; p.vy = 0; p.onGround = true; p.jumps = 0;
          p.standingOn = s.isMover ? s : null;
          if (p.squash > 1.05) {
            Sfx.land();
            for (let i = 0; i < 6; i++) this.particles.push({
              x: p.x + p.w / 2 + (Math.random() - .5) * 14, y: p.y + p.h,
              vx: (Math.random() - .5) * 2.2, vy: -Math.random() * 1.2, life: 20, c: '#D9C3A8'
            });
          }
          p.squash = 0.82;
        } else if (p.vy < 0) { p.y = s.y + s.h; p.vy = 0; }
      }
    }

    p.squash += (1 - p.squash) * 0.18;
    if (p.invuln > 0) p.invuln--;
    if (Math.abs(p.vx) > 0.4) p.anim += Math.abs(p.vx) * 0.09; else p.anim = 0;

    if (p.onGround && Math.abs(p.vx) > 2 && ++this.trailTimer % 7 === 0) {
      this.particles.push({
        x: p.x + p.w / 2, y: p.y + p.h - 2, vx: -p.vx * 0.12, vy: -Math.random() * 0.5,
        life: 16, c: 'rgba(240,220,200,.85)'
      });
    }
    if (--p.blinkTimer <= 0) { p.blink = 8; p.blinkTimer = 90 + Math.random() * 150; }
    if (p.blink > 0) p.blink--;

    if (p.y > VH + 120) this.kill();
    for (const h of this.hazards) if (aabb(p.rect, h)) this.hurtPlayer();

    if (!this.heart.got) {
      this.heart.bob += 0.06;
      const hy = this.heart.y + Math.sin(this.heart.bob) * 4;
      const hr = { x: this.heart.x - 6, y: hy - 6, w: 30, h: 30 };
      const pcx = p.x + p.w / 2, pcy = p.y + p.h / 2;
      if (aabb(p.rect, hr) || Math.hypot(this.heart.x + 9 - pcx, hy + 9 - pcy) < 80) {
        this.heart.got = true; Sfx.heart();
        for (let i = 0; i < 18; i++) this.particles.push({
          x: this.heart.x + 9, y: hy + 9, vx: (Math.random() - .5) * 5.4,
          vy: (Math.random() - .8) * 5, life: 36, c: '#F4C0D1'
        });
        if (this.onHeart) this.onHeart();
      }
    }

    // 可选星星
    for (const st of this.stars) {
      if (st.got) continue;
      st.bob += 0.05;
      const sy = st.y + Math.sin(st.bob) * 3;
      const pcx = p.x + p.w / 2, pcy = p.y + p.h / 2;
      const rr = p.cat > 0 ? 180 : 40;   // token 在时会帮你把星星叼过来
      if (Math.hypot(st.x + 8 - pcx, sy + 8 - pcy) < rr ||
        aabb(p.rect, { x: st.x - 6, y: sy - 6, w: 26, h: 26 })) {
        st.got = true;
        Sfx.tone(1046, 0.1, 'sine', 0.10); Sfx.tone(1568, 0.2, 'sine', 0.07, 0.06);
        for (let i = 0; i < 10; i++) this.particles.push({
          x: st.x + 8, y: sy + 8, vx: (Math.random() - .5) * 4,
          vy: (Math.random() - .7) * 4, life: 28, c: '#FFE9A8'
        });
        if (this.onStar) this.onStar();
      }
    }

    // 状态计时
    if (p.boost > 0) p.boost--;
    if (p.cat > 0) {
      p.cat--;
      // token 跟在身后跑
      this.catX = (this.catX === undefined ? p.x : this.catX) + (p.x - 22 - this.catX) * 0.12;
      this.catY = (this.catY === undefined ? p.y : this.catY) + (p.y - 6 - this.catY) * 0.14;
    }

    // 道具
    for (const it of this.items) {
      if (it.taken) continue;
      it.bob += 0.05;
      const ix = it.x + 11, iy = it.y + 11 + Math.sin(it.bob) * 3;
      const pcx = p.x + p.w / 2, pcy = p.y + p.h / 2;
      if (Math.hypot(ix - pcx, iy - pcy) < 34) {
        it.taken = true;
        if (it.type === 'milk') p.shield = 1;
        else if (it.type === 'food') p.boost = 380;
        else if (it.type === 'cat') { p.cat = 700; this.catX = p.x; this.catY = p.y; }
        Sfx.tone(660, 0.1, 'sine', 0.11); Sfx.tone(990, 0.2, 'sine', 0.08, 0.07);
        for (let i = 0; i < 14; i++) this.particles.push({
          x: ix, y: iy, vx: (Math.random() - .5) * 4.4, vy: (Math.random() - .8) * 4.4,
          life: 30, c: it.type === 'milk' ? '#FFF4E0' : (it.type === 'food' ? '#FFD9A8' : '#C9D6E8')
        });
        if (this.onItem) this.onItem(it.type);
      }
    }

    // 小怪
    for (const e of this.enemies) {
      if (e.dead) { e.die++; continue; }
      e.t += 0.02;
      if (e.type === 'work') e.x = e.bx + Math.sin(e.t) * 24;
      else if (e.type === 'cloud') { e.x = e.bx + Math.sin(e.t * 0.8) * 32; e.y = e.by + Math.sin(e.t * 1.5) * 9; }
      else { e.x = e.bx + Math.sin(e.t * 0.6) * 44; e.y = e.by + Math.sin(e.t) * 7; }

      const er = { x: e.x - 14, y: e.y - 13, w: 28, h: 26 };
      if (aabb(p.rect, er)) {
        const stomp = p.vy > 0 && (p.y + p.h) < e.y + 4;
        if (stomp) {
          e.dead = true; p.vy = -8.6; p.jumps = 1; p.squash = 1.2;
          Sfx.tone(240, 0.12, 'square', 0.07); Sfx.tone(430, 0.16, 'sine', 0.06, 0.04);
          for (let i = 0; i < 12; i++) this.particles.push({
            x: e.x, y: e.y, vx: (Math.random() - .5) * 4.6, vy: (Math.random() - .7) * 4.6,
            life: 26, c: '#C8B8A8'
          });
          if (this.onStomp) this.onStomp();
        } else this.hurtPlayer();
      }
    }

    // Boss
    if (this.boss && !this.boss.dead) {
      const b = this.boss;
      b.t += 0.014;
      b.x = b.bx + Math.sin(b.t) * 44;
      b.y = b.by + Math.sin(b.t * 1.6) * 11;
      if (b.hurt > 0) b.hurt--;
      const br = { x: b.x - 34, y: b.y - 32, w: 68, h: 64 };
      if (aabb(p.rect, br)) {
        const stomp = p.vy > 0 && (p.y + p.h) < b.y - 2;
        if (stomp && b.hurt <= 0) {
          b.hp--; b.hurt = 45; p.vy = -9.6; p.jumps = 1;
          Sfx.tone(170, 0.22, 'sawtooth', 0.08); Sfx.tone(340, 0.2, 'sine', 0.07, 0.05);
          for (let i = 0; i < 16; i++) this.particles.push({
            x: b.x, y: b.y, vx: (Math.random() - .5) * 6, vy: (Math.random() - .8) * 6,
            life: 32, c: b.hp <= 0 ? '#FFD9E8' : '#B8A8C8'
          });
          if (b.hp <= 0) {
            b.dead = true; Sfx.clear();
            if (this.onBossDown) this.onBossDown();
          } else if (this.onBossHit) this.onBossHit(b.hp, b.maxHp);
        } else if (!stomp) this.hurtPlayer();
      }
    }

    if (this.stickerImg && !this.stickerGot) {
      const sx = this.heart.x + 48, sy = this.heart.y - 6;
      const sr = { x: sx - 15, y: sy - 15, w: 30, h: 30 };
      if (aabb(p.rect, sr) || Math.hypot(sx - (p.x + p.w / 2), sy - (p.y + p.h / 2)) < 40) {
        this.stickerGot = true; Sfx.heart();
        for (let i = 0; i < 14; i++) this.particles.push({
          x: sx, y: sy, vx: (Math.random() - .5) * 4.6, vy: (Math.random() - .8) * 4.6,
          life: 32, c: '#FAC775'
        });
        if (this.onSticker) this.onSticker(this.level.id);
      }
    }

    const gr = { x: this.goal.x, y: this.goal.y - 20, w: 34, h: 62 };
    const bossDone = !this.boss || this.boss.dead;
    if (aabb(p.rect, gr) && (!this.locked || this.heart.got) && bossDone) {
      this.state = 'clear'; Sfx.door();
      if (this.onClear) this.onClear();
    }

    if (p.onGround && !this.isOverHazard()) {
      this.safeTimer++;
      if (this.safeTimer > 12) { this.safe = { x: p.x, y: p.y }; this.safeTimer = 0; }
    } else this.safeTimer = 0;

    if (Math.abs(p.x - this.lastX) < 1.2) this.stuckTimer++; else this.stuckTimer = 0;
    this.lastX = p.x;

    for (const s of this.signs) {
      const d = Math.abs(p.x + p.w / 2 - s.x);
      s.shown += ((d < 120 ? 1 : 0) - s.shown) * 0.12;
    }

    const target = p.x + p.w / 2 - VW / 2;
    this.camX += (target - this.camX) * 0.11;
    this.camX = Math.max(0, Math.min(this.levelW - VW, this.camX));

    this.updateParticles();
    this.updateAmbience();
  }

  isOverHazard() {
    const r = this.player.rect;
    return this.hazards.some(h => aabb({ x: r.x - 70, y: r.y - 20, w: r.w + 140, h: r.h + 40 }, h));
  }

  solids(downOnly) {
    // 厚平台（地面）双向碰撞；薄平台 / 移动平台 / 云为单向 —— 可从下方穿过去，避免起跳撞头
    if (!this._thick) {
      this._thick = this.plats.filter(p => p.h > TILE);
      this._thin = this.plats.filter(p => p.h <= TILE).concat(this.movers);
    }
    const arr = this._thick;
    if (!downOnly) return arr;
    return arr.concat(this._thin).concat(this.clouds);
  }

  updateParticles() {
    for (const q of this.particles) { q.x += q.vx; q.y += q.vy; q.vy += 0.18; q.life--; }
    this.particles = this.particles.filter(q => q.life > 0);
  }

  // ---------- 渲染 ----------
  draw() {
    const c = this.ctx, th = this.theme;
    c.save();
    c.clearRect(0, 0, VW, VH);
    c.fillStyle = th.sky; c.fillRect(0, 0, VW, VH);

    if (this.level.theme === 'night') {
      c.fillStyle = 'rgba(255,255,255,.75)';
      for (let i = 0; i < 70; i++) {
        const sx = (i * 137.5) % this.levelW, sy = (i * 53.7) % 320;
        const px = sx - this.camX * 0.25;
        if (px < -10 || px > VW + 10) continue;
        c.globalAlpha = 0.3 + (0.5 + 0.5 * Math.sin(this.tick * 0.03 + i)) * 0.55;
        c.beginPath(); c.arc(px, sy, 1.4, 0, 7); c.fill();
      }
      c.globalAlpha = 1;
      if (this.shootingStar) {
        const s = this.shootingStar;
        const g = c.createLinearGradient(s.x, s.y, s.x - s.vx * 9, s.y - s.vy * 9);
        g.addColorStop(0, 'rgba(255,255,255,.95)'); g.addColorStop(1, 'rgba(255,255,255,0)');
        c.strokeStyle = g; c.lineWidth = 2.4; c.lineCap = 'round';
        c.beginPath(); c.moveTo(s.x, s.y); c.lineTo(s.x - s.vx * 9, s.y - s.vy * 9); c.stroke();
      }
    }

    const sunX = VW - 150 - this.camX * 0.06, sunY = 92;
    c.fillStyle = th.glow;
    c.globalAlpha = 0.2; c.beginPath(); c.arc(sunX, sunY, 64, 0, 7); c.fill();
    c.globalAlpha = 1; c.beginPath(); c.arc(sunX, sunY, 34, 0, 7); c.fill();

    c.fillStyle = th.far; this.hills(0.25, 250, 130);
    c.fillStyle = th.mid; this.hills(0.45, 320, 95);
    this.drawTrees(0.55, 326);

    c.fillStyle = 'rgba(255,255,255,.55)';
    for (let i = 0; i < 8; i++) {
      const cx = ((i * 420) - this.camX * 0.35) % (this.levelW + 600);
      const px = cx < -200 ? cx + this.levelW + 600 : cx;
      if (px < -180 || px > VW + 180) continue;
      this.puff(px, 70 + (i % 3) * 52, 34 + (i % 2) * 12);
    }

    c.fillStyle = th.near; this.bushes(0.7);

    c.save();
    c.translate(-Math.round(this.camX), 0);

    for (const cl of this.clouds) this.drawCloud(cl);
    for (const pl of this.plats) this.drawGround(pl, false);
    for (const m of this.movers) this.drawGround(m, true);
    for (const pl of this.plats) this.drawFlowers(pl);
    for (const h of this.hazards) this.drawSpike(h);
    for (const s of this.signs) this.drawSign(s);
    for (const st of this.stars) if (!st.got) this.drawStar(st.x + 8, st.y + 8 + Math.sin(st.bob) * 3);
    if (!this.heart.got) this.drawHeart(this.heart.x + 9, this.heart.y + 9 + Math.sin(this.heart.bob) * 4, 1);
    for (const it of this.items) if (!it.taken) this.drawItem(it);
    for (const e of this.enemies) if (!e.dead) this.drawEnemy(e);
    if (this.boss && !this.boss.dead) this.drawBoss();
    if (this.stickerImg && !this.stickerGot) this.drawSticker();
    this.drawGoal();
    this.drawParticles();
    if (this.player.cat > 0) this.drawCat();
    if (this.state !== 'dead') this.drawPlayer();

    c.restore();
    this.drawAmbience();
    c.restore();
  }

  drawAmbience() {
    const c = this.ctx;
    for (const a of this.amb) {
      if (a.t === 'fly') {
        const tw = 0.4 + 0.6 * Math.sin(this.tick * 0.06 + a.p * 3);
        c.globalAlpha = 0.22 + tw * 0.6; c.fillStyle = '#FFF0B8';
        c.beginPath(); c.arc(a.x, a.y, a.s * 1.7, 0, 7); c.fill();
        c.globalAlpha = 0.1 + tw * 0.18;
        c.beginPath(); c.arc(a.x, a.y, a.s * 4.5, 0, 7); c.fill();
      } else if (a.t === 'rain') {
        c.strokeStyle = 'rgba(220,235,245,.5)'; c.lineWidth = 1.3;
        c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(a.x + 4, a.y + a.l); c.stroke();
      } else if (a.t === 'mist') {
        c.globalAlpha = a.a; c.fillStyle = '#FFFFFF';
        c.beginPath(); c.ellipse(a.x, a.y, a.w, 26, 0, 0, 7); c.fill();
      } else if (a.t === 'bird') {
        const w = 5 + Math.sin(a.p) * 3;
        c.strokeStyle = 'rgba(70,50,40,.42)'; c.lineWidth = 2;
        c.beginPath();
        c.moveTo(a.x - 7, a.y - w * 0.4); c.quadraticCurveTo(a.x, a.y, a.x + 7, a.y - w * 0.4);
        c.stroke();
      } else if (a.t === 'leaf') {
        c.globalAlpha = 0.55; c.fillStyle = '#FFD9A8';
        c.save(); c.translate(a.x, a.y); c.rotate(Math.sin(a.p) * 0.7);
        c.beginPath(); c.ellipse(0, 0, a.s * 1.6, a.s * 0.7, 0, 0, 7); c.fill();
        c.restore();
      }
    }
    c.globalAlpha = 1;
  }

  hills(par, baseY, amp) {
    const c = this.ctx;
    c.beginPath(); c.moveTo(0, VH);
    for (let x = -40; x <= VW + 40; x += 20) {
      const wx = x + this.camX * par;
      const y = baseY - Math.sin(wx * 0.0035) * amp - Math.sin(wx * 0.0011 + 2) * amp * 0.5;
      c.lineTo(x, y);
    }
    c.lineTo(VW, VH); c.closePath(); c.fill();
  }

  // 中景的树（视差）
  drawTrees(par, baseY) {
    const c = this.ctx;
    const span = 14, gap = 150;
    for (let i = -2; i < span; i++) {
      let x = i * gap - (this.camX * par) % (gap * span);
      if (x < -100) x += gap * span;
      if (x < -90 || x > VW + 90) continue;
      const seed = Math.abs(Math.sin(i * 7.13));
      const h = 40 + seed * 34;
      const y = baseY + 12 + seed * 24;
      c.fillStyle = 'rgba(118,84,58,.45)';
      c.fillRect(x - 3, y - h * 0.42, 6, h * 0.48);
      c.fillStyle = this.level.theme === 'night' ? 'rgba(46,64,74,.55)'
        : (this.level.theme === 'dawn' ? 'rgba(150,160,95,.45)' : 'rgba(96,152,100,.45)');
      c.beginPath(); c.arc(x, y - h * 0.54, 20 + seed * 12, 0, 7); c.fill();
      c.beginPath(); c.arc(x - 15, y - h * 0.34, 13 + seed * 6, 0, 7); c.fill();
      c.beginPath(); c.arc(x + 15, y - h * 0.36, 13 + seed * 6, 0, 7); c.fill();
    }
  }

  bushes(par) {
    const c = this.ctx, y = VH - 26;
    c.beginPath();
    for (let i = -2; i < 26; i++) c.arc(i * 70 - (this.camX * par) % 70, y, 46, Math.PI, 0);
    c.rect(-100, y, VW + 200, 60); c.fill();
  }

  puff(x, y, r) {
    const c = this.ctx;
    c.beginPath();
    c.arc(x, y, r, 0, 7); c.arc(x + r * .8, y + 6, r * .75, 0, 7);
    c.arc(x - r * .8, y + 8, r * .65, 0, 7); c.fill();
  }

  drawGround(p, isMover) {
    const c = this.ctx, th = this.theme, r = 7;
    c.fillStyle = th.ground;
    this.roundRect(c, p.x, p.y, p.w, p.h, r); c.fill();
    if (p.h >= 20 || isMover) {
      c.fillStyle = th.grass;
      this.roundRect(c, p.x, p.y, p.w, 12, r); c.fill();
      c.fillStyle = 'rgba(255,255,255,.18)';
      c.fillRect(p.x + 4, p.y + 3, p.w - 8, 3);
      c.fillStyle = 'rgba(255,255,255,.12)';
      for (let x = p.x + 10; x < p.x + p.w - 6; x += 22) c.fillRect(x, p.y + 12, 2, 5);
    } else {
      c.fillStyle = th.grass;
      this.roundRect(c, p.x, p.y, p.w, Math.min(p.h, 12), r); c.fill();
    }
    if (isMover) {
      c.fillStyle = 'rgba(255,255,255,.35)';
      this.roundRect(c, p.x + 6, p.y + p.h - 6, p.w - 12, 3, 2); c.fill();
    }
  }

  drawCloud(cl) {
    const c = this.ctx;
    c.fillStyle = 'rgba(255,255,255,.88)';
    this.roundRect(c, cl.x, cl.y, cl.w, cl.h, 9); c.fill();
    c.fillStyle = 'rgba(205,222,240,.65)';
    this.roundRect(c, cl.x + 6, cl.y + cl.h - 5, cl.w - 12, 5, 2); c.fill();
  }

  drawSpike(h) {
    const c = this.ctx;
    c.fillStyle = '#B23A3A';
    const n = Math.max(1, Math.round(h.w / 16));
    for (let i = 0; i < n; i++) {
      const x = h.x + i * (h.w / n);
      c.beginPath();
      c.moveTo(x, h.y + h.h); c.lineTo(x + h.w / n / 2, h.y); c.lineTo(x + h.w / n, h.y + h.h);
      c.closePath(); c.fill();
    }
  }

  drawSign(s) {
    const c = this.ctx;
    c.fillStyle = '#8B5E3C'; c.fillRect(s.x, s.y + 6, 5, 30);
    c.fillStyle = '#C79A6B';
    this.roundRect(c, s.x - 15, s.y - 12, 35, 20, 4); c.fill();
    c.fillStyle = 'rgba(255,255,255,.3)';
    c.fillRect(s.x - 12, s.y - 9, 29, 3);
    if (s.shown > 0.02) {
      c.font = '500 13px system-ui, sans-serif';
      const w = c.measureText(s.text).width + 22;
      c.globalAlpha = Math.min(1, s.shown);
      c.fillStyle = 'rgba(255,252,246,.97)';
      this.roundRect(c, s.x - w / 2 + 2, s.y - 52, w, 28, 8); c.fill();
      c.fillStyle = '#6B4A34'; c.textAlign = 'center';
      c.fillText(s.text, s.x + 2, s.y - 33);
      c.beginPath();
      c.moveTo(s.x - 4, s.y - 24); c.lineTo(s.x + 8, s.y - 24); c.lineTo(s.x + 2, s.y - 16);
      c.closePath(); c.fill();
      c.globalAlpha = 1;
    }
  }

  // 草地上零星的小花（按坐标确定性生成，不会每帧乱跳）
  drawFlowers(p) {
    if (p.h < 20) return;
    const c = this.ctx;
    const cols = ['#FFD7E4', '#FFF0B8', '#FFFFFF', '#FFC9C9'];
    for (let x = p.x + 14; x < p.x + p.w - 8; x += 38) {
      const seed = Math.abs(Math.sin(x * 12.9898)) % 1;
      if (seed < 0.42) continue;
      const col = cols[Math.floor(seed * 4) % 4];
      const y = p.y - 1;
      c.strokeStyle = '#7FA83C'; c.lineWidth = 1.6;
      c.beginPath(); c.moveTo(x, y + 2); c.lineTo(x, y - 6); c.stroke();
      c.fillStyle = col;
      for (let k = 0; k < 5; k++) {
        const a = k * 1.257;
        c.beginPath(); c.arc(x + Math.cos(a) * 2.6, y - 6 + Math.sin(a) * 2.6, 2, 0, 7); c.fill();
      }
      c.fillStyle = '#FAC775';
      c.beginPath(); c.arc(x, y - 6, 1.5, 0, 7); c.fill();
    }
  }

  // ---------- 道具 / 小怪 / Boss / 猫伙伴 ----------
  drawItem(it) {
    const c = this.ctx, t = this.tick;
    const x = it.x + 11, y = it.y + 11 + Math.sin(it.bob) * 3;
    c.save(); c.translate(x, y);
    c.globalAlpha = 0.22 + 0.12 * Math.sin(t * 0.07);
    c.fillStyle = '#FFE9A8'; c.beginPath(); c.arc(0, 0, 17, 0, 7); c.fill();
    c.globalAlpha = 1;
    c.rotate(Math.sin(t * 0.03) * 0.12);

    if (it.type === 'milk') {
      c.fillStyle = '#FFFBF2';
      this.roundRect(c, -8, -9, 16, 18, 3); c.fill();
      c.fillStyle = '#EAF2FA';
      this.roundRect(c, -6, -7, 12, 6, 2); c.fill();
      c.strokeStyle = '#F0997B'; c.lineWidth = 2.4; c.lineCap = 'round';
      c.beginPath(); c.moveTo(3, -8); c.lineTo(6, -14); c.stroke();
      c.strokeStyle = '#D8E4EE'; c.lineWidth = 1.2;
      c.beginPath(); c.moveTo(0, -7); c.lineTo(0, 7); c.stroke();
    } else if (it.type === 'food') {
      c.fillStyle = '#FFF6E8';
      c.beginPath(); c.ellipse(0, 2, 11, 7, 0, 0, Math.PI); c.fill();
      c.fillStyle = '#F5DEB8';
      c.beginPath(); c.ellipse(0, 1, 11, 4.4, 0, 0, 7); c.fill();
      c.fillStyle = '#C8A165';
      c.beginPath(); c.ellipse(0, 4, 11, 3.4, 0, 0, 7); c.fill();
      c.fillStyle = '#FFE9C4';
      c.beginPath(); c.arc(-3, -1, 2.6, 0, 7); c.fill();
      c.beginPath(); c.arc(3, -2, 2.4, 0, 7); c.fill();
      c.strokeStyle = 'rgba(255,255,255,.7)'; c.lineWidth = 1.6; c.lineCap = 'round';
      c.beginPath(); c.arc(-6, -7, 3, 3.6, 5); c.stroke();
      c.beginPath(); c.arc(0, -9, 3, 3.4, 5.2); c.stroke();
    } else {
      c.fillStyle = '#C9D6E8';
      c.beginPath(); c.arc(0, 0, 9.5, 0, 7); c.fill();
      c.beginPath(); c.moveTo(-8, -4); c.lineTo(-10, -11); c.lineTo(-3.5, -7); c.closePath(); c.fill();
      c.beginPath(); c.moveTo(8, -4); c.lineTo(10, -11); c.lineTo(3.5, -7); c.closePath(); c.fill();
      c.fillStyle = '#3B4A5E';
      c.beginPath(); c.arc(-3.4, -1, 1.5, 0, 7); c.fill();
      c.beginPath(); c.arc(3.4, -1, 1.5, 0, 7); c.fill();
      c.fillStyle = 'rgba(232,87,126,.4)';
      c.beginPath(); c.arc(-6, 2.6, 2, 0, 7); c.fill();
      c.beginPath(); c.arc(6, 2.6, 2, 0, 7); c.fill();
    }
    c.restore();
  }

  drawEnemy(e) {
    const c = this.ctx, t = this.tick;
    c.save(); c.translate(e.x, e.y);
    const bob = Math.sin(t * 0.06 + e.t) * 2;

    if (e.type === 'work') {
      // 加班怪：顶着黑眼圈的文件夹
      c.fillStyle = '#8E9AA8';
      this.roundRect(c, -12, -11 + bob, 24, 22, 4); c.fill();
      c.fillStyle = '#AEBAC6';
      this.roundRect(c, -9, -14 + bob, 18, 6, 2); c.fill();
      c.fillStyle = '#FFFBEF';
      c.beginPath(); c.arc(-4.6, -2 + bob, 3.6, 0, 7); c.fill();
      c.beginPath(); c.arc(4.6, -2 + bob, 3.6, 0, 7); c.fill();
      c.fillStyle = '#3B4A5E';
      c.beginPath(); c.arc(-4.6, -1.6 + bob, 1.8, 0, 7); c.fill();
      c.beginPath(); c.arc(4.6, -1.6 + bob, 1.8, 0, 7); c.fill();
      c.strokeStyle = '#6E7A88'; c.lineWidth = 1.4;
      c.beginPath(); c.moveTo(-8, -6 + bob); c.lineTo(-1, -6 + bob); c.stroke();
      c.beginPath(); c.moveTo(1, -6 + bob); c.lineTo(8, -6 + bob); c.stroke();
    } else if (e.type === 'cloud') {
      // 倒霉云
      c.fillStyle = '#96A3B2';
      c.beginPath();
      c.arc(-9, 0 + bob, 8, 0, 7); c.arc(0, -5 + bob, 10, 0, 7); c.arc(10, 0 + bob, 8, 0, 7);
      c.fill();
      c.fillStyle = '#7C8896';
      c.beginPath(); c.arc(-3.6, -2 + bob, 1.6, 0, 7); c.fill();
      c.beginPath(); c.arc(4.4, -2 + bob, 1.6, 0, 7); c.fill();
      c.strokeStyle = '#7C8896'; c.lineWidth = 1.4; c.lineCap = 'round';
      c.beginPath(); c.arc(0, 4 + bob, 3.4, 0.15 * Math.PI, 0.85 * Math.PI); c.stroke();
      c.strokeStyle = 'rgba(140,165,190,.8)'; c.lineWidth = 1.6;
      for (let i = 0; i < 3; i++) {
        const dx = -7 + i * 7;
        c.beginPath(); c.moveTo(dx, 8 + bob + (i % 2) * 3); c.lineTo(dx - 1.6, 13 + bob + (i % 2) * 3); c.stroke();
      }
    } else {
      // 瞌睡虫
      c.fillStyle = '#B8A8D8';
      c.beginPath(); c.arc(0, bob, 12, 0, 7); c.fill();
      c.fillStyle = '#D6CCEE';
      c.beginPath(); c.arc(-3, -2 + bob, 9, 0, 7); c.fill();
      c.strokeStyle = '#5A4E76'; c.lineWidth = 1.6; c.lineCap = 'round';
      c.beginPath(); c.arc(-5, -1 + bob, 3, 0.15 * Math.PI, 0.85 * Math.PI); c.stroke();
      c.beginPath(); c.arc(5, -1 + bob, 3, 0.15 * Math.PI, 0.85 * Math.PI); c.stroke();
      c.fillStyle = 'rgba(232,87,126,.35)';
      c.beginPath(); c.arc(-8, 3 + bob, 2.4, 0, 7); c.fill();
      c.beginPath(); c.arc(8, 3 + bob, 2.4, 0, 7); c.fill();
      c.fillStyle = '#5A4E76'; c.font = '500 10px system-ui, sans-serif';
      c.fillText('z', 11, -10 + bob + Math.sin(t * 0.04) * 2);
      c.font = '500 7px system-ui, sans-serif';
      c.fillText('z', 16, -15 + bob + Math.sin(t * 0.04 + 1) * 2);
    }
    c.restore();
  }

  drawBoss() {
    const c = this.ctx, b = this.boss, t = this.tick;
    const wob = Math.sin(t * 0.03) * 4;
    c.save();
    c.translate(b.x, b.y);
    if (b.hurt > 0 && Math.floor(b.hurt / 5) % 2 === 0) c.globalAlpha = 0.5;

    // 影子本体（水滴形，像被拉长的火苗）
    c.fillStyle = b.name === '距离' ? 'rgba(66,58,92,.86)' : 'rgba(92,78,120,.86)';
    c.beginPath();
    c.moveTo(0, -34 + wob);
    c.bezierCurveTo(-38, -22 + wob, -40, 14 + wob, 0, 32 + wob);
    c.bezierCurveTo(40, 14 + wob, 38, -22 + wob, 0, -34 + wob);
    c.fill();
    // 内圈
    c.fillStyle = 'rgba(255,255,255,.08)';
    c.beginPath(); c.ellipse(-10, -4 + wob, 11, 16, -0.2, 0, 7); c.fill();

    // 愁眉苦脸
    c.fillStyle = '#F2EFFA';
    c.beginPath(); c.ellipse(-11, -6 + wob, 5, 6.4, 0, 0, 7); c.fill();
    c.beginPath(); c.ellipse(11, -6 + wob, 5, 6.4, 0, 0, 7); c.fill();
    c.fillStyle = '#2E2740';
    c.beginPath(); c.arc(-11, -5 + wob, 2.6, 0, 7); c.fill();
    c.beginPath(); c.arc(11, -5 + wob, 2.6, 0, 7); c.fill();
    c.strokeStyle = '#2E2740'; c.lineWidth = 2; c.lineCap = 'round';
    c.beginPath(); c.moveTo(-13, -14 + wob); c.lineTo(-6, -11 + wob); c.stroke();
    c.beginPath(); c.moveTo(13, -14 + wob); c.lineTo(6, -11 + wob); c.stroke();
    c.beginPath(); c.arc(0, 8 + wob, 6, 1.15 * Math.PI, 1.85 * Math.PI); c.stroke();

    c.globalAlpha = 1;
    // 名字
    c.fillStyle = 'rgba(255,255,255,.72)';
    c.font = '500 13px system-ui, sans-serif'; c.textAlign = 'center';
    c.fillText(b.name, 0, -46 + wob);

    // 血条
    const bw = 72, bh = 7;
    c.fillStyle = 'rgba(0,0,0,.35)';
    this.roundRect(c, -bw / 2, -60 + wob, bw, bh, 3.5); c.fill();
    c.fillStyle = b.name === '距离' ? '#7A6BB0' : '#B07BB8';
    this.roundRect(c, -bw / 2, -60 + wob, bw * (b.hp / b.maxHp), bh, 3.5); c.fill();
    c.restore();
  }

  drawCat() {
    const c = this.ctx, t = this.tick;
    const x = this.catX || 0, y = this.catY || 0;
    const bob = Math.sin(t * 0.12) * 2;
    c.save(); c.translate(x + 9, y + 9 + bob);
    c.fillStyle = '#AEBCCE';
    c.beginPath(); c.ellipse(0, 3, 10, 8, 0, 0, 7); c.fill();
    c.beginPath(); c.arc(0, -5, 8, 0, 7); c.fill();
    c.beginPath(); c.moveTo(-7, -9); c.lineTo(-8.5, -16); c.lineTo(-2.5, -11.5); c.closePath(); c.fill();
    c.beginPath(); c.moveTo(7, -9); c.lineTo(8.5, -16); c.lineTo(2.5, -11.5); c.closePath(); c.fill();
    c.fillStyle = '#3B4A5E';
    c.beginPath(); c.arc(-3, -5, 1.5, 0, 7); c.fill();
    c.beginPath(); c.arc(3, -5, 1.5, 0, 7); c.fill();
    c.fillStyle = 'rgba(232,87,126,.4)';
    c.beginPath(); c.arc(-6, -1.5, 2, 0, 7); c.fill();
    c.beginPath(); c.arc(6, -1.5, 2, 0, 7); c.fill();
    c.strokeStyle = '#AEBCCE'; c.lineWidth = 2; c.lineCap = 'round';
    c.beginPath(); c.moveTo(9, 4); c.quadraticCurveTo(16, 2 + Math.sin(t * 0.1) * 3, 14, -3); c.stroke();
    c.restore();
  }

  drawStar(x, y) {
    const c = this.ctx;
    c.save(); c.translate(x, y);
    c.globalAlpha = 0.28 + 0.16 * Math.sin(this.tick * 0.08);
    c.fillStyle = '#FFE9A8'; c.beginPath(); c.arc(0, 0, 15, 0, 7); c.fill();
    c.globalAlpha = 1;
    c.fillStyle = '#FFC94A';
    c.beginPath();
    for (let i = 0; i < 10; i++) {
      const r = i % 2 === 0 ? 9.5 : 4.2;
      const a = -Math.PI / 2 + i * Math.PI / 5;
      const px = Math.cos(a) * r, py = Math.sin(a) * r;
      if (i === 0) c.moveTo(px, py); else c.lineTo(px, py);
    }
    c.closePath(); c.fill();
    c.fillStyle = 'rgba(255,255,255,.5)';
    c.beginPath(); c.arc(-2, -3, 2, 0, 7); c.fill();
    c.restore();
  }

  drawSticker() {
    const c = this.ctx, img = this.stickerImg;
    const x = this.heart.x + 48, y = this.heart.y - 6 + Math.sin(this.heart.bob + 1) * 4;
    c.save();
    c.globalAlpha = 0.3; c.fillStyle = '#FFE9A8';
    c.beginPath(); c.arc(x, y, 22, 0, 7); c.fill();
    c.globalAlpha = 1;
    try { c.drawImage(img, x - 15, y - 15, 30, 30); }
    catch (e) { c.fillStyle = '#FAC775'; this.roundRect(c, x - 13, y - 13, 26, 26, 6); c.fill(); }
    c.restore();
  }

  drawHeart(x, y, s) {
    const c = this.ctx;
    c.save(); c.translate(x, y); c.scale(s, s);
    c.globalAlpha = 0.22 + 0.18 * Math.sin(this.tick * 0.07);
    c.fillStyle = '#FFD6E2';
    c.beginPath(); c.arc(0, 0, 20, 0, 7); c.fill();
    c.globalAlpha = 1;
    c.fillStyle = '#E8577E';
    c.beginPath();
    c.moveTo(0, 8);
    c.bezierCurveTo(-14, -4, -9, -16, 0, -8);
    c.bezierCurveTo(9, -16, 14, -4, 0, 8);
    c.fill();
    c.fillStyle = 'rgba(255,255,255,.55)';
    c.beginPath(); c.ellipse(-4, -6, 2.6, 3.4, -0.4, 0, 7); c.fill();
    c.restore();
  }

  drawGoal() {
    const c = this.ctx;
    const gx = this.goal.x, gy = this.goal.y - 20;
    const bossDone = !this.boss || this.boss.dead;
    const open = (!this.locked || this.heart.got) && bossDone;

    c.fillStyle = open ? '#B5763F' : '#8E8E8E';
    this.roundRect(c, gx - 2, gy + 6, 38, 56, 6); c.fill();
    c.fillStyle = open ? '#FFE9C4' : '#C9C9C9';
    this.roundRect(c, gx + 3, gy + 12, 28, 44, 4); c.fill();
    c.fillStyle = open ? 'rgba(255,214,150,.9)' : 'rgba(150,150,150,.5)';
    c.fillRect(gx + 16, gy + 12, 2, 44);
    c.fillStyle = '#FAC775';
    c.beginPath(); c.arc(gx + 13, gy + 34, 3, 0, 7); c.fill();

    if (open) {
      const a = 0.15 + 0.12 * Math.sin(this.tick * 0.06);
      c.fillStyle = `rgba(255,214,150,${a})`;
      c.beginPath(); c.arc(gx + 17, gy + 34, 50, 0, 7); c.fill();
    }

    this.drawSister(gx + 17, gy + 34, open);

    if (this.locked && !this.heart.got) {
      c.fillStyle = 'rgba(60,40,30,.7)';
      c.font = '500 13px system-ui, sans-serif'; c.textAlign = 'center';
      c.fillText('先找到那颗心', gx + 17, gy - 8);
    } else if (this.boss && !this.boss.dead) {
      c.fillStyle = 'rgba(60,40,30,.7)';
      c.font = '500 13px system-ui, sans-serif'; c.textAlign = 'center';
      c.fillText('先打败「' + this.boss.name + '」', gx + 17, gy - 8);
    }
  }

  // 姐姐：粉色小火人 + 头顶蝴蝶结，会挥手
  drawSister(x, y, visible) {
    const c = this.ctx, t = this.tick;
    const breathe = Math.sin(t * 0.05) * 1.4;
    const wave = visible ? Math.sin(t * 0.09) * 0.4 : 0;
    const wob = Math.sin(t * 0.06 + 1) * 1.2;
    c.save();
    c.translate(x, y - breathe * 0.5);
    if (!visible) c.globalAlpha = 0.45;
    const bodyY = -20;

    // 火苗（粉色）
    c.save();
    c.translate(0, bodyY - 17);
    c.fillStyle = '#FF9EC0';
    c.beginPath();
    c.moveTo(0, 6);
    c.bezierCurveTo(-10, -2, -6.5, -13, 0, -20 + wob);
    c.bezierCurveTo(6.5, -13, 10, -2, 0, 6);
    c.fill();
    c.fillStyle = '#FFD1E2';
    c.beginPath();
    c.moveTo(0, 4);
    c.bezierCurveTo(-6, -1, -3.6, -8, 0, -12.5 + wob);
    c.bezierCurveTo(3.6, -8, 6, -1, 0, 4);
    c.fill();
    c.restore();

    // 身体
    c.fillStyle = '#F2A0B5';
    c.beginPath();
    c.moveTo(0, bodyY - 19);
    c.bezierCurveTo(-13, bodyY - 13, -14, bodyY + 6, 0, bodyY + 8);
    c.bezierCurveTo(14, bodyY + 6, 13, bodyY - 13, 0, bodyY - 19);
    c.fill();
    c.fillStyle = 'rgba(255,255,255,.24)';
    c.beginPath(); c.ellipse(-5.2, bodyY - 5, 3, 4.8, -0.3, 0, 7); c.fill();

    // 脚
    c.fillStyle = '#FFB3C8';
    c.beginPath(); c.ellipse(-5, bodyY + 9, 4, 2.5, 0, 0, 7); c.fill();
    c.beginPath(); c.ellipse(5, bodyY + 9, 4, 2.5, 0, 0, 7); c.fill();

    // 手：一只挥手
    c.fillStyle = '#FFB3C8';
    c.beginPath(); c.arc(-11.5, bodyY + 1, 3.2, 0, 7); c.fill();
    c.save();
    c.translate(11, bodyY + 1);
    c.rotate(-0.6 - wave);
    c.fillRect(-1.6, -9, 3.2, 11);
    c.beginPath(); c.arc(0, -9.5, 3.2, 0, 7); c.fill();
    c.restore();

    // 脸
    const ey = bodyY - 5;
    c.fillStyle = '#3B2418';
    c.beginPath(); c.ellipse(-3.6, ey, 2.4, 3, 0, 0, 7); c.fill();
    c.beginPath(); c.ellipse(3.6, ey, 2.4, 3, 0, 0, 7); c.fill();
    c.fillStyle = 'rgba(255,255,255,.9)';
    c.beginPath(); c.arc(-4.3, ey - 1.2, 1, 0, 7); c.fill();
    c.beginPath(); c.arc(2.9, ey - 1.2, 1, 0, 7); c.fill();
    c.fillStyle = 'rgba(232,87,126,.45)';
    c.beginPath(); c.ellipse(-8.2, ey + 3.4, 2.7, 1.8, 0, 0, 7); c.fill();
    c.beginPath(); c.ellipse(8.2, ey + 3.4, 2.7, 1.8, 0, 0, 7); c.fill();
    c.strokeStyle = '#3B2418'; c.lineWidth = 1.3; c.lineCap = 'round';
    c.beginPath(); c.arc(0, ey + 4.2, 2.2, 0.12 * Math.PI, 0.88 * Math.PI); c.stroke();

    // 蝴蝶结
    c.fillStyle = '#E8577E';
    c.beginPath(); c.ellipse(-6, bodyY - 17, 4.6, 3.4, -0.35, 0, 7); c.fill();
    c.beginPath(); c.ellipse(6, bodyY - 17, 4.6, 3.4, 0.35, 0, 7); c.fill();
    c.beginPath(); c.arc(0, bodyY - 17, 2.2, 0, 7); c.fill();

    c.restore();
  }

  // 小火人：水滴形身体 + 头顶火苗 + 大眼睛
  drawPlayer() {
    const c = this.ctx, p = this.player;
    const cx = p.x + p.w / 2, by = p.y + p.h;
    const sq = p.squash, t = this.tick;
    const moving = Math.abs(p.vx) > 0.6;
    const run = p.anim;
    const breathe = moving ? 0 : Math.sin(t * 0.055) * 1.1;
    const lean = Math.min(Math.abs(p.vx), 3.0) * 1.7;
    // 局部坐标以「脚底 = 0」为基准：呼吸只影响身体和火苗，脚固定贴地
    const bodyY = -13 + breathe;
    const wob = Math.sin(t * 0.06) * 1.3;
    const FOOT = -2.6;   // 脚心高度，脚底正好落在 y = 0

    c.save();
    c.translate(cx, by);
    // 护盾 / 无敌光环（画在缩放之前，不受挤压影响）
    if (p.shield > 0 || p.boost > 0) {
      const a = 0.28 + 0.2 * Math.sin(this.tick * 0.1);
      c.strokeStyle = p.boost > 0 ? `rgba(255,150,80,${a + 0.22})` : `rgba(255,225,150,${a})`;
      c.lineWidth = 3;
      c.beginPath(); c.ellipse(0, -15, 23, 27, 0, 0, 7); c.stroke();
    }
    c.scale(p.face * (2 - sq), sq);
    c.rotate(lean * 0.013);
    if (p.invuln > 0 && Math.floor(p.invuln / 4) % 2 === 0) c.globalAlpha = 0.35;

    // 脚（固定在地面，不随呼吸动）
    c.fillStyle = '#FFB14A';
    const f1 = moving ? Math.sin(run) * 3.2 : 0;
    const f2 = moving ? Math.sin(run + Math.PI) * 3.2 : 0;
    c.beginPath(); c.ellipse(-5.2 + f1, FOOT, 4.4, 2.7, 0, 0, 7); c.fill();
    c.beginPath(); c.ellipse(5.2 + f2, FOOT, 4.4, 2.7, 0, 0, 7); c.fill();

    // 头顶火苗（跑动/腾空时烧得更旺）
    const fh = 1 + (moving ? 0.32 : 0) + Math.min(Math.abs(p.vy) * 0.014, 0.45);
    c.save();
    c.translate(0, bodyY - 17);
    c.scale(1, fh);
    c.fillStyle = '#FF8A34';
    c.beginPath();
    c.moveTo(0, 6);
    c.bezierCurveTo(-11, -2, -7, -14, 0, -21 + wob);
    c.bezierCurveTo(7, -14, 11, -2, 0, 6);
    c.fill();
    c.fillStyle = '#FFC94A';
    c.beginPath();
    c.moveTo(0, 4);
    c.bezierCurveTo(-6.5, -1, -4, -9, 0, -13.5 + wob);
    c.bezierCurveTo(4, -9, 6.5, -1, 0, 4);
    c.fill();
    c.fillStyle = '#FFF0B8';
    c.beginPath();
    c.moveTo(0, 2);
    c.bezierCurveTo(-3, -1, -2, -5, 0, -7.5 + wob * .6);
    c.bezierCurveTo(2, -5, 3, -1, 0, 2);
    c.fill();
    c.restore();

    // 身体（水滴形，底边压在脚面上）
    c.fillStyle = '#FF9E3D';
    c.beginPath();
    c.moveTo(0, bodyY - 19);
    c.bezierCurveTo(-13, bodyY - 13, -14, bodyY + 2, 0, FOOT + 1);
    c.bezierCurveTo(14, bodyY + 2, 13, bodyY - 13, 0, bodyY - 19);
    c.fill();
    c.fillStyle = 'rgba(255,255,255,.26)';
    c.beginPath(); c.ellipse(-5.2, bodyY - 5, 3.2, 5, -0.3, 0, 7); c.fill();
    c.fillStyle = 'rgba(255,150,60,.4)';
    c.beginPath(); c.ellipse(0, FOOT - 1, 8.4, 3, 0, 0, 7); c.fill();

    // 手
    const a1 = moving ? Math.sin(run + Math.PI) * 3 : Math.sin(t * 0.05) * 1.2;
    const a2 = moving ? Math.sin(run) * 3 : Math.sin(t * 0.05 + 1) * 1.2;
    c.beginPath(); c.arc(-12, bodyY + 1 + a1, 3.4, 0, 7); c.fill();
    c.beginPath(); c.arc(12, bodyY + 1 + a2, 3.4, 0, 7); c.fill();

    // 脸
    const ey = bodyY - 5;
    c.fillStyle = '#3B2418';
    if (p.blink > 0) {
      c.fillRect(-6.2, ey - 0.7, 4.4, 1.5);
      c.fillRect(1.8, ey - 0.7, 4.4, 1.5);
    } else {
      c.beginPath(); c.ellipse(-3.6, ey, 2.5, 3.1, 0, 0, 7); c.fill();
      c.beginPath(); c.ellipse(3.6, ey, 2.5, 3.1, 0, 0, 7); c.fill();
      c.fillStyle = 'rgba(255,255,255,.9)';
      c.beginPath(); c.arc(-4.4, ey - 1.3, 1, 0, 7); c.fill();
      c.beginPath(); c.arc(2.8, ey - 1.3, 1, 0, 7); c.fill();
    }
    c.fillStyle = 'rgba(232,87,126,.42)';
    c.beginPath(); c.ellipse(-8.4, ey + 3.6, 2.8, 1.9, 0, 0, 7); c.fill();
    c.beginPath(); c.ellipse(8.4, ey + 3.6, 2.8, 1.9, 0, 0, 7); c.fill();
    c.strokeStyle = '#3B2418'; c.lineWidth = 1.3; c.lineCap = 'round';
    c.beginPath();
    c.arc(0, ey + (moving ? 4.8 : 4), moving ? 2.4 : 2.2, 0.12 * Math.PI, 0.88 * Math.PI);
    c.stroke();

    c.restore();
  }

  drawParticles() {
    const c = this.ctx;
    for (const q of this.particles) {
      c.globalAlpha = Math.max(0, Math.min(1, q.life / 34));
      c.fillStyle = q.c;
      c.beginPath(); c.arc(q.x, q.y, 3, 0, 7); c.fill();
    }
    c.globalAlpha = 1;
  }

  roundRect(c, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }
}
