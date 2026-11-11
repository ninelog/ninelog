/**
 * 成績の登録・一覧・修正・削除（CLAUDE.md 第4.4章・第4.4b章・第4.5b章）
 *
 * 打撃（B-7）と投手（B-8）で同じルールを使うため、共通の作りにしている。
 * 投手は、画面では「回（innings）」と「アウト数（partial_outs：0〜2）」で入力し、
 * 保存・比較・変更の記録は、アウト数の合計 outs で行う（4.4b章）。
 * - 入力・修正・削除ができるのは、本人が自分の記録に対してだけ（管理者も他人の記録には触れない）
 * - 試合日（0日目）から30日目まで（Config.js の RECORD_EDIT_DAYS）。過ぎたら EDIT_PERIOD_OVER
 * - 入力できるのは、自分が所属しているチームの成績だけ
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
      fields: ['team_id', 'game_date'].concat(BATTING_COUNT_FIELDS.map(function (f) { return f[0]; })),
    },
    pitching: {
      type: 'pitching',
      sheet: CONFIG.SHEET.PITCHING,
      validate: validatePitchingInput_,
      fields: ['team_id', 'game_date', 'outs', 'earned_runs'],
    },
  };
}

/* ---------- 打撃の操作（Main.js の getActions_ に登録） ---------- */

/** 操作：addBattingRecord（打撃成績を1試合分登録する）。data は 4.4章の入力項目＋team_id・game_date */
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
 * data: { team_id, game_date, innings: 回, partial_outs: アウト数（0〜2）, earned_runs: 自責点 }
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
  const values = t.validate(data, { today: today });
  if (!isWithinEditPeriod_(values.game_date, today)) {
    throw editPeriodOverError_();
  }
  if (!findMembership_(user.userId, values.team_id)) {
    throw new AppError(APP_ERROR.FORBIDDEN, '所属していないチームの成績は入力できません');
  }

  const now = new Date();
  const record = Object.assign({ record_id: Utilities.getUuid(), user_id: user.userId }, values, {
    created_at: now, updated_at: now, deleted_at: '',
  });
  appendRecord_(t.sheet, record);
  return { record: toRecordSummary_(t, record, today) };
}

function listGameRecords_(type, data, user, options) {
  const t = recordTypes_()[type];
  const today = todayText_(options);
  const teamId = typeof data.team_id === 'string' && data.team_id !== '' ? data.team_id : null;

  const records = readRecords_(t.sheet)
    .filter(function (r) { return r.user_id === user.userId && !r.deleted_at; })
    .filter(function (r) { return !teamId || r.team_id === teamId; })
    .sort(function (a, b) {
      // 試合日の新しい順。同じ日なら、あとから入力した順
      const byDate = dateText_(b.game_date).localeCompare(dateText_(a.game_date));
      return byDate !== 0 ? byDate : new Date(b.created_at) - new Date(a.created_at);
    });
  return { records: records.map(function (r) { return toRecordSummary_(t, r, today); }) };
}

function updateGameRecord_(type, data, user, options) {
  const t = recordTypes_()[type];
  const today = todayText_(options);
  const current = findOwnActiveRecord_(t, data.record_id, user);
  if (!isWithinEditPeriod_(dateText_(current.game_date), today)) {
    throw editPeriodOverError_();
  }

  const values = t.validate(data, { today: today });
  // 試合日を変えるときは、新しい試合日も期限の中であること（期限切れの記録を復活させないため）
  if (!isWithinEditPeriod_(values.game_date, today)) {
    throw editPeriodOverError_();
  }
  if (values.team_id !== String(current.team_id) && !findMembership_(user.userId, values.team_id)) {
    throw new AppError(APP_ERROR.FORBIDDEN, '所属していないチームの成績は入力できません');
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
    return { unchanged: true, record: toRecordSummary_(t, current, today) };
  }

  const now = new Date();
  const update = { updated_at: now };
  Object.keys(changes).forEach(function (field) { update[field] = changes[field].newValue; });
  updateRecord_(t.sheet, current._row, update);
  appendRecordChanges_(t.type, current.record_id, user.userId, 'update', changes, now);

  return { unchanged: false, record: toRecordSummary_(t, Object.assign({}, current, update), today) };
}

function deleteGameRecord_(type, data, user, options) {
  const t = recordTypes_()[type];
  const today = todayText_(options);
  const current = findOwnActiveRecord_(t, data.record_id, user);
  if (!isWithinEditPeriod_(dateText_(current.game_date), today)) {
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
  if (field === 'team_id') return String(value);
  return Number(value);
}

function editPeriodOverError_() {
  return new AppError(APP_ERROR.EDIT_PERIOD_OVER,
    '入力・修正の期限を過ぎています（試合日から' + CONFIG.RECORD_EDIT_DAYS + '日以内の記録だけを入力・修正・削除できます）');
}

/**
 * 画面に返す記録の形。列の名前は入力と同じ（修正の画面にそのまま入れられるように）。
 * editable：今日、修正・削除ができるか。editable_until：修正・削除ができる最後の日
 */
function toRecordSummary_(t, record, today) {
  const summary = { record_id: record.record_id };
  t.fields.forEach(function (field) { summary[field] = comparableValue_(field, record[field]); });
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
