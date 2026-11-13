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
    testMyStatsTournamentAndTrend_(results);
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

  // B-12：推移は年をまたいでも1か月ずつ並ぶ（通算：2025-12〜2026-11 の12か月）
  results.push({ title: 'B-12 通算の推移：2025-12 から 2026-11 までの12か月', expected: '12/2025-12/2026-11', actual: [all.trend.length, all.trend[0].month, all.trend[all.trend.length - 1].month].join('/') });

  // B-12追加：積み上げ。通算では年でリセットせず、最初の記録から途切れずに積み上げる
  const cum = function (p) { return [p.month, p.cum_avg.text, p.cum_ops.text, p.cum_era.text].join('/'); };
  //   2025-12（③だけ）：打率 1÷2＝.500、出塁率 1÷(2+1)＝.333、塁打3、長打率 3÷2＝1.500、OPS 1.833。投手 outs21・自責0 → 0.00
  results.push({ title: 'B-12 通算の積み上げ 2025-12（③だけ）：月/打率/OPS/防御率', expected: '2025-12/.500/1.833/0.00', actual: cum(all.trend[0]) });
  //   2026-01：年が変わってもリセットしない。記録は無いので 2025-12 と同じ値が続く
  results.push({ title: 'B-12 通算の積み上げ 2026-01：年でリセットせず、前の月と同じ値', expected: '2026-01/.500/1.833/0.00', actual: cum(all.trend[1]) });
  //   2026-11：①＋②＋③（上の「通算・全チーム」と同じ）：打率 .556、OPS 1.806、防御率 3×21÷42＝1.50
  results.push({ title: 'B-12 通算の積み上げ 2026-11：通算の合計と同じ（2025年の分も入る）', expected: '2026-11/.556/1.806/1.50', actual: cum(all.trend[11]) });
  //   年度（2026）を選んだとき：2026年の記録だけ（①＋②。どちらも11月）なので、2025年の分は入らない
  const y2026Trend = stats({ season: '2026' }).trend;
  results.push({ title: 'B-12 年度（2026）の推移は、記録がある11月だけ', expected: '2026-11', actual: y2026Trend.map(function (p) { return p.month; }).join(',') });
  results.push({ title: 'B-12 年度（2026）の積み上げ 11月：2026年の合計と同じ（2025年の分は入らない）', expected: '2026-11/.571/1.810/3.00', actual: cum(y2026Trend[0]) });
}

/* ---------- B-12：大会の範囲と、月ごとの推移 ---------- */
function testMyStatsTournamentAndTrend_(results) {
  [['2026-09', '2026-10'], ['2026-12', '2027-01']].forEach(function (c) {
    results.push({ title: '次の月：' + c[0] + ' → ' + c[1], expected: c[1], actual: nextMonth_(c[0]) });
  });

  const me = { userId: 'Utest_strend', name: '推移テスト' };
  const other = { userId: 'Utest_strend2', name: '推移テスト他人' };
  createTestTeam_(me, '999999944', '推移テストチーム', 'ないんろぐ99');
  createTestTeam_(me, '999999945', '推移テスト大会', 'たいかい99', 'tournament');
  const team = findTeamByNumber_('999999944');
  const tour = findTeamByNumber_('999999945');
  joinTestTeam_(other, '999999944', 'ないんろぐ99'); // 他人はチームだけに参加（大会には参加しない）

  const keys = battingCountFields_();
  const play = function (date, today, extra, nums, pitch) {
    const game = createTestGame_(me, team.team_id, date, today, extra);
    const data = { game_id: game.game_id };
    keys.forEach(function (k, i) { data[k] = nums[i]; });
    callAsTest_(handleAddBattingRecord_, data, me, { today: today });
    if (pitch) {
      callAsTest_(handleAddPitchingRecord_, { game_id: game.game_id, innings: pitch[0], partial_outs: pitch[1], earned_runs: pitch[2] }, me, { today: today });
    }
  };
  //                                                         打席 打数 安打 二塁 三塁 本塁 打点 四球 死球 犠打 犠飛 三振 盗塁
  play('2026-09-05', '2026-09-10', { tournament_id: tour.team_id }, [4, 3, 1, 0, 0, 1, 2, 1, 0, 0, 0, 1, 0], [3, 0, 1]); // G1：大会・3回・自責1
  play('2026-09-20', '2026-09-25', {}, [4, 4, 2, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0], null);                                 // G2：大会なし
  play('2026-11-03', '2026-11-10', { tournament_id: tour.team_id }, [3, 2, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0], [2, 1, 0]); // G3：大会・2回1/3・自責0

  const stats = function (user, data) { return callAsTest_(handleGetMyStats_, data, user, { today: '2026-11-10' }, false); };
  const point = function (p) { return [p.month, p.batting_games, p.avg.text, p.ops.text, p.pitching_games, p.innings_text, p.era.text].join('/'); };

  // 2026年・全チームの推移（9月・10月・11月。10月は記録が無いので「-」）
  //   9月（G1＋G2）：打数 3+4＝7、安打 1+2＝3、二塁打1、本塁打1、四球1
  //     打率 3÷7＝.429、出塁率 (3+1)÷(7+1)＝.500、単打 3−1−1＝1、塁打 1+2+4＝7、長打率 7÷7＝1.000、OPS 1.500
  //     投手 outs9（3回）、自責1、防御率 1×21÷9＝2.333 → 2.33
  //   11月（G3）：打数2、安打0、四球1 → 打率 .000、出塁率 1÷3＝.333、長打率 0、OPS .333
  //     投手 outs7（2回1/3）、自責0、防御率 0.00
  const y2026 = stats(me, {});
  results.push({ title: 'B-12 推移の月の数（9〜11月。間の10月も入る）', expected: 3, actual: y2026.trend.length });
  results.push({ title: 'B-12 推移 9月：月/打撃試合/打率/OPS/登板/投球回/防御率', expected: '2026-09/2/.429/1.500/1/3回/2.33', actual: point(y2026.trend[0]) });
  results.push({ title: 'B-12 推移 10月（記録なし）：率は「-」', expected: '2026-10/0/-/-/0/0回/-', actual: point(y2026.trend[1]) });
  results.push({ title: 'B-12 推移 10月（記録なし）：グラフ用の値は null', expected: 'null/null/null', actual: [y2026.trend[1].avg.value, y2026.trend[1].ops.value, y2026.trend[1].era.value].map(String).join('/') });
  results.push({ title: 'B-12 推移 11月', expected: '2026-11/1/.000/.333/1/2回1/3/0.00', actual: point(y2026.trend[2]) });

  // B-12追加：年度（2026）を選んだときの積み上げ（その年の1月からその月まで）
  const cum = function (p) { return [p.month, p.cum_avg.text, p.cum_ops.text, p.cum_era.text].join('/'); };
  //   9月：9月だけと同じ
  results.push({ title: 'B-12 積み上げ 9月（9月だけと同じ）：月/打率/OPS/防御率', expected: '2026-09/.429/1.500/2.33', actual: cum(y2026.trend[0]) });
  //   10月：記録は無いが、9月までの積み上げがあるので、9月と同じ値
  results.push({ title: 'B-12 積み上げ 10月（記録なし）：9月と同じ値が続く', expected: '2026-10/.429/1.500/2.33', actual: cum(y2026.trend[1]) });
  //   11月（G1＋G2＋G3）：打数 9、安打 3、二塁打1、本塁打1、四球2
  //     打率 3÷9＝.333、出塁率 (3+2)÷(9+2)＝5÷11＝.4545、塁打7、長打率 7÷9＝.7778、OPS 1.2323 → 1.232
  //     投手 outs 9+7＝16、自責1、防御率 1×21÷16＝1.3125 → 1.31
  results.push({ title: 'B-12 積み上げ 11月（G1＋G2＋G3）', expected: '2026-11/.333/1.232/1.31', actual: cum(y2026.trend[2]) });
  results.push({ title: 'B-12 積み上げ 11月：グラフ用の値（打率）は 3÷9', expected: (3 / 9).toFixed(6), actual: y2026.trend[2].cum_avg.value.toFixed(6) });

  // 大会の範囲（G1＋G3）
  //   打数 3+2＝5、安打1、本塁打1、四球 1+1＝2 → 打率 1÷5＝.200、出塁率 (1+2)÷(5+2)＝3÷7＝.429
  //   塁打4、長打率 4÷5＝.800、OPS .4286+.8＝1.229
  //   投手 outs 9+7＝16（5回1/3）、自責1、防御率 1×21÷16＝1.3125 → 1.31
  const inTour = stats(me, { season: 'all', tournament_id: tour.team_id });
  results.push({ title: 'B-12 大会の範囲：試合/打数/安打/打率/出塁率/長打率/OPS', expected: '2/5/1/.200/.429/.800/1.229', actual: [inTour.batting.games, inTour.batting.at_bats, inTour.batting.hits, inTour.batting.avg.text, inTour.batting.obp.text, inTour.batting.slg.text, inTour.batting.ops.text].join('/') });
  results.push({ title: 'B-12 大会の範囲：投手 投球回/防御率', expected: '5回1/3/1.31', actual: inTour.pitching.innings_text + '/' + inTour.pitching.era.text });
  results.push({ title: 'B-12 大会の範囲：返事の tournamentId と teamId', expected: tour.team_id + '/null', actual: inTour.tournamentId + '/' + inTour.teamId });
  //   大会の推移 9月（G1だけ）：打率 1÷3＝.333、出塁率 2÷4＝.500、長打率 4÷3＝1.333、OPS 1.833
  results.push({ title: 'B-12 大会の推移 9月（G1だけ）', expected: '2026-09/1/.333/1.833/1/3回/2.33', actual: point(inTour.trend[0]) });
  results.push({ title: 'B-12 大会の推移：9〜11月の3か月', expected: '2026-09,2026-10,2026-11', actual: inTour.trend.map(function (p) { return p.month; }).join(',') });

  // チームの範囲は、大会の試合も大会なしの試合も全部（G1＋G2＋G3）。全チーム合計と同じ数になり、重ねて数えない
  const inTeam = stats(me, { season: 'all', team_id: team.team_id });
  const total = stats(me, { season: 'all' });
  results.push({ title: 'B-12 チームの範囲は大会の試合も含む（打撃3試合・打数9）', expected: '3/9', actual: inTeam.batting.games + '/' + inTeam.batting.at_bats });
  results.push({ title: 'B-12 全チーム合計は大会の試合を重ねて数えない（打撃3試合・打数9）', expected: '3/9', actual: total.batting.games + '/' + total.batting.at_bats });

  // 選択欄：チームと大会を分けて返す
  results.push({ title: 'B-12 チームの選択欄に大会は入らない', expected: '999999944', actual: total.teams.map(function (t) { return t.teamNumber; }).join(',') });
  results.push({ title: 'B-12 大会の選択欄', expected: '999999945:推移テスト大会', actual: total.tournaments.map(function (t) { return t.tournamentNumber + ':' + t.tournamentName; }).join(',') });

  // 記録が無い年度は、推移が空
  results.push({ title: 'B-12 記録が無い年度（2025）の推移は空', expected: 0, actual: stats(me, { season: '2025' }).trend.length });

  // 断る場合
  results.push({ title: 'B-12 チームと大会の両方を指定したら断る', expected: 'BAD_REQUEST', actual: stats(me, { team_id: team.team_id, tournament_id: tour.team_id }).code });
  results.push({ title: 'B-12 参加していない大会は選べない', expected: 'FORBIDDEN', actual: stats(other, { tournament_id: tour.team_id }).code });
  results.push({ title: 'B-12 チームのIDを大会として指定したら断る', expected: 'FORBIDDEN', actual: stats(me, { tournament_id: team.team_id }).code });
  results.push({ title: 'B-12 大会のIDをチームとして指定したら断る', expected: 'FORBIDDEN', actual: stats(me, { team_id: tour.team_id }).code });

  // 画面からの入口でも、大会を選べる
  const viaScreen = dispatch_({ action: 'getMyStats', data: { season: 'all', tournament_id: tour.team_id } }, { userId: me.userId, name: me.name });
  results.push({ title: 'B-12 画面からの入口でも大会の範囲が使える', expected: '.200/3', actual: viaScreen.batting.avg.text + '/' + viaScreen.trend.length });
}
