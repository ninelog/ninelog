/**
 * 画面の共通部品（C-3）：ヘッダー、ボタンの送信中の表示、エラーと成功のお知らせ
 *
 * 各ページの書き方：
 *   <div id="nl-header"></div>
 *   <main class="nl-main">
 *     <div id="nl-alert" hidden></div>   ← 画面全体に関わるお知らせ（通信できないなど）だけを出す場所
 *     …ボタンを押した結果は、NinelogUI.showOk(文, 四角) / showError(エラー, 四角) で、その四角の一番下に出る…
 *     …画面の中身…
 *   </main>
 *   <script src="https://static.line-scdn.net/liff/edge/2/sdk.js"></script>
 *   <script src="js/config.js"></script>
 *   <script src="js/liff-app.js"></script>
 *   <script src="js/ui.js"></script>
 *   <script>
 *     NinelogUI.boot('input', '成績を入力', function () { … LINEの準備ができたあとにすること … });
 *   </script>
 */
const NinelogUI = (function () {
  // 4つの画面（リッチメニューと同じ並び。3.4章）
  const PAGES = [
    { key: 'input', href: 'input.html', label: '成績を入力' },
    { key: 'mystats', href: 'mystats.html', label: '自分の成績' },
    { key: 'ranking', href: 'ranking.html', label: 'ランキング' },
    { key: 'team', href: 'team.html', label: 'チーム・設定' },
  ];

  /** 画面の上の帯（アプリ名・画面名・4つの画面の切り替え）を作る */
  function renderHeader(pageKey, title) {
    const header = document.getElementById('nl-header');
    if (!header) return;
    header.className = 'nl-header';
    header.innerHTML = '';

    const bar = el('div', 'nl-header__bar');
    const brand = el('a', 'nl-header__brand', 'ナインログ');
    brand.href = 'index.html';
    bar.appendChild(brand);
    bar.appendChild(el('span', 'nl-header__sep', '｜'));
    bar.appendChild(el('h1', 'nl-header__title', title));
    header.appendChild(bar);

    const nav = el('nav', 'nl-nav');
    nav.setAttribute('aria-label', '画面の切り替え');
    PAGES.forEach(function (p) {
      const a = el('a', '', p.label);
      a.href = p.href;
      if (p.key === pageKey) a.setAttribute('aria-current', 'page');
      nav.appendChild(a);
    });
    header.appendChild(nav);
    document.title = title + '｜ナインログ';
  }

  /**
   * 画面の準備：ヘッダーを出し、LINEの準備（LIFF）をしてから onReady を呼ぶ。
   * 途中でうまくいかなかったら、エラーのお知らせを出す。
   */
  function boot(pageKey, title, onReady, options) {
    renderHeader(pageKey, title);
    setupSwipe(pageKey);
    if (typeof liff === 'undefined' || typeof NinelogApp === 'undefined') {
      showError({ message: '画面の部品を読み込めませんでした。電波のよい場所で、開き直してください' });
      return;
    }
    // 最初に出している「読み込み中です…」に、くるくると5秒の切り替えを付ける
    document.querySelectorAll('.nl-loading').forEach(function (p) { enhanceLoading(p); });
    const useSnapshot = Boolean(options && options.snapshot); // 前回の画面をすぐ出すか（見るだけの画面だけ。B-24 案A）
    if (useSnapshot) dropOldSnapshots();
    // 「試合の詳細」から「もどる」で戻ってきたときは、開く前の状態と位置に戻す（2026-11-15）。
    // そのときは、前回の画面（案A）は出さない（新しい中身を開く前の位置に出すため。ぶつからないように）
    const returned = takeReturn(pageKey, title || pageKey);
    if (returned && 'scrollRestoration' in history) history.scrollRestoration = 'manual';
    // ページがそのまま残っていて、戻る操作で見せ直されたとき（ページの読み直しが無いとき）も、位置を戻す
    window.addEventListener('pageshow', function (e) {
      if (!e.persisted) return;
      const saved = readReturn(pageKey);
      if (saved) restoreScroll(saved, title || pageKey, 'ページがそのまま残っていた');
    });
    NinelogApp.start()
      .then(function (ready) {
        if (!ready || !onReady) return null;
        return (useSnapshot && !returned ? snapUserKey() : Promise.resolve(null)).then(function (userKey) {
          const removeSnapshot = userKey ? showSnapshot(pageKey, userKey) : null;
          if (removeSnapshot && NinelogApp.recordTiming) {
            NinelogApp.recordTiming('画面：' + (title || pageKey) + '（前回の内容）', performance.now(), true);
          }
          return Promise.resolve(onReady(returned ? returned.state : null)).then(function () {
            if (removeSnapshot) removeSnapshot();
            if (returned) restoreScroll(returned, title || pageKey, returnDetail(returned.state));
            // 画面を開いてから、中身が出るまでの時間を残す（「接続の確認」の画面で見られる）
            if (NinelogApp.recordTiming) NinelogApp.recordTiming('画面：' + (title || pageKey), performance.now(), true);
            if (useSnapshot) snapUserKey().then(function (key) { if (key) keepSnapshot(pageKey, key); });
          }, function (err) {
            if (removeSnapshot) removeSnapshot();
            throw err;
          });
        });
      })
      .catch(showError);
  }

  /* ---------- お知らせ ----------
   * 決まり（2026-11-14 利用者が決定。CLAUDE.md 11.3章）：
   * - ボタンを押した結果（成功は緑・エラーは赤）は、押したボタンがある四角（scope）の中の一番下に出す。
   * - 画面の一番上（#nl-alert）は、通信できない・本人確認ができないなど、画面全体に関わるときだけ使う。
   *   scope を渡さなかったときと、下の PAGE_WIDE_CODES のエラーは、画面の一番上に出す。
   */
  const PAGE_WIDE_CODES = ['NETWORK', 'TOKEN_MISSING', 'TOKEN_EXPIRED', 'TOKEN_INVALID', 'CONFIG_MISSING', 'LINE_UNAVAILABLE'];

  /**
   * エラーのお知らせを出す。err は NinelogApp.call が投げたエラー（code・message・details を持つ）。
   * scope：押したボタンがある四角（form や section）。入力チェックのエラー（VALIDATION_ERROR）は、
   *        項目ごとの説明を、その四角の中の入力欄の近くにも出す。
   */
  function showError(err, scope) {
    const pageWide = !scope || PAGE_WIDE_CODES.indexOf(err && err.code) !== -1;
    const box = pageWide ? topBox() : localBox(scope);
    if (!box) return;
    box.className = 'nl-alert nl-alert--error';
    box.setAttribute('role', 'alert');
    box.innerHTML = '';
    box.appendChild(document.createTextNode(messageOf(err)));

    const details = (err && err.details) || [];
    const unplaced = scope ? showFieldErrors(scope, details) : details;
    if (unplaced.length > 0) {
      const ul = document.createElement('ul');
      unplaced.forEach(function (d) { ul.appendChild(el('li', '', d.message)); });
      box.appendChild(ul);
    }
    box.hidden = false;
    box.scrollIntoView({ behavior: 'smooth', block: pageWide ? 'center' : 'nearest' });
  }

  /** 成功のお知らせを、scope（押したボタンがある四角）の中の一番下に出す（例：「登録しました」） */
  function showOk(message, scope) {
    const box = scope ? localBox(scope) : topBox();
    if (!box) return;
    box.className = 'nl-alert nl-alert--ok';
    box.setAttribute('role', 'status');
    box.textContent = message;
    box.hidden = false;
    box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  /**
   * お知らせを消す：画面の一番上のお知らせと、scope の中のお知らせ・入力欄の近くのエラー。
   * ボタンを押したときの最初に呼ぶ（前の結果が残らないように）。
   */
  function clearAlerts(scope) {
    const top = topBox();
    if (top) { top.hidden = true; top.innerHTML = ''; }
    if (scope) {
      scope.querySelectorAll('[data-nl-local-alert]').forEach(function (n) { n.hidden = true; n.innerHTML = ''; });
      clearFieldErrors(scope);
    }
  }

  /** scope の中の一番下に置く、お知らせの場所（無ければ作る） */
  function localBox(scope) {
    let box = scope.querySelector(':scope > [data-nl-local-alert]');
    if (!box) {
      box = el('div', 'nl-alert');
      box.setAttribute('data-nl-local-alert', '');
    }
    scope.appendChild(box); // いつも一番下に置く
    return box;
  }

  /** エラーの理由ごとの、利用者向けの文（GASの文があればそれを使う） */
  function messageOf(err) {
    const code = err && err.code;
    if (code === 'BUSY') return '混み合っています。少し待ってから、もう一度お試しください';
    if (code === 'EDIT_PERIOD_OVER') return '入力・修正の期限を過ぎています';
    if (code === 'TOKEN_EXPIRED' || code === 'TOKEN_INVALID' || code === 'TOKEN_MISSING') {
      return 'LINEの本人確認がうまくいきませんでした。画面を閉じて、開き直してください';
    }
    if (code === 'INTERNAL') return 'サーバーで想定外のエラーが起きました。時間をおいて、もう一度お試しください';
    if (err && err.message) return err.message;
    return 'うまくいきませんでした。もう一度お試しください';
  }

  /* ---------- 入力欄の近くのエラー（VALIDATION_ERROR の details） ---------- */

  /**
   * details の各項目を、name が同じ入力欄の下に出す。
   * @return {Array} 置き場所が見つからなかった項目（お知らせの中に並べる）
   */
  function showFieldErrors(form, details) {
    clearFieldErrors(form);
    const unplaced = [];
    details.forEach(function (d) {
      const input = d.field ? form.querySelector('[name="' + d.field + '"]') : null;
      if (!input) { unplaced.push(d); return; }
      input.classList.add('nl-input--error');
      input.setAttribute('aria-invalid', 'true');
      const msg = el('div', 'nl-field-error', d.message);
      msg.setAttribute('data-nl-field-error', '');
      // －・＋の付いた数の欄（.nl-step。C-4）では、欄の組のうしろ（行の下）に出す
      (input.closest('.nl-step') || input.closest('.nl-score') || input).insertAdjacentElement('afterend', msg);
    });
    return unplaced;
  }

  function clearFieldErrors(form) {
    form.querySelectorAll('[data-nl-field-error]').forEach(function (n) { n.remove(); });
    form.querySelectorAll('.nl-input--error').forEach(function (n) {
      n.classList.remove('nl-input--error');
      n.removeAttribute('aria-invalid');
    });
  }

  /* ---------- ボタン ---------- */

  /**
   * ボタンを押したときの処理：送信中はボタンを押せなくして、くるくるを出す（2回押し防止）。
   * work は Promise を返す関数。終わったらボタンを元に戻す。
   */
  function withBusy(button, work) {
    if (button.disabled) return Promise.resolve();
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    // ボタンの中を「くるくる＋読み込み中…」にする（終わったら元の文字に戻す。2026-11-14 利用者が追加）
    const saved = Array.prototype.slice.call(button.childNodes);
    const label = el('span', 'nl-busy-label', LOADING_TEXT);
    const marker = el('span', 'nl-busy-inner');
    marker.appendChild(spinner());
    marker.appendChild(label);
    button.textContent = '';
    button.appendChild(marker);
    const timer = slowTimer(label);
    return Promise.resolve()
      .then(work)
      .finally(function () {
        clearTimeout(timer);
        button.disabled = false;
        button.removeAttribute('aria-busy');
        // 処理の中でボタンの文字が書き換えられていたら（「保存する」→「直す」など）、それを残す
        if (button.contains(marker)) {
          button.textContent = '';
          saved.forEach(function (n) { button.appendChild(n); });
        }
      });
  }

  /* ---------- 読み込み中の表示（2026-11-14 利用者が追加） ---------- */

  const LOADING_TEXT = '読み込み中…';
  const SLOW_TEXT = '時間がかかっています。そのままお待ちください';
  const SLOW_MS = 5000; // これ以上かかったら、文を変える

  /** くるくる回る印 */
  function spinner() {
    const s = el('span', 'nl-spinner');
    s.setAttribute('aria-hidden', 'true');
    return s;
  }

  /** 5秒たっても終わっていなければ、文を「時間がかかっています…」に変える */
  function slowTimer(label) {
    return setTimeout(function () {
      if (label.isConnected) label.textContent = SLOW_TEXT;
    }, SLOW_MS);
  }

  /**
   * 「くるくる＋読み込み中…」の行を作る（一覧などを読み込む間に、その場所に置く）。
   * text を渡すと、その文で出す（5秒たつと「時間がかかっています…」に変わる）。
   */
  function loadingEl(text) {
    const p = el('p', 'nl-loading');
    enhanceLoading(p, text || LOADING_TEXT);
    return p;
  }

  /** すでにある「読み込み中です…」の行に、くるくると5秒の切り替えを付ける */
  function enhanceLoading(p, text) {
    if (p.querySelector('.nl-spinner')) return;
    const label = el('span', 'nl-busy-label', text || p.textContent || LOADING_TEXT);
    p.textContent = '';
    p.appendChild(spinner());
    p.appendChild(label);
    p.setAttribute('role', 'status');
    slowTimer(label);
  }

  /**
   * 四角（container）を読み込み中にする：うすくして、見えている場所の真ん中に「くるくる＋読み込み中…」を出す。
   * 画面を切り替えたとき（年度・範囲・チームを選び直したときなど）に使う。
   * @return {Function} 読み込みが終わったら呼ぶ（表示を消す）
   */
  function busy(container) {
    const overlay = el('div', 'nl-busy');
    overlay.setAttribute('role', 'status');
    const pill = el('div', 'nl-busy__pill');
    const label = el('span', 'nl-busy-label', LOADING_TEXT);
    pill.appendChild(spinner());
    pill.appendChild(label);
    overlay.appendChild(pill);
    container.classList.add('is-loading');
    container.insertBefore(overlay, container.firstChild);
    const timer = slowTimer(label);
    return function done() {
      clearTimeout(timer);
      overlay.remove();
      if (!container.querySelector(':scope > .nl-busy')) container.classList.remove('is-loading');
    };
  }

  /* ---------- 前回の画面をすぐ出す（B-24 案A。2026-11-15 利用者が決定。11.10章） ----------
   * 見るだけの画面（「自分の成績」「ランキング」）で、前に見た画面の中身をこのスマホに覚えておき、
   * 次に開いたときは、新しい中身が届くまで「前回の内容です」と出しておく（押したりはできない）。
   * 決まり：
   * - 覚えるのは、画面に出ていた文字と形だけ。入力欄の中身（合言葉・表示名など）は覚えない。
   * - LINEのユーザーIDごとに分けて覚える（IDそのものは置かず、元に戻せない形にした目印を使う）。
   *   同じスマホでも、別のLINEアカウントには出ない。
   * - 7日たったら捨てる。チーム・大会を退会した・消したときは、このスマホの分をすべて捨てる。
   * - 覚えられない・読めないときは、今までどおり「読み込み中」を出すだけ。
   */
  const SNAP_PREFIX = 'ninelog_snap:';
  const SNAP_KEEP_MS = 7 * 24 * 60 * 60 * 1000; // 7日
  const SNAP_MAX_CHARS = 300000;                // これより大きい画面は覚えない（スマホの置き場所を使いすぎないように）

  /** このLINEアカウントの目印（LINEユーザーIDから作った SHA-256 の先頭32文字）。作れなければ null */
  function snapUserKey() {
    try {
      const token = liff.getDecodedIDToken && liff.getDecodedIDToken();
      if (!token || !token.sub || !window.crypto || !crypto.subtle || !window.TextEncoder) return Promise.resolve(null);
      return crypto.subtle.digest('SHA-256', new TextEncoder().encode('ninelog-snapshot:' + token.sub)).then(function (buf) {
        return Array.prototype.map.call(new Uint8Array(buf), function (b) { return ('0' + b.toString(16)).slice(-2); }).join('').slice(0, 32);
      }).catch(function () { return null; });
    } catch (e) {
      return Promise.resolve(null);
    }
  }

  function snapKey(userKey, pageKey) { return SNAP_PREFIX + userKey + ':' + pageKey; }

  /** このスマホに覚えた前回の画面のうち、7日を過ぎたもの（と読めないもの）を捨てる */
  function dropOldSnapshots() {
    try {
      const now = Date.now();
      const old = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k || k.indexOf(SNAP_PREFIX) !== 0) continue;
        let at = 0;
        try { at = JSON.parse(localStorage.getItem(k)).at || 0; } catch (e) { at = 0; }
        if (!(now - at < SNAP_KEEP_MS)) old.push(k);
      }
      old.forEach(function (k) { localStorage.removeItem(k); });
    } catch (e) { /* そのまま */ }
  }

  /** このスマホに覚えた前回の画面を、すべて捨てる（チーム・大会を退会した・消したとき） */
  function clearSnapshots() {
    try {
      const keys = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.indexOf(SNAP_PREFIX) === 0) keys.push(k);
      }
      keys.forEach(function (k) { localStorage.removeItem(k); });
    } catch (e) { /* そのまま */ }
  }

  /** 覚えた画面の中から、動きに関わるもの（on…の属性・javascript: のリンク・script）を取り除く（念のため） */
  function cleanSnapshot(root) {
    root.querySelectorAll('script, iframe, object, embed').forEach(function (n) { n.remove(); });
    root.querySelectorAll('*').forEach(function (n) {
      Array.prototype.slice.call(n.attributes).forEach(function (a) {
        const name = a.name.toLowerCase();
        if (name.indexOf('on') === 0 || name === 'id' || name === 'for' || name === 'name' || name === 'form') n.removeAttribute(a.name);
        else if ((name === 'href' || name === 'src' || name === 'action') && /^\s*javascript:/i.test(a.value)) n.removeAttribute(a.name);
      });
    });
  }

  /** 前回の画面を出す。出したら、消すための関数を返す（出さなければ null） */
  function showSnapshot(pageKey, userKey) {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(snapKey(userKey, pageKey)) || 'null'); } catch (e) { saved = null; }
    if (!saved || typeof saved.html !== 'string' || !(Date.now() - saved.at < SNAP_KEEP_MS)) return null;
    const main = document.querySelector('.nl-main');
    if (!main) return null;

    const wrap = el('div', 'nl-snapshot');
    const d = new Date(saved.at);
    const when = (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + d.getHours() + '時' + ('0' + d.getMinutes()).slice(-2) + '分';
    const note = el('p', 'nl-snapshot__note');
    note.setAttribute('role', 'status');
    note.appendChild(spinner());
    note.appendChild(el('span', 'nl-busy-label', '前回（' + when + '）の内容です。新しい内容を読み込んでいます…'));
    const body = el('div', 'nl-snapshot__body');
    body.setAttribute('inert', '');
    body.setAttribute('aria-hidden', 'true');
    // 中身は、このスマホでこの画面が作ったもの。念のため、動きに関わるものを取り除いてから出す
    const parsed = new DOMParser().parseFromString('<div>' + saved.html + '</div>', 'text/html').body.firstChild;
    cleanSnapshot(parsed);
    while (parsed.firstChild) body.appendChild(parsed.firstChild);
    wrap.appendChild(note);
    wrap.appendChild(body);

    const loading = document.getElementById('loading');
    if (loading) loading.hidden = true;
    main.insertBefore(wrap, loading ? loading.nextSibling : main.firstChild);
    return function remove() { wrap.remove(); };
  }

  /** いま画面に出ている中身を、前回の画面として覚える（読み込み中・エラーのときは覚えない） */
  function saveSnapshot(pageKey, userKey) {
    try {
      const main = document.querySelector('.nl-main');
      if (!main || main.querySelector('.nl-snapshot') || main.querySelector('.is-loading, .nl-busy')) return;
      const top = topBox();
      if (top && !top.hidden && top.classList.contains('nl-alert--error')) return;
      const clone = main.cloneNode(true);
      // 選択欄は、選んでいるものを残す（覚えないと、一番上の選択肢が出てしまう）
      const origSelects = main.querySelectorAll('select');
      clone.querySelectorAll('select').forEach(function (s, i) {
        const o = origSelects[i];
        Array.prototype.forEach.call(s.options, function (opt, j) {
          if (o && j === o.selectedIndex) opt.setAttribute('selected', ''); else opt.removeAttribute('selected');
        });
      });
      // グラフ（canvas）は絵を覚えられないので、同じ高さの空きにする
      const origCanvases = main.querySelectorAll('canvas');
      clone.querySelectorAll('canvas').forEach(function (c, i) {
        const box = el('div', 'nl-snapshot__chart');
        box.style.height = Math.round(origCanvases[i] ? origCanvases[i].getBoundingClientRect().height : 0) + 'px';
        c.replaceWith(box);
      });
      // 覚えないもの：お知らせ・読み込み中・隠れているもの・入力欄の中身
      clone.querySelectorAll('#nl-alert, #loading, [hidden], .nl-alert, .nl-busy, .nl-modal').forEach(function (n) { n.remove(); });
      clone.querySelectorAll('input, textarea').forEach(function (n) {
        n.removeAttribute('value');
        n.removeAttribute('checked');
        if (n.tagName === 'TEXTAREA') n.textContent = '';
      });
      cleanSnapshot(clone);
      const html = clone.innerHTML;
      if (!html.trim() || html.length > SNAP_MAX_CHARS) return;
      localStorage.setItem(snapKey(userKey, pageKey), JSON.stringify({ at: Date.now(), html: html }));
    } catch (e) { /* 覚えられなくても動く */ }
  }

  /** 画面を離れるとき（ほかの画面へ移る・閉じる・LINEに戻る）に、いまの中身を覚える */
  function keepSnapshot(pageKey, userKey) {
    const save = function () { saveSnapshot(pageKey, userKey); };
    setTimeout(save, 1500); // 中身が出そろったころに1回
    window.addEventListener('pagehide', save);
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') save(); });
  }

  /* ---------- 「試合の詳細」から戻ったときに、開く前の状態と位置に戻す（2026-11-15） ----------
   * 「試合の詳細」を開く直前に rememberReturn(画面, 状態) で、その画面の状態とスクロールの位置を覚える
   * （このタブの間だけ。sessionStorage）。戻る操作（「もどる」・スマホの戻る）で開き直したときだけ、
   * boot が takeReturn で取り出して、onReady(状態) に渡し、中身が出たあとに位置を戻す。
   * ふつうに開いたとき（上の帯の切り替え・リッチメニュー）は使わずに捨てる。1時間たったものも捨てる。
   */
  const RETURN_PREFIX = 'ninelog_return:';
  const RETURN_KEEP_MS = 60 * 60 * 1000;
  const RETURN_WAIT_MS = 5000; // 中身が出そろうのを待つ最長の時間

  /** 今のスクロールの位置（ブラウザによって取り方が違うので、いちばん大きいものを使う） */
  function currentScrollY() {
    return Math.max(window.scrollY || 0, window.pageYOffset || 0,
      (document.scrollingElement && document.scrollingElement.scrollTop) || 0);
  }

  /**
   * anchor：押したボタンがある行（data-return-anchor の付いた要素）。戻ったときは、ピクセルの位置ではなく、
   * その行が画面の同じ高さに来るように戻す（グラフや一覧の高さが、開き直したときに少し変わっても合うように）。
   */
  function rememberReturn(pageKey, state, anchorEl) {
    const anchor = anchorEl && anchorEl.closest ? anchorEl.closest('[data-return-anchor]') : null;
    try {
      sessionStorage.setItem(RETURN_PREFIX + pageKey, JSON.stringify({
        at: Date.now(),
        scrollY: currentScrollY(),
        anchor: anchor ? { key: anchor.getAttribute('data-return-anchor'), top: Math.round(anchor.getBoundingClientRect().top) } : null,
        state: state || {},
      }));
    } catch (e) { /* 覚えられなくても動く（戻ったときは一番上から） */ }
  }

  /** ページの開き方（navigate・reload・back_forward） */
  function navigationType() {
    try {
      const nav = performance.getEntriesByType && performance.getEntriesByType('navigation')[0];
      if (nav && nav.type) return nav.type;
      if (performance.navigation) return ['navigate', 'reload', 'back_forward'][performance.navigation.type] || 'navigate';
    } catch (e) { /* そのまま */ }
    return 'unknown';
  }

  function readReturn(pageKey) {
    let saved = null;
    try {
      saved = JSON.parse(sessionStorage.getItem(RETURN_PREFIX + pageKey) || 'null');
      sessionStorage.removeItem(RETURN_PREFIX + pageKey);
    } catch (e) { saved = null; }
    return saved && Date.now() - saved.at < RETURN_KEEP_MS ? saved : null;
  }

  function takeReturn(pageKey, title) {
    const saved = readReturn(pageKey);
    if (!saved) return null;
    const type = navigationType();
    if (type !== 'back_forward') {
      // 覚えた状態はあったが、戻る操作ではなかった（上の帯やリッチメニューから開いた）。確かめられるように記録に残す
      logReturn(title || pageKey, '戻さない：開き方 ' + type);
      return null;
    }
    return saved;
  }

  /** 戻したかどうかを「通信にかかった時間」の記録に残す（「接続の確認」の画面で見られる。中身は位置の数字だけ） */
  function logReturn(name, text) {
    if (typeof NinelogApp !== 'undefined' && NinelogApp.recordTiming) NinelogApp.recordTiming('もどる：' + name + '（' + text + '）', 0, true);
  }

  /**
   * スクロールの位置を戻す。
   * 中身（グラフ・一覧・カレンダー）は、スマホでは少しずつ遅れて広がるので、一度に戻さず、
   * 0.1秒ごとに「戻したい位置」と「ページの高さ」を見直し、位置が0.5秒続けて合ったら終わる（最長5秒）。
   * 途中で利用者が画面にさわったら、そこでやめる。
   */
  function restoreScroll(saved, name, detail) {
    const started = Date.now();
    let touched = false;
    let stable = 0;
    const mark = function () { touched = true; };
    window.addEventListener('touchstart', mark, { once: true, passive: true });
    window.addEventListener('wheel', mark, { once: true, passive: true });
    const targetY = function () {
      if (saved.anchor && saved.anchor.key) {
        const el = document.querySelector('[data-return-anchor="' + String(saved.anchor.key).replace(/"/g, '') + '"]');
        if (el) return Math.max(0, Math.round(currentScrollY() + el.getBoundingClientRect().top - saved.anchor.top));
      }
      return Number(saved.scrollY) || 0;
    };
    const step = function () {
      if (touched) { logReturn(name, detail + '・位置：途中でさわったのでやめた'); return; }
      const target = targetY();
      window.scrollTo(0, target);
      stable = Math.abs(currentScrollY() - target) < 3 ? stable + 1 : 0;
      if (stable >= 5 || Date.now() - started > RETURN_WAIT_MS) {
        logReturn(name, detail + '・位置 ' + target + '→' + Math.round(currentScrollY()));
        return;
      }
      setTimeout(step, 100);
    };
    step();
  }

  /** 戻したときに記録に残す、状態の短い説明 */
  function returnDetail(state) {
    const parts = [];
    // 記録に残すのは、年度・件数・月などの短いものだけ（チームや試合のIDは残さない）
    ['season', 'recKind', 'recLimit', 'calMonth', 'calSelected', 'date', 'tab'].forEach(function (k) {
      const v = state && state[k];
      if (v !== '' && v !== null && v !== undefined) parts.push(k + '=' + String(v).slice(0, 12));
    });
    return '状態 ' + (parts.join(' ') || 'なし');
  }

  /* ---------- 小さな道具 ---------- */

  /* ---------- 横にすべらせて、上のタブを移る（2026-11-15 利用者が追加） ---------- */

  const SWIPE_MIN_X = 80;       // 横にこれだけ（px）動かしたときだけ移る
  const SWIPE_MAX_SLOPE = 0.4;  // 縦の動き ÷ 横の動き がこれより大きければ移らない（約22度より斜めは移らない）
  const SWIPE_MAX_MS = 800;     // これより長くかけて動かしたときは移らない（ゆっくり読んでいるときなど）
  const SWIPE_EDGE = 24;        // 画面の左右の端からこの幅で始めたときは移らない（スマホの「戻る」操作とぶつからないように）
  /** この上で始めたときは移らない：入力欄・横に並んだ切り替え・カレンダー・グラフ・画面の切り替えの帯など */
  const SWIPE_BLOCK = 'input, textarea, select, canvas, .nl-chart, .nl-seg, .nl-cats, .nl-cal, .nl-nav, .nl-daynav, .nl-step, .nl-score, .nl-modal, [data-no-swipe]';

  /**
   * 左にすべらせると右のタブへ、右にすべらせると左のタブへ移る（並びは PAGES の順）。
   * 4つの画面だけ（試合の詳細など、PAGES に無い画面では何もしない）。
   * 画面のスクロールは止めない（passive。押しただけ・縦に動かしただけでは何も起きない）。
   */
  function setupSwipe(pageKey) {
    let index = -1;
    PAGES.forEach(function (p, i) { if (p.key === pageKey) index = i; });
    if (index === -1 || !('ontouchstart' in window)) return;
    let start = null;
    document.addEventListener('touchstart', function (e) {
      start = null;
      if (e.touches.length !== 1) return;
      const t = e.touches[0];
      if (t.clientX < SWIPE_EDGE || t.clientX > window.innerWidth - SWIPE_EDGE) return;
      if (blocksSwipe(e.target)) return;
      start = { x: t.clientX, y: t.clientY, at: Date.now() };
    }, { passive: true });
    document.addEventListener('touchmove', function (e) { if (e.touches.length !== 1) start = null; }, { passive: true });
    document.addEventListener('touchcancel', function () { start = null; }, { passive: true });
    document.addEventListener('touchend', function (e) {
      if (!start) return;
      const s = start;
      start = null;
      const t = e.changedTouches[0];
      const dx = t.clientX - s.x;
      const dy = t.clientY - s.y;
      if (Date.now() - s.at > SWIPE_MAX_MS) return;
      if (Math.abs(dx) < SWIPE_MIN_X || Math.abs(dy) > Math.abs(dx) * SWIPE_MAX_SLOPE) return;
      if (window.getSelection && String(window.getSelection())) return;   // 文字を選んでいるとき
      if (document.querySelector('[aria-busy="true"]')) return;            // 保存などの途中
      const next = PAGES[index + (dx < 0 ? 1 : -1)];
      if (!next) return;  // 端のタブ（成績を入力の右すべらせ・チーム・設定の左すべらせ）では何もしない
      location.href = next.href;
    }, { passive: true });
  }

  /** その場所（と外側）が、横にすべらせる操作に使われているか */
  function blocksSwipe(node) {
    for (let n = node; n && n.nodeType === 1 && n !== document.body; n = n.parentElement) {
      if (n.matches(SWIPE_BLOCK)) return true;
      // 横にスクロールできる表など（中身が幅からはみ出しているときだけ）
      const ox = getComputedStyle(n).overflowX;
      if ((ox === 'auto' || ox === 'scroll') && n.scrollWidth > n.clientWidth + 1) return true;
    }
    return false;
  }

  /* ---------- 勝敗と得点の札（2026-11-15 利用者が追加） ---------- */

  const RESULT_MARKS = { win: ['○', '勝ち'], lose: ['●', '負け'], draw: ['△', '引き分け'] };

  /**
   * 試合の勝敗を「○ 5−3」（得点があるとき）・「○ 勝ち」（得点が無いとき）の札にする。
   * ○＝勝ち、●＝負け、△＝引き分け。勝敗が無ければ null。
   * g：{ result, our_score, opp_score }（GASの試合の情報・記録の情報のどちらでもよい）
   */
  function resultBadge(g) {
    const m = g && RESULT_MARKS[g.result];
    if (!m) return null;
    const hasScore = typeof g.our_score === 'number' && typeof g.opp_score === 'number';
    const badge = el('span', 'nl-badge nl-result nl-result--' + g.result,
      m[0] + ' ' + (hasScore ? g.our_score + '−' + g.opp_score : m[1]));
    badge.setAttribute('aria-label', m[1] + (hasScore ? '　' + g.our_score + '対' + g.opp_score : ''));
    return badge;
  }

  function topBox() { return document.getElementById('nl-alert'); }

  /** 要素を作る。文字は textContent で入れる（画面に悪いプログラムが入り込まないように） */
  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  return {
    PAGES: PAGES,
    busy: busy,
    loadingEl: loadingEl,
    boot: boot,
    renderHeader: renderHeader,
    showError: showError,
    showOk: showOk,
    clearAlerts: clearAlerts,
    showFieldErrors: showFieldErrors,
    clearFieldErrors: clearFieldErrors,
    withBusy: withBusy,
    clearSnapshots: clearSnapshots,
    rememberReturn: rememberReturn,
    resultBadge: resultBadge,
    el: el,
  };
})();
