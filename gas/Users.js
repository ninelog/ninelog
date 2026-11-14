/**
 * ユーザーの自動登録と表示名（CLAUDE.md 第4.1章・第4.8章）
 *
 * - 登録の画面は作らない。要求が来るたびに ensureUser_ を呼び、初めての人なら登録する。
 * - 表示名は最初はLINEの名前（name_source = line）。LINEの名前が変わったら、次の要求で新しい名前にする。
 * - 本人が表示名を変えたら name_source = custom にし、LINEの名前が変わっても上書きしない。
 */

/**
 * 本人を users シートに登録する（または表示名を新しくする）。
 * 書き込みが必要なときだけ順番待ちをする（ふだんは読むだけで済ませる）。
 * @param {{userId: string, name: string}} user 本人確認で確かめた本人
 * @return {{userId: string, displayName: string, nameSource: string}}
 */
function ensureUser_(user) {
  // 目に見えない文字は取り除く（2026-11-15。Teams.js の cleanName_）
  const lineName = cleanName_(user.name || '') || CONFIG.DEFAULT_DISPLAY_NAME;

  const current = findUserRecord_(user.userId);
  if (current && !userNeedsUpdate_(current, lineName)) {
    return toUserProfile_(current);
  }

  return withLock_(function () {
    // 順番待ちの間に、ほかの要求が先に登録したかもしれないので、もう一度読む
    const record = findUserRecord_(user.userId);
    const now = new Date();
    if (!record) {
      const created = {
        user_id: user.userId, display_name: lineName, name_source: 'line',
        created_at: now, updated_at: now,
      };
      appendRecord_(CONFIG.SHEET.USERS, created);
      return toUserProfile_(created);
    }
    if (userNeedsUpdate_(record, lineName)) {
      updateRecord_(CONFIG.SHEET.USERS, record._row, { display_name: lineName, updated_at: now });
      record.display_name = lineName;
    }
    return toUserProfile_(record);
  });
}

/**
 * 操作：updateMyName（自分の表示名を変える）
 * data: { display_name: '新しい名前' }（1〜20文字）
 */
function handleUpdateMyName_(data, user) {
  const name = cleanName_(data.display_name); // 目に見えない文字を取り除き、前後の空白を取る（2026-11-15）
  const problem = nameProblem_(name, '表示名', CONFIG.DISPLAY_NAME_MAX); // 絵文字なども1文字として数える
  if (problem) {
    throw new AppError(APP_ERROR.VALIDATION_ERROR, '入力内容に誤りがあります', [
      { field: 'display_name', message: problem },
    ]);
  }
  const record = findUserRecord_(user.userId);
  updateRecord_(CONFIG.SHEET.USERS, record._row, {
    display_name: name, name_source: 'custom', updated_at: new Date(),
  });
  return { displayName: name, nameSource: 'custom', sameNameTeams: sameNameTeams_(user.userId, name) };
}

/**
 * 同じチーム・大会の中に、自分と同じ表示名の人がいるか（2026-11-15。断らずに知らせるだけ）。
 * 返すのは、その人がいるチーム・大会の名前の一覧だけ（ほかの人のIDや名前は返さない）。
 * 比べるときは、全角・半角と大文字・小文字をそろえ、目に見えない文字と前後の空白を取る。
 * 個人用の記録は本人しかいないので見ない。
 */
function sameNameTeams_(userId, displayName) {
  const key = function (name) { return cleanName_(String(name || '')).normalize('NFKC').toLowerCase(); };
  const mine = key(displayName);
  if (!mine) return [];
  const names = {};
  readRecords_(CONFIG.SHEET.USERS).forEach(function (u) { names[u.user_id] = key(u.display_name); });
  const teams = {};
  readRecords_(CONFIG.SHEET.TEAMS).forEach(function (t) { teams[t.team_id] = t; });
  const memberships = readRecords_(CONFIG.SHEET.MEMBERSHIPS);
  const myTeamIds = memberships.filter(function (m) { return m.user_id === userId; }).map(function (m) { return m.team_id; });
  const found = [];
  myTeamIds.forEach(function (teamId) {
    const team = teams[teamId];
    if (!team || orgTypeOf_(team) === ORG_TYPE.SOLO) return;
    const clash = memberships.some(function (m) { return m.team_id === teamId && m.user_id !== userId && names[m.user_id] === mine; });
    if (clash) found.push(String(team.team_name));
  });
  return found;
}

function findUserRecord_(userId) {
  return findRecord_(CONFIG.SHEET.USERS, function (r) { return r.user_id === userId; });
}

/** LINEの名前に合わせて書き換える必要があるか */
function userNeedsUpdate_(record, lineName) {
  return record.name_source !== 'custom' && record.display_name !== lineName;
}

function toUserProfile_(record) {
  return {
    userId: record.user_id,
    displayName: String(record.display_name),
    nameSource: record.name_source || 'line',
  };
}
