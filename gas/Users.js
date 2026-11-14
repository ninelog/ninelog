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
  const lineName = (user.name || '').trim() || CONFIG.DEFAULT_DISPLAY_NAME;

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
  const name = typeof data.display_name === 'string' ? data.display_name.trim() : '';
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
  return { displayName: name, nameSource: 'custom' };
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
