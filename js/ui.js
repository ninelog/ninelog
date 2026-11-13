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
  function boot(pageKey, title, onReady) {
    renderHeader(pageKey, title);
    if (typeof liff === 'undefined' || typeof NinelogApp === 'undefined') {
      showError({ message: '画面の部品を読み込めませんでした。電波のよい場所で、開き直してください' });
      return;
    }
    NinelogApp.start()
      .then(function (ready) { if (ready && onReady) return onReady(); })
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
      input.insertAdjacentElement('afterend', msg);
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
    return Promise.resolve()
      .then(work)
      .finally(function () {
        button.disabled = false;
        button.removeAttribute('aria-busy');
      });
  }

  /* ---------- 小さな道具 ---------- */

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
    boot: boot,
    renderHeader: renderHeader,
    showError: showError,
    showOk: showOk,
    clearAlerts: clearAlerts,
    showFieldErrors: showFieldErrors,
    clearFieldErrors: clearFieldErrors,
    withBusy: withBusy,
    el: el,
  };
})();
