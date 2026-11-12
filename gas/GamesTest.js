/**
 * B-10（試合の作成・一覧・修正・削除）のテスト
 *
 * 使い方：GASの編集画面で testGames を選んで「実行」。結果は「実行ログ」に出る。
 * すべて「OK」なら合格。
 *
 * 仮の人（Utest…）と自動テスト専用の番号（999999900〜）だけを使い、最後に消す。
 * 「今日」は 2026-11-10 に決め打ちする。
 * 「成績が付いている試合は消せない」は、成績を試合に結びつける B-11 で確かめる。
 */
function testGames() {
  const realBefore = countRealRows_();
  cleanupTestData_();
  const results = [];
  try {
    runGameTests_(results);
  } finally {
    cleanupTestData_();
  }
  results.push({ title: '本物の行（チーム・試合・打撃・投手・変更の記録）の数が、テストの前後で変わらない', expected: realBefore, actual: countRealRows_() });
  logResults_(results);
}

function runGameTests_(results) {
  const TODAY = '2026-11-10';
  const opt = { today: TODAY };
  const owner = { userId: 'Utest_gowner', name: '代表テスト' };
  const creator = { userId: 'Utest_gcreator', name: '作成テスト' };
  const member = { userId: 'Utest_gmember', name: '一般テスト' };
  const admin = { userId: 'Utest_gadmin', name: '管理テスト', isAdmin: true };
  const outsider = { userId: 'Utest_goutsider', name: '部外者テスト' };

  createTestTeam_(owner, '999999961', '試合テストナイン', 'ないんろぐ99');
  const team = findTeamByNumber_('999999961');
  [creator, member, admin].forEach(function (u) { joinTestTeam_(u, '999999961', 'ないんろぐ99'); });
  createTestTeam_(creator, '999999962', '試合テスト大会', 'たいかい2026', 'tournament');
  const tournament = findTeamByNumber_('999999962');

  const create = function (user, data, options) { return callAsTest_(handleCreateGame_, data, user, options || opt); };
  const update = function (user, data, options) { return callAsTest_(handleUpdateGame_, data, user, options || opt); };
  const remove = function (user, gameId, options) { return callAsTest_(handleDeleteGame_, { game_id: gameId }, user, options || opt); };
  const list = function (user, data, options) { return callAsTest_(handleListTeamGames_, data, user, options || opt, false); };
  const firstField = function (r) { return r.details ? r.details[0].field : r.code; };
  const changesOf = function (id) { return readRecords_(CONFIG.SHEET.RECORD_CHANGES).filter(function (c) { return c.record_id === id; }); };
  const gameRow = function (id) { return findRecord_(CONFIG.SHEET.GAMES, function (g) { return g.game_id === id; }); };

  // ---------- 作る ----------
  const g1 = create(creator, { team_id: team.team_id, game_date: TODAY, opponent: ' 〇〇クラブ ', category: 'official', result: 'win' });
  results.push({ title: '試合を作れる（番号を省略すると第1試合）', expected: 1, actual: g1.game && g1.game.game_number });
  results.push({ title: '対戦相手の前後の空白は除く', expected: '〇〇クラブ', actual: g1.game.opponent });
  results.push({ title: '試合日は文字のまま保存される', expected: 'string/' + TODAY, actual: typeof gameRow(g1.game.game_id).game_date + '/' + gameRow(g1.game.game_id).game_date });
  results.push({ title: '作った人には「直せる」が付く', expected: 'true/true', actual: g1.game.created_by_me + '/' + g1.game.can_edit });
  const g2 = create(member, { team_id: team.team_id, game_date: TODAY });
  results.push({ title: '同じ日にもう1つ作ると第2試合（ダブルヘッダー）', expected: 2, actual: g2.game && g2.game.game_number });
  results.push({ title: '任意の項目は空でよい', expected: '//', actual: [g2.game.opponent, g2.game.category, g2.game.result].join('/') });

  results.push({ title: '同じ日・同じ番号の試合は作れない', expected: 'game_number', actual: firstField(create(owner, { team_id: team.team_id, game_date: TODAY, game_number: 1 })) });
  results.push({ title: '第10試合は作れない（1〜9）', expected: 'game_number', actual: firstField(create(owner, { team_id: team.team_id, game_date: '2026-11-09', game_number: 10 })) });
  results.push({ title: '第0試合は作れない', expected: 'game_number', actual: firstField(create(owner, { team_id: team.team_id, game_date: '2026-11-09', game_number: 0 })) });
  results.push({ title: '30日目の試合は作れる', expected: 'ok', actual: okOrReason_(create(owner, { team_id: team.team_id, game_date: '2026-10-11', opponent: '△△ズ' }), 'game') });
  results.push({ title: '31日目の試合は作れない', expected: 'EDIT_PERIOD_OVER', actual: create(owner, { team_id: team.team_id, game_date: '2026-10-10' }).code });
  results.push({ title: '未来の試合は作れない', expected: 'game_date', actual: firstField(create(owner, { team_id: team.team_id, game_date: '2026-11-11' })) });
  results.push({ title: '所属していないチームの試合は作れない', expected: 'FORBIDDEN', actual: create(outsider, { team_id: team.team_id, game_date: TODAY }).code });
  results.push({ title: '大会に直接、試合は作れない（試合はチームに作る）', expected: 'FORBIDDEN', actual: create(creator, { team_id: tournament.team_id, game_date: TODAY }).code });
  results.push({ title: '対戦相手は30文字まで', expected: 'opponent', actual: firstField(create(owner, { team_id: team.team_id, game_date: '2026-11-08', opponent: 'あ'.repeat(31) })) });
  results.push({ title: '試合区分は選択式（公式戦・練習試合・その他）', expected: 'category', actual: firstField(create(owner, { team_id: team.team_id, game_date: '2026-11-08', category: '市民大会' })) });
  results.push({ title: '勝敗は選択式（勝ち・負け・引き分け）', expected: 'result', actual: firstField(create(owner, { team_id: team.team_id, game_date: '2026-11-08', result: '勝ち' })) });

  // ---------- 一覧 ----------
  const recent = list(member, { team_id: team.team_id });
  results.push({ title: '一覧：30日以内の試合が、新しい日から番号の順に出る', expected: TODAY + '#1,' + TODAY + '#2,2026-10-11#1', actual: recent.games.map(function (g) { return g.game_date + '#' + g.game_number; }).join(',') });
  results.push({ title: '一覧：対戦相手の候補（最近使った順、重なりなし）', expected: '〇〇クラブ,△△ズ', actual: recent.opponentSuggestions.join(',') });
  results.push({ title: '一覧：作っていない一般のメンバーには「直せない」', expected: false, actual: recent.games[0].can_edit });
  results.push({ title: '一覧：成績の情報や、作った人のIDは含まない', expected: false, actual: /created_by"|user_id|hits|at_bats/.test(JSON.stringify(recent)) });
  const day = list(member, { team_id: team.team_id, game_date: TODAY });
  results.push({ title: '日付を指定すると、その日の試合と次の番号（3）', expected: '2/3', actual: day.games.length + '/' + day.nextGameNumber });
  results.push({ title: '所属していないチームの試合は見られない', expected: 'FORBIDDEN', actual: list(outsider, { team_id: team.team_id }).code });
  const later = list(member, { team_id: team.team_id }, { today: '2026-12-11' });
  results.push({ title: '31日たつと、入力用の一覧には出ない', expected: 0, actual: later.games.length });
  const ownerView = list(owner, { team_id: team.team_id, game_date: TODAY });
  results.push({ title: 'チームの代表者には「直せる」が付く', expected: true, actual: ownerView.games[0].can_edit });

  // ---------- 直す ----------
  const id1 = g1.game.game_id;
  const base = { game_id: id1, game_date: TODAY, game_number: 1, opponent: '〇〇クラブ', category: 'official', result: 'win' };
  const u1 = update(creator, Object.assign({}, base, { result: 'lose', opponent: '〇〇クラブA' }));
  results.push({ title: '作った人は直せる', expected: 'false/lose/〇〇クラブA', actual: u1.unchanged + '/' + u1.game.result + '/' + u1.game.opponent });
  const logs = changesOf(id1);
  const resultLog = logs.filter(function (c) { return c.field === 'result'; })[0] || {};
  results.push({ title: '直した項目ごとに記録される（2行、game）', expected: '2/game/update/win/lose', actual: logs.length + '/' + resultLog.record_type + '/' + resultLog.action + '/' + resultLog.old_value + '/' + resultLog.new_value });

  const u2 = update(owner, Object.assign({}, base, { result: 'draw', opponent: '〇〇クラブA' }));
  results.push({ title: 'チームの代表者も直せる', expected: 'draw', actual: u2.game && u2.game.result });
  results.push({ title: '一般のメンバーは直せない', expected: 'FORBIDDEN', actual: update(member, Object.assign({}, base, { result: 'win' })).code });
  results.push({ title: '管理者でも、作った人・代表者でなければ直せない', expected: 'FORBIDDEN', actual: update(admin, Object.assign({}, base, { result: 'win' })).code });
  results.push({ title: '所属していない人は直せない', expected: 'FORBIDDEN', actual: update(outsider, Object.assign({}, base, { result: 'win' })).code });
  results.push({ title: '存在しない試合も同じ返事（FORBIDDEN）', expected: 'FORBIDDEN', actual: update(creator, Object.assign({}, base, { game_id: 'no-such-game' })).code });

  const same = update(creator, Object.assign({}, base, { result: 'draw', opponent: '〇〇クラブA' }));
  results.push({ title: '何も変えていなければ記録しない', expected: 'true/3', actual: same.unchanged + '/' + changesOf(id1).length });
  results.push({ title: '同じ日・同じ番号に直すことはできない（第2試合がある）', expected: 'game_number', actual: firstField(update(creator, Object.assign({}, base, { game_number: 2 }))) });
  results.push({ title: '試合日を31日前に直すことはできない', expected: 'EDIT_PERIOD_OVER', actual: update(creator, Object.assign({}, base, { game_date: '2026-10-10' })).code });
  results.push({ title: '試合日から31日目には直せない', expected: 'EDIT_PERIOD_OVER', actual: update(creator, Object.assign({}, base, { result: 'win' }), { today: '2026-12-11' }).code });
  const moved = update(creator, Object.assign({}, base, { team_id: 'other-team', game_date: '2026-11-08', result: 'draw', opponent: '〇〇クラブA' }));
  results.push({ title: '日付は直せる。チームは変えられない（送っても無視）', expected: '2026-11-08/' + team.team_id, actual: moved.game.game_date + '/' + moved.game.team_id });

  // ---------- 消す ----------
  const id2 = g2.game.game_id;
  results.push({ title: '作っていない一般のメンバーは消せない', expected: 'FORBIDDEN', actual: remove(creator, id2).code });
  results.push({ title: '試合日から31日目には消せない', expected: 'EDIT_PERIOD_OVER', actual: remove(member, id2, { today: '2026-12-11' }).code });
  const del = remove(member, id2);
  results.push({ title: '作った人は消せる（成績が付いていない試合）', expected: true, actual: del.deleted });
  results.push({ title: '消しても行は残り、削除日時が入る', expected: true, actual: Boolean(gameRow(id2).deleted_at) });
  results.push({ title: '削除は1行で記録される（game/delete）', expected: 'game/delete', actual: (changesOf(id2)[0] || {}).record_type + '/' + (changesOf(id2)[0] || {}).action });
  results.push({ title: '消した試合は一覧に出ない', expected: false, actual: list(member, { team_id: team.team_id }).games.some(function (g) { return g.game_id === id2; }) });
  results.push({ title: '消した試合は、もう直せない', expected: 'FORBIDDEN', actual: update(member, { game_id: id2, game_date: TODAY }).code });
  // （第1試合は上で 11/08 に動かしたので、今日の試合は無い。消した第2試合の番号をはっきり指定して作る）
  const reuse = create(member, { team_id: team.team_id, game_date: TODAY, game_number: 2 });
  results.push({ title: '消した試合の番号（第2試合）は、また使える', expected: 2, actual: reuse.game && reuse.game.game_number });

  // ---------- 画面からの入口 ----------
  const viaScreen = errorSummary_(function () {
    dispatch_({ action: 'deleteGame', data: { game_id: reuse.game.game_id } }, { userId: 'Utest_gscreen', name: '画面テスト' });
  });
  results.push({ title: '画面からでも、他人の試合は消せない', expected: 'FORBIDDEN', actual: viaScreen });
}
