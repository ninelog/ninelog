/**
 * 記録達成のお祝い（CLAUDE.md 11.4章・11.0章の11。B-16）
 *
 * 成績の入力（add）と修正（update）の返事に celebrations として付ける。本人の画面にだけ出す。
 * - 1試合の記録：猛打賞（3安打以上）、1試合2本塁打以上、サイクルヒット（単打・二塁打・三塁打・本塁打をすべて）
 * - 初めての記録：初安打、初本塁打
 * - 通算の節目：安打・本塁打・打点・盗塁・投球回（数は Config.js の CELEBRATION）
 * - 「新しく達成したとき」だけ返す：前は届いていなくて、この入力・修正で届いたとき。
 *   通算は、本人の全チーム・全期間の、消していない記録の合計で数える。
 * - 削除では、お祝いは返さない。
 */

/**
 * お祝いの一覧を作る。記録を書き込む「前」に呼ぶ（シートには、まだ前の値が入っているため）。
 * @param {string} type 'batting' または 'pitching'
 * @param {string} userId 本人
 * @param {Object|null} before 修正前の記録（新しい入力なら null）
 * @param {Object} after 入力・修正のあとの値（保存する値）
 * @return {Array<{type: string, key: string, message: string}>}
 */
function celebrationsFor_(type, userId, before, after) {
  const list = [];
  const sheet = type === 'batting' ? CONFIG.SHEET.BATTING : CONFIG.SHEET.PITCHING;
  const beforeId = before ? before.record_id : null;
  // 本人の、ほかの消していない記録（修正中の記録は除く）
  const others = readRecords_(sheet).filter(function (r) {
    return r.user_id === userId && !r.deleted_at && r.record_id !== beforeId;
  });

  if (type === 'batting') {
    // 1試合の記録（前の値では届いていなかったときだけ）
    singleGameCelebrations_(after).forEach(function (c) {
      const already = before && singleGameCelebrations_(before).some(function (b) { return b.key === c.key; });
      if (!already) list.push(c);
    });

    const sumOthers = sumBatting_(others);
    const totalBefore = before ? addCounts_(sumOthers, before) : sumOthers;
    const totalAfter = addCounts_(sumOthers, after);

    if (totalBefore.hits === 0 && totalAfter.hits > 0) {
      list.push({ type: 'first', key: 'first_hit', message: '初安打おめでとうございます！' });
    }
    if (totalBefore.home_runs === 0 && totalAfter.home_runs > 0) {
      list.push({ type: 'first', key: 'first_home_run', message: '初本塁打おめでとうございます！' });
    }
    const words = { hits: '安打', home_runs: '本塁打', rbis: '打点', stolen_bases: '盗塁' };
    Object.keys(words).forEach(function (field) {
      crossedMilestones_(CONFIG.CELEBRATION.MILESTONES[field], totalBefore[field], totalAfter[field]).forEach(function (m) {
        list.push({ type: 'milestone', key: field + '_' + m, message: '通算' + m + words[field] + '達成！' });
      });
    });
  } else {
    // 投手：通算の投球回の節目（アウト数で比べる）
    const outsOthers = others.reduce(function (s, r) { return s + (Number(r.outs) || 0); }, 0);
    const outsBefore = outsOthers + (before ? Number(before.outs) || 0 : 0);
    const outsAfter = outsOthers + (Number(after.outs) || 0);
    CONFIG.CELEBRATION.MILESTONES.innings.forEach(function (m) {
      if (outsBefore < m * 3 && outsAfter >= m * 3) {
        list.push({ type: 'milestone', key: 'innings_' + m, message: '通算' + m + '投球回達成！' });
      }
    });
  }
  return list;
}

/** 1試合の記録で届いているお祝い */
function singleGameCelebrations_(r) {
  const hits = Number(r.hits) || 0;
  const doubles = Number(r.doubles) || 0;
  const triples = Number(r.triples) || 0;
  const homeRuns = Number(r.home_runs) || 0;
  const singles = hits - doubles - triples - homeRuns;
  const list = [];
  if (hits >= CONFIG.CELEBRATION.MULTI_HIT) {
    list.push({ type: 'game', key: 'multi_hit', message: '猛打賞おめでとうございます！（' + hits + '安打）' });
  }
  if (homeRuns >= CONFIG.CELEBRATION.MULTI_HR) {
    list.push({ type: 'game', key: 'multi_home_run', message: '1試合' + homeRuns + '本塁打！' });
  }
  if (singles >= 1 && doubles >= 1 && triples >= 1 && homeRuns >= 1) {
    list.push({ type: 'game', key: 'cycle', message: 'サイクルヒット達成！' });
  }
  return list;
}

/** 合計に1試合分を足す（打撃の項目だけ） */
function addCounts_(total, record) {
  const result = {};
  battingCountFields_().forEach(function (f) { result[f] = (total[f] || 0) + (Number(record[f]) || 0); });
  return result;
}

/** before より大きく after 以下の節目（この入力で届いた節目） */
function crossedMilestones_(milestones, before, after) {
  return milestones.filter(function (m) { return before < m && after >= m; });
}
