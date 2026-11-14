/**
 * カレンダー用の情報（CLAUDE.md 11.3章・11.0章の16・11.7章のJ。B-17）
 *
 * 「自分の成績」画面の月ごとのカレンダーに使う。
 * - ●：自分の記録（打撃・投手のどちらか）がある日
 * - ○：所属チームの試合がある日（大会の試合も、チームの試合として出る：J）
 * - 返すのは試合の情報（日付・第何試合・相手・区分・勝敗・大会名など）と、本人の記録のIDだけ。
 *   誰がどんな成績を記録したか（他人の記録）は返さない（11.3章）。
 * - 日付をタップしたときに「入力する」ボタンを出せるかは can_input（試合日から30日以内か）で決める（11.0章の16）。
 */

/**
 * 操作：getCalendar
 * data: { month: 'yyyy-MM'（省略すると今月）, team_id: チームID（省略すると所属している全チーム） }
 * 返事：{ month, teams, days: [{ date, has_my_record, has_team_game, can_input, games: [...] }] }
 *   days には、●か○が付く日だけを、日付の古い順に入れる。
 */
function handleGetCalendar_(data, user, options) {
  const today = todayText_(options);
  let month = data.month;
  if (month === undefined || month === null || month === '') month = today.slice(0, 7);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(month))) {
    throw new AppError(APP_ERROR.BAD_REQUEST, '月は「2026-11」のような形で指定してください');
  }
  month = String(month);

  // チームと、個人用の記録（11.8章の6）
  const myTeams = handleListMyTeams_({}, user).teams.filter(function (t) { return isRecordableOrgType_(t.orgType); });
  let teams = myTeams;
  if (data.team_id !== undefined && data.team_id !== null && data.team_id !== '') {
    teams = myTeams.filter(function (t) { return t.teamId === data.team_id; });
    if (teams.length === 0) {
      throw new AppError(APP_ERROR.FORBIDDEN, '所属していないチームのカレンダーは見られません');
    }
  }
  const teamNames = {};
  teams.forEach(function (t) { teamNames[t.teamId] = t.teamName; });

  // その月の、対象のチームの、消していない試合
  const games = readRecords_(CONFIG.SHEET.GAMES).filter(function (g) {
    return !g.deleted_at && teamNames.hasOwnProperty(g.team_id) && dateText_(g.game_date).slice(0, 7) === month;
  });
  const gameIds = {};
  games.forEach(function (g) { gameIds[g.game_id] = true; });

  // 本人の、消していない記録（その試合のものだけ）
  const myRecordOf = function (sheet) {
    const map = {};
    readRecords_(sheet).forEach(function (r) {
      if (r.user_id === user.userId && !r.deleted_at && gameIds[r.game_id]) map[r.game_id] = r.record_id;
    });
    return map;
  };
  const myBatting = myRecordOf(CONFIG.SHEET.BATTING);
  const myPitching = myRecordOf(CONFIG.SHEET.PITCHING);

  const byDate = {};
  games.forEach(function (g) {
    const date = dateText_(g.game_date);
    if (!byDate[date]) byDate[date] = [];
    const summary = toGameSummary_(g, user, today);
    summary.team_name = teamNames[g.team_id];
    summary.my_batting_record_id = myBatting[g.game_id] || '';
    summary.my_pitching_record_id = myPitching[g.game_id] || '';
    summary.can_input = isWithinEditPeriod_(date, today);
    byDate[date].push(summary);
  });

  const days = Object.keys(byDate).sort().map(function (date) {
    const list = byDate[date].sort(function (a, b) {
      return a.team_name.localeCompare(b.team_name, 'ja') || (a.game_number - b.game_number);
    });
    return {
      date: date,
      has_my_record: list.some(function (s) { return s.my_batting_record_id || s.my_pitching_record_id; }),
      has_team_game: true,
      can_input: isWithinEditPeriod_(date, today),
      games: list,
    };
  });

  return {
    month: month,
    teamId: teams.length === 1 && data.team_id ? teams[0].teamId : null,
    teams: myTeams.map(function (t) { return { teamId: t.teamId, teamNumber: t.teamNumber, teamName: t.teamName, orgType: t.orgType }; }),
    days: days,
  };
}
