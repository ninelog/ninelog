/**
 * 「自分の成績」の画面（mystats.html）。C-6。CLAUDE.md 6.5章・11.7章のG・11.8章
 *
 * - 年度（通算・記録がある年度）と範囲（全チーム合計・各チーム・ひとりの記録・各大会）を選ぶ
 * - 打撃（率4つと13項目の合計・塁打）と投手（防御率・投球回・自責点）を出す
 * - 計算はGAS（getMyStats）が行い、画面は出すだけ（6.3章と同じ考え方）
 *
 * C-6c：成績の推移グラフ（月ごとの打率・OPS・防御率。その月だけ／積み上げ。Chart.js）。11.4章・6.5章
 * C-6d：相手別・大会別・区分別の集計（js/breakdown.js。自分の集計なので勝敗は出さない：B-15の細部4）。11.4章
 * C-6b：記録カレンダー（●自分の成績・○チームの試合。日を押すと、その日の試合と成績、「直す」「入力する」）。11.3章
 * C-10：入力した打撃成績の一覧（選んでいる年度と範囲）。「直す」は「成績を入力」へ、「消す」はその場で（4.5b章）
 * C-11：同じ一覧に「打撃／投手」の切り替えを足し、投手成績も同じように直す・消す
 *
 * 使うGASの操作：getMyStats・getCalendar・listMyBattingRecords・listMyPitchingRecords・deleteBattingRecord・deletePitchingRecord
 */
(function () {
  const $ = function (id) { return document.getElementById(id); };
  const el = NinelogUI.el;

  /** 打撃の数の並び（第4.4章の順。最後に塁打） */
  const BATTING_COUNTS = [
    ['plate_appearances', '打席'], ['at_bats', '打数'], ['hits', '安打'],
    ['doubles', '二塁打'], ['triples', '三塁打'], ['home_runs', '本塁打'],
    ['rbis', '打点'], ['walks', '四球'], ['hbp', '死球'],
    ['sacrifice_bunts', '犠打'], ['sacrifice_flies', '犠飛'], ['strikeouts', '三振'],
    ['stolen_bases', '盗塁'], ['total_bases', '塁打'],
  ];

  let loading = 0; // 読み込みの番号（あとから始めた読み込みの結果だけを使う）
  let shown = null; // いま画面に出している成績（GASの返事）
  const breakdown = NinelogBreakdown.create($('bd-card'), { withRecord: false }); // 相手別・大会別（C-6d）

  function start() {
    initCalendar();
    return load({}).then(function () {
      $('loading').hidden = true;
      $('content').hidden = false;
    }, function (err) {
      $('loading').hidden = true;
      NinelogUI.showError(err);
    });
  }

  /** 選んでいる年度と範囲で、GASに成績を聞く */
  function load(data) {
    const my = ++loading;
    const done = NinelogUI.busy($('content')); // 読み込み中の表示（くるくる）
    return NinelogApp.call('getMyStats', data).then(function (res) {
      done();
      if (my !== loading) return; // 読んでいる間に選び直したら、古い結果は使わない
      shown = res;
      renderFilters(res);
      render(res);
      renderTrend();
      breakdown.update(res.breakdowns);
      syncCalendar(res);
      renderRecords();
    }, function (err) {
      done();
      if (my !== loading) return;
      throw err;
    });
  }

  /** 選んでいる範囲を GAS に送る形にする（「team:ID」「tour:ID」「」） */
  function scopeData() {
    const v = $('scope').value;
    if (v.indexOf('team:') === 0) return { team_id: v.slice(5) };
    if (v.indexOf('tour:') === 0) return { tournament_id: v.slice(5) };
    return {};
  }

  function reload() {
    NinelogUI.clearAlerts($('filters'));
    recs.limit = REC_PAGE; // 選び直したら、入力した成績の一覧は最初の10件に戻す（C-10）
    const data = Object.assign({ season: $('season').value }, scopeData());
    load(data).catch(function (err) {
      // 読めなかったときは、選択欄を、いま出している成績のものに戻す（選択欄と中身が食い違わないように）
      if (shown) renderFilters(shown);
      NinelogUI.showError(err, $('filters'));
    });
  }

  /* ---------- 選択欄 ---------- */

  function option(value, text) {
    const o = el('option', '', text);
    o.value = value;
    return o;
  }

  /** 年度と範囲の選択欄を、GASの返事（選んでいるものと一覧）に合わせる */
  function renderFilters(res) {
    const season = $('season');
    season.innerHTML = '';
    season.appendChild(option('all', '通算'));
    res.seasons.forEach(function (s) { season.appendChild(option(s, s + '年')); });
    // 記録の無い年が選ばれていたとき（ふつうは無い）も、選択欄に出しておく
    if (res.season !== 'all' && res.seasons.indexOf(res.season) === -1) {
      season.appendChild(option(res.season, res.season + '年'));
    }
    season.value = res.season;

    const scope = $('scope');
    scope.innerHTML = '';
    scope.appendChild(option('', '全チーム合計'));
    // チームと、ひとりの記録（11.8章の6）
    const teams = res.teams.filter(function (t) { return t.orgType !== 'solo'; });
    const solo = res.teams.filter(function (t) { return t.orgType === 'solo'; });
    if (teams.length) {
      const group = el('optgroup');
      group.label = 'チーム';
      teams.forEach(function (t) { group.appendChild(option('team:' + t.teamId, t.teamName)); });
      scope.appendChild(group);
    }
    solo.forEach(function (t) { scope.appendChild(option('team:' + t.teamId, t.teamName)); });
    // 大会（11.7章のG）
    if (res.tournaments.length) {
      const group = el('optgroup');
      group.label = '大会';
      res.tournaments.forEach(function (t) { group.appendChild(option('tour:' + t.tournamentId, t.tournamentName)); });
      scope.appendChild(group);
    }
    scope.value = res.teamId ? 'team:' + res.teamId : res.tournamentId ? 'tour:' + res.tournamentId : '';

    $('scope-note').textContent = scopeNote(res);
  }

  /** 範囲の説明（何が合計されているか） */
  function scopeNote(res) {
    if (res.tournamentId) return 'この大会の試合として登録された試合の成績だけを合計しています。';
    if (res.teamId) {
      const t = res.teams.filter(function (x) { return x.teamId === res.teamId; })[0];
      if (t && t.orgType === 'solo') return 'ひとりの記録の成績だけを合計しています。';
      return 'このチームの試合の成績だけを合計しています（大会の試合も入ります）。';
    }
    return '所属しているすべてのチームと、ひとりの記録の成績を合計しています。';
  }

  /* ---------- 成績 ---------- */

  function render(res) {
    const b = res.batting;
    const p = res.pitching;
    const none = !b.games && !p.games;
    $('empty').hidden = !none;
    $('batting-card').hidden = !b.games;
    $('pitching-card').hidden = !p.games;
    if (none) {
      $('empty-text').textContent = (res.season === 'all' ? '' : res.season + '年の') +
        'この範囲の成績は、まだありません。「成績を入力」から試合を選んで入れてください。';
      return;
    }

    if (b.games) {
      $('batting-games').textContent = b.games + '試合';
      const rates = $('batting-rates');
      rates.innerHTML = '';
      [['avg', '打率'], ['obp', '出塁率'], ['slg', '長打率'], ['ops', 'OPS']].forEach(function (r) {
        rates.appendChild(tile(r[1], b[r[0]].text));
      });
      const counts = $('batting-counts');
      counts.innerHTML = '';
      BATTING_COUNTS.forEach(function (c) { counts.appendChild(stat(c[1], b[c[0]])); });
    }

    if (p.games) {
      $('pitching-games').textContent = p.games + '試合';
      const rates = $('pitching-rates');
      rates.innerHTML = '';
      rates.appendChild(tile('防御率', p.era.text));
      rates.appendChild(tile('投球回', p.innings_text));
      rates.appendChild(tile('自責点', String(p.earned_runs)));
    }
  }

  /** 大きく出す数（率など） */
  function tile(label, value) {
    const t = el('div', 'nl-tile');
    t.appendChild(el('div', 'nl-tile__label', label));
    t.appendChild(el('div', 'nl-tile__value', value));
    return t;
  }

  /** 小さく並べる数（合計） */
  function stat(label, value) {
    const s = el('div', 'nl-stat');
    s.appendChild(el('span', 'nl-stat__label', label));
    s.appendChild(el('span', 'nl-stat__value', String(value === undefined || value === null ? 0 : value)));
    return s;
  }

  /* ---------- 成績の推移グラフ（C-6c。11.4章・6.5章の trend） ---------- */

  /**
   * グラフにする成績。key：その月だけの値、cum：積み上げの値（GASの trend の名前）
   * digits：目盛りの小数のけた。lowIsGood：低いほど良い（防御率）
   */
  const TREND_KINDS = {
    avg: { label: '打率', key: 'avg', cum: 'cum_avg', digits: 3, games: 'batting_games' },
    ops: { label: 'OPS', key: 'ops', cum: 'cum_ops', digits: 3, games: 'batting_games' },
    era: { label: '防御率', key: 'era', cum: 'cum_era', digits: 2, games: 'pitching_games', lowIsGood: true },
  };
  const trend = { kind: 'avg', mode: 'month', chart: null };

  /** 「2026-11」→「11月」。年が変わるところと最初の月は「2026年11月」 */
  function monthLabels(rows) {
    return rows.map(function (r, i) {
      const y = r.month.slice(0, 4);
      const m = Number(r.month.slice(5, 7)) + '月';
      return (i === 0 || rows[i - 1].month.slice(0, 4) !== y) ? y + '年' + m : m;
    });
  }

  /** 率の目盛りの文字（打率・OPSは「.300」の形、防御率は「2.50」） */
  function rateText(value, digits) {
    const t = value.toFixed(digits);
    return digits === 3 && value < 1 ? t.replace(/^0/, '') : t;
  }

  function cssColor(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  /** いま出している成績（shown.trend）と、選んでいる成績・計算のしかたで、グラフと表を作り直す */
  function renderTrend() {
    const rows = (shown && shown.trend) || [];
    $('trend-card').hidden = rows.length === 0; // 記録が1件も無ければ出さない（6.5章のB-12の細部4）
    if (!rows.length) return;
    const k = TREND_KINDS[trend.kind];
    const field = trend.mode === 'cum' ? k.cum : k.key;
    const labels = monthLabels(rows);
    const values = rows.map(function (r) { return r[field] ? r[field].value : null; });

    $('trend-note').textContent = (trend.mode === 'cum'
      ? (shown.season === 'all' ? '最初の記録からその月までを足して計算した' : 'その年の1月からその月までを足して計算した')
      : 'その月の試合だけで計算した') + k.label + 'です。' +
      (trend.mode === 'month' ? '記録の無い月は、点を打ちません。' : '') +
      (k.lowIsGood ? '防御率は低いほど良い成績です。' : '');

    renderTrendTable(rows, labels, k, field);

    if (typeof Chart === 'undefined') {
      // 部品を読み込めなかった（電波が弱いなど）。数字の表は見られる
      $('trend-note').textContent += '（グラフの部品を読み込めませんでした。「数字で見る」を開いてください）';
      return;
    }
    const accent = cssColor('--accent');
    const sub = cssColor('--sub');
    const line = cssColor('--line');
    const data = {
      labels: labels,
      datasets: [{
        label: k.label, data: values, borderColor: accent, backgroundColor: accent,
        pointRadius: 4, pointHoverRadius: 6, borderWidth: 2, spanGaps: false, tension: 0,
      }],
    };
    const options = {
      responsive: true, maintainAspectRatio: false, animation: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: function (c) { return k.label + ' ' + rows[c.dataIndex][field].text; } } },
      },
      scales: {
        x: { ticks: { color: sub, maxRotation: 0, autoSkip: true }, grid: { display: false } },
        y: {
          beginAtZero: true, ticks: { color: sub, maxTicksLimit: 6, callback: function (v) { return rateText(v, k.digits); } },
          grid: { color: line },
        },
      },
    };
    if (trend.chart) trend.chart.destroy();
    trend.chart = new Chart($('trend-chart'), { type: 'line', data: data, options: options });
  }

  /** 「数字で見る」の表（月・その値・試合数） */
  function renderTrendTable(rows, labels, k, field) {
    const table = $('trend-table');
    table.innerHTML = '';
    const head = el('tr');
    ['月', k.label + (trend.mode === 'cum' ? '（積み上げ）' : ''), k.games === 'batting_games' ? '打撃の試合' : '投手の試合']
      .forEach(function (t) { head.appendChild(el('th', '', t)); });
    table.appendChild(head);
    rows.forEach(function (r, i) {
      const tr = el('tr');
      tr.appendChild(el('td', '', labels[i]));
      tr.appendChild(el('td', '', r[field] ? r[field].text : '-'));
      tr.appendChild(el('td', '', String(r[k.games] || 0)));
      table.appendChild(tr);
    });
  }

  /** 切り替えボタン（成績の種類・計算のしかた） */
  function bindSeg(id, attr, onPick) {
    const box = $(id);
    box.querySelectorAll('button').forEach(function (b) {
      b.addEventListener('click', function () {
        box.querySelectorAll('button').forEach(function (x) { x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); });
        onPick(b.getAttribute(attr));
        renderTrend();
      });
    });
  }
  bindSeg('trend-kind', 'data-kind', function (v) { trend.kind = v; });
  bindSeg('trend-mode', 'data-mode', function (v) { trend.mode = v; });

  /* ---------- 記録カレンダー（C-6b。11.3章・11.0章の16） ---------- */

  const RESULT_LABELS = { win: '勝ち', lose: '負け', draw: '引き分け' };
  const cal = {
    view: null,      // カレンダーの部品（js/calendar.js）
    teamId: null,    // カレンダーに出しているチーム（'' は全チーム。null はまだ読んでいない）
    days: {},        // { 'yyyy-MM-dd': getCalendar の日 }
    selected: '',    // 押した日
    records: null,   // 自分の記録 { batting: { record_id: 記録 }, pitching: {…} }（読む前は null）
    loading: 0,
  };

  /** 日本時間の今日（yyyy-MM-dd） */
  function today() {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  }
  /** 「2026-11-08」→「11月8日（日）」 */
  function dateLabel(text) {
    const p = text.split('-').map(Number);
    const week = '日月火水木金土'.charAt(new Date(p[0], p[1] - 1, p[2]).getDay());
    return p[1] + '月' + p[2] + '日（' + week + '）';
  }

  function initCalendar() {
    cal.view = NinelogCalendar.create($('cal'), {
      max: today(), // 未来の日は押せない（試合は未来には作れない）
      onSelect: function (date) { cal.selected = date; renderDay(); },
      onMonthChange: function (month) { loadCalendar(month); },
    });
    renderDay();
    loadMine().catch(function (err) { NinelogUI.showError(err, $('cal-card')); });
  }

  /**
   * 自分の記録（全チーム）を読む：カレンダーで押した日の成績の数と、入力した成績の一覧（C-10）に使う。
   * 最初に1回と、記録を消したあとに読み直す。
   */
  function loadMine() {
    return Promise.all([NinelogApp.call('listMyBattingRecords', {}), NinelogApp.call('listMyPitchingRecords', {})]).then(function (res) {
      const byId = function (records) {
        const map = {};
        records.forEach(function (r) { map[r.record_id] = r; });
        return map;
      };
      cal.records = { batting: byId(res[0].records), pitching: byId(res[1].records) };
      recs.lists = { batting: res[0].records, pitching: res[1].records }; // 試合日の新しい順（GASの並び）
      renderDay();
      renderRecords();
    });
  }

  /**
   * 範囲の選択に合わせて、カレンダーのチームを決める。
   * チームか、ひとりの記録を選んでいるときはそのチームだけ。全チーム合計と大会のときは、所属している全チーム
   * （カレンダーの○はチームの試合なので、大会では出せない。11.7章のJ）。
   */
  function syncCalendar(res) {
    const teamId = res.teamId || '';
    let note = 'あなたが成績を入れた日に●、チームの試合がある日に○が付きます。日付を押すと、その日の試合と成績が出ます。';
    if (res.tournamentId) note += '（大会を選んでいるときも、カレンダーは所属しているすべてのチームの試合を出します）';
    $('cal-note').textContent = note;
    if (cal.teamId === teamId) return;
    cal.teamId = teamId;
    loadCalendar(cal.view.month());
  }

  /** その月の○●と、日ごとの試合を読む */
  function loadCalendar(month) {
    const my = ++cal.loading;
    const data = { month: month };
    if (cal.teamId) data.team_id = cal.teamId;
    NinelogUI.clearAlerts($('cal-card'));
    return NinelogApp.call('getCalendar', data).then(function (res) {
      if (my !== cal.loading) return; // 読んでいる間に月やチームを変えたら使わない
      const marks = {};
      cal.days = {};
      res.days.forEach(function (d) {
        marks[d.date] = { game: d.has_team_game, mine: d.has_my_record };
        cal.days[d.date] = d;
      });
      cal.view.setMarks(marks);
      renderDay();
    }).catch(function (err) {
      if (my === cal.loading) NinelogUI.showError(err, $('cal-card'));
    });
  }

  /** 押した日の試合と、自分の成績を出す */
  function renderDay() {
    const box = $('day');
    box.innerHTML = '';
    if (!cal.selected) return;
    box.appendChild(el('h3', 'nl-day__title', dateLabel(cal.selected)));
    const day = cal.days[cal.selected];
    if (!day || !day.games.length) {
      box.appendChild(el('p', 'nl-empty', 'この日のチームの試合はありません。'));
      return;
    }
    day.games.forEach(function (g) { box.appendChild(dayGame(g)); });
  }

  function dayGame(g) {
    const row = el('div', 'nl-row');
    const main = el('div', 'nl-row__main');
    main.appendChild(el('span', 'nl-row__name', '第' + g.game_number + '試合　' + (g.opponent ? 'vs ' + g.opponent : '（相手は未入力）')));
    if (g.tournament_name) main.appendChild(el('span', 'nl-badge', g.tournament_name));
    if (RESULT_LABELS[g.result]) main.appendChild(el('span', 'nl-badge', RESULT_LABELS[g.result]));
    main.appendChild(el('span', 'nl-row__meta', g.team_name));
    row.appendChild(main);

    // 自分の成績（打撃・投手）
    const has = Boolean(g.my_batting_record_id || g.my_pitching_record_id);
    if (has && !cal.records) {
      row.appendChild(el('p', 'nl-note', '成績を読み込み中です…'));
    } else if (has) {
      const b = cal.records.batting[g.my_batting_record_id];
      const p = cal.records.pitching[g.my_pitching_record_id];
      if (b) row.appendChild(el('p', 'nl-day__line', '打撃：' + battingLine(b)));
      if (p) row.appendChild(el('p', 'nl-day__line', '投手：' + p.innings_text + '　自責点' + p.earned_runs));
    } else {
      row.appendChild(el('p', 'nl-note', 'この試合のあなたの成績は、まだありません。'));
    }

    // 「直す」「入力する」：試合日から30日以内だけ（11.0章の16）。押すと「成績を入力」で、この試合を選んだ状態で開く
    if (g.can_input) {
      const params = new URLSearchParams({ team: g.team_id, date: g.game_date, game: g.game_id });
      if (!g.my_batting_record_id && g.my_pitching_record_id) params.set('tab', 'pitching');
      const a = el('a', 'nl-chip', has ? '成績を直す' : '成績を入力する');
      a.href = 'input.html?' + params.toString();
      const actions = el('div', 'nl-row__actions');
      actions.appendChild(a);
      row.appendChild(actions);
    } else {
      row.appendChild(el('p', 'nl-note', '試合日から30日を過ぎたので、入力・修正はできません。'));
    }
    return row;
  }

  /** 「4打席 3打数 2安打　本塁打1　打点2」のように、0でない数を短く並べる */
  function battingLine(b) {
    const parts = [b.plate_appearances + '打席 ' + b.at_bats + '打数 ' + b.hits + '安打'];
    [['doubles', '二塁打'], ['triples', '三塁打'], ['home_runs', '本塁打'], ['rbis', '打点'], ['walks', '四球'],
      ['hbp', '死球'], ['sacrifice_bunts', '犠打'], ['sacrifice_flies', '犠飛'], ['strikeouts', '三振'], ['stolen_bases', '盗塁']]
      .forEach(function (f) { if (Number(b[f[0]])) parts.push(f[1] + b[f[0]]); });
    return parts.join('　');
  }

  /* ---------- 入力した成績の一覧（C-10。3.4章・4.5b章） ---------- */

  const REC_PAGE = 10; // 最初に出す件数（「もっと見る」で10件ずつ足す）
  const recs = { lists: null, limit: REC_PAGE, confirming: '', kind: 'batting' };
  /** 種類ごとの言葉と、消す操作の名前 */
  const REC_KINDS = {
    batting: { label: '打撃', del: 'deleteBattingRecord' },
    pitching: { label: '投手', del: 'deletePitchingRecord' },
  };

  /** 選んでいる年度と範囲に入る記録だけ（getMyStats の決まりと同じ：年度・チーム・大会） */
  function recordsInScope(list) {
    if (!shown) return [];
    return list.filter(function (r) {
      return (shown.season === 'all' || String(r.game_date).slice(0, 4) === shown.season)
        && (!shown.teamId || r.team_id === shown.teamId)
        && (!shown.tournamentId || r.tournament_id === shown.tournamentId);
    });
  }

  function teamNameOf(teamId) {
    const t = shown ? shown.teams.filter(function (x) { return x.teamId === teamId; })[0] : null;
    return t ? t.teamName : '';
  }

  function renderRecords() {
    const box = $('rec-list');
    box.innerHTML = '';
    $('rec-more-box').hidden = true;
    if (!recs.lists || !shown) {
      $('rec-note').textContent = '';
      box.appendChild(NinelogUI.loadingEl());
      return;
    }
    const k = REC_KINDS[recs.kind];
    $('rec-kind').querySelectorAll('button').forEach(function (b) {
      b.setAttribute('aria-pressed', b.getAttribute('data-kind') === recs.kind ? 'true' : 'false');
    });
    const list = recordsInScope(recs.lists[recs.kind]);
    $('rec-note').textContent = k.label + '成績：選んでいる年度と範囲の ' + list.length + '件（試合日の新しい順）。' +
      '直せる・消せるのは、試合日から30日以内の記録だけです。';
    if (!list.length) {
      box.appendChild(el('p', 'nl-empty', 'この年度と範囲の' + k.label + '成績はありません。'));
      return;
    }
    list.slice(0, recs.limit).forEach(function (r) { box.appendChild(recordRow(r)); });
    if (list.length > recs.limit) {
      $('rec-more-box').hidden = false;
      $('rec-more').textContent = 'もっと見る（残り' + (list.length - recs.limit) + '件）';
    }
  }

  function recordRow(r) {
    const row = el('div', 'nl-row');
    const main = el('div', 'nl-row__main');
    main.appendChild(el('span', 'nl-row__name', dateLabel(r.game_date) + '　第' + r.game_number + '試合　' +
      (r.opponent ? 'vs ' + r.opponent : '（相手は未入力）')));
    if (r.tournament_name) main.appendChild(el('span', 'nl-badge', r.tournament_name));
    main.appendChild(el('span', 'nl-row__meta', teamNameOf(r.team_id)));
    row.appendChild(main);
    const kind = recs.kind;
    const k = REC_KINDS[kind];
    row.appendChild(el('p', 'nl-day__line', kind === 'pitching' ? r.innings_text + '　自責点' + r.earned_runs : battingLine(r)));

    if (!r.editable) {
      row.appendChild(el('p', 'nl-note', '試合日から30日を過ぎたので、直したり消したりできません。'));
      return row;
    }
    const actions = el('div', 'nl-row__actions');
    // 直す：「成績を入力」で、この試合を選んだ状態で開く（C-6b と同じ）
    const edit = el('a', 'nl-chip', '直す');
    const params = { team: r.team_id, date: r.game_date, game: r.game_id };
    if (kind === 'pitching') params.tab = 'pitching'; // 投手の入力欄を開いておく
    edit.href = 'input.html?' + new URLSearchParams(params).toString();
    actions.appendChild(edit);
    // 消す：押すと確かめる文が出て、もう一度押すと消す（まちがえて押さないように）
    const del = el('button', 'nl-chip nl-chip--danger', '消す');
    del.type = 'button';
    actions.appendChild(del);
    row.appendChild(actions);

    const confirmBox = el('div', '');
    confirmBox.hidden = recs.confirming !== r.record_id;
    confirmBox.appendChild(el('p', 'nl-note', 'この試合の' + k.label + '成績を消しますか？ 消すと、成績・ランキングの計算から外れます。' +
      'まちがえて消したときは、もう一度入力してください（' + dateLabel(r.editable_until) + 'まで）。'));
    const yesNo = el('div', 'nl-actions');
    const yes = el('button', 'nl-btn nl-btn--danger', '消す');
    yes.type = 'button';
    const no = el('button', 'nl-btn nl-btn--sub', 'やめる');
    no.type = 'button';
    yesNo.appendChild(yes);
    yesNo.appendChild(no);
    confirmBox.appendChild(yesNo);
    row.appendChild(confirmBox);

    del.addEventListener('click', function () { recs.confirming = r.record_id; confirmBox.hidden = false; actions.hidden = true; });
    no.addEventListener('click', function () { recs.confirming = ''; confirmBox.hidden = true; actions.hidden = false; NinelogUI.clearAlerts(row); });
    if (!confirmBox.hidden) actions.hidden = true;
    yes.addEventListener('click', function () {
      NinelogUI.clearAlerts(row);
      NinelogUI.withBusy(yes, function () {
        return NinelogApp.call(k.del, { record_id: r.record_id }).then(function () {
          recs.confirming = '';
          // 消した記録を一覧・カレンダー・成績から外す（読み直す）
          return Promise.all([
            loadMine(),
            load(Object.assign({ season: shown.season }, shown.teamId ? { team_id: shown.teamId } : shown.tournamentId ? { tournament_id: shown.tournamentId } : {})),
          ]).then(function () {
            loadCalendar(cal.view.month());
            // 消した行は無くなるので、お知らせは一覧の四角の一番下に出す
            NinelogUI.showOk(k.label + '成績を消しました：' + dateLabel(r.game_date) + '　第' + r.game_number + '試合', $('rec-card'));
          });
        }).catch(function (err) { NinelogUI.showError(err, row); });
      });
    });
    return row;
  }

  $('rec-kind').querySelectorAll('button').forEach(function (b) {
    b.addEventListener('click', function () {
      recs.kind = b.getAttribute('data-kind');
      recs.limit = REC_PAGE;
      recs.confirming = '';
      NinelogUI.clearAlerts($('rec-card'));
      renderRecords();
    });
  });

  $('rec-more').addEventListener('click', function () {
    recs.limit += REC_PAGE;
    renderRecords();
  });

  $('season').addEventListener('change', reload);
  $('scope').addEventListener('change', reload);

  NinelogUI.boot('mystats', '自分の成績', start);
})();
