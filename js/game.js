/**
 * 「試合の詳細」の画面の動き（2026-11-15 利用者が追加。C-15。CLAUDE.md 11.12章）
 *
 * game.html?game=試合のID で開き、GASの getGameDetail で、その試合の打撃・投手の成績を読む。
 * 並べ替え（打率・安打・打点）と順位の印（🥇🥈🥉）は、この画面の中で行う（GASに聞き直さない）。
 *
 * 並べ方（利用者が了承）：
 * - 打率：打率がある人を高い順。同じ打率は同じ順位（1位・1位・3位）。打数0の人は「-」で印なし、一番下
 *   （その中では打席の多い順、同じなら表示名の順）。
 * - 安打・打点：全員を多い順（同じ値は同じ順位）。1〜3位に印。ただし0の人には付けない。
 * - 同じ順位の中は、表示名の順。投手は投球回の多い順（並べ替えは無い）。
 *
 * 使うGASの操作：getGameDetail
 */
(function () {
  const $ = function (id) { return document.getElementById(id); };
  const el = NinelogUI.el;
  const MEDALS = ['🥇', '🥈', '🥉'];
  const RESULT_LABELS = { win: '勝ち', lose: '負け', draw: '引き分け' };
  const CATEGORY_LABELS = { official: '公式戦', practice: '練習試合', other: 'その他' };
  const SORT_LABELS = { avg: '打率', hits: '安打', rbis: '打点' };
  const state = { detail: null, sort: 'avg' };

  /** 「2026-11-08」→「2026年11月8日（日）」 */
  function dateLabel(text) {
    const p = String(text).split('-').map(Number);
    const week = '日月火水木金土'.charAt(new Date(p[0], p[1] - 1, p[2]).getDay());
    return p[0] + '年' + p[1] + '月' + p[2] + '日（' + week + '）';
  }

  function byName(a, b) { return String(a.displayName).localeCompare(String(b.displayName), 'ja'); }

  /**
   * 並べ替えて、順位（rank：無ければ null）と印を付けた行の一覧を返す。
   * 同じ値は同じ順位、次は飛ばす（1位・1位・3位）。
   */
  function sortedRows(rows, sort) {
    const valueOf = function (r) { return sort === 'avg' ? r.avg.value : r[sort]; };
    const ranked = rows.filter(function (r) { return valueOf(r) !== null && valueOf(r) !== undefined; });
    const rest = rows.filter(function (r) { return valueOf(r) === null || valueOf(r) === undefined; });
    ranked.sort(function (a, b) { return (valueOf(b) - valueOf(a)) || byName(a, b); });
    rest.sort(function (a, b) { return (b.plate_appearances - a.plate_appearances) || byName(a, b); });
    let prev = null;
    let rank = 0;
    const out = ranked.map(function (r, i) {
      if (prev === null || valueOf(r) !== prev) { rank = i + 1; prev = valueOf(r); }
      // 印は1〜3位。安打・打点では0の人には付けない
      const medal = rank <= 3 && (sort === 'avg' || valueOf(r) > 0) ? MEDALS[rank - 1] : '';
      return { row: r, rank: rank, medal: medal };
    });
    return out.concat(rest.map(function (r) { return { row: r, rank: null, medal: '' }; }));
  }

  function nameCell(r, medal) {
    const td = el('td', 'nl-game__name');
    if (medal) td.appendChild(el('span', 'nl-game__medal', medal));
    td.appendChild(el('span', r.left ? 'nl-game__left' : '', r.displayName));
    if (r.is_me) td.appendChild(el('span', 'nl-badge nl-badge--me', 'あなた'));
    return td;
  }

  function renderBatting() {
    const d = state.detail;
    $('bat-sort').querySelectorAll('button').forEach(function (b) {
      b.setAttribute('aria-pressed', b.getAttribute('data-sort') === state.sort ? 'true' : 'false');
    });
    const body = $('bat-rows');
    body.innerHTML = '';
    if (!d.batting.length) {
      $('bat-card').hidden = true;
      return;
    }
    $('bat-card').hidden = false;
    sortedRows(d.batting, state.sort).forEach(function (x) {
      const r = x.row;
      const tr = el('tr', r.is_me ? 'is-me' : '');
      tr.appendChild(nameCell(r, x.medal));
      [r.plate_appearances, r.at_bats, r.hits, r.home_runs, r.rbis, r.stolen_bases, r.avg.text].forEach(function (v, i) {
        const td = el('td', '', String(v));
        if ((state.sort === 'hits' && i === 2) || (state.sort === 'rbis' && i === 4) || (state.sort === 'avg' && i === 6)) td.className = 'is-sorted';
        tr.appendChild(td);
      });
      body.appendChild(tr);
    });
    const hasNoAvg = d.batting.some(function (r) { return r.avg.value === null; });
    $('bat-note').textContent = (state.sort === 'avg' ? '打率の高い順' : SORT_LABELS[state.sort] + 'の多い順') + '。同じ値は同じ順位で、1〜3位に🥇🥈🥉を付けます' + (state.sort === 'avg' ? '。' : '（0の人には付けません）。') +
      (state.sort === 'avg' && hasNoAvg ? '打数が0の人は打率が出ないので、一番下に並べます。' : '');
  }

  function renderPitching() {
    const d = state.detail;
    const body = $('pit-rows');
    body.innerHTML = '';
    if (!d.pitching.length) {
      $('pit-card').hidden = true;
      return;
    }
    $('pit-card').hidden = false;
    d.pitching.slice().sort(function (a, b) { return (b.outs - a.outs) || byName(a, b); }).forEach(function (r) {
      const tr = el('tr', r.is_me ? 'is-me' : '');
      tr.appendChild(nameCell(r, ''));
      tr.appendChild(el('td', '', r.innings_text));
      tr.appendChild(el('td', '', String(r.earned_runs)));
      body.appendChild(tr);
    });
  }

  function renderGame() {
    const g = state.detail.game;
    $('game-date').textContent = dateLabel(g.game_date) + '　第' + g.game_number + '試合';
    $('game-title').textContent = g.opponent ? 'vs ' + g.opponent : '（相手は未入力）';
    const badges = $('game-badges');
    badges.innerHTML = '';
    const add = function (text, cls) { if (text) badges.appendChild(el('span', 'nl-badge' + (cls ? ' ' + cls : ''), text)); };
    add(g.team_name);
    add(g.tournament_name);
    add(CATEGORY_LABELS[g.category]);
    add(RESULT_LABELS[g.result], g.result === 'win' ? 'nl-badge--win' : '');
  }

  function start() {
    const gameId = new URLSearchParams(location.search).get('game') || '';
    // もどる：前の画面から来たときは、その画面に戻る（直接開いたときは「自分の成績」へ）
    if (document.referrer && document.referrer.indexOf(location.origin) === 0 && history.length > 1) {
      $('btn-back').addEventListener('click', function (e) { e.preventDefault(); history.back(); });
    }
    if (!gameId) {
      $('loading').hidden = true;
      NinelogUI.showError({ message: '試合が選ばれていません。「自分の成績」や「成績を入力」から開いてください' });
      return null;
    }
    return NinelogApp.call('getGameDetail', { game_id: gameId }).then(function (res) {
      $('loading').hidden = true;
      $('content').hidden = false;
      show(res);
    }).catch(function (err) {
      $('loading').hidden = true;
      NinelogUI.showError(err);
    });
  }

  function show(res) {
    state.detail = res;
    renderGame();
    renderMyInput();
    renderBatting();
    renderPitching();
    renderNav();
  }

  /**
   * 自分の成績の入力（2026-11-15）。打撃か投手のどちらかを入れていれば「入れている」。
   * - まだ入れていない・30日以内：黄色の枠で「あなたの成績はまだ入っていません」と「この試合の成績を入力する」
   * - 入れている・30日以内：小さめの「この試合の成績を直す」
   * - 30日を過ぎた試合：出さない
   * 押すと「成績を入力」が、そのチーム・その日・その試合を選んだ状態で開く（投手だけ入れているときは投手の欄）。
   */
  function renderMyInput() {
    const d = state.detail;
    const box = $('my-input');
    box.innerHTML = '';
    const me = d.me || {};
    if (!me.can_input) return;
    const params = new URLSearchParams({ team: d.game.team_id, date: d.game.game_date, game: d.game.game_id });
    if (!me.has_batting && me.has_pitching) params.set('tab', 'pitching');
    const href = 'input.html?' + params.toString();
    if (me.has_record) {
      const row = el('div', 'nl-row__actions nl-myinput');
      const a = el('a', 'nl-chip', 'この試合の成績を直す');
      a.href = href;
      row.appendChild(a);
      box.appendChild(row);
      return;
    }
    const warn = el('div', 'nl-alert nl-alert--warn nl-myinput');
    warn.setAttribute('role', 'note');
    warn.appendChild(el('p', 'nl-myinput__text', 'あなたの成績はまだ入っていません'));
    const a = el('a', 'nl-btn nl-btn--block', 'この試合の成績を入力する');
    a.href = href;
    warn.appendChild(a);
    box.appendChild(warn);
  }

  /* ---------- 前の試合・次の試合（2026-11-15） ----------
   * 同じチーム（個人用の記録なら個人用の記録）の試合を、日付の順（同じ日は第何試合の順）に並べたときの前後（GASが決める）。
   * 押すと、この画面のまま中身を入れ替え、アドレスも入れ替える（履歴は増やさない）。
   * そのため、何試合移っても「もどる」1回で、試合の詳細を開く前の画面に戻る。
   */
  function shortDate(text) {
    const p = String(text).split('-').map(Number);
    return p[1] + '/' + p[2];
  }

  function navLabel(n, dir) {
    if (!n) return dir === 'prev' ? '‹ 前の試合はありません' : '次の試合はありません ›';
    const what = shortDate(n.game_date) + (n.opponent ? ' vs ' + n.opponent : '（相手は未入力）');
    return dir === 'prev' ? '‹ 前の試合 ' + what : '次の試合 ' + what + ' ›';
  }

  function renderNav() {
    const d = state.detail;
    ['nav-top', 'nav-bottom'].forEach(function (id) {
      const box = $(id);
      box.innerHTML = '';
      [['prev', d.prev], ['next', d.next]].forEach(function (p) {
        const b = el('button', 'nl-gamenav__btn nl-gamenav__btn--' + p[0], navLabel(p[1], p[0]));
        b.type = 'button';
        b.disabled = !p[1];
        if (p[1]) b.addEventListener('click', function () { moveTo(p[1].game_id, b); });
        box.appendChild(b);
      });
    });
  }

  function moveTo(gameId, button) {
    NinelogUI.clearAlerts($('nav-top'));
    NinelogUI.withBusy(button, function () {
      return NinelogApp.call('getGameDetail', { game_id: gameId }).then(function (res) {
        try { history.replaceState(history.state, '', location.pathname + '?game=' + encodeURIComponent(gameId)); } catch (e) { /* そのまま */ }
        show(res);
        window.scrollTo(0, 0);
      }).catch(function (err) { NinelogUI.showError(err, $('nav-top')); });
    });
  }

  $('bat-sort').querySelectorAll('button').forEach(function (b) {
    b.addEventListener('click', function () {
      state.sort = b.getAttribute('data-sort');
      renderBatting();
    });
  });

  NinelogUI.boot('game', '試合の詳細', start);
})();
