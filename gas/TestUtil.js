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

/** 条件に合う行を消す（下の行から消すと、上の行の番号がずれない） */
function deleteRowsWhere_(name, predicate) {
  const sheet = getSheet_(name);
  readRecords_(name)
    .filter(predicate)
    .map(function (r) { return r._row; })
    .sort(function (a, b) { return b - a; })
    .forEach(function (row) { sheet.deleteRow(row); });
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

/** 仮の人の、間違えた回数の記録（無ければ 0） */
function testFailCount_(userId) {
  const r = findRecord_(CONFIG.SHEET.JOIN_ATTEMPTS, function (x) { return x.user_id === userId; });
  return r ? Number(r.fail_count) || 0 : 0;
}

/** 結果の一覧を実行ログに出す（OK／NG と合計） */
function logResults_(results) {
  let passed = 0;
  results.forEach(function (r) {
    const ok = r.actual === r.expected;
    if (ok) passed++;
    Logger.log((ok ? 'OK' : 'NG') + '｜' + r.title + '｜期待：' + r.expected + '｜結果：' + r.actual);
  });
  Logger.log('合計：' + passed + ' / ' + results.length + ' 件 OK');
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
