/**
 * B-17（カレンダー用の情報）のテスト
 *
 * 使い方：GASの編集画面で testCalendar を選んで「実行」。
 * 仮の人（Utest…）と自動テスト専用の番号（999999900〜）のチーム・大会だけを使い、最後に消す。
 */
function testCalendar() {
  const realBefore = countRealRows_();
  cleanupTestData_();
  const results = [];
  try {
    testCalendarScenario_(results);
  } finally {
    cleanupTestData_();
  }
  results.push({ title: '本物の行（チーム・打撃・投手・変更の記録）の数が、テストの前後で変わらない', expected: realBefore, actual: countRealRows_() });
  logResults_(results);
}

function testCalendarScenario_(results) {
  const a = { userId: 'Utest_caa', name: 'あおき' };
  const b = { userId: 'Utest_cab', name: 'いとう' };
  const c = { userId: 'Utest_cac', name: 'うえだ' };
  createTestTeam_(a, '999999995', 'カレンダーX', 'ないんろぐ99');
  createTestTeam_(a, '999999996', 'カレンダーY', 'ないんろぐ99');
  createTestTeam_(a, '999999997', 'カレンダー大会', 'たいかい99', 'tournament');
  createTestTeam_(c, '999999998', 'カレンダーZ', 'ないんろぐ99'); // あおきは入っていない
  const teamX = findTeamByNumber_('999999995');
  const teamY = findTeamByNumber_('999999996');
  const tour = findTeamByNumber_('999999997');
  const teamZ = findTeamByNumber_('999999998');
  joinTestTeam_(b, '999999995', 'ないんろぐ99');

  const T = '2026-11-10';
  const x1 = createTestGame_(a, teamX.team_id, '2026-11-02', T, { opponent: '北クラブ', tournament_id: tour.team_id, result: 'win' });
  const x2 = createTestGame_(a, teamX.team_id, '2026-11-02', T); // 同じ日の第2試合
  const x3 = createTestGame_(a, teamX.team_id, '2026-11-09', T);
  createTestGame_(a, teamY.team_id, '2026-11-05', T);
  createTestGame_(a, teamX.team_id, '2026-10-15', '2026-10-20'); // 前の月
  const xd = createTestGame_(a, teamX.team_id, '2026-11-07', T);  // 消す
  callAsTest_(handleDeleteGame_, { game_id: xd.game_id }, a, { today: T });
  createTestGame_(c, teamZ.team_id, '2026-11-03', T);             // 所属していないチーム

  const keys = battingCountFields_();
  const bat = function (user, game) {
    const data = { game_id: game.game_id };
    keys.forEach(function (k) { data[k] = 0; });
    data.plate_appearances = 1; data.at_bats = 1;
    return callAsTest_(handleAddBattingRecord_, data, user, { today: T });
  };
  const aBat = bat(a, x1);   // あおき：x1 の打撃
  const bBat = bat(b, x2);   // いとう：x2 の打撃（あおきのカレンダーには出ない）
  const aPit = callAsTest_(handleAddPitchingRecord_, { game_id: x3.game_id, innings: 1, partial_outs: 0, earned_runs: 0 }, a, { today: T }); // あおき：x3 の投手

  const cal = function (user, data, today) {
    return callAsTest_(handleGetCalendar_, data, user, { today: today || T }, false);
  };
  const dates = function (r) { return r.days.map(function (d) { return d.date + (d.has_my_record ? '●' : '○'); }).join(','); };

  // ---- あおき・2026年11月・全チーム ----
  //   11/02（X：x1・x2。x1 に自分の打撃）●、11/05（Y）○、11/09（X：x3 に自分の投手）●
  //   消した試合（11/07）と、所属していないチーム Z（11/03）は出ない
  const nov = cal(a, { month: '2026-11' });
  results.push({ title: '●（自分の記録）と○（チームの試合）の日', expected: '2026-11-02●,2026-11-05○,2026-11-09●', actual: dates(nov) });
  const d2 = nov.days[0];
  results.push({ title: '同じ日の2試合を、番号の順に返す', expected: 'カレンダーX:1,カレンダーX:2', actual: d2.games.map(function (g) { return g.team_name + ':' + g.game_number; }).join(',') });
  results.push({ title: '本人の記録のIDは、自分の記録がある試合だけ', expected: aBat.record.record_id + '/', actual: d2.games[0].my_batting_record_id + '/' + d2.games[1].my_batting_record_id });
  results.push({ title: '投手の記録のIDも返す（11/09）', expected: aPit.record.record_id, actual: nov.days[2].games[0].my_pitching_record_id });
  results.push({ title: '試合の情報（相手・勝敗・大会名）', expected: '北クラブ/win/カレンダー大会', actual: [d2.games[0].opponent, d2.games[0].result, d2.games[0].tournament_name].join('/') });
  results.push({ title: '他人の記録や他人のLINEユーザーIDは返さない', expected: false, actual: JSON.stringify(nov).indexOf(bBat.record.record_id) !== -1 || JSON.stringify(nov).indexOf('Utest_ca') !== -1 });

  // ---- 月とチームの指定 ----
  results.push({ title: '月を省略すると今月', expected: '2026-11', actual: cal(a, {}).month });
  results.push({ title: '前の月（2026-10）', expected: '2026-10-15○', actual: dates(cal(a, { month: '2026-10' })) });
  results.push({ title: 'チームを指定すると、そのチームの試合だけ（Y）', expected: '2026-11-05○', actual: dates(cal(a, { month: '2026-11', team_id: teamY.team_id })) });
  results.push({ title: 'チームの選択欄（大会は入らない）', expected: '999999995,999999996', actual: nov.teams.map(function (t) { return t.teamNumber; }).join(',') });

  // ---- 入力できるか（試合日から30日以内） ----
  //   今日を 2026-12-05 にすると、11/02 は33日目（入力できない）、11/09 は26日目（入力できる）
  const later = cal(a, { month: '2026-11' }, '2026-12-05');
  results.push({ title: '試合日から30日を過ぎた日は can_input が false、以内は true', expected: '2026-11-02:false,2026-11-05:true,2026-11-09:true', actual: later.days.map(function (d) { return d.date + ':' + d.can_input; }).join(',') });

  // ---- いとうから見ると ----（Y には入っていない。11/02 は x2 に自分の記録、11/09 は記録なし）
  results.push({ title: 'いとうのカレンダー', expected: '2026-11-02●,2026-11-09○', actual: dates(cal(b, { month: '2026-11' })) });

  // ---- 断る場合 ----
  results.push({ title: '所属していないチームは見られない', expected: 'FORBIDDEN', actual: cal(a, { team_id: teamZ.team_id }).code });
  results.push({ title: '大会のIDはチームとして使えない', expected: 'FORBIDDEN', actual: cal(a, { team_id: tour.team_id }).code });
  results.push({ title: '月の形がまちがっていれば断る（13月）', expected: 'BAD_REQUEST', actual: cal(a, { month: '2026-13' }).code });
  results.push({ title: '月の形がまちがっていれば断る（ハイフンなし）', expected: 'BAD_REQUEST', actual: cal(a, { month: '202611' }).code });

  // 画面からの入口でも動く
  const viaScreen = dispatch_({ action: 'getCalendar', data: { month: '2026-11' } }, { userId: a.userId, name: a.name });
  results.push({ title: '画面からの入口でも同じ日が返る', expected: 3, actual: viaScreen.days.length });
}
