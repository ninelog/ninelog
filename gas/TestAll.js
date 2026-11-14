/**
 * すべての自動テストを順に実行して、まとめを実行ログに出す
 *
 * 使い方：GASの編集画面で testAll を選んで「実行」。
 * 実行ログの最後に、次の3つが出る。
 *   ① テストごとの結果（OK／NG、件数、かかった秒数）
 *   ② 全体の合計
 *   ③ NG があった場合は、その NG の行をまとめたもの（どのテストの行か付き）
 *
 * GASは、1回の実行が6分を超えると途中で止まる。そこで、始めてから約4分30秒たったら
 * 次のテストには進まずに止め、残りのテストの名前を覚えておく。
 * そのときは、続けて testAllContinue を実行すると、残りから再開する。
 *
 * 新しいテストを作ったら、testAllNames_ の一覧に1行足す。
 */

/** 順に実行するテストの一覧（関数の名前） */
function testAllNames_() {
  return [
    'testVerifyIdToken',   // B-3  本人確認
    'testDoPost',          // B-4  共通の入口
    'testValidation',      // B-5  入力チェック
    'testTeams',           // B-6  ユーザー・チームの作成
    'testJoin',            // B-6追加 参加・合言葉の変更
    'testOrganizations',   // B-10a チームと大会
    'testGames',           // B-10 試合
    'testTournamentGames', // B-10b 試合に大会を付ける
    'testBattingRecords',  // B-7（B-11） 打撃成績
    'testPitchingRecords', // B-8（B-11） 投手成績
    'testMyStats',         // B-9（B-12） 自分の成績
    'testTeamRanking',     // B-13 チーム内ランキング
    'testTournamentRanking', // B-13b 大会のランキング
    'testTeamStats',       // B-14 チーム全体の成績
    'testBreakdowns',      // B-15 相手別・大会別・区分別の集計
    'testCelebrations',    // B-16 記録達成のお祝い
    'testCalendar',        // B-17 カレンダー用の情報
    'testPermissions',     // B-18 権限チェックのまとめ
    'testSolo',            // B-19 ひとりの記録
    'testLeave',           // B-20 退会
    'testDelete',          // B-21 チーム・大会を消す、ひとりの記録から移す
    'testBatch',           // B-22 本人確認の結果を覚える、見るだけの操作をまとめる
    'testWebhook',         // B-23 公式LINEのトークへの返信
  ];
}

/** 次のテストに進むのをやめる時間（ミリ秒）。4分30秒 */
const TEST_ALL_TIME_LIMIT_MS = 4.5 * 60 * 1000;
/** 時間切れで止めたとき、残りのテストの名前を覚えておく場所（スクリプトプロパティ） */
const TEST_ALL_REMAINING_KEY = 'TEST_ALL_REMAINING';

/** すべてのテストを最初から実行する */
function testAll() {
  PropertiesService.getScriptProperties().deleteProperty(TEST_ALL_REMAINING_KEY);
  runTestList_(testAllNames_());
}

/** 時間切れで止まったときに、残りのテストから再開する */
function testAllContinue() {
  const saved = PropertiesService.getScriptProperties().getProperty(TEST_ALL_REMAINING_KEY);
  if (!saved) {
    Logger.log('続きのテストはありません（testAll が最後まで終わっています）。最初から実行するときは testAll を使ってください。');
    return;
  }
  PropertiesService.getScriptProperties().deleteProperty(TEST_ALL_REMAINING_KEY);
  runTestList_(saved.split(','));
}

/** テストを順に実行して、まとめを出す */
function runTestList_(names) {
  const started = Date.now();
  const summaries = [];
  const ngLines = [];
  let remaining = [];

  for (let i = 0; i < names.length; i++) {
    const name = names[i];
    if (Date.now() - started > TEST_ALL_TIME_LIMIT_MS) {
      remaining = names.slice(i);
      break;
    }
    const fn = globalThis[name];
    const t0 = Date.now();
    testAllCollector_ = [];
    let error = null;
    Logger.log('========== ' + name + ' ==========');
    try {
      if (typeof fn !== 'function') throw new Error('テストの関数が見つかりません：' + name);
      fn();
    } catch (err) {
      error = err;
      Logger.log('エラーで止まりました：' + (err && err.message ? err.message : err));
    }
    const results = testAllCollector_;
    testAllCollector_ = null;

    const passed = results.filter(function (r) { return r.actual === r.expected; }).length;
    summaries.push({ name: name, passed: passed, total: results.length, error: error, seconds: Math.round((Date.now() - t0) / 1000) });
    results.forEach(function (r) {
      if (r.actual !== r.expected) {
        ngLines.push('NG｜' + name + '｜' + r.title + '｜期待：' + r.expected + '｜結果：' + r.actual);
      }
    });
    if (error) {
      ngLines.push('エラー｜' + name + '｜' + (error && error.message ? error.message : error));
    }
  }

  // ---------- まとめ ----------
  let totalPassed = 0;
  let totalCount = 0;
  Logger.log('');
  Logger.log('========== まとめ（テストごと） ==========');
  summaries.forEach(function (s) {
    totalPassed += s.passed;
    totalCount += s.total;
    const ok = !s.error && s.passed === s.total && s.total > 0;
    Logger.log((ok ? 'OK' : (s.error ? 'エラー' : 'NG')) + '｜' + s.name + '｜' + s.passed + ' / ' + s.total + ' 件 OK｜' + s.seconds + '秒');
  });
  const allOk = ngLines.length === 0 && remaining.length === 0;
  Logger.log('========== 全体の合計 ==========');
  Logger.log('合計：' + totalPassed + ' / ' + totalCount + ' 件 OK（' + summaries.length + ' 個のテスト、' +
    Math.round((Date.now() - started) / 1000) + '秒）' + (allOk ? '　すべてOK' : ''));

  if (ngLines.length > 0) {
    Logger.log('========== NG・エラーの行（' + ngLines.length + ' 件） ==========');
    ngLines.forEach(function (line) { Logger.log(line); });
  }
  if (remaining.length > 0) {
    PropertiesService.getScriptProperties().setProperty(TEST_ALL_REMAINING_KEY, remaining.join(','));
    Logger.log('========== 時間切れで止めました ==========');
    Logger.log('まだ実行していないテスト：' + remaining.join('、'));
    Logger.log('続けて testAllContinue を実行してください（残りのテストから再開します）。');
  }
}
