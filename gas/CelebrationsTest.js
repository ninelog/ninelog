/**
 * B-16（記録達成のお祝い）のテスト
 *
 * 使い方：GASの編集画面で testCelebrations を選んで「実行」。ふだんは testAll から実行する。
 * 仮の人（Utest…）と自動テスト専用の番号（999999900〜）のチームだけを使い、最後に消す。
 */
function testCelebrations() {
  const realBefore = countRealRows_();
  cleanupTestData_();
  const results = [];
  try {
    testCelebrationsScenario_(results);
  } finally {
    cleanupTestData_();
  }
  results.push({ title: '本物の行（チーム・打撃・投手・変更の記録）の数が、テストの前後で変わらない', expected: realBefore, actual: countRealRows_() });
  logResults_(results);
}

function testCelebrationsScenario_(results) {
  const a = { userId: 'Utest_cla', name: 'あおき' };
  const b = { userId: 'Utest_clb', name: 'いとう' };
  createTestTeam_(a, '999999991', 'お祝いテスト', 'ないんろぐ99');
  const team = findTeamByNumber_('999999991');
  joinTestTeam_(b, '999999991', 'ないんろぐ99');

  const T = '2026-11-10';
  const g = [1, 2, 3, 4, 5].map(function (d) { return createTestGame_(a, team.team_id, '2026-11-0' + d, T); });
  const keys = battingCountFields_();
  const dataOf = function (game, nums) {
    const data = { game_id: game.game_id };
    keys.forEach(function (k, i) { data[k] = nums[i]; });
    return data;
  };
  const bat = function (user, game, nums) { return callAsTest_(handleAddBattingRecord_, dataOf(game, nums), user, { today: T }); };
  const fix = function (user, rec, game, nums) {
    return callAsTest_(handleUpdateBattingRecord_, Object.assign({ record_id: rec.record.record_id }, dataOf(game, nums)), user, { today: T });
  };
  const pit = function (user, game, innings) {
    return callAsTest_(handleAddPitchingRecord_, { game_id: game.game_id, innings: innings, partial_outs: 0, earned_runs: 0 }, user, { today: T });
  };
  const celebKeys = function (res) { return (res.celebrations || []).map(function (c) { return c.key; }).sort().join(','); };

  //                                  打席 打数 安打 二塁 三塁 本塁 打点 四球 死球 犠打 犠飛 三振 盗塁
  // ① 1安打 → 初安打（通算：安打1）
  const r1 = bat(a, g[0],           [4, 4, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0]);
  results.push({ title: '初めての安打 → 初安打', expected: 'first_hit', actual: celebKeys(r1) });
  results.push({ title: 'お祝いの文', expected: '初安打おめでとうございます！', actual: r1.celebrations[0] && r1.celebrations[0].message });

  // ② 単打1・二塁打1・三塁打1・本塁打1（4安打）→ 猛打賞・サイクルヒット・初本塁打（通算：安打5・本塁打1・打点5）
  const r2 = bat(a, g[1],           [5, 5, 4, 1, 1, 1, 4, 0, 0, 0, 0, 0, 0]);
  results.push({ title: '4安打のサイクル → 猛打賞・サイクル・初本塁打', expected: 'cycle,first_home_run,multi_hit', actual: celebKeys(r2) });
  results.push({ title: '猛打賞の文に安打の数', expected: '猛打賞おめでとうございます！（4安打）', actual: (r2.celebrations.filter(function (c) { return c.key === 'multi_hit'; })[0] || {}).message });

  // ③ 2本塁打・5打点・9盗塁 → 1試合2本塁打、通算打点 5+5＝10（節目）。盗塁は9で節目に届かない
  const r3 = bat(a, g[2],           [4, 4, 2, 0, 0, 2, 5, 0, 0, 0, 0, 0, 9]);
  results.push({ title: '2本塁打と通算10打点', expected: 'multi_home_run,rbis_10', actual: celebKeys(r3) });
  results.push({ title: '節目の文', expected: '通算10打点達成！', actual: (r3.celebrations.filter(function (c) { return c.key === 'rbis_10'; })[0] || {}).message });

  // ④ 3安打（2本塁打）・1盗塁 → 猛打賞・2本塁打・通算安打 7+3＝10・通算本塁打 3+2＝5・通算盗塁 9+1＝10
  const r4 = bat(a, g[3],           [4, 4, 3, 0, 0, 2, 0, 0, 0, 0, 0, 0, 1]);
  results.push({ title: '1回の入力で、いくつも届いたら全部返す', expected: 'hits_10,home_runs_5,multi_hit,multi_home_run,stolen_bases_10', actual: celebKeys(r4) });

  // ⑤ ④の打点だけを直す（0→1）→ 猛打賞・2本塁打はもともと届いていたので、もう一度は出さない
  const r5 = fix(a, r4, g[3],       [4, 4, 3, 0, 0, 2, 1, 0, 0, 0, 0, 0, 1]);
  results.push({ title: '修正：前から届いていた1試合の記録は、もう一度出さない', expected: '', actual: celebKeys(r5) });

  // ⑥ ①を1安打から3安打に直す → 猛打賞（新しく届いた）。初安打は前から届いているので出ない
  const r6 = fix(a, r1, g[0],       [4, 4, 3, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0]);
  results.push({ title: '修正で新しく届いたら、お祝いを出す', expected: 'multi_hit', actual: celebKeys(r6) });

  // ⑦ 同じ値のまま送る（何も変わらない）→ お祝いなし
  const r7 = fix(a, r1, g[0],       [4, 4, 3, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0]);
  results.push({ title: '何も変わらない修正は、お祝いなし', expected: 'true/', actual: r7.unchanged + '/' + celebKeys(r7) });

  // ⑧ ④を消して、入れ直す → 消すと通算が節目より下がるので、入れ直したら、もう一度届いたとしてお祝いを出す
  //    通算（④を消したあと）：安打 3+4+2＝9、本塁打 0+1+2＝3、盗塁 9
  callAsTest_(handleDeleteBattingRecord_, { record_id: r4.record.record_id }, a, { today: T });
  const r8 = bat(a, g[3],           [4, 4, 3, 0, 0, 2, 0, 0, 0, 0, 0, 0, 1]);
  results.push({ title: '消してから入れ直すと、もう一度お祝い（通算が節目より下がったため）', expected: 'hits_10,home_runs_5,multi_hit,multi_home_run,stolen_bases_10', actual: celebKeys(r8) });

  // ⑨ ほかの人（いとう）の通算は別：1安打 → 初安打
  const r9 = bat(b, g[0],           [3, 3, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  results.push({ title: '通算は本人の記録だけで数える（いとうの初安打）', expected: 'first_hit', actual: celebKeys(r9) });

  // ⑩ ヒットなし → お祝いなし
  const r10 = bat(a, g[4],          [3, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0]);
  results.push({ title: '何も届かなければ、お祝いは空', expected: 0, actual: r10.celebrations.length });

  // ---- 投手：通算の投球回 ----
  //   3回（outs9）→ なし、7回（outs 9+21＝30＝10回）→ 通算10投球回
  const p1 = pit(a, g[0], 3);
  results.push({ title: '投手：3回ではお祝いなし', expected: '', actual: celebKeys(p1) });
  const p2 = pit(a, g[1], 7);
  results.push({ title: '投手：通算10回に届いたら、通算10投球回', expected: 'innings_10', actual: celebKeys(p2) });
  results.push({ title: '投手の節目の文', expected: '通算10投球回達成！', actual: p2.celebrations[0] && p2.celebrations[0].message });

  // 画面からの入口でも、お祝いが返る
  // （画面からの入口では「今日」が本物の今日になるので、試合日から30日を過ぎた日に実行したときは EDIT_PERIOD_OVER でもよい）
  let viaScreen;
  try {
    viaScreen = dispatch_({ action: 'addBattingRecord', data: dataOf(g[1], [4, 4, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]) }, { userId: b.userId, name: b.name });
  } catch (err) {
    viaScreen = { code: err.code };
  }
  results.push({ title: '画面からの入口でも、お祝いが返る', expected: true, actual: (viaScreen.celebrations && viaScreen.celebrations.some(function (c) { return c.key === 'multi_hit'; })) || viaScreen.code === APP_ERROR.EDIT_PERIOD_OVER });
}
