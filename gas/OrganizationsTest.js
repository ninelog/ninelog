/**
 * B-10a（組織の種類：チームと大会）のテスト
 *
 * 使い方：GASの編集画面で testOrganizations を選んで「実行」。結果は「実行ログ」に出る。
 * すべて「OK」なら合格。
 *
 * 仮の人（Utest…）と自動テスト専用の番号（999999900〜）だけを使い、最後に消す。
 */
function testOrganizations() {
  const realBefore = countRealRows_();
  cleanupTestData_();
  const results = [];
  try {
    runOrganizationTests_(results);
  } finally {
    cleanupTestData_();
  }
  results.push({ title: '本物の行（チーム・打撃・投手・変更の記録）の数が、テストの前後で変わらない', expected: realBefore, actual: countRealRows_() });
  logResults_(results);
}

function runOrganizationTests_(results) {
  const owner = { userId: 'Utest_oowner', name: '主催テスト' };
  const player = { userId: 'Utest_oplayer', name: '選手テスト' };

  // ---------- 作る ----------
  const team = createTestTeam_(owner, '999999951', 'テストナイン', 'ないんろぐ99').team;
  results.push({ title: '種類を省略するとチームになる', expected: 'team/owner', actual: team.orgType + '/' + team.role });
  const tournament = createTestTeam_(owner, '999999952', 'テスト市民大会', 'たいかい2026', 'tournament').team;
  results.push({ title: '大会を作れる（作った人が大会の代表者）', expected: 'tournament/owner', actual: tournament.orgType + '/' + tournament.role });
  results.push({ title: 'シートに種類が書かれる', expected: 'tournament', actual: findTeamByNumber_('999999952').org_type });

  // 番号はチームと大会で共有
  const sameNumber = errorSummary_(function () { createTestTeam_(owner, '999999951', '同じ番号の大会', 'abcdef', 'tournament'); });
  results.push({ title: 'チームと同じ番号の大会は作れない', expected: 'team_number：' + TEAM_NUMBER_USED_MESSAGE, actual: sameNumber });
  const sameNumber2 = errorSummary_(function () { createTestTeam_(owner, '999999952', '同じ番号のチーム', 'abcdef', 'team'); });
  results.push({ title: '大会と同じ番号のチームは作れない', expected: 'team_number：' + TEAM_NUMBER_USED_MESSAGE, actual: sameNumber2 });

  // 種類と名前の確かめ
  const badType = errorSummary_(function () { createTestTeam_(owner, '999999953', 'x', 'abcdef', 'league'); });
  results.push({ title: '種類は team か tournament だけ', expected: 'org_type', actual: badType.split('：')[0] });
  const noName = errorSummary_(function () { createTestTeam_(owner, '999999953', '', 'abcdef', 'tournament'); });
  results.push({ title: '大会名が空なら「大会名を入力してください」と表示する', expected: 'team_name：大会名を入力してください', actual: noName });
  const noTeamName = errorSummary_(function () { createTestTeam_(owner, '999999953', '', 'abcdef'); });
  results.push({ title: 'チーム名が空なら「チーム名を入力してください」と表示する', expected: 'team_name：チーム名を入力してください', actual: noTeamName });
  results.push({ title: '画面からは、大会でも自動テスト用のIDは作れない（「すでに使われています」とだけ出す）', expected: 'team_number：' + TEAM_NUMBER_USED_MESSAGE, actual: errorSummary_(function () {
    dispatch_({ action: 'createTeam', data: { org_type: 'tournament', team_number: '999999954', team_name: 'x', passphrase: 'abcdef' } }, { userId: 'Utest_oscreen', name: '画面' });
  }) });

  // ---------- 参加と一覧 ----------
  const joinedTeam = joinTestTeam_(player, '999999951', 'ないんろぐ99');
  const joinedTournament = joinTestTeam_(player, '999999952', 'タイカイ２０２６'); // カタカナ・全角でもよい
  results.push({ title: 'チームに参加できる', expected: 'team/member', actual: joinedTeam.team.orgType + '/' + joinedTeam.team.role });
  results.push({ title: '大会にも同じ方法で参加できる', expected: 'tournament/member', actual: joinedTournament.team.orgType + '/' + joinedTournament.team.role });
  const wrong = joinTestTeam_(player, '999999952', 'ちがうあいことば');
  results.push({ title: '大会の合言葉の間違いも同じく数える（あと9回）', expected: 'JOIN_FAILED/9', actual: wrong.code + '/' + (wrong.info && wrong.info.remainingAttempts) });

  const list = dispatch_({ action: 'listMyTeams', data: {} }, player).teams;
  results.push({ title: '一覧にチームと大会が、種類つきで出る', expected: '999999951:team,999999952:tournament', actual: list.map(function (t) { return t.teamNumber + ':' + t.orgType; }).join(',') });

  // ---------- 大会の代表者は合言葉を変えられる ----------
  const changed = dispatch_({ action: 'changePassphrase', data: { team_id: tournament.teamId, passphrase: 'あたらしいたいかい' } }, owner);
  results.push({ title: '大会の代表者は合言葉を変えられる', expected: 'tournament', actual: changed.team.orgType });
  results.push({ title: '大会の参加者（代表者でない）は合言葉を変えられない', expected: 'FORBIDDEN', actual: errorSummary_(function () {
    dispatch_({ action: 'changePassphrase', data: { team_id: tournament.teamId, passphrase: 'のっとりたいかい' } }, player);
  }) });

  // ---------- 成績を付けられるのはチームだけ（2026-11-11 B-11：成績は試合に付けるので、大会には試合を作れないことで確かめる） ----------
  const toTournament = callAsTest_(handleCreateGame_, { team_id: tournament.teamId, game_date: '2026-11-10' }, player, { today: '2026-11-10' });
  results.push({ title: '大会には試合（成績の入れ先）を直接作れない', expected: 'FORBIDDEN', actual: toTournament.code });

  const stats = callAsTest_(handleGetMyStats_, {}, player, { today: '2026-11-10' }, false);
  results.push({ title: '自分の成績の範囲の選択欄は、いまはチームだけ（大会は B-12 で足す）', expected: '999999951', actual: stats.teams.map(function (t) { return t.teamNumber; }).join(',') });
}
