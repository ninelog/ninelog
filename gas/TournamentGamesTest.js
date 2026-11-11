/**
 * B-10b（試合に大会を付ける・試合区分）のテスト
 *
 * 使い方：GASの編集画面で testTournamentGames を選んで「実行」。結果は「実行ログ」に出る。
 * すべて「OK」なら合格。
 *
 * 仮の人（Utest…）と自動テスト専用の番号（999999900〜）だけを使い、最後に消す。
 */
function testTournamentGames() {
  const realBefore = countRealRows_();
  cleanupTestData_();
  const results = [];
  try {
    runTournamentGameTests_(results);
  } finally {
    cleanupTestData_();
  }
  results.push({ title: '本物の行（チーム・試合・打撃・投手・変更の記録）の数が、テストの前後で変わらない', expected: realBefore, actual: countRealRows_() });
  logResults_(results);
}

function runTournamentGameTests_(results) {
  const TODAY = '2026-11-10';
  const opt = { today: TODAY };
  const owner = { userId: 'Utest_towner', name: '代表テスト' };     // チームの代表者。大会には参加していない
  const creator = { userId: 'Utest_tcreator', name: '作成テスト' }; // チームと大会T1に参加
  const member = { userId: 'Utest_tmember', name: '一般テスト' };   // チームだけ
  const organizer = { userId: 'Utest_torg', name: '主催テスト' };   // 大会T2の代表者

  createTestTeam_(owner, '999999971', '大会試合テストナイン', 'ないんろぐ99');
  const team = findTeamByNumber_('999999971');
  joinTestTeam_(creator, '999999971', 'ないんろぐ99');
  joinTestTeam_(member, '999999971', 'ないんろぐ99');
  createTestTeam_(creator, '999999972', 'テスト市民大会', 'たいかい2026', 'tournament');
  createTestTeam_(organizer, '999999973', 'テストリーグ', 'りーぐ2026', 'tournament');
  const t1 = findTeamByNumber_('999999972');
  const t2 = findTeamByNumber_('999999973');

  const create = function (user, data) { return callAsTest_(handleCreateGame_, Object.assign({ team_id: team.team_id, game_date: TODAY }, data), user, opt); };
  const update = function (user, data) { return callAsTest_(handleUpdateGame_, data, user, opt); };
  const list = function (user) { return callAsTest_(handleListTeamGames_, { team_id: team.team_id }, user, opt, false); };
  const firstField = function (r) { return r.details ? r.details[0].field : r.code; };

  // ---------- 作るときに大会を付ける ----------
  const g1 = create(creator, { tournament_id: t1.team_id, opponent: '〇〇クラブ' });
  results.push({ title: '参加している大会を付けて試合を作れる', expected: t1.team_id, actual: g1.game && g1.game.tournament_id });
  results.push({ title: '大会名が返る', expected: 'テスト市民大会', actual: g1.game.tournament_name });
  results.push({ title: '大会を付けて区分が空なら「公式戦」になる', expected: 'official', actual: g1.game.category });
  results.push({ title: '本人は大会に参加している（in_my_tournament）', expected: true, actual: g1.game.in_my_tournament });

  const g2 = create(creator, { tournament_id: t1.team_id, category: 'practice' });
  results.push({ title: '大会を付けても、区分は変えられる（練習試合）', expected: 'practice', actual: g2.game && g2.game.category });
  const g3 = create(member, {});
  results.push({ title: '大会を付けなくてもよい（区分は空のまま）', expected: '/', actual: g3.game.tournament_id + '/' + g3.game.category });

  results.push({ title: '参加していない大会は付けられない', expected: 'tournament_id', actual: firstField(create(creator, { tournament_id: t2.team_id })) });
  results.push({ title: '大会に参加していない人は、その大会を付けられない', expected: 'tournament_id', actual: firstField(create(member, { tournament_id: t1.team_id })) });
  results.push({ title: 'チームのIDは大会として付けられない', expected: 'tournament_id', actual: firstField(create(creator, { tournament_id: team.team_id })) });
  results.push({ title: '存在しない大会は付けられない', expected: 'tournament_id', actual: firstField(create(creator, { tournament_id: 'no-such-tournament' })) });

  // ---------- 一覧 ----------
  const creatorList = list(creator);
  results.push({ title: '一覧：本人が付けられる大会（参加している大会）が返る', expected: '999999972:テスト市民大会', actual: creatorList.myTournaments.map(function (t) { return t.tournamentNumber + ':' + t.tournamentName; }).join(',') });
  results.push({ title: '一覧：大会に参加していない人には、付けられる大会が無い', expected: 0, actual: list(member).myTournaments.length });
  const memberView = list(member).games.filter(function (g) { return g.game_id === g1.game.game_id; })[0];
  results.push({ title: '一覧：大会に参加していない人から見ると in_my_tournament は false（大会のランキングに載らない）', expected: 'テスト市民大会/false', actual: memberView.tournament_name + '/' + memberView.in_my_tournament });

  // ---------- 直すときの大会 ----------
  const base = { game_id: g1.game.game_id, game_date: TODAY, game_number: 1, opponent: '〇〇クラブ', category: 'official', result: '' };
  const keep = update(owner, Object.assign({}, base, { result: 'win' })); // 大会の項目は送らない
  results.push({ title: '大会に参加していない代表者でも、大会はそのままでほかの項目を直せる', expected: 'win/' + t1.team_id, actual: keep.game && (keep.game.result + '/' + keep.game.tournament_id) });
  const keepSame = update(owner, Object.assign({}, base, { result: 'win', tournament_id: t1.team_id })); // 同じ大会を送る
  results.push({ title: '今と同じ大会を送るのは、参加していなくてもよい（変えていない）', expected: true, actual: keepSame.unchanged });

  const removeT = update(owner, Object.assign({}, base, { result: 'win', tournament_id: '' }));
  results.push({ title: '大会を外すのは、参加していなくてもできる', expected: '', actual: removeT.game && removeT.game.tournament_id });
  const removeLog = readRecords_(CONFIG.SHEET.RECORD_CHANGES).filter(function (c) { return c.record_id === g1.game.game_id && c.field === 'tournament_id'; })[0] || {};
  results.push({ title: '大会を外したことが記録される', expected: t1.team_id + '→', actual: removeLog.old_value + '→' + removeLog.new_value });

  results.push({ title: '参加していない代表者は、大会を新しく付けられない', expected: 'tournament_id', actual: firstField(update(owner, Object.assign({}, base, { result: 'win', tournament_id: t1.team_id }))) });
  const reattach = update(creator, Object.assign({}, base, { result: 'win', tournament_id: t1.team_id }));
  results.push({ title: '大会に参加している作成者は、大会を付け直せる', expected: t1.team_id, actual: reattach.game && reattach.game.tournament_id });
  results.push({ title: '参加していない大会に変えることはできない', expected: 'tournament_id', actual: firstField(update(creator, Object.assign({}, base, { result: 'win', tournament_id: t2.team_id }))) });
  results.push({ title: '大会の代表者でも、チームの試合は直せない（11.7章のM）', expected: 'FORBIDDEN', actual: update(organizer, Object.assign({}, base, { result: 'lose' })).code });
}
