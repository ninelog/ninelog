/**
 * 「チーム・設定」の画面（team.html）。C-9。CLAUDE.md 4.8章
 *
 * 使うGASの操作：whoami・listMyTeams・joinTeam・createTeam・changePassphrase・updateMyName
 */
(function () {
  const $ = function (id) { return document.getElementById(id); };
  const el = NinelogUI.el;

  function start() {
    return Promise.all([NinelogApp.call('whoami'), NinelogApp.call('listMyTeams')]).then(function (res) {
      const me = res[0];
      $('loading').hidden = true;
      $('content').hidden = false;
      $('display-name').value = me.displayName;
      $('name-source').textContent = me.nameSource === 'custom'
        ? '自分で決めた名前です（LINEの名前を変えても、こちらは変わりません）。'
        : 'いまはLINEの名前を使っています。';
      if (me.isAdmin) {
        $('number-hint').textContent = 'あなたは管理者なので、テスト用の番号（1〜1998）も使えます。本物のチームは1999以上の番号にしてください。';
      }
      renderTeams(res[1].teams);
    }).catch(function (err) {
      $('loading').hidden = true;
      NinelogUI.showError(err);
    });
  }

  function reloadTeams() {
    return NinelogApp.call('listMyTeams').then(function (res) { renderTeams(res.teams); });
  }

  /* ---------- 所属しているチーム ---------- */

  function renderTeams(teams) {
    const box = $('teams');
    box.innerHTML = '';
    if (teams.length === 0) {
      box.appendChild(el('p', 'nl-empty', 'まだ、どのチームにも入っていません。下の「チームに参加する」か「チームを作る」から始めてください。'));
      return;
    }
    teams.forEach(function (t) {
      const card = el('div', 'nl-choice');
      card.appendChild(el('div', 'nl-choice__title', t.teamName));
      card.appendChild(el('div', 'nl-choice__sub', '番号 ' + t.teamNumber));
      const badges = el('div', 'nl-badges');
      if (t.orgType === 'tournament') badges.appendChild(el('span', 'nl-badge', '大会'));
      badges.appendChild(el('span', 'nl-badge', t.role === 'owner' ? '代表者' : 'メンバー'));
      card.appendChild(badges);
      if (t.role === 'owner') card.appendChild(passphraseForm(t));
      box.appendChild(card);
    });
  }

  /** 代表者だけ：合言葉を変える（ボタンを押すと入力欄が開く） */
  function passphraseForm(t) {
    const wrap = el('div', '');
    const open = el('button', 'nl-chip', '合言葉を変える');
    open.type = 'button';
    open.style.marginTop = '10px';
    const form = el('form', '');
    form.noValidate = true;
    form.hidden = true;
    form.style.marginTop = '10px';
    const field = el('div', 'nl-field');
    const id = 'pass-' + t.teamId;
    const label = el('label', '', '新しい合言葉（6〜32文字）');
    label.setAttribute('for', id);
    const input = el('input', '');
    input.type = 'text';
    input.id = id;
    input.name = 'passphrase';
    input.autocomplete = 'off';
    input.maxLength = 32;
    field.appendChild(label);
    field.appendChild(input);
    form.appendChild(field);
    const actions = el('div', 'nl-actions');
    const save = el('button', 'nl-btn', '変える');
    save.type = 'submit';
    const cancel = el('button', 'nl-btn nl-btn--sub', 'やめる');
    cancel.type = 'button';
    actions.appendChild(save);
    actions.appendChild(cancel);
    form.appendChild(actions);
    form.appendChild(el('p', 'nl-note', '変えても、いまのメンバーはそのまま残ります。新しく参加する人には、新しい合言葉を伝えてください。'));

    open.addEventListener('click', function () { form.hidden = false; open.hidden = true; input.focus(); });
    cancel.addEventListener('click', function () { form.hidden = true; open.hidden = false; NinelogUI.clearAlerts(form); });
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      NinelogUI.clearAlerts(form);
      NinelogUI.withBusy(save, function () {
        return NinelogApp.call('changePassphrase', { team_id: t.teamId, passphrase: input.value }).then(function () {
          NinelogUI.showOk('「' + t.teamName + '」の合言葉を変えました。');
          form.hidden = true;
          open.hidden = false;
          input.value = '';
        }).catch(function (err) { NinelogUI.showError(err, form); });
      });
    });
    wrap.appendChild(open);
    wrap.appendChild(form);
    return wrap;
  }

  /* ---------- 参加する・作る・表示名 ---------- */

  $('join-form').addEventListener('submit', function (e) {
    e.preventDefault();
    const form = this;
    NinelogUI.clearAlerts(form);
    NinelogUI.withBusy($('btn-join'), function () {
      return NinelogApp.call('joinTeam', {
        team_number: $('join-number').value.trim(),
        passphrase: $('join-pass').value,
      }).then(function (res) {
        const kind = res.team.orgType === 'tournament' ? '大会' : 'チーム';
        NinelogUI.showOk(res.alreadyMember
          ? 'すでに「' + res.team.teamName + '」に参加しています。'
          : '「' + res.team.teamName + '」（' + kind + '）に参加しました。');
        form.reset();
        return reloadTeams();
      }).catch(function (err) { NinelogUI.showError(err, form); });
    });
  });

  $('create-form').addEventListener('submit', function (e) {
    e.preventDefault();
    const form = this;
    NinelogUI.clearAlerts(form);
    NinelogUI.withBusy($('btn-create'), function () {
      return NinelogApp.call('createTeam', {
        org_type: 'team',
        team_number: $('create-number').value.trim(),
        team_name: $('create-name').value.trim(),
        passphrase: $('create-pass').value,
      }).then(function (res) {
        NinelogUI.showOk('チーム「' + res.team.teamName + '」（番号 ' + res.team.teamNumber + '）を作りました。番号と合言葉をメンバーに伝えてください。');
        form.reset();
        return reloadTeams();
      }).catch(function (err) { NinelogUI.showError(err, form); });
    });
  });

  $('name-form').addEventListener('submit', function (e) {
    e.preventDefault();
    const form = this;
    NinelogUI.clearAlerts(form);
    NinelogUI.withBusy($('btn-name'), function () {
      return NinelogApp.call('updateMyName', { display_name: $('display-name').value.trim() }).then(function (res) {
        $('display-name').value = res.displayName;
        $('name-source').textContent = '自分で決めた名前です（LINEの名前を変えても、こちらは変わりません）。';
        NinelogUI.showOk('表示名を「' + res.displayName + '」に変えました。');
      }).catch(function (err) { NinelogUI.showError(err, form); });
    });
  });

  NinelogUI.boot('team', 'チーム・設定', start);
})();
