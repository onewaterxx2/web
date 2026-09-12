// 关卡可通过性模拟测试：AI 自动跑每一关，验证能到达终点且渲染不报错
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, 'game');

// 万能 canvas stub：任意属性访问都返回可调用的自身，支持链式调用与渐变对象
const stub = new Proxy(function () { }, {
  get: (t, k) => {
    if (k === 'canvas') return { width: 960, height: 540 };
    if (k === 'width' || k === 'height') return 100;
    return stub;
  },
  apply: () => stub,
  set: () => true
});
const noop = () => { };
const ctxStub = stub;
const canvasStub = { getContext: () => ctxStub, width: 960, height: 540 };

const sandbox = {
  console,
  window: {},
  document: { getElementById: () => null, querySelectorAll: () => [] },
  Math, Date, JSON, Image: function () { }, setTimeout, clearTimeout
};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(root, 'js/levels.js'), 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(path.join(root, 'js/engine.js'), 'utf8'), sandbox);

// 顶层 const 只存在于 vm 的词法作用域，需在 context 内部取引用
const { LEVELS, Game, Input } = vm.runInContext('({ LEVELS, Game, Input })', sandbox);
const MAX_FRAMES = 4000;

function groundAhead(g, dist) {
  const p = g.player;
  const footY = p.y + p.h;
  const ax = p.x + p.w / 2 + dist;
  let has = false, wall = false;
  for (const s of g.solids(true)) {
    if (ax >= s.x && ax <= s.x + s.w) {
      if (s.y >= footY - 6 && s.y < footY + 140) has = true;
      if (s.y < footY - 8 && s.y + s.h > p.y + 6) wall = true;
    }
  }
  return { has, wall };
}

let pass = 0, fail = 0;
const report = [];

for (let i = 0; i < LEVELS.length; i++) {
  const lv = LEVELS[i];
  let g;
  try { g = new Game(canvasStub, lv, {}); }
  catch (e) { console.log(`L${i + 1} 构造失败: ${e.message}`); fail++; continue; }

  let frames = 0, deaths = 0, lastX = g.player.x, stuck = 0, drawErr = null; const deathLog = [];
  let cleared = false;

  g.onClear = () => { cleared = true; };

  while (frames < MAX_FRAMES && !cleared) {
    const p = g.player;
    Input.right = true; Input.left = false;
    Input.jump = false;

    const near = groundAhead(g, 8);   // 贴近边缘才起跳（真人行为）
    const far = groundAhead(g, 55);
    let jump = false;

    if (p.onGround) {
      if (near.wall || !near.has) jump = true;
    } else if (p.vy > 1 && p.jumps < p.maxJumps && !far.has) {
      jump = true; // 空中发现够不着，补二段跳
    }

    // 躲尖刺：要提前起跳，起跳后第一帧升不到尖刺顶部就会撞上
    if (p.onGround) {
      for (const h of g.hazards) {
        const d = h.x - (p.x + p.w);
        // 起跳后要落在尖刺之后：x0 + 165 > h.x + h.w
        if (d > 26 && d < 60) { jump = true; break; }
      }
    }

    // 小怪：跳过去或踩它
    if (p.onGround) {
      for (const e of (g.enemies || [])) {
        if (e.dead) continue;
        const d = e.x - (p.x + p.w);
        if (d > 10 && d < 60) { jump = true; break; }
      }
    }
    // Boss：测试脚本代为踩败（AI 不会打 Boss，只验证通关流程）
    if (g.boss && !g.boss.dead && Math.abs(p.x - g.boss.x) < 240) {
      g.boss.hp = 0; g.boss.dead = true;
      if (g.onBossDown) g.onBossDown();
    }

    // 主动去够心
    if (!g.heart.got && p.onGround) {
      const hx = g.heart.x, hy = g.heart.y;
      if (hy < p.y - 10 && hx > p.x - 40 && hx < p.x + 100) jump = true;
    }
    if (Math.abs(p.x - lastX) < 0.4) { stuck++; if (stuck > 14) { jump = true; stuck = 0; } }
    else stuck = 0;
    lastX = p.x;

    if (jump) Input.set('jump', true);

    const prevState = g.state;
    try { g.update(); } catch (e) { drawErr = 'update: ' + e.message; break; }
    if (g.state === 'dead' && prevState !== 'dead') {
      deaths++; if (deathLog.length < 8) deathLog.push(`x${Math.round(p.x)}/y${Math.round(p.y)}`);
    }

    if (frames % 60 === 0) {
      try { g.draw(); } catch (e) { drawErr = 'draw: ' + e.message; break; }
    }
    frames++;
  }

  const heartGot = g.heart.got;
  const ok = cleared && !drawErr;
  if (ok) pass++; else fail++;
  report.push({
    lv: i + 1, date: lv.date, ok, cleared, frames, deaths,
    heart: heartGot, endX: Math.round(g.player.x), goalX: lv.goal[0] * 32, err: drawErr, deathsAt: deathLog.join(' ')
  });
}

console.log('\n关卡  日期      通关  帧数  死亡  拿到心  玩家X/终点X   错误');
for (const r of report) {
  console.log(
    `L${String(r.lv).padStart(2)}  ${r.date}  ${r.ok ? ' ✓ ' : ' ✗ '}  ${String(r.frames).padStart(4)}  ${String(r.deaths).padStart(3)}   ${r.heart ? '✓' : '✗'}    ${String(r.endX).padStart(4)}/${String(r.goalX).padEnd(4)}  ${r.err || ''}  ${r.deathsAt}`
  );
}
console.log(`\n通过 ${pass} / ${LEVELS.length}`);
process.exit(fail > 0 ? 1 : 0);
