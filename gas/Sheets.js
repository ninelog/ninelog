/**
 * スプレッドシートの読み書きの部品（CLAUDE.md 第4章）
 *
 * シートの1行目（見出し）の名前を使って、1行を { 列の名前: 値 } の形で扱う。
 * 列の順番が変わっても、見出しの名前が同じなら動く。
 */

/** シートごとに、必ずある見出しの一覧（CLAUDE.md 第4章の表と同じ） */
const SHEET_COLUMNS = {
  users: ['user_id', 'display_name', 'name_source', 'created_at', 'updated_at'],
  teams: ['team_id', 'team_number', 'team_name', 'passphrase_hash', 'passphrase_salt', 'created_by', 'created_at', 'updated_at'],
  memberships: ['membership_id', 'user_id', 'team_id', 'role', 'joined_at'],
  join_attempts: ['user_id', 'fail_count', 'locked_until', 'updated_at'],
};

/** シートを取り出す。見つからなければエラー */
function getSheet_(name) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sheet) {
    throw new AppError(APP_ERROR.INTERNAL, 'シートが見つかりません：' + name);
  }
  return sheet;
}

/** 見出しの一覧を読み、設計どおりの列がそろっているか確かめる */
function readHeader_(sheet, name) {
  const lastColumn = sheet.getLastColumn();
  const header = lastColumn > 0
    ? sheet.getRange(1, 1, 1, lastColumn).getValues()[0].map(function (h) { return String(h).trim(); })
    : [];
  (SHEET_COLUMNS[name] || []).forEach(function (col) {
    if (header.indexOf(col) === -1) {
      throw new AppError(APP_ERROR.INTERNAL, 'シート「' + name + '」に見出し「' + col + '」がありません');
    }
  });
  return header;
}

/**
 * シートの全部の行を読む。
 * @return {Array<Object>} 1行ずつ { 列の名前: 値, _row: 行番号 }
 */
function readRecords_(name) {
  const sheet = getSheet_(name);
  const header = readHeader_(sheet, name);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  const values = sheet.getRange(2, 1, lastRow - 1, header.length).getValues();
  return values.map(function (row, i) {
    const record = { _row: i + 2 };
    header.forEach(function (col, j) { record[col] = row[j]; });
    return record;
  });
}

/** 条件に合う最初の1行を返す（無ければ null） */
function findRecord_(name, predicate) {
  const records = readRecords_(name);
  for (let i = 0; i < records.length; i++) {
    if (predicate(records[i])) return records[i];
  }
  return null;
}

/** 1行を一番下に足す。record に無い列は空のまま */
function appendRecord_(name, record) {
  const sheet = getSheet_(name);
  const header = readHeader_(sheet, name);
  sheet.appendRow(header.map(function (col) {
    return record[col] === undefined || record[col] === null ? '' : record[col];
  }));
}

/** 行番号 row の、changes に書いた列だけを書き換える */
function updateRecord_(name, row, changes) {
  const sheet = getSheet_(name);
  const header = readHeader_(sheet, name);
  Object.keys(changes).forEach(function (col) {
    const index = header.indexOf(col);
    if (index === -1) {
      throw new AppError(APP_ERROR.INTERNAL, 'シート「' + name + '」に見出し「' + col + '」がありません');
    }
    sheet.getRange(row, index + 1).setValue(changes[col] === null ? '' : changes[col]);
  });
}
