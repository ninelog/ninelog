/**
 * 「自分の成績」の画面（mystats.html）。C-6。CLAUDE.md 6.5章・11.7章のG・11.8章
 *
 * - 年度（通算・記録がある年度）と範囲（全チーム合計・各チーム・ひとりの記録・各大会）を選ぶ
 * - 打撃（率4つと13項目の合計・塁打）と投手（防御率・投球回・自責点）を出す
 * - 計算はGAS（getMyStats）が行い、画面は出すだけ（6.3章と同じ考え方）
 *
 * 使うGASの操作：getMyStats
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

  function start() {
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
    $('content').classList.add('is-loading');
    return NinelogApp.call('getMyStats', data).then(function (res) {
      if (my !== loading) return; // 読んでいる間に選び直したら、古い結果は使わない
      $('content').classList.remove('is-loading');
      shown = res;
      renderFilters(res);
      render(res);
    }, function (err) {
      if (my !== loading) return;
      $('content').classList.remove('is-loading');
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

  $('season').addEventListener('change', reload);
  $('scope').addEventListener('change', reload);

  NinelogUI.boot('mystats', '自分の成績', start);
})();
