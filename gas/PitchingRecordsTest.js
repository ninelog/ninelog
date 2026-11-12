/**
 * B-8（投手成績の登録・一覧・修正・削除）のテスト
 * 2026-11-11 B-11：成績を試合（game_id）に結びつける形に作り直した。
 *
 * 使い方：GASの編集画面で testPitchingRecords を選んで「実行」。結果は「実行ログ」に出る。
 * すべて「OK」なら合格。
 *
 * 打撃（B-7）と同じルールが、投手でも効くことを確かめる。
 * 仮の人（Utest…）と自動テスト専用の番号（999999900〜）のチームだけを使い、最後に消す。
 * 「今日」は 2026-11-10 に決め打ちする。
 */
function testPitchingRecords() {
  const realBefore = countRealRows_();
  cleanupTestData_();
  const results = [];
  try {
    runPitchingRecordTests_(results);
  } finally {
    cleanupTestData_();
  }
  results.push({ title: '本物の行（チーム・試合・打撃・投手・変更の記録）の数が、テストの前後で変わらない', expected: realBefore, actual: countRealRows_() });
  logResults_(results);
}

function runPitchingRecordTests_(results) {
  const TODAY = '2026-11-10';
  const DAY30 = '2026-10-11';
  const DAY31 = '2026-10-10';
  const opt = { today: TODAY };

  const me = { userId: 'Utest_pme', name: '投手テスト' };
  const other = { userId: 'Utest_pother', name: '他人テスト' };
  const admin = { userId: 'Utest_padmin', name: '管理テスト', isAdmin: true };
  const outsider = { userId: 'Utest_poutsider', name: '部外者テスト' };

  createTestTeam_(me, '999999931', '投手テストナイン', 'ないんろぐ99');
  const team = findTeamByNumber_('999999931');
  joinTestTeam_(other, '999999931', 'ないんろぐ99');
  joinTestTeam_(admin, '999999931', 'ないんろぐ99');
  createTestTeam_(outsider, '999999932', '別チーム', 'ないんろぐ99');
  const otherTeam = findTeamByNumber_('999999932');

  const gToday = createTestGame_(me, team.team_id, TODAY, TODAY);
  const gDay30 = createTestGame_(me, team.team_id, DAY30, TODAY);
  const gDay31 = createTestGame_(me, team.team_id, DAY31, DAY31);
  const gOther = createTestGame_(outsider, otherTeam.team_id, TODAY, TODAY);

  const line = function (gameId, change) {
    return Object.assign({ game_id: gameId, innings: 5, partial_outs: 1, earned_runs: 2 }, change || {});
  };
  const add = function (user, data, options) { return callAsTest_(handleAddPitchingRecord_, data, user, options || opt); };
  const update = function (user, data, options) { return callAsTest_(handleUpdatePitchingRecord_, data, user, options || opt); };
  const remove = function (user, recordId, options) { return callAsTest_(handleDeletePitchingRecord_, { record_id: recordId }, user, options || opt); };
  const list = function (user) { return callAsTest_(handleListMyPitchingRecords_, {}, user, opt, false).records; };
  const firstField = function (r) { return r.details ? r.details[0].field : r.code; };
  const changesOf = function (recordId) {
    return readRecords_(CONFIG.SHEET.RECORD_CHANGES).filter(function (c) { return c.record_id === recordId; });
  };
  const rowOf = function (recordId) {
    return findRecord_(CONFIG.SHEET.PITCHING, function (r) { return r.record_id === recordId; });
  };

  // ---------- 登録 ----------
  const a = add(me, line(gToday.game_id));
  results.push({ title: '登録できる', expected: true, actual: Boolean(a.record && a.record.record_id) });
  const aRow = rowOf(a.record.record_id);
  results.push({ title: '5回1/3 は outs=16 で保存される', expected: 16, actual: aRow.outs });
  results.push({ title: '自責点が保存される', expected: 2, actual: aRow.earned_runs });
  results.push({ title: '記録の持ち主は本人、試合は game_id で結びつく', expected: me.userId + '/' + gToday.game_id, actual: aRow.user_id + '/' + aRow.game_id });
  results.push({ title: '返事に試合日が付く', expected: TODAY, actual: a.record.game_date });
  results.push({ title: '返事に、修正の画面に入れる「回」「アウト数」と表示用の投球回が付く', expected: '5/1/5回1/3', actual: a.record.innings + '/' + a.record.partial_outs + '/' + a.record.innings_text });
  results.push({ title: '打撃のシートには入らない', expected: null, actual: findRecord_(CONFIG.SHEET.BATTING, function (r) { return r.record_id === a.record.record_id; }) });

  results.push({ title: '同じ試合に2件目は入れられない（1試合1件まで）', expected: 'game_id', actual: firstField(add(me, line(gToday.game_id))) });
  results.push({ title: '30日目の試合は登録できる', expected: true, actual: Boolean(add(me, line(gDay30.game_id)).record) });
  const a31 = add(me, line(gDay31.game_id));
  results.push({ title: '31日目の試合は登録できない（期限切れの表示）', expected: 'EDIT_PERIOD_OVER/true', actual: a31.code + '/' + (String(a31.message).indexOf('入力・修正の期限を過ぎています') === 0) });
  results.push({ title: '所属していないチームの試合には登録できない', expected: 'FORBIDDEN', actual: add(me, line(gOther.game_id)).code });
  results.push({ title: 'アウト数3は入力チェックで断る', expected: 'VALIDATION_ERROR', actual: add(me, line(gDay31.game_id, { partial_outs: 3 })).code });

  const b = add(other, line(gToday.game_id, { innings: 2, partial_outs: 0, earned_runs: 0 }));

  // ---------- 一覧 ----------
  const myList = list(me);
  results.push({ title: '一覧には自分の記録だけが出る（新しい順）', expected: TODAY + ',' + DAY30, actual: myList.map(function (r) { return r.game_date; }).join(',') });
  results.push({ title: '一覧の投球回の表示', expected: '5回1/3', actual: myList[0].innings_text });

  // ---------- 修正 ----------
  const u = update(me, Object.assign({ record_id: a.record.record_id }, line(gToday.game_id, { innings: 6, partial_outs: 0, earned_runs: 3 })));
  results.push({ title: '修正できる（6回・自責点3）', expected: 'false/18/6回/3', actual: u.unchanged + '/' + u.record.outs + '/' + u.record.innings_text + '/' + u.record.earned_runs });
  const logs = changesOf(a.record.record_id);
  const outsLog = logs.filter(function (c) { return c.field === 'outs'; })[0] || {};
  results.push({ title: '変わった項目ごとに記録される（outs と earned_runs の2行）', expected: 2, actual: logs.length });
  results.push({ title: '投球回はアウト数の合計で記録される（16→18）', expected: 'pitching/update/16/18', actual: outsLog.record_type + '/' + outsLog.action + '/' + outsLog.old_value + '/' + outsLog.new_value });

  const same = update(me, Object.assign({ record_id: a.record.record_id }, line(gToday.game_id, { innings: 6, partial_outs: 0, earned_runs: 3 })));
  results.push({ title: '何も変えていなければ、記録を書かない', expected: 'true/2', actual: same.unchanged + '/' + changesOf(a.record.record_id).length });
  results.push({ title: '修正でも入力チェックをする', expected: 'VALIDATION_ERROR', actual: update(me, Object.assign({ record_id: a.record.record_id }, line(gToday.game_id, { partial_outs: 3 }))).code });

  results.push({ title: '他人の記録は修正できない', expected: 'FORBIDDEN', actual: update(other, Object.assign({ record_id: a.record.record_id }, line(gToday.game_id, { earned_runs: 9 }))).code });
  results.push({ title: '管理者でも、他人の記録は修正できない', expected: 'FORBIDDEN', actual: update(admin, Object.assign({ record_id: a.record.record_id }, line(gToday.game_id, { earned_runs: 9 }))).code });
  results.push({ title: '断られた修正では、記録の中身は変わらない', expected: 3, actual: Number(rowOf(a.record.record_id).earned_runs) });
  results.push({ title: '試合日から31日目には修正できない', expected: 'EDIT_PERIOD_OVER', actual: update(me, Object.assign({ record_id: a.record.record_id }, line(gToday.game_id, { earned_runs: 1 })), { today: '2026-12-11' }).code });
  results.push({ title: '31日前の試合に付け替えることはできない', expected: 'EDIT_PERIOD_OVER', actual: update(me, Object.assign({ record_id: a.record.record_id }, line(gDay31.game_id, { innings: 6, partial_outs: 0, earned_runs: 3 }))).code });

  // 打撃と投手の取り違え
  results.push({ title: '打撃の操作では、投手の記録を消せない', expected: 'FORBIDDEN', actual: callAsTest_(handleDeleteBattingRecord_, { record_id: a.record.record_id }, me, opt).code });
  results.push({ title: '同じ試合に、打撃の記録は別に1件入れられる（打撃と投手は別々に1件まで）', expected: true, actual: Boolean(callAsTest_(handleAddBattingRecord_, {
    game_id: gToday.game_id, plate_appearances: 2, at_bats: 2, hits: 0, doubles: 0, triples: 0, home_runs: 0, rbis: 0,
    walks: 0, hbp: 0, sacrifice_bunts: 0, sacrifice_flies: 0, strikeouts: 1, stolen_bases: 0,
  }, me, opt).record) });

  // ---------- 削除 ----------
  results.push({ title: '他人の記録は消せない', expected: 'FORBIDDEN', actual: remove(other, a.record.record_id).code });
  results.push({ title: '管理者でも、他人の記録は消せない', expected: 'FORBIDDEN', actual: remove(admin, a.record.record_id).code });
  results.push({ title: '試合日から31日目には消せない', expected: 'EDIT_PERIOD_OVER', actual: remove(me, a.record.record_id, { today: '2026-12-11' }).code });
  const del = remove(me, a.record.record_id);
  results.push({ title: '自分の記録は消せる（行は残り、削除日時が入る）', expected: 'true/true', actual: del.deleted + '/' + Boolean(rowOf(a.record.record_id).deleted_at) });
  const delLog = changesOf(a.record.record_id).filter(function (c) { return c.action === 'delete'; });
  results.push({ title: '削除は1行で記録される（pitching/deleted_at）', expected: '1/pitching/deleted_at', actual: delLog.length + '/' + (delLog[0] || {}).record_type + '/' + (delLog[0] || {}).field });
  results.push({ title: '消した記録は一覧に出ない', expected: 1, actual: list(me).length });
  results.push({ title: '他人の記録は、他人の一覧にだけ出る', expected: b.record.record_id, actual: list(other).map(function (r) { return r.record_id; }).join(',') });

  // ---------- 表示用の投球回 ----------
  [[0, '0回'], [1, '0回1/3'], [2, '0回2/3'], [3, '1回'], [16, '5回1/3'], [21, '7回']].forEach(function (c) {
    results.push({ title: '投球回の表示：outs ' + c[0] + ' → ' + c[1], expected: c[1], actual: formatInnings_(c[0]) });
  });

  // ---------- 画面からの入口 ----------
  const screen = errorSummary_(function () {
    dispatch_({ action: 'deletePitchingRecord', data: { record_id: b.record.record_id } }, { userId: 'Utest_pscreen', name: '画面テスト' });
  });
  results.push({ title: '画面からでも、他人の記録は消せない', expected: 'FORBIDDEN', actual: screen });
}
