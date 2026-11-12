/**
 * スプレッドシートの読み書きの部品（CLAUDE.md 第4章）
 *
 * シートの1行目（見出し）の名前を使って、1行を { 列の名前: 値 } の形で扱う。
 * 列の順番が変わっても、見出しの名前が同じなら動く。
 *
 * B-11b（読み書きの高速化）：
 * ① 読み込んだシートの内容を、1回の処理（1回の要求、または1回のテストの実行）の間だけ覚えておく。
 *    同じシートを2回目に読むときは、スプレッドシートに問い合わせずに覚えた内容を使う。
 *    - 行を足す・書き換えるときは、覚えた内容も同じように直す（読み直さなくて済むように）。
 *    - 行を消したとき（行の番号がずれる）と、順番待ち（withLock_）を始めたとき（ほかの人が
 *      書き込んだかもしれない）は、覚えた内容を捨てて、次に読むときに読み直す。
 * ② 1行を書き換えるときは、変わった項目ごとではなく、行ごとにまとめて1回で書く。
 * ③ 行を消すときは、続いている行をまとめて1回で消す。
 */

/** シートごとに、必ずある見出しの一覧（CLAUDE.md 第4章の表と同じ） */
const SHEET_COLUMNS = {
  users: ['user_id', 'display_name', 'name_source', 'created_at', 'updated_at'],
  teams: ['team_id', 'team_number', 'team_name', 'passphrase_hash', 'passphrase_salt', 'created_by', 'created_at', 'updated_at', 'org_type'],
  games: ['game_id', 'team_id', 'tournament_id', 'game_date', 'game_number', 'opponent', 'category', 'result',
    'created_by', 'created_at', 'updated_at', 'deleted_at'],
  memberships: ['membership_id', 'user_id', 'team_id', 'role', 'joined_at'],
  join_attempts: ['user_id', 'fail_count', 'locked_until', 'updated_at'],
  // 2026-11-11 B-11：team_id・game_date の列をやめて game_id にした（11.2章）
  batting_records: ['record_id', 'user_id', 'game_id', 'plate_appearances', 'at_bats', 'hits',
    'doubles', 'triples', 'home_runs', 'rbis', 'walks', 'hbp', 'sacrifice_bunts', 'sacrifice_flies',
    'strikeouts', 'stolen_bases', 'created_at', 'updated_at', 'deleted_at'],
  pitching_records: ['record_id', 'user_id', 'game_id', 'outs', 'earned_runs',
    'created_at', 'updated_at', 'deleted_at'],
  record_changes: ['change_id', 'changed_at', 'user_id', 'record_type', 'record_id', 'action',
    'field', 'old_value', 'new_value'],
};

/** シートの行が足りなくなったときに、まとめて足す行の数 */
const SHEET_GROW_ROWS = 100;

/**
 * 1回の処理の間だけ覚えておく内容。
 * sheets：シートの名前 → シート（見つけたシートを毎回探し直さない）
 * tables：シートの名前 → { header: 見出しの一覧, records: 行の一覧, maxRows: シートの行の数（書くときに調べる） }
 */
const sheetMemory_ = { sheets: {}, tables: {} };

/** 覚えた内容を捨てる（name を省くと全部）。順番待ちを始めたときなどに使う */
function forgetSheets_(name) {
  if (name) {
    delete sheetMemory_.tables[name];
  } else {
    sheetMemory_.tables = {};
  }
}

/** シートを取り出す。見つからなければエラー */
function getSheet_(name) {
  if (!sheetMemory_.sheets[name]) {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
    if (!sheet) {
      throw new AppError(APP_ERROR.INTERNAL, 'シートが見つかりません：' + name);
    }
    sheetMemory_.sheets[name] = sheet;
  }
  return sheetMemory_.sheets[name];
}

/** 見出しの一覧（設計どおりの列がそろっているかも確かめる。覚えていればそれを使う） */
function readHeader_(sheet, name) {
  return loadTable_(name).header;
}

/**
 * シートの見出しと全部の行を、1回の問い合わせ（getDataRange）でまとめて読み、覚えておく。
 * （前は「行の数」「見出し」「中身」を別々に問い合わせていた）
 */
function loadTable_(name) {
  const remembered = sheetMemory_.tables[name];
  if (remembered) return remembered;

  const sheetForRead = getSheet_(name);
  const values = measure_('read', function () { return sheetForRead.getDataRange().getValues(); });
  const header = values.length > 0 ? values[0].map(function (h) { return String(h).trim(); }) : [];
  (SHEET_COLUMNS[name] || []).forEach(function (col) {
    if (header.indexOf(col) === -1) {
      throw new AppError(APP_ERROR.INTERNAL, 'シート「' + name + '」に見出し「' + col + '」がありません');
    }
  });
  const records = [];
  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    // 中身が全部空の行（下のほうの空白）は読まない
    if (row.every(function (v) { return v === '' || v === null; })) continue;
    const record = { _row: i + 1 };
    header.forEach(function (col, j) { record[col] = row[j]; });
    records.push(record);
  }
  const table = { header: header, records: records };
  sheetMemory_.tables[name] = table;
  return table;
}

/**
 * シートの全部の行を読む（覚えていればそれを使う）。
 * 返すのは行の写し（呼んだ側が中身を書き換えても、覚えた内容は変わらない）。
 * @return {Array<Object>} 1行ずつ { 列の名前: 値, _row: 行番号 }
 */
function readRecords_(name) {
  return loadRecords_(name).map(function (r) { return Object.assign({}, r); });
}

/** 覚えた行の一覧そのもの（この部品の中だけで使う） */
function loadRecords_(name) {
  return loadTable_(name).records;
}

/** 条件に合う最初の1行を返す（無ければ null） */
function findRecord_(name, predicate) {
  const records = loadRecords_(name);
  for (let i = 0; i < records.length; i++) {
    if (predicate(records[i])) return Object.assign({}, records[i]);
  }
  return null;
}

/**
 * 1行を一番下に足す。record に無い列は空のまま。
 * 書き込む前に、マスごとの表示形式を決める（cellFormat_）。
 * こうしないと、スプレッドシートが「2026-11-10」を日付に、「0123」を数の123に、勝手に変えてしまう
 * （列を書式なしテキストにしてあっても、appendRow で足した行には効かないことがある。B-7で確認）。
 */
function appendRecord_(name, record) {
  const table = loadTable_(name); // 一番下の行番号を知るため（覚えていれば問い合わせない）
  const records = table.records;
  const sheet = getSheet_(name);
  const header = table.header;
  const values = header.map(function (col) {
    return record[col] === undefined || record[col] === null ? '' : record[col];
  });
  const row = records.length > 0 ? records[records.length - 1]._row + 1 : 2;

  // シートの行が足りなければ、下に行を足す（appendRow と違い、行番号を指定して書くと自動では増えないため）
  measure_('grow', function () {
    if (table.maxRows === undefined) table.maxRows = sheet.getMaxRows();
    if (row > table.maxRows) {
      sheet.insertRowsAfter(table.maxRows, SHEET_GROW_ROWS);
      table.maxRows += SHEET_GROW_ROWS;
    }
  });

  measure_('write', function () {
    const range = sheet.getRange(row, 1, 1, header.length);
    range.setNumberFormats([values.map(cellFormat_)]);
    range.setValues([values]);
  });

  // 覚えた内容にも足す
  const added = { _row: row };
  header.forEach(function (col, j) { added[col] = values[j]; });
  records.push(added);
}

/**
 * 行番号 row の、changes に書いた列を書き換える（表示形式も appendRecord_ と同じ決め方）。
 * 行全体をまとめて1回で書く（変わっていない列は、今の値をそのまま書き戻す）。
 */
function updateRecord_(name, row, changes) {
  const records = loadRecords_(name);
  const sheet = getSheet_(name);
  const header = readHeader_(sheet, name);
  Object.keys(changes).forEach(function (col) {
    if (header.indexOf(col) === -1) {
      throw new AppError(APP_ERROR.INTERNAL, 'シート「' + name + '」に見出し「' + col + '」がありません');
    }
  });

  let current = null;
  for (let i = 0; i < records.length; i++) {
    if (records[i]._row === row) { current = records[i]; break; }
  }
  if (!current) {
    throw new AppError(APP_ERROR.INTERNAL, 'シート「' + name + '」の ' + row + ' 行目が見つかりません');
  }

  const values = header.map(function (col) {
    const value = Object.prototype.hasOwnProperty.call(changes, col) ? changes[col] : current[col];
    return value === null || value === undefined ? '' : value;
  });
  measure_('write', function () {
    const range = sheet.getRange(row, 1, 1, header.length);
    range.setNumberFormats([values.map(cellFormat_)]);
    range.setValues([values]);
  });

  // 覚えた内容も同じように直す
  header.forEach(function (col, j) { current[col] = values[j]; });
}

/**
 * 行番号の一覧の行を消す。続いている行はまとめて1回で消す（下の行から消すと、上の行の番号がずれない）。
 * 消したあとは行の番号がずれるので、そのシートの覚えた内容を捨てる。
 */
function deleteRows_(name, rows) {
  if (rows.length === 0) return;
  const sheet = getSheet_(name);
  const sorted = rows.slice().sort(function (a, b) { return b - a; }); // 大きい順
  let i = 0;
  while (i < sorted.length) {
    // sorted[i] から上に向かって、続いている行をまとめる（例：12,11,10 → 10行目から3行）
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] - 1) j++;
    const first = sorted[j];
    const count = j - i + 1;
    measure_('delete', function () { sheet.deleteRows(first, count); });
    i = j + 1;
  }
  forgetSheets_(name);
}

/**
 * 値の種類から、マスの表示形式を決める。
 * - 文字（空も含む）：書式なしテキスト（'@'）。書いたとおりの文字のまま残る
 * - 日時：「2026-11-10 21:05:00」の形
 * - 数：整数の形（このアプリの数は、どれも整数）
 */
function cellFormat_(value) {
  if (Object.prototype.toString.call(value) === '[object Date]') return 'yyyy-mm-dd hh:mm:ss';
  if (typeof value === 'number') return '0';
  return '@';
}
