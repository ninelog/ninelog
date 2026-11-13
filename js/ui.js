/**
 * 画面の共通部品（C-3）：ヘッダー、ボタンの送信中の表示、エラーと成功のお知らせ
 *
 * 各ページの書き方：
 *   <div id="nl-header"></div>
 *   <main class="nl-main">
 *     <div id="nl-alert"></div>   ← お知らせ（エラー・成功）を出す場所
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

  /* ---------- お知らせ ---------- */

  /**
   * エラーのお知らせを出す。err は NinelogApp.call が投げたエラー（code・message・details を持つ）。
   * 入力チェックのエラー（VALIDATION_ERROR）で form を渡したときは、項目ごとの説明を入力欄の近くにも出す。
   */
  function showError(err, form) {
    const box = alertBox();
    if (!box) return;
    box.className = 'nl-alert nl-alert--error';
    box.setAttribute('role', 'alert');
    box.innerHTML = '';
    box.appendChild(document.createTextNode(messageOf(err)));

    const details = (err && err.details) || [];
    const unplaced = form ? showFieldErrors(form, details) : details;
    if (unplaced.length > 0) {
      const ul = document.createElement('ul');
      unplaced.forEach(function (d) { ul.appendChild(el('li', '', d.message)); });
      box.appendChild(ul);
    }
    box.hidden = false;
    box.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  /** 成功のお知らせを出す（例：「登録しました」） */
  function showOk(message) {
    const box = alertBox();
    if (!box) return;
    box.className = 'nl-alert nl-alert--ok';
    box.setAttribute('role', 'status');
    box.textContent = message;
    box.hidden = false;
  }

  /** お知らせと、入力欄の近くのエラーを消す */
  function clearAlerts(form) {
    const box = alertBox();
    if (box) { box.hidden = true; box.innerHTML = ''; }
    if (form) clearFieldErrors(form);
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

  function alertBox() { return document.getElementById('nl-alert'); }

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
