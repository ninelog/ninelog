/**
 * B-20（チーム・大会からの退会）のテスト
 *
 * 使い方：GASの編集画面で testLeave を選んで「実行」。
 * 仮の人（Utest…）と自動テスト専用の番号（999999900〜）のチーム・大会だけを使い、最初と最後に消す。
 */
function testLeave() {
  const realBefore = countRealRows_();
  cleanupTestData_();
  const results = [];
  try {
    testLeaveScenario_(results);
  } finally {
    cleanupTestData_();
  }
  results.push({ title: '本物の行（チーム・打撃・投手・変更の記録）の数が、テストの前後で変わらない', expected: realBefore, actual: countRealRows_() });
  logResults_(results);
}

function testLeaveScenario_(results) {
  const o = { userId: 'Utest_lvo', name: 'おかだ' }; // 代表者
  const m = { userId: 'Utest_lvm', name: 'まつい' }; // 退会するメンバー
  const T = '2026-11-10';
  const act = function (name, data, user) {
    const action = getActions_()[name];
    return callAsTest_(action.handler, data, user, { today: T }, action.write ? undefined : false);
  };
  const codeOf = function (res) { return res && res.code ? res.code : 'OK'; };

  createTestTeam_(o, '999999937', '退会テストナイン', 'ないんろぐ99');
  createTestTeam_(o, '999999938', '退会テスト大会', 'たいかい99', 'tournament');
  createTestTeam_(o, '999999939', '別のチーム', 'ないんろぐ99');
  const team = findTeamByNumber_('999999937');
  const tour = findTeamByNumber_('999999938');
  const other = findTeamByNumber_('999999939');
  joinTestTeam_(m, '999999937', 'ないんろぐ99');
  joinTestTeam_(m, '999999938', 'たいかい99');

  // 大会の試合（作ったのは代表者）と、メンバーが作った試合
  const g1 = createTestGame_(o, team.team_id, '2026-11-01', T, { tournament_id: tour.team_id });
  const gm = createTestGame_(m, team.team_id, '2026-11-02', T);
  const keys = battingCountFields_();
  const bat = function (user, game, nums) {
    const data = { game_id: game.game_id };
    keys.forEach(function (k, i) { data[k] = nums[i]; });
    return act('addBattingRecord', data, user);
  };
  //                   打席 打数 安打 二塁 三塁 本塁 打点 四球 死球 犠打 犠飛 三振 盗塁
  bat(o, g1,          [4, 4, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  bat(m, g1,          [4, 4, 3, 0, 0, 1, 2, 0, 0, 0, 0, 0, 0]);
  const names = function (r) { return r.categories.hits.rows.map(function (x) { return x.displayName; }).join(','); };
  results.push({ title: '退会の前：ランキングに2人', expected: 'まつい,おかだ', actual: names(act('getTeamRanking', { team_id: team.team_id }, o)) });

  // ---------- 退会 ----------
  const left = act('leaveTeam', { team_id: team.team_id }, m);
  results.push({ title: 'メンバーは退会できる', expected: 'true/退会テストナイン', actual: left.left + '/' + (left.team && left.team.teamName) });
  results.push({ title: '自分の一覧から消える（大会はそのまま）', expected: '退会テスト大会', actual: act('listMyTeams', {}, m).teams.map(function (t) { return t.teamName; }).join(',') });
  results.push({ title: 'ランキングには、今所属している人だけが載る', expected: 'おかだ', actual: names(act('getTeamRanking', { team_id: team.team_id }, o)) });
  //   チーム全体の成績には、退会した人の成績も残る（打数 4+4＝8、安打 1+3＝4）
  const ts = act('getTeamStats', { team_id: team.team_id }, o);
  results.push({ title: 'チーム全体の成績には、退会した人の成績も入る（打数8・安打4）', expected: '8/4', actual: ts.batting.at_bats + '/' + ts.batting.hits });
  const mine = act('getMyStats', { season: 'all' }, m);
  results.push({ title: '退会しても、本人の成績は消えない（自分の成績の全チーム合計に残る）', expected: '4/3', actual: mine.batting.at_bats + '/' + mine.batting.hits });
  results.push({ title: '退会したチームのランキングは見られない', expected: 'FORBIDDEN', actual: codeOf(act('getTeamRanking', { team_id: team.team_id }, m)) });
  results.push({ title: '退会したチームに、試合を作れない', expected: 'FORBIDDEN', actual: codeOf(act('createGame', { team_id: team.team_id, game_date: '2026-11-03' }, m)) });
  results.push({ title: '自分が作った試合でも、退会したあとは直せない', expected: 'FORBIDDEN', actual: codeOf(act('updateGame', { game_id: gm.game_id, game_date: '2026-11-02', game_number: 1, result: 'win' }, m)) });
  results.push({ title: 'もう一度退会しようとしても断る（所属していない）', expected: 'FORBIDDEN', actual: codeOf(act('leaveTeam', { team_id: team.team_id }, m)) });

  // ---------- もう一度参加 ----------
  const rejoin = joinTestTeam_(m, '999999937', 'ないんろぐ99');
  results.push({ title: '同じ番号と合言葉で、もう一度参加できる', expected: 'false/member', actual: rejoin.alreadyMember + '/' + (rejoin.team && rejoin.team.role) });
  results.push({ title: 'もう一度参加すると、ランキングに戻る（前の成績も入る）', expected: 'まつい,おかだ', actual: names(act('getTeamRanking', { team_id: team.team_id }, o)) });

  // ---------- 大会からの退会 ----------
  const tourNames = function () { return act('getTournamentRanking', { tournament_id: tour.team_id }, o).categories.hits.rows.map(function (x) { return x.displayName; }).join(','); };
  results.push({ title: '大会の退会の前：大会のランキングに載っている', expected: true, actual: tourNames().indexOf('まつい') !== -1 });
  results.push({ title: '大会からも退会できる', expected: 'OK', actual: codeOf(act('leaveTeam', { team_id: tour.team_id }, m)) });
  results.push({ title: '大会から退会すると、大会のランキングに載らない', expected: false, actual: tourNames().indexOf('まつい') !== -1 });
  results.push({ title: '大会から退会しても、チームのランキングには載る', expected: 'まつい,おかだ', actual: names(act('getTeamRanking', { team_id: team.team_id }, o)) });

  // ---------- 断る場合 ----------
  results.push({ title: '代表者は退会できない', expected: 'FORBIDDEN', actual: codeOf(act('leaveTeam', { team_id: team.team_id }, o)) });
  results.push({ title: '大会の代表者も退会できない', expected: 'FORBIDDEN', actual: codeOf(act('leaveTeam', { team_id: tour.team_id }, o)) });
  const solo = act('startSolo', {}, m).team;
  results.push({ title: '個人用の記録は退会できない', expected: 'FORBIDDEN', actual: codeOf(act('leaveTeam', { team_id: solo.teamId }, m)) });
  results.push({ title: '所属していないチームからは退会できない', expected: 'FORBIDDEN', actual: codeOf(act('leaveTeam', { team_id: other.team_id }, m)) });
  results.push({ title: '存在しないIDは断る', expected: 'FORBIDDEN', actual: codeOf(act('leaveTeam', { team_id: 'no-such-team' }, m)) });
  results.push({ title: 'チームのIDを送らなければ断る', expected: 'FORBIDDEN', actual: codeOf(act('leaveTeam', {}, m)) });

  // 画面からの入口でも動く（もう一度退会）
  const viaScreen = dispatch_({ action: 'leaveTeam', data: { team_id: team.team_id } }, { userId: m.userId, name: m.name });
  results.push({ title: '画面からの入口でも退会できる', expected: true, actual: viaScreen.left });
}
