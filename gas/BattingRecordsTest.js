/**
 * B-7（打撃成績の登録・一覧・修正・削除、期限、変更の記録）のテスト
 * 2026-11-11 B-11：成績を試合（game_id）に結びつける形に作り直した。
 *
 * 使い方：GASの編集画面で testBattingRecords を選んで「実行」。結果は「実行ログ」に出る。
 * すべて「OK」なら合格。
 *
 * 仮の人（Utest…）と自動テスト専用の番号（999999900〜）のチームだけを使い、最後に消す。
 * 「今日」は 2026-11-10 に決め打ちする（30日目・31日目を、実行する日に関係なく試すため）。
 */
function testBattingRecords() {
  const realBefore = countRealRows_();
  cleanupTestData_();
  const results = [];
  try {
    runBattingRecordTests_(results);
  } finally {
    cleanupTestData_();
  }
  const realAfter = countRealRows_();
  results.push({ title: '本物の行（チーム・試合・打撃・投手・変更の記録）の数が、テストの前後で変わらない', expected: realBefore, actual: realAfter });
  logResults_(results);
}

function runBattingRecordTests_(results) {
  const TODAY = '2026-11-10';
  const DAY30 = '2026-10-11'; // 今日が30日目になる試合日
  const DAY31 = '2026-10-10'; // 今日が31日目になる試合日
  const opt = { today: TODAY };

  const me = { userId: 'Utest_rme', name: '本人テスト' };
  const other = { userId: 'Utest_rother', name: '他人テスト' };
  const admin = { userId: 'Utest_radmin', name: '管理テスト', isAdmin: true };
  const outsider = { userId: 'Utest_routsider', name: '部外者テスト' };

  createTestTeam_(me, '999999921', '成績テストナイン', 'ないんろぐ99');
  const team = findTeamByNumber_('999999921');
  joinTestTeam_(other, '999999921', 'ないんろぐ99');
  joinTestTeam_(admin, '999999921', 'ないんろぐ99');
  createTestTeam_(outsider, '999999922', '別チーム', 'ないんろぐ99');
  const otherTeam = findTeamByNumber_('999999922');

  // 試合を用意する
  const gToday = createTestGame_(me, team.team_id, TODAY, TODAY, { opponent: '〇〇クラブ' });
  const gToday2 = createTestGame_(me, team.team_id, TODAY, TODAY);          // 第2試合（ダブルヘッダー）
  const g1101 = createTestGame_(me, team.team_id, '2026-11-01', TODAY);
  const gDay30 = createTestGame_(me, team.team_id, DAY30, TODAY);
  const gDay31 = createTestGame_(me, team.team_id, DAY31, DAY31);          // 31日前の試合（その日に作った）
  const gOther = createTestGame_(outsider, otherTeam.team_id, TODAY, TODAY); // 所属していないチームの試合

  const line = function (gameId, change) {
    return Object.assign({
      game_id: gameId,
      plate_appearances: 4, at_bats: 3, hits: 2, doubles: 1, triples: 0, home_runs: 0, rbis: 1,
      walks: 1, hbp: 0, sacrifice_bunts: 0, sacrifice_flies: 0, strikeouts: 1, stolen_bases: 0,
    }, change || {});
  };
  const add = function (user, data, options) { return callAsTest_(handleAddBattingRecord_, data, user, options || opt); };
  const update = function (user, data, options) { return callAsTest_(handleUpdateBattingRecord_, data, user, options || opt); };
  const remove = function (user, recordId, options) { return callAsTest_(handleDeleteBattingRecord_, { record_id: recordId }, user, options || opt); };
  const list = function (user, data) { return callAsTest_(handleListMyBattingRecords_, data || {}, user, opt, false).records; };
  const firstField = function (r) { return r.details ? r.details[0].field : r.code; };
  const changesOf = function (recordId) {
    return readRecords_(CONFIG.SHEET.RECORD_CHANGES).filter(function (c) { return c.record_id === recordId; });
  };
  const rowOf = function (recordId) {
    return findRecord_(CONFIG.SHEET.BATTING, function (r) { return r.record_id === recordId; });
  };

  // ---------- 登録 ----------
  const a = add(me, line(gToday.game_id, { user_id: other.userId, team_id: 'x', game_date: '2000-01-01' })); // 余計な項目は使われない
  results.push({ title: '試合を選んで登録できる', expected: true, actual: Boolean(a.record && a.record.record_id) });
  const aRow = rowOf(a.record.record_id);
  results.push({ title: '記録の持ち主は本人（画面から送った user_id は使わない）', expected: me.userId, actual: aRow.user_id });
  results.push({ title: '記録には試合の game_id が入る（チームと試合日の列は無い）', expected: gToday.game_id + '/undefined/undefined', actual: aRow.game_id + '/' + aRow.team_id + '/' + aRow.game_date });
  results.push({ title: '数字は数として保存される', expected: 'number/2', actual: typeof aRow.hits + '/' + aRow.hits });
  results.push({ title: 'チーム番号も文字のまま保存される（数に変わらない）', expected: 'string', actual: typeof team.team_number });
  results.push({ title: '返事に試合の情報（試合日・第何試合・相手・チーム）が付く', expected: TODAY + '/1/〇〇クラブ/' + team.team_id, actual: [a.record.game_date, a.record.game_number, a.record.opponent, a.record.team_id].join('/') });
  results.push({ title: '登録しただけでは、変更の記録は書かない', expected: 0, actual: changesOf(a.record.record_id).length });
  results.push({ title: '返事に修正の期限（30日後）が付く', expected: '2026-12-10', actual: a.record.editable_until });

  results.push({ title: '同じ試合に2件目は入れられない（1試合1件まで）', expected: 'game_id', actual: firstField(add(me, line(gToday.game_id))) });
  results.push({ title: '同じ日の第2試合には入れられる（ダブルヘッダー）', expected: 2, actual: (add(me, line(gToday2.game_id)).record || {}).game_number });
  const a30 = add(me, line(gDay30.game_id));
  results.push({ title: '30日目の試合は登録できる', expected: 'ok', actual: okOrReason_(a30, 'record') });
  const a31 = add(me, line(gDay31.game_id));
  results.push({ title: '31日目の試合は登録できない（期限切れの表示）', expected: 'EDIT_PERIOD_OVER/true', actual: a31.code + '/' + (String(a31.message).indexOf('入力・修正の期限を過ぎています') === 0) });
  results.push({ title: '所属していないチームの試合には登録できない', expected: 'FORBIDDEN', actual: add(me, line(gOther.game_id)).code });
  results.push({ title: '存在しない試合には登録できない', expected: 'game_id', actual: firstField(add(me, line('no-such-game'))) });
  results.push({ title: '入力のまちがいは入力チェックで断る', expected: 'VALIDATION_ERROR', actual: add(me, line(g1101.game_id, { hits: 4 })).code });

  const b = add(other, line(gToday.game_id, { hits: 1, doubles: 0 })); // 同じ試合でも、別の人なら入れられる
  results.push({ title: '同じ試合でも、別の選手なら入れられる', expected: true, actual: Boolean(b.record) });

  // ---------- 一覧 ----------
  const myList = list(me);
  results.push({ title: '一覧には自分の記録だけが出る', expected: 3, actual: myList.length });
  results.push({ title: '一覧は試合日の新しい順（同じ日は第2試合から）', expected: TODAY + '#2,' + TODAY + '#1,' + DAY30 + '#1', actual: myList.map(function (r) { return r.game_date + '#' + r.game_number; }).join(',') });
  results.push({ title: '一覧に「今日修正できるか」が付く', expected: true, actual: myList[0].editable });
  results.push({ title: 'チームで絞り込める（ほかのチームID）', expected: 0, actual: list(me, { team_id: 'no-such-team' }).length });

  // ---------- 修正 ----------
  const u = update(me, Object.assign({ record_id: a.record.record_id }, line(gToday.game_id, { hits: 1, doubles: 0, rbis: 3 })));
  results.push({ title: '修正できる', expected: 'false/1/3', actual: u.unchanged + '/' + u.record.hits + '/' + u.record.rbis });
  const logs = changesOf(a.record.record_id);
  results.push({ title: '変わった項目1つにつき1行記録される（安打・二塁打・打点で3行）', expected: 3, actual: logs.length });
  const hitLog = logs.filter(function (c) { return c.field === 'hits'; })[0] || {};
  results.push({ title: '記録に「何を何から何に」が入る（安打 2→1）', expected: 'update/hits/2/1', actual: hitLog.action + '/' + hitLog.field + '/' + hitLog.old_value + '/' + hitLog.new_value });
  results.push({ title: '記録に「誰が」「どちらの成績か」が入る', expected: me.userId + '/batting', actual: hitLog.user_id + '/' + hitLog.record_type });
  results.push({ title: '同じ修正の行は、同じ日時になる', expected: 1, actual: logs.map(function (c) { return String(c.changed_at); }).filter(function (v, i, arr) { return arr.indexOf(v) === i; }).length });

  const same = update(me, Object.assign({ record_id: a.record.record_id }, line(gToday.game_id, { hits: 1, doubles: 0, rbis: 3 })));
  results.push({ title: '何も変えていなければ、記録を書かない', expected: 'true/3', actual: same.unchanged + '/' + changesOf(a.record.record_id).length });
  const bad = update(me, Object.assign({ record_id: a.record.record_id }, line(gToday.game_id, { hits: 5 })));
  results.push({ title: '修正でも入力チェックをする（断ったら記録を書かない）', expected: 'VALIDATION_ERROR/3', actual: bad.code + '/' + changesOf(a.record.record_id).length });

  // 他人の記録には触れない（管理者も）
  results.push({ title: '他人の記録は修正できない', expected: 'FORBIDDEN', actual: update(other, Object.assign({ record_id: a.record.record_id }, line(gToday.game_id, { hits: 0, doubles: 0 }))).code });
  results.push({ title: '管理者でも、他人の記録は修正できない', expected: 'FORBIDDEN', actual: update(admin, Object.assign({ record_id: a.record.record_id }, line(gToday.game_id, { hits: 0, doubles: 0 }))).code });
  results.push({ title: '断られた修正では、記録の中身は変わらない', expected: 1, actual: Number(rowOf(a.record.record_id).hits) });
  results.push({ title: '存在しない記録は同じ返事（FORBIDDEN）', expected: 'FORBIDDEN', actual: update(me, Object.assign({ record_id: 'no-such-record' }, line(gToday.game_id))).code });

  // 期限と試合の付け替え
  results.push({ title: '試合日から31日目には修正できない', expected: 'EDIT_PERIOD_OVER', actual: update(me, Object.assign({ record_id: a30.record.record_id }, line(gDay30.game_id, { rbis: 2 })), { today: '2026-11-11' }).code });
  results.push({ title: '試合日から30日目なら修正できる', expected: false, actual: update(me, Object.assign({ record_id: a30.record.record_id }, line(gDay30.game_id, { rbis: 2 }))).unchanged });
  results.push({ title: '31日前の試合に付け替えることはできない（期限切れの復活を防ぐ）', expected: 'EDIT_PERIOD_OVER', actual: update(me, Object.assign({ record_id: a.record.record_id }, line(gDay31.game_id, { hits: 1, doubles: 0, rbis: 3 }))).code });
  results.push({ title: 'すでに自分の記録がある試合には付け替えられない', expected: 'game_id', actual: firstField(update(me, Object.assign({ record_id: a.record.record_id }, line(gToday2.game_id, { hits: 1, doubles: 0, rbis: 3 })))) });
  results.push({ title: '所属していないチームの試合には付け替えられない', expected: 'FORBIDDEN', actual: update(me, Object.assign({ record_id: a.record.record_id }, line(gOther.game_id, { hits: 1, doubles: 0, rbis: 3 }))).code });
  const moved = update(me, Object.assign({ record_id: a.record.record_id }, line(g1101.game_id, { hits: 1, doubles: 0, rbis: 3 })));
  const moveLog = changesOf(a.record.record_id).filter(function (c) { return c.field === 'game_id'; })[0] || {};
  results.push({ title: '期限の中なら、別の試合に付け替えられる（記録に前後の試合が残る）', expected: '2026-11-01/' + gToday.game_id + '→' + g1101.game_id, actual: moved.record.game_date + '/' + moveLog.old_value + '→' + moveLog.new_value });

  // ---------- 試合を消せるか（B-10で残していた確認） ----------
  const gameDel = callAsTest_(handleDeleteGame_, { game_id: g1101.game_id }, me, opt);
  results.push({ title: '成績が付いている試合は消せない', expected: 'GAME_HAS_RECORDS', actual: gameDel.code });

  // ---------- 削除 ----------
  results.push({ title: '他人の記録は消せない', expected: 'FORBIDDEN', actual: remove(other, a.record.record_id).code });
  results.push({ title: '管理者でも、他人の記録は消せない', expected: 'FORBIDDEN', actual: remove(admin, a.record.record_id).code });
  results.push({ title: '試合日から31日目には消せない', expected: 'EDIT_PERIOD_OVER', actual: remove(me, a30.record.record_id, { today: '2026-11-11' }).code });
  const del = remove(me, a.record.record_id);
  results.push({ title: '自分の記録は消せる', expected: true, actual: del.deleted });
  results.push({ title: '消しても行は残り、削除日時が入る（論理削除）', expected: true, actual: Boolean(rowOf(a.record.record_id).deleted_at) });
  const delLog = changesOf(a.record.record_id).filter(function (c) { return c.action === 'delete'; });
  results.push({ title: '削除は1行で記録される（deleted_at：空→日時）', expected: '1/deleted_at/', actual: delLog.length + '/' + (delLog[0] || {}).field + '/' + (delLog[0] || {}).old_value });
  results.push({ title: '消した記録は一覧に出ない', expected: 2, actual: list(me).length });
  results.push({ title: '消した記録は、もう直せない', expected: 'FORBIDDEN', actual: update(me, Object.assign({ record_id: a.record.record_id }, line(g1101.game_id))).code });
  results.push({ title: '消した記録は、もう一度は消せない', expected: 'FORBIDDEN', actual: remove(me, a.record.record_id).code });
  const gameDel2 = callAsTest_(handleDeleteGame_, { game_id: g1101.game_id }, me, opt);
  results.push({ title: '成績を消したあとなら、試合を消せる', expected: true, actual: gameDel2.deleted });
  results.push({ title: '消した記録の試合に、もう一度入力できる（1試合1件は、消していない記録で数える）', expected: 'ok', actual: okOrReason_(add(me, line(gToday.game_id)), 'record') });

  results.push({ title: '他人の記録は、他人の一覧にだけ出る', expected: b.record.record_id, actual: list(other).map(function (r) { return r.record_id; }).join(',') });

  // ---------- 画面からの入口 ----------
  const screen = errorSummary_(function () {
    dispatch_({ action: 'updateBattingRecord', data: Object.assign({ record_id: b.record.record_id }, line(gToday.game_id)) }, { userId: 'Utest_rscreen', name: '画面テスト' });
  });
  results.push({ title: '画面からでも、他人の記録は修正できない', expected: 'FORBIDDEN', actual: screen });
}

/** 自動テスト以外の（＝本物の）行の数をまとめて数える */
function countRealRows_() {
  const count = function (name, isTest) { return readRecords_(name).filter(function (r) { return !isTest(r); }).length; };
  return [
    count(CONFIG.SHEET.TEAMS, function (r) { return isTestTeamNumber_(r.team_number); }),
    count(CONFIG.SHEET.GAMES, function (r) { return isTestUserId_(r.created_by); }),
    count(CONFIG.SHEET.BATTING, function (r) { return isTestUserId_(r.user_id); }),
    count(CONFIG.SHEET.PITCHING, function (r) { return isTestUserId_(r.user_id); }),
    count(CONFIG.SHEET.RECORD_CHANGES, function (r) { return isTestUserId_(r.user_id); }),
  ].join('/');
}
