/**
 * B-26（試合の詳細 getGameDetail）のテスト
 *
 * 使い方：GASの編集画面で testGameDetail を選んで「実行」。
 * 仮の人（Utest…）と自動テスト用のID（999999915〜999999917）だけを使い、最初と最後に消す。
 */
function testGameDetail() {
  const realBefore = countRealRows_();
  cleanupTestData_();
  const results = [];
  try {
    testGameDetailScenario_(results);
  } finally {
    cleanupTestData_();
  }
  results.push({ title: '本物の行（チーム・試合・打撃・投手・変更の記録）の数が、テストの前後で変わらない', expected: realBefore, actual: countRealRows_() });
  logResults_(results);
}

function testGameDetailScenario_(results) {
  const a = { userId: 'Utest_gda', name: 'あおき' };   // 代表者
  const b = { userId: 'Utest_gdb', name: 'いとう' };   // メンバー
  const c = { userId: 'Utest_gdc', name: 'うえだ' };   // メンバー（あとで退会）
  const d = { userId: 'Utest_gdd', name: 'えのもと' }; // メンバー（あとで退会）
  const x = { userId: 'Utest_gdx', name: 'たにん' };   // 大会だけに参加（チームには入っていない）
  const T = '2026-11-10';
  const act = function (name, data, user, isAdmin) {
    const action = getActions_()[name];
    return callAsTest_(action.handler, data, Object.assign({}, user, { isAdmin: Boolean(isAdmin) }), { today: T }, action.write ? undefined : false);
  };
  const codeOf = function (res) { return res && res.code ? res.code : 'OK'; };

  createTestTeam_(a, '999999915', '詳細テストナイン', 'ないんろぐ99');
  createTestTeam_(a, '999999916', '詳細テスト大会', 'たいかい99', 'tournament');
  const team = findTeamByNumber_('999999915');
  const tour = findTeamByNumber_('999999916');
  [b, c, d].forEach(function (u) { joinTestTeam_(u, '999999915', 'ないんろぐ99'); });
  joinTestTeam_(x, '999999916', 'たいかい99');

  const g = createTestGame_(a, team.team_id, '2026-11-01', T, { opponent: '北クラブ', result: 'win', tournament_id: tour.team_id });
  const other = createTestGame_(a, team.team_id, '2026-11-02', T);
  const keys = battingCountFields_();
  const bat = function (user, game, nums) {
    const data = { game_id: game.game_id };
    keys.forEach(function (k, i) { data[k] = nums[i]; });
    return act('addBattingRecord', data, user);
  };
  //               打席 打数 安打 二塁 三塁 本塁 打点 四球 死球 犠打 犠飛 三振 盗塁
  bat(a, g,       [4, 4, 2, 0, 0, 1, 3, 0, 0, 0, 0, 0, 1]); // .500
  bat(b, g,       [3, 3, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]); // .333
  bat(c, g,       [2, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0, 0, 0]); // 打数0（四球2）
  bat(d, g,       [4, 4, 4, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0]); // 1.000
  bat(b, other,   [4, 4, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]); // 別の試合（入らない）
  act('addPitchingRecord', { game_id: g.game_id, innings: 5, partial_outs: 1, earned_runs: 2 }, a);
  act('addPitchingRecord', { game_id: g.game_id, innings: 1, partial_outs: 2, earned_runs: 0 }, b);
  const removed = bat(b, other, [1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]); // 1試合1件なので断られる（数には入らない）

  // ---------- 中身 ----------
  const res = act('getGameDetail', { game_id: g.game_id }, b);
  results.push({ title: '試合の情報：日付・第何試合・相手・大会名・勝敗・チーム名', expected: '2026-11-01/1/北クラブ/詳細テスト大会/win/詳細テストナイン/team',
    actual: [res.game.game_date, res.game.game_number, res.game.opponent, res.game.tournament_name, res.game.result, res.game.team_name, res.game.org_type].join('/') });
  results.push({ title: '打撃：その試合で成績を入れた4人（ほかの試合の記録は入らない）', expected: 4, actual: res.batting.length });
  const rowOf = function (name) { return res.batting.filter(function (r) { return r.displayName === name; })[0]; };
  const ao = rowOf('あおき');
  results.push({ title: '打撃：打席・打数・安打・本塁打・打点・盗塁・打率（.500）', expected: '4/4/2/1/3/1/.500',
    actual: ao ? [ao.plate_appearances, ao.at_bats, ao.hits, ao.home_runs, ao.rbis, ao.stolen_bases, ao.avg.text].join('/') : 'なし' });
  results.push({ title: '打撃：本人の行に「あなた」の印（いとう）', expected: 'いとう', actual: res.batting.filter(function (r) { return r.is_me; }).map(function (r) { return r.displayName; }).join(',') });
  const uc = rowOf('うえだ');
  results.push({ title: '打撃：打数0の人の打率は値が無く「-」', expected: 'null/-', actual: uc ? uc.avg.value + '/' + uc.avg.text : 'なし' });
  results.push({ title: '投手：投げた2人の投球回・自責点', expected: 'あおき:5回1/3:2:16,いとう:1回2/3:0:5',
    actual: res.pitching.map(function (r) { return r.displayName + ':' + r.innings_text + ':' + r.earned_runs + ':' + r.outs; }).sort().join(',') });
  results.push({ title: '1試合1件の決まりは今までどおり（同じ試合への2件目は断られる）', expected: 'VALIDATION_ERROR', actual: codeOf(removed).indexOf('VALIDATION') === 0 ? 'VALIDATION_ERROR' : codeOf(removed) });

  // ---------- 退会した人は「退会したメンバー」 ----------
  act('leaveTeam', { team_id: team.team_id }, c);
  act('leaveTeam', { team_id: team.team_id }, d);
  const after = act('getGameDetail', { game_id: g.game_id }, a);
  const leftRows = after.batting.filter(function (r) { return r.left; });
  results.push({ title: '退会した人の行も出る（2人とも、それぞれ1行で「退会したメンバー」）', expected: '4/退会したメンバー,退会したメンバー',
    actual: after.batting.length + '/' + leftRows.map(function (r) { return r.displayName; }).join(',') });
  results.push({ title: '退会した人の数字はそのまま（安打4と0）', expected: '0,4', actual: leftRows.map(function (r) { return r.hits; }).sort().join(',') });
  results.push({ title: '退会した人の名前（うえだ・えのもと）は返さない', expected: false, actual: /うえだ|えのもと/.test(JSON.stringify(after)) });
  results.push({ title: '他人のLINEユーザーIDは返さない', expected: false, actual: [b, c, d].some(function (u) { return JSON.stringify(after).indexOf(u.userId) !== -1; }) });

  // ---------- 見られる人 ----------
  results.push({ title: '退会した人は見られない', expected: 'FORBIDDEN', actual: codeOf(act('getGameDetail', { game_id: g.game_id }, c)) });
  results.push({ title: '大会だけに参加している人（チームのメンバーではない）は見られない', expected: 'FORBIDDEN', actual: codeOf(act('getGameDetail', { game_id: g.game_id }, x)) });
  results.push({ title: '管理者でも、メンバーでなければ見られない', expected: 'FORBIDDEN', actual: codeOf(act('getGameDetail', { game_id: g.game_id }, x, true)) });
  results.push({ title: '存在しない試合は断る', expected: 'FORBIDDEN', actual: codeOf(act('getGameDetail', { game_id: 'no-such-game' }, a)) });
  results.push({ title: 'game_id が無ければ断る', expected: 'FORBIDDEN', actual: codeOf(act('getGameDetail', {}, a)) });
  const empty = createTestGame_(a, team.team_id, '2026-11-03', T);
  act('deleteGame', { game_id: empty.game_id }, a);
  results.push({ title: '消した試合は断る（存在しない試合と同じ返事）', expected: 'FORBIDDEN', actual: codeOf(act('getGameDetail', { game_id: empty.game_id }, a)) });
  const none = act('getGameDetail', { game_id: other.game_id }, a);
  results.push({ title: '投手の記録が無い試合は、投手の表が空', expected: '1/0', actual: none.batting.length + '/' + none.pitching.length });

  // ---------- 個人用の記録 ----------
  const solo = act('startSolo', {}, a).team;
  const sg = act('createGame', { team_id: solo.teamId, game_date: '2026-11-04' }, a).game;
  bat(a, sg, [3, 3, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  const mine = act('getGameDetail', { game_id: sg.game_id }, a);
  results.push({ title: '個人用の記録の試合：本人は見られる（チーム名は「個人用の記録」）', expected: '個人用の記録/solo/1', actual: mine.game.team_name + '/' + mine.game.org_type + '/' + mine.batting.length });
  results.push({ title: '個人用の記録の試合：ほかの人は見られない', expected: 'FORBIDDEN', actual: codeOf(act('getGameDetail', { game_id: sg.game_id }, b)) });

  // ---------- まとめて送れる ----------
  const batched = act('batch', { requests: [{ action: 'getGameDetail', data: { game_id: g.game_id } }, { action: 'listMyTeams' }] }, a);
  results.push({ title: 'まとめて送る（batch）にも入れられる', expected: 'true/true', actual: batched.results.map(function (r) { return r.ok; }).join('/') });
}
