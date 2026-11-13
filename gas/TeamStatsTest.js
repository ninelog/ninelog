/**
 * B-14（チーム全体の成績）のテスト
 *
 * 使い方：GASの編集画面で testTeamStats を選んで「実行」。ふだんは testAll から実行する。
 * 期待する値は、CLAUDE.md 第6章の式で手計算したもの（計算の過程を下に書いてある）。
 * 仮の人（Utest…）と自動テスト専用の番号（999999900〜）のチームだけを使い、最後に消す。
 */
function testTeamStats() {
  const realBefore = countRealRows_();
  cleanupTestData_();
  const results = [];
  try {
    testTeamStatsScenario_(results);
  } finally {
    cleanupTestData_();
  }
  results.push({ title: '本物の行（チーム・打撃・投手・変更の記録）の数が、テストの前後で変わらない', expected: realBefore, actual: countRealRows_() });
  logResults_(results);
}

function testTeamStatsScenario_(results) {
  const a = { userId: 'Utest_tsa', name: 'あおき' };
  const b = { userId: 'Utest_tsb', name: 'いとう' };
  const outsider = { userId: 'Utest_tsx', name: 'おかだ' };
  createTestTeam_(a, '999999971', 'チーム成績テスト', 'ないんろぐ99');
  createTestTeam_(a, '999999972', '別のチーム', 'ないんろぐ99');
  createTestTeam_(a, '999999973', 'チーム成績大会', 'たいかい99', 'tournament');
  const team = findTeamByNumber_('999999971');
  const otherTeam = findTeamByNumber_('999999972');
  const tour = findTeamByNumber_('999999973');
  joinTestTeam_(b, '999999971', 'ないんろぐ99');

  const T = '2026-11-10';
  // 2026年：勝ち・負け・引き分け・未入力が1つずつ（4試合）。g1 は大会の試合（チームの成績に入る）
  const g1 = createTestGame_(a, team.team_id, '2026-10-20', T, { result: 'win', tournament_id: tour.team_id });
  const g2 = createTestGame_(a, team.team_id, '2026-10-27', T, { result: 'lose' });
  const g3 = createTestGame_(a, team.team_id, '2026-11-01', T, { result: 'draw' });
  createTestGame_(a, team.team_id, '2026-11-03', T);
  // 消した試合（勝ち）は数えない
  const g5 = createTestGame_(a, team.team_id, '2026-11-05', T, { result: 'win' });
  callAsTest_(handleDeleteGame_, { game_id: g5.game_id }, a, { today: T });
  // 2025年：勝ち1（通算だけに入る）
  const g0 = createTestGame_(a, team.team_id, '2025-12-01', '2025-12-05', { result: 'win' });
  // 別のチーム：勝敗未入力の1試合（混ざらない）
  const gx = createTestGame_(a, otherTeam.team_id, '2026-11-06', T);

  const keys = battingCountFields_();
  const bat = function (user, game, today, nums) {
    const data = { game_id: game.game_id };
    keys.forEach(function (k, i) { data[k] = nums[i]; });
    return callAsTest_(handleAddBattingRecord_, data, user, { today: today });
  };
  const pit = function (user, game, innings, partialOuts, er) {
    return callAsTest_(handleAddPitchingRecord_, { game_id: game.game_id, innings: innings, partial_outs: partialOuts, earned_runs: er }, user, { today: T });
  };
  //                          打席 打数 安打 二塁 三塁 本塁 打点 四球 死球 犠打 犠飛 三振 盗塁
  bat(a, g1, T,              [4, 4, 2, 1, 0, 0, 1, 0, 0, 0, 0, 1, 0]);
  bat(b, g1, T,              [4, 3, 1, 0, 0, 1, 2, 1, 0, 0, 0, 0, 1]);
  bat(a, g2, T,              [3, 2, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0]);
  const deleted = bat(b, g3, T, [4, 4, 4, 0, 0, 4, 9, 0, 0, 0, 0, 0, 0]); // 消す（入らない）
  callAsTest_(handleDeleteBattingRecord_, { record_id: deleted.record.record_id }, b, { today: T });
  bat(a, g0, '2025-12-05',   [4, 4, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]); // 2025年
  bat(a, gx, T,              [5, 5, 5, 0, 0, 5, 9, 0, 0, 0, 0, 0, 0]); // 別のチーム（入らない）
  pit(a, g1, 4, 0, 2); // outs12・自責2
  pit(b, g2, 3, 0, 1); // outs9・自責1

  const stats = function (user, data, today) {
    return callAsTest_(handleGetTeamStats_, data, user, { today: today || T }, false);
  };

  // ---- 2026年 ----
  const y = stats(a, { team_id: team.team_id });
  results.push({ title: '年度を省略すると今年（2026）', expected: '2026', actual: y.season });
  results.push({ title: '試合数（消した試合・別のチームは数えない。大会の試合は入る）', expected: 4, actual: y.games });
  results.push({ title: '勝敗：勝/負/分/未入力', expected: '1/1/1/1', actual: [y.record.win, y.record.lose, y.record.draw, y.record.unknown].join('/') });
  //   勝率 1÷(1+1)＝.500（引き分けと未入力は入れない）
  results.push({ title: '勝率 1÷(1+1)＝.500', expected: '.500', actual: y.winning_pct.text });
  //   打撃（あおき g1・g2、いとう g1。消した記録と別のチームは入らない）
  //     打席 4+4+3＝11、打数 4+3+2＝9、安打 2+1＝3、二塁打1、本塁打1、打点3、四球1、死球1、犠飛0
  //     打率 3÷9＝.333、出塁率 (3+1+1)÷(9+1+1)＝5÷11＝.455
  //     単打 3−1−1＝1、塁打 1+2+4＝7、長打率 7÷9＝.778、OPS .4545+.7778＝1.232
  const bt = y.batting;
  results.push({ title: '打撃：のべ出場/打席/打数/安打/本塁打/打点', expected: '3/11/9/3/1/3', actual: [bt.appearances, bt.plate_appearances, bt.at_bats, bt.hits, bt.home_runs, bt.rbis].join('/') });
  results.push({ title: 'チーム打率/出塁率/長打率/OPS', expected: '.333/.455/.778/1.232', actual: [bt.avg.text, bt.obp.text, bt.slg.text, bt.ops.text].join('/') });
  //   投手：outs 12+9＝21（7回）、自責 3 → 防御率 3×21÷21＝3.00
  const pt = y.pitching;
  results.push({ title: 'チーム防御率：のべ登板/投球回/自責点/防御率', expected: '2/7回/3/3.00', actual: [pt.appearances, pt.innings_text, pt.earned_runs, pt.era.text].join('/') });
  results.push({ title: '他人のLINEユーザーIDを返さない', expected: false, actual: JSON.stringify(y).indexOf('Utest_ts') !== -1 });

  // ---- 通算 ----（2025年の勝ち1と、あおきの4打数4安打が入る）
  //   試合5、勝2・負1・分1・未入力1 → 勝率 2÷3＝.667
  //   打数 9+4＝13、安打 3+4＝7 → 打率 7÷13＝.538
  const all = stats(a, { team_id: team.team_id, season: 'all' });
  results.push({ title: '通算：試合数/勝/勝率/打率', expected: '5/2/.667/.538', actual: [all.games, all.record.win, all.winning_pct.text, all.batting.avg.text].join('/') });

  // 勝ち・負けが無いチーム：勝率は「-」
  const other = stats(a, { team_id: otherTeam.team_id });
  results.push({ title: '勝敗が未入力だけのチーム：勝率「-」、試合1', expected: '1/-/1', actual: [other.games, other.winning_pct.text, other.record.unknown].join('/') });
  // 記録の無い年度：試合0、率は「-」
  const none = stats(a, { team_id: otherTeam.team_id, season: '2025' });
  results.push({ title: '試合の無い年度：試合0、打率・防御率・勝率は「-」', expected: '0/-/-/-', actual: [none.games, none.batting.avg.text, none.pitching.era.text, none.winning_pct.text].join('/') });

  // 選択欄・メンバーから見ても同じ
  results.push({ title: '年度の選択欄（新しい順）', expected: '2026,2025', actual: y.seasons.join(',') });
  results.push({ title: 'チームの選択欄（大会は入らない）', expected: '999999971,999999972', actual: y.teams.map(function (t) { return t.teamNumber; }).join(',') });
  results.push({ title: 'メンバー（いとう）から見ても同じ数字', expected: '.333/3.00', actual: [stats(b, { team_id: team.team_id }).batting.avg.text, stats(b, { team_id: team.team_id }).pitching.era.text].join('/') });

  // 断る場合
  results.push({ title: '所属していないチームは見られない', expected: 'FORBIDDEN', actual: stats(outsider, { team_id: team.team_id }).code });
  results.push({ title: '大会のIDは使えない（大会の全体の成績は作らない）', expected: 'FORBIDDEN', actual: stats(a, { team_id: tour.team_id }).code });
  results.push({ title: 'チームを指定しなければ断る', expected: 'BAD_REQUEST', actual: stats(a, {}).code });
  results.push({ title: '年度の形がまちがっていれば断る', expected: 'BAD_REQUEST', actual: stats(a, { team_id: team.team_id, season: '26' }).code });

  // 画面からの入口でも動く
  const viaScreen = dispatch_({ action: 'getTeamStats', data: { team_id: team.team_id, season: 'all' } }, { userId: a.userId, name: a.name });
  results.push({ title: '画面からの入口でも同じ結果', expected: '.667', actual: viaScreen.winning_pct.text });
}
