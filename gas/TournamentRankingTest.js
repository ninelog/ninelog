/**
 * B-13b（大会のランキング）のテスト
 *
 * 使い方：GASの編集画面で testTournamentRanking を選んで「実行」。ふだんは testAll から実行する。
 * 期待する値は、CLAUDE.md 11.7章のE・F・Kと第6.4章の決まりで手計算したもの。
 * 仮の人（Utest…）と自動テスト専用の番号（999999900〜）のチーム・大会だけを使い、最後に消す。
 */
function testTournamentRanking() {
  const realBefore = countRealRows_();
  cleanupTestData_();
  const results = [];
  try {
    testTournamentRankingScenario_(results);
  } finally {
    cleanupTestData_();
  }
  results.push({ title: '本物の行（チーム・打撃・投手・変更の記録）の数が、テストの前後で変わらない', expected: realBefore, actual: countRealRows_() });
  logResults_(results);
}

function testTournamentRankingScenario_(results) {
  const a = { userId: 'Utest_tra', name: 'あおき' };  // ナインA・大会に参加
  const b = { userId: 'Utest_trb', name: 'いとう' };  // ナインA・大会に参加していない（載らない）
  const c = { userId: 'Utest_trc', name: 'うえだ' };  // ナインAとナインBの両方・大会に参加
  const k = { userId: 'Utest_trk', name: 'かとう' };  // ナインBの代表者・大会に参加
  createTestTeam_(a, '999999961', 'テスト大会', 'たいかい99', 'tournament');
  createTestTeam_(a, '999999962', 'ナインA', 'ないんろぐ99');
  createTestTeam_(k, '999999963', 'ナインB', 'ないんろぐ99');
  const tour = findTeamByNumber_('999999961');
  const teamA = findTeamByNumber_('999999962');
  const teamB = findTeamByNumber_('999999963');
  joinTestTeam_(b, '999999962', 'ないんろぐ99');
  joinTestTeam_(c, '999999962', 'ないんろぐ99');
  joinTestTeam_(c, '999999963', 'ないんろぐ99');
  [c, k].forEach(function (u) { joinTestTeam_(u, '999999961', 'たいかい99'); });

  const T = '2026-11-10';
  const inTour = { tournament_id: tour.team_id };
  // ナインAの大会の試合：2026年に2試合（ga1・ga2）、2025年に1試合（ga0）。ga3 は大会なし（入らない）
  const ga0 = createTestGame_(a, teamA.team_id, '2025-12-01', '2025-12-05', inTour);
  const ga1 = createTestGame_(a, teamA.team_id, '2026-10-20', T, inTour);
  const ga2 = createTestGame_(a, teamA.team_id, '2026-10-27', T, inTour);
  const ga3 = createTestGame_(a, teamA.team_id, '2026-11-01', T);
  // ナインBの大会の試合：2026年に1試合（gb1）。gb2 は作ってから消す（数えない）
  const gb1 = createTestGame_(k, teamB.team_id, '2026-10-21', T, inTour);
  const gb2 = createTestGame_(k, teamB.team_id, '2026-11-02', T, inTour);
  callAsTest_(handleDeleteGame_, { game_id: gb2.game_id }, k, { today: T });

  const keys = battingCountFields_();
  const bat = function (user, game, today, nums) {
    const data = { game_id: game.game_id };
    keys.forEach(function (key, i) { data[key] = nums[i]; });
    return callAsTest_(handleAddBattingRecord_, data, user, { today: today });
  };
  const pit = function (user, game, innings, partialOuts, er) {
    return callAsTest_(handleAddPitchingRecord_, { game_id: game.game_id, innings: innings, partial_outs: partialOuts, earned_runs: er }, user, { today: T });
  };
  //                          打席 打数 安打 二塁 三塁 本塁 打点 四球 死球 犠打 犠飛 三振 盗塁
  bat(a, ga1, T,             [4, 4, 2, 0, 0, 1, 2, 0, 0, 0, 0, 1, 0]); // あおき
  bat(a, ga3, T,             [5, 5, 5, 0, 0, 5, 9, 0, 0, 0, 0, 0, 0]); // 大会なしの試合（入らない）
  bat(a, ga0, '2025-12-05',  [4, 4, 4, 0, 0, 4, 9, 0, 0, 0, 0, 0, 0]); // 2025年（通算だけ）
  bat(b, ga1, T,             [4, 4, 4, 0, 0, 4, 9, 0, 0, 0, 0, 0, 0]); // いとう：大会に参加していない（載らない）
  bat(c, ga2, T,             [3, 3, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1]); // うえだ（ナインA）
  bat(c, gb1, T,             [2, 2, 1, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0]); // うえだ（ナインB）
  bat(k, gb1, T,             [3, 2, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0]); // かとう

  pit(a, ga1, 2, 0, 1); // あおき：outs6・自責1
  pit(c, ga2, 2, 0, 0); // うえだ：outs6・自責0
  pit(k, gb1, 1, 0, 0); // かとう：outs3・自責0

  const ranking = function (user, data, today) {
    return callAsTest_(handleGetTournamentRanking_, data, user, { today: today || T }, false);
  };
  const order = function (r, key) {
    return r.categories[key].rows.map(function (row) {
      return row.displayName + '（' + row.teamName + '）:' + (row.rank === null ? '-' : row.rank) + ':' + row.text;
    }).join(' ');
  };

  // ---- 2026年 ----
  // 大会の試合：ga1・ga2・gb1 の3試合（ga3 は大会なし、gb2 は消した）。ナインA 2試合、ナインB 1試合
  const y = ranking(a, { tournament_id: tour.team_id });
  results.push({ title: '年度を省略すると今年（2026）', expected: '2026', actual: y.season });
  results.push({ title: '大会の試合数（大会なし・消した試合は数えない）', expected: 3, actual: y.tournamentGames });
  results.push({ title: 'チームごとの大会の試合数（多い順）', expected: 'ナインA:2,ナインB:1', actual: y.teamGames.map(function (t) { return t.teamName + ':' + t.games; }).join(',') });
  results.push({ title: '大会名が返る', expected: 'テスト大会', actual: y.tournamentName });

  // 規定打席（その選手のチームの大会の試合数×2）
  //   あおき：ナインA 2試合 → 4打席。打席4で届く。打率 2÷4＝.500
  //   かとう：ナインB 1試合 → 2打席。打席3で届く。打率 1÷2＝.500 → あおきと同じ1位
  //   うえだ：ナインA 2＋ナインB 1＝3試合 → 6打席。打席 3+2＝5 → あと1打席。打率 2÷5＝.400
  results.push({ title: '打率：規定は選手のチームの試合数。2チームの人は足す', expected: 'あおき（ナインA）:1:.500 かとう（ナインB）:1:.500 うえだ（ナインA・ナインB）:-:.400', actual: order(y, 'avg') });
  results.push({ title: '2チームの人の残り：(2+1)×2＝6打席 − 5 ＝ あと1打席', expected: '規定打席まであと1打席', actual: y.categories.avg.rows[2].remaining_text });
  // 安打：あおき2（大会なしの試合の5本は入らない）、うえだ 1+1＝2、かとう1
  results.push({ title: '安打：大会なしの試合は入らない。2チームの人は合計', expected: 'あおき（ナインA）:1:2 うえだ（ナインA・ナインB）:1:2 かとう（ナインB）:3:1', actual: order(y, 'hits') });
  // 防御率（規定投球回＝試合数×1回）
  //   かとう：1試合 → 1回（outs3）。outs3で届く。0×21÷3＝0.00
  //   あおき：2試合 → 2回（outs6）。outs6で届く。1×21÷6＝3.50
  //   うえだ：3試合 → 3回（outs9）。outs6 → あと1回
  results.push({ title: '防御率の並び', expected: 'かとう（ナインB）:1:0.00 あおき（ナインA）:2:3.50 うえだ（ナインA・ナインB）:-:0.00', actual: order(y, 'era') });
  results.push({ title: '防御率：2チームの人の残り（3回−2回＝あと1回）', expected: '規定投球回まであと1回', actual: y.categories.era.rows[2].remaining_text });

  // 大会に参加していない人（いとう）は、大会の試合に記録があっても載らない（K）
  results.push({ title: '大会に参加していない人は載らない', expected: false, actual: JSON.stringify(y.categories).indexOf('いとう') !== -1 });
  results.push({ title: '他人のLINEユーザーIDを返さない', expected: false, actual: JSON.stringify(y).indexOf('Utest_tr') !== -1 });
  results.push({ title: '本人の行だけ is_me が true', expected: 'あおき', actual: y.categories.hits.rows.filter(function (r) { return r.is_me; }).map(function (r) { return r.displayName; }).join(',') });

  // ---- 通算 ----
  // ナインA 3試合（ga0 を足す）、ナインB 1試合
  //   あおき：規定 3×2＝6打席。打席 4+4＝8、打数8、安打6 → 打率 .750。本塁打 1+4＝5
  //   うえだ：規定 (3+1)×2＝8打席。打席5 → あと3打席
  const all = ranking(a, { tournament_id: tour.team_id, season: 'all' });
  results.push({ title: '通算：大会の試合数4', expected: 4, actual: all.tournamentGames });
  results.push({ title: '通算：打率の並び', expected: 'あおき（ナインA）:1:.750 かとう（ナインB）:2:.500 うえだ（ナインA・ナインB）:-:.400', actual: order(all, 'avg') });
  results.push({ title: '通算：2チームの人の残り（(3+1)×2＝8打席 − 5）', expected: '規定打席まであと3打席', actual: all.categories.avg.rows[2].remaining_text });
  results.push({ title: '通算：本塁打（2025年の分も入る）', expected: 'あおき（ナインA）:1:5', actual: order(all, 'home_runs').split(' ')[0] });

  // 選択欄
  results.push({ title: '年度の選択欄：大会の試合がある年度（新しい順）', expected: '2026,2025', actual: y.seasons.join(',') });
  results.push({ title: '大会の選択欄：参加している大会だけ', expected: '999999961', actual: y.tournaments.map(function (t) { return t.tournamentNumber; }).join(',') });
  results.push({ title: '今年（2027）の大会の試合が無ければ、最初は通算', expected: 'all', actual: ranking(a, { tournament_id: tour.team_id }, '2027-01-05').season });

  // 大会に参加している人なら、チームに入っていなくても見られる（かとうはナインAに入っていない）
  const fromK = ranking(k, { tournament_id: tour.team_id });
  results.push({ title: 'ほかのチームの参加者（かとう）からも同じ並び', expected: order(y, 'avg'), actual: order(fromK, 'avg') });

  // 断る場合
  results.push({ title: '大会に参加していない人は見られない', expected: 'FORBIDDEN', actual: ranking(b, { tournament_id: tour.team_id }).code });
  results.push({ title: 'チームのIDは大会のランキングに使えない', expected: 'FORBIDDEN', actual: ranking(a, { tournament_id: teamA.team_id }).code });
  results.push({ title: '大会を指定しなければ断る', expected: 'BAD_REQUEST', actual: ranking(a, {}).code });
  results.push({ title: '年度の形がまちがっていれば断る', expected: 'BAD_REQUEST', actual: ranking(a, { tournament_id: tour.team_id, season: '26' }).code });

  // チームのランキングには、大会に参加していない人（いとう）も入る（K）
  const teamRank = callAsTest_(handleGetTeamRanking_, { team_id: teamA.team_id }, a, { today: T }, false);
  results.push({ title: 'チームのランキングには、大会に参加していない人も入る', expected: true, actual: JSON.stringify(teamRank.categories).indexOf('いとう') !== -1 });

  // 画面からの入口でも動く
  const viaScreen = dispatch_({ action: 'getTournamentRanking', data: { tournament_id: tour.team_id, season: 'all' } }, { userId: a.userId, name: a.name });
  results.push({ title: '画面からの入口でも同じ結果', expected: '.750', actual: viaScreen.categories.avg.rows[0].text });
}
