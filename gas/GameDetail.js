/**
 * 試合の詳細（2026-11-15 利用者が追加。B-26。CLAUDE.md 11.12章）
 *
 * 操作：getGameDetail（見るだけ）
 * data: { game_id }
 * その試合で、チームの誰が何打数何安打だったか（ランキングの「1試合ぶん」）と、投げた人の投球回・自責点を返す。
 *
 * 見られる人（権限の決まり）：
 * - チームの試合：今そのチームのメンバーだけ（ランキングと同じ。大会だけに参加している人・退会した人は見られない）
 * - 個人用の記録の試合：本人だけ（個人用の記録は本人しかメンバーにならない）
 * - 消した試合・存在しない試合：断る（どちらも同じ返事）
 * - 管理者も特別扱いしない
 *
 * 返すもの：
 * - 他人のLINEユーザーIDは返さない。本人の行に is_me を付ける。
 * - 退会した人（今はチームのメンバーではない人）の行も出す（試合の事実なので。チーム全体の成績と同じ考え方）。
 *   ただし、表示名の代わりに「退会したメンバー」と出す（2人以上いても、それぞれ1行で同じ表記）。
 * - 並べ替え・順位の印は画面で行う（GASは返す順を決めない）。打率は value と text の組で返す。
 */
const LEFT_MEMBER_LABEL = '退会したメンバー';

function handleGetGameDetail_(data, user, options) {
  const gameId = data && typeof data.game_id === 'string' ? data.game_id : '';
  const game = findActiveGame_(gameId);
  // 試合が無い・消した・今のメンバーではない：どれも同じ返事にする（ほかのチームの試合を探られないように）
  if (!game || !isMemberOfTeamType_(user.userId, game.team_id)) {
    throw new AppError(APP_ERROR.FORBIDDEN, 'この試合の詳細は、チームのメンバーだけが見られます');
  }

  const team = findRecord_(CONFIG.SHEET.TEAMS, function (t) { return t.team_id === game.team_id; });
  const tournamentId = String(game.tournament_id || '');
  const tournament = tournamentId
    ? findRecord_(CONFIG.SHEET.TEAMS, function (t) { return t.team_id === tournamentId; })
    : null;
  const memberIds = {};
  readRecords_(CONFIG.SHEET.MEMBERSHIPS).forEach(function (m) {
    if (m.team_id === game.team_id) memberIds[m.user_id] = true;
  });
  const names = displayNamesById_();
  const nameOf = function (userId) {
    if (!memberIds[userId]) return LEFT_MEMBER_LABEL;
    return names[userId] || CONFIG.DEFAULT_DISPLAY_NAME;
  };
  const inGame = function (r) { return r.game_id === game.game_id && !r.deleted_at; };

  const batting = readRecords_(CONFIG.SHEET.BATTING).filter(inGame).map(function (r) {
    const t = sumBatting_([r]);
    const avg = battingRates_(t).avg;
    return {
      displayName: nameOf(r.user_id),
      is_me: r.user_id === user.userId,
      left: !memberIds[r.user_id],
      plate_appearances: t.plate_appearances,
      at_bats: t.at_bats,
      hits: t.hits,
      home_runs: t.home_runs,
      rbis: t.rbis,
      stolen_bases: t.stolen_bases,
      avg: { value: avg, text: formatRate_(avg) },
    };
  });
  const pitching = readRecords_(CONFIG.SHEET.PITCHING).filter(inGame).map(function (r) {
    const outs = Number(r.outs) || 0;
    return {
      displayName: nameOf(r.user_id),
      is_me: r.user_id === user.userId,
      left: !memberIds[r.user_id],
      outs: outs,
      innings_text: formatInnings_(outs),
      earned_runs: Number(r.earned_runs) || 0,
    };
  });

  // 前の試合・次の試合（2026-11-15）：同じチーム（個人用の記録なら個人用の記録）の消していない試合を、
  // 日付の順（同じ日なら第何試合の順）に並べたときの前後。自分が出ていない試合も入れる。見る権限は同じ（同じチームのため）
  const siblings = activeGamesOf_(game.team_id).slice().sort(function (p, q) {
    const pd = dateText_(p.game_date);
    const qd = dateText_(q.game_date);
    return pd < qd ? -1 : pd > qd ? 1 : (Number(p.game_number) - Number(q.game_number));
  });
  const index = siblings.map(function (x) { return x.game_id; }).indexOf(game.game_id);
  const neighbor = function (x) {
    if (!x) return null;
    return { game_id: x.game_id, game_date: dateText_(x.game_date), game_number: Number(x.game_number), opponent: String(x.opponent || '') };
  };

  // 本人の入力の状態（2026-11-15）：打撃か投手のどちらかを入れていれば「入れている」。
  // 入力・直すのボタンは、試合日から30日以内のときだけ出す（入力の決まりと同じ）
  const gameDate = dateText_(game.game_date);
  const me = {
    has_batting: batting.some(function (r) { return r.is_me; }),
    has_pitching: pitching.some(function (r) { return r.is_me; }),
    can_input: isWithinEditPeriod_(gameDate, todayText_(options)),
  };
  me.has_record = me.has_batting || me.has_pitching;

  return {
    me: me,
    prev: neighbor(siblings[index - 1]),
    next: neighbor(siblings[index + 1]),
    game: {
      game_id: game.game_id,
      team_id: game.team_id,
      team_name: team ? (orgTypeOf_(team) === ORG_TYPE.SOLO ? SOLO_NAME : String(team.team_name)) : '',
      org_type: team ? orgTypeOf_(team) : ORG_TYPE.TEAM,
      game_date: dateText_(game.game_date),
      game_number: Number(game.game_number),
      opponent: String(game.opponent || ''),
      tournament_name: tournament ? String(tournament.team_name) : '',
      category: String(game.category || ''),
      result: String(game.result || ''),
    },
    batting: batting,
    pitching: pitching,
  };
}
