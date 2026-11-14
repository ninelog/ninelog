/**
 * 「成績を入力」の画面（input.html）
 * C-4a：チームと試合日を選び、その日の試合を選ぶ（無ければ作る）。CLAUDE.md 11.1章・11.3章
 * C-13：選んだ試合の情報を直す・消す（作った人と代表者だけ）
 * C-4：選んだ試合に、打撃成績を入れる（入力済みなら直す）。第4.4章・4.5章
 * C-5：選んだ試合に、投手成績を入れる（回・アウト数0〜2・自責点）。第4.4b章
 * C-6b：「自分の成績」の記録カレンダーから、日付と試合を選んだ状態で開ける（URLの team・date・game・tab）
 * C-12：成績を保存・直したときに、新しく達成した記録のお祝いを出す（GASの celebrations。11.4章・B-16）
 *
 * 使うGASの操作：listMyTeams・startSolo・listTeamGames・createGame・updateGame・deleteGame・getCalendar・
 *               listMyBattingRecords・addBattingRecord・updateBattingRecord・
 *               listMyPitchingRecords・addPitchingRecord・updatePitchingRecord
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
    editingGameId: '', // 情報を直している試合（C-13）
    mine: null,        // 選んでいるチームの、自分の成績 { batting: { game_id: 記録 }, pitching: {…} }（読み込む前は null。C-4・C-5）
    recordGameId: '',  // 成績の入力欄に入れてある試合（同じ試合なら、入れかけの数を消さない）
    atBatsTouched: false, // 打数を自分で直したか（直したら、打数を自動で入れない）
  };

  /** 打撃の13項目（第4.4章。GASの Validation.js と同じ名前・同じ順） */
  const BATTING_ITEMS = [
    ['plate_appearances', '打席'], ['at_bats', '打数'],
    ['hits', '安打'], ['doubles', '二塁打'],
    ['triples', '三塁打'], ['home_runs', '本塁打'],
    ['rbis', '打点'], ['walks', '四球'],
    ['hbp', '死球'], ['sacrifice_bunts', '犠打'],
    ['sacrifice_flies', '犠飛'], ['strikeouts', '三振'],
    ['stolen_bases', '盗塁'],
  ];
  /** 打数の自動計算に使う項目（打数 ＝ 打席 − 四球 − 死球 − 犠打 − 犠飛） */
  const AT_BAT_SOURCES = ['plate_appearances', 'walks', 'hbp', 'sacrifice_bunts', 'sacrifice_flies'];
  const MAX_COUNT = 99; // 1試合の数の上限（GASの Config.js の MAX_COUNT_PER_GAME と同じ）
  /** 投手の3項目（第4.4b章。[項目名, 表示名, 上限]）。投球回は「回」と「アウト（0〜2）」に分けて入れ、GASが 回×3＋アウト で保存する */
  const PITCHING_ITEMS = [
    ['innings', '投球回（回）', MAX_COUNT],
    ['partial_outs', 'アウト（0〜2）', 2],
    ['earned_runs', '自責点', MAX_COUNT],
  ];

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

  /** 「2026-11-14」から days 日ずらした日 */
  function shiftDate(text, days) {
    const p = text.split('-').map(Number);
    const d = new Date(Date.UTC(p[0], p[1] - 1, p[2] + days));
    return d.getUTCFullYear() + '-' + ('0' + (d.getUTCMonth() + 1)).slice(-2) + '-' + ('0' + d.getUTCDate()).slice(-2);
  }

  let calendar = null; // 試合日を選ぶカレンダー（js/calendar.js）

  /** ページのURLの「?team=…&date=…&game=…&tab=…」を読む。読んだら、URLからは消す（開き直したときに、また選ばれないように） */
  function linkParams() {
    const p = new URLSearchParams(location.search);
    const link = { team: p.get('team') || '', date: p.get('date') || '', game: p.get('game') || '', tab: p.get('tab') || '' };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(link.date)) link.date = '';
    if (link.team || link.date || link.game) {
      try { history.replaceState(null, '', location.pathname); } catch (e) { /* 消せなくても動く */ }
    }
    return link;
  }

  function start() {
    const today = jstDate(0);
    state.max = today;
    state.min = jstDate(-30); // 試合日から30日以内だけ入力できる（4.5b章）
    state.date = today;

    // 「自分の成績」の記録カレンダーから来たとき（C-6b）：input.html?team=…&date=…&game=…&tab=pitching
    // その日・その試合を選んだ状態で開く。30日より前の日などは使わない
    const link = linkParams();
    if (link.date && link.date >= state.min && link.date <= state.max) {
      state.date = link.date;
      state.selectedGameId = link.game;
    }
    if (link.tab === 'pitching') setRecordTab('pitching');

    calendar = NinelogCalendar.create($('date-cal'), {
      min: state.min,
      max: state.max,
      selected: state.date,
      onSelect: function (date) { setDate(date); },
      onMonthChange: function (month) { loadMarks(month); },
    });
    updateDateControls();

    // 前に選んだチームのカレンダー・試合・自分の成績を、所属の一覧と同時に頼んでおく（B-24。2026-11-15）
    let preTeam = link.team;
    if (!preTeam) {
      try { preTeam = localStorage.getItem(TEAM_KEY) || ''; } catch (e) { preTeam = ''; }
    }
    if (preTeam) prefetchTeam(preTeam);

    return NinelogApp.call('listMyTeams').then(function (res) {
      $('loading').hidden = true;
      return Promise.resolve(showTeams(res.teams, link.team)).then(function () {
        // 試合を選んだ状態で開いたときは、成績の入力欄まで動かす
        // （開いたばかりなので、なめらかに動かさず、すぐに飛ぶ）
        if (link.game && state.selectedGameId === link.game) {
          $('record-card').scrollIntoView({ block: 'start' });
        }
      });
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
    const loading = loadTeam();
    prefetched = null; // 使わなかった分は捨てる（別のチームを選んだときなど）
    return loading;
  }

  /**
   * 前もって頼んでおいた読み込み（B-24）。所属の一覧（listMyTeams）と同じときに頼むので、
   * GASへの問い合わせが1回にまとまり、1往復減る。選んだチーム・月・日が同じときだけ使う。
   * 退会したチームなどで断られても、使わないので何もしない。
   */
  let prefetched = null;
  function prefetchTeam(teamId) {
    const quiet = function (p) { p.catch(function () { /* 使うときに、そちらでエラーを出す */ }); return p; };
    const month = calendar.month();
    prefetched = {
      teamId: teamId,
      marks: { key: month, promise: quiet(NinelogApp.call('getCalendar', { month: month, team_id: teamId })) },
      day: { key: state.date, promise: quiet(NinelogApp.call('listTeamGames', { team_id: teamId, game_date: state.date })) },
      batting: { key: '', promise: quiet(NinelogApp.call('listMyBattingRecords', { team_id: teamId })) },
      pitching: { key: '', promise: quiet(NinelogApp.call('listMyPitchingRecords', { team_id: teamId })) },
    };
  }
  function takePrefetched(name, teamId, key) {
    if (!prefetched || prefetched.teamId !== teamId || !prefetched[name] || prefetched[name].key !== key) return null;
    const p = prefetched[name].promise;
    prefetched[name] = null;
    return p;
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

  /** チームを選んだとき：カレンダーの○●と、選んでいる日の試合を読む */
  function loadTeam() {
    state.mine = null;
    state.recordGameId = '';
    return Promise.all([loadMarks(calendar.month()), loadDay(), loadMine()])
      .catch(function (err) { NinelogUI.showError(err, $('pick')); });
  }

  /** 選んでいるチームの、自分の打撃・投手の成績を読む（入力済みかどうかを知るため。C-4・C-5） */
  function loadMine() {
    const teamId = state.teamId;
    return Promise.all([
      takePrefetched('batting', teamId, '') || NinelogApp.call('listMyBattingRecords', { team_id: teamId }),
      takePrefetched('pitching', teamId, '') || NinelogApp.call('listMyPitchingRecords', { team_id: teamId }),
    ]).then(function (res) {
      if (teamId !== state.teamId) return; // 読んでいる間にチームが切り替わったら使わない
      const byGame = function (records) {
        const map = {};
        records.forEach(function (r) { map[r.game_id] = r; });
        return map;
      };
      state.mine = { batting: byGame(res[0].records), pitching: byGame(res[1].records) };
      state.recordGameId = ''; // 入力欄を入れ直す
      renderRecordCard();
    });
  }

  /**
   * カレンダーの印を読む（C-4b）：選んでいるチームの試合がある日に○、自分の成績を入れた日に●。
   * getCalendar は試合の情報と本人の記録のIDだけを返す（他人の成績は返さない。11.3章）
   */
  function loadMarks(month) {
    const teamId = state.teamId;
    const request = takePrefetched('marks', teamId, month) || NinelogApp.call('getCalendar', { month: month, team_id: teamId });
    return request.then(function (res) {
      if (teamId !== state.teamId || month !== calendar.month()) return; // 読んでいる間に切り替わったら使わない
      const marks = {};
      res.days.forEach(function (d) { marks[d.date] = { game: d.has_team_game, mine: d.has_my_record }; });
      calendar.setMarks(marks);
    });
  }

  /** 試合日の表示と「前の日」「次の日」を押せるかを合わせる */
  function updateDateControls() {
    $('date-label').textContent = dateLabel(state.date);
    $('btn-prev-day').disabled = state.date <= state.min;
    $('btn-next-day').disabled = state.date >= state.max;
  }

  /** 選んでいる日の試合を読む */
  function loadDay() {
    const box = $('games');
    box.innerHTML = '';
    box.appendChild(NinelogUI.loadingEl('試合を読み込んでいます…'));
    hideNewGame();
    const request = takePrefetched('day', state.teamId, state.date) || NinelogApp.call('listTeamGames', { team_id: state.teamId, game_date: state.date });
    return request.then(function (res) {
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
    renderRecordCard();
    if (!g) return;
    const team = state.teams.filter(function (t) { return t.teamId === state.teamId; })[0];
    $('selected-title').textContent = dateLabel(g.game_date) + '　' + gameTitle(g);
    $('selected-sub').textContent = (team ? team.teamName : '') + (g.tournament_name ? '　／　' + g.tournament_name : '');
    $('selected-reflect').textContent = reflectText(g, team);
    // 大会に参加していない人には、大会のランキングに載らないことを知らせる（11.7章のK）
    const note = $('selected-note');
    note.hidden = !(g.tournament_id && !g.in_my_tournament);
    note.textContent = 'この大会に参加していないので、この試合の成績は大会のランキングには載りません（チームのランキングには載ります）。';

    // 試合の情報を直す・消す（C-13）：試合を作った人とチームの代表者だけ（GASが can_edit で知らせる）
    if (state.editingGameId !== g.game_id) closeEdit();
    $('edit-actions').hidden = !g.can_edit;
    $('edit-note').hidden = Boolean(g.can_edit);
  }

  /* ---------- 試合の情報を直す・消す（C-13。11.1章） ---------- */

  function selectedGame() {
    return state.games.filter(function (x) { return x.game_id === state.selectedGameId; })[0];
  }

  function closeEdit() {
    state.editingGameId = '';
    $('edit-game').hidden = true;
    $('delete-confirm').hidden = true;
    $('btn-edit-game').hidden = false;
    $('btn-delete-game').hidden = false;
    NinelogUI.clearAlerts($('edit-game'));
  }

  /** 直す欄を開いて、今の試合の情報を入れておく */
  function openEdit() {
    const g = selectedGame();
    if (!g) return;
    closeEdit();
    NinelogUI.clearAlerts($('selected'));
    state.editingGameId = g.game_id;

    // 試合日：30日以内の日を選択欄に並べる（新しい日から）
    const dateSel = $('edit-date');
    dateSel.innerHTML = '';
    for (let d = state.max; d >= state.min; d = shiftDate(d, -1)) {
      const o = el('option', '', dateLabel(d));
      o.value = d;
      dateSel.appendChild(o);
    }
    dateSel.value = g.game_date;

    const numSel = $('edit-number');
    numSel.innerHTML = '';
    for (let n = 1; n <= 9; n++) {
      const o = el('option', '', '第' + n + '試合');
      o.value = String(n);
      numSel.appendChild(o);
    }
    numSel.value = String(g.game_number);

    $('edit-opponent').value = g.opponent || '';
    $('edit-category').value = g.category || '';
    $('edit-result').value = g.result || '';

    // 大会：参加している大会と「大会なし」。今付いている大会に本人が参加していなくても、そのままにはできる（11.1章）
    const team = state.teams.filter(function (t) { return t.teamId === state.teamId; })[0];
    const tourSel = $('edit-tournament');
    tourSel.innerHTML = '';
    const none = el('option', '', '（大会なし）');
    none.value = '';
    tourSel.appendChild(none);
    state.myTournaments.forEach(function (t) {
      const o = el('option', '', t.tournamentName);
      o.value = t.tournamentId;
      tourSel.appendChild(o);
    });
    if (g.tournament_id && !state.myTournaments.some(function (t) { return t.tournamentId === g.tournament_id; })) {
      const o = el('option', '', g.tournament_name + '（今のまま）');
      o.value = g.tournament_id;
      tourSel.appendChild(o);
    }
    tourSel.value = g.tournament_id || '';
    // ひとりの記録には大会を付けない。付けられる大会も今の大会も無いときは、欄を出さない
    $('edit-tournament-field').hidden = (team && team.orgType === 'solo') || tourSel.options.length <= 1;

    $('btn-edit-game').hidden = true;
    $('btn-delete-game').hidden = true;
    $('edit-game').hidden = false;
  }

  function saveEdit(e) {
    e.preventDefault();
    const g = selectedGame();
    const form = $('edit-game');
    if (!g) return;
    NinelogUI.clearAlerts(form);
    const data = {
      game_id: g.game_id,
      game_date: $('edit-date').value,
      game_number: $('edit-number').value,
      opponent: $('edit-opponent').value.trim(),
      tournament_id: $('edit-tournament').value,
      category: $('edit-category').value,
      result: $('edit-result').value,
    };
    return NinelogUI.withBusy($('btn-save-game'), function () {
      return NinelogApp.call('updateGame', data).then(function (res) {
        closeEdit();
        // 試合日を変えたときは、その日に移って、同じ試合を選んだままにする
        state.selectedGameId = res.game.game_id;
        if (res.game.game_date !== state.date) {
          state.date = res.game.game_date;
          calendar.setSelected(state.date);
          updateDateControls();
        }
        loadMarks(calendar.month()).catch(function () { /* 印が読めなくても、直せている */ });
        return loadDay().then(function () {
          NinelogUI.showOk(res.unchanged ? '変わったところはありませんでした。' : '試合の情報を直しました。', $('selected'));
        });
      }).catch(function (err) { NinelogUI.showError(err, form); });
    });
  }

  function openDelete() {
    NinelogUI.clearAlerts($('selected'));
    $('delete-confirm').hidden = false;
    $('btn-edit-game').hidden = true;
    $('btn-delete-game').hidden = true;
  }

  function deleteGame() {
    const g = selectedGame();
    if (!g) return;
    const box = $('delete-confirm');
    NinelogUI.clearAlerts(box);
    return NinelogUI.withBusy($('btn-delete-yes'), function () {
      return NinelogApp.call('deleteGame', { game_id: g.game_id }).then(function () {
        closeEdit();
        state.selectedGameId = '';
        loadMarks(calendar.month()).catch(function () { /* 印が読めなくても、消せている */ });
        return loadDay().then(function () {
          // 選んでいた四角は消えるので、お知らせは試合の一覧の四角の一番下に出す
          NinelogUI.showOk('試合を消しました：' + dateLabel(g.game_date) + '　' + gameTitle(g), $('pick'));
        });
      }).catch(function (err) { NinelogUI.showError(err, box); });
    });
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

  /* ---------- 3. 成績を入れる：打撃（C-4。第4.4章・4.5章）と投手（C-5。第4.4b章） ---------- */

  /**
   * 成績の種類ごとの決まり。
   * prefix：入力欄の id の頭（打撃は b-、投手は p-）。items：[項目名, 表示名, 上限]
   */
  const RECORD_KINDS = {
    batting: {
      label: '打撃', prefix: 'b-', form: 'batting-form', status: 'batting-status', save: 'btn-save-batting',
      items: BATTING_ITEMS.map(function (i) { return [i[0], i[1], MAX_COUNT]; }),
      add: 'addBattingRecord', update: 'updateBattingRecord',
    },
    pitching: {
      label: '投手', prefix: 'p-', form: 'pitching-form', status: 'pitching-status', save: 'btn-save-pitching',
      items: PITCHING_ITEMS,
      add: 'addPitchingRecord', update: 'updatePitchingRecord',
    },
  };

  /** 安打の内訳（二塁打・三塁打・本塁打）。安打の下に字下げして「うち」の見出しを付けて並べる（2026-11-14 利用者の依頼） */
  const HIT_BREAKDOWN = ['doubles', 'triples', 'home_runs'];

  /** 入力欄を作る（最初に1回だけ）。－・＋で1ずつ増やせて、数字を直接打つこともできる */
  function buildCounts(kind) {
    const k = RECORD_KINDS[kind];
    const counts = $(kind + '-counts');
    let group = null; // 安打の内訳のまとまり（打撃だけ）
    k.items.forEach(function (item) {
      let box = counts;
      if (kind === 'batting' && HIT_BREAKDOWN.indexOf(item[0]) !== -1) {
        if (!group) {
          group = el('div', 'nl-count-group');
          group.setAttribute('role', 'group');
          group.setAttribute('aria-label', '安打の内訳');
          group.appendChild(el('p', 'nl-count-group__title', 'うち（安打の内訳）'));
          counts.appendChild(group);
        }
        box = group;
      }
      const field = item[0];
      const id = k.prefix + field;
      const wrap = el('div', 'nl-count');
      const label = el('label', field === 'at_bats' ? 'nl-count__label--auto' : '', item[1]);
      label.setAttribute('for', id);
      const step = el('div', 'nl-step');
      const minus = el('button', '', '－');
      minus.type = 'button';
      minus.setAttribute('aria-label', item[1] + 'を1減らす');
      const input = el('input', '');
      input.type = 'number';
      input.id = id;
      input.name = field; // GASのエラー（details の field）を、この行の下に出すため
      input.inputMode = 'numeric';
      input.min = '0';
      input.max = String(item[2]);
      input.value = '0';
      const plus = el('button', '', '＋');
      plus.type = 'button';
      plus.setAttribute('aria-label', item[1] + 'を1増やす');
      minus.addEventListener('click', function () { step1(kind, field, -1); });
      plus.addEventListener('click', function () { step1(kind, field, 1); });
      input.addEventListener('focus', function () { input.select(); });
      input.addEventListener('input', function () { changed(kind, field, true); });
      step.appendChild(minus);
      step.appendChild(input);
      step.appendChild(plus);
      wrap.appendChild(label);
      wrap.appendChild(step);
      box.appendChild(wrap);
      if (group && item[0] === HIT_BREAKDOWN[HIT_BREAKDOWN.length - 1]) {
        group.appendChild(el('p', 'nl-count-group__note', '二塁打・三塁打・本塁打は、安打の数にも入れます（例：本塁打1本なら、安打にも1を数える）。'));
      }
    });
  }

  /** 欄の数（空や数でないものは0） */
  function countOf(kind, field) {
    const n = parseInt($(RECORD_KINDS[kind].prefix + field).value, 10);
    return isNaN(n) ? 0 : n;
  }

  function setCount(kind, field, value) {
    const item = RECORD_KINDS[kind].items.filter(function (i) { return i[0] === field; })[0];
    $(RECORD_KINDS[kind].prefix + field).value = String(Math.max(0, Math.min(item[2], value)));
  }

  /** －・＋を押したとき */
  function step1(kind, field, diff) {
    // 投手のアウト：2の次は「回」を1増やして0に、0の前は「回」を1減らして2にする（3アウトで1回）
    if (kind === 'pitching' && field === 'partial_outs') {
      const outs = countOf('pitching', 'innings') * 3 + countOf('pitching', 'partial_outs') + diff;
      if (outs >= 0 && outs <= MAX_COUNT * 3 + 2) {
        setCount('pitching', 'innings', Math.floor(outs / 3));
        setCount('pitching', 'partial_outs', outs % 3);
      }
    } else {
      setCount(kind, field, countOf(kind, field) + diff);
    }
    changed(kind, field, true);
  }

  /** 打数 ＝ 打席 − 四球 − 死球 − 犠打 − 犠飛（0より小さくしない） */
  function autoAtBats() {
    return Math.max(0, countOf('batting', 'plate_appearances') - countOf('batting', 'walks') - countOf('batting', 'hbp') -
      countOf('batting', 'sacrifice_bunts') - countOf('batting', 'sacrifice_flies'));
  }

  /** 欄が変わったとき：打数を自分で直していなければ打数を入れ直す。投手は投球回の表示を直す */
  function changed(kind, field, byUser) {
    if (kind === 'batting') {
      if (field === 'at_bats' && byUser) state.atBatsTouched = true;
      if (!state.atBatsTouched && AT_BAT_SOURCES.indexOf(field) !== -1) {
        $('b-at_bats').value = String(autoAtBats());
      }
    } else {
      $('pitching-total').textContent = '投球回：' + countOf('pitching', 'innings') + '回' +
        (countOf('pitching', 'partial_outs') ? countOf('pitching', 'partial_outs') + '/3' : '');
    }
  }

  function setRecordTab(tab) {
    $('tab-batting').setAttribute('aria-pressed', tab === 'batting' ? 'true' : 'false');
    $('tab-pitching').setAttribute('aria-pressed', tab === 'pitching' ? 'true' : 'false');
    $('batting-form').hidden = tab !== 'batting';
    $('pitching-form').hidden = tab !== 'pitching';
  }

  /**
   * 「3. 成績を入れる」の四角を、選んでいる試合に合わせる。
   * 入力済みなら、その数を入れて「直す」にする。まだなら0を入れて「保存する」にする。
   * 同じ試合のままなら、入れかけの数を消さない。
   */
  function renderRecordCard() {
    const g = selectedGame();
    $('record-card').hidden = !g;
    if (!g) { state.recordGameId = ''; return; }
    if (!state.mine) {
      // 自分の成績をまだ読み込んでいない（入力済みかどうかわからない）
      Object.keys(RECORD_KINDS).forEach(function (kind) {
        const k = RECORD_KINDS[kind];
        $(k.status).hidden = false;
        $(k.status).textContent = '読み込み中です…';
        $(k.save).disabled = true;
      });
      return;
    }
    if (state.recordGameId === g.game_id) return;
    state.recordGameId = g.game_id;
    Object.keys(RECORD_KINDS).forEach(function (kind) { fillKind(kind, g); });
  }

  /** 1つの種類（打撃か投手）の入力欄に、その試合の自分の記録（無ければ0）を入れる */
  function fillKind(kind, g) {
    const k = RECORD_KINDS[kind];
    const rec = state.mine[kind][g.game_id];
    NinelogUI.clearAlerts($(k.form));
    hideCelebration(kind); // ほかの試合を選んだら、前のお祝いは消す
    $(k.save).disabled = false;
    k.items.forEach(function (item) {
      $(k.prefix + item[0]).value = String(rec ? Number(rec[item[0]]) || 0 : 0);
    });
    if (kind === 'batting') {
      // 入力済みの打数が自動の数と違えば、自分で直した打数として扱う（自動で上書きしない）
      state.atBatsTouched = Boolean(rec) && countOf('batting', 'at_bats') !== autoAtBats();
    } else {
      changed('pitching', 'innings', false);
    }
    // 切り替えのボタンに、入力済みの印を付ける
    $('tab-' + kind).textContent = k.label + (rec ? ' ✓' : '');
    const status = $(k.status);
    if (rec) {
      status.hidden = false;
      status.textContent = 'この試合の' + k.label + '成績は入力済みです。直すときは、数を変えて「' + k.label +
        '成績を直す」を押してください（' + dateLabel(rec.editable_until) + 'まで直せます）。';
      $(k.save).textContent = k.label + '成績を直す';
    } else {
      status.hidden = true;
      $(k.save).textContent = k.label + '成績を保存する';
    }
  }

  function saveRecord(kind, e) {
    e.preventDefault();
    const k = RECORD_KINDS[kind];
    const g = selectedGame();
    const form = $(k.form);
    if (!g || !state.mine) return;
    NinelogUI.clearAlerts(form);
    hideCelebration(kind);
    const rec = state.mine[kind][g.game_id];
    const data = { game_id: g.game_id };
    k.items.forEach(function (item) { data[item[0]] = $(k.prefix + item[0]).value.trim(); });
    if (rec) data.record_id = rec.record_id;
    return NinelogUI.withBusy($(k.save), function () {
      return NinelogApp.call(rec ? k.update : k.add, data).then(function (res) {
        state.mine[kind][res.record.game_id] = res.record;
        fillKind(kind, g);
        // カレンダーの●を付け直す（印が読めなくても、保存はできている）
        loadMarks(calendar.month()).catch(function () { /* そのまま */ });
        NinelogUI.showOk(res.unchanged ? '変わったところはありませんでした。'
          : k.label + '成績を' + (rec ? '直しました。' : '保存しました。'), form);
        showCelebration(kind, res.celebrations || []); // 新しく達成した記録があるときだけ（C-12）
      }).catch(function (err) { NinelogUI.showError(err, form); });
    });
  }

  /* ---------- 記録達成のお祝い（C-12。11.4章・B-16） ---------- */

  /** お祝いの種類ごとの印（1試合の記録・初めての記録・通算の節目） */
  const CELEBRATION_ICONS = { game: '⚾', first: '✨', milestone: '🏆' };

  /**
   * 保存・直したあとに、新しく達成した記録を出す（GASが決めた文 message をそのまま出す）。
   * 何も達成していなければ出さない。画面の真ん中に重ねて出す枠（ポップアップ）で出し、「閉じる」で閉じる（2026-11-14 利用者の依頼）。
   */
  let celebrateLastFocus = null; // 閉じたあとに、押していたボタンに戻すため
  function celebrateDialog() {
    let overlay = $('celebrate-overlay');
    if (overlay) return overlay;
    overlay = el('div', 'nl-modal');
    overlay.id = 'celebrate-overlay';
    overlay.hidden = true;
    const box = el('div', 'nl-modal__box nl-celebrate');
    box.id = 'celebrate-box';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-labelledby', 'celebrate-title');
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !overlay.hidden) hideCelebration();
    });
    return overlay;
  }

  function showCelebration(kind, list) {
    if (!list.length) { hideCelebration(); return; }
    const overlay = celebrateDialog();
    const box = $('celebrate-box');
    box.innerHTML = '';
    const title = el('p', 'nl-celebrate__title', '🎉 おめでとうございます！');
    title.id = 'celebrate-title';
    box.appendChild(title);
    const ul = el('ul', 'nl-celebrate__list');
    list.forEach(function (c) {
      const li = el('li', '');
      li.appendChild(el('span', 'nl-celebrate__icon', CELEBRATION_ICONS[c.type] || '🎉'));
      li.appendChild(el('span', '', c.message));
      ul.appendChild(li);
    });
    box.appendChild(ul);
    const close = el('button', 'nl-btn nl-btn--block', '閉じる');
    close.type = 'button';
    close.addEventListener('click', hideCelebration);
    const actions = el('div', 'nl-actions');
    actions.appendChild(close);
    box.appendChild(actions);
    celebrateLastFocus = $(RECORD_KINDS[kind].save); // 閉じたら、保存のボタンに戻す
    overlay.hidden = false;
    document.body.classList.add('nl-modal-open'); // 後ろの画面がスクロールしないように
    // 出すたびに、少し動かして目に入るようにする（同じ要素でも動くように、いったん外す）
    box.classList.remove('is-pop');
    void box.offsetWidth;
    box.classList.add('is-pop');
    close.focus();
  }

  function hideCelebration() {
    const overlay = $('celebrate-overlay');
    if (!overlay || overlay.hidden) return;
    overlay.hidden = true;
    $('celebrate-box').innerHTML = '';
    document.body.classList.remove('nl-modal-open');
    if (celebrateLastFocus && document.contains(celebrateLastFocus)) {
      try { celebrateLastFocus.focus({ preventScroll: true }); } catch (e) { /* そのまま */ }
    }
    celebrateLastFocus = null;
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
        loadMarks(calendar.month()).catch(function () { /* 印が読めなくても、試合は作れている */ });
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
    if (value > state.max || value < state.min) return; // 30日より前と未来には動かない（ボタンも押せない）
    state.date = value;
    calendar.setSelected(value); // 違う月なら、その月を出して○●を読み直す
    updateDateControls();
    state.selectedGameId = '';
    NinelogUI.clearAlerts($('pick'));
    loadDay().catch(function (err) { NinelogUI.showError(err, $('pick')); });
  }
  $('btn-prev-day').addEventListener('click', function () { setDate(shiftDate(state.date, -1)); });
  $('btn-next-day').addEventListener('click', function () { setDate(shiftDate(state.date, 1)); });
  $('btn-today').addEventListener('click', function () { setDate(jstDate(0)); });

  $('btn-new').addEventListener('click', showNewGame);
  buildCounts('batting');
  buildCounts('pitching');
  $('batting-form').addEventListener('submit', function (e) { saveRecord('batting', e); });
  $('pitching-form').addEventListener('submit', function (e) { saveRecord('pitching', e); });
  $('tab-batting').addEventListener('click', function () { setRecordTab('batting'); });
  $('tab-pitching').addEventListener('click', function () { setRecordTab('pitching'); });
  $('btn-edit-game').addEventListener('click', openEdit);
  $('btn-edit-cancel').addEventListener('click', closeEdit);
  $('edit-game').addEventListener('submit', saveEdit);
  $('btn-delete-game').addEventListener('click', openDelete);
  $('btn-delete-no').addEventListener('click', closeEdit);
  $('btn-delete-yes').addEventListener('click', deleteGame);
  $('btn-solo').addEventListener('click', startSolo);
  $('btn-cancel').addEventListener('click', hideNewGame);
  // 大会を選んだら、試合区分を「公式戦」にする（変えてもよい。11.7章のD）
  $('tournament_id').addEventListener('change', function () {
    if (this.value && !$('category').value) $('category').value = 'official';
  });
  $('new-game').addEventListener('submit', createGame);

  NinelogUI.boot('input', '成績を入力', start);
})();
