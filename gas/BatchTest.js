/**
 * B-22（読み込みを速くする：本人確認の結果を短い間覚える／見るだけの操作をまとめる）のテスト
 *
 * 使い方：GASの編集画面で testBatch を選んで「実行」。
 * 仮の人（Utest…）と自動テスト専用の番号（999999900〜）のチームだけを使い、最初と最後に消す。
 * 本物の札（IDトークン）は使えないので、覚える部品は、目印の作り方・覚える・読む・期限を確かめる。
 */
function testBatch() {
  const realBefore = countRealRows_();
  cleanupTestData_();
  const results = [];
  try {
    testBatchCacheScenario_(results);
    testBatchScenario_(results);
  } finally {
    cleanupTestData_();
  }
  results.push({ title: '本物の行（チーム・試合・打撃・投手・変更の記録）の数が、テストの前後で変わらない', expected: realBefore, actual: countRealRows_() });
  logResults_(results);
}

/** ① 本人確認の結果を短い間覚える */
function testBatchCacheScenario_(results) {
  const tokenA = 'Utest.token.' + Utilities.getUuid();
  const tokenB = tokenA + 'x';
  const keyA = idTokenCacheKey_(tokenA, '1234567890');
  results.push({ title: '目印：同じ札なら同じ目印', expected: keyA, actual: idTokenCacheKey_(tokenA, '1234567890') });
  results.push({ title: '目印：1文字でも違う札なら別の目印', expected: false, actual: keyA === idTokenCacheKey_(tokenB, '1234567890') });
  results.push({ title: '目印：チャネルが違えば別の目印', expected: false, actual: keyA === idTokenCacheKey_(tokenA, '999') });
  results.push({ title: '目印に札そのものは入っていない（SHA-256の64文字）', expected: 'false/68', actual: (keyA.indexOf(tokenA) !== -1) + '/' + keyA.length });

  const now = Date.now();
  const exp = Math.floor(now / 1000) + 3600; // 1時間後に切れる札
  const user = { userId: 'Utest_cache', name: 'キャッシュ' };
  results.push({ title: '覚える前は、何も読めない', expected: null, actual: readVerifiedCache_(keyA, now) });
  results.push({ title: '期限まで1時間ある札は覚える', expected: true, actual: cacheVerified_(keyA, user, exp, now) });
  results.push({ title: '覚えた結果を読める（ユーザーIDと名前だけ）', expected: 'Utest_cache/キャッシュ', actual: (function () {
    const v = readVerifiedCache_(keyA, now); return v ? v.userId + '/' + v.name : 'なし';
  })() });
  results.push({ title: '別の札では読めない', expected: null, actual: readVerifiedCache_(idTokenCacheKey_(tokenB, '1234567890'), now) });
  results.push({ title: '札の期限の30秒前を過ぎたら、覚えた結果を使わない', expected: null, actual: readVerifiedCache_(keyA, (exp - 20) * 1000) });
  const keyC = idTokenCacheKey_(tokenA + 'c', '1234567890');
  results.push({ title: 'もうすぐ切れる札（あと20秒）は覚えない', expected: false, actual: cacheVerified_(keyC, user, Math.floor(now / 1000) + 20, now) });
  results.push({ title: '期限が分からない札は覚えない', expected: false, actual: cacheVerified_(keyC, user, undefined, now) });
  try { CacheService.getScriptCache().remove(keyA); } catch (e) { /* そのまま */ }
}

/** ② 見るだけの操作をまとめる（batch） */
function testBatchScenario_(results) {
  const a = { userId: 'Utest_bta', name: 'あらい' };
  const b = { userId: 'Utest_btb', name: 'いしい' };
  const T = '2026-11-10';
  const act = function (name, data, user) {
    const action = getActions_()[name];
    return callAsTest_(action.handler, data, user, { today: T }, action.write ? undefined : false);
  };
  const codeOf = function (res) { return res && res.code ? res.code : 'OK'; };
  createTestTeam_(a, '999999951', 'まとめテスト', 'ないんろぐ99');
  createTestTeam_(b, '999999952', '別のチーム', 'ないんろぐ99');
  const team = findTeamByNumber_('999999951');
  const other = findTeamByNumber_('999999952');
  const g = createTestGame_(a, team.team_id, '2026-11-01', T);
  const data = { game_id: g.game_id };
  battingCountFields_().forEach(function (k) { data[k] = 0; });
  data.plate_appearances = 4; data.at_bats = 4; data.hits = 2;
  act('addBattingRecord', data, a);

  // 1件ずつ呼んだときと、まとめたときの返事が同じ
  const single = [act('getMyStats', { season: 'all' }, a), act('listMyTeams', {}, a), act('getCalendar', { month: '2026-11' }, a)];
  const res = act('batch', { requests: [
    { action: 'getMyStats', data: { season: 'all' } },
    { action: 'listMyTeams' },
    { action: 'getCalendar', data: { month: '2026-11' } },
  ] }, a);
  results.push({ title: 'まとめると、3件の返事が同じ順に返る', expected: 'true/true/true', actual: res.results.map(function (r) { return r.ok; }).join('/') });
  results.push({ title: 'まとめても、1件ずつ呼んだときと同じ中身', expected: true, actual: res.results.every(function (r, i) { return JSON.stringify(r.data) === JSON.stringify(single[i]); }) });

  // 権限の決まりは、1件ずつのときと同じ
  const mixed = act('batch', { requests: [
    { action: 'getTeamRanking', data: { team_id: other.team_id } }, // 所属していないチーム
    { action: 'getTeamRanking', data: { team_id: team.team_id } },
  ] }, a);
  results.push({ title: '所属していないチームは、その1件だけ断る（ほかは返る）', expected: 'FORBIDDEN/OK', actual: (mixed.results[0].ok ? 'OK' : mixed.results[0].error.code) + '/' + (mixed.results[1].ok ? 'OK' : mixed.results[1].error.code) });
  const write = act('batch', { requests: [{ action: 'deleteTeam', data: { team_id: team.team_id, confirm_name: 'まとめテスト' } }] }, a);
  results.push({ title: '書き込む操作はまとめられない（その1件を断る）', expected: 'BAD_REQUEST', actual: write.results[0].ok ? 'OK' : write.results[0].error.code });
  results.push({ title: '断ったあとも、チームは残っている', expected: true, actual: Boolean(findTeamByNumber_('999999951')) });
  const nested = act('batch', { requests: [{ action: 'batch', data: { requests: [{ action: 'whoami' }] } }] }, a);
  results.push({ title: 'まとめの中に、まとめは入れられない', expected: 'BAD_REQUEST', actual: nested.results[0].ok ? 'OK' : nested.results[0].error.code });
  const unknown = act('batch', { requests: [{ action: 'toString' }] }, a);
  results.push({ title: '知らない操作は、その1件を断る', expected: 'UNKNOWN_ACTION', actual: unknown.results[0].ok ? 'OK' : unknown.results[0].error.code });
  results.push({ title: '0件のまとめは断る', expected: 'BAD_REQUEST', actual: codeOf(act('batch', { requests: [] }, a)) });
  const eleven = [];
  for (let i = 0; i < 11; i++) eleven.push({ action: 'whoami' });
  results.push({ title: '11件以上のまとめは断る', expected: 'BAD_REQUEST', actual: codeOf(act('batch', { requests: eleven }, a)) });
  results.push({ title: 'requests が無いまとめは断る', expected: 'BAD_REQUEST', actual: codeOf(act('batch', {}, a)) });
  // 他人の記録は、まとめても見えない
  const theirs = act('batch', { requests: [{ action: 'listMyBattingRecords' }] }, b);
  results.push({ title: 'まとめても、他人の記録は出ない', expected: 0, actual: theirs.results[0].data.records.length });
}
