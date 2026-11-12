/**
 * 成績の計算（CLAUDE.md 第6章）
 *
 * - 計算結果は保存しない。生の数字を、表示のたびにここで計算する。
 * - 対象期間の有効な行（削除していない行）を全部合計してから計算する（試合ごとの率を平均しない）。
 * - 分母が0のときは、値は null、表示は「-」。
 * - 計算はGAS側で行い、画面は結果を表示するだけにする。B-10のランキングもこの部品を使う。
 */

/** 打撃で合計する項目（BATTING_COUNT_FIELDS の列の名前） */
function battingCountFields_() {
  return BATTING_COUNT_FIELDS.map(function (f) { return f[0]; });
}

/**
 * 打撃の記録を合計する。
 * @return {Object} { games: 試合数（記録の件数）, plate_appearances: …, at_bats: …, … }
 */
function sumBatting_(records) {
  const total = { games: records.length };
  battingCountFields_().forEach(function (f) { total[f] = 0; });
  records.forEach(function (r) {
    battingCountFields_().forEach(function (f) { total[f] += Number(r[f]) || 0; });
  });
  return total;
}

/**
 * 合計から率を計算する（6章の式）。
 * @return {{avg: number|null, obp: number|null, slg: number|null, ops: number|null, total_bases: number}}
 */
function battingRates_(t) {
  const singles = t.hits - t.doubles - t.triples - t.home_runs;
  const totalBases = singles + t.doubles * 2 + t.triples * 3 + t.home_runs * 4;
  const obpDenominator = t.at_bats + t.walks + t.hbp + t.sacrifice_flies; // 犠打は分母に入れない
  const avg = ratio_(t.hits, t.at_bats);
  const obp = ratio_(t.hits + t.walks + t.hbp, obpDenominator);
  const slg = ratio_(totalBases, t.at_bats);
  const ops = obp === null || slg === null ? null : obp + slg;
  return { avg: avg, obp: obp, slg: slg, ops: ops, total_bases: totalBases };
}

/** 投手の記録を合計する。@return { games, outs, earned_runs } */
function sumPitching_(records) {
  const total = { games: records.length, outs: 0, earned_runs: 0 };
  records.forEach(function (r) {
    total.outs += Number(r.outs) || 0;
    total.earned_runs += Number(r.earned_runs) || 0;
  });
  return total;
}

/**
 * 防御率 ＝ 自責点 × 7 ÷ 投球回 ＝ 自責点 × 21 ÷ outs（7イニング制。Config.js の INNINGS_PER_GAME）
 * outs が0なら null（表示は「-」）
 */
function era_(earnedRuns, outs) {
  return ratio_(earnedRuns * CONFIG.INNINGS_PER_GAME * 3, outs);
}

function ratio_(numerator, denominator) {
  return denominator > 0 ? numerator / denominator : null;
}

/**
 * 率の表示（打率・出塁率・長打率・OPS）：小数第3位まで。1未満は先頭の0を付けない。
 * 例：0.325 → 「.325」、1.0 → 「1.000」、1.8095 → 「1.810」、null → 「-」
 */
function formatRate_(value) {
  if (value === null) return '-';
  const text = (Math.round(value * 1000) / 1000).toFixed(3);
  return text.indexOf('0.') === 0 ? text.slice(1) : text;
}

/** 防御率の表示：小数第2位まで。例：2.625 → 「2.63」、null → 「-」 */
function formatEra_(value) {
  if (value === null) return '-';
  return (Math.round(value * 100) / 100).toFixed(2);
}

/** 打撃の合計と率を、画面に返す形にまとめる（率は value と text の組） */
function battingSummary_(records) {
  const total = sumBatting_(records);
  const rates = battingRates_(total);
  return Object.assign(total, {
    total_bases: rates.total_bases,
    avg: { value: rates.avg, text: formatRate_(rates.avg) },
    obp: { value: rates.obp, text: formatRate_(rates.obp) },
    slg: { value: rates.slg, text: formatRate_(rates.slg) },
    ops: { value: rates.ops, text: formatRate_(rates.ops) },
  });
}

/** 投手の合計と防御率を、画面に返す形にまとめる */
function pitchingSummary_(records) {
  const total = sumPitching_(records);
  const value = era_(total.earned_runs, total.outs);
  return Object.assign(total, {
    innings_text: formatInnings_(total.outs),
    era: { value: value, text: formatEra_(value) },
  });
}

/** 試合日（yyyy-MM-dd）の年度（暦年）。6.1章 */
function seasonOf_(gameDate) {
  return dateText_(gameDate).slice(0, 4);
}

/**
 * 操作：getMyStats（自分の成績。6.5章）
 * data: { season: 'all'（通算） または '2026' など（省略すると今年。今年の記録が無ければ通算）,
 *         team_id: チームID（省略すると全チーム合計） }
 * 返事：選んだ年度とチーム、選択欄に出す年度とチームの一覧、打撃と投手の成績
 */
function handleGetMyStats_(data, user, options) {
  // 範囲の選択欄に出すのは、いまはチームだけ（大会は B-12 で足す。11.7章のG）
  const myTeams = handleListMyTeams_({}, user).teams.filter(function (t) { return t.orgType === ORG_TYPE.TEAM; });

  // 範囲：全チーム合計（null）か、所属しているチームの1つ
  let teamId = null;
  if (data.team_id !== undefined && data.team_id !== null && data.team_id !== '') {
    const belongs = myTeams.some(function (t) { return t.teamId === data.team_id; });
    if (!belongs) {
      throw new AppError(APP_ERROR.FORBIDDEN, '所属していないチームの成績は見られません');
    }
    teamId = data.team_id;
  }

  // 自分の、削除していない記録（全チーム・全期間）。試合日とチームは、試合（games）から読む（11.2章）
  const gamesById = gamesById_();
  const mine = function (sheet) {
    return readRecords_(sheet).filter(function (r) {
      return r.user_id === user.userId && !r.deleted_at && gamesById[r.game_id];
    });
  };
  const allBatting = mine(CONFIG.SHEET.BATTING);
  const allPitching = mine(CONFIG.SHEET.PITCHING);
  const gameOf = function (r) { return gamesById[r.game_id]; };

  // 選択欄に出す年度：記録がある年度（全チーム分。新しい順）
  const seasons = [];
  allBatting.concat(allPitching).forEach(function (r) {
    const s = seasonOf_(gameOf(r).game_date);
    if (seasons.indexOf(s) === -1) seasons.push(s);
  });
  seasons.sort().reverse();

  // 年度：指定が無ければ今年（今年の記録が無ければ通算）
  let season = data.season;
  if (season === undefined || season === null || season === '') {
    const thisYear = todayText_(options).slice(0, 4);
    season = seasons.indexOf(thisYear) !== -1 ? thisYear : 'all';
  }
  if (season !== 'all' && !/^\d{4}$/.test(String(season))) {
    throw new AppError(APP_ERROR.BAD_REQUEST, '年度は「all」（通算）か「2026」のような4けたの年で指定してください');
  }
  season = String(season);

  const pick = function (records) {
    return records.filter(function (r) {
      const g = gameOf(r);
      return (season === 'all' || seasonOf_(g.game_date) === season) && (!teamId || g.team_id === teamId);
    });
  };

  return {
    season: season,
    teamId: teamId,
    seasons: seasons,
    teams: myTeams.map(function (t) { return { teamId: t.teamId, teamNumber: t.teamNumber, teamName: t.teamName }; }),
    batting: battingSummary_(pick(allBatting)),
    pitching: pitchingSummary_(pick(allPitching)),
  };
}
