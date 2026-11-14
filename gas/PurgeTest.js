/**
 * 公開前にテストのデータを消す仕組み（Purge.js）のテスト
 *
 * 使い方：GASの編集画面で testPurge を選んで「実行」。
 * 本物のデータは消さない：
 * - 「何を消すか」は、作り物の表で確かめる（シートには触れない）。
 * - runPurge が止まる場面（確かめの番号が無い・違う）だけを本物のGASで試す（どちらも何も消す前に止まる）。
 * - 実際に消す部品（applyPurgePlan_）は、仮の人（Utest…）と自動テスト専用の番号の行だけに絞って試す。
 * - 控えのシートは作らない（名前の決め方だけを確かめる）。
 */
function testPurge() {
  const realBefore = countRealRows_();
  cleanupTestData_();
  const results = [];
  const props = PropertiesService.getScriptProperties();
  const saved = {};
  ['PURGE_CONFIRM', 'PURGE_DELETE_TEAM_NUMBERS'].forEach(function (k) { saved[k] = props.getProperty(k); });
  try {
    testPurgePlanScenario_(results);
    testPurgeStopScenario_(results, props);
    testPurgeApplyScenario_(results);
  } finally {
    Object.keys(saved).forEach(function (k) {
      if (saved[k] === null) props.deleteProperty(k); else props.setProperty(k, saved[k]);
    });
    cleanupTestData_();
  }
  results.push({ title: '本物の行（チーム・試合・打撃・投手・変更の記録）の数が、テストの前後で変わらない', expected: realBefore, actual: countRealRows_() });
  logResults_(results);
}

/** 作り物の表で、何を消して何を残すかを確かめる */
function testPurgePlanScenario_(results) {
  let row = 2;
  const r = function (obj) { obj._row = row++; return obj; };
  const T = CONFIG.SHEET;
  const tables = {};
  tables[T.USERS] = [r({ user_id: 'Ua' }), r({ user_id: 'Ub' })];
  tables[T.TEAMS] = [
    r({ team_id: 'solo1', team_number: '', team_name: '個人用の記録', org_type: 'solo' }),
    r({ team_id: 'res5', team_number: '5', team_name: '管理者テスト', org_type: 'team' }),
    r({ team_id: 'res1998', team_number: '1998', team_name: 'テスト大会', org_type: 'tournament' }),
    r({ team_id: 'real2001', team_number: '2001', team_name: '本物ナイン', org_type: 'team' }),
    r({ team_id: 'real2002', team_number: '2002', team_name: 'D-3のテスト', org_type: 'team' }),
    r({ team_id: 'auto', team_number: '999999990', team_name: '自動テスト', org_type: 'team' }),
  ];
  tables[T.MEMBERSHIPS] = [
    r({ user_id: 'Ua', team_id: 'solo1' }), r({ user_id: 'Ua', team_id: 'res5' }), r({ user_id: 'Ua', team_id: 'real2001' }),
    r({ user_id: 'Ub', team_id: 'real2001' }), r({ user_id: 'Ub', team_id: 'real2002' }), r({ user_id: 'Ub', team_id: 'gone' }),
  ];
  tables[T.GAMES] = [r({ game_id: 'g1', team_id: 'real2001' }), r({ game_id: 'g2', team_id: 'res5' })];
  tables[T.BATTING] = [r({ record_id: 'b1' }), r({ record_id: 'b2' })];
  tables[T.PITCHING] = [r({ record_id: 'p1' })];
  tables[T.RECORD_CHANGES] = [r({ change_id: 'c1' })];
  tables[T.JOIN_ATTEMPTS] = [r({ user_id: 'Ua' })];

  const plan = purgePlan_(tables, ['２００２']); // 全角のまま渡したとき（ふだんは purgeDeleteNumbers_ が半角にしてから渡す）
  const plan2 = purgePlan_(tables, ['2002']);
  const ids = function (list, key) { return list.map(function (x) { return x[key]; }).sort().join(','); };
  results.push({ title: '消すチーム：個人用の記録・予約番号（チームも大会も）・自動テスト専用・消すと決めた本物の番号', expected: 'auto,real2002,res1998,res5,solo1', actual: ids(plan2.rows[T.TEAMS], 'team_id') });
  results.push({ title: '残すチーム：消すと決めていない本物の番号だけ', expected: 'real2001', actual: plan2.teamsKept.map(function (d) { return d.record.team_id; }).join(',') });
  results.push({ title: '参加：消すチームの参加と、チームの無い参加を消し、残すチームの参加は残す', expected: 'gone,real2002,res5,solo1',
    actual: ids(plan2.rows[T.MEMBERSHIPS], 'team_id') });
  results.push({ title: '試合・打撃・投手・変更の記録・間違い回数：すべて消す', expected: '2/2/1/1/1',
    actual: [T.GAMES, T.BATTING, T.PITCHING, T.RECORD_CHANGES, T.JOIN_ATTEMPTS].map(function (n) { return plan2.rows[n].length; }).join('/') });
  results.push({ title: '利用者の登録（users）は消さない', expected: 0, actual: plan2.rows[T.USERS].length });
  results.push({ title: '全角で書いた番号はそのままでは見つからない（読むときに半角にする）', expected: '２００２', actual: plan.unknownNumbers.join(',') });
  results.push({ title: '全角の数字を半角にする', expected: '2002', actual: toHalfWidthDigits_('２００２') });
  results.push({ title: '見つからない番号を書くと、知らせる', expected: '7777', actual: purgePlan_(tables, ['2002', '7777']).unknownNumbers.join(',') });
  results.push({ title: '何も書かなければ、本物の番号のチームはすべて残す', expected: 'real2001,real2002',
    actual: purgePlan_(tables, []).teamsKept.map(function (d) { return d.record.team_id; }).sort().join(',') });

  // 確かめの番号
  const c1 = purgeConfirmCode_(plan2, 'v1');
  results.push({ title: '確かめの番号：同じ中身なら同じ番号（8文字）', expected: c1 + '/8', actual: purgeConfirmCode_(purgePlan_(tables, ['2002']), 'v1') + '/' + c1.length });
  results.push({ title: '確かめの番号：データの版が変わると別の番号', expected: false, actual: c1 === purgeConfirmCode_(plan2, 'v2') });
  results.push({ title: '確かめの番号：消す行が変わると別の番号', expected: false, actual: c1 === purgeConfirmCode_(purgePlan_(tables, []), 'v1') });

  // 件数の表
  const lines = purgeSummaryLines_(tables, plan2).join('\n');
  results.push({ title: '件数の表に、シートごとの今の行数・消す・残すが出る', expected: true, actual: lines.indexOf('| games | 2 | 2 | 0 |') !== -1 && lines.indexOf('| users | 2 | 0 | 2 |') !== -1 });
  results.push({ title: '件数の表に、消すチームの理由と、残すチームが出る', expected: true,
    actual: lines.indexOf('ID 5　チーム「管理者テスト」　メンバー 1人　（テスト用のID（1〜1998））') !== -1 && lines.indexOf('ID 2001　チーム「本物ナイン」　メンバー 2人') !== -1 });

  // IDが英字・数字になってからの見分け方（2026-11-15）
  const idTables = {};
  idTables[T.TEAMS] = [
    r({ team_id: 'z1', team_number: '0123', team_name: '先頭0', org_type: 'team' }),
    r({ team_id: 'z2', team_number: 'team2', team_name: '英字', org_type: 'team' }),
    r({ team_id: 'z3', team_number: 'nostradamus', team_name: '本物', org_type: 'team' }),
  ];
  const idPlan = purgePlan_(idTables, [normalizeTeamId_('ＴＥＡＭ２')]);
  results.push({ title: 'ID：先頭0の「0123」はテスト用ではないので残し、消すと決めたID（全角・大文字で書いても）は消す', expected: 'z2/z1,z3',
    actual: ids(idPlan.rows[T.TEAMS], 'team_id') + '/' + idPlan.teamsKept.map(function (d) { return d.record.team_id; }).sort().join(',') });

  // 控えの名前
  results.push({ title: '控えのシートの名前', expected: '控え_games_20261120_2130', actual: purgeBackupName_('games', new Date(Date.UTC(2026, 10, 20, 12, 30))) });
}

/** runPurge は、確かめの番号が無い・違うとき、何も消さずに止まる */
function testPurgeStopScenario_(results, props) {
  const before = purgeRowCounts_();
  props.deleteProperty('PURGE_CONFIRM');
  props.deleteProperty('PURGE_DELETE_TEAM_NUMBERS');
  const r1 = runPurgeCore_();
  results.push({ title: '確かめの番号が無いと、止まる', expected: 'false/NO_CONFIRM', actual: r1.done + '/' + r1.stopped });
  props.setProperty('PURGE_CONFIRM', 'ZZZZZZZZ'); // 16進の番号には出てこない文字なので、必ず違う
  const r2 = runPurgeCore_();
  results.push({ title: '確かめの番号が違うと、止まる', expected: 'false/MISMATCH', actual: r2.done + '/' + r2.stopped });
  props.deleteProperty('PURGE_CONFIRM');
  results.push({ title: '止まったときは、どのシートの行も減っていない', expected: before, actual: purgeRowCounts_() });
}

function purgeRowCounts_() {
  forgetSheets_();
  return purgeBackupSheets_().map(function (n) { return readRecords_(n).length; }).join('/');
}

/** 実際に消す部品を、仮の人と自動テスト専用の番号の行だけに絞って試す */
function testPurgeApplyScenario_(results) {
  const a = { userId: 'Utest_pga', name: 'ぱーじ' };
  const T0 = todayText_();
  createTestTeam_(a, '999999972', '消すテスト', 'ないんろぐ99');
  const team = findTeamByNumber_('999999972');
  const g = createTestGame_(a, team.team_id, T0, T0);
  const data = { game_id: g.game_id };
  battingCountFields_().forEach(function (k) { data[k] = 0; });
  data.plate_appearances = 2; data.at_bats = 2; data.hits = 1;
  callAsTest_(handleAddBattingRecord_, data, a, { today: T0 });
  callAsTest_(handleStartSolo_, {}, a, { today: T0 });

  const T = CONFIG.SHEET;
  const onlyTest = function (name, r) {
    if (name === T.TEAMS) return isTestTeamRow_(r);
    if (name === T.GAMES) return isTestUserId_(r.created_by);
    return isTestUserId_(r.user_id);
  };
  const realBefore = countRealRows_();
  const counts = withLock_(function () {
    const tables = purgeReadTables_();
    const plan = purgePlan_(tables, [], onlyTest);
    applyPurgePlan_(plan);
    return {
      teams: plan.rows[T.TEAMS].length,
      memberships: plan.rows[T.MEMBERSHIPS].length,
      games: plan.rows[T.GAMES].length,
      batting: plan.rows[T.BATTING].length,
    };
  });
  results.push({ title: '仮の人の行だけに絞って消すと、テストのチームと個人用の記録・参加・試合・打撃が対象になる', expected: '2/2/1/1',
    actual: [counts.teams, counts.memberships, counts.games, counts.batting].join('/') });
  forgetSheets_();
  results.push({ title: '消したあと、テストのチームは残っていない', expected: null, actual: findTeamByNumber_('999999972') });
  results.push({ title: '消したあと、仮の人の打撃成績は残っていない', expected: 0,
    actual: readRecords_(T.BATTING).filter(function (r) { return r.user_id === a.userId; }).length });
  results.push({ title: '消したあとも、仮の人の登録（users）は残る', expected: 1,
    actual: readRecords_(T.USERS).filter(function (r) { return r.user_id === a.userId; }).length });
  results.push({ title: '本物の行は減っていない', expected: realBefore, actual: countRealRows_() });
}
