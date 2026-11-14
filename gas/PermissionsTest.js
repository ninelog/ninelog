/**
 * B-18（権限チェックのまとめ）のテスト
 *
 * すべての操作で、所属していないチーム・大会や、他人の記録・試合に触れられないことを、まとめて確かめる。
 * - 他人のチームID・記録ID・試合ID、存在しないID を指定したら、断られること（ほとんどは FORBIDDEN）
 * - 管理者でも、他人の記録には触れられないこと
 * - 見るだけの操作の返事に、他人のLINEユーザーIDが入っていないこと
 * - Main.js の操作の一覧に新しい操作が足されたら、このテストにも足すよう知らせること
 *
 * 使い方：GASの編集画面で testPermissions を選んで「実行」。
 * 仮の人（Utest…）と自動テスト専用の番号（999999900〜）のチーム・大会だけを使い、最後に消す。
 */
function testPermissions() {
  const realBefore = countRealRows_();
  cleanupTestData_();
  const results = [];
  try {
    testPermissionsScenario_(results);
  } finally {
    cleanupTestData_();
  }
  results.push({ title: '本物の行（チーム・打撃・投手・変更の記録）の数が、テストの前後で変わらない', expected: realBefore, actual: countRealRows_() });
  logResults_(results);
}

/**
 * このテストで確かめた操作の一覧。Main.js の getActions_ に操作を足したら、
 * 権限の確かめ方をこのテストに足してから、ここにも名前を足す。
 */
function permissionCheckedActions_() {
  return [
    'whoami', 'updateMyName', 'createTeam', 'listMyTeams', 'joinTeam', 'changePassphrase', 'startSolo', 'leaveTeam',
    'addBattingRecord', 'listMyBattingRecords', 'updateBattingRecord', 'deleteBattingRecord',
    'addPitchingRecord', 'listMyPitchingRecords', 'updatePitchingRecord', 'deletePitchingRecord',
    'getMyStats', 'getTeamRanking', 'getTournamentRanking', 'getTeamStats', 'getCalendar',
    'createGame', 'listTeamGames', 'updateGame', 'deleteGame',
  ];
}

function testPermissionsScenario_(results) {
  const a = { userId: 'Utest_pma', name: 'あおき' };    // チームXの代表者
  const m = { userId: 'Utest_pmm', name: 'まつい' };    // チームXのメンバー（代表者ではない）
  const o = { userId: 'Utest_pmo', name: 'おかだ' };    // チームYの代表者・大会TYの代表者（m とは別のチーム）
  createTestTeam_(a, '999999931', '権限X', 'ないんろぐ99');
  createTestTeam_(o, '999999932', '権限Y', 'ないんろぐ99');
  createTestTeam_(o, '999999933', '権限大会Y', 'たいかい99', 'tournament');
  createTestTeam_(a, '999999934', '権限大会X', 'たいかい99', 'tournament');
  const teamX = findTeamByNumber_('999999931');
  const teamY = findTeamByNumber_('999999932');
  const tourY = findTeamByNumber_('999999933');
  const tourX = findTeamByNumber_('999999934');
  joinTestTeam_(m, '999999931', 'ないんろぐ99');
  joinTestTeam_(m, '999999934', 'たいかい99');

  const T = '2026-11-10';
  const gx = createTestGame_(a, teamX.team_id, '2026-11-01', T);  // チームXの試合（作ったのは a）
  const gx2 = createTestGame_(a, teamX.team_id, '2026-11-02', T); // 付け替えの確かめ用
  const gy = createTestGame_(o, teamY.team_id, '2026-11-01', T);  // チームYの試合

  const keys = battingCountFields_();
  const batData = function (game) {
    const data = { game_id: game.game_id };
    keys.forEach(function (k) { data[k] = 0; });
    data.plate_appearances = 1; data.at_bats = 1;
    return data;
  };
  const pitData = function (game) { return { game_id: game.game_id, innings: 1, partial_outs: 0, earned_runs: 0 }; };

  // 操作を、画面からと同じ担当の関数・順番待ちの決まりで呼ぶ（今日は T に決め打ち）
  const act = function (name, data, user, isAdmin) {
    const action = getActions_()[name];
    return callAsTest_(action.handler, data, Object.assign({}, user, { isAdmin: Boolean(isAdmin) }), { today: T }, action.write ? undefined : false);
  };
  const codeOf = function (res) {
    if (res && res.code === APP_ERROR.VALIDATION_ERROR) return res.code + ':' + ((res.details || [])[0] || {}).field;
    return res && res.code ? res.code : 'OK';
  };
  const expectRefused = function (title, expected, res) {
    results.push({ title: title, expected: expected, actual: codeOf(res) });
  };

  const recA = act('addBattingRecord', batData(gx), a).record;
  const recM = act('addBattingRecord', batData(gx), m).record;
  const recO = act('addBattingRecord', batData(gy), o).record;
  const pitA = act('addPitchingRecord', pitData(gx), a).record;
  const pitO = act('addPitchingRecord', pitData(gy), o).record;

  // ---------- チーム・大会の合言葉 ----------
  expectRefused('合言葉の変更：メンバーは、自分のチームでも変えられない', 'FORBIDDEN', act('changePassphrase', { team_id: teamX.team_id, passphrase: 'あたらしい99' }, m));
  expectRefused('合言葉の変更：所属していないチーム', 'FORBIDDEN', act('changePassphrase', { team_id: teamY.team_id, passphrase: 'あたらしい99' }, m));
  expectRefused('合言葉の変更：参加していない大会', 'FORBIDDEN', act('changePassphrase', { team_id: tourY.team_id, passphrase: 'あたらしい99' }, m));
  expectRefused('合言葉の変更：存在しないID', 'FORBIDDEN', act('changePassphrase', { team_id: 'no-such-team', passphrase: 'あたらしい99' }, m));
  expectRefused('合言葉の変更：管理者でも、代表者でなければ変えられない', 'FORBIDDEN', act('changePassphrase', { team_id: teamY.team_id, passphrase: 'あたらしい99' }, m, true));

  // ---------- 成績の入力（他のチームの試合） ----------
  expectRefused('打撃の入力：所属していないチームの試合', 'FORBIDDEN', act('addBattingRecord', batData(gy), m));
  expectRefused('投手の入力：所属していないチームの試合', 'FORBIDDEN', act('addPitchingRecord', pitData(gy), m));
  expectRefused('打撃の入力：存在しない試合', 'VALIDATION_ERROR:game_id', act('addBattingRecord', batData({ game_id: 'no-such-game' }), m));
  expectRefused('打撃の入力：管理者でも、所属していないチームの試合には入れられない', 'FORBIDDEN', act('addBattingRecord', batData(gy), m, true));

  // ---------- 成績の修正・削除（他人の記録） ----------
  expectRefused('打撃の修正：同じチームの他人の記録', 'FORBIDDEN', act('updateBattingRecord', Object.assign({ record_id: recA.record_id }, batData(gx)), m));
  expectRefused('打撃の修正：別のチームの他人の記録', 'FORBIDDEN', act('updateBattingRecord', Object.assign({ record_id: recO.record_id }, batData(gy)), m));
  expectRefused('打撃の修正：管理者でも他人の記録は直せない', 'FORBIDDEN', act('updateBattingRecord', Object.assign({ record_id: recO.record_id }, batData(gy)), m, true));
  expectRefused('打撃の修正：存在しない記録', 'FORBIDDEN', act('updateBattingRecord', Object.assign({ record_id: 'no-such-record' }, batData(gx)), m));
  expectRefused('打撃の修正：自分の記録を、所属していないチームの試合に付け替えられない', 'FORBIDDEN', act('updateBattingRecord', Object.assign({ record_id: recM.record_id }, batData(gy)), m));
  expectRefused('打撃の削除：同じチームの他人の記録', 'FORBIDDEN', act('deleteBattingRecord', { record_id: recA.record_id }, m));
  expectRefused('打撃の削除：管理者でも他人の記録は消せない', 'FORBIDDEN', act('deleteBattingRecord', { record_id: recO.record_id }, m, true));
  expectRefused('投手の修正：他人の記録', 'FORBIDDEN', act('updatePitchingRecord', Object.assign({ record_id: pitA.record_id }, pitData(gx)), m));
  expectRefused('投手の修正：管理者でも他人の記録は直せない', 'FORBIDDEN', act('updatePitchingRecord', Object.assign({ record_id: pitO.record_id }, pitData(gy)), m, true));
  expectRefused('投手の削除：他人の記録', 'FORBIDDEN', act('deletePitchingRecord', { record_id: pitO.record_id }, m));
  // 断られたあとも、他人の記録は変わっていない
  const recAAfter = findRecord_(CONFIG.SHEET.BATTING, function (r) { return r.record_id === recA.record_id; });
  results.push({ title: '断られたあとも、他人の記録は消えていない', expected: '', actual: String(recAAfter.deleted_at || '') });
  // 自分の記録なら、同じチームの別の試合に付け替えられる（断る決まりが効きすぎていないこと）
  expectRefused('自分の記録は、自分のチームの別の試合に付け替えられる', 'OK', act('updateBattingRecord', Object.assign({ record_id: recM.record_id }, batData(gx2)), m));

  // ---------- 成績の一覧（自分の記録だけ） ----------
  const listY = act('listMyBattingRecords', { team_id: teamY.team_id }, m);
  results.push({ title: '打撃の一覧：別のチームを指定しても、他人の記録は出ない', expected: 0, actual: listY.records.length });
  const listX = act('listMyBattingRecords', { team_id: teamX.team_id }, m);
  results.push({ title: '打撃の一覧：同じチームでも、自分の記録だけ', expected: recM.record_id, actual: listX.records.map(function (r) { return r.record_id; }).join(',') });
  const pitList = act('listMyPitchingRecords', {}, m);
  results.push({ title: '投手の一覧：他人の記録は出ない', expected: 0, actual: pitList.records.length });

  // ---------- 試合 ----------
  expectRefused('試合の作成：所属していないチーム', 'FORBIDDEN', act('createGame', { team_id: teamY.team_id, game_date: '2026-11-03' }, m));
  expectRefused('試合の作成：大会のIDには作れない', 'FORBIDDEN', act('createGame', { team_id: tourX.team_id, game_date: '2026-11-03' }, m));
  expectRefused('試合の作成：参加していない大会は付けられない', 'VALIDATION_ERROR:tournament_id', act('createGame', { team_id: teamX.team_id, tournament_id: tourY.team_id, game_date: '2026-11-03' }, m));
  expectRefused('試合の一覧：所属していないチーム', 'FORBIDDEN', act('listTeamGames', { team_id: teamY.team_id }, m));
  expectRefused('試合の一覧：存在しないチーム', 'FORBIDDEN', act('listTeamGames', { team_id: 'no-such-team' }, m));
  expectRefused('試合の修正：作った人でも代表者でもないメンバー', 'FORBIDDEN', act('updateGame', { game_id: gx.game_id, game_date: '2026-11-01', game_number: 1 }, m));
  expectRefused('試合の修正：所属していないチームの試合', 'FORBIDDEN', act('updateGame', { game_id: gy.game_id, game_date: '2026-11-01', game_number: 1 }, m));
  expectRefused('試合の修正：管理者でも、作った人・代表者でなければ直せない', 'FORBIDDEN', act('updateGame', { game_id: gy.game_id, game_date: '2026-11-01', game_number: 1 }, m, true));
  expectRefused('試合の削除：作った人でも代表者でもないメンバー', 'FORBIDDEN', act('deleteGame', { game_id: gx2.game_id }, m));
  expectRefused('試合の削除：所属していないチームの試合', 'FORBIDDEN', act('deleteGame', { game_id: gy.game_id }, m));

  // ---------- 見るだけの操作（所属していないチーム・大会） ----------
  expectRefused('自分の成績：所属していないチーム', 'FORBIDDEN', act('getMyStats', { team_id: teamY.team_id }, m));
  expectRefused('自分の成績：参加していない大会', 'FORBIDDEN', act('getMyStats', { tournament_id: tourY.team_id }, m));
  expectRefused('チームのランキング：所属していないチーム', 'FORBIDDEN', act('getTeamRanking', { team_id: teamY.team_id }, m));
  expectRefused('チームのランキング：存在しないチーム', 'FORBIDDEN', act('getTeamRanking', { team_id: 'no-such-team' }, m));
  expectRefused('大会のランキング：参加していない大会', 'FORBIDDEN', act('getTournamentRanking', { tournament_id: tourY.team_id }, m));
  expectRefused('チーム全体の成績：所属していないチーム', 'FORBIDDEN', act('getTeamStats', { team_id: teamY.team_id }, m));
  expectRefused('カレンダー：所属していないチーム', 'FORBIDDEN', act('getCalendar', { team_id: teamY.team_id }, m));
  expectRefused('チームのランキング：管理者でも所属していないチームは見られない', 'FORBIDDEN', act('getTeamRanking', { team_id: teamY.team_id }, m, true));

  // ---------- ひとりの記録（B-19）：他人のひとりの記録には触れられない ----------
  const soloA = act('startSolo', {}, a).team;
  const soloM = act('startSolo', {}, m).team;
  results.push({ title: 'ひとりの記録：作る操作は、本人の記録場所だけを返す', expected: true, actual: soloA.teamId !== soloM.teamId });
  expectRefused('ひとりの記録：他人の記録場所に試合を作れない', 'FORBIDDEN', act('createGame', { team_id: soloA.teamId, game_date: '2026-11-03' }, m));
  expectRefused('ひとりの記録：他人の記録場所の試合の一覧は見られない', 'FORBIDDEN', act('listTeamGames', { team_id: soloA.teamId }, m));
  expectRefused('ひとりの記録：他人の記録場所を自分の成績の範囲にできない', 'FORBIDDEN', act('getMyStats', { team_id: soloA.teamId }, m));
  expectRefused('ひとりの記録：他人の記録場所のカレンダーは見られない', 'FORBIDDEN', act('getCalendar', { team_id: soloA.teamId }, m));
  expectRefused('ひとりの記録：管理者でも、他人の記録場所に試合を作れない', 'FORBIDDEN', act('createGame', { team_id: soloA.teamId, game_date: '2026-11-03' }, m, true));
  expectRefused('ひとりの記録：自分の記録場所でも、ランキングには使えない', 'FORBIDDEN', act('getTeamRanking', { team_id: soloM.teamId }, m));

  // ---------- 退会（B-20） ----------
  expectRefused('退会：所属していないチームからは退会できない', 'FORBIDDEN', act('leaveTeam', { team_id: teamY.team_id }, m));
  expectRefused('退会：参加していない大会からは退会できない', 'FORBIDDEN', act('leaveTeam', { team_id: tourY.team_id }, m));
  expectRefused('退会：他人のひとりの記録には触れられない', 'FORBIDDEN', act('leaveTeam', { team_id: soloA.teamId }, m));
  expectRefused('退会：代表者は退会できない', 'FORBIDDEN', act('leaveTeam', { team_id: teamX.team_id }, a));
  expectRefused('退会：管理者でも、所属していないチームからは退会できない', 'FORBIDDEN', act('leaveTeam', { team_id: teamY.team_id }, m, true));

  // ---------- 返事に他人のLINEユーザーIDが入っていない ----------
  const reads = {
    whoami: act('whoami', {}, m),
    listMyTeams: act('listMyTeams', {}, m),
    listTeamGames: act('listTeamGames', { team_id: teamX.team_id }, m),
    listMyBattingRecords: listX,
    getMyStats: act('getMyStats', { season: 'all' }, m),
    getTeamRanking: act('getTeamRanking', { team_id: teamX.team_id }, m),
    getTournamentRanking: act('getTournamentRanking', { tournament_id: tourX.team_id }, m),
    getTeamStats: act('getTeamStats', { team_id: teamX.team_id }, m),
    getCalendar: act('getCalendar', { month: '2026-11' }, m),
  };
  Object.keys(reads).forEach(function (name) {
    const text = JSON.stringify(reads[name]);
    const leaked = [a.userId, o.userId].filter(function (id) { return text.indexOf(id) !== -1; });
    results.push({ title: name + '：返事に他人のLINEユーザーIDが入っていない（エラーでもない）', expected: 'OK/なし', actual: codeOf(reads[name]) + '/' + (leaked.join(',') || 'なし') });
  });
  // ランキングとチーム成績の返事に、合言葉のハッシュや塩が入っていない
  const team = findRecord_(CONFIG.SHEET.TEAMS, function (t) { return t.team_id === teamX.team_id; });
  const allText = JSON.stringify(reads);
  results.push({ title: '返事に合言葉のハッシュ・塩が入っていない', expected: false, actual: allText.indexOf(String(team.passphrase_hash)) !== -1 || allText.indexOf(String(team.passphrase_salt)) !== -1 });

  // ---------- 操作の一覧と、このテストの一覧がそろっている ----------
  const checked = permissionCheckedActions_();
  const missing = Object.keys(getActions_()).filter(function (name) { return checked.indexOf(name) === -1; });
  results.push({ title: 'すべての操作の権限を確かめている（足りない操作があれば名前が出る）', expected: '', actual: missing.join(',') });
}
