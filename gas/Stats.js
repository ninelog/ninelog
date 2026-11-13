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

/** 記録が付いている試合の一覧（同じ試合は1回だけ） */
function gamesOfRecords_(records, gameOf) {
  const seen = {};
  const games = [];
  records.forEach(function (r) {
    const g = gameOf(r);
    if (!seen[g.game_id]) { seen[g.game_id] = true; games.push(g); }
  });
  return games;
}

/** 試合日（yyyy-MM-dd）の月（yyyy-MM）。推移グラフ用（11.4章） */
function monthOf_(gameDate) {
  return dateText_(gameDate).slice(0, 7);
}

/** 「2026-11」の次の月（12月の次は翌年の「01」） */
function nextMonth_(month) {
  let y = Number(month.slice(0, 4));
  let m = Number(month.slice(5, 7)) + 1;
  if (m > 12) { y += 1; m = 1; }
  return y + '-' + ('0' + m).slice(-2);
}

/**
 * 月ごとの推移（グラフ用の数字。11.0章の10・11.4章）
 * - 記録がある最初の月から最後の月まで、1か月ずつ並べる（間の月も入れる）。
 * - 記録の無い月は、率の value が null（グラフでは点を打たない）。
 * - avg・ops・era は、その月の記録だけを合計してから計算する。
 * - cum_avg・cum_ops・cum_era は、選んだ範囲の最初の記録からその月までの積み上げ（B-12で利用者が追加）。
 *   年度を選んだときは、その年の記録だけなので「1月からの積み上げ」になる。
 *   通算を選んだときは、年でリセットせず、最初の記録から途切れずに積み上げる。
 *   記録の無い月も、それまでの記録があれば、前の月と同じ値になる。
 * @return {Array<Object>} [{ month: '2026-11', batting_games, avg, ops, pitching_games, innings_text, era,
 *                            cum_avg, cum_ops, cum_era }, ...]
 */
function monthlyTrend_(battingRecords, pitchingRecords, gameOf) {
  const byMonth = {};
  const add = function (kind) {
    return function (r) {
      const m = monthOf_(gameOf(r).game_date);
      if (!byMonth[m]) byMonth[m] = { batting: [], pitching: [] };
      byMonth[m][kind].push(r);
    };
  };
  battingRecords.forEach(add('batting'));
  pitchingRecords.forEach(add('pitching'));

  const months = Object.keys(byMonth).sort();
  if (months.length === 0) return [];
  const trend = [];
  // 積み上げは年でリセットしない（年度を選んだときは、もともとその年の記録しか来ない）
  let cumBatting = [];
  let cumPitching = [];
  for (let m = months[0]; m <= months[months.length - 1]; m = nextMonth_(m)) {
    const bucket = byMonth[m] || { batting: [], pitching: [] };
    cumBatting = cumBatting.concat(bucket.batting);
    cumPitching = cumPitching.concat(bucket.pitching);
    const b = battingSummary_(bucket.batting);
    const p = pitchingSummary_(bucket.pitching);
    const cb = battingSummary_(cumBatting);
    const cp = pitchingSummary_(cumPitching);
    trend.push({
      month: m,
      batting_games: b.games,
      avg: b.avg,
      ops: b.ops,
      pitching_games: p.games,
      innings_text: p.innings_text,
      era: p.era,
      cum_avg: cb.avg,
      cum_ops: cb.ops,
      cum_era: cp.era,
    });
  }
  return trend;
}

/**
 * 操作：getMyStats（自分の成績。6.5章・11.7章のG）
 * data: { season: 'all'（通算） または '2026' など（省略すると今年。今年の記録が無ければ通算）,
 *         team_id: チームID または tournament_id: 大会ID（どちらも省略すると全チーム合計。両方は指定できない） }
 * 返事：選んだ年度と範囲、選択欄に出す年度・チーム・大会の一覧、打撃と投手の成績、月ごとの推移
 */
function handleGetMyStats_(data, user, options) {
  const myOrgs = handleListMyTeams_({}, user).teams;
  // 範囲の選択欄：チームと、ひとりの記録（11.8章の6）。大会は別の選択欄
  const myTeams = myOrgs.filter(function (t) { return isRecordableOrgType_(t.orgType); });
  const myTournaments = myOrgs.filter(function (t) { return t.orgType === ORG_TYPE.TOURNAMENT; });
  const given = function (v) { return v !== undefined && v !== null && v !== ''; };

  // 範囲：全チーム合計（どちらも null）か、所属しているチームの1つか、参加している大会の1つ
  if (given(data.team_id) && given(data.tournament_id)) {
    throw new AppError(APP_ERROR.BAD_REQUEST, 'チームと大会は、どちらか1つだけ指定してください');
  }
  let teamId = null;
  let tournamentId = null;
  if (given(data.team_id)) {
    if (!myTeams.some(function (t) { return t.teamId === data.team_id; })) {
      throw new AppError(APP_ERROR.FORBIDDEN, '所属していないチームの成績は見られません');
    }
    teamId = data.team_id;
  }
  if (given(data.tournament_id)) {
    if (!myTournaments.some(function (t) { return t.teamId === data.tournament_id; })) {
      throw new AppError(APP_ERROR.FORBIDDEN, '参加していない大会の成績は見られません');
    }
    tournamentId = data.tournament_id;
  }

  // 自分の、削除していない記録（全チーム・全期間）。試合日・チーム・大会は、試合（games）から読む（11.2章）
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
      return (season === 'all' || seasonOf_(g.game_date) === season)
        && (!teamId || g.team_id === teamId)
        && (!tournamentId || g.tournament_id === tournamentId);
    });
  };
  const batting = pick(allBatting);
  const pitching = pick(allPitching);

  return {
    season: season,
    teamId: teamId,
    tournamentId: tournamentId,
    seasons: seasons,
    teams: myTeams.map(function (t) { return { teamId: t.teamId, teamNumber: t.teamNumber, teamName: t.teamName, orgType: t.orgType }; }),
    tournaments: myTournaments.map(function (t) { return { tournamentId: t.teamId, tournamentNumber: t.teamNumber, tournamentName: t.teamName }; }),
    batting: battingSummary_(batting),
    pitching: pitchingSummary_(pitching),
    trend: monthlyTrend_(batting, pitching, gameOf),
    breakdowns: breakdowns_(gamesOfRecords_(batting.concat(pitching), gameOf), batting, pitching, false), // B-15
  };
}
