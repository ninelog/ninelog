/**
 * B-21（チーム・大会を消す／個人用の記録の成績をチームに移す）のテスト
 *
 * 使い方：GASの編集画面で testDelete を選んで「実行」。
 * 仮の人（Utest…）と自動テスト専用の番号（999999900〜）のチーム・大会だけを使い、最初と最後に消す。
 */
function testDelete() {
  const realBefore = countRealRows_();
  cleanupTestData_();
  const results = [];
  try {
    testDeleteScenario_(results);
  } finally {
    cleanupTestData_();
  }
  results.push({ title: '本物の行（チーム・試合・打撃・投手・変更の記録）の数が、テストの前後で変わらない', expected: realBefore, actual: countRealRows_() });
  logResults_(results);
}

function testDeleteScenario_(results) {
  const o = { userId: 'Utest_dlo', name: 'おおた' };   // チームA・大会・チームBの代表者
  const m = { userId: 'Utest_dlm', name: 'みやた' };   // メンバー（個人用の記録あり）
  const x = { userId: 'Utest_dlx', name: 'きむら' };   // メンバー（あとで退会。個人用の記録なし）
  const n = { userId: 'Utest_dln', name: 'なかの' };   // メンバー（個人用の記録なし。30日より前の試合だけ）
  const T = '2026-11-10';
  const act = function (name, data, user, isAdmin) {
    const action = getActions_()[name];
    return callAsTest_(action.handler, data, Object.assign({}, user, { isAdmin: Boolean(isAdmin) }), { today: T }, action.write ? undefined : false);
  };
  const codeOf = function (res) {
    if (res && res.code === APP_ERROR.VALIDATION_ERROR) return res.code + ':' + ((res.details || [])[0] || {}).field;
    return res && res.code ? res.code : 'OK';
  };
  const keys = battingCountFields_();
  const bat = function (user, game, hits) {
    const data = { game_id: game.game_id };
    keys.forEach(function (k) { data[k] = 0; });
    data.plate_appearances = 3; data.at_bats = 3; data.hits = hits;
    return act('addBattingRecord', data, user, false).record;
  };
  const pit = function (user, game) { return act('addPitchingRecord', { game_id: game.game_id, innings: 2, partial_outs: 1, earned_runs: 1 }, user).record; };
  const findBat = function (id) { return findRecord_(CONFIG.SHEET.BATTING, function (r) { return r.record_id === id; }); };
  const findPit = function (id) { return findRecord_(CONFIG.SHEET.PITCHING, function (r) { return r.record_id === id; }); };
  const gameOf = function (id) { return findRecord_(CONFIG.SHEET.GAMES, function (g) { return g.game_id === id; }); };

  createTestTeam_(o, '999999941', '消すテストA', 'ないんろぐ99');
  createTestTeam_(o, '999999942', '消すテスト大会', 'たいかい99', 'tournament');
  const teamA = findTeamByNumber_('999999941');
  const tour = findTeamByNumber_('999999942');
  joinTestTeam_(m, '999999941', 'ないんろぐ99');
  joinTestTeam_(x, '999999941', 'ないんろぐ99');
  joinTestTeam_(n, '999999941', 'ないんろぐ99');
  joinTestTeam_(m, '999999942', 'たいかい99');

  // みやたは、前から個人用の記録を持っていて、11月1日に第1試合がある（番号が重なる場合を確かめる）
  const soloM = act('startSolo', {}, m).team;
  createTestGame_(m, soloM.teamId, '2026-11-01', T);

  const g1 = createTestGame_(o, teamA.team_id, '2026-11-01', T, { tournament_id: tour.team_id, opponent: 'ABCクラブ', category: 'official', result: 'win' });
  const g2 = createTestGame_(o, teamA.team_id, '2026-11-01', T, { opponent: '北クラブ', result: 'lose' });
  const g3 = createTestGame_(o, teamA.team_id, '2026-10-01', '2026-10-01'); // 30日より前の試合
  const ro = bat(o, g1, 1);
  const rm1 = bat(m, g1, 2);
  const pm1 = pit(m, g1);
  const rm2 = bat(m, g2, 1);
  const rx = bat(x, g2, 3);
  // 30日より前の試合の成績は、テスト用に「今日」をその日にして入れる
  const rn = callAsTest_(handleAddBattingRecord_, (function () {
    const d = { game_id: g3.game_id }; keys.forEach(function (k) { d[k] = 0; }); d.plate_appearances = 2; d.at_bats = 2; d.hits = 1; return d;
  })(), n, { today: '2026-10-01' }).record;
  act('leaveTeam', { team_id: teamA.team_id }, x); // きむらは退会（成績は残っている）

  // ---------- 消す前の確認 ----------
  const pv = act('getDeletePreview', { team_id: teamA.team_id }, o);
  results.push({ title: '確認：メンバー3人・試合3・代表者の成績1・ほかの人の成績5（3人）・大会の試合の成績3',
    expected: '3/3/1/5/3/3', actual: [pv.members, pv.games, pv.ownerRecords, pv.otherRecords, pv.otherPeople, pv.tournamentRecords].join('/') });
  results.push({ title: '確認：メンバーは見られない', expected: 'FORBIDDEN', actual: codeOf(act('getDeletePreview', { team_id: teamA.team_id }, m)) });
  results.push({ title: '確認：管理者でも、代表者でなければ見られない', expected: 'FORBIDDEN', actual: codeOf(act('getDeletePreview', { team_id: teamA.team_id }, m, true)) });

  // ---------- 断るとき ----------
  results.push({ title: '消す：メンバーは消せない', expected: 'FORBIDDEN', actual: codeOf(act('deleteTeam', { team_id: teamA.team_id, confirm_name: '消すテストA', owner_records: 'move' }, m)) });
  results.push({ title: '消す：チーム名が違うと消せない', expected: 'VALIDATION_ERROR:confirm_name', actual: codeOf(act('deleteTeam', { team_id: teamA.team_id, confirm_name: '消すテスト', owner_records: 'move' }, o)) });
  results.push({ title: '消す：代表者の成績をどうするか選ばないと消せない', expected: 'VALIDATION_ERROR:owner_records', actual: codeOf(act('deleteTeam', { team_id: teamA.team_id, confirm_name: '消すテストA' }, o)) });
  results.push({ title: '消す：個人用の記録は消せない', expected: 'FORBIDDEN', actual: codeOf(act('deleteTeam', { team_id: soloM.teamId, confirm_name: '個人用の記録' }, m)) });
  results.push({ title: '消す：存在しないIDは断る', expected: 'FORBIDDEN', actual: codeOf(act('deleteTeam', { team_id: 'no-such-team', confirm_name: 'x' }, o)) });
  results.push({ title: '断ったあとも、チームは残っている', expected: true, actual: Boolean(findTeamByNumber_('999999941')) });

  // ---------- チームを消す（代表者の成績は消す） ----------
  const del = act('deleteTeam', { team_id: teamA.team_id, confirm_name: ' 消すテストA ', owner_records: 'delete' }, o);
  results.push({ title: '消す：移した5件・消した1件・個人用の記録を新しく作った2人', expected: '5/1/2', actual: del.movedRecords + '/' + del.deletedRecords + '/' + del.createdSolos });
  results.push({ title: '消したチームは、一覧から消える', expected: false, actual: act('listMyTeams', {}, o).teams.some(function (t) { return t.teamId === teamA.team_id; }) });
  results.push({ title: '代表者の成績は消えている（論理削除）', expected: true, actual: Boolean(findBat(ro.record_id).deleted_at) });
  results.push({ title: '元のチームの試合は消えている（論理削除）', expected: 'true/true/true', actual: [g1, g2, g3].map(function (g) { return Boolean(gameOf(g.game_id).deleted_at); }).join('/') });

  // みやた：打撃2件と投手1件が、本人の個人用の記録に移る。g1 の打撃と投手は同じ写しの試合に入る
  const mSolo = findSoloOf_(m.userId);
  const b1 = findBat(rm1.record_id), p1 = findPit(pm1.record_id), b2 = findBat(rm2.record_id);
  const c1 = gameOf(b1.game_id), c2 = gameOf(b2.game_id);
  results.push({ title: 'みやたの成績は、個人用の記録の試合に移る', expected: 'true/true/true', actual: [c1.team_id === mSolo.team_id, gameOf(p1.game_id).team_id === mSolo.team_id, c2.team_id === mSolo.team_id].join('/') });
  results.push({ title: '同じ試合の打撃と投手は、同じ写しの試合に入る', expected: true, actual: b1.game_id === p1.game_id });
  //   11月1日には、個人用の記録に第1試合がすでにあるので、g1（第1試合）は第2試合、g2（第2試合）は第3試合になる
  results.push({ title: '番号が重なるときは次の番号（第2試合・第3試合）', expected: '2/3', actual: Number(c1.game_number) + '/' + Number(c2.game_number) });
  results.push({ title: '試合の情報（日付・相手・区分・勝敗）を写し、大会の印は外す', expected: '2026-11-01/ABCクラブ/official/win/',
    actual: [dateText_(c1.game_date), c1.opponent, c1.category, c1.result, String(c1.tournament_id || '')].join('/') });
  results.push({ title: '数字は変えない（安打2）', expected: 2, actual: Number(b1.hits) });
  // 退会したきむらと、30日より前の成績だけのなかのにも、個人用の記録が自動でできて、成績が移る
  const xSolo = findSoloOf_(x.userId), nSolo = findSoloOf_(n.userId);
  results.push({ title: '退会した人の成績も、自動で作った個人用の記録に移る', expected: true, actual: Boolean(xSolo) && gameOf(findBat(rx.record_id).game_id).team_id === xSolo.team_id });
  results.push({ title: '30日より前の成績も移る', expected: true, actual: Boolean(nSolo) && gameOf(findBat(rn.record_id).game_id).team_id === nSolo.team_id });
  const mine = act('getMyStats', { season: 'all' }, m);
  results.push({ title: '移したあとも、自分の成績の合計は同じ（打数6・安打3）', expected: '6/3', actual: mine.batting.at_bats + '/' + mine.batting.hits });
  const changes = readRecords_(CONFIG.SHEET.RECORD_CHANGES);
  results.push({ title: '消したことを記録に残す（チーム1行）', expected: 1, actual: changes.filter(function (c) { return c.record_id === teamA.team_id && c.action === 'delete'; }).length });
  results.push({ title: '移したことを記録に残す（game_id の変更が5行）', expected: 5, actual: changes.filter(function (c) {
    return c.field === 'game_id' && [rm1, pm1, rm2, rx, rn].some(function (r) { return r.record_id === c.record_id; });
  }).length });
  results.push({ title: '消したチームの番号は、また使える', expected: 'true', actual: String(Boolean(createTestTeam_(o, '999999941', '番号を使い直す', 'ないんろぐ99').team)) });

  // ---------- 大会を消す ----------
  createTestTeam_(o, '999999943', '消すテストB', 'ないんろぐ99');
  const teamB = findTeamByNumber_('999999943');
  joinTestTeam_(m, '999999943', 'ないんろぐ99');
  const gb = createTestGame_(o, teamB.team_id, '2026-11-05', T, { tournament_id: tour.team_id });
  bat(o, gb, 2);
  const tpv = act('getDeletePreview', { team_id: tour.team_id }, o);
  results.push({ title: '大会の確認：参加者2人・大会の試合1', expected: 'tournament/2/1', actual: tpv.orgType + '/' + tpv.members + '/' + tpv.games });
  results.push({ title: '大会：参加者（代表者でない）は消せない', expected: 'FORBIDDEN', actual: codeOf(act('deleteTeam', { team_id: tour.team_id, confirm_name: '消すテスト大会' }, m)) });
  results.push({ title: '大会：大会名が違うと消せない', expected: 'VALIDATION_ERROR:confirm_name', actual: codeOf(act('deleteTeam', { team_id: tour.team_id, confirm_name: '消すテストA' }, o)) });
  const tdel = act('deleteTeam', { team_id: tour.team_id, confirm_name: '消すテスト大会' }, o);
  results.push({ title: '大会を消すと、試合の大会の印を外す（1試合）', expected: '1/', actual: tdel.untaggedGames + '/' + String(gameOf(gb.game_id).tournament_id || '') });
  results.push({ title: '大会を消しても、成績はチームに残る（安打2）', expected: 2, actual: act('getTeamStats', { team_id: teamB.team_id }, o).batting.hits });
  results.push({ title: '消した大会は、参加者の一覧からも消える', expected: false, actual: act('listMyTeams', {}, m).teams.some(function (t) { return t.teamId === tour.team_id; }) });
  results.push({ title: '消した大会の番号は、また使える', expected: 'true', actual: String(Boolean(createTestTeam_(o, '999999942', '大会を使い直す', 'たいかい99', 'tournament').team)) });

  // ---------- 個人用の記録の成績を、チームに移す ----------
  const gB1 = createTestGame_(o, teamB.team_id, '2026-11-01', T);
  const gB2 = createTestGame_(o, teamB.team_id, '2026-11-01', T);
  const gOld = createTestGame_(o, teamB.team_id, '2026-10-02', '2026-10-02');
  const soloOld = createTestGame_(m, mSolo.team_id, '2026-10-02', '2026-10-02');
  const rOld = callAsTest_(handleAddBattingRecord_, (function () {
    const d = { game_id: soloOld.game_id }; keys.forEach(function (k) { d[k] = 0; }); d.plate_appearances = 1; d.at_bats = 1; return d;
  })(), m, { today: '2026-10-02' }).record;
  const list = act('listSoloMoveTargets', {}, m);
  const item = function (type, id) { return list.records.filter(function (r) { return r.record_type === type && r.record_id === id; })[0]; };
  results.push({ title: '移せる記録の一覧：個人用の記録の成績4件（打撃3・投手1）', expected: 4, actual: list.records.length });
  results.push({ title: '11月1日の記録の移す先は、チームBの同じ日の試合2つ', expected: '1,2', actual: item('batting', rm1.record_id).candidates.map(function (c) { return c.game_number; }).join(',') });
  results.push({ title: 'ほかの日の試合は、移す先に出ない', expected: '1', actual: item('batting', rOld.record_id).candidates.map(function (c) { return c.game_number; }).join(',') });
  const mv = function (moves) { return act('moveSoloRecords', { moves: moves }, m); };
  // チームBの第2試合に、みやたが直接打撃を入れておく → その試合には打撃を移せない（投手は移せる）
  const direct = bat(m, gB2, 0);
  const again = act('listSoloMoveTargets', {}, m);
  const cand = again.records.filter(function (r) { return r.record_id === rm1.record_id; })[0].candidates;
  results.push({ title: '移す先の一覧：自分の打撃がある試合には印（has_my_record）', expected: 'false,true', actual: cand.map(function (c) { return c.has_my_record; }).join(',') });
  results.push({ title: '自分の打撃がすでにある試合には、打撃を移せない', expected: 'VALIDATION_ERROR:moves', actual: codeOf(mv([{ record_type: 'batting', record_id: rm1.record_id, game_id: gB2.game_id }])) });
  act('deleteBattingRecord', { record_id: direct.record_id }, m); // 消せば、また移せる
  // 同じ試合に打撃を2件移そうとしたら、何も移さない
  const bad = mv([
    { record_type: 'batting', record_id: rm1.record_id, game_id: gB1.game_id },
    { record_type: 'batting', record_id: rm2.record_id, game_id: gB1.game_id },
  ]);
  results.push({ title: '同じ試合に同じ種類を2件は移せない（何も移さない）', expected: 'VALIDATION_ERROR:moves/' + mSolo.team_id, actual: codeOf(bad) + '/' + gameOf(findBat(rm1.record_id).game_id).team_id });
  results.push({ title: 'ちがう日のチームの試合には移せない', expected: 'VALIDATION_ERROR:moves', actual: codeOf(mv([{ record_type: 'batting', record_id: rm1.record_id, game_id: gb.game_id }])) });
  results.push({ title: '他人の記録は移せない', expected: 'FORBIDDEN', actual: codeOf(act('moveSoloRecords', { moves: [{ record_type: 'batting', record_id: rm1.record_id, game_id: gB1.game_id }] }, o)) });
  results.push({ title: '所属していないチームの試合には移せない', expected: 'FORBIDDEN', actual: codeOf(act('moveSoloRecords', { moves: [{ record_type: 'batting', record_id: rx.record_id, game_id: gB1.game_id }] }, x)) });
  results.push({ title: '移す記録が空なら断る', expected: 'BAD_REQUEST', actual: codeOf(mv([])) });
  const ok = mv([
    { record_type: 'batting', record_id: rm1.record_id, game_id: gB1.game_id },
    { record_type: 'pitching', record_id: pm1.record_id, game_id: gB1.game_id },
    { record_type: 'batting', record_id: rm2.record_id, game_id: gB2.game_id },
    { record_type: 'batting', record_id: rOld.record_id, game_id: gOld.game_id },
  ]);
  results.push({ title: 'まとめて4件移せる（30日より前の記録も。空になった個人用の記録の試合3つは消す）', expected: '4/3', actual: ok.moved + '/' + ok.deletedSoloGames });
  results.push({ title: '移した記録は、チームBの試合に付く', expected: 'true/true/true/true', actual: [findBat(rm1.record_id).game_id === gB1.game_id, findPit(pm1.record_id).game_id === gB1.game_id,
    findBat(rm2.record_id).game_id === gB2.game_id, findBat(rOld.record_id).game_id === gOld.game_id].join('/') });
  results.push({ title: '移したあと、個人用の記録に移せる成績は残っていない', expected: 0, actual: act('listSoloMoveTargets', {}, m).records.length });
  const rankNames = act('getTeamRanking', { team_id: teamB.team_id, season: 'all' }, o).categories.hits.rows.map(function (r) { return r.displayName; }).join(',');
  results.push({ title: '移した成績は、チームのランキングに入る', expected: true, actual: rankNames.indexOf('みやた') !== -1 });
  results.push({ title: '個人用の記録には、前からあった空の第1試合だけが残る', expected: 1, actual: activeGamesOf_(mSolo.team_id).length });
}
