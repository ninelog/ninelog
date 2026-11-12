/**
 * B-9（自分の成績の計算）のテスト
 *
 * 使い方：GASの編集画面で testMyStats を選んで「実行」。結果は「実行ログ」に出る。
 * すべて「OK」なら合格。
 *
 * 期待する値は、CLAUDE.md 第6章の式で手計算したもの（計算の過程を下に書いてある）。
 * 仮の人（Utest…）と自動テスト専用の番号（999999900〜）のチームだけを使い、最後に消す。
 */
function testMyStats() {
  const realBefore = countRealRows_();
  cleanupTestData_();
  const results = [];
  try {
    testStatFormulas_(results);
    testMyStatsScenario_(results);
  } finally {
    cleanupTestData_();
  }
  results.push({ title: '本物の行（チーム・打撃・投手・変更の記録）の数が、テストの前後で変わらない', expected: realBefore, actual: countRealRows_() });
  logResults_(results);
}

/* ---------- 式と表示（シートを使わない） ---------- */
function testStatFormulas_(results) {
  [
    [0.325, '.325'], [1, '1.000'], [0, '.000'], [1.8095, '1.810'], [0.6666666, '.667'], [null, '-'],
  ].forEach(function (c) {
    results.push({ title: '率の表示：' + c[0] + ' → ' + c[1], expected: c[1], actual: formatRate_(c[0]) });
  });
  [[2.625, '2.63'], [3, '3.00'], [0, '0.00'], [null, '-']].forEach(function (c) {
    results.push({ title: '防御率の表示：' + c[0] + ' → ' + c[1], expected: c[1], actual: formatEra_(c[0]) });
  });
  results.push({ title: '防御率：自責点2・5回1/3（outs16）→ 2×21÷16 ＝ 2.625', expected: 2.625, actual: era_(2, 16) });
  results.push({ title: '防御率：投球回0なら null（表示「-」）', expected: null, actual: era_(3, 0) });

  // 打数0：打率・長打率・OPS は「-」。四球だけなら出塁率は 1.000
  const walksOnly = battingSummary_([{ plate_appearances: 2, at_bats: 0, hits: 0, doubles: 0, triples: 0, home_runs: 0, rbis: 0, walks: 2, hbp: 0, sacrifice_bunts: 0, sacrifice_flies: 0, strikeouts: 0, stolen_bases: 0 }]);
  results.push({ title: '打数0（四球2）：打率・出塁率・長打率・OPS', expected: '-/1.000/-/-', actual: [walksOnly.avg.text, walksOnly.obp.text, walksOnly.slg.text, walksOnly.ops.text].join('/') });
  const none = battingSummary_([]);
  results.push({ title: '記録なし：試合0、率はすべて「-」', expected: '0/-/-/-/-', actual: [none.games, none.avg.text, none.obp.text, none.slg.text, none.ops.text].join('/') });
  const sacOnly = battingSummary_([{ plate_appearances: 1, at_bats: 0, hits: 0, doubles: 0, triples: 0, home_runs: 0, rbis: 0, walks: 0, hbp: 0, sacrifice_bunts: 1, sacrifice_flies: 0, strikeouts: 0, stolen_bases: 0 }]);
  results.push({ title: '犠打は出塁率の分母に入れない（犠打だけなら出塁率は「-」）', expected: '-', actual: sacOnly.obp.text });
}

/* ---------- 実際に記録を登録して計算する ---------- */
function testMyStatsScenario_(results) {
  const me = { userId: 'Utest_sme', name: '成績テスト' };
  const other = { userId: 'Utest_sother', name: '他人テスト' };
  createTestTeam_(me, '999999941', '成績テストA', 'ないんろぐ99');
  createTestTeam_(me, '999999942', '成績テストB', 'ないんろぐ99');
  const teamA = findTeamByNumber_('999999941');
  const teamB = findTeamByNumber_('999999942');
  joinTestTeam_(other, '999999941', 'ないんろぐ99');

  // 2026-11-11 B-11：成績は試合に付けるので、チームと日付ごとに試合を1つ用意して使い回す（作るのは me）
  const games = {};
  const gameFor = function (teamId, date, today) {
    const key = teamId + '|' + date;
    if (!games[key]) games[key] = createTestGame_(me, teamId, date, today);
    return games[key].game_id;
  };
  const bat = function (user, teamId, date, today, nums) {
    const keys = battingCountFields_();
    const data = { game_id: gameFor(teamId, date, today) };
    keys.forEach(function (k, i) { data[k] = nums[i]; });
    return callAsTest_(handleAddBattingRecord_, data, user, { today: today });
  };
  const pit = function (user, teamId, date, today, innings, partialOuts, er) {
    return callAsTest_(handleAddPitchingRecord_, { game_id: gameFor(teamId, date, today), innings: innings, partial_outs: partialOuts, earned_runs: er }, user, { today: today });
  };

  //                                       打席 打数 安打 二塁 三塁 本塁 打点 四球 死球 犠打 犠飛 三振 盗塁
  bat(me, teamA.team_id, '2026-11-01', '2026-11-10', [4, 3, 2, 1, 0, 0, 1, 1, 0, 0, 0, 1, 0]); // ①2026・A
  bat(me, teamB.team_id, '2026-11-08', '2026-11-10', [5, 4, 2, 0, 0, 1, 3, 0, 1, 0, 0, 1, 1]); // ②2026・B
  bat(me, teamA.team_id, '2025-12-10', '2025-12-20', [4, 2, 1, 0, 1, 0, 0, 0, 0, 1, 1, 0, 2]); // ③2025・A
  const deleted = bat(me, teamA.team_id, '2026-11-09', '2026-11-10', [4, 4, 4, 0, 0, 4, 9, 0, 0, 0, 0, 0, 0]); // ④消す
  callAsTest_(handleDeleteBattingRecord_, { record_id: deleted.record.record_id }, me, { today: '2026-11-10' });
  bat(other, teamA.team_id, '2026-11-01', '2026-11-10', [4, 4, 4, 0, 0, 4, 9, 0, 0, 0, 0, 0, 0]); // ⑤他人

  pit(me, teamA.team_id, '2026-11-01', '2026-11-10', 5, 1, 2); // 2026・A：outs16・自責2
  pit(me, teamB.team_id, '2026-11-08', '2026-11-10', 1, 2, 1); // 2026・B：outs5・自責1
  pit(me, teamA.team_id, '2025-12-10', '2025-12-20', 7, 0, 0); // 2025・A：outs21・自責0

  const stats = function (data) { return callAsTest_(handleGetMyStats_, data, me, { today: '2026-11-10' }, false); };
  const line = function (s) { return [s.games, s.at_bats, s.hits, s.avg.text, s.obp.text, s.slg.text, s.ops.text].join('/'); };

  // 2026年・全チーム（①＋②）
  //   打数 3+4=7、安打 2+2=4、二塁打1、本塁打1、四球1、死球1、犠飛0
  //   打率 4÷7＝.571、出塁率 (4+1+1)÷(7+1+1+0)＝6÷9＝.667
  //   単打 4−1−0−1＝2、塁打 2+1×2+1×4＝8、長打率 8÷7＝1.143、OPS .6667+1.1429＝1.810
  const y2026 = stats({});
  results.push({ title: '年度を省略すると今年（2026）', expected: '2026', actual: y2026.season });
  results.push({ title: '2026年・全チーム：試合/打数/安打/打率/出塁率/長打率/OPS', expected: '2/7/4/.571/.667/1.143/1.810', actual: line(y2026.batting) });
  results.push({ title: '2026年・全チーム：本塁打・打点・盗塁', expected: '1/4/1', actual: [y2026.batting.home_runs, y2026.batting.rbis, y2026.batting.stolen_bases].join('/') });
  //   投手 outs 16+5＝21（7回）、自責 2+1＝3、防御率 3×21÷21＝3.00
  results.push({ title: '2026年・全チーム：投手 登板/投球回/自責点/防御率', expected: '2/7回/3/3.00', actual: [y2026.pitching.games, y2026.pitching.innings_text, y2026.pitching.earned_runs, y2026.pitching.era.text].join('/') });

  // 通算・全チーム（①＋②＋③）
  //   打数 9、安打 5、二塁打1、三塁打1、本塁打1、四球1、死球1、犠飛1
  //   打率 5÷9＝.556、出塁率 (5+1+1)÷(9+1+1+1)＝7÷12＝.583
  //   単打 5−1−1−1＝2、塁打 2+2+3+4＝11、長打率 11÷9＝1.222、OPS .5833+1.2222＝1.806
  const all = stats({ season: 'all' });
  results.push({ title: '通算・全チーム：試合/打数/安打/打率/出塁率/長打率/OPS', expected: '3/9/5/.556/.583/1.222/1.806', actual: line(all.batting) });
  //   投手 outs 42（14回）、自責 3、防御率 3×21÷42＝1.50
  results.push({ title: '通算・全チーム：投手 投球回/防御率', expected: '14回/1.50', actual: all.pitching.innings_text + '/' + all.pitching.era.text });

  // 2026年・チームA（①だけ）
  //   打率 2÷3＝.667、出塁率 3÷4＝.750、塁打 1+2＝3、長打率 3÷3＝1.000、OPS 1.750
  const aOnly = stats({ season: '2026', team_id: teamA.team_id });
  results.push({ title: '2026年・チームA：試合/打数/安打/打率/出塁率/長打率/OPS', expected: '1/3/2/.667/.750/1.000/1.750', actual: line(aOnly.batting) });
  //   投手 outs16（5回1/3）、自責2、防御率 2×21÷16＝2.625 → 2.63
  results.push({ title: '2026年・チームA：投手 投球回/防御率', expected: '5回1/3/2.63', actual: aOnly.pitching.innings_text + '/' + aOnly.pitching.era.text });

  // 2025年・チームB（記録なし）
  const empty = stats({ season: '2025', team_id: teamB.team_id });
  results.push({ title: '記録が無い組み合わせは、0と「-」', expected: '0/0/0/-/-/-/-', actual: line(empty.batting) });
  results.push({ title: '記録が無い組み合わせの防御率は「-」', expected: '-', actual: empty.pitching.era.text });

  // 選択欄
  results.push({ title: '年度の選択欄：記録がある年度（新しい順）', expected: '2026,2025', actual: y2026.seasons.join(',') });
  results.push({ title: 'チームの選択欄：所属しているチーム', expected: '999999941,999999942', actual: y2026.teams.map(function (t) { return t.teamNumber; }).join(',') });
  const nextYear = callAsTest_(handleGetMyStats_, {}, me, { today: '2027-01-05' }, false);
  results.push({ title: '今年（2027）の記録が無ければ、最初は通算', expected: 'all', actual: nextYear.season });

  // 断る場合
  const otherTeam = callAsTest_(handleGetMyStats_, { team_id: 'no-such-team' }, me, { today: '2026-11-10' }, false);
  results.push({ title: '所属していないチームは選べない', expected: 'FORBIDDEN', actual: otherTeam.code });
  const badSeason = callAsTest_(handleGetMyStats_, { season: '26' }, me, { today: '2026-11-10' }, false);
  results.push({ title: '年度の形がまちがっていれば断る', expected: 'BAD_REQUEST', actual: badSeason.code });

  // 他人の記録は入らない（他人から見ると、自分の1試合だけ）
  const otherStats = callAsTest_(handleGetMyStats_, { season: 'all' }, other, { today: '2026-11-10' }, false);
  results.push({ title: '他人の成績には、自分の記録が入らない', expected: '1/4/4', actual: [otherStats.batting.games, otherStats.batting.at_bats, otherStats.batting.hits].join('/') });

  // 画面からの入口でも動く
  const viaScreen = dispatch_({ action: 'getMyStats', data: { season: 'all' } }, { userId: me.userId, name: me.name });
  results.push({ title: '画面からの入口でも同じ結果', expected: '.556', actual: viaScreen.batting.avg.text });
}
