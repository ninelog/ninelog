/**
 * 成績の登録・一覧・修正・削除（CLAUDE.md 第4.4章・第4.4b章・第4.5b章）
 *
 * 打撃（B-7）と投手（B-8）で同じルールを使うため、共通の作りにしている。
 * 投手は、画面では「回（innings）」と「アウト数（partial_outs：0〜2）」で入力し、
 * 保存・比較・変更の記録は、アウト数の合計 outs で行う（4.4b章）。
 * - 2026-11-11 B-11：成績は試合（games）に結びつける（game_id）。チームと試合日は試合から読む（11.2章）
 * - 入力・修正・削除ができるのは、本人が自分の記録に対してだけ（管理者も他人の記録には触れない）
 * - 試合の試合日（0日目）から30日目まで（Config.js の RECORD_EDIT_DAYS）。過ぎたら EDIT_PERIOD_OVER
 * - 入力できるのは、自分が所属しているチームの試合の成績だけ
 * - 1人の選手は、1つの試合に打撃・投手それぞれ1件まで
 * - 修正・削除は record_changes シートに、変わった項目1つにつき1行を記録する（Changes.js）
 * - 削除は論理削除（deleted_at に日時を入れる）。一覧と計算では deleted_at が空の行だけを使う
 *
 * options（自動テストのときだけ。画面からは渡せない）：
 *   today：「今日」の日付（yyyy-MM-dd）を決め打ちする（30日目・31日目などを試すため）
 */

/** 成績の種類ごとの決まり（打撃・投手） */
function recordTypes_() {
  return {
    batting: {
      type: 'batting',
      sheet: CONFIG.SHEET.BATTING,
      validate: validateBattingInput_,
      // 修正のときに比べる項目（画面から入力する項目）
      fields: ['game_id'].concat(BATTING_COUNT_FIELDS.map(function (f) { return f[0]; })),
      label: '打撃',
    },
    pitching: {
      type: 'pitching',
      sheet: CONFIG.SHEET.PITCHING,
      validate: validatePitchingInput_,
      fields: ['game_id', 'outs', 'earned_runs'],
      label: '投手',
    },
  };
}

/* ---------- 打撃の操作（Main.js の getActions_ に登録） ---------- */

/** 操作：addBattingRecord（打撃成績を1試合分登録する）。data は 4.4章の入力項目＋game_id */
function handleAddBattingRecord_(data, user, options) {
  return addGameRecord_('batting', data, user, options);
}

/** 操作：listMyBattingRecords（自分の打撃成績の一覧）。data: { team_id: 省略可 } */
function handleListMyBattingRecords_(data, user, options) {
  return listGameRecords_('batting', data, user, options);
}

/** 操作：updateBattingRecord（自分の打撃成績を直す）。data: { record_id, 登録と同じ全項目 } */
function handleUpdateBattingRecord_(data, user, options) {
  return updateGameRecord_('batting', data, user, options);
}

/** 操作：deleteBattingRecord（自分の打撃成績を消す）。data: { record_id } */
function handleDeleteBattingRecord_(data, user, options) {
  return deleteGameRecord_('batting', data, user, options);
}

/* ---------- 投手の操作（Main.js の getActions_ に登録） ---------- */

/**
 * 操作：addPitchingRecord（投手成績を1試合分登録する）
 * data: { game_id, innings: 回, partial_outs: アウト数（0〜2）, earned_runs: 自責点 }
 * 保存するときは outs ＝ 回×3＋アウト数 にする（4.4b章）
 */
function handleAddPitchingRecord_(data, user, options) {
  return addGameRecord_('pitching', data, user, options);
}

/** 操作：listMyPitchingRecords（自分の投手成績の一覧）。data: { team_id: 省略可 } */
function handleListMyPitchingRecords_(data, user, options) {
  return listGameRecords_('pitching', data, user, options);
}

/** 操作：updatePitchingRecord（自分の投手成績を直す）。data: { record_id, 登録と同じ全項目 } */
function handleUpdatePitchingRecord_(data, user, options) {
  return updateGameRecord_('pitching', data, user, options);
}

/** 操作：deletePitchingRecord（自分の投手成績を消す）。data: { record_id } */
function handleDeletePitchingRecord_(data, user, options) {
  return deleteGameRecord_('pitching', data, user, options);
}

/**
 * 投球回の表示（6章）：アウト数の合計を「○回」「○回1/3」「○回2/3」の形にする。
 * 例：16 → 「5回1/3」、18 → 「6回」、2 → 「0回2/3」
 */
function formatInnings_(outs) {
  const whole = Math.floor(outs / 3);
  const rest = outs % 3;
  return whole + '回' + (rest ? rest + '/3' : '');
}

/* ---------- 共通の処理 ---------- */

function addGameRecord_(type, data, user, options) {
  const t = recordTypes_()[type];
  const today = todayText_(options);
  const values = t.validate(data);
  const game = usableGameFor_(values.game_id, user, today);
  assertNoOtherRecord_(t, user.userId, game.game_id, null);

  // お祝い（B-16）は、書き込む前の合計と比べて判定する
  const celebrations = celebrationsFor_(t.type, user.userId, null, values);

  const now = new Date();
  const record = Object.assign({ record_id: Utilities.getUuid(), user_id: user.userId }, values, {
    created_at: now, updated_at: now, deleted_at: '',
  });
  appendRecord_(t.sheet, record);
  return { record: toRecordSummary_(t, record, game, user, today), celebrations: celebrations };
}

function listGameRecords_(type, data, user, options) {
  const t = recordTypes_()[type];
  const today = todayText_(options);
  const teamId = typeof data.team_id === 'string' && data.team_id !== '' ? data.team_id : null;
  const gamesById = gamesById_();

  const records = readRecords_(t.sheet)
    .filter(function (r) { return r.user_id === user.userId && !r.deleted_at && gamesById[r.game_id]; })
    .filter(function (r) { return !teamId || gamesById[r.game_id].team_id === teamId; })
    .sort(function (a, b) {
      // 試合日の新しい順。同じ日なら、番号の大きい（あとの）試合から
      const ga = gamesById[a.game_id];
      const gb = gamesById[b.game_id];
      const byDate = dateText_(gb.game_date).localeCompare(dateText_(ga.game_date));
      return byDate !== 0 ? byDate : Number(gb.game_number) - Number(ga.game_number);
    });
  return { records: records.map(function (r) { return toRecordSummary_(t, r, gamesById[r.game_id], user, today); }) };
}

function updateGameRecord_(type, data, user, options) {
  const t = recordTypes_()[type];
  const today = todayText_(options);
  const current = findOwnActiveRecord_(t, data.record_id, user);
  const currentGame = findRecord_(CONFIG.SHEET.GAMES, function (g) { return g.game_id === current.game_id; });
  if (!currentGame || !isWithinEditPeriod_(dateText_(currentGame.game_date), today)) {
    throw editPeriodOverError_();
  }

  const values = t.validate(data);
  let game = currentGame;
  if (values.game_id !== String(current.game_id)) {
    // 別の試合に付け替えるときは、その試合も使えること（期限切れの試合に移して復活させない）
    game = usableGameFor_(values.game_id, user, today);
    assertNoOtherRecord_(t, user.userId, game.game_id, current.record_id);
  }

  // 変わった項目だけを集める
  const changes = {};
  t.fields.forEach(function (field) {
    const before = comparableValue_(field, current[field]);
    if (String(before) !== String(values[field])) {
      changes[field] = { oldValue: before, newValue: values[field] };
    }
  });
  if (Object.keys(changes).length === 0) {
    return { unchanged: true, record: toRecordSummary_(t, current, game, user, today), celebrations: [] };
  }

  const now = new Date();
  const update = { updated_at: now };
  Object.keys(changes).forEach(function (field) { update[field] = changes[field].newValue; });
  // お祝い（B-16）は、書き込む前の合計と比べて判定する
  const celebrations = celebrationsFor_(t.type, user.userId, current, Object.assign({}, current, update));
  updateRecord_(t.sheet, current._row, update);
  appendRecordChanges_(t.type, current.record_id, user.userId, 'update', changes, now);

  return {
    unchanged: false,
    record: toRecordSummary_(t, Object.assign({}, current, update), game, user, today),
    celebrations: celebrations,
  };
}

function deleteGameRecord_(type, data, user, options) {
  const t = recordTypes_()[type];
  const today = todayText_(options);
  const current = findOwnActiveRecord_(t, data.record_id, user);
  const game = findRecord_(CONFIG.SHEET.GAMES, function (g) { return g.game_id === current.game_id; });
  if (!game || !isWithinEditPeriod_(dateText_(game.game_date), today)) {
    throw editPeriodOverError_();
  }

  const now = new Date();
  updateRecord_(t.sheet, current._row, { deleted_at: now, updated_at: now });
  appendRecordChanges_(t.type, current.record_id, user.userId, 'delete', {
    deleted_at: { oldValue: '', newValue: now },
  }, now);
  return { deleted: true, recordId: current.record_id };
}

/**
 * 自分の、まだ削除していない記録を探す。
 * 他人の記録・存在しない記録・削除済みの記録は、どれも同じ返事（FORBIDDEN）で断る。
 * 管理者でも、他人の記録には触れない。
 */
function findOwnActiveRecord_(t, recordId, user) {
  const record = typeof recordId === 'string' && recordId !== ''
    ? findRecord_(t.sheet, function (r) { return r.record_id === recordId; })
    : null;
  if (!record || record.user_id !== user.userId || record.deleted_at) {
    throw new AppError(APP_ERROR.FORBIDDEN, '自分の記録だけを修正・削除できます');
  }
  return record;
}

/**
 * 成績を付けられる試合か確かめて、その試合を返す。
 * - 試合が無い（消された）→ 入力チェックの誤り（game_id）
 * - 所属していないチームの試合 → FORBIDDEN
 * - 試合日から31日目以降 → EDIT_PERIOD_OVER
 */
function usableGameFor_(gameId, user, today) {
  const game = findActiveGame_(gameId);
  if (!game) {
    throw new AppError(APP_ERROR.VALIDATION_ERROR, '入力内容に誤りがあります', [
      { field: 'game_id', message: '試合が見つかりません（一覧から選び直してください）' },
    ]);
  }
  // 成績を付けられるのは、所属しているチームの試合だけ（大会には直接付けない。11.7章）
  if (!isMemberOfTeamType_(user.userId, game.team_id)) {
    throw new AppError(APP_ERROR.FORBIDDEN, '所属していないチームの成績は入力できません');
  }
  if (!isWithinEditPeriod_(dateText_(game.game_date), today)) {
    throw editPeriodOverError_();
  }
  return game;
}

/** 1人の選手は、1つの試合に打撃・投手それぞれ1件まで（exceptRecordId は自分自身を除くため） */
function assertNoOtherRecord_(t, userId, gameId, exceptRecordId) {
  const exists = readRecords_(t.sheet).some(function (r) {
    return r.user_id === userId && r.game_id === gameId && !r.deleted_at && r.record_id !== exceptRecordId;
  });
  if (exists) {
    throw new AppError(APP_ERROR.VALIDATION_ERROR, '入力内容に誤りがあります', [
      { field: 'game_id', message: 'この試合の' + t.label + '成績は、すでに入力されています（一覧から修正してください）' },
    ]);
  }
}

/** 試合の一覧を { game_id: 試合 } の形で（消した試合も含む。成績の側から引くため） */
function gamesById_() {
  const map = {};
  readRecords_(CONFIG.SHEET.GAMES).forEach(function (g) { map[g.game_id] = g; });
  return map;
}

/* ---------- 期限と日付 ---------- */

/** 試合日から今日までが、0〜30日か */
function isWithinEditPeriod_(gameDate, today) {
  const days = daysBetween_(gameDate, today);
  return days >= 0 && days <= CONFIG.RECORD_EDIT_DAYS;
}

/** 「yyyy-MM-dd」の2つの日付の差（日数）。to − from */
function daysBetween_(from, to) {
  const toUtc = function (text) {
    return Date.UTC(Number(text.slice(0, 4)), Number(text.slice(5, 7)) - 1, Number(text.slice(8, 10)));
  };
  return Math.round((toUtc(to) - toUtc(from)) / 86400000);
}

/** 試合日に日数を足した日付（yyyy-MM-dd） */
function addDays_(dateText, days) {
  const d = new Date(Date.UTC(Number(dateText.slice(0, 4)), Number(dateText.slice(5, 7)) - 1, Number(dateText.slice(8, 10)) + days));
  return d.toISOString().slice(0, 10);
}

/** 今日の日付（日本時間、yyyy-MM-dd） */
function todayText_(options) {
  return (options && options.today) || Utilities.formatDate(new Date(), CONFIG.TIME_ZONE, 'yyyy-MM-dd');
}

/** シートから読んだ試合日を「yyyy-MM-dd」の文字にそろえる（もし日付の形で入っていても） */
function dateText_(value) {
  if (Object.prototype.toString.call(value) === '[object Date]') {
    return Utilities.formatDate(value, CONFIG.TIME_ZONE, 'yyyy-MM-dd');
  }
  return String(value).trim();
}

/** 修正の前後を比べるために、シートの値を入力と同じ形にそろえる */
function comparableValue_(field, value) {
  if (field === 'game_date') return dateText_(value);
  if (field === 'team_id' || field === 'game_id') return String(value);
  return Number(value);
}

function editPeriodOverError_() {
  return new AppError(APP_ERROR.EDIT_PERIOD_OVER,
    '入力・修正の期限を過ぎています（試合日から' + CONFIG.RECORD_EDIT_DAYS + '日以内の記録だけを入力・修正・削除できます）');
}

/**
 * 画面に返す記録の形。列の名前は入力と同じ（修正の画面にそのまま入れられるように）。
 * 試合の情報（チーム・試合日・第何試合・相手・大会）も付ける。
 * editable：今日、修正・削除ができるか。editable_until：修正・削除ができる最後の日
 */
function toRecordSummary_(t, record, game, user, today) {
  const summary = { record_id: record.record_id };
  t.fields.forEach(function (field) { summary[field] = comparableValue_(field, record[field]); });
  const g = toGameSummary_(game, user, today);
  summary.team_id = g.team_id;
  summary.game_date = g.game_date;
  summary.game_number = g.game_number;
  summary.opponent = g.opponent;
  summary.tournament_id = g.tournament_id;
  summary.tournament_name = g.tournament_name;
  summary.in_my_tournament = g.in_my_tournament;
  if (t.type === 'pitching') {
    // 修正の画面に入れやすいように、入力と同じ「回」と「アウト数」に分けたものと、表示用の投球回も付ける
    summary.innings = Math.floor(summary.outs / 3);
    summary.partial_outs = summary.outs % 3;
    summary.innings_text = formatInnings_(summary.outs);
  }
  summary.editable = isWithinEditPeriod_(summary.game_date, today);
  summary.editable_until = addDays_(summary.game_date, CONFIG.RECORD_EDIT_DAYS);
  return summary;
}
