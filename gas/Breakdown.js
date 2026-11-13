/**
 * 相手別・大会別・区分別の集計（CLAUDE.md 11.4章・11.0章の7と13・11.7章のD。B-15）
 *
 * 「自分の成績」（getMyStats）と「チーム全体の成績」（getTeamStats）の返事に、breakdowns として付ける。
 * - 相手別：対戦相手の名前を、全角・半角と前後の空白をそろえて比べる（11.0章の7）。
 * - 大会別：試合に付いた大会（組織）ごと。大会の付いていない試合は「（大会なし）」。
 * - 区分別：公式戦・練習試合・その他・未入力の順（11.7章のD）。
 * 計算はほかの成績と同じく、記録を合計してから率を出す。
 */

/** 試合区分の表示名と並び順 */
const CATEGORY_LABELS = { official: '公式戦', practice: '練習試合', other: 'その他', '': '（未入力）' };
const CATEGORY_ORDER = ['official', 'practice', 'other', ''];

/** 対戦相手の名前を比べるための形：全角・半角をそろえ（NFKC）、前後の空白を取る */
function normalizeOpponent_(name) {
  return String(name || '').normalize('NFKC').trim();
}

/**
 * 集計を作る。
 * @param {Array<Object>} games 集計の対象の試合（チーム全体なら、その年度のチームの全試合。自分なら、自分の記録がある試合）
 * @param {Array<Object>} battingRecords 対象の打撃の記録（どれも games のどれかの試合の記録）
 * @param {Array<Object>} pitchingRecords 対象の投手の記録
 * @param {boolean} withRecord true なら、グループごとに勝敗と勝率も付ける（チーム全体の成績のとき）
 * @return {{ by_opponent: Array, by_tournament: Array, by_category: Array }}
 */
function breakdowns_(games, battingRecords, pitchingRecords, withRecord) {
  const gameById = {};
  games.forEach(function (g) { gameById[g.game_id] = g; });

  const tournamentNames = {};
  readRecords_(CONFIG.SHEET.TEAMS).forEach(function (t) { tournamentNames[t.team_id] = String(t.team_name); });

  // 新しい試合から順に並べておく（グループの中の試合の順をそろえるため）
  const newestFirst = games.slice().sort(compareGames_);

  const dimensions = {
    by_opponent: {
      keyOf: function (g) { return normalizeOpponent_(g.opponent); },
      // 表示名は、そろえたあとの名前（どの範囲で見ても同じ名前で出るように）
      labelOf: function (key) { return key || '（未入力）'; },
      fixedOrder: null,
    },
    by_tournament: {
      keyOf: function (g) { return String(g.tournament_id || ''); },
      labelOf: function (key) { return key ? (tournamentNames[key] || '') : '（大会なし）'; },
      fixedOrder: null,
    },
    by_category: {
      keyOf: function (g) { return CATEGORY_LABELS.hasOwnProperty(String(g.category || '')) ? String(g.category || '') : 'other'; },
      labelOf: function (key) { return CATEGORY_LABELS[key]; },
      fixedOrder: CATEGORY_ORDER,
    },
  };

  const result = {};
  Object.keys(dimensions).forEach(function (name) {
    const dim = dimensions[name];
    const groups = {};
    const order = [];
    newestFirst.forEach(function (g) {
      const key = dim.keyOf(g);
      if (!groups[key]) {
        groups[key] = { key: key, label: dim.labelOf(key, g), games: [], batting: [], pitching: [] };
        order.push(key);
      }
      groups[key].games.push(g);
    });
    battingRecords.forEach(function (r) { groups[dim.keyOf(gameById[r.game_id])].batting.push(r); });
    pitchingRecords.forEach(function (r) { groups[dim.keyOf(gameById[r.game_id])].pitching.push(r); });

    let keys;
    if (dim.fixedOrder) {
      keys = dim.fixedOrder.filter(function (k) { return groups[k]; });
    } else {
      // 試合の多い順。同じなら表示名の順。未入力・大会なし（キーが空）は最後
      keys = order.slice().sort(function (a, b) {
        if ((a === '') !== (b === '')) return a === '' ? 1 : -1;
        return (groups[b].games.length - groups[a].games.length) || groups[a].label.localeCompare(groups[b].label, 'ja');
      });
    }
    result[name] = keys.map(function (k) { return breakdownRow_(groups[k], withRecord); });
  });
  return result;
}

function breakdownRow_(group, withRecord) {
  const batting = battingSummary_(group.batting);
  const pitching = pitchingSummary_(group.pitching);
  const row = {
    key: group.key,
    label: group.label,
    games: group.games.length,
    batting: {
      appearances: batting.games,
      plate_appearances: batting.plate_appearances,
      at_bats: batting.at_bats,
      hits: batting.hits,
      home_runs: batting.home_runs,
      rbis: batting.rbis,
      stolen_bases: batting.stolen_bases,
      avg: batting.avg,
      obp: batting.obp,
      slg: batting.slg,
      ops: batting.ops,
    },
    pitching: {
      appearances: pitching.games,
      outs: pitching.outs,
      innings_text: pitching.innings_text,
      earned_runs: pitching.earned_runs,
      era: pitching.era,
    },
  };
  if (withRecord) {
    const record = { win: 0, lose: 0, draw: 0, unknown: 0 };
    group.games.forEach(function (g) {
      const r = String(g.result || '');
      if (r === 'win' || r === 'lose' || r === 'draw') record[r] += 1;
      else record.unknown += 1;
    });
    const pct = winningPct_(record.win, record.lose);
    row.record = record;
    row.winning_pct = { value: pct, text: formatRate_(pct) };
  }
  return row;
}
