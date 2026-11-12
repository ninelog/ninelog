/**
 * 入力チェック（CLAUDE.md 第4.5章）
 *
 * 画面から届いた1試合分の成績が正しいかを確かめ、保存する形にそろえて返す。
 * 正しくない項目があれば、項目ごとの説明をまとめて VALIDATION_ERROR で断る。
 *
 * ここで確かめないこと（シートを見る必要があるため、登録の処理 Records.js で確かめる）：
 * - その試合があるか、そのチームに所属しているか、試合日から30日以内か
 * （2026-11-11 B-11：成績は試合に結びつける。チームと試合日の代わりに game_id を受け取る。11.2章）
 */

/** 打撃の入力項目（保存する列の名前、画面に出す名前） */
const BATTING_COUNT_FIELDS = [
  ['plate_appearances', '打席'],
  ['at_bats', '打数'],
  ['hits', '安打'],
  ['doubles', '二塁打'],
  ['triples', '三塁打'],
  ['home_runs', '本塁打'],
  ['rbis', '打点'],
  ['walks', '四球'],
  ['hbp', '死球'],
  ['sacrifice_bunts', '犠打'],
  ['sacrifice_flies', '犠飛'],
  ['strikeouts', '三振'],
  ['stolen_bases', '盗塁'],
];

/**
 * 打撃1試合分の入力を確かめる。
 * @param {Object} data 画面から届いた中身
 * @return {Object} 保存する形（game_id、13項目の数字）
 */
function validateBattingInput_(data) {
  const errors = [];
  const v = {
    game_id: checkGameId_(data.game_id, errors),
  };
  BATTING_COUNT_FIELDS.forEach(function (f) {
    v[f[0]] = checkCount_(data[f[0]], f[0], f[1], CONFIG.MAX_COUNT_PER_GAME, errors);
  });

  // 一つ一つの項目が正しいときだけ、項目どうしの関係を確かめる
  if (errors.length === 0) {
    const used = v.at_bats + v.walks + v.hbp + v.sacrifice_bunts + v.sacrifice_flies;
    if (v.at_bats > v.plate_appearances) {
      addError_(errors, 'at_bats', '打数（' + v.at_bats + '）が打席（' + v.plate_appearances + '）より多くなっています');
    } else if (used > v.plate_appearances) {
      addError_(errors, 'plate_appearances',
        '打席（' + v.plate_appearances + '）が足りません。打数＋四球＋死球＋犠打＋犠飛 ＝ ' + used + ' です');
    }
    if (v.hits > v.at_bats) {
      addError_(errors, 'hits', '安打（' + v.hits + '）が打数（' + v.at_bats + '）より多くなっています');
    }
    const extraBaseHits = v.doubles + v.triples + v.home_runs;
    if (extraBaseHits > v.hits) {
      addError_(errors, 'hits', '二塁打＋三塁打＋本塁打（' + extraBaseHits + '）が安打（' + v.hits + '）より多くなっています');
    }
    if (v.strikeouts > v.at_bats) {
      addError_(errors, 'strikeouts', '三振（' + v.strikeouts + '）が打数（' + v.at_bats + '）より多くなっています');
    } else if (v.hits <= v.at_bats && v.hits + v.strikeouts > v.at_bats) {
      // 1打数の結果は、安打か三振のどちらか一方にしかならない
      // （安打・三振それぞれが打数を超えるときは、上でその説明を出すので、ここでは重ねて出さない）
      addError_(errors, 'strikeouts',
        '安打（' + v.hits + '）＋三振（' + v.strikeouts + '）＝ ' + (v.hits + v.strikeouts) +
        ' が打数（' + v.at_bats + '）より多くなっています');
    }
  }

  throwIfErrors_(errors);
  return v;
}

/**
 * 投手1試合分の入力を確かめる。
 * 画面では投球回を「回（innings）」と「アウト数（partial_outs：0〜2）」に分けて入力し、
 * 保存するときは アウト数の合計 outs ＝ 回×3＋アウト数 にする（第4.4b章）。
 * @return {Object} 保存する形（game_id、outs、earned_runs）
 */
function validatePitchingInput_(data) {
  const errors = [];
  const gameId = checkGameId_(data.game_id, errors);
  const innings = checkCount_(data.innings, 'innings', '投球回（回）', CONFIG.MAX_COUNT_PER_GAME, errors);
  const partialOuts = checkCount_(data.partial_outs, 'partial_outs', '投球回（アウト数）', 2, errors);
  const earnedRuns = checkCount_(data.earned_runs, 'earned_runs', '自責点', CONFIG.MAX_COUNT_PER_GAME, errors);

  throwIfErrors_(errors);
  return {
    game_id: gameId,
    outs: innings * 3 + partialOuts,
    earned_runs: earnedRuns,
  };
}

/* ---------- ここから下は、項目ごとの確かめ方 ---------- */

/** 0以上の整数か（上限 max 以下か）を確かめる。数字の文字（"3"）も受け付ける */
function checkCount_(value, field, label, max, errors) {
  if (value === undefined || value === null || value === '') {
    addError_(errors, field, '「' + label + '」を入力してください');
    return null;
  }
  const isDigits = typeof value === 'string' && /^[0-9]+$/.test(value);
  const n = typeof value === 'number' ? value : (isDigits ? Number(value) : NaN);
  if (!Number.isInteger(n) || n < 0) {
    addError_(errors, field, '「' + label + '」は0以上の整数で入力してください');
    return null;
  }
  if (n > max) {
    addError_(errors, field, '「' + label + '」は' + max + '以下で入力してください');
    return null;
  }
  return n;
}

/** 試合が選ばれているかを確かめる（その試合があるか・所属しているかは Records.js で確かめる） */
function checkGameId_(value, errors) {
  if (typeof value !== 'string' || value.trim() === '' || value.length > 64) {
    addError_(errors, 'game_id', '試合を選んでください');
    return null;
  }
  return value.trim();
}

/** チームが選ばれているかを確かめる（所属しているかは、それぞれの処理で確かめる） */
function checkTeamId_(value, errors) {
  if (typeof value !== 'string' || value.trim() === '' || value.length > 64) {
    addError_(errors, 'team_id', 'チームを選んでください');
    return null;
  }
  return value.trim();
}

/** 試合日が「yyyy-MM-dd」の正しい日付で、決められた範囲にあるかを確かめる */
function checkGameDate_(value, errors, options) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    addError_(errors, 'game_date', '試合日を「2026-04-01」の形で入力してください');
    return null;
  }
  // 2月30日のような、存在しない日付を見分ける
  const y = Number(value.slice(0, 4));
  const m = Number(value.slice(5, 7));
  const d = Number(value.slice(8, 10));
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) {
    addError_(errors, 'game_date', '試合日が正しい日付ではありません');
    return null;
  }
  // 文字の形がそろっているので、文字のまま大小を比べられる
  const today = (options && options.today) || Utilities.formatDate(new Date(), CONFIG.TIME_ZONE, 'yyyy-MM-dd');
  if (value < CONFIG.MIN_GAME_DATE || value > today) {
    addError_(errors, 'game_date', '試合日は ' + CONFIG.MIN_GAME_DATE + ' から今日（' + today + '）までの日付にしてください');
    return null;
  }
  return value;
}

function addError_(errors, field, message) {
  errors.push({ field: field, message: message });
}

function throwIfErrors_(errors) {
  if (errors.length > 0) {
    throw new AppError(APP_ERROR.VALIDATION_ERROR, '入力内容に誤りがあります', errors);
  }
}
