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
 *
 * B-24（2026-11-15。読み込みを速くする案B）：
 * ④ 読んだシートの中身を、GASの中（CacheService）に短い間（SHEET_CACHE_SECONDS）覚え、ほかの要求でも使い回す。
 *    - 覚えた中身には「データの版」（スクリプトプロパティ DATA_VERSION）の印を付ける。
 *    - 書き込み（行を足す・書き換える・消す）をしたら、順番待ち（withLock_）を終える前に、書き込みを確定させて
 *      （SpreadsheetApp.flush）から、版を新しくする（commitWrites_）。版が変わると、前の版で覚えた中身は使われない。
 *      → 保存・直す・消すのあとは、必ずシートを読み直した新しい数字になる。
 *    - 版を新しくするのは「確定させたあと」。逆にすると、確定する前の古い中身を新しい版で覚えてしまうため。
 *    - シートを手で直したときは、最長 SHEET_CACHE_SECONDS 秒たつと反映される（すぐ反映したいときは clearSheetCache を実行）。
 *    - 覚えられない・読めないときは、今までどおりシートを読む。
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

/** GASの中にシートの中身を覚えておく時間（秒）。シートを手で直したときに、反映されるまでの最長の時間でもある */
const SHEET_CACHE_SECONDS = 600;
/** 覚えるときに分ける大きさ（文字数）。CacheService は1つの値が100KBまでなので、日本語（1文字3バイト）でも収まる大きさ */
const SHEET_CACHE_CHUNK = 30000;

/**
 * 1回の処理の間だけ覚えておく内容。
 * sheets：シートの名前 → シート（見つけたシートを毎回探し直さない）
 * tables：シートの名前 → { header: 見出しの一覧, records: 行の一覧, maxRows: シートの行の数（書くときに調べる） }
 */
const sheetMemory_ = { sheets: {}, tables: {}, version: null, dirty: false };

/**
 * 覚えた内容を捨てる（name を省くと全部）。順番待ちを始めたときなどに使う。
 * 全部捨てるときは、データの版も読み直す（ほかの人が書き込んで、版が変わったかもしれないため）。
 */
function forgetSheets_(name) {
  if (name) {
    delete sheetMemory_.tables[name];
  } else {
    sheetMemory_.tables = {};
    sheetMemory_.version = null;
  }
}

/* ---------- ④ GASの中に覚える（B-24） ---------- */

/** いまのデータの版（1回の処理の間は覚えておく。読めなければ空＝覚えた中身を使わない） */
function dataVersion_() {
  if (sheetMemory_.version === null) {
    let v = null;
    try {
      v = measure_('props', function () { return PropertiesService.getScriptProperties().getProperty('DATA_VERSION'); });
    } catch (e) { /* そのまま */ }
    sheetMemory_.version = v || '';
  }
  return sheetMemory_.version;
}

/**
 * 書き込みを確定させてから、データの版を新しくする（書き込みが無ければ何もしない）。
 * withLock_ の終わり（順番待ちを終える前）に呼ぶ。
 */
function commitWrites_() {
  if (!sheetMemory_.dirty) return;
  measure_('flush', function () { SpreadsheetApp.flush(); });
  const v = Utilities.getUuid();
  measure_('props', function () { PropertiesService.getScriptProperties().setProperty('DATA_VERSION', v); });
  sheetMemory_.version = v;
  sheetMemory_.dirty = false;
}

/**
 * 覚えた中身をすべて使わないようにする（データの版を新しくする）。
 * シートを手で直して、すぐに画面に反映したいときに、GASの編集画面から実行する。
 */
function clearSheetCache() {
  withLock_(function () { sheetMemory_.dirty = true; });
  Logger.log('GASの中に覚えたシートの中身を、すべて使わないようにしました。次に開いたときは、シートを読み直します。');
}

function sheetCacheKey_(version, name) {
  return 'st:' + version + ':' + name;
}

/** 行の一覧を文字にする（日時は {"$d": ミリ秒} の形にして、読み戻すときに日時に戻す） */
function encodeTable_(table) {
  return JSON.stringify({ header: table.header, records: table.records }, function (key, value) {
    const raw = this[key];
    if (Object.prototype.toString.call(raw) === '[object Date]') return { $d: raw.getTime() };
    return value;
  });
}

function decodeTable_(text) {
  return JSON.parse(text, function (key, value) {
    if (value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 1 && typeof value.$d === 'number') {
      return new Date(value.$d);
    }
    return value;
  });
}

/** 覚えた中身を取り出す（無ければ null） */
function readTableCache_(name) {
  const version = dataVersion_();
  if (!version) return null;
  try {
    return measure_('cacheGet', function () {
      const cache = CacheService.getScriptCache();
      const key = sheetCacheKey_(version, name);
      const count = Number(cache.get(key));
      if (!count) return null;
      const keys = [];
      for (let i = 0; i < count; i++) keys.push(key + ':' + i);
      const parts = cache.getAll(keys);
      let text = '';
      for (let i = 0; i < count; i++) {
        if (typeof parts[keys[i]] !== 'string') return null; // 一部が消えていたら使わない
        text += parts[keys[i]];
      }
      return decodeTable_(text);
    });
  } catch (e) {
    return null;
  }
}

/** 読んだ中身を覚える（覚えられなくても、そのまま動く） */
function writeTableCache_(name, table) {
  const version = dataVersion_();
  if (!version) return;
  try {
    measure_('cachePut', function () {
      const text = encodeTable_(table);
      const key = sheetCacheKey_(version, name);
      const values = {};
      let count = 0;
      for (let i = 0; i < text.length; i += SHEET_CACHE_CHUNK) {
        values[key + ':' + count] = text.slice(i, i + SHEET_CACHE_CHUNK);
        count++;
      }
      values[key] = String(count);
      CacheService.getScriptCache().putAll(values, SHEET_CACHE_SECONDS);
    });
  } catch (e) { /* 覚えられなくても動く */ }
}

/** 見出しに、設計どおりの列がそろっているか */
function checkHeader_(name, header) {
  (SHEET_COLUMNS[name] || []).forEach(function (col) {
    if (header.indexOf(col) === -1) {
      throw new AppError(APP_ERROR.INTERNAL, 'シート「' + name + '」に見出し「' + col + '」がありません');
    }
  });
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

  // ほかの要求で覚えた中身（いまの版のもの）があれば、シートを読まずに使う（B-24）
  // この処理ですでに書き込んだあと（例：行を消して読み直すとき）は、覚えた中身が古いので使わない
  const cached = sheetMemory_.dirty ? null : readTableCache_(name);
  if (cached) {
    checkHeader_(name, cached.header);
    sheetMemory_.tables[name] = cached;
    return cached;
  }

  const sheetForRead = getSheet_(name);
  const values = measure_('read', function () { return sheetForRead.getDataRange().getValues(); });
  const header = values.length > 0 ? values[0].map(function (h) { return String(h).trim(); }) : [];
  checkHeader_(name, header);
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
  // この処理で書き込んだあと（版を新しくする前）に読んだ中身は覚えない（次の要求が、新しい版で覚え直す）
  if (!sheetMemory_.dirty) writeTableCache_(name, table);
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

  sheetMemory_.dirty = true; // 順番待ちの終わりに、データの版を新しくする（B-24）
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
  sheetMemory_.dirty = true;
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
  sheetMemory_.dirty = true;
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
