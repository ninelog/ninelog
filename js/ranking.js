/**
 * 「ランキング」の画面（ranking.html）。C-7・C-8・C-7b・C-7c・C-7d。CLAUDE.md 6.2〜6.4章・11.7章・11.8章
 *
 * - チームか大会（ひとりの記録は出さない）と年度を選び、8部門を切り替えて見る
 * - 順位・規定の判定はGAS（getTeamRanking・getTournamentRanking）が行い、画面は並べて出すだけ（6.3章）
 * - C-7d：チームと大会を1つの選択欄に並べる（「チーム：〇〇」「大会：〇〇」。11.7章のH）。
 *   大会のランキングでは、表示名の横にチーム名を出す（11.7章のE）。チームの成績（C-7b）は大会には無い（11.7章のI）
 * - 8部門はまとめて1回で届くので、部門の切り替えではGASに聞き直さない（B-13の細部1）
 *
 * - C-7b：「チームの成績」に切り替えると、チーム全体の成績（getTeamStats）を出す。11.4章・B-14
 * - C-7c：選んでいる部門の上位3人を、LINEのグループや友だちに共有する（liff.shareTargetPicker）。11.5章
 *   2026-11-14 追加：人数（上位3人／5人／10人／全員）を選べる。「全部門まとめて送る」で8部門を1通にまとめて送れる
 *
 * 使うGASの操作：listMyTeams・getTeamRanking・getTournamentRanking・getTeamStats
 */
(function () {
  const $ = function (id) { return document.getElementById(id); };
  const el = NinelogUI.el;
  const TEAM_KEY = 'ninelog_ranking_team'; // 前に見たチーム・大会（「team:ID」「tour:ID」。この端末だけに覚える。なくても動く）

  /** 部門の並び（6.4章の表の順。GASの部門の名前と同じ） */
  const CATEGORY_ORDER = ['avg', 'obp', 'ops', 'era', 'hits', 'home_runs', 'rbis', 'stolen_bases'];

  const state = { category: 'avg', shown: null, loading: 0, view: 'ranking', stats: {}, statsLoading: 0, orgs: [] };

  /** 選択欄の値（「team:ID」「tour:ID」）を、GASに送る形にする */
  function keyToData(key) {
    if (key.indexOf('tour:') === 0) return { tournament_id: key.slice(5) };
    return { team_id: key.indexOf('team:') === 0 ? key.slice(5) : key }; // 前の形（IDだけ）はチームとして読む
  }
  const teamBreakdown = NinelogBreakdown.create($('ts-bd-card'), { withRecord: true }); // 相手別など（C-7b）

  function start() {
    return NinelogApp.call('listMyTeams').then(function (res) {
      // ランキングがあるのはチームと大会（ひとりの記録には無い：11.8章の7）。チームを先、大会をあとに並べる
      const pick = function (type, prefix) {
        return res.teams.filter(function (t) { return t.orgType === type; })
          .map(function (t) { return { key: prefix + t.teamId, kind: prefix === 'tour:' ? 'tour' : 'team', name: t.teamName }; });
      };
      state.orgs = pick('team', 'team:').concat(pick('tournament', 'tour:'));
      if (!state.orgs.length) {
        $('loading').hidden = true;
        $('no-team').hidden = false;
        return null;
      }
      let saved = '';
      try { saved = localStorage.getItem(TEAM_KEY) || ''; } catch (e) { /* 覚えられなくても動く */ }
      if (saved && saved.indexOf(':') === -1) saved = 'team:' + saved; // 前の形（IDだけ）
      const key = state.orgs.some(function (o) { return o.key === saved; }) ? saved : state.orgs[0].key;
      return load(keyToData(key)).then(function () {
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
    const isTour = Boolean(data.tournament_id);
    const done = NinelogUI.busy($('content')); // 読み込み中の表示（くるくる）
    return NinelogApp.call(isTour ? 'getTournamentRanking' : 'getTeamRanking', data).then(function (res) {
      done();
      if (my !== state.loading) return;
      // チームと大会の返事を、画面で同じように扱えるようにそろえる
      res.kind = isTour ? 'tour' : 'team';
      res.orgName = isTour ? res.tournamentName : res.teamName;
      res.key = (isTour ? 'tour:' : 'team:') + (isTour ? res.tournamentId : res.teamId);
      state.shown = res;
      try { localStorage.setItem(TEAM_KEY, res.key); } catch (e) { /* 覚えられなくても動く */ }
      renderFilters(res);
      renderCats();
      renderRows();
      syncView(res);
    }, function (err) {
      done();
      if (my !== state.loading) return;
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
    // チームと大会を1つの選択欄に（11.7章のH）
    const team = $('team');
    team.innerHTML = '';
    [['team', 'チーム'], ['tour', '大会']].forEach(function (g) {
      const list = state.orgs.filter(function (o) { return o.kind === g[0]; });
      if (!list.length) return;
      const group = el('optgroup');
      group.label = g[1];
      list.forEach(function (o) { group.appendChild(option(o.key, g[1] + '：' + o.name)); });
      team.appendChild(group);
    });
    team.value = res.key;

    const season = $('season');
    season.innerHTML = '';
    season.appendChild(option('all', '通算'));
    res.seasons.forEach(function (s) { season.appendChild(option(s, s + '年')); });
    if (res.season !== 'all' && res.seasons.indexOf(res.season) === -1) {
      season.appendChild(option(res.season, res.season + '年'));
    }
    season.value = res.season;

    // 規定の基準（6.2〜6.3章。大会は選手ごとに、そのチームの大会での試合数で決まる：11.7章のF）
    if (res.kind === 'tour') {
      const per = (res.teamGames || []).map(function (t) { return t.teamName + ' ' + t.games + '試合'; }).join('・');
      $('qualify-note').textContent = '大会の試合数 ' + res.tournamentGames + '試合' + (per ? '（' + per + '）' : '') +
        '。規定は選手ごとに、そのチームの大会での試合数で決まります（×2打席・×1回）。';
    } else {
      $('qualify-note').textContent = 'チーム試合数 ' + res.teamGames + '試合　規定打席 ' + res.qualifyPlateAppearances +
        '打席　規定投球回 ' + res.qualifyInningsText;
    }
  }

  /** 大会では「チームの成績」の切り替えを隠して、ランキングだけにする（11.7章のI） */
  function syncView(res) {
    const isTour = res.kind === 'tour';
    $('view').hidden = isTour;
    if (isTour && state.view === 'team') setView('ranking');
    else if (state.view === 'team') loadTeamStats();
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
    renderShare(res, c);
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
    if (res.kind === 'tour') {
      return state.category === 'era'
        ? '低い順。規定投球回（その選手のチームの大会での試合数×1回）に届いた人に順位を付けます。'
        : '高い順。規定打席（その選手のチームの大会での試合数×2打席）に届いた人に順位を付けます。';
    }
    if (state.category === 'era') return '低い順。規定投球回（' + res.qualifyInningsText + '）に届いた人に順位を付けます。';
    return '高い順。規定打席（' + res.qualifyPlateAppearances + '打席）に届いた人に順位を付けます。';
  }

  function rowItem(c, r) {
    const li = el('li', 'nl-rank__row' + (r.is_me ? ' is-me' : '') + (r.qualified ? '' : ' is-unqualified'));
    li.appendChild(el('span', 'nl-rank__no', r.rank ? r.rank + '位' : '-'));
    const who = el('span', 'nl-rank__who');
    who.appendChild(el('span', 'nl-rank__name', r.displayName));
    // 大会のランキングでは、表示名の横にチーム名を出す（11.7章のE）
    if (r.teamName) who.appendChild(el('span', 'nl-rank__team', '（' + r.teamName + '）'));
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

  /* ---------- LINEで共有する（C-7c。11.5章） ---------- */

  const SHARE_TEXT_MAX = 5000; // LINEの文字のメッセージの上限（文字数）
  let shareCount = 3;         // 何人まで送るか（3・5・10・'all'＝全員）。最初は3人

  /** 共有できるか（LINEアプリの中で開いていて、シェアターゲットピッカーが使えるとき） */
  function canShare() {
    try {
      return liff.isInClient() && liff.isApiAvailable('shareTargetPicker');
    } catch (e) {
      return false;
    }
  }

  /**
   * 共有する人：順位の付いた人だけ（規定に届いていない人と、値の無い人は入れない：11.5章）。
   * 人数で区切るのは順位で決める（同じ順位の人は、区切りの人数を超えても全員入れる。例：上位3人で3位が2人なら4人）
   */
  function topRows(c) {
    return c.rows.filter(function (r) { return r.rank && (shareCount === 'all' || r.rank <= shareCount); });
  }

  /** 人数の言い方（ボタンと送る文で使う） */
  function countLabel() { return shareCount === 'all' ? '全員' : '上位' + shareCount + '人'; }

  /** 1つの部門の行（「1位　山田（ナインA）　.500」）。率の部門で「全員」のときは、規定に届いていない人数を添える */
  function categoryLines(c, key) {
    const lines = topRows(c).map(function (r) {
      return r.rank + '位　' + r.displayName + (r.teamName ? '（' + r.teamName + '）' : '') + '　' + r.text;
    });
    if (!lines.length) lines.push('（順位の付いた人はいません）');
    if (shareCount === 'all' && c.kind === 'rate') {
      const short = c.rows.filter(function (r) { return !r.qualified; }).length;
      if (short) lines.push('（' + (key === 'era' ? '規定投球回' : '規定打席') + 'に届いていない人：' + short + '人）');
    }
    return lines;
  }

  function seasonText(res) { return res.season === 'all' ? '通算' : res.season + '年'; }
  function linkLine() { return 'ランキングを見る：https://liff.line.me/' + NINELOG_CONFIG.LIFF_ID + '/ranking.html'; }

  /** この部門だけの文（チーム名・年度・部門・選んだ人数・リンク。11.5章） */
  function shareText(res, c) {
    const lines = ['【ナインログ】' + res.orgName + '　' + seasonText(res) + '　' + c.label + 'ランキング' + (shareCount === 3 ? '' : '（' + countLabel() + '）')];
    return lines.concat(categoryLines(c, state.category), ['', linkLine()]).join('\n');
  }

  /** 8部門をまとめた文（年末の成績発表などに） */
  function shareAllText(res) {
    const lines = ['【ナインログ】' + res.orgName + '　' + seasonText(res) + '　全部門ランキング（' + countLabel() + '）'];
    CATEGORY_ORDER.forEach(function (key) {
      const c = res.categories[key];
      if (!c) return;
      lines.push('');
      lines.push('■' + c.label);
      Array.prototype.push.apply(lines, categoryLines(c, key));
    });
    lines.push('');
    lines.push(linkLine());
    return lines.join('\n');
  }

  /** ボタンを押せるかと、その下の説明を合わせる */
  function renderShare(res, c) {
    const btn = $('btn-share');
    const allBtn = $('btn-share-all');
    const note = $('share-note');
    NinelogUI.clearAlerts($('share'));
    $('share-count').querySelectorAll('button').forEach(function (b) {
      b.setAttribute('aria-pressed', b.getAttribute('data-count') === String(shareCount) ? 'true' : 'false');
    });
    btn.textContent = 'この部門の' + countLabel() + 'をLINEで共有する';
    allBtn.textContent = '全部門まとめて送る（' + countLabel() + '）';
    const anyRanked = CATEGORY_ORDER.some(function (key) { return res.categories[key] && topRows(res.categories[key]).length; });
    if (!canShare()) {
      btn.disabled = true;
      allBtn.disabled = true;
      note.textContent = '共有は、LINEアプリの中で開いたときだけ使えます。';
      return;
    }
    btn.disabled = !topRows(c).length;
    allBtn.disabled = !anyRanked;
    if (!anyRanked) note.textContent = '順位の付いた人がいないので、共有できません。';
    else if (!topRows(c).length) note.textContent = 'この部門は順位の付いた人がいないので共有できません（全部門まとめて送ることはできます）。';
    else note.textContent = '送り先（グループや友だち）を選ぶ画面が開きます。あなたのLINEから送られます。規定に届いていない人は入りません。';
  }

  /** 文を送る（長すぎるときは送らずに知らせる） */
  function sendText(text, button) {
    const box = $('share');
    NinelogUI.clearAlerts(box);
    if (text.length > SHARE_TEXT_MAX) {
      NinelogUI.showError({ message: '人数が多くて、1通で送れる長さを超えます。人数を減らしてください。' }, box);
      return;
    }
    NinelogUI.withBusy(button, function () {
      return liff.shareTargetPicker([{ type: 'text', text: text }], { isMultiple: true }).then(function (result) {
        // 送り先を選ばずに閉じたときは、何も出さない
        if (result) NinelogUI.showOk('共有しました。', box);
      }).catch(function () {
        NinelogUI.showError({ message: '共有できませんでした。LINEアプリを最新にして、もう一度ためしてください。' }, box);
      });
    });
  }

  $('btn-share').addEventListener('click', function () {
    const res = state.shown;
    sendText(shareText(res, res.categories[state.category]), $('btn-share'));
  });
  $('btn-share-all').addEventListener('click', function () {
    sendText(shareAllText(state.shown), $('btn-share-all'));
  });
  $('share-count').querySelectorAll('button').forEach(function (b) {
    b.addEventListener('click', function () {
      const v = b.getAttribute('data-count');
      shareCount = v === 'all' ? 'all' : Number(v);
      const res = state.shown;
      renderShare(res, res.categories[state.category]);
    });
  });

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
    if (!res || res.kind !== 'team') return;
    const key = res.teamId + '|' + res.season;
    if (state.stats[key]) { renderTeamStats(state.stats[key]); return; }
    const my = ++state.statsLoading;
    const done = NinelogUI.busy($('team-view'));
    NinelogUI.clearAlerts($('filters'));
    NinelogApp.call('getTeamStats', { team_id: res.teamId, season: res.season }).then(function (stats) {
      done();
      if (my !== state.statsLoading) return;
      state.stats[key] = stats;
      renderTeamStats(stats);
    }).catch(function (err) {
      done();
      if (my !== state.statsLoading) return;
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

  $('team').addEventListener('change', function () { reload(keyToData(this.value)); });
  $('season').addEventListener('change', function () {
    reload(Object.assign(keyToData($('team').value), { season: this.value }));
  });

  NinelogUI.boot('ranking', 'ランキング', start);
})();
