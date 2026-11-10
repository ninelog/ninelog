/**
 * 成績の変更の記録（CLAUDE.md 第4.4d章・第4.5b章）
 *
 * 修正・削除のたびに、record_changes シートへ「変わった項目1つにつき1行」を書き足す。
 * この記録は、プログラムからは書き足すだけで、直したり消したりしない。
 */

/**
 * @param {string} recordType 'batting' または 'pitching'
 * @param {string} recordId どの記録か
 * @param {string} userId 誰が変えたか
 * @param {string} action 'update'（修正）または 'delete'（削除）
 * @param {Object} changes { 項目の名前: { oldValue: 前の値, newValue: あとの値 } }
 * @param {Date} changedAt いつ変えたか（同じ修正の行は、同じ日時にそろえる）
 */
function appendRecordChanges_(recordType, recordId, userId, action, changes, changedAt) {
  Object.keys(changes).forEach(function (field) {
    appendRecord_(CONFIG.SHEET.RECORD_CHANGES, {
      change_id: Utilities.getUuid(),
      changed_at: changedAt,
      user_id: userId,
      record_type: recordType,
      record_id: recordId,
      action: action,
      field: field,
      old_value: changeValueText_(changes[field].oldValue),
      new_value: changeValueText_(changes[field].newValue),
    });
  });
}

/** 記録に書く値を文字にする（日時は「2026-11-12 21:05:00」の形） */
function changeValueText_(value) {
  if (value === null || value === undefined) return '';
  if (Object.prototype.toString.call(value) === '[object Date]') {
    return Utilities.formatDate(value, CONFIG.TIME_ZONE, 'yyyy-MM-dd HH:mm:ss');
  }
  return String(value);
}
