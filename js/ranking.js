/**
 * 「ランキング」の画面（ranking.html）。C-7・C-8。CLAUDE.md 6.2〜6.4章・11.8章
 *
 * - チーム（大会とひとりの記録は出さない）と年度を選び、8部門を切り替えて見る
 * - 順位・規定の判定はGAS（getTeamRanking）が行い、画面は並べて出すだけ（6.3章）
 * - 8部門はまとめて1回で届くので、部門の切り替えではGASに聞き直さない（B-13の細部1）
 *
 * - C-7b：「チームの成績」に切り替えると、チーム全体の成績（getTeamStats）を出す。11.4章・B-14
 *
 * 使うGASの操作：listMyTeams・getTeamRanking・getTeamStats
 */
(function () {
  const $ = function (id) { return document.getElementById(id); };
  const el = NinelogUI.el;
  const TEAM_KEY = 'ninelog_ranking_team'; // 前に見たチーム（この端末だけに覚える。なくても動く）

  /** 部門の並び（6.4章の表の順。GASの部門の名前と同じ） */
  const CATEGORY_ORDER = ['avg', 'obp', 'ops', 'era', 'hits', 'home_runs', 'rbis', 'stolen_bases'];

  const state = { category: 'avg', shown: null, loading: 0, view: 'ranking', stats: {}, statsLoading: 0 };
  const teamBreakdown = NinelogBreakdown.create($('ts-bd-card'), { withRecord: true }); // 相手別など（C-7b）

  function start() {
    return NinelogApp.call('listMyTeams').then(function (res) {
      // ランキングがあるのはチームだけ（大会は C-7d、ひとりの記録には無い：11.8章の7）
      const teams = res.teams.filter(function (t) { return t.orgType === 'team'; });
      if (!teams.length) {
        $('loading').hidden = true;
        $('no-team').hidden = false;
        return null;
      }
      let saved = '';
      try { saved = localStorage.getItem(TEAM_KEY) || ''; } catch (e) { /* 覚えられなくても動く */ }
      const teamId = teams.some(function (t) { return t.teamId === saved; }) ? saved : teams[0].teamId;
      return load({ team_id: teamId }).then(function () {
        $('loading').hidden = true;
        $('content').hidden = false;
      });
    }).catch(function (err) {
      $('loading').hidden = true;
      NinelogUI.showError(err);
    });
  }

  /** GASにランキングを聞く（あとから始めた読み込みの結果だけを使う） */
  function load(data) {
    const my = ++state.loading;
    $('content').classList.add('is-loading');
    return NinelogApp.call('getTeamRanking', data).then(function (res) {
      if (my !== state.loading) return;
      $('content').classList.remove('is-loading');
      state.shown = res;
      try { localStorage.setItem(TEAM_KEY, res.teamId); } catch (e) { /* 覚えられなくても動く */ }
      renderFilters(res);
      renderCats();
      renderRows();
      if (state.view === 'team') loadTeamStats();
    }, function (err) {
      if (my !== state.loading) return;
      $('content').classList.remove('is-loading');
      throw err;
    });
  }

  function reload(data) {
    NinelogUI.clearAlerts($('filters'));
    load(data).catch(function (err) {
      // 読めなかったときは、選択欄を、いま出しているランキングのものに戻す
      if (state.shown) renderFilters(state.shown);
      NinelogUI.showError(err, $('filters'));
    });
  }

  /* ---------- 選択欄 ---------- */

  function option(value, text) {
    const o = el('option', '', text);
    o.value = value;
    return o;
  }

  function renderFilters(res) {
    const team = $('team');
    team.innerHTML = '';
    res.teams.forEach(function (t) { team.appendChild(option(t.teamId, t.teamName)); });
    team.value = res.teamId;

    const season = $('season');
    season.innerHTML = '';
    season.appendChild(option('all', '通算'));
    res.seasons.forEach(function (s) { season.appendChild(option(s, s + '年')); });
    if (res.season !== 'all' && res.seasons.indexOf(res.season) === -1) {
      season.appendChild(option(res.season, res.season + '年'));
    }
    season.value = res.season;

    // 規定の基準（6.2〜6.3章）
    $('qualify-note').textContent = 'チーム試合数 ' + res.teamGames + '試合　規定打席 ' + res.qualifyPlateAppearances +
      '打席　規定投球回 ' + res.qualifyInningsText;
  }

  /* ---------- 部門の切り替え ---------- */

  function renderCats() {
    const box = $('cats');
    box.innerHTML = '';
    const cats = state.shown.categories;
    CATEGORY_ORDER.forEach(function (key) {
      if (!cats[key]) return;
      const b = el('button', 'nl-cat', cats[key].label);
      b.type = 'button';
      b.setAttribute('aria-pressed', key === state.category ? 'true' : 'false');
      b.addEventListener('click', function () {
        state.category = key;
        renderCats();
        renderRows();
      });
      box.appendChild(b);
    });
  }

  /* ---------- ランキングの行 ---------- */

  function renderRows() {
    const res = state.shown;
    const c = res.categories[state.category];
    const list = $('rows');
    list.innerHTML = '';
    $('cat-note').textContent = catNote(c, res);

    if (!c.rows.length) {
      list.appendChild(el('li', 'nl-empty', (res.season === 'all' ? '' : res.season + '年の') + 'この部門の記録は、まだありません。'));
      return;
    }
    let dividerShown = false;
    c.rows.forEach(function (r) {
      // 規定に届いていない人の前に、区切りを1回だけ入れる（6.4章）
      if (!r.qualified && !dividerShown) {
        dividerShown = true;
        list.appendChild(el('li', 'nl-rank__divider', state.category === 'era' ? '規定投球回に届いていない人' : '規定打席に届いていない人'));
      }
      list.appendChild(rowItem(c, r));
    });
  }

  /** 部門の説明（並び方と、率の部門の規定） */
  function catNote(c, res) {
    if (c.kind === 'count') return '多い順。打撃の記録がある全員に順位を付けます（同じ数は同じ順位）。';
    if (state.category === 'era') return '低い順。規定投球回（' + res.qualifyInningsText + '）に届いた人に順位を付けます。';
    return '高い順。規定打席（' + res.qualifyPlateAppearances + '打席）に届いた人に順位を付けます。';
  }

  function rowItem(c, r) {
    const li = el('li', 'nl-rank__row' + (r.is_me ? ' is-me' : '') + (r.qualified ? '' : ' is-unqualified'));
    li.appendChild(el('span', 'nl-rank__no', r.rank ? r.rank + '位' : '-'));
    const who = el('span', 'nl-rank__who');
    who.appendChild(el('span', 'nl-rank__name', r.displayName));
    if (r.is_me) who.appendChild(el('span', 'nl-badge', 'あなた'));
    // 率の部門は、打席数・投球回も小さく出す（規定との比べ方がわかるように）
    if (c.kind === 'rate') {
      const sub = state.category === 'era' ? r.innings_text : r.plate_appearances + '打席';
      who.appendChild(el('span', 'nl-rank__sub', sub));
      // C-8：規定に届いていない人には、あと少しを出す（GASが作った文：「規定打席まであと3打席」「規定投球回まであと2/3回」）
      if (!r.qualified && r.remaining_text) {
        who.appendChild(el('span', 'nl-rank__remain', r.remaining_text));
      } else if (r.qualified && r.value === null) {
        // 規定に届いていても、打数が0の人（四球だけなど）は率が出ない（B-13の細部3）
        who.appendChild(el('span', 'nl-rank__sub', '打数が0なので、率は出ません'));
      }
    }
    li.appendChild(who);
    li.appendChild(el('span', 'nl-rank__value', r.text));
    return li;
  }

  /* ---------- チーム全体の成績（C-7b。11.4章・B-14） ---------- */

  /** 打撃の数の並び（自分の成績と同じ。チームでは「のべ」の数） */
  const BATTING_COUNTS = [
    ['plate_appearances', '打席'], ['at_bats', '打数'], ['hits', '安打'],
    ['doubles', '二塁打'], ['triples', '三塁打'], ['home_runs', '本塁打'],
    ['rbis', '打点'], ['walks', '四球'], ['hbp', '死球'],
    ['sacrifice_bunts', '犠打'], ['sacrifice_flies', '犠飛'], ['strikeouts', '三振'],
    ['stolen_bases', '盗塁'], ['total_bases', '塁打'],
  ];

  function setView(view) {
    state.view = view;
    $('view').querySelectorAll('button').forEach(function (b) {
      b.setAttribute('aria-pressed', b.getAttribute('data-view') === view ? 'true' : 'false');
    });
    $('ranking-card').hidden = view !== 'ranking';
    $('team-view').hidden = view !== 'team';
    if (view === 'team') loadTeamStats();
  }

  /**
   * いま選んでいるチームと年度の、チーム全体の成績を読む。
   * 一度読んだものは覚えておき、同じチーム・年度なら聞き直さない（画面を開き直すと読み直す）。
   */
  function loadTeamStats() {
    const res = state.shown;
    if (!res) return;
    const key = res.teamId + '|' + res.season;
    if (state.stats[key]) { renderTeamStats(state.stats[key]); return; }
    const my = ++state.statsLoading;
    $('team-view').classList.add('is-loading');
    NinelogUI.clearAlerts($('filters'));
    NinelogApp.call('getTeamStats', { team_id: res.teamId, season: res.season }).then(function (stats) {
      if (my !== state.statsLoading) return;
      $('team-view').classList.remove('is-loading');
      state.stats[key] = stats;
      renderTeamStats(stats);
    }).catch(function (err) {
      if (my !== state.statsLoading) return;
      $('team-view').classList.remove('is-loading');
      NinelogUI.showError(err, $('filters'));
    });
  }

  function tile(label, value) {
    const t = el('div', 'nl-tile');
    t.appendChild(el('div', 'nl-tile__label', label));
    t.appendChild(el('div', 'nl-tile__value', value));
    return t;
  }
  function stat(label, value) {
    const s = el('div', 'nl-stat');
    s.appendChild(el('span', 'nl-stat__label', label));
    s.appendChild(el('span', 'nl-stat__value', String(value === undefined || value === null ? 0 : value)));
    return s;
  }

  function renderTeamStats(ts) {
    const none = ts.games === 0;
    $('ts-empty').hidden = !none;
    $('ts-empty-text').textContent = (ts.season === 'all' ? '' : ts.season + '年の') + '「' + ts.teamName + '」の試合は、まだありません。';
    $('ts-record-card').hidden = none;
    const b = ts.batting;
    const p = ts.pitching;
    $('ts-batting-card').hidden = none || !b.appearances;
    $('ts-pitching-card').hidden = none || !p.appearances;
    teamBreakdown.update(none ? {} : ts.breakdowns);
    if (none) return;

    // 勝敗（B-14の細部1・2）
    $('ts-games').textContent = ts.games + '試合';
    const rec = $('ts-record');
    rec.innerHTML = '';
    rec.appendChild(tile('勝ち', String(ts.record.win)));
    rec.appendChild(tile('負け', String(ts.record.lose)));
    rec.appendChild(tile('引き分け', String(ts.record.draw)));
    rec.appendChild(tile('勝率', ts.winning_pct.text));
    $('ts-record-note').textContent = '勝率 ＝ 勝ち ÷（勝ち＋負け）。' +
      (ts.record.unknown ? '勝敗が未入力の試合が' + ts.record.unknown + '試合あります（試合数には入り、勝率には入りません）。' : '');

    // チームの打撃（全員の合計から計算。B-14の細部3）
    if (b.appearances) {
      $('ts-batting-sub').textContent = 'のべ' + b.appearances + '人';
      const rates = $('ts-batting-rates');
      rates.innerHTML = '';
      [['avg', '打率'], ['obp', '出塁率'], ['slg', '長打率'], ['ops', 'OPS']].forEach(function (r) {
        rates.appendChild(tile(r[1], b[r[0]].text));
      });
      const counts = $('ts-batting-counts');
      counts.innerHTML = '';
      BATTING_COUNTS.forEach(function (c) { counts.appendChild(stat(c[1], b[c[0]])); });
    }
    if (p.appearances) {
      $('ts-pitching-sub').textContent = 'のべ' + p.appearances + '人';
      const rates = $('ts-pitching-rates');
      rates.innerHTML = '';
      rates.appendChild(tile('防御率', p.era.text));
      rates.appendChild(tile('投球回', p.innings_text));
      rates.appendChild(tile('自責点', String(p.earned_runs)));
    }
  }

  $('view').querySelectorAll('button').forEach(function (b) {
    b.addEventListener('click', function () { setView(b.getAttribute('data-view')); });
  });

  $('team').addEventListener('change', function () { reload({ team_id: this.value }); });
  $('season').addEventListener('change', function () { reload({ team_id: $('team').value, season: this.value }); });

  NinelogUI.boot('ranking', 'ランキング', start);
})();
