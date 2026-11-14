/**
 * 公開前に、テストのデータをまとめて消す（2026-11-15 利用者が決定。D-3 が終わって、チームに公開する直前に1回だけ動かす）
 *
 * 画面（Webアプリ）からは呼べない（操作の一覧 getActions_ に入れていない）。GASの編集画面から関数を実行するだけ。
 *
 * 何を消して、何を残すか（利用者が了承した表。CLAUDE.md 8.13章）：
 * | シート | 消すもの | 残すもの |
 * | users | なし | すべて（利用者の登録と表示名） |
 * | teams | 予約番号（1〜1998）のチーム・大会、ひとりの記録、自動テスト専用の番号、PURGE_DELETE_TEAM_NUMBERS に書いた本物の番号 | それ以外の本物の番号（1999〜）のチーム・大会 |
 * | memberships | 消すチーム・大会の参加と、チームの無い参加 | 残すチーム・大会の参加 |
 * | games・batting_records・pitching_records・record_changes・join_attempts | すべて | なし |
 * スクリプトプロパティ：テストの途中の TEST_ALL_REMAINING だけ消す（隠し味・合鍵・管理者などは残す）。
 *
 * 動かし方（2段にして、消す前に件数を確かめる）：
 * 1. 本物の番号のチーム・大会で消したいものがあれば、スクリプトプロパティ PURGE_DELETE_TEAM_NUMBERS に番号をカンマ区切りで入れる
 * 2. previewPurge を実行する → 実行ログに、消す件数の表と「確かめの番号」が出る（何も消さない）
 * 3. 表を確かめたら、スクリプトプロパティ PURGE_CONFIRM に「確かめの番号」を入れる
 * 4. runPurge を実行する → 同じスプレッドシートの中に、消す前の各シートの控え（「控え_games_20261120_2130」など）を作ってから消す
 *    previewPurge のあとに中身が1件でも変わっていたら、確かめの番号が合わなくなり、何も消さずに止まる（2からやり直す）
 */

/** 中身をすべて消すシート */
function purgeAllSheets_() {
  return [CONFIG.SHEET.GAMES, CONFIG.SHEET.BATTING, CONFIG.SHEET.PITCHING, CONFIG.SHEET.RECORD_CHANGES, CONFIG.SHEET.JOIN_ATTEMPTS];
}

/** 控えを作るシート（変えない users も、念のため控えを作る） */
function purgeBackupSheets_() {
  return [CONFIG.SHEET.USERS, CONFIG.SHEET.TEAMS, CONFIG.SHEET.MEMBERSHIPS].concat(purgeAllSheets_());
}

/** スクリプトプロパティ PURGE_DELETE_TEAM_NUMBERS（消す本物の番号。カンマ区切り）を読む */
function purgeDeleteNumbers_() {
  const text = PropertiesService.getScriptProperties().getProperty('PURGE_DELETE_TEAM_NUMBERS') || '';
  return text.split(',').map(function (s) { return toHalfWidthDigits_(s.trim()); }).filter(Boolean);
}

/** 全角の数字を半角にする（スクリプトプロパティに全角で入れても読めるように） */
function toHalfWidthDigits_(s) {
  return String(s).replace(/[０-９]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); });
}

/** 消すシートの中身を読む */
function purgeReadTables_() {
  const tables = {};
  purgeBackupSheets_().forEach(function (name) { tables[name] = readRecords_(name); });
  return tables;
}

/**
 * 何を消すかを決める（シートには触れない）。
 * tables：{ シートの名前: 行の一覧 }、deleteNumbers：消す本物の番号の一覧。
 * rowFilter（テストのときだけ使う）：(シートの名前, 行) が true の行だけを、消す候補にする。
 * @return { rows: { シートの名前: 消す行の一覧 }, teamsDeleted, teamsKept, unknownNumbers }
 */
function purgePlan_(tables, deleteNumbers, rowFilter) {
  const allowed = rowFilter || function () { return true; };
  const numbers = deleteNumbers.map(String);
  const teams = tables[CONFIG.SHEET.TEAMS] || [];
  const teamDeleteReason = function (t) {
    const type = orgTypeOf_(t);
    const n = Number(t.team_number);
    if (type === ORG_TYPE.SOLO) return 'ひとりの記録';
    if (n >= 1 && n <= CONFIG.RESERVED_TEAM_NUMBER_MAX) return '予約番号（テスト用）';
    if (isTestTeamNumber_(t.team_number)) return '自動テスト専用の番号';
    if (numbers.indexOf(String(t.team_number)) !== -1) return '消すと決めた番号';
    return '';
  };
  const teamsDeleted = [];
  const teamsKept = [];
  teams.forEach(function (t) {
    if (!allowed(CONFIG.SHEET.TEAMS, t)) return;
    const reason = teamDeleteReason(t);
    (reason ? teamsDeleted : teamsKept).push({ record: t, reason: reason });
  });
  const deletedIds = {};
  teamsDeleted.forEach(function (d) { deletedIds[d.record.team_id] = true; });
  const existingIds = {};
  teams.forEach(function (t) { existingIds[t.team_id] = true; });

  const rows = {};
  rows[CONFIG.SHEET.USERS] = [];
  rows[CONFIG.SHEET.TEAMS] = teamsDeleted.map(function (d) { return d.record; });
  rows[CONFIG.SHEET.MEMBERSHIPS] = (tables[CONFIG.SHEET.MEMBERSHIPS] || []).filter(function (m) {
    return allowed(CONFIG.SHEET.MEMBERSHIPS, m) && (deletedIds[m.team_id] || !existingIds[m.team_id]);
  });
  purgeAllSheets_().forEach(function (name) {
    rows[name] = (tables[name] || []).filter(function (r) { return allowed(name, r); });
  });

  // 消すと決めた番号のうち、本物の番号のチーム・大会として見つからないもの（打ち間違いかもしれないので止める）
  const realNumbers = teams.filter(function (t) { return orgTypeOf_(t) !== ORG_TYPE.SOLO; }).map(function (t) { return String(t.team_number); });
  const unknownNumbers = numbers.filter(function (n) { return realNumbers.indexOf(n) === -1; });

  return { rows: rows, teamsDeleted: teamsDeleted, teamsKept: teamsKept, unknownNumbers: unknownNumbers };
}

/**
 * 確かめの番号：データの版と、消す行の一覧から作る8文字。
 * previewPurge のあとに中身が変わる（データの版が変わる）と、別の番号になる。
 */
function purgeConfirmCode_(plan, version) {
  const ids = {};
  Object.keys(plan.rows).sort().forEach(function (name) {
    ids[name] = plan.rows[name].map(function (r) { return r._row; });
  });
  const text = String(version || '') + '|' + JSON.stringify(ids) + '|' + JSON.stringify(plan.unknownNumbers);
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8);
  return bytes.slice(0, 4).map(function (b) { return ('0' + ((b + 256) % 256).toString(16)).slice(-2); }).join('').toUpperCase();
}

/** 実行ログに出す、消す件数の表 */
function purgeSummaryLines_(tables, plan) {
  const lines = ['| シート | 今の行数 | 消す | 残す |', '|---|---|---|---|'];
  purgeBackupSheets_().forEach(function (name) {
    const total = (tables[name] || []).length;
    const del = (plan.rows[name] || []).length;
    lines.push('| ' + name + ' | ' + total + ' | ' + del + ' | ' + (total - del) + ' |');
  });
  const typeLabel = function (t) {
    const type = orgTypeOf_(t);
    return type === ORG_TYPE.SOLO ? 'ひとり' : type === ORG_TYPE.TOURNAMENT ? '大会' : 'チーム';
  };
  const members = function (t) {
    return (tables[CONFIG.SHEET.MEMBERSHIPS] || []).filter(function (m) { return m.team_id === t.team_id; }).length;
  };
  lines.push('');
  lines.push('■ 消すチーム・大会（' + plan.teamsDeleted.length + '）');
  const soloCount = plan.teamsDeleted.filter(function (d) { return orgTypeOf_(d.record) === ORG_TYPE.SOLO; }).length;
  plan.teamsDeleted.forEach(function (d) {
    if (orgTypeOf_(d.record) === ORG_TYPE.SOLO) return;
    lines.push('- 番号 ' + d.record.team_number + '　' + typeLabel(d.record) + '「' + d.record.team_name + '」　メンバー ' + members(d.record) + '人　（' + d.reason + '）');
  });
  if (soloCount) lines.push('- ひとりの記録 ' + soloCount + '件');
  lines.push('');
  lines.push('■ 残すチーム・大会（' + plan.teamsKept.length + '）　※ 試合と成績は消えます。メンバーの参加は残ります');
  plan.teamsKept.forEach(function (d) {
    lines.push('- 番号 ' + d.record.team_number + '　' + typeLabel(d.record) + '「' + d.record.team_name + '」　メンバー ' + members(d.record) + '人');
  });
  if (plan.unknownNumbers.length) {
    lines.push('');
    lines.push('■ 注意：PURGE_DELETE_TEAM_NUMBERS の番号のうち、見つからないもの：' + plan.unknownNumbers.join(', ') + '（このままでは runPurge は止まります）');
  }
  return lines;
}

/**
 * ① 消す件数を確かめる（何も消さない）。GASの編集画面から実行する。
 */
function previewPurge() {
  forgetSheets_();
  const tables = purgeReadTables_();
  const plan = purgePlan_(tables, purgeDeleteNumbers_());
  const code = purgeConfirmCode_(plan, dataVersion_());
  const lines = ['===== 公開前にテストのデータを消す：確かめ（まだ何も消していません） ====='].concat(purgeSummaryLines_(tables, plan));
  lines.push('');
  lines.push('確かめの番号：' + code);
  lines.push('この表のとおりに消してよければ、スクリプトプロパティ PURGE_CONFIRM に「' + code + '」を入れてから、runPurge を実行してください。');
  lines.push('runPurge は、消す前に、同じスプレッドシートの中に各シートの控え（「控え_シートの名前_日時」）を作ります。');
  Logger.log(lines.join('\n'));
  return { code: code, plan: plan };
}

/**
 * ② 控えを作ってから消す。GASの編集画面から実行する。
 */
function runPurge() {
  const result = runPurgeCore_();
  Logger.log(result.message);
  return result;
}

/** runPurge の中身（テストからも呼べるように分けた）。返事：{ done, stopped（止まった理由）, message } */
function runPurgeCore_() {
  const props = PropertiesService.getScriptProperties();
  return withLock_(function () {
    const confirm = String(props.getProperty('PURGE_CONFIRM') || '').trim().toUpperCase();
    if (!confirm) {
      return { done: false, stopped: 'NO_CONFIRM', message: '止めました：スクリプトプロパティ PURGE_CONFIRM がありません。先に previewPurge を実行して、確かめの番号を入れてください。何も消していません。' };
    }
    const tables = purgeReadTables_();
    const plan = purgePlan_(tables, purgeDeleteNumbers_());
    const code = purgeConfirmCode_(plan, dataVersion_());
    if (confirm !== code) {
      return { done: false, stopped: 'MISMATCH', message: '止めました：確かめの番号が合いません（previewPurge のあとに中身が変わったか、番号の打ち間違いです）。previewPurge からやり直してください。何も消していません。' };
    }
    if (plan.unknownNumbers.length) {
      return { done: false, stopped: 'UNKNOWN_NUMBER', message: '止めました：PURGE_DELETE_TEAM_NUMBERS の番号 ' + plan.unknownNumbers.join(', ') + ' が見つかりません。番号を直して、previewPurge からやり直してください。何も消していません。' };
    }
    const backups = backupSheets_(purgeBackupSheets_(), new Date());
    applyPurgePlan_(plan);
    ['PURGE_CONFIRM', 'PURGE_DELETE_TEAM_NUMBERS', 'TEST_ALL_REMAINING'].forEach(function (k) { props.deleteProperty(k); });
    const counts = Object.keys(plan.rows).filter(function (n) { return plan.rows[n].length; })
      .map(function (n) { return n + ' ' + plan.rows[n].length + '行'; });
    return {
      done: true,
      stopped: '',
      message: '消しました：' + (counts.join('、') || 'なし') + '。\n控えのシート：' + backups.join('、') +
        '\n控えのシートは、公開してしばらくたって問題がなければ、手で消してください（プログラムは控えのシートを使いません）。',
    };
  });
}

/** 決めた行を消す（シートごとに、続いている行をまとめて消す。順番待ちの中で呼ぶ） */
function applyPurgePlan_(plan) {
  Object.keys(plan.rows).forEach(function (name) {
    deleteRows_(name, plan.rows[name].map(function (r) { return r._row; }));
  });
}

/** 控えのシートの名前：控え_games_20261120_2130 */
function purgeBackupName_(name, date) {
  return '控え_' + name + '_' + Utilities.formatDate(date, CONFIG.TIME_ZONE, 'yyyyMMdd_HHmm');
}

/** 同じスプレッドシートの中に、シートの控えを作る（同じ名前があれば、後ろに番号を付ける）。作った名前の一覧を返す */
function backupSheets_(names, date) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  SpreadsheetApp.flush();
  return names.map(function (name) {
    const base = purgeBackupName_(name, date);
    let label = base;
    for (let i = 2; ss.getSheetByName(label); i++) label = base + '_' + i;
    const copy = getSheet_(name).copyTo(ss);
    copy.setName(label);
    return label;
  });
}
