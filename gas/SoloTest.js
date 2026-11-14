/**
 * B-19（個人用の記録）のテスト。CLAUDE.md 11.8章
 *
 * 使い方：GASの編集画面で testSolo を選んで「実行」。
 * 仮の人（Utest…）だけを使い、最初と最後に、仮の人の個人用の記録・試合・成績を消す。
 */
function testSolo() {
  const realBefore = countRealRows_();
  cleanupTestData_();
  const results = [];
  try {
    testSoloScenario_(results);
  } finally {
    cleanupTestData_();
  }
  results.push({ title: '本物の行（チーム・打撃・投手・変更の記録）の数が、テストの前後で変わらない', expected: realBefore, actual: countRealRows_() });
  logResults_(results);
}

function testSoloScenario_(results) {
  const me = { userId: 'Utest_soa', name: 'あおき' };
  const other = { userId: 'Utest_sob', name: 'いとう' };
  const T = '2026-11-10';
  const act = function (name, data, user, isAdmin) {
    const action = getActions_()[name];
    return callAsTest_(action.handler, data, Object.assign({}, user, { isAdmin: Boolean(isAdmin) }), { today: T }, action.write ? undefined : false);
  };
  const codeOf = function (res) {
    if (res && res.code === APP_ERROR.VALIDATION_ERROR) return res.code + ':' + ((res.details || [])[0] || {}).field;
    return res && res.code ? res.code : 'OK';
  };

  // ---------- 作る（1人に1つ） ----------
  const first = act('startSolo', {}, me);
  results.push({ title: '「個人用の記録を始める」で記録場所ができる', expected: 'true/個人用の記録/solo/owner/', actual: [first.created, first.team.teamName, first.team.orgType, first.team.role, first.team.teamNumber].join('/') });
  const again = act('startSolo', {}, me);
  results.push({ title: '2回目は新しく作らず、同じ記録場所を返す（1人に1つ）', expected: 'false/' + first.team.teamId, actual: again.created + '/' + again.team.teamId });
  results.push({ title: 'teams シートに、この人の個人用の記録は1行だけ', expected: 1, actual: readRecords_(CONFIG.SHEET.TEAMS).filter(function (t) { return t.created_by === me.userId && orgTypeOf_(t) === ORG_TYPE.SOLO; }).length });
  const soloId = first.team.teamId;
  const otherSolo = act('startSolo', {}, other).team;
  results.push({ title: 'ほかの人は、別の記録場所になる', expected: true, actual: otherSolo.teamId !== soloId });

  const myOrgs = act('listMyTeams', {}, me).teams;
  results.push({ title: '自分の一覧に「個人用の記録」が出る（種類 solo）', expected: '個人用の記録:solo', actual: myOrgs.map(function (t) { return t.teamName + ':' + t.orgType; }).join(',') });
  // 前の名前（「ひとりの記録」）のまま入っている行も、新しい名前で出る（2026-11-15 に名前を変えた）
  withLock_(function () {
    const row = findRecord_(CONFIG.SHEET.TEAMS, function (t) { return t.team_id === soloId; });
    updateRecord_(CONFIG.SHEET.TEAMS, row._row, { team_name: 'ひとりの' + '記録' });
  });
  results.push({ title: '前の名前でシートに入っている個人用の記録も、「個人用の記録」で出る', expected: '個人用の記録',
    actual: act('listMyTeams', {}, me).teams.filter(function (t) { return t.orgType === 'solo'; }).map(function (t) { return t.teamName; }).join(',') });

  // ---------- チームと同じように使える ----------
  const g1 = createTestGame_(me, soloId, '2026-11-01', T, { opponent: '北クラブ', result: 'win' });
  results.push({ title: '個人用の記録に試合を作れる', expected: soloId, actual: g1.team_id });
  const list = act('listTeamGames', { team_id: soloId, game_date: '2026-11-01' }, me);
  results.push({ title: '試合の一覧：作った試合が出て、付けられる大会は空', expected: '1/0', actual: list.games.length + '/' + list.myTournaments.length });

  const keys = battingCountFields_();
  const batData = function (game, nums) {
    const data = { game_id: game.game_id };
    keys.forEach(function (k, i) { data[k] = nums[i]; });
    return data;
  };
  //                                         打席 打数 安打 二塁 三塁 本塁 打点 四球 死球 犠打 犠飛 三振 盗塁
  const rec = act('addBattingRecord', batData(g1, [4, 4, 2, 0, 0, 1, 2, 0, 0, 0, 0, 1, 0]), me);
  results.push({ title: '打撃の成績を入れられる（お祝いも返る：初安打・初本塁打）', expected: 'first_home_run,first_hit', actual: rec.record ? rec.celebrations.map(function (c) { return c.key; }).sort().reverse().join(',') : codeOf(rec) });
  const pit = act('addPitchingRecord', { game_id: g1.game_id, innings: 3, partial_outs: 0, earned_runs: 1 }, me);
  results.push({ title: '投手の成績も入れられる', expected: 'OK', actual: codeOf(pit) });

  // ---------- 自分の成績・カレンダー ----------
  const stats = act('getMyStats', { season: 'all' }, me);
  results.push({ title: '自分の成績の全チーム合計に入る（打数4・安打2・本塁打1）', expected: '4/2/1', actual: [stats.batting.at_bats, stats.batting.hits, stats.batting.home_runs].join('/') });
  results.push({ title: '自分の成績の範囲の選択欄に「個人用の記録」が出る', expected: '個人用の記録:solo', actual: stats.teams.map(function (t) { return t.teamName + ':' + t.orgType; }).join(',') });
  const soloOnly = act('getMyStats', { season: 'all', team_id: soloId }, me);
  results.push({ title: '範囲に「個人用の記録」を選べる', expected: '.500', actual: soloOnly.batting.avg.text });
  const cal = act('getCalendar', { month: '2026-11' }, me);
  results.push({ title: 'カレンダーに●（自分の記録の日）が出る', expected: '2026-11-01:true', actual: cal.days.map(function (d) { return d.date + ':' + d.has_my_record; }).join(',') });

  // ---------- 出さない・断る ----------
  results.push({ title: 'ランキングには使えない', expected: 'FORBIDDEN', actual: codeOf(act('getTeamRanking', { team_id: soloId }, me)) });
  results.push({ title: 'チーム全体の成績には使えない', expected: 'FORBIDDEN', actual: codeOf(act('getTeamStats', { team_id: soloId }, me)) });
  results.push({ title: '合言葉は変えられない（合言葉を持たない）', expected: 'FORBIDDEN', actual: codeOf(act('changePassphrase', { team_id: soloId, passphrase: 'あたらしい99' }, me)) });
  results.push({ title: '番号が空なので、参加の欄から入れない（番号の形のまちがい）', expected: 'VALIDATION_ERROR:team_number', actual: codeOf(act('joinTeam', { team_number: '', passphrase: '' }, other)) });
  results.push({ title: 'ほかの人は、個人用の記録の試合に成績を入れられない', expected: 'FORBIDDEN', actual: codeOf(act('addBattingRecord', batData(g1, [1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]), other)) });
  results.push({ title: 'ほかの人は、個人用の記録に試合を作れない', expected: 'FORBIDDEN', actual: codeOf(act('createGame', { team_id: soloId, game_date: '2026-11-02' }, other)) });
  results.push({ title: 'ほかの人は、個人用の記録の試合の一覧を見られない', expected: 'FORBIDDEN', actual: codeOf(act('listTeamGames', { team_id: soloId }, other)) });

  // 大会は付けられない（作るときも、直すときも）
  createTestTeam_(me, '999999935', 'ひとりテスト大会', 'たいかい99', 'tournament');
  const tour = findTeamByNumber_('999999935');
  results.push({ title: '試合を作るときに大会を付けられない', expected: 'VALIDATION_ERROR:tournament_id', actual: codeOf(act('createGame', { team_id: soloId, game_date: '2026-11-03', tournament_id: tour.team_id }, me)) });
  results.push({ title: '試合を直すときにも大会を付けられない', expected: 'VALIDATION_ERROR:tournament_id', actual: codeOf(act('updateGame', { game_id: g1.game_id, game_date: '2026-11-01', game_number: 1, tournament_id: tour.team_id }, me)) });
  results.push({ title: '大会以外の項目は直せる', expected: 'OK', actual: codeOf(act('updateGame', { game_id: g1.game_id, game_date: '2026-11-01', game_number: 1, opponent: '南クラブ', result: 'lose' }, me)) });

  // ---------- あとからチームに参加しても残る・付け替えられる ----------
  createTestTeam_(other, '999999936', 'ひとりテストナイン', 'ないんろぐ99');
  const team = findTeamByNumber_('999999936');
  joinTestTeam_(me, '999999936', 'ないんろぐ99');
  const afterJoin = act('getMyStats', { season: 'all' }, me);
  results.push({ title: 'チームに参加しても、個人用の記録の成績はそのまま残る', expected: '4/2', actual: afterJoin.batting.at_bats + '/' + afterJoin.batting.hits });
  results.push({ title: '範囲の選択欄に、チームと個人用の記録の両方が出る', expected: 'ひとりテストナイン:team,個人用の記録:solo', actual: afterJoin.teams.map(function (t) { return t.teamName + ':' + t.orgType; }).sort().join(',') });
  const tg = createTestGame_(me, team.team_id, '2026-11-05', T);
  const moved = act('updateBattingRecord', Object.assign({ record_id: rec.record.record_id }, batData(tg, [4, 4, 2, 0, 0, 1, 2, 0, 0, 0, 0, 1, 0])), me);
  results.push({ title: '30日以内なら、個人用の記録の成績をチームの試合に付け替えられる', expected: team.team_id, actual: moved.record ? moved.record.team_id : codeOf(moved) });
  results.push({ title: '付け替えたあと、チームのランキングに載る', expected: 'あおき', actual: act('getTeamRanking', { team_id: team.team_id }, me).categories.hits.rows.map(function (r) { return r.displayName; }).join(',') });

  // ランキングとチーム全体の成績の選択欄には、個人用の記録が出ない
  const ranking = act('getTeamRanking', { team_id: team.team_id }, me);
  results.push({ title: 'ランキングのチームの選択欄に、個人用の記録は出ない', expected: '999999936', actual: ranking.teams.map(function (t) { return t.teamNumber; }).join(',') });

  // 画面からの入口でも動く
  const viaScreen = dispatch_({ action: 'startSolo', data: {} }, { userId: me.userId, name: me.name });
  results.push({ title: '画面からの入口でも、同じ記録場所が返る', expected: 'false/' + soloId, actual: viaScreen.created + '/' + viaScreen.team.teamId });
}
