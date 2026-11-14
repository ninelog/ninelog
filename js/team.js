/**
 * 「チーム・設定」の画面（team.html）。C-9。CLAUDE.md 4.8章
 *
 * C-9e：代表者はチーム・大会を消せる。ひとりの記録の成績を、あとからチームの試合に移せる（11.9章。B-21）
 *
 * 使うGASの操作：whoami・listMyTeams・joinTeam・createTeam・changePassphrase・updateMyName・startSolo・leaveTeam・
 *               getDeletePreview・deleteTeam・listSoloMoveTargets・moveSoloRecords
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

  /**
   * 所属しているチーム・大会の一覧（C-9d）。
   * 畳んだときは「所属：チーム2・大会1（タップで開く）」のように数だけを見せ、開くと1つ1行で並べる。
   * 何も入っていないときは、最初から開いて案内を出す。
   */
  function renderTeams(teams) {
    const box = $('teams');
    box.innerHTML = '';
    // ひとりの記録場所がまだ無い人にだけ、「ひとりで記録する」を出す（11.8章の1・10）
    $('solo-card').hidden = teams.some(function (t) { return t.orgType === 'solo'; });

    const count = function (type) { return teams.filter(function (t) { return t.orgType === type; }).length; };
    const parts = ['チーム' + count('team'), '大会' + count('tournament')];
    if (count('solo')) parts.push('ひとり');
    const summary = $('teams-summary');
    summary.innerHTML = '';
    summary.appendChild(document.createTextNode('所属：' + parts.join('・')));
    summary.appendChild(el('span', 'nl-fold__hint', '（タップで開く）'));

    if (teams.length === 0) {
      $('teams-fold').open = true;
      box.appendChild(el('p', 'nl-empty', 'まだ、どのチームにも大会にも入っていません。下の「チーム・大会に参加する」か「チーム・大会を作る」から始めてください。'));
      return;
    }
    teams.forEach(function (t) {
      const row = el('div', 'nl-row');
      const main = el('div', 'nl-row__main');
      main.appendChild(el('span', 'nl-row__name', t.teamName));
      if (t.orgType === 'solo') {
        // ひとりの記録：番号・役割・合言葉・退会は無い。消せない。成績をチームに移せる（C-9e）
        main.appendChild(el('span', 'nl-badge', 'ひとり'));
        main.appendChild(el('span', 'nl-row__meta', 'あなただけの記録'));
        row.appendChild(main);
        row.appendChild(moveSoloForm(t, row));
        box.appendChild(row);
        return;
      }
      if (t.orgType === 'tournament') main.appendChild(el('span', 'nl-badge', '大会'));
      main.appendChild(el('span', 'nl-badge', t.role === 'owner' ? '代表者' : 'メンバー'));
      main.appendChild(el('span', 'nl-row__meta', '番号 ' + t.teamNumber));
      row.appendChild(main);
      // 代表者は合言葉を変えられて、チーム・大会を消せる（C-9e）。メンバーは退会できる（代表者は退会できない。B-20）
      if (t.role === 'owner') {
        const wrap = passphraseForm(t, row);
        addDeleteForm(t, row, wrap);
        row.appendChild(wrap);
      } else {
        row.appendChild(leaveForm(t, row));
      }
      box.appendChild(row);
    });
  }

  /** メンバーだけ：退会する（押すと確かめる文が出て、もう一度押すと退会する。C-9d・B-20） */
  function leaveForm(t, row) {
    const kind = t.orgType === 'tournament' ? '大会' : 'チーム';
    const wrap = el('div', 'nl-row__actions');
    const open = el('button', 'nl-chip nl-chip--danger', '退会する');
    open.type = 'button';
    const confirmBox = el('div', '');
    confirmBox.hidden = true;
    confirmBox.style.width = '100%';
    confirmBox.appendChild(el('p', 'nl-note', '「' + t.teamName + '」から退会しますか？ これまでの成績は消えません（' + kind + '全体の成績には残り、ランキングには載らなくなります）。同じ番号と合言葉で、もう一度参加できます。'));
    const actions = el('div', 'nl-actions');
    const yes = el('button', 'nl-btn nl-btn--danger', '退会する');
    yes.type = 'button';
    const no = el('button', 'nl-btn nl-btn--sub', 'やめる');
    no.type = 'button';
    actions.appendChild(yes);
    actions.appendChild(no);
    confirmBox.appendChild(actions);

    open.addEventListener('click', function () { confirmBox.hidden = false; open.hidden = true; });
    no.addEventListener('click', function () { confirmBox.hidden = true; open.hidden = false; NinelogUI.clearAlerts(row); });
    yes.addEventListener('click', function () {
      NinelogUI.clearAlerts(row);
      NinelogUI.withBusy(yes, function () {
        return NinelogApp.call('leaveTeam', { team_id: t.teamId }).then(function () {
          // 退会した行は消えるので、お知らせは一覧の四角の一番下に出す
          return reloadTeams().then(function () {
            NinelogUI.showOk('「' + t.teamName + '」から退会しました。これまでの成績は残っています。', $('teams-card'));
          });
        }).catch(function (err) { NinelogUI.showError(err, row); });
      });
    });
    wrap.appendChild(open);
    wrap.appendChild(confirmBox);
    return wrap;
  }

  /** 代表者だけ：合言葉を変える（ボタンを押すと入力欄が開く） */
  function passphraseForm(t, card) {
    const wrap = el('div', 'nl-row__actions');
    const open = el('button', 'nl-chip', '合言葉を変える');
    open.type = 'button';

    const form = el('form', '');
    form.noValidate = true;
    form.hidden = true;
    form.style.width = '100%';
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

  /* ---------- チーム・大会を消す（C-9e。11.9章） ---------- */

  /**
   * 代表者だけ：「消す」ボタンと、確かめる欄を、合言葉の欄（wrap）に足す。
   * 押すと、GASに消す前の数（メンバーの人数・移る成績の件数など）を聞いて出し、名前を入力すると消せる。
   */
  function addDeleteForm(t, row, wrap) {
    const isTour = t.orgType === 'tournament';
    const kind = isTour ? '大会' : 'チーム';
    const open = el('button', 'nl-chip nl-chip--danger', kind + 'を消す');
    open.type = 'button';
    const panel = el('div', 'nl-danger-box');
    panel.hidden = true;
    // 合言葉を変える欄より前に、ボタンを並べる
    wrap.insertBefore(open, wrap.children[1] || null);
    wrap.appendChild(panel);

    const close = function () {
      panel.hidden = true;
      panel.innerHTML = '';
      wrap.querySelectorAll(':scope > .nl-chip').forEach(function (b) { b.hidden = false; });
      NinelogUI.clearAlerts(row);
    };

    open.addEventListener('click', function () {
      NinelogUI.clearAlerts(row);
      NinelogUI.withBusy(open, function () {
        return NinelogApp.call('getDeletePreview', { team_id: t.teamId }).then(function (pv) {
          wrap.querySelectorAll(':scope > .nl-chip').forEach(function (b) { b.hidden = true; });
          wrap.querySelectorAll(':scope > form').forEach(function (f) { f.hidden = true; });
          renderDeletePanel(t, pv, panel, row, close);
          panel.hidden = false;
        }).catch(function (err) { NinelogUI.showError(err, row); });
      });
    });
  }

  function renderDeletePanel(t, pv, panel, row, close) {
    const isTour = pv.orgType === 'tournament';
    const kind = isTour ? '大会' : 'チーム';
    panel.innerHTML = '';
    panel.appendChild(el('p', 'nl-danger-box__title', '「' + pv.teamName + '」を消しますか？ 消すと元に戻せません。'));
    const ul = el('ul', 'nl-danger-box__list');
    const li = function (text) { ul.appendChild(el('li', '', text)); };
    if (isTour) {
      li('参加者 ' + pv.members + '人、大会の試合 ' + pv.games + '試合');
      li('試合に付いていた大会の印を外します。成績は、それぞれのチームにそのまま残ります。');
      li('大会のランキングはなくなります。');
    } else {
      li('メンバー ' + pv.members + '人（あなたを含む）、試合 ' + pv.games + '試合');
      if (pv.otherRecords) {
        li('ほかの人の成績 ' + pv.otherRecords + '件（' + pv.otherPeople + '人。退会した人を含む）は、それぞれの人の「ひとりの記録」に移ります（ひとりの記録が無い人には自動で作ります）。');
      }
      if (pv.tournamentRecords) {
        li('大会の試合の成績 ' + pv.tournamentRecords + '件は、大会の印を外して移すので、大会のランキングから外れます。');
      }
      li('チームのランキングと、チームの成績はなくなります。');
    }
    li('番号 ' + pv.teamNumber + ' は、あとでほかの' + kind + 'に使えるようになります。');
    panel.appendChild(ul);

    const form = el('form', '');
    form.noValidate = true;
    // 代表者自身の成績だけは、移すか消すかを選べる
    if (!isTour && pv.ownerRecords) {
      const fs = el('fieldset', 'nl-radios');
      fs.appendChild(el('legend', '', 'あなたの成績 ' + pv.ownerRecords + '件'));
      [['move', 'ひとりの記録に移す'], ['delete', '消す']].forEach(function (o, i) {
        const label = el('label');
        const input = el('input');
        input.type = 'radio';
        input.name = 'owner_records';
        input.value = o[0];
        if (i === 0) input.checked = true;
        label.appendChild(input);
        label.appendChild(document.createTextNode(' ' + o[1]));
        fs.appendChild(label);
      });
      form.appendChild(fs);
    }
    const field = el('div', 'nl-field');
    const id = 'confirm-' + t.teamId;
    const label = el('label', '', '確かめるため、' + kind + '名「' + pv.teamName + '」を入力してください');
    label.setAttribute('for', id);
    const input = el('input');
    input.type = 'text';
    input.id = id;
    input.name = 'confirm_name';
    input.autocomplete = 'off';
    field.appendChild(label);
    field.appendChild(input);
    form.appendChild(field);
    const actions = el('div', 'nl-actions');
    const yes = el('button', 'nl-btn nl-btn--danger', kind + 'を消す');
    yes.type = 'submit';
    yes.disabled = true;
    const no = el('button', 'nl-btn nl-btn--sub', 'やめる');
    no.type = 'button';
    actions.appendChild(yes);
    actions.appendChild(no);
    form.appendChild(actions);
    panel.appendChild(form);

    // 名前が合うまで、消すボタンは押せない（まちがえて消さないように）
    input.addEventListener('input', function () { yes.disabled = input.value.trim() !== pv.teamName; });
    no.addEventListener('click', close);
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      NinelogUI.clearAlerts(form);
      const checked = form.querySelector('input[name="owner_records"]:checked');
      const data = { team_id: t.teamId, confirm_name: input.value.trim() };
      if (checked) data.owner_records = checked.value;
      NinelogUI.withBusy(yes, function () {
        return NinelogApp.call('deleteTeam', data).then(function (res) {
          let msg = '「' + res.teamName + '」を消しました。';
          if (res.movedRecords) msg += '成績 ' + res.movedRecords + '件を、それぞれの人のひとりの記録に移しました。';
          if (res.untaggedGames) msg += res.untaggedGames + '試合の大会の印を外しました。';
          // 消した行は無くなるので、お知らせは一覧の四角の一番下に出す
          return reloadTeams().then(function () { NinelogUI.showOk(msg, $('teams-card')); });
        }).catch(function (err) { NinelogUI.showError(err, form); });
      });
    });
  }

  /* ---------- ひとりの記録の成績を、チームに移す（C-9e。11.9章） ---------- */

  function moveSoloForm(t, row) {
    const wrap = el('div', 'nl-row__actions');
    const open = el('button', 'nl-chip', '成績をチームに移す');
    open.type = 'button';
    const panel = el('div', '');
    panel.hidden = true;
    panel.style.width = '100%';
    wrap.appendChild(open);
    wrap.appendChild(panel);
    const close = function () { panel.hidden = true; panel.innerHTML = ''; open.hidden = false; NinelogUI.clearAlerts(row); };
    const load = function () {
      return NinelogApp.call('listSoloMoveTargets').then(function (res) {
        renderMovePanel(res.records, panel, close, load);
        panel.hidden = false;
        open.hidden = true;
      });
    };
    open.addEventListener('click', function () {
      NinelogUI.clearAlerts(row);
      NinelogUI.withBusy(open, function () { return load().catch(function (err) { NinelogUI.showError(err, row); }); });
    });
    return wrap;
  }

  /** 「11月8日（日）」の形 */
  function dateLabel(text) {
    const p = String(text).split('-').map(Number);
    const week = '日月火水木金土'.charAt(new Date(p[0], p[1] - 1, p[2]).getDay());
    return p[1] + '月' + p[2] + '日（' + week + '）';
  }
  function gameText(g) {
    return '第' + g.game_number + '試合' + (g.opponent ? '　vs ' + g.opponent : '');
  }
  function recordText(r) {
    if (r.record_type === 'pitching') return '投手：' + r.innings_text + '　自責点' + r.earned_runs;
    return '打撃：' + r.plate_appearances + '打席 ' + r.at_bats + '打数 ' + r.hits + '安打' + (Number(r.rbis) ? '　打点' + r.rbis : '');
  }

  function renderMovePanel(records, panel, close, reload) {
    panel.innerHTML = '';
    panel.appendChild(el('p', 'nl-note', 'ひとりの記録の成績を、同じ日のチームの試合に移します。移すと、チームのランキングとチームの成績に入ります。' +
      '30日より前の記録も移せます。数字は変わりません。チームの試合は新しく作らないので、先に「成績を入力」でチームの試合を作ってください。'));
    if (!records.length) {
      panel.appendChild(el('p', 'nl-empty', 'ひとりの記録に、移せる成績はありません。'));
    }
    const form = el('form', '');
    form.noValidate = true;
    const list = el('div', 'nl-rows');
    const items = [];
    records.forEach(function (r) {
      const item = el('div', 'nl-row nl-move');
      const head = el('label', 'nl-move__head');
      const check = el('input');
      check.type = 'checkbox';
      head.appendChild(check);
      const text = el('span', '');
      text.appendChild(el('span', 'nl-row__name', dateLabel(r.game_date) + '　' + gameText(r)));
      text.appendChild(el('span', 'nl-move__line', recordText(r)));
      head.appendChild(text);
      item.appendChild(head);

      // 移す先：同じ日のチームの試合（そこに同じ種類の自分の成績があれば選べない）
      const usable = r.candidates.filter(function (c) { return !c.has_my_record; });
      let select = null;
      if (!r.candidates.length) {
        item.appendChild(el('p', 'nl-note', '同じ日のチームの試合が無いので、移せません。'));
        check.disabled = true;
      } else if (!usable.length) {
        item.appendChild(el('p', 'nl-note', '同じ日のチームの試合に、あなたの' + (r.record_type === 'pitching' ? '投手' : '打撃') + '成績がすでにあるので、移せません。'));
        check.disabled = true;
      } else {
        select = el('select', 'nl-move__to');
        r.candidates.forEach(function (c) {
          const o = el('option', '', '移す先：' + c.team_name + '　' + gameText(c) + (c.tournament_name ? '（' + c.tournament_name + '）' : '') +
            (c.has_my_record ? '（あなたの成績あり）' : ''));
          o.value = c.game_id;
          o.disabled = c.has_my_record;
          select.appendChild(o);
        });
        select.value = usable[0].game_id;
        select.setAttribute('aria-label', '移す先の試合');
        item.appendChild(select);
      }
      list.appendChild(item);
      items.push({ record: r, check: check, select: select });
    });
    form.appendChild(list);

    const actions = el('div', 'nl-actions');
    const go = el('button', 'nl-btn', '選んだ成績をチームに移す');
    go.type = 'submit';
    const no = el('button', 'nl-btn nl-btn--sub', '閉じる');
    no.type = 'button';
    if (records.length) actions.appendChild(go);
    actions.appendChild(no);
    form.appendChild(actions);
    panel.appendChild(form);

    const count = function () { return items.filter(function (x) { return x.check.checked; }).length; };
    const update = function () {
      const n = count();
      go.disabled = n === 0;
      go.textContent = n ? '選んだ成績 ' + n + '件をチームに移す' : '移す成績を選んでください';
    };
    items.forEach(function (x) { x.check.addEventListener('change', update); });
    update();
    no.addEventListener('click', close);
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      NinelogUI.clearAlerts(form);
      const moves = items.filter(function (x) { return x.check.checked; }).map(function (x) {
        return { record_type: x.record.record_type, record_id: x.record.record_id, game_id: x.select.value };
      });
      NinelogUI.withBusy(go, function () {
        return NinelogApp.call('moveSoloRecords', { moves: moves }).then(function (res) {
          // 一覧を読み直してから、お知らせを出す（移した記録は一覧から消える）
          return reload().then(function () {
            NinelogUI.showOk('成績 ' + res.moved + '件を、チームの試合に移しました。', panel);
          });
        }).catch(function (err) { NinelogUI.showError(err, form); });
      });
    });
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
          NinelogUI.showOk('「ひとりの記録」を用意しました。「成績を入力」から試合を作って、成績を入れられます。', $('teams-card'));
        });
      }).catch(function (err) { NinelogUI.showError(err, card); });
    });
  });

  NinelogUI.boot('team', 'チーム・設定', start);
})();
