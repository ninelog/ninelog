/**
 * 調べもの用の関数（テストではない。testAll には入れない）
 */

/**
 * 時間の内訳を測る仕組み（調べものの間だけ動く。ふだんは何もしない）
 * profile_ が null のときは、measure_ はそのまま fn を実行するだけ。
 */
let profile_ = null;

/** category の時間と回数を足しながら fn を実行する */
function measure_(category, fn) {
  if (!profile_) return fn();
  const t0 = Date.now();
  try {
    return fn();
  } finally {
    const p = profile_[category] || (profile_[category] = { count: 0, ms: 0 });
    p.count++;
    p.ms += Date.now() - t0;
  }
}

/**
 * testPitchingRecords を、時間の内訳を測りながら実行する（1分半ほど）。
 * シートの読み・書き・行の削除、順番待ち、スクリプトプロパティ、ハッシュの計算に
 * それぞれ何回・何秒かかったかを実行ログに出す。テストの中身はふだんと同じ。
 */
function profilePitchingTest() {
  profileTest_('testPitchingRecords');
}

/** testMyStats を、時間の内訳を測りながら実行する */
function profileMyStatsTest() {
  profileTest_('testMyStats');
}

function profileTest_(name) {
  profile_ = {};
  const t0 = Date.now();
  try {
    globalThis[name]();
  } finally {
    const total = Date.now() - t0;
    const p = profile_;
    profile_ = null;
    const labels = {
      read: 'シートの読み込み（getDataRange）',
      write: 'シートへの書き込み（1行）',
      grow: 'シートの行を調べる・足す',
      delete: 'シートの行の削除',
      lockWait: '順番待ち（LockService）の取得',
      props: 'スクリプトプロパティの読み書き',
      hash: '合言葉のハッシュの計算（1000回くり返し）',
      fetch: 'LINEへの問い合わせ',
    };
    Logger.log('');
    Logger.log('========== 時間の内訳：' + name + '（全体 ' + (total / 1000).toFixed(1) + '秒） ==========');
    let measured = 0;
    Object.keys(labels).forEach(function (key) {
      const v = p[key];
      if (!v) return;
      measured += v.ms;
      Logger.log(labels[key] + '：' + v.count + '回、' + (v.ms / 1000).toFixed(1) + '秒（1回あたり ' + (v.ms / v.count).toFixed(0) + 'ミリ秒）');
    });
    Logger.log('そのほか（プログラムの計算など）：' + ((total - measured) / 1000).toFixed(1) + '秒');
  }
}

/**
 * シートの大きさと、ハッシュの計算の速さを測る
 *
 * 使い方：GASの編集画面で diagnoseSheetsAndHash を選んで「実行」。結果は「実行ログ」に出る。
 * シートには何も書き込まない（読むだけ）。合言葉のハッシュの計算にかかる時間も測る。
 */
function diagnoseSheetsAndHash() {
  // ① シートの大きさ（行の数・データがある行の数・データの範囲）
  Logger.log('========== シートの大きさ ==========');
  Object.keys(CONFIG.SHEET).forEach(function (key) {
    const name = CONFIG.SHEET[key];
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
    if (!sheet) {
      Logger.log(name + '：シートが見つかりません');
      return;
    }
    const range = sheet.getDataRange();
    Logger.log(name + '：シートの行の数 ' + sheet.getMaxRows() + '、データがある最後の行 ' + sheet.getLastRow() +
      '、データの範囲 ' + range.getNumRows() + '行×' + range.getNumColumns() + '列');
  });

  // ② ハッシュの計算の速さ（合言葉1回ぶん＝1000回くり返し と、1回だけ）
  Logger.log('========== 合言葉のハッシュの計算の速さ ==========');
  const pepper = 'diagnose-only-pepper'; // 測るためだけの値（本物の隠し味は使わない・保存もしない）
  let t0 = Date.now();
  for (let i = 0; i < 10; i++) {
    Utilities.computeHmacSha256Signature('salt:abcdef' + i, pepper, Utilities.Charset.UTF_8);
  }
  const perCall = (Date.now() - t0) / 10;
  Logger.log('Utilities.computeHmacSha256Signature 1回：約 ' + perCall.toFixed(1) + ' ミリ秒');

  t0 = Date.now();
  let value = 'salt:abcdef';
  for (let i = 0; i < CONFIG.PASSPHRASE_HASH_ROUNDS; i++) {
    value = bytesToHex_(Utilities.computeHmacSha256Signature(value, pepper, Utilities.Charset.UTF_8));
  }
  Logger.log('合言葉1回ぶん（' + CONFIG.PASSPHRASE_HASH_ROUNDS + '回くり返し）：約 ' + ((Date.now() - t0) / 1000).toFixed(1) + ' 秒');
  Logger.log('（チームの作成・参加・合言葉の変更のたびに、この時間がかかる）');
}
