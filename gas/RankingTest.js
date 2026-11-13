/**
 * B-13（チーム内ランキング）のテスト
 *
 * 使い方：GASの編集画面で testTeamRanking を選んで「実行」。ふだんは testAll から実行する。
 * 期待する値は、CLAUDE.md 第6.2〜6.4章の決まりで手計算したもの（計算の過程を下に書いてある）。
 * 仮の人（Utest…）と自動テスト専用の番号（999999900〜）のチームだけを使い、最後に消す。
 */
function testTeamRanking() {
  const realBefore = countRealRows_();
  cleanupTestData_();
  const results = [];
  try {
    testTeamRankingScenario_(results);
  } finally {
    cleanupTestData_();
  }
  results.push({ title: '本物の行（チーム・打撃・投手・変更の記録）の数が、テストの前後で変わらない', expected: realBefore, actual: countRealRows_() });
  logResults_(results);
}

function testTeamRankingScenario_(results) {
  // 表示名は、ひらがなの順（あ・い・う・え）で並ぶようにする
  const a = { userId: 'Utest_rka', name: 'あおき' };
  const b = { userId: 'Utest_rkb', name: 'いとう' };
  const c = { userId: 'Utest_rkc', name: 'うえだ' };
  const d = { userId: 'Utest_rkd', name: 'えもと' };
  const outsider = { userId: 'Utest_rkx', name: 'おかだ' };
  createTestTeam_(a, '999999951', 'ランキングテスト', 'ないんろぐ99');
  createTestTeam_(a, '999999952', '別のチーム', 'ないんろぐ99');
  createTestTeam_(a, '999999953', 'ランキング大会', 'たいかい99', 'tournament');
  createTestTeam_(outsider, '999999954', '部外者のチーム', 'ないんろぐ99');
  const team = findTeamByNumber_('999999951');
  const otherTeam = findTeamByNumber_('999999952');
  const tour = findTeamByNumber_('999999953');
  [b, c, d].forEach(function (u) { joinTestTeam_(u, '999999951', 'ないんろぐ99'); });

  // 試合（作るのは代表者のあおき）。2026年は3試合、2025年は1試合
  const g0 = createTestGame_(a, team.team_id, '2025-12-01', '2025-12-05');
  const g1 = createTestGame_(a, team.team_id, '2026-10-20', '2026-11-10');
  const g2 = createTestGame_(a, team.team_id, '2026-10-27', '2026-11-10');
  const g3 = createTestGame_(a, team.team_id, '2026-11-03', '2026-11-10');
  // 消した試合は、試合数に数えない
  const g4 = createTestGame_(a, team.team_id, '2026-11-06', '2026-11-10');
  callAsTest_(handleDeleteGame_, { game_id: g4.game_id }, a, { today: '2026-11-10' });
  // 別のチームの試合（混ざらないことを確かめる）
  const gx = createTestGame_(a, otherTeam.team_id, '2026-11-05', '2026-11-10');

  const keys = battingCountFields_();
  const bat = function (user, game, today, nums) {
    const data = { game_id: game.game_id };
    keys.forEach(function (k, i) { data[k] = nums[i]; });
    return callAsTest_(handleAddBattingRecord_, data, user, { today: today });
  };
  const pit = function (user, game, innings, partialOuts, er) {
    return callAsTest_(handleAddPitchingRecord_, { game_id: game.game_id, innings: innings, partial_outs: partialOuts, earned_runs: er }, user, { today: '2026-11-10' });
  };
  const T = '2026-11-10';
  //                               打席 打数 安打 二塁 三塁 本塁 打点 四球 死球 犠打 犠飛 三振 盗塁
  bat(a, g1, T, /* あおき */      [4, 4, 2, 0, 0, 1, 2, 0, 0, 0, 0, 1, 1]);
  bat(a, g2, T,                   [3, 3, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0]);
  bat(a, g0, '2025-12-05',        [4, 4, 4, 0, 0, 4, 9, 0, 0, 0, 0, 0, 9]); // 2025年（通算だけに入る）
  bat(a, gx, T,                   [5, 5, 5, 0, 0, 5, 9, 0, 0, 0, 0, 0, 0]); // 別のチーム（入らない）
  bat(b, g1, T, /* いとう */      [4, 3, 1, 1, 0, 0, 1, 1, 0, 0, 0, 0, 2]);
  bat(b, g2, T,                   [4, 4, 2, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]);
  const deleted = bat(b, g3, T,   [4, 4, 4, 0, 0, 4, 9, 0, 0, 0, 0, 0, 0]); // 消す（入らない）
  callAsTest_(handleDeleteBattingRecord_, { record_id: deleted.record.record_id }, b, { today: T });
  bat(c, g1, T, /* うえだ */      [3, 2, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0]);
  bat(d, g3, T, /* えもと */      [4, 0, 0, 0, 0, 0, 0, 4, 0, 0, 0, 0, 0]); // 打数0（四球だけ）
  bat(d, g1, T,                   [3, 0, 0, 0, 0, 0, 0, 3, 0, 0, 0, 0, 0]);

  pit(a, g1, 3, 0, 1); // あおき：3回・自責1
  pit(a, g2, 4, 0, 2); //         4回・自責2 → 合計 outs21・自責3
  pit(b, g3, 2, 1, 0); // いとう：2回1/3（outs7）・自責0
  pit(c, g2, 3, 0, 0); // うえだ：3回（outs9）・自責0
  pit(d, g1, 1, 0, 1); // えもと：1回（outs3）・自責1

  const ranking = function (user, data, today) {
    return callAsTest_(handleGetTeamRanking_, data, user, { today: today || T }, false);
  };
  // 部門の並びを「表示名:順位:表示」の形で並べる（順位なしは「-」）
  const order = function (r, key) {
    return r.categories[key].rows.map(function (row) {
      return row.displayName + ':' + (row.rank === null ? '-' : row.rank) + ':' + row.text;
    }).join(' ');
  };

  // ---- 2026年 ----
  // チーム試合数 3（g1・g2・g3。消した g4 と別のチームの gx は数えない）→ 規定打席 3×2＝6、規定投球回 3×1＝3回（outs9）
  const y = ranking(a, { team_id: team.team_id });
  results.push({ title: '年度を省略すると今年（2026）', expected: '2026', actual: y.season });
  results.push({ title: '2026年のチーム試合数（消した試合・別のチームの試合は数えない）', expected: 3, actual: y.teamGames });
  results.push({ title: '規定打席 6・規定投球回 3回（outs9）', expected: '6/9/3回', actual: [y.qualifyPlateAppearances, y.qualifyOuts, y.qualifyInningsText].join('/') });

  // 打率：あおき 3÷7＝.429（打席7）、いとう 3÷7＝.429（打席8）→ 同じ値なので同じ1位、表示名の順
  //       えもと 打席7で規定に届くが、打数0で打率が無い → 順位なし
  //       うえだ 打席3 → 規定打席まであと3打席
  results.push({ title: '打率：同じ値は同じ順位、打数0は順位なし、規定未達は最後', expected: 'あおき:1:.429 いとう:1:.429 えもと:-:- うえだ:-:.500', actual: order(y, 'avg') });
  const ueda = y.categories.avg.rows[3];
  results.push({ title: '打率：規定未達の人の残り（あと3打席）', expected: 'false/3/規定打席まであと3打席', actual: [ueda.qualified, ueda.remaining, ueda.remaining_text].join('/') });
  // 出塁率：えもと 7÷7＝1.000、いとう (3+1)÷(7+1)＝.500、あおき 3÷7＝.429
  results.push({ title: '出塁率の並び', expected: 'えもと:1:1.000 いとう:2:.500 あおき:3:.429 うえだ:-:.667', actual: order(y, 'obp') });
  // OPS：あおき 出塁率 .4286＋長打率 6÷7＝.8571 → 1.286、いとう .500＋4÷7＝.5714 → 1.071
  results.push({ title: 'OPSの並び', expected: 'あおき:1:1.286 いとう:2:1.071 えもと:-:- うえだ:-:1.167', actual: order(y, 'ops') });
  // 防御率（低い順）：うえだ 0×21÷9＝0.00、あおき 3×21÷21＝3.00
  //   規定未達：いとう outs7（あと2アウト＝2/3回）、えもと outs3（あと6アウト＝2回）→ あと少しの人から
  results.push({ title: '防御率の並び（低い順・規定未達はあと少しの人から）', expected: 'うえだ:1:0.00 あおき:2:3.00 いとう:-:0.00 えもと:-:7.00', actual: order(y, 'era') });
  results.push({ title: '防御率：規定未達の残りの表示', expected: '規定投球回まであと2/3回,規定投球回まであと2回', actual: y.categories.era.rows.slice(2).map(function (r) { return r.remaining_text; }).join(',') });
  // 数の部門：規定なし、打撃の記録がある全員（0の人も）
  results.push({ title: '安打：あおき3・いとう3（消した記録は入らない）・うえだ1・えもと0', expected: 'あおき:1:3 いとう:1:3 うえだ:3:1 えもと:4:0', actual: order(y, 'hits') });
  results.push({ title: '本塁打：別のチームの成績は入らない', expected: 'あおき:1:1 いとう:2:0 うえだ:2:0 えもと:2:0', actual: order(y, 'home_runs') });
  results.push({ title: '打点', expected: 'あおき:1:2 いとう:1:2 うえだ:3:0 えもと:3:0', actual: order(y, 'rbis') });
  results.push({ title: '盗塁', expected: 'いとう:1:2 あおき:2:1 うえだ:3:0 えもと:3:0', actual: order(y, 'stolen_bases') });

  // 本人の印と、他人のLINEユーザーIDを返さないこと
  results.push({ title: '本人の行だけ is_me が true', expected: 'あおき', actual: y.categories.hits.rows.filter(function (r) { return r.is_me; }).map(function (r) { return r.displayName; }).join(',') });
  results.push({ title: '他人のLINEユーザーIDを返さない', expected: false, actual: JSON.stringify(y).indexOf('Utest_rk') !== -1 });

  // ---- 通算 ----
  // チーム試合数 4 → 規定打席 8
  //   あおき：打席 7+4＝11、打数11、安打7 → 打率 7÷11＝.636（1位）。本塁打 1+4＝5
  //   いとう：打席8 → 規定に届く、.429（2位）
  //   えもと：打席7 → あと1打席、うえだ：打席3 → あと5打席（あと少しの人から）
  const all = ranking(a, { team_id: team.team_id, season: 'all' });
  results.push({ title: '通算：チーム試合数4・規定打席8', expected: '4/8', actual: all.teamGames + '/' + all.qualifyPlateAppearances });
  results.push({ title: '通算：打率の並び（規定未達はあと少しの人から）', expected: 'あおき:1:.636 いとう:2:.429 えもと:-:- うえだ:-:.500', actual: order(all, 'avg') });
  results.push({ title: '通算：規定未達の残り', expected: '規定打席まであと1打席,規定打席まであと5打席', actual: all.categories.avg.rows.slice(2).map(function (r) { return r.remaining_text; }).join(',') });
  results.push({ title: '通算：本塁打（2025年の分も入る）', expected: 'あおき:1:5', actual: order(all, 'home_runs').split(' ')[0] });

  // ---- 2025年 ----（あおきだけ・1試合 → 規定打席2）
  const y2025 = ranking(a, { team_id: team.team_id, season: '2025' });
  results.push({ title: '2025年：試合数1、あおきだけ', expected: '1/あおき:1:1.000', actual: y2025.teamGames + '/' + order(y2025, 'avg') });

  // 選択欄
  results.push({ title: '年度の選択欄：チームの試合がある年度（新しい順）', expected: '2026,2025', actual: y.seasons.join(',') });
  results.push({ title: 'チームの選択欄：所属しているチームだけ（大会は入らない）', expected: '999999951,999999952', actual: y.teams.map(function (t) { return t.teamNumber; }).join(',') });
  results.push({ title: 'チーム名が返る', expected: 'ランキングテスト', actual: y.teamName });
  results.push({ title: '今年（2027）の試合が無ければ、最初は通算', expected: 'all', actual: ranking(a, { team_id: team.team_id }, '2027-01-05').season });
  // 試合の無いチーム：試合数0、どの部門も空
  const empty = ranking(a, { team_id: otherTeam.team_id, season: '2025' });
  results.push({ title: '記録の無い年度：試合数0、部門は空', expected: '0/0', actual: empty.teamGames + '/' + empty.categories.avg.rows.length });

  // メンバーから見ても同じ（本人の印だけ変わる）
  const fromB = ranking(b, { team_id: team.team_id });
  results.push({ title: 'メンバー（いとう）から見ても同じ並び', expected: order(y, 'avg'), actual: order(fromB, 'avg') });
  results.push({ title: 'メンバー（いとう）から見ると、いとうに is_me', expected: 'いとう', actual: fromB.categories.hits.rows.filter(function (r) { return r.is_me; }).map(function (r) { return r.displayName; }).join(',') });

  // 断る場合
  results.push({ title: '所属していないチームは見られない', expected: 'FORBIDDEN', actual: ranking(outsider, { team_id: team.team_id }).code });
  results.push({ title: '大会のIDはチームのランキングに使えない', expected: 'FORBIDDEN', actual: ranking(a, { team_id: tour.team_id }).code });
  results.push({ title: 'チームを指定しなければ断る', expected: 'BAD_REQUEST', actual: ranking(a, {}).code });
  results.push({ title: '年度の形がまちがっていれば断る', expected: 'BAD_REQUEST', actual: ranking(a, { team_id: team.team_id, season: '26' }).code });

  // 画面からの入口でも動く
  const viaScreen = dispatch_({ action: 'getTeamRanking', data: { team_id: team.team_id, season: 'all' } }, { userId: a.userId, name: a.name });
  results.push({ title: '画面からの入口でも同じ結果', expected: '.636', actual: viaScreen.categories.avg.rows[0].text });
}
