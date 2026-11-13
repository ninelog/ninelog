/**
 * まだ中身を作っていない画面の「仮の中身」（C-3）
 * 共通部品（ヘッダー・ボタン・エラー表示）が、どの画面でも同じ見た目で出るかを確かめるための見本。
 * C-4以降で、それぞれの画面の本当の中身に置き換えたら、このファイルの読み込みは消す。
 *
 * 使い方：<main> の中に <div id="nl-placeholder" data-next="C-4"></div> を置き、
 *         NinelogUI.boot(…, NinelogPlaceholder.render) とする。
 */
const NinelogPlaceholder = (function () {
  const el = function (tag, className, text) { return NinelogUI.el(tag, className, text); };

  function render() {
    const root = document.getElementById('nl-placeholder');
    if (!root) return;
    const next = root.getAttribute('data-next') || 'このあとの作業';

    const intro = el('section', 'nl-card');
    intro.appendChild(el('h2', '', 'この画面は準備中です'));
    intro.appendChild(el('p', 'nl-note', '中身は ' + next + ' で作ります。下は、どの画面でも使う部品の見本です。'));
    root.appendChild(intro);

    // ボタンの見本と、GASへの問い合わせ（送信中の表示・成功のお知らせ）
    const buttons = el('section', 'nl-card');
    buttons.appendChild(el('h2', '', 'ボタンの見本'));
    const check = el('button', 'nl-btn nl-btn--block', '本人確認をためす');
    check.type = 'button';
    check.addEventListener('click', function () {
      NinelogUI.clearAlerts(buttons);
      NinelogUI.withBusy(check, function () {
        return NinelogApp.call('whoami').then(function (me) {
          NinelogUI.showOk('本人確認ができました（表示名：' + me.displayName + '）', buttons);
        }).catch(function (err) { NinelogUI.showError(err, buttons); });
      });
    });
    buttons.appendChild(check);
    const row = el('div', '');
    row.style.cssText = 'display:flex;gap:8px;margin-top:8px;flex-wrap:wrap';
    const sub = el('button', 'nl-btn nl-btn--sub', 'サブのボタン');
    sub.type = 'button';
    const danger = el('button', 'nl-btn nl-btn--danger', '削除のボタン');
    danger.type = 'button';
    const off = el('button', 'nl-btn', '押せないボタン');
    off.type = 'button';
    off.disabled = true;
    row.appendChild(sub);
    row.appendChild(danger);
    row.appendChild(off);
    buttons.appendChild(row);
    root.appendChild(buttons);

    // エラー表示の見本（入力チェックのエラーが、入力欄の近くとお知らせの両方に出る）
    const form = el('form', 'nl-card');
    form.appendChild(el('h2', '', 'エラー表示の見本'));
    const field = el('div', 'nl-field');
    const label = el('label', '', '安打（見本）');
    label.setAttribute('for', 'sample-hits');
    const input = el('input', '');
    input.id = 'sample-hits';
    input.name = 'hits';
    input.type = 'number';
    input.value = '4';
    field.appendChild(label);
    field.appendChild(input);
    form.appendChild(field);
    const show = el('button', 'nl-btn nl-btn--sub', 'エラーを出してみる');
    show.type = 'submit';
    form.appendChild(show);
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      NinelogUI.showError({
        code: 'VALIDATION_ERROR',
        message: '入力内容に誤りがあります（見本）',
        details: [
          { field: 'hits', message: '安打（4）が打数（3）より多くなっています（見本）' },
          { field: 'game_id', message: '入力欄の無い項目の説明は、上のお知らせの中に出ます（見本）' },
        ],
      }, form);
    });
    root.appendChild(form);
  }

  return { render: render };
})();
