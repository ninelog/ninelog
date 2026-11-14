/**
 * 「ランキング」の画面（ranking.html）。C-7。CLAUDE.md 6.2〜6.4章・11.8章
 *
 * - チーム（大会とひとりの記録は出さない）と年度を選び、8部門を切り替えて見る
 * - 順位・規定の判定はGAS（getTeamRanking）が行い、画面は並べて出すだけ（6.3章）
 * - 8部門はまとめて1回で届くので、部門の切り替えではGASに聞き直さない（B-13の細部1）
 *
 * 使うGASの操作：listMyTeams・getTeamRanking
 */
(function () {
  const $ = function (id) { return document.getElementById(id); };
  const el = NinelogUI.el;
  const TEAM_KEY = 'ninelog_ranking_team'; // 前に見たチーム（この端末だけに覚える。なくても動く）

  /** 部門の並び（6.4章の表の順。GASの部門の名前と同じ） */
  const CATEGORY_ORDER = ['avg', 'obp', 'ops', 'era', 'hits', 'home_runs', 'rbis', 'stolen_bases'];

  const state = { category: 'avg', shown: null, loading: 0 };

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
    }
    li.appendChild(who);
    li.appendChild(el('span', 'nl-rank__value', r.text));
    return li;
  }

  $('team').addEventListener('change', function () { reload({ team_id: this.value }); });
  $('season').addEventListener('change', function () { reload({ team_id: $('team').value, season: this.value }); });

  NinelogUI.boot('ranking', 'ランキング', start);
})();
