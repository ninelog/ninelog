/**
 * B-24（読み込みを速くする案B：GASの中にシートの中身を覚えて、ほかの要求でも使い回す）のテスト
 *
 * 使い方：GASの編集画面で testSheetCache を選んで「実行」。
 * 仮の人（Utest…）と自動テスト専用の番号（999999900〜）のチームだけを使い、最初と最後に消す。
 * 「別の要求」は、1回の処理の間だけ覚えた内容を捨てる（forgetSheets_）ことでまねる。
 * シートを何回読んだかは、時間の内訳を測る部品（Diagnostics.js の profile_）で数える。
 */
function testSheetCache() {
  const realBefore = countRealRows_();
  cleanupTestData_();
  const results = [];
  const savedProfile = profile_;
  try {
    testSheetCacheScenario_(results);
    testSheetCacheChunkScenario_(results);
  } finally {
    profile_ = savedProfile;
    cleanupTestData_();
  }
  results.push({ title: '本物の行（チーム・試合・打撃・投手・変更の記録）の数が、テストの前後で変わらない', expected: realBefore, actual: countRealRows_() });
  logResults_(results);
}

/** 別の要求として、fn を実行する。シートを読んだ回数（read）と、返した値を返す */
function asNewRequest_(fn) {
  forgetSheets_(); // 1回の処理の間だけ覚えた内容と、データの版を捨てる（次の要求と同じ状態）
  profile_ = {};
  const value = fn();
  const reads = profile_.read ? profile_.read.count : 0;
  profile_ = null;
  return { value: value, reads: reads };
}

function testSheetCacheScenario_(results) {
  const a = { userId: 'Utest_sca', name: 'さかい' };
  const T = todayText_();
  const props = PropertiesService.getScriptProperties();
  const stats = function () { return callAsTest_(handleGetMyStats_, { season: 'all' }, a, { today: T }, false); };
  const hitsOf = function (s) { return s && s.batting ? s.batting.hits : '記録なし'; };

  createTestTeam_(a, '999999971', 'キャッシュテスト', 'ないんろぐ99');
  const team = findTeamByNumber_('999999971');
  const g = createTestGame_(a, team.team_id, T, T);
  const data = { game_id: g.game_id };
  battingCountFields_().forEach(function (k) { data[k] = 0; });
  data.plate_appearances = 4; data.at_bats = 4; data.hits = 1;

  // 書き込むと、データの版が変わる
  const v0 = props.getProperty('DATA_VERSION');
  const added = callAsTest_(handleAddBattingRecord_, data, a, { today: T });
  const v1 = props.getProperty('DATA_VERSION');
  results.push({ title: '保存すると、データの版が新しくなる', expected: true, actual: Boolean(v1) && v1 !== v0 });

  // 1回目は読み、2回目は覚えた中身を使う（シートを読まない）
  const first = asNewRequest_(stats);
  const second = asNewRequest_(stats);
  results.push({ title: '保存のあと最初の「自分の成績」は、シートを読む（安打1）', expected: '1/true', actual: hitsOf(first.value) + '/' + (first.reads > 0) });
  results.push({ title: '2回目の「自分の成績」は、覚えた中身を使い、シートを1回も読まない（安打1）', expected: '1/0', actual: hitsOf(second.value) + '/' + second.reads });
  results.push({ title: '見るだけの操作では、データの版は変わらない', expected: v1, actual: props.getProperty('DATA_VERSION') });

  // 覚えた中身でも、日時は日時のまま
  const fromCache = asNewRequest_(function () { return findRecord_(CONFIG.SHEET.BATTING, function (r) { return r.record_id === added.record.record_id; }); });
  results.push({ title: '覚えた中身でも、登録日時は日時のまま（文字にならない）', expected: '0/[object Date]', actual: fromCache.reads + '/' + Object.prototype.toString.call(fromCache.value.created_at) });

  // 直す → すぐ新しい数字
  data.record_id = added.record.record_id;
  data.hits = 3;
  callAsTest_(handleUpdateBattingRecord_, data, a, { today: T });
  const afterUpdate = asNewRequest_(stats);
  results.push({ title: '直したあとは、覚えた中身を使わず、すぐ新しい数字（安打3）', expected: '3/true', actual: hitsOf(afterUpdate.value) + '/' + (afterUpdate.reads > 0) });
  const againUpdate = asNewRequest_(stats);
  results.push({ title: '直したあと2回目は、新しい数字を覚えた中身から出す（安打3・読み0）', expected: '3/0', actual: hitsOf(againUpdate.value) + '/' + againUpdate.reads });

  // 消す → すぐ消えた数字
  callAsTest_(handleDeleteBattingRecord_, { record_id: added.record.record_id }, a, { today: T });
  const afterDelete = asNewRequest_(stats);
  results.push({ title: '消したあとは、すぐ打撃の記録が無くなる（試合数0・安打0）', expected: '0/0/true',
    actual: afterDelete.value.batting.games + '/' + hitsOf(afterDelete.value) + '/' + (afterDelete.reads > 0) });

  // 入れ直す → すぐ出る（同じ試合にもう一度）
  delete data.record_id;
  data.hits = 2;
  callAsTest_(handleAddBattingRecord_, data, a, { today: T });
  const afterAdd = asNewRequest_(stats);
  results.push({ title: '入れ直したあとは、すぐ新しい数字（安打2）', expected: '2', actual: String(hitsOf(afterAdd.value)) });

  // 投手も同じ
  callAsTest_(handleAddPitchingRecord_, { game_id: g.game_id, innings: 3, partial_outs: 0, earned_runs: 1 }, a, { today: T });
  const pit = asNewRequest_(stats);
  results.push({ title: '投手成績を保存したあとも、すぐ出る（投球回3回・自責点1）', expected: '3回/1', actual: pit.value.pitching ? pit.value.pitching.innings_text + '/' + pit.value.pitching.earned_runs : '記録なし' });

  // 版を新しくする関数（シートを手で直したとき用）
  const before = props.getProperty('DATA_VERSION');
  clearSheetCache();
  const afterClear = asNewRequest_(stats);
  results.push({ title: 'clearSheetCache を実行すると版が変わり、次はシートを読み直す', expected: 'true/true', actual: (props.getProperty('DATA_VERSION') !== before) + '/' + (afterClear.reads > 0) });

  // 書き込みのあと、同じ処理の中で行を消して読み直しても、古い中身を使わない
  const inLock = withLock_(function () {
    readRecords_(CONFIG.SHEET.GAMES);
    const g2 = appendTestGameRow_(a, team.team_id, T);
    const games = readRecords_(CONFIG.SHEET.GAMES);
    return games.some(function (r) { return r.game_id === g2; });
  });
  results.push({ title: '同じ処理の中で書いたあとに読むと、書いた行が入っている', expected: true, actual: inLock });
}

/** 順番待ちの中で、試合の行を1行足す（ID を返す。後片付けで、仮の人が作った行として消える） */
function appendTestGameRow_(user, teamId, gameDate) {
  const id = Utilities.getUuid();
  appendRecord_(CONFIG.SHEET.GAMES, {
    game_id: id, team_id: teamId, tournament_id: '', game_date: gameDate, game_number: 9, opponent: '', category: '', result: '',
    created_by: user.userId, created_at: new Date(), updated_at: new Date(), deleted_at: '',
  });
  return id;
}

/** 大きな中身（100KBを超える）も、分けて覚えて、元どおりに読み戻せる */
function testSheetCacheChunkScenario_(results) {
  const records = [];
  for (let i = 0; i < 2000; i++) {
    records.push({ _row: i + 2, name: '日本語の長めの名前' + i, n: i, at: new Date(Date.UTC(2026, 10, 1, 0, 0, i)) });
  }
  const table = { header: ['name', 'n', 'at'], records: records };
  const text = encodeTable_(table);
  results.push({ title: '試す中身は100KBより大きい（1つの値の上限を超える）', expected: true, actual: text.length > 100 * 1024 });
  forgetSheets_();
  const version = dataVersion_();
  writeTableCache_('Utest_big', table);
  const back = readTableCache_('Utest_big');
  results.push({ title: '分けて覚えた大きな中身を、元どおりに読み戻せる（件数・最後の行・日時）', expected: '2000/日本語の長めの名前1999/' + records[1999].at.getTime(),
    actual: back ? back.records.length + '/' + back.records[1999].name + '/' + back.records[1999].at.getTime() : '読めない' });
  // 後片付け：覚えた中身を消す
  try {
    const cache = CacheService.getScriptCache();
    const key = sheetCacheKey_(version, 'Utest_big');
    const count = Number(cache.get(key)) || 0;
    const keys = [key];
    for (let i = 0; i < count; i++) keys.push(key + ':' + i);
    cache.removeAll(keys);
  } catch (e) { /* そのまま */ }
}
