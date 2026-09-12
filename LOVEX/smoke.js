// 全流程冒烟测试：密码页 → 标题 → 11 关 → 回忆卡片 → 结局，验证无 JS 错误
const fs = require('fs'), path = require('path'), vm = require('vm');
const root = path.join(__dirname, 'game');

// 万能 canvas stub：支持链式调用与渐变对象
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

function makeEl(id) {
  const el = {
    id, style: {}, dataset: {}, textContent: '', innerHTML: '', value: '',
    width: 960, height: 540, _cls: new Set(), parentNode: null, children: [],
    classList: {
      add(...c) { c.forEach(x => el._cls.add(x)); },
      remove(...c) { c.forEach(x => el._cls.delete(x)); },
      toggle(c, f) { f ? el._cls.add(c) : el._cls.delete(c); },
      contains(c) { return el._cls.has(c); }
    },
    addEventListener: noop, removeEventListener: noop,
    getContext: () => ctxStub,
    getBoundingClientRect: () => ({ width: 960, height: 540, left: 0, top: 0, right: 960, bottom: 540 }),
    appendChild(c) { el.children.push(c); return c; },
    remove: noop, focus: noop, click: noop
  };
  el.parentNode = { appendChild: noop };
  let _html = '';
  Object.defineProperty(el, 'innerHTML', {
    get() { return _html; },
    set(v) { _html = v; if (v === '') el.children.length = 0; }
  });
  el.innerHTML = '';
  return el;
}

const els = {};
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const htmlIds = [...html.matchAll(/id="([^"]+)"/g)].map(m => m[1]);
htmlIds.forEach(id => els[id] = makeEl(id));
// restartLink 由 JS 动态创建
els.restartLink = makeEl('restartLink');

const tbtns = ['left', 'right', 'jump'].map(k => { const e = makeEl('t' + k); e.dataset.k = k; return e; });

const sandbox = {
  console, Math, Date, JSON, parseInt, parseFloat, isNaN,
  window: { addEventListener: noop },
  navigator: { maxTouchPoints: 0 },
  localStorage: { _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = v; } },
  requestAnimationFrame: noop,
  setTimeout: (fn) => { pending.push(fn); return 0; },
  clearTimeout: noop,
  Image: function () { this.onload = null; this.onerror = null; },
  document: {
    getElementById: id => els[id] || (els[id] = makeEl(id)),
    querySelectorAll: sel => (sel === '.tbtn' ? tbtns : []),
    createElement: tag => makeEl('new_' + tag),
    addEventListener: noop
  }
};
const pending = [];
sandbox.window.document = sandbox.document;
sandbox.globalThis = sandbox;

vm.createContext(sandbox);
['js/levels.js', 'js/engine.js', 'js/main.js'].forEach(f => {
  vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), sandbox, { filename: f });
});

const run = code => vm.runInContext(code, sandbox);
const flush = () => { const q = pending.splice(0); q.forEach(fn => { try { fn(); } catch (e) { errs.push('setTimeout: ' + e.message); } }); };
const errs = [];
function step(name, fn) { try { fn(); } catch (e) { errs.push(`${name}: ${e.message}`); } }

// 1. 密码错误
step('密码错误分支', () => {
  els.gateInput.value = '0000';
  run('checkGate()');
  if (!els.gateErr.textContent.includes('不对')) throw new Error('未提示错误');
});

// 2. 密码正确
step('密码正确', () => {
  els.gateInput.value = run('CONFIG.PASSWORDS[0]');
  run('checkGate()');
  if (!els.gate._cls.has('hidden')) throw new Error('密码页未隐藏');
  if (els.title._cls.has('hidden')) throw new Error('标题页未显示');
});

// 3. 逐关跑
const total = run('LEVELS.length');
for (let i = 0; i < total; i++) {
  step(`第 ${i + 1} 关启动`, () => run(`startLevel(${i})`));
  step(`第 ${i + 1} 关渲染+物理`, () => {
    run(`
      for (let f = 0; f < 240; f++) {
        const p = game.player;
        Input.right = true; Input.jump = false;
        if (p.onGround && f % 40 === 0) Input.set('jump', true);
        game.update();
        if (f % 30 === 0) game.draw();
      }
      if (!game.heart.got) { game.player.x = game.heart.x - 10; game.player.y = game.heart.y; game.update(); }
      game.state = 'clear';
    `);
    run('onLevelClear()');
    flush();
    if (els.card._cls.has('hidden')) throw new Error('回忆卡片未显示');
  });
  step(`第 ${i + 1} 关卡片内容`, () => {
    const lv = run(`LEVELS[${i}]`);
    if (els.cardTitle.textContent !== lv.title) throw new Error('卡片标题不匹配');
    if (els.cardDate.textContent !== lv.date) throw new Error('卡片日期不匹配');
  });
  step(`第 ${i + 1} 关继续`, () => { els.card._cls.add('hidden'); run('if (levelIndex >= LEVELS.length - 1) showEnding(); else startLevel(levelIndex + 1);'); });
}

// 4. 结局（不 flush，避免照片长卷的异步递归不断触发）
step('结局', () => {
  run('showEnding()');
  if (els.endHearts.children.length !== total) throw new Error('结局心数不对');
  if (els.endText.children.length !== run('ENDING.act1.length')) throw new Error('结局文案行数不对');
  if (!els.endFinalBox._cls.has('hidden') === false) { /* 幕三尚未进入 */ }
});

// 5. 声音开关 / 触屏
step('声音开关', () => run('Sfx.enabled = !Sfx.enabled'));
step('存档读档', () => run('saveProgress(3,[0,1,2]); const p = loadProgress(); if (p.idx !== 3) throw new Error("存档失败");'));

console.log('\n=== 冒烟测试结果 ===');
if (errs.length === 0) {
  console.log(`✓ 全部通过：密码页 / 标题 / ${total} 关物理与渲染 / 回忆卡片 / 结局 / 存档 均无 JS 错误`);
} else {
  console.log('✗ 发现 ' + errs.length + ' 个问题:');
  errs.forEach(e => console.log('  - ' + e));
}
process.exit(errs.length ? 1 : 0);
