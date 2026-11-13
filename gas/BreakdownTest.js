/**
 * B-15（相手別・大会別・区分別の集計）のテスト
 *
 * 使い方：GASの編集画面で testBreakdowns を選んで「実行」。ふだんは testAll から実行する。
 * 期待する値は、CLAUDE.md 第6章の式で手計算したもの（計算の過程を下に書いてある）。
 * 仮の人（Utest…）と自動テスト専用の番号（999999900〜）のチーム・大会だけを使い、最後に消す。
 */
function testBreakdowns() {
  const realBefore = countRealRows_();
  cleanupTestData_();
  const results = [];
  try {
    testBreakdownsScenario_(results);
  } finally {
    cleanupTestData_();
  }
  results.push({ title: '本物の行（チーム・打撃・投手・変更の記録）の数が、テストの前後で変わらない', expected: realBefore, actual: countRealRows_() });
  logResults_(results);
}

function testBreakdownsScenario_(results) {
  const a = { userId: 'Utest_bda', name: 'あおき' };
  const b = { userId: 'Utest_bdb', name: 'いとう' };
  createTestTeam_(a, '999999981', '集計テスト', 'ないんろぐ99');
  createTestTeam_(a, '999999982', 'テスト大会A', 'たいかい99', 'tournament');
  createTestTeam_(a, '999999983', 'テスト大会B', 'たいかい99', 'tournament');
  const team = findTeamByNumber_('999999981');
  const tA = findTeamByNumber_('999999982');
  const tB = findTeamByNumber_('999999983');
  joinTestTeam_(b, '999999981', 'ないんろぐ99');

  const T = '2026-11-10';
  // 試合（2026年）
  //   g1：相手「ＡＢＣクラブ」（全角）・大会A（区分は自動で公式戦）・勝ち
  //   g2：相手「 ABCクラブ 」（半角・前後に空白）・大会なし・区分未入力・勝敗未入力 → g1 と同じ相手として数える
  //   g3：相手「北ナイン」・練習試合・負け
  //   g4：相手なし・区分なし・勝敗なし（記録なし）
  //   g5：相手「北ナイン」・大会B（公式戦）・引き分け
  const g1 = createTestGame_(a, team.team_id, '2026-10-20', T, { opponent: 'ＡＢＣクラブ', tournament_id: tA.team_id, result: 'win' });
  const g2 = createTestGame_(a, team.team_id, '2026-10-27', T, { opponent: ' ABCクラブ ' });
  const g3 = createTestGame_(a, team.team_id, '2026-11-01', T, { opponent: '北ナイン', category: 'practice', result: 'lose' });
  createTestGame_(a, team.team_id, '2026-11-03', T);
  const g5 = createTestGame_(a, team.team_id, '2026-11-05', T, { opponent: '北ナイン', tournament_id: tB.team_id, result: 'draw' });

  const keys = battingCountFields_();
  const bat = function (user, game, nums) {
    const data = { game_id: game.game_id };
    keys.forEach(function (k, i) { data[k] = nums[i]; });
    return callAsTest_(handleAddBattingRecord_, data, user, { today: T });
  };
  const pit = function (user, game, innings, partialOuts, er) {
    return callAsTest_(handleAddPitchingRecord_, { game_id: game.game_id, innings: innings, partial_outs: partialOuts, earned_runs: er }, user, { today: T });
  };
  //                 打席 打数 安打 二塁 三塁 本塁 打点 四球 死球 犠打 犠飛 三振 盗塁
  bat(a, g1,        [4, 4, 2, 0, 0, 1, 2, 0, 0, 0, 0, 1, 0]);
  bat(a, g2,        [4, 3, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0]);
  bat(a, g3,        [3, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0]);
  bat(a, g5,        [4, 4, 3, 1, 0, 0, 1, 0, 0, 0, 0, 0, 1]);
  bat(b, g1,        [3, 3, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  pit(a, g2, 2, 0, 1); // outs6・自責1
  pit(b, g3, 3, 0, 2); // outs9・自責2

  // 「ラベル:試合数:打率」の形で並べる
  const line = function (rows) {
    return rows.map(function (r) { return r.label + ':' + r.games + ':' + r.batting.avg.text; }).join(' ');
  };
  const recordText = function (r) { return [r.record.win, r.record.lose, r.record.draw, r.record.unknown, r.winning_pct.text].join('/'); };

  // ================= チーム全体の成績（2026年・5試合） =================
  const team26 = callAsTest_(handleGetTeamStats_, { team_id: team.team_id }, a, { today: T }, false).breakdowns;

  // ---- 相手別 ----
  //   ABCクラブ（g1・g2。全角・半角と空白をそろえて同じ相手）：打数 4+3+3＝10、安打 2+1+1＝4 → .400。勝1・未入力1 → 勝率 1÷1＝1.000
  //   北ナイン（g3・g5）：打数 3+4＝7、安打 0+3＝3 → .429。負1・分1 → 勝率 0÷1＝.000。防御率 2×21÷9＝4.67
  //   （未入力）（g4）：記録なし → 「-」。試合数の多い順、同じなら名前の順、未入力は最後
  results.push({ title: 'チーム・相手別：全角半角と空白をそろえて同じ相手にまとめる', expected: 'ABCクラブ:2:.400 北ナイン:2:.429 （未入力）:1:-', actual: line(team26.by_opponent) });
  results.push({ title: 'チーム・相手別：ABCクラブの勝敗（勝/負/分/未入力/勝率）', expected: '1/0/0/1/1.000', actual: recordText(team26.by_opponent[0]) });
  results.push({ title: 'チーム・相手別：北ナインの勝敗と防御率', expected: '0/1/1/0/.000/4.67', actual: recordText(team26.by_opponent[1]) + '/' + team26.by_opponent[1].pitching.era.text });
  results.push({ title: 'チーム・相手別：表示名はそろえたあとの名前（半角・前後の空白なし）', expected: 'ABCクラブ', actual: team26.by_opponent[0].label });

  // ---- 大会別 ----
  //   テスト大会A（g1）：打数 4+3＝7、安打 2+1＝3 → .429
  //   テスト大会B（g5）：打数4、安打3 → .750
  //   （大会なし）（g2・g3・g4）：打数 3+3＝6、安打1 → .167。防御率 (1+2)×21÷(6+9)＝4.20。大会なしは最後
  results.push({ title: 'チーム・大会別', expected: 'テスト大会A:1:.429 テスト大会B:1:.750 （大会なし）:3:.167', actual: line(team26.by_tournament) });
  results.push({ title: 'チーム・大会別：大会なしの防御率 3×21÷15＝4.20', expected: '4.20', actual: team26.by_tournament[2].pitching.era.text });

  // ---- 区分別 ----（公式戦・練習試合・その他・未入力の順）
  //   公式戦（g1・g5。大会を付けると自動で公式戦）：打数 4+4+3＝11、安打 2+3+1＝6 → .545。勝1・分1 → 勝率 1.000
  //   練習試合（g3）：打数3、安打0 → .000。負1 → .000
  //   （未入力）（g2・g4）：打数3、安打1 → .333。未入力2 → 勝率「-」
  results.push({ title: 'チーム・区分別', expected: '公式戦:2:.545 練習試合:1:.000 （未入力）:2:.333', actual: line(team26.by_category) });
  results.push({ title: 'チーム・区分別：公式戦・練習試合・未入力の勝率', expected: '1.000,.000,-', actual: team26.by_category.map(function (r) { return r.winning_pct.text; }).join(',') });

  // ================= 自分の成績（あおき・2026年・全チーム合計） =================
  // 自分の記録がある試合だけ（g1・g2・g3・g5。記録の無い g4 は入らない）。勝敗は付けない
  const mine = callAsTest_(handleGetMyStats_, {}, a, { today: T }, false).breakdowns;
  //   相手別：ABCクラブ（g1・g2）打数7・安打3 → .429、北ナイン（g3・g5）打数7・安打3 → .429（同じ試合数なので名前の順）
  results.push({ title: '自分・相手別（記録の無い試合は入らない）', expected: 'ABCクラブ:2:.429 北ナイン:2:.429', actual: line(mine.by_opponent) });
  //   ABCクラブの投手：g2 outs6・自責1 → 3.50
  results.push({ title: '自分・相手別：ABCクラブの防御率 1×21÷6＝3.50', expected: '3.50', actual: mine.by_opponent[0].pitching.era.text });
  results.push({ title: '自分の集計には勝敗を付けない', expected: false, actual: mine.by_opponent[0].hasOwnProperty('record') });
  //   大会別：大会A（g1）2÷4＝.500、大会B（g5）3÷4＝.750、大会なし（g2・g3）1÷6＝.167
  results.push({ title: '自分・大会別', expected: 'テスト大会A:1:.500 テスト大会B:1:.750 （大会なし）:2:.167', actual: line(mine.by_tournament) });
  //   区分別：公式戦（g1・g5）5÷8＝.625、練習試合（g3）.000、未入力（g2）1÷3＝.333
  results.push({ title: '自分・区分別', expected: '公式戦:2:.625 練習試合:1:.000 （未入力）:1:.333', actual: line(mine.by_category) });

  // 範囲を大会Aにしたら、集計もその範囲だけ
  const mineInA = callAsTest_(handleGetMyStats_, { tournament_id: tA.team_id }, a, { today: T }, false).breakdowns;
  results.push({ title: '自分・大会Aの範囲では、相手別も大会Aの試合だけ', expected: 'ABCクラブ:1:.500', actual: line(mineInA.by_opponent) });

  // いとう：打撃は g1、投手は g3
  const mineB = callAsTest_(handleGetMyStats_, {}, b, { today: T }, false).breakdowns;
  results.push({ title: 'いとう・相手別（打撃だけの相手、投手だけの相手）', expected: 'ABCクラブ:1:.333 北ナイン:1:-', actual: line(mineB.by_opponent) });
  results.push({ title: 'いとう・北ナインの防御率 2×21÷9＝4.67', expected: '4.67', actual: mineB.by_opponent[1].pitching.era.text });

  // 記録が無い年度では、集計は空
  const empty = callAsTest_(handleGetMyStats_, { season: '2025' }, a, { today: T }, false).breakdowns;
  results.push({ title: '記録が無い年度は、どの集計も空', expected: '0/0/0', actual: [empty.by_opponent.length, empty.by_tournament.length, empty.by_category.length].join('/') });

  // 相手の名前をそろえる決まり
  results.push({ title: '相手の名前：全角英字・前後の空白をそろえる', expected: 'ABCクラブ', actual: normalizeOpponent_('　ＡＢＣクラブ ') });
}
