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
    // ひとりの記録場所がまだ無い人にだけ、「ひとりで記録する」を出す（11.8章の1・10）
    $('solo-card').hidden = teams.some(function (t) { return t.orgType === 'solo'; });
    if (teams.length === 0) {
      box.appendChild(el('p', 'nl-empty', 'まだ、どのチームにも大会にも入っていません。下の「チーム・大会に参加する」か「チーム・大会を作る」から始めてください。'));
      return;
    }
    teams.forEach(function (t) {
      const card = el('div', 'nl-choice');
      card.appendChild(el('div', 'nl-choice__title', t.teamName));
      const badges = el('div', 'nl-badges');
      if (t.orgType === 'solo') {
        // ひとりの記録：番号・役割・合言葉は持たない
        card.appendChild(el('div', 'nl-choice__sub', 'あなただけの記録場所です（ランキングはありません）'));
        badges.appendChild(el('span', 'nl-badge', 'ひとり'));
        card.appendChild(badges);
        box.appendChild(card);
        return;
      }
      card.appendChild(el('div', 'nl-choice__sub', '番号 ' + t.teamNumber));
      if (t.orgType === 'tournament') badges.appendChild(el('span', 'nl-badge', '大会'));
      badges.appendChild(el('span', 'nl-badge', t.role === 'owner' ? '代表者' : 'メンバー'));
      card.appendChild(badges);
      if (t.role === 'owner') card.appendChild(passphraseForm(t, card));
      box.appendChild(card);
    });
  }

  /** 代表者だけ：合言葉を変える（ボタンを押すと入力欄が開く） */
  function passphraseForm(t, card) {
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
    cancel.addEventListener('click', function () { form.hidden = true; open.hidden = false; NinelogUI.clearAlerts(card); });
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      NinelogUI.clearAlerts(card);
      NinelogUI.withBusy(save, function () {
        return NinelogApp.call('changePassphrase', { team_id: t.teamId, passphrase: input.value }).then(function () {
          // 入力欄は閉じるので、成功のお知らせはチームの四角の一番下に出す
          NinelogUI.showOk('「' + t.teamName + '」の合言葉を変えました。', card);
          form.hidden = true;
          open.hidden = false;
          input.value = '';
        }).catch(function (err) { NinelogUI.showError(err, card); });
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
          : '「' + res.team.teamName + '」（' + kind + '）に参加しました。', form);
        form.reset();
        return reloadTeams();
      }).catch(function (err) { NinelogUI.showError(err, form); });
    });
  });

  /* ---------- チーム・大会を作る（C-9・C-9b） ---------- */

  /** 選んでいる種類（'team' か 'tournament'） */
  function createOrgType() {
    const checked = $('create-form').querySelector('input[name="org_type"]:checked');
    return checked ? checked.value : 'team';
  }

  /** 種類に合わせて、名前の欄・説明・ボタンの文字を変える */
  function updateCreateLabels() {
    const isTournament = createOrgType() === 'tournament';
    $('create-name-label').textContent = (isTournament ? '大会名' : 'チーム名') + '（30文字まで）';
    $('btn-create').textContent = isTournament ? '大会を作る' : 'チームを作る';
    $('tournament-hint').hidden = !isTournament;
  }
  $('create-form').querySelectorAll('input[name="org_type"]').forEach(function (r) {
    r.addEventListener('change', updateCreateLabels);
  });

  $('create-form').addEventListener('submit', function (e) {
    e.preventDefault();
    const form = this;
    const orgType = createOrgType();
    NinelogUI.clearAlerts(form);
    NinelogUI.withBusy($('btn-create'), function () {
      return NinelogApp.call('createTeam', {
        org_type: orgType,
        team_number: $('create-number').value.trim(),
        team_name: $('create-name').value.trim(),
        passphrase: $('create-pass').value,
      }).then(function (res) {
        const kind = orgType === 'tournament' ? '大会' : 'チーム';
        NinelogUI.showOk(kind + '「' + res.team.teamName + '」（番号 ' + res.team.teamNumber + '）を作りました。番号と合言葉を' +
          (orgType === 'tournament' ? '参加する人' : 'メンバー') + 'に伝えてください。', form);
        form.reset();
        updateCreateLabels(); // 種類は「チーム」に戻る
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
        NinelogUI.showOk('表示名を「' + res.displayName + '」に変えました。', form);
      }).catch(function (err) { NinelogUI.showError(err, form); });
    });
  });

  $('btn-solo').addEventListener('click', function () {
    const card = $('solo-card');
    NinelogUI.clearAlerts(card);
    NinelogUI.withBusy($('btn-solo'), function () {
      return NinelogApp.call('startSolo').then(function () {
        // 記録場所ができると、この四角は消えるので、成功のお知らせは「所属しているチーム」の四角に出す
        return reloadTeams().then(function () {
          NinelogUI.showOk('「ひとりの記録」を用意しました。「成績を入力」から試合を作って、成績を入れられます。', $('teams').parentNode);
        });
      }).catch(function (err) { NinelogUI.showError(err, card); });
    });
  });

  NinelogUI.boot('team', 'チーム・設定', start);
})();
