/**
 * チーム・大会の名前を変える（renameTeam。2026-11-16 利用者が追加）のテスト
 *
 * 使い方：GASの編集画面で testRenameTeam を選んで「実行」。結果は「実行ログ」に出る。
 * 仮の人（Utest…）と自動テスト専用の番号（999999904・999999905）だけを使い、最初と最後に消す。
 */
function testRenameTeam() {
  const realBefore = countRealRows_();
  cleanupTestData_();
  const results = [];
  try {
    runRenameTests_(results);
  } finally {
    cleanupTestData_();
  }
  results.push({ title: '本物の行（チーム・試合・打撃・投手・変更の記録）の数が、テストの前後で変わらない', expected: realBefore, actual: countRealRows_() });
  logResults_(results);
}

function runRenameTests_(results) {
  const T = todayText_();
  const owner = { userId: 'Utest_rnowner', name: 'だいひょう' };
  const member = { userId: 'Utest_rnmember', name: 'めんばー' };
  const outsider = { userId: 'Utest_rnout', name: 'ぶがいしゃ' };
  const admin = { userId: 'Utest_rnadmin', name: 'かんり', isAdmin: true };

  createTestTeam_(owner, '999999904', '名前テストナイン', 'ないんろぐ99');
  createTestTeam_(owner, '999999905', '名前テスト大会', 'たいかい2026', 'tournament');
  const team = findTeamByNumber_('999999904');
  const tour = findTeamByNumber_('999999905');
  [member, admin].forEach(function (u) {
    joinTestTeam_(u, '999999904', 'ないんろぐ99');
    joinTestTeam_(u, '999999905', 'たいかい2026');
  });

  const rename = function (user, teamId, name, extra) {
    return callAsTest_(handleRenameTeam_, Object.assign({ team_id: teamId, team_name: name }, extra || {}), user);
  };
  const firstMessage = function (r) { return r.details ? r.details[0].field + '：' + r.details[0].message : (r.code || 'pass'); };
  const sheetName = function (id) { return String(findRecord_(CONFIG.SHEET.TEAMS, function (t) { return t.team_id === id; }).team_name); };
  const changesOf = function (id) { return readRecords_(CONFIG.SHEET.RECORD_CHANGES).filter(function (c) { return c.record_id === id; }); };
  const myTeamName = function (user, id) {
    const t = callAsTest_(handleListMyTeams_, {}, user, null, false).teams.filter(function (x) { return x.teamId === id; })[0];
    return t ? t.teamName : 'なし';
  };

  // 試合と成績（新しい名前が、ほかの画面にも出るかを確かめるため）
  const g = createTestGame_(owner, team.team_id, T, T, { tournament_id: tour.team_id, opponent: '北クラブ' });
  const bat = { game_id: g.game_id };
  battingCountFields_().forEach(function (k) { bat[k] = 0; });
  bat.plate_appearances = 3; bat.at_bats = 3; bat.hits = 1;
  callAsTest_(handleAddBattingRecord_, bat, member, { today: T });

  // ---------- 変える ----------
  const r1 = rename(owner, team.team_id, '  新しい​ナイン  ', { team_number: '999999999' });
  results.push({ title: '代表者は名前を変えられる（見えない文字と前後の空白は取り除く）', expected: 'false/新しいナイン', actual: r1.team ? r1.unchanged + '/' + r1.team.teamName : JSON.stringify(r1) });
  results.push({ title: 'シートの名前も変わる', expected: '新しいナイン', actual: sheetName(team.team_id) });
  results.push({ title: 'IDは変わらない（送っても使わない）', expected: '999999904', actual: String(findTeamByNumber_('999999904') ? findTeamByNumber_('999999904').team_number : 'なし') });
  const log = changesOf(team.team_id);
  results.push({ title: '変更の記録が1行残る（team・update・team_name・前の名前・新しい名前）', expected: '1/team/update/team_name/名前テストナイン/新しいナイン',
    actual: log.length + '/' + (log[0] || {}).record_type + '/' + (log[0] || {}).action + '/' + (log[0] || {}).field + '/' + (log[0] || {}).old_value + '/' + (log[0] || {}).new_value });
  const same = rename(owner, team.team_id, '新しいナイン');
  results.push({ title: '同じ名前なら何も書かない（記録も増えない）', expected: 'true/1', actual: same.unchanged + '/' + changesOf(team.team_id).length });
  results.push({ title: 'ほかのチーム・大会と同じ名前でもよい', expected: 'ok', actual: okOrReason_(rename(owner, team.team_id, '名前テスト大会'), 'team') });
  rename(owner, team.team_id, '新しいナイン');

  // ---------- 決まり（作るときと同じ文） ----------
  results.push({ title: '空は不可', expected: 'team_name：チーム名を入力してください', actual: firstMessage(rename(owner, team.team_id, '  ​ ')) });
  results.push({ title: '31文字は不可（いまの文字数を出す）', expected: 'team_name：チーム名は30文字までです（いま31文字）', actual: firstMessage(rename(owner, team.team_id, 'あ'.repeat(31))) });
  results.push({ title: '30文字はよい', expected: 'ok', actual: okOrReason_(rename(owner, team.team_id, 'い'.repeat(30)), 'team') });
  results.push({ title: '改行は不可', expected: 'team_name：チーム名に、改行などの使えない文字が入っています', actual: firstMessage(rename(owner, team.team_id, 'ナイン\nA')) });
  results.push({ title: '大会では「大会名」の文になる', expected: 'team_name：大会名を入力してください', actual: firstMessage(rename(owner, tour.team_id, '')) });
  rename(owner, team.team_id, '新しいナイン');

  // ---------- 変えられない人 ----------
  results.push({ title: 'メンバーは変えられない', expected: 'FORBIDDEN', actual: rename(member, team.team_id, 'のっとり').code });
  results.push({ title: '所属していない人は変えられない', expected: 'FORBIDDEN', actual: rename(outsider, team.team_id, 'のっとり').code });
  results.push({ title: '管理者でも、代表者でなければ変えられない', expected: 'FORBIDDEN', actual: rename(admin, team.team_id, 'のっとり').code });
  results.push({ title: '存在しないIDも同じ返事', expected: 'FORBIDDEN', actual: rename(owner, 'no-such-team', 'のっとり').code });
  const solo = callAsTest_(handleStartSolo_, {}, owner).team;
  results.push({ title: '個人用の記録の名前は変えられない', expected: 'FORBIDDEN', actual: rename(owner, solo.teamId, 'わたしの記録').code });
  results.push({ title: '断られたあとも名前はそのまま', expected: '新しいナイン', actual: sheetName(team.team_id) });

  // ---------- 大会 ----------
  const r2 = rename(owner, tour.team_id, '新しい大会');
  results.push({ title: '大会の代表者は大会の名前を変えられる', expected: '新しい大会/tournament', actual: r2.team ? r2.team.teamName + '/' + r2.team.orgType : JSON.stringify(r2) });
  results.push({ title: '大会の変更の記録は record_type が tournament', expected: 'tournament/名前テスト大会/新しい大会',
    actual: (changesOf(tour.team_id)[0] || {}).record_type + '/' + (changesOf(tour.team_id)[0] || {}).old_value + '/' + (changesOf(tour.team_id)[0] || {}).new_value });

  // ---------- どの画面にも新しい名前が出る ----------
  results.push({ title: 'メンバーの「所属しているチーム・大会」に新しい名前', expected: '新しいナイン/新しい大会', actual: myTeamName(member, team.team_id) + '/' + myTeamName(member, tour.team_id) });
  const detail = callAsTest_(handleGetGameDetail_, { game_id: g.game_id }, member, { today: T }, false);
  results.push({ title: '試合の詳細に新しいチーム名と大会名', expected: '新しいナイン/新しい大会', actual: detail.game ? detail.game.team_name + '/' + detail.game.tournament_name : JSON.stringify(detail) });
  const games = callAsTest_(handleListTeamGames_, { team_id: team.team_id }, member, { today: T }, false);
  results.push({ title: '試合の一覧の大会名も新しい名前', expected: '新しい大会', actual: games.games ? games.games[0].tournament_name : JSON.stringify(games) });
  const tr = callAsTest_(handleGetTournamentRanking_, { tournament_id: tour.team_id, season: 'all' }, member, { today: T }, false);
  const hitRow = tr.categories ? (tr.categories.hits.rows.filter(function (x) { return x.is_me; })[0] || {}) : {};
  results.push({ title: '大会のランキングで、選手の横のチーム名も新しい名前', expected: '新しいナイン', actual: tr.categories ? hitRow.teamName : JSON.stringify(tr) });
  const ts = callAsTest_(handleGetTeamStats_, { team_id: team.team_id, season: 'all' }, member, { today: T }, false);
  const tsTeam = ts.teams ? ts.teams.filter(function (x) { return x.teamId === team.team_id; })[0] : null;
  results.push({ title: 'チームの成績の選択欄に新しい名前', expected: '新しいナイン', actual: tsTeam ? tsTeam.teamName : JSON.stringify(ts).slice(0, 200) });

  // ---------- GASの中に覚えた中身（B-24 案B）で古い名前が出続けない ----------
  const view = function () { return myTeamName(member, team.team_id); };
  asNewRequest_(view);                     // 別の要求で一度読み、覚えさせる
  const cached = asNewRequest_(view);      // 覚えた中身を使う
  callAsTest_(handleRenameTeam_, { team_id: team.team_id, team_name: 'さらに新しいナイン' }, owner);
  const after = asNewRequest_(view);       // 変えたあとの別の要求
  results.push({ title: '覚えた中身があっても、変えたあとの次の要求では新しい名前（シートを読み直す）', expected: '新しいナイン/さらに新しいナイン/true', actual: cached.value + '/' + after.value + '/' + (after.reads > 0) });
}
