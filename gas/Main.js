/**
 * 画面（LIFF）からの要求を受け付ける共通の入口（CLAUDE.md 第3章・第3.5章）
 *
 * 要求の形（画面 → GAS。Content-Type は text/plain、本文はJSON文字列）：
 *   { "action": "whoami", "idToken": "（LIFFで取得した札）", "data": { ... } }
 *
 * 返事の形（GAS → 画面）：
 *   成功：{ "ok": true,  "data": { ... } }
 *   失敗：{ "ok": false, "error": { "code": "TOKEN_EXPIRED", "message": "..." } }
 *
 * 流れ：① 要求を読む → ② 本人確認 → ③ 操作ごとの処理へ振り分け → ④ 返事
 * 札が無い・正しくない要求は、②で必ず断る（どの操作でも同じ）。
 */
function doPost(e) {
  try {
    const request = parseRequest_(e);
    const user = verifyIdToken_(request.idToken);
    const data = dispatch_(request, user);
    return jsonResponse_({ ok: true, data: data });
  } catch (err) {
    return jsonResponse_({ ok: false, error: toErrorBody_(err) });
  }
}

/**
 * 操作の一覧（操作の名前 → 処理する関数）
 * write: true の操作は、書き込みの順番待ち（LockService）をしてから処理する（第4.6章）。
 * 新しい操作は、ここに1行足す（B-6以降）。
 */
function getActions_() {
  return {
    whoami: { handler: handleWhoami_, write: false },
    updateMyName: { handler: handleUpdateMyName_, write: true },
    createTeam: { handler: handleCreateTeam_, write: true },
    listMyTeams: { handler: handleListMyTeams_, write: false },
    joinTeam: { handler: handleJoinTeam_, write: true },
    changePassphrase: { handler: handleChangePassphrase_, write: true },
    addBattingRecord: { handler: handleAddBattingRecord_, write: true },
    listMyBattingRecords: { handler: handleListMyBattingRecords_, write: false },
    updateBattingRecord: { handler: handleUpdateBattingRecord_, write: true },
    deleteBattingRecord: { handler: handleDeleteBattingRecord_, write: true },
    addPitchingRecord: { handler: handleAddPitchingRecord_, write: true },
    listMyPitchingRecords: { handler: handleListMyPitchingRecords_, write: false },
    updatePitchingRecord: { handler: handleUpdatePitchingRecord_, write: true },
    deletePitchingRecord: { handler: handleDeletePitchingRecord_, write: true },
    getMyStats: { handler: handleGetMyStats_, write: false },
    createGame: { handler: handleCreateGame_, write: true },
    listTeamGames: { handler: handleListTeamGames_, write: false },
    updateGame: { handler: handleUpdateGame_, write: true },
    deleteGame: { handler: handleDeleteGame_, write: true },
  };
}

/**
 * 要求の本文を読み、形が正しいか確かめる。
 * @return {{action: string, idToken: *, data: Object}}
 */
function parseRequest_(e) {
  const text = e && e.postData && e.postData.contents;
  if (!text) {
    throw new AppError(APP_ERROR.BAD_REQUEST, '要求の中身がありません');
  }

  let body;
  try {
    body = JSON.parse(text);
  } catch (err) {
    throw new AppError(APP_ERROR.BAD_REQUEST, '要求の形が正しくありません（JSONではありません）');
  }
  if (!isPlainObject_(body)) {
    throw new AppError(APP_ERROR.BAD_REQUEST, '要求の形が正しくありません');
  }
  if (typeof body.action !== 'string' || body.action === '') {
    throw new AppError(APP_ERROR.BAD_REQUEST, 'action（操作の名前）がありません');
  }

  const data = body.data === undefined ? {} : body.data;
  if (!isPlainObject_(data)) {
    throw new AppError(APP_ERROR.BAD_REQUEST, 'data の形が正しくありません');
  }

  return { action: body.action, idToken: body.idToken, data: data };
}

/**
 * 操作の名前に応じて、担当の関数に振り分ける。
 * @param {{action: string, data: Object}} request
 * @param {{userId: string, name: string}} user 本人確認で確かめた本人
 */
function dispatch_(request, user) {
  const actions = getActions_();
  // 「toString」などの名前で、思わぬ関数が呼ばれないようにする
  if (!Object.prototype.hasOwnProperty.call(actions, request.action)) {
    throw new AppError(APP_ERROR.UNKNOWN_ACTION, '知らない操作です：' + request.action);
  }

  const action = actions[request.action];

  // 本人を users シートに自動登録し（初めての人のとき）、表示名と管理者かどうかを付け足す
  const profile = ensureUser_(user);
  user = {
    userId: user.userId,
    name: user.name,
    displayName: profile.displayName,
    nameSource: profile.nameSource,
    isAdmin: isAdmin_(user.userId),
  };

  if (action.write) {
    return withLock_(function () {
      return action.handler(request.data, user);
    });
  }
  return action.handler(request.data, user);
}

/**
 * 書き込みの順番待ちをしてから fn を実行する（第4.6章）。
 * 同時に2人が書き込んで、データが壊れたり重なったりするのを防ぐ。
 * 注意：withLock_ の中で、もう一度 withLock_ を呼ばない（入れ子にしない）。
 */
function withLock_(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(CONFIG.LOCK_WAIT_MS)) {
    throw new AppError(APP_ERROR.BUSY, '混み合っています。少し待ってから、もう一度お試しください');
  }
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

/**
 * 操作：whoami（自分の確認）
 * 本人確認で確かめたLINEユーザーID、LINEの名前、表示名、管理者かどうかを返す。
 * C-2の動作確認と、管理者の登録（CLAUDE.md 8.7章）で使う。
 */
function handleWhoami_(data, user) {
  return {
    userId: user.userId,
    lineName: user.name,
    displayName: user.displayName,
    nameSource: user.nameSource,
    isAdmin: user.isAdmin,
  };
}

/**
 * エラーを、画面に返す形に変える。
 * 想定外のエラーは中身を画面に出さず、GASの記録にだけ残す（札は残さない）。
 */
function toErrorBody_(err) {
  if (err instanceof AuthError || err instanceof AppError) {
    const body = { code: err.code, message: err.message };
    if (err.details) body.details = err.details; // 入力チェックの、項目ごとの説明
    if (err.info) body.info = err.info;          // 残りの回数など、画面が使う追加の情報
    return body;
  }
  console.error('想定外のエラー：' + (err && err.stack ? err.stack : err));
  return { code: APP_ERROR.INTERNAL, message: 'サーバーで想定外のエラーが起きました' };
}

/**
 * 値が「{ }」の形のデータか（配列や null ではないか）を確かめる。
 */
function isPlainObject_(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * 結果をJSON（データを文字で表す決まった形式）にして返す。
 */
function jsonResponse_(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
