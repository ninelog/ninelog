/**
 * テストの共通部品
 *
 * テストでは、user_id が「Utest」で始まる仮の人を使う。
 * テストの最初と最後に cleanupTestData_ を呼んで、仮の人が作った行をシートから消す。
 * （本物のLINEユーザーIDは「U」＋英数字32文字なので、「Utest」で始まることはない）
 */
const TEST_USER_PREFIX = 'Utest';

function isTestUserId_(value) {
  return String(value).indexOf(TEST_USER_PREFIX) === 0;
}

/**
 * 自動テストが作った行を、すべてのシートから消す。
 * 消すのは「仮の人（Utest…）の行」と「自動テスト専用の番号（999999900〜）のチーム」だけ。
 * 本物のチーム（1〜1998 の予約番号を含む）の行は、消さない。
 */
function cleanupTestData_() {
  // 順番待ちの中で行う（その間に本物の利用者が書き込んでも、最新の内容を読んで、行の番号を取り違えないように）
  withLock_(cleanupTestDataInLock_);
}

function cleanupTestDataInLock_() {
  const testTeamIds = readRecords_(CONFIG.SHEET.TEAMS)
    .filter(function (t) { return isTestTeamNumber_(t.team_number); })
    .map(function (t) { return t.team_id; });

  deleteRowsWhere_(CONFIG.SHEET.TEAMS, function (r) { return isTestTeamNumber_(r.team_number); });
  deleteRowsWhere_(CONFIG.SHEET.MEMBERSHIPS, function (r) {
    return isTestUserId_(r.user_id) || testTeamIds.indexOf(r.team_id) !== -1;
  });
  deleteRowsWhere_(CONFIG.SHEET.USERS, function (r) { return isTestUserId_(r.user_id); });
  deleteRowsWhere_(CONFIG.SHEET.JOIN_ATTEMPTS, function (r) { return isTestUserId_(r.user_id); });
  deleteRowsWhere_(CONFIG.SHEET.GAMES, function (r) { return isTestUserId_(r.created_by) || testTeamIds.indexOf(r.team_id) !== -1; });
  [CONFIG.SHEET.BATTING, CONFIG.SHEET.PITCHING].forEach(function (name) {
    deleteRowsWhere_(name, function (r) { return isTestUserId_(r.user_id) || testTeamIds.indexOf(r.team_id) !== -1; });
  });
  // 変更の記録は、ふだんは消さない決まり（4.5b章）。消すのは、自動テストの仮の人が作った行だけ
  deleteRowsWhere_(CONFIG.SHEET.RECORD_CHANGES, function (r) { return isTestUserId_(r.user_id); });
}

/**
 * 自動テストで、操作の担当の関数を本番と同じ流れ（自動登録 → 順番待ち → 処理）で呼ぶ。
 * options（today など）を渡せる。断られたら { code, message } を返す。
 */
function callAsTest_(handler, data, user, options, write) {
  if (!isTestUserId_(user.userId)) {
    throw new Error('自動テストでは、仮の人（Utest…）だけを使います');
  }
  ensureUser_(user);
  const run = function () { return handler(data, { userId: user.userId, isAdmin: Boolean(user.isAdmin) }, options); };
  try {
    return write === false ? run() : withLock_(run);
  } catch (err) {
    return { code: err.code || ('想定外のエラー：' + err.message), message: err.message, details: err.details || null };
  }
}

/**
 * 自動テストでチームを作る（自動テスト専用の番号だけ作れる）。
 * 順番待ちの中で handleCreateTeam_ を呼ぶ。仮の人の登録は先に済ませておく（入れ子にしないため）。
 */
function createTestTeam_(user, teamNumber, teamName, passphrase, orgType) {
  if (!isTestUserId_(user.userId) || !isTestTeamNumber_(teamNumber)) {
    throw new Error('自動テストでは、仮の人（Utest…）と自動テスト専用の番号だけを使います');
  }
  ensureUser_(user);
  return withLock_(function () {
    return handleCreateTeam_(
      { org_type: orgType, team_number: teamNumber, team_name: teamName, passphrase: passphrase },
      { userId: user.userId, isAdmin: false },
      { forAutomatedTest: true }
    );
  });
}

/** 条件に合う行を消す（続いている行はまとめて1回で消す。Sheets.js の deleteRows_） */
function deleteRowsWhere_(name, predicate) {
  const rows = readRecords_(name).filter(predicate).map(function (r) { return r._row; });
  deleteRows_(name, rows);
}

/**
 * 自動テストでチームに参加する（自動テスト専用の番号のチームだけ）。
 * now を渡すと「今」をその日時として扱う（1時間後などを試すため）。
 * @return {Object} 成功したときの返事、または断られたときの { code, message, info }
 */
function joinTestTeam_(user, teamNumber, passphrase, now) {
  if (!isTestUserId_(user.userId)) {
    throw new Error('自動テストでは、仮の人（Utest…）だけを使います');
  }
  ensureUser_(user);
  try {
    return withLock_(function () {
      return handleJoinTeam_(
        { team_number: teamNumber, passphrase: passphrase },
        { userId: user.userId },
        { forAutomatedTest: true, now: now }
      );
    });
  } catch (err) {
    return { code: err.code || ('想定外のエラー：' + err.message), message: err.message, info: err.info || null };
  }
}

/**
 * 自動テストで試合を作る（自動テスト専用の番号のチームだけ）。
 * today：その日を「今日」として作る（30日より前の試合を用意するため）
 * @return {Object} 作った試合（toGameSummary_ の形）
 */
function createTestGame_(user, teamId, gameDate, today, extra) {
  const team = findRecord_(CONFIG.SHEET.TEAMS, function (t) { return t.team_id === teamId; });
  if (!isTestUserId_(user.userId) || !team || !isTestTeamNumber_(team.team_number)) {
    throw new Error('自動テストでは、仮の人（Utest…）と自動テスト専用の番号のチームだけを使います');
  }
  const result = callAsTest_(handleCreateGame_, Object.assign({ team_id: teamId, game_date: gameDate }, extra || {}), user, { today: today || gameDate });
  if (!result.game) throw new Error('テスト用の試合を作れませんでした：' + JSON.stringify(result));
  return result.game;
}

/** 仮の人の、間違えた回数の記録（無ければ 0） */
function testFailCount_(userId) {
  const r = findRecord_(CONFIG.SHEET.JOIN_ATTEMPTS, function (x) { return x.user_id === userId; });
  return r ? Number(r.fail_count) || 0 : 0;
}

/**
 * testAll が実行中のときだけ使う、結果の受け取り口（TestAll.js）。
 * 1つのテストを実行するたびに空の配列に戻し、logResults_ がここに結果を入れる。
 */
let testAllCollector_ = null;

/** 結果の一覧を実行ログに出す（OK／NG と合計）。testAll の実行中なら、結果を受け取り口にも渡す */
function logResults_(results) {
  let passed = 0;
  results.forEach(function (r) {
    const ok = r.actual === r.expected;
    if (ok) passed++;
    Logger.log((ok ? 'OK' : 'NG') + '｜' + r.title + '｜期待：' + r.expected + '｜結果：' + r.actual);
  });
  Logger.log('合計：' + passed + ' / ' + results.length + ' 件 OK');
  if (testAllCollector_) {
    results.forEach(function (r) { testAllCollector_.push(r); });
  }
}

/**
 * 「成功するはず」の確認用。成功（r[key] がある）なら 'ok'、断られたら「理由の名前：説明（項目）」を返す。
 * NG になったとき、実行ログで理由がわかるようにするため（true/false だけだと理由がわからない）。
 */
function okOrReason_(r, key) {
  if (r && r[key]) return 'ok';
  if (!r) return '（返事が空）';
  const details = r.details ? '（' + r.details.map(function (d) { return d.field + '：' + d.message; }).join(' / ') + '）' : '';
  return (r.code || '理由不明') + '：' + (r.message || JSON.stringify(r)) + details;
}

/** fn を実行して、断られたら「項目名：説明」、通ったら 'pass' を返す */
function errorSummary_(fn) {
  try {
    fn();
    return 'pass';
  } catch (err) {
    if (err.details) return err.details.map(function (d) { return d.field + '：' + d.message; }).join(' / ');
    return err.code || ('想定外のエラー：' + err.message);
  }
}
