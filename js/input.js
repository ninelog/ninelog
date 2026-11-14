/**
 * 「成績を入力」の画面（input.html）
 * C-4a：チームと試合日を選び、その日の試合を選ぶ（無ければ作る）。CLAUDE.md 11.1章・11.3章
 *
 * 使うGASの操作：listMyTeams・listTeamGames・createGame
 */
(function () {
  const $ = function (id) { return document.getElementById(id); };
  const el = NinelogUI.el;
  const TEAM_KEY = 'ninelog_input_team'; // 前に選んだチーム（この端末だけに覚える。なくても動く）

  const CATEGORY_LABELS = { official: '公式戦', practice: '練習試合', other: 'その他' };
  const RESULT_LABELS = { win: '勝ち', lose: '負け', draw: '引き分け' };

  const state = {
    teams: [],            // 所属しているチーム（大会は入れない）
    teamId: '',
    date: '',
    games: [],            // 選んでいる日の試合
    nextGameNumber: 1,
    myTournaments: [],
    selectedGameId: '',
  };

  /* ---------- 日付（日本時間） ---------- */

  /** 日本時間の「今日」から days 日ずらした日を yyyy-MM-dd で */
  function jstDate(days) {
    const d = new Date(Date.now() + (days || 0) * 86400000);
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  }
  /** 「2026-11-08」→「11月8日（日）」 */
  function dateLabel(text) {
    const p = text.split('-').map(Number);
    const week = '日月火水木金土'.charAt(new Date(p[0], p[1] - 1, p[2]).getDay());
    return p[1] + '月' + p[2] + '日（' + week + '）';
  }

  /* ---------- 読み込み ---------- */

  function start() {
    const today = jstDate(0);
    $('date').max = today;
    $('date').min = jstDate(-30); // 試合日から30日以内だけ入力できる（4.5b章）
    $('date').value = today;
    state.date = today;

    return NinelogApp.call('listMyTeams').then(function (res) {
      $('loading').hidden = true;
      return showTeams(res.teams, '');
    }).catch(function (err) {
      $('loading').hidden = true;
      NinelogUI.showError(err);
    });
  }

  /**
   * 成績を付けられる組織（チームと、ひとりの記録。11.8章）を選択欄に並べて、試合を選ぶ画面に進む。
   * 1つも無ければ「まだチームに入っていません」を出す。preferId を渡すと、それを選んでおく。
   */
  function showTeams(orgs, preferId) {
    state.teams = orgs.filter(function (t) { return t.orgType === 'team' || t.orgType === 'solo'; });
    if (state.teams.length === 0) {
      $('no-team').hidden = false;
      $('pick').hidden = true;
      return null;
    }
    $('no-team').hidden = true;
    const select = $('team');
    select.innerHTML = '';
    state.teams.forEach(function (t) {
      const o = el('option', '', t.teamName); // ひとりの記録は、名前（「ひとりの記録」）で見分けられる
      o.value = t.teamId;
      select.appendChild(o);
    });
    let saved = preferId || '';
    if (!saved) {
      try { saved = localStorage.getItem(TEAM_KEY) || ''; } catch (e) { /* 覚えられなくても動く */ }
    }
    state.teamId = state.teams.some(function (t) { return t.teamId === saved; }) ? saved : state.teams[0].teamId;
    select.value = state.teamId;
    $('pick').hidden = false;
    return loadTeam();
  }

  /** 「ひとりで記録する」：記録場所を作って（すでにあればそれを使って）、そのまま試合を選ぶ画面に進む（11.8章） */
  function startSolo() {
    const card = $('no-team');
    NinelogUI.clearAlerts(card);
    return NinelogUI.withBusy($('btn-solo'), function () {
      return NinelogApp.call('startSolo').then(function (res) {
        try { localStorage.setItem(TEAM_KEY, res.team.teamId); } catch (e) { /* 覚えられなくても動く */ }
        return NinelogApp.call('listMyTeams').then(function (list) {
          showTeams(list.teams, res.team.teamId);
          NinelogUI.showOk('「ひとりの記録」を用意しました。試合を作って、成績を入れてください。', $('pick'));
        });
      }).catch(function (err) { NinelogUI.showError(err, card); });
    });
  }

  /** チームを選んだとき：30日以内の試合（前回の試合日のため）と、選んでいる日の試合を読む */
  function loadTeam() {
    $('btn-last').disabled = true;
    const recent = NinelogApp.call('listTeamGames', { team_id: state.teamId }).then(function (res) {
      const today = jstDate(0);
      const before = res.games.map(function (g) { return g.game_date; })
        .filter(function (d) { return d < today; })
        .sort();
      const last = before.length ? before[before.length - 1] : '';
      $('btn-last').disabled = !last;
      $('btn-last').dataset.date = last;
      $('btn-last').textContent = last ? '前回の試合日（' + dateLabel(last) + '）' : '前回の試合日';
    });
    return Promise.all([recent, loadDay()]).catch(function (err) { NinelogUI.showError(err, $('pick')); });
  }

  /** 選んでいる日の試合を読む */
  function loadDay() {
    const box = $('games');
    box.innerHTML = '';
    box.appendChild(el('p', 'nl-loading', '試合を読み込んでいます…'));
    hideNewGame();
    return NinelogApp.call('listTeamGames', { team_id: state.teamId, game_date: state.date }).then(function (res) {
      state.games = res.games.slice().sort(function (a, b) { return a.game_number - b.game_number; });
      state.nextGameNumber = res.nextGameNumber || 1;
      state.myTournaments = res.myTournaments || [];
      fillOpponents(res.opponentSuggestions || []);
      if (!state.games.some(function (g) { return g.game_id === state.selectedGameId; })) {
        // 試合が1つだけなら、最初から選んでおく
        state.selectedGameId = state.games.length === 1 ? state.games[0].game_id : '';
      }
      renderGames();
    }).catch(function (err) {
      box.innerHTML = '';
      throw err;
    });
  }

  /* ---------- 試合の一覧 ---------- */

  function renderGames() {
    const box = $('games');
    box.innerHTML = '';
    if (state.games.length === 0) {
      box.appendChild(el('p', 'nl-empty', dateLabel(state.date) + 'の試合は、まだありません。下のボタンから作ってください。'));
    }
    state.games.forEach(function (g) {
      const b = el('button', 'nl-choice');
      b.type = 'button';
      b.setAttribute('aria-pressed', g.game_id === state.selectedGameId ? 'true' : 'false');
      b.appendChild(el('div', 'nl-choice__title', gameTitle(g)));
      const badges = gameBadges(g);
      if (badges.length) {
        const row = el('div', 'nl-badges');
        badges.forEach(function (t) { row.appendChild(el('span', 'nl-badge', t)); });
        b.appendChild(row);
      }
      b.addEventListener('click', function () {
        state.selectedGameId = g.game_id;
        renderGames();
        $('selected').scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      box.appendChild(b);
    });
    renderSelected();
  }

  function gameTitle(g) {
    return '第' + g.game_number + '試合　' + (g.opponent ? 'vs ' + g.opponent : '（相手は未入力）');
  }
  function gameBadges(g) {
    const list = [];
    if (g.tournament_name) list.push(g.tournament_name);
    if (CATEGORY_LABELS[g.category]) list.push(CATEGORY_LABELS[g.category]);
    if (RESULT_LABELS[g.result]) list.push(RESULT_LABELS[g.result]);
    if (g.created_by_me) list.push('あなたが作成');
    return list;
  }

  /** 選んだ試合の表示（C-4・C-5で、この下に成績の入力欄を足す） */
  function renderSelected() {
    const g = state.games.filter(function (x) { return x.game_id === state.selectedGameId; })[0];
    $('selected').hidden = !g;
    if (!g) return;
    const team = state.teams.filter(function (t) { return t.teamId === state.teamId; })[0];
    $('selected-title').textContent = dateLabel(g.game_date) + '　' + gameTitle(g);
    $('selected-sub').textContent = (team ? team.teamName : '') + (g.tournament_name ? '　／　' + g.tournament_name : '');
    $('selected-reflect').textContent = reflectText(g, team);
    // 大会に参加していない人には、大会のランキングに載らないことを知らせる（11.7章のK）
    const note = $('selected-note');
    note.hidden = !(g.tournament_id && !g.in_my_tournament);
    note.textContent = 'この大会に参加していないので、この試合の成績は大会のランキングには載りません（チームのランキングには載ります）。';
  }

  /** 選んだ試合の成績が、どこに反映されるか（2026-11-14 利用者が決定） */
  function reflectText(g, team) {
    if (team && team.orgType === 'solo') return 'この試合の成績は、ひとりの記録に保存されます（あなただけが見られます）。';
    const teamName = team ? team.teamName : 'チーム';
    if (g.tournament_id && g.in_my_tournament) {
      return 'この試合の成績は、' + teamName + 'と' + g.tournament_name + 'のランキングに反映されます。';
    }
    return 'この試合の成績は、' + teamName + 'のランキングに反映されます。';
  }

  /* ---------- 新しい試合を作る ---------- */

  function showNewGame() {
    const form = $('new-game');
    NinelogUI.clearAlerts(form);
    NinelogUI.clearAlerts($('pick')); // 前に作った試合の「作りました」のお知らせを消す
    form.reset();
    $('new-game-date').textContent = '試合日：' + dateLabel(state.date);

    // 第何試合かは、その日の次の番号に自動で決まる（GASが決める。選ぶ欄は置かない）
    $('game-number-text').textContent = '第' + state.nextGameNumber + '試合として作ります';
    // その日にまだ試合が無いときは「このままで大丈夫」の説明を、すでにあるときは目立つ注意を出す
    // （同じ試合を2人が別々に作って、試合数が増えてしまうのを防ぐため）
    const hasGames = state.games.length > 0;
    $('first-game-note').hidden = hasGames;
    $('same-day-warn').hidden = !hasGames;

    const tour = $('tournament_id');
    tour.innerHTML = '';
    const none = el('option', '', '（大会なし）');
    none.value = '';
    tour.appendChild(none);
    state.myTournaments.forEach(function (t) {
      const o = el('option', '', t.tournamentName);
      o.value = t.tournamentId;
      tour.appendChild(o);
    });
    $('tournament-field').hidden = state.myTournaments.length === 0;

    form.hidden = false;
    $('btn-new').hidden = true;
    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function hideNewGame() {
    $('new-game').hidden = true;
    $('btn-new').hidden = false;
  }

  function fillOpponents(names) {
    const list = $('opponent-list');
    list.innerHTML = '';
    names.forEach(function (n) {
      const o = document.createElement('option');
      o.value = n;
      list.appendChild(o);
    });
  }

  function createGame(e) {
    e.preventDefault();
    const form = $('new-game');
    NinelogUI.clearAlerts(form);
    const data = {
      team_id: state.teamId,
      game_date: state.date,
      opponent: $('opponent').value.trim(),
      tournament_id: $('tournament_id').value,
      category: $('category').value,
      result: $('result').value,
    };
    return NinelogUI.withBusy($('btn-create'), function () {
      return NinelogApp.call('createGame', data).then(function (res) {
        state.selectedGameId = res.game.game_id;
        // 作ったあとは入力欄を閉じるので、成功のお知らせは試合の一覧の四角の一番下に出す
        NinelogUI.showOk('試合を作りました：' + dateLabel(res.game.game_date) + '　' + gameTitle(res.game), $('pick'));
        return loadDay();
      }).catch(function (err) {
        NinelogUI.showError(err, form);
      });
    });
  }

  /* ---------- 操作の受け付け ---------- */

  $('team').addEventListener('change', function () {
    state.teamId = this.value;
    state.selectedGameId = '';
    try { localStorage.setItem(TEAM_KEY, state.teamId); } catch (e) { /* 覚えられなくても動く */ }
    NinelogUI.clearAlerts($('pick'));
    loadTeam();
  });

  function setDate(value) {
    if (!value) return;
    if (value > $('date').max || value < $('date').min) {
      NinelogUI.showError({ message: '入力できるのは、試合日から30日以内（今日まで）です' }, $('pick'));
      $('date').value = state.date;
      return;
    }
    $('date').value = value;
    state.date = value;
    state.selectedGameId = '';
    NinelogUI.clearAlerts($('pick'));
    loadDay().catch(function (err) { NinelogUI.showError(err, $('pick')); });
  }
  $('date').addEventListener('change', function () { setDate(this.value); });
  $('btn-today').addEventListener('click', function () { setDate(jstDate(0)); });
  $('btn-yesterday').addEventListener('click', function () { setDate(jstDate(-1)); });
  $('btn-last').addEventListener('click', function () { setDate(this.dataset.date); });

  $('btn-new').addEventListener('click', showNewGame);
  $('btn-solo').addEventListener('click', startSolo);
  $('btn-cancel').addEventListener('click', hideNewGame);
  // 大会を選んだら、試合区分を「公式戦」にする（変えてもよい。11.7章のD）
  $('tournament_id').addEventListener('change', function () {
    if (this.value && !$('category').value) $('category').value = 'official';
  });
  $('new-game').addEventListener('submit', createGame);

  NinelogUI.boot('input', '成績を入力', start);
})();
