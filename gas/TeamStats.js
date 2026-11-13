/**
 * チーム全体の成績（CLAUDE.md 11.4章・11.0章の12・11.7章のI。B-14）
 *
 * - チームだけ（大会の全体の成績・順位表は初版では作らない：11.7章のI）。メンバー全員が見られる。
 * - 試合数と勝敗は、そのチームの消していない試合（games）から数える。
 * - 打撃・投手は、それらの試合に付いた、消していない記録をチーム全員分合計してから計算する（6章の式）。
 */

/**
 * 勝率 ＝ 勝ち ÷ (勝ち ＋ 負け)。引き分けと勝敗が未入力の試合は入れない。
 * 勝ちと負けが0なら null（表示は「-」）。表示は打率と同じ形（.500）
 */
function winningPct_(win, lose) {
  return ratio_(win, win + lose);
}

/**
 * 操作：getTeamStats（チーム全体の成績）
 * data: { team_id: チームID（必須。所属しているチームだけ）, season: 'all' または '2026' など（省略の決まりはランキングと同じ） }
 * 返事：チーム名、年度、選択欄、試合数と勝敗・勝率、打撃の合計と率、投手の合計と防御率
 */
function handleGetTeamStats_(data, user, options) {
  const scope = teamSeasonScope_(data, user, options, '成績');
  const games = Object.keys(scope.gamesInSeason).map(function (id) { return scope.gamesInSeason[id]; });

  const record = { win: 0, lose: 0, draw: 0, unknown: 0 };
  games.forEach(function (g) {
    const r = String(g.result || '');
    if (r === 'win' || r === 'lose' || r === 'draw') record[r] += 1;
    else record.unknown += 1;
  });
  const pct = winningPct_(record.win, record.lose);

  const pick = function (sheet) {
    return readRecords_(sheet).filter(function (r) { return !r.deleted_at && scope.gamesInSeason[r.game_id]; });
  };
  const battingRecords = pick(CONFIG.SHEET.BATTING);
  const pitchingRecords = pick(CONFIG.SHEET.PITCHING);

  // battingSummary_ の games は「記録の件数」なので、チーム全体では「のべ出場数」appearances と呼ぶ
  const batting = battingSummary_(battingRecords);
  batting.appearances = batting.games;
  delete batting.games;
  const pitching = pitchingSummary_(pitchingRecords);
  pitching.appearances = pitching.games;
  delete pitching.games;

  return {
    teamId: scope.team.teamId,
    teamName: scope.team.teamName,
    season: scope.season,
    seasons: scope.seasons,
    teams: scope.myTeams.map(function (t) { return { teamId: t.teamId, teamNumber: t.teamNumber, teamName: t.teamName }; }),
    games: games.length,
    record: record,
    winning_pct: { value: pct, text: formatRate_(pct) },
    batting: batting,
    pitching: pitching,
  };
}
