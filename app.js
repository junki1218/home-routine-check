/* ===========================================================
   帰宅後のルーティンチェック
   - カードを1枚ずつ（カルーセル）
   - 「できた！」/「チェック待ち」/ 保護者の解除
   - 1か月分（31日）の記録を端末内に保存

   演出の方針（Notion「UI/UX・アニメーション用語集」より）
   - 動きには必ず目的を持たせる（操作の結果・状態の変化を伝える）
   - 文字が動いている間も読めるようにする
   - 感覚過敏に配慮し、「うごき」を減らせる設定を用意する
   =========================================================== */
(function () {
  'use strict';

  /* ---------------------------------------------------------
     1. 定義
     --------------------------------------------------------- */

  var STORE_KEY  = 'homeRoutine.v1';
  var MOTION_KEY = 'homeRoutine.motion';
  var KEEP_DAYS  = 31;     // 保存する日数
  var DAY_START  = 3;      // 深夜3時に日付が切り替わる

  var CARDS = [
    { no:1, title:'カバンの中に入っているプリントをすべてクリアファイルに入れて提出する', emoji:'🎒', color:'blue'   },
    { no:2, title:'連絡帳を提出する',                                                   emoji:'📓', color:'green'  },
    { no:3, title:'通級ファイルを提出する',                                             emoji:'📗', color:'yellow' },
    { no:4, title:'学校の宿題をすべて見せる',                                           emoji:'📝', color:'red'    },
    { no:5, title:'明日の支度の確認をすべて終わらせる',                                 emoji:'👕', color:'purple' },
    { no:6, title:'もう一度1番からすべて自分でチェックし直す',                          emoji:'🔁', color:'teal'   },
    { no:7, title:'2階の部屋の片付けをする',                                            emoji:'🛏️', color:'blue'   },
    { no:8, title:'1階の部屋の自分の荷物をすべて片付ける',                              emoji:'📦', color:'green'  },
    { no:9, title:'すべて終わったことを報告する',                                       emoji:'🙋', color:'pink'   }
  ];

  // 6番は 1〜5 が全部済んでいないとチェックできない
  // 9番は 1〜8 が全部済んでいないとチェックできない
  var REQUIRES = { 6:[1,2,3,4,5], 9:[1,2,3,4,5,6,7,8] };

  // チェックしたときに出る短いことば（毎回同じだと飽きるので回す）
  var PRAISE = ['いいね！', 'できた！', 'ナイス！', 'その調子！', 'おみごと！', 'やったね！'];

  /* ---------------------------------------------------------
     2. うごきの設定（感覚過敏への配慮）
     --------------------------------------------------------- */

  var motionOn = true;

  function loadMotion() {
    var v = null;
    try { v = localStorage.getItem(MOTION_KEY); } catch (e) {}
    if (v === 'off') return false;
    if (v === 'on')  return true;
    // 設定がなければ端末の「視差効果を減らす」に従う
    try {
      return !(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    } catch (e) { return true; }
  }

  function applyMotion() {
    document.body.classList.toggle('motion-off', !motionOn);
    var b = document.getElementById('btnMotion');
    if (b) {
      b.querySelector('.icon-btn-emoji').textContent = motionOn ? '✨' : '🤫';
      b.querySelector('.icon-btn-label').textContent = motionOn ? 'うごく' : 'しずか';
      b.setAttribute('aria-pressed', motionOn ? 'true' : 'false');
      b.setAttribute('aria-label', motionOn ? 'うごきを減らす' : 'うごきを元にもどす');
    }
  }

  /* ---------------------------------------------------------
     3. 日付まわり
     --------------------------------------------------------- */

  function logicalDate(d) {
    // 深夜3時より前は「前の日」として扱う
    var t = new Date(d || Date.now());
    t.setHours(t.getHours() - DAY_START);
    return t.getFullYear() + '-' + pad(t.getMonth() + 1) + '-' + pad(t.getDate());
  }
  function pad(n){ return (n < 10 ? '0' : '') + n; }

  function fmtDateLabel(key) {
    var p = key.split('-');
    var d = new Date(+p[0], +p[1] - 1, +p[2]);
    var w = ['日','月','火','水','木','金','土'][d.getDay()];
    return (+p[1]) + '月' + (+p[2]) + '日（' + w + '）';
  }
  function fmtTime(ts) {
    if (!ts) return '';
    var d = new Date(ts);
    return pad(d.getHours()) + ':' + pad(d.getMinutes());
  }
  function fmtDuration(ms) {
    var m = Math.round(ms / 60000);
    if (m < 60) return m + '分';
    return Math.floor(m / 60) + '時間' + (m % 60) + '分';
  }

  /* ---------------------------------------------------------
     4. 保存（localStorage）
     --------------------------------------------------------- */

  var store = load();

  function load() {
    var raw = null;
    try { raw = localStorage.getItem(STORE_KEY); } catch (e) { /* プライベートモード等 */ }
    var data = null;
    if (raw) { try { data = JSON.parse(raw); } catch (e) { data = null; } }
    if (!data || typeof data !== 'object' || !data.days) data = { version:1, days:{} };
    return data;
  }

  function save() {
    prune();
    try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch (e) { /* 保存できなくても動作は続ける */ }
  }

  function prune() {
    var keys = Object.keys(store.days).sort();           // 古い順
    while (keys.length > KEEP_DAYS) delete store.days[keys.shift()];
  }

  function today() {
    var key = logicalDate();
    if (!store.days[key]) {
      var items = {};
      CARDS.forEach(function (c) { items[c.no] = { state:'todo', log:[] }; });
      store.days[key] = { date:key, startedAt:null, completedAt:null, items:items };
      save();
    }
    var day = store.days[key];
    CARDS.forEach(function (c) {
      if (!day.items[c.no]) day.items[c.no] = { state:'todo', log:[] };
    });
    return day;
  }

  /* タップの記録。state を変えるたびに必ずここを通す */
  function record(no, action, extra) {
    var day  = today();
    var item = day.items[no];
    var now  = Date.now();

    var entry = { action:action, at:now };
    if (extra) for (var k in extra) entry[k] = extra[k];
    item.log.push(entry);

    if (action === 'done')        { item.state = 'done';    item.checkedAt  = now; }
    else if (action === 'pending'){ item.state = 'pending'; item.pendingAt  = now; }
    else if (action === 'release'){ item.state = 'done';    item.releasedAt = now; item.checkedAt = item.checkedAt || now; }
    else if (action === 'undo')   { item.state = 'todo';    item.checkedAt  = null; item.pendingAt = null; }

    if (!day.startedAt) day.startedAt = now;
    save();
  }

  /* ---------------------------------------------------------
     5. 判定
     --------------------------------------------------------- */

  function stateOf(no){ return today().items[no].state; }

  function checkGate(no) {
    var need = REQUIRES[no];
    if (!need) return { ok:true };

    var pending = need.filter(function (n){ return stateOf(n) === 'pending'; });
    var todo    = need.filter(function (n){ return stateOf(n) === 'todo'; });

    if (pending.length) {
      return { ok:false,
        reason: pending.join('・') + '番が「チェック待ち」です。\n' +
                'おうちの人のOKが出てから、' + no + '番をチェックできます。' };
    }
    if (todo.length) {
      return { ok:false,
        reason: todo.join('・') + '番がまだ終わっていません。\n' +
                '先に ' + todo[0] + '番をすませましょう。' };
    }
    return { ok:true };
  }

  function doneCount(){
    return CARDS.filter(function (c){ return stateOf(c.no) === 'done'; }).length;
  }
  function allDone(){ return doneCount() === CARDS.length; }
  function anyActionable(){
    return CARDS.some(function (c){ return stateOf(c.no) === 'todo' && checkGate(c.no).ok; });
  }
  function pendingList(){
    return CARDS.filter(function (c){ return stateOf(c.no) === 'pending'; });
  }

  /* ---------------------------------------------------------
     6. 画面の部品
     --------------------------------------------------------- */

  var $ = function (id){ return document.getElementById(id); };

  var el = {
    headDate:  $('headDate'),
    dots:      $('dots'),
    gaugeFill: $('gaugeFill'),
    gaugeText: $('gaugeText'),
    screenCard:$('screenCard'),
    screenRem: $('screenRemaining'),
    screenDone:$('screenDone'),
    card:      $('card'),
    cardNo:    $('cardNo'),
    cardTitle: $('cardTitle'),
    cardArt:   $('cardArt'),
    cardStatus:$('cardStatus'),
    cardStage: $('cardStage'),
    blockNote: $('blockNote'),
    btnDone:   $('btnDone'),
    btnPending:$('btnPending'),
    btnSkip:   $('btnSkip'),
    btnUndo:   $('btnUndo'),
    btnPrev:   $('btnPrev'),
    btnNext:   $('btnNext'),
    remList:   $('remainingList'),
    btnBack:   $('btnBackToCards'),
    doneInner: $('doneInner'),
    celebrate: $('celebrate'),
    btnComplete:$('btnComplete'),
    btnReview: $('btnReview'),
    doneTitle: $('doneTitle'),
    doneStats: $('doneStats'),
    stampRow:  $('stampRow'),
    btnParent: $('btnParent'),
    btnMotion: $('btnMotion'),
    badge:     $('pendingBadge'),
    modal:     $('parentModal'),
    btnClose:  $('btnCloseParent'),
    confetti:  $('confetti')
  };

  var cur = 0;
  var lastDayKey = logicalDate();
  var praiseIdx = 0;

  function cardAt(i){ return CARDS[i]; }

  function firstOpenIndex() {
    for (var i = 0; i < CARDS.length; i++) {
      if (today().items[CARDS[i].no].state === 'todo') return i;
    }
    return 0;
  }

  function gotoNextOpen(dir) {
    var n = CARDS.length;
    for (var step = 1; step <= n; step++) {
      var i = (cur + dir * step + n * 2) % n;
      if (today().items[CARDS[i].no].state === 'todo') { show(i, dir); return true; }
    }
    return false;
  }

  function show(i, dir) { cur = i; render(dir); }

  /* ---------------------------------------------------------
     7. 描画
     --------------------------------------------------------- */

  function render(dir) {
    var k = logicalDate();
    if (k !== lastDayKey) { lastDayKey = k; today(); cur = firstOpenIndex(); }

    el.headDate.textContent = fmtDateLabel(k);
    renderDots();
    renderGauge();
    renderBadge();

    if (allDone()) { showDone(); return; }

    el.screenCard.hidden = false;
    el.screenRem.hidden  = true;
    el.screenDone.hidden = true;

    var c  = cardAt(cur);
    var st = stateOf(c.no);
    var gate = checkGate(c.no);

    el.card.style.setProperty('--c-main', 'var(--' + c.color + ')');
    el.card.style.setProperty('--c-bg',   'var(--' + c.color + '-bg)');
    el.cardNo.textContent    = c.no;
    el.cardTitle.textContent = c.title;
    renderArt(c);

    if (st === 'done') {
      el.cardStatus.hidden = false;
      el.cardStatus.className = 'card-status s-done';
      el.cardStatus.textContent = 'できました（' + fmtTime(today().items[c.no].checkedAt) + '）';
    } else if (st === 'pending') {
      el.cardStatus.hidden = false;
      el.cardStatus.className = 'card-status s-pending';
      el.cardStatus.textContent = 'チェック待ち（' + fmtTime(today().items[c.no].pendingAt) + '）';
    } else {
      el.cardStatus.hidden = true;
    }

    el.card.classList.toggle('is-done', st === 'done');
    el.card.classList.toggle('is-pending', st === 'pending');
    el.card.classList.toggle('is-locked', st === 'todo' && !gate.ok);

    if (st === 'todo' && !gate.ok) {
      el.blockNote.hidden = false;
      el.blockNote.textContent = gate.reason;
    } else {
      el.blockNote.hidden = true;
    }

    var isTodo = (st === 'todo');
    el.btnDone.hidden    = !(isTodo && gate.ok);
    el.btnPending.hidden = !(isTodo && gate.ok);
    el.btnSkip.hidden    = !(isTodo && !gate.ok);
    el.btnUndo.hidden    = isTodo;

    el.btnUndo.querySelector('span:last-child').textContent =
      (st === 'pending') ? 'チェック待ちをやめる' : 'まちがえた（もどす）';

    // カードの入れ替わり（ドリーイン風：少し奥から手前に寄ってくる）
    if (dir) {
      el.card.classList.remove('enter-right', 'enter-left');
      void el.card.offsetWidth;
      el.card.classList.add(dir > 0 ? 'enter-right' : 'enter-left');
    }
  }

  /* 画像は webp →（だめなら）jpg →（それもなければ）絵文字 */
  var artCache = {};   // no -> Image | false

  function renderArt(c) {
    el.cardArt.innerHTML = '';

    if (artCache[c.no] instanceof Image) {
      el.cardArt.appendChild(artCache[c.no].cloneNode());
      return;
    }

    var span = document.createElement('span');
    span.className = 'emoji';
    span.textContent = c.emoji;
    el.cardArt.appendChild(span);

    if (artCache[c.no] === false) return;

    var srcs = ['assets/card' + c.no + '.webp', 'assets/card' + c.no + '.jpg'];
    (function attempt(i) {
      if (i >= srcs.length) { artCache[c.no] = false; return; }
      var img = new Image();
      img.alt = '';
      img.decoding = 'async';
      img.onload = function () {
        artCache[c.no] = img;
        if (cardAt(cur).no === c.no && !el.screenCard.hidden) {
          el.cardArt.innerHTML = '';
          el.cardArt.appendChild(img.cloneNode());
        }
      };
      img.onerror = function () { attempt(i + 1); };
      img.src = srcs[i];
    })(0);
  }

  /* 先に読み込んでおくと、次のカードで絵が一瞬遅れない */
  function preloadArt() {
    CARDS.forEach(function (c) {
      if (artCache[c.no] !== undefined) return;
      var img = new Image();
      img.onload  = function () { artCache[c.no] = img; };
      img.onerror = function () {
        var j = new Image();
        j.onload  = function () { artCache[c.no] = j; };
        j.onerror = function () { artCache[c.no] = false; };
        j.src = 'assets/card' + c.no + '.jpg';
      };
      img.src = 'assets/card' + c.no + '.webp';
    });
  }

  function renderDots() {
    var prev = {};
    Array.prototype.forEach.call(el.dots.children, function (b) {
      prev[b.dataset.no] = b.className;
    });

    el.dots.innerHTML = '';
    CARDS.forEach(function (c, i) {
      var b = document.createElement('button');
      b.className = 'dot';
      b.dataset.no = c.no;
      b.textContent = c.no;
      b.setAttribute('aria-label', c.no + '番：' + c.title);
      var st = stateOf(c.no);
      if (st === 'done')    b.classList.add('is-done');
      if (st === 'pending') b.classList.add('is-pending');
      if (st === 'todo' && !checkGate(c.no).ok) b.classList.add('is-locked');
      if (i === cur && !allDone()) b.classList.add('is-current');

      // 「まだ」→「できた」に変わった番号だけ、くるっと回して知らせる
      var was = prev[c.no];
      if (was !== undefined && was.indexOf('is-done') === -1 && st === 'done') {
        b.classList.add('just-done');
      }
      b.addEventListener('click', function () { show(i, i > cur ? 1 : -1); });
      el.dots.appendChild(b);
    });
  }

  /* 進み具合のゲージ（インフォグラフィック・アニメーション） */
  function renderGauge() {
    var n = doneCount(), total = CARDS.length;
    el.gaugeFill.style.width = (n / total * 100) + '%';
    el.gaugeFill.classList.toggle('is-full', n === total);
    if (n === 0)            el.gaugeText.textContent = 'ぜんぶで ' + total + 'こ';
    else if (n === total)   el.gaugeText.textContent = 'ぜんぶ できた！';
    else                    el.gaugeText.textContent = n + ' / ' + total + '　あと ' + (total - n) + 'こ';
  }

  function renderBadge() {
    var n = pendingList().length;
    el.badge.hidden = (n === 0);
    el.badge.textContent = n;
  }

  /* ---------------------------------------------------------
     8. 操作に対する反応（フィードバック）
     --------------------------------------------------------- */

  /* 大きなスタンプ */
  function stamp(kind) {
    var s = document.createElement('div');
    s.className = 'stamp ' + (kind === 'done' ? 's-done' : 's-pending');
    s.textContent = (kind === 'done' ? '✓' : '⏳');
    el.cardStage.appendChild(s);
    setTimeout(function () { s.remove(); }, 620);
  }

  /* ほめことば（キネティックタイポグラフィー：一文字ずつ出る） */
  function praise() {
    if (!motionOn) return;
    var text = PRAISE[praiseIdx % PRAISE.length];
    praiseIdx++;
    var box = document.createElement('div');
    box.className = 'praise';
    text.split('').forEach(function (ch, i) {
      var sp = document.createElement('span');
      sp.textContent = ch;
      sp.style.animationDelay = (i * 0.05) + 's';
      box.appendChild(sp);
    });
    el.cardStage.appendChild(box);
    setTimeout(function () { box.remove(); }, 1400);
  }

  /* キラキラがはじける */
  function sparkle(n) {
    if (!motionOn) return;
    var box = document.createElement('div');
    box.className = 'sparkles';
    for (var i = 0; i < (n || 12); i++) {
      var s = document.createElement('i');
      var a = (Math.PI * 2 * i) / (n || 12) + Math.random() * 0.4;
      var d = 70 + Math.random() * 70;
      s.style.setProperty('--dx', Math.cos(a) * d + 'px');
      s.style.setProperty('--dy', Math.sin(a) * d + 'px');
      s.style.animationDelay = (Math.random() * 0.12) + 's';
      box.appendChild(s);
    }
    el.cardStage.appendChild(box);
    setTimeout(function () { box.remove(); }, 1000);
  }

  /* カードがひとつ弾む */
  function bump(cls) {
    el.card.classList.remove('bump-done', 'bump-pending');
    void el.card.offsetWidth;
    el.card.classList.add(cls);
    setTimeout(function () { el.card.classList.remove(cls); }, 600);
  }

  /* ---------------------------------------------------------
     9. のこり画面 / 完了画面
     --------------------------------------------------------- */

  function showRemaining() {
    el.screenCard.hidden = true;
    el.screenDone.hidden = true;
    el.screenRem.hidden  = false;

    el.remList.innerHTML = '';
    CARDS.forEach(function (c, i) {
      var st = stateOf(c.no);
      if (st === 'done') return;
      var li = document.createElement('li');
      var b  = document.createElement('button');
      b.className = 'remain-item' + (st === 'pending' ? ' r-pending' : '');
      b.style.animationDelay = (el.remList.children.length * 0.06) + 's';
      b.innerHTML = '<span class="rno">' + c.no + '</span>';
      var tx = document.createElement('span');
      var suffix = '';
      if (st === 'pending') suffix = '（チェック待ち）';
      else if (!checkGate(c.no).ok) suffix = '（ほかの番号がすむまで待ち）';
      tx.textContent = c.title + suffix;
      b.appendChild(tx);
      b.addEventListener('click', function () { show(i, 1); });
      li.appendChild(b);
      el.remList.appendChild(li);
    });
  }

  function showDone() {
    renderDots();
    renderGauge();
    renderBadge();
    el.screenCard.hidden = true;
    el.screenRem.hidden  = true;
    el.screenDone.hidden = false;

    var day = today();
    if (day.completedAt) {
      el.doneInner.hidden = true;
      el.celebrate.hidden = false;
      kineticTitle('ぜんぶ おわりました！');
      el.doneStats.textContent = statsText(day);
      renderStampRow(day);
    } else {
      el.doneInner.hidden = false;
      el.celebrate.hidden = true;
    }
  }

  /* 完了の見出しを一文字ずつ出す（短時間で終わらせ、読みは妨げない） */
  function kineticTitle(text) {
    el.doneTitle.innerHTML = '';
    if (!motionOn) { el.doneTitle.textContent = text; return; }
    text.split('').forEach(function (ch, i) {
      var sp = document.createElement('span');
      sp.className = 'kt';
      sp.textContent = (ch === ' ' ? ' ' : ch);
      sp.style.animationDelay = (0.25 + i * 0.045) + 's';
      el.doneTitle.appendChild(sp);
    });
  }

  /* きょうのスタンプ（9枚のミニ絵が順に並ぶ） */
  function renderStampRow(day) {
    el.stampRow.innerHTML = '';
    CARDS.forEach(function (c, i) {
      var d = document.createElement('div');
      d.className = 'mini';
      d.style.animationDelay = (0.5 + i * 0.07) + 's';
      d.title = c.no + '　' + fmtTime(day.items[c.no].checkedAt);
      var art = artCache[c.no];
      if (art instanceof Image) {
        var im = art.cloneNode(); im.alt = '';
        d.appendChild(im);
      } else {
        d.textContent = c.emoji;
      }
      var tick = document.createElement('span');
      tick.className = 'mini-tick';
      tick.textContent = '✓';
      d.appendChild(tick);
      el.stampRow.appendChild(d);
    });
  }

  function statsText(day) {
    var lines = [];
    if (day.startedAt && day.completedAt) {
      lines.push('はじめ ' + fmtTime(day.startedAt) + '  →  おわり ' + fmtTime(day.completedAt));
      lines.push('かかった時間：' + fmtDuration(day.completedAt - day.startedAt));
    }
    return lines.join('\n');
  }

  /* ---------------------------------------------------------
     10. 紙吹雪
     --------------------------------------------------------- */

  function confetti() {
    if (!motionOn) return;
    var cv = el.confetti;
    cv.hidden = false;
    var ctx = cv.getContext('2d');
    var dpr = window.devicePixelRatio || 1;
    cv.width  = cv.clientWidth  * dpr;
    cv.height = cv.clientHeight * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    var W = cv.clientWidth, H = cv.clientHeight;
    var colors = ['#3a7bd5', '#2f9e63', '#e8a33d', '#d75b86', '#7d62c7', '#2f9aa6'];
    var bits = [];
    for (var i = 0; i < 130; i++) {
      bits.push({
        x: Math.random() * W,
        y: -20 - Math.random() * H * 0.7,
        w: 7 + Math.random() * 7,
        h: 10 + Math.random() * 10,
        vy: 1.6 + Math.random() * 2.8,
        vx: -0.9 + Math.random() * 1.8,
        rot: Math.random() * Math.PI,
        vr: -0.1 + Math.random() * 0.2,
        c: colors[(Math.random() * colors.length) | 0]
      });
    }

    var end = Date.now() + 4200;
    (function frame() {
      ctx.clearRect(0, 0, W, H);
      bits.forEach(function (b) {
        b.x += b.vx; b.y += b.vy; b.rot += b.vr;
        ctx.save();
        ctx.translate(b.x, b.y);
        ctx.rotate(b.rot);
        ctx.fillStyle = b.c;
        ctx.fillRect(-b.w / 2, -b.h / 2, b.w, b.h);
        ctx.restore();
      });
      if (Date.now() < end) {
        requestAnimationFrame(frame);
      } else {
        ctx.clearRect(0, 0, W, H);
        cv.hidden = true;
      }
    })();
  }

  /* ---------------------------------------------------------
     11. 保護者用モーダル
     --------------------------------------------------------- */

  function openParent(tab) {
    el.modal.hidden = false;
    selectTab(tab || 'pending');
  }
  function closeParent() {
    el.modal.hidden = true;
    render();
  }

  function selectTab(name) {
    Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (t) {
      t.classList.toggle('is-active', t.dataset.tab === name);
    });
    Array.prototype.forEach.call(document.querySelectorAll('.tab-panel'), function (p) {
      p.hidden = (p.dataset.panel !== name);
    });
    if (name === 'pending') renderPendingPanel();
    if (name === 'today')   renderTodayPanel();
    if (name === 'history') renderHistoryPanel();
  }

  function renderPendingPanel() {
    var box = document.querySelector('.tab-panel[data-panel="pending"]');
    box.innerHTML = '';
    var list = pendingList();
    if (!list.length) {
      box.innerHTML = '<p class="p-empty">チェック待ちはありません。</p>';
      return;
    }
    list.forEach(function (c) {
      var item = today().items[c.no];
      var row = document.createElement('div');
      row.className = 'p-row';
      row.innerHTML =
        '<span class="rno">' + c.no + '</span>' +
        '<span class="p-text">' +
          '<span class="p-title"></span>' +
          '<span class="p-time">' + fmtTime(item.pendingAt) + ' に申し出</span>' +
        '</span>';
      row.querySelector('.p-title').textContent = c.title;
      var ok = document.createElement('button');
      ok.className = 'p-ok';
      ok.textContent = 'OK';
      ok.addEventListener('click', function () {
        record(c.no, 'release', { by:'parent' });
        row.classList.add('released');
        setTimeout(function () { renderPendingPanel(); renderBadge(); }, 320);
      });
      row.appendChild(ok);
      box.appendChild(row);
    });
  }

  function renderTodayPanel() {
    document.querySelector('.tab-panel[data-panel="today"]').innerHTML = dayDetailHTML(today(), true);
  }

  function renderHistoryPanel() {
    var box = document.querySelector('.tab-panel[data-panel="history"]');
    var keys = Object.keys(store.days).sort().reverse();
    if (!keys.length) { box.innerHTML = '<p class="p-empty">記録はまだありません。</p>'; return; }
    box.innerHTML = keys.map(function (k) {
      var day  = store.days[k];
      var done = CARDS.filter(function (c){ return day.items[c.no] && day.items[c.no].state === 'done'; }).length;
      var cls  = (done === CARDS.length) ? 'ok' : (done ? 'ng' : '');
      return '<details class="h-day">' +
               '<summary>' + fmtDateLabel(k) +
                 '<span class="h-chip ' + cls + '">' + done + ' / ' + CARDS.length + '</span>' +
               '</summary>' + dayDetailHTML(day, false) +
             '</details>';
    }).join('');
  }

  function dayDetailHTML(day, withHead) {
    var rows = CARDS.map(function (c) {
      var it = (day.items && day.items[c.no]) || { state:'todo' };
      var label = it.state === 'done' ? 'できた' : (it.state === 'pending' ? 'チェック待ち' : 'まだ');
      var t = it.state === 'done'    ? fmtTime(it.checkedAt)
            : it.state === 'pending' ? fmtTime(it.pendingAt) : '';
      var extra = (it.releasedAt ? '（保護者OK ' + fmtTime(it.releasedAt) + '）' : '');
      return '<li>' +
               '<span class="hn">' + c.no + '</span>' +
               '<span class="h-state ' + it.state + '">' + label + '</span>' +
               '<span class="ht">' + t + extra + '</span>' +
             '</li>';
    }).join('');

    var head = '';
    if (withHead) {
      head = '<p class="remain-note">' +
             (day.startedAt ? 'はじめ ' + fmtTime(day.startedAt) : 'まだ始まっていません') +
             (day.completedAt ? '　／　完了 ' + fmtTime(day.completedAt) : '') + '</p>';
    }
    return head + '<ul class="h-list">' + rows + '</ul>';
  }

  /* ---------------------------------------------------------
     12. 操作
     --------------------------------------------------------- */

  el.btnDone.addEventListener('click', function () {
    var c = cardAt(cur);
    if (!checkGate(c.no).ok) { render(); return; }
    record(c.no, 'done');
    stamp('done'); sparkle(14); praise(); bump('bump-done');
    renderDots(); renderGauge();
    setTimeout(function () {
      if (allDone()) { showDone(); return; }
      if (!gotoNextOpen(1)) { renderBadge(); showRemaining(); }
    }, motionOn ? 760 : 200);
  });

  el.btnPending.addEventListener('click', function () {
    var c = cardAt(cur);
    record(c.no, 'pending');
    stamp('pending'); bump('bump-pending');
    renderDots(); renderGauge(); renderBadge();
    setTimeout(function () {
      if (!gotoNextOpen(1)) { showRemaining(); }
    }, motionOn ? 620 : 200);
  });

  el.btnSkip.addEventListener('click', function () {
    if (!anyActionable()) { renderDots(); renderBadge(); showRemaining(); return; }
    if (!gotoNextOpen(1)) showRemaining();
  });

  el.btnUndo.addEventListener('click', function () {
    record(cardAt(cur).no, 'undo');
    render();
  });

  el.btnPrev.addEventListener('click', function () { show((cur + CARDS.length - 1) % CARDS.length, -1); });
  el.btnNext.addEventListener('click', function () { show((cur + 1) % CARDS.length, 1); });
  el.btnBack.addEventListener('click', function () { show(firstOpenIndex(), 1); });

  el.btnComplete.addEventListener('click', function () {
    var day = today();
    day.completedAt = Date.now();
    save();
    showDone();
    confetti();
  });

  el.btnReview.addEventListener('click', function () { openParent('today'); });
  el.btnParent.addEventListener('click', function () { openParent('pending'); });
  el.btnClose.addEventListener('click', closeParent);
  el.modal.addEventListener('click', function (e) { if (e.target === el.modal) closeParent(); });

  el.btnMotion.addEventListener('click', function () {
    motionOn = !motionOn;
    try { localStorage.setItem(MOTION_KEY, motionOn ? 'on' : 'off'); } catch (e) {}
    applyMotion();
  });

  Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (t) {
    t.addEventListener('click', function () { selectTab(t.dataset.tab); });
  });

  // 左右スワイプでカードを送る
  (function swipe() {
    var x0 = null, y0 = null;
    el.cardStage.addEventListener('touchstart', function (e) {
      x0 = e.touches[0].clientX; y0 = e.touches[0].clientY;
    }, { passive:true });
    el.cardStage.addEventListener('touchend', function (e) {
      if (x0 === null) return;
      var dx = e.changedTouches[0].clientX - x0;
      var dy = e.changedTouches[0].clientY - y0;
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy)) {
        if (dx < 0) show((cur + 1) % CARDS.length, 1);
        else        show((cur + CARDS.length - 1) % CARDS.length, -1);
      }
      x0 = y0 = null;
    }, { passive:true });
  })();

  setInterval(function () { if (logicalDate() !== lastDayKey) render(); }, 60000);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) render(); });

  /* ---------------------------------------------------------
     13. 起動
     --------------------------------------------------------- */

  motionOn = loadMotion();
  applyMotion();
  today();
  save();                 // 起動時に 31 日より古い記録を捨てる
  cur = firstOpenIndex();
  render();
  preloadArt();

  // デバッグ・検品用
  window.__routine = {
    store: store,
    reset: function () { try { localStorage.removeItem(STORE_KEY); } catch (e) {} location.reload(); },
    set: function (no, action) { record(no, action); render(); },
    motion: function (on) { motionOn = !!on; applyMotion(); }
  };
})();
