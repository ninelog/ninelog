/**
 * チーム内ランキング（CLAUDE.md 第6.2〜6.4章。B-13）
 *
 * - 対象は、そのチームの試合（消していない試合）に付いた、消していない記録だけ。ほかのチームの成績は混ぜない。
 * - チーム試合数は、その年度（通算なら全期間）の、そのチームの消していない試合の数（6.2章）。
 * - 規定打席 ＝ チーム試合数 × QUALIFY_PA_PER_GAME、規定投球回 ＝ チーム試合数 × QUALIFY_IP_PER_GAME（Config.js）。
 * - 規定の判定と順位の計算はここで行い、画面は結果を表示するだけにする（6.3章）。
 * - 他人のLINEユーザーIDは返さない。本人の行には is_me: true を付ける。
 * - 部門ごとの並べ方（computeRankings_）は、大会のランキング（B-13b）でも使う。
 */

/** 部門の一覧（6.4章の表の順） */
function rankingCategories_() {
  return [
    { key: 'avg', label: '打率', kind: 'rate', side: 'batting', order: 'desc' },
    { key: 'obp', label: '出塁率', kind: 'rate', side: 'batting', order: 'desc' },
    { key: 'ops', label: 'OPS', kind: 'rate', side: 'batting', order: 'desc' },
    { key: 'era', label: '防御率', kind: 'rate', side: 'pitching', order: 'asc' },
    { key: 'hits', label: '安打', kind: 'count', side: 'batting', order: 'desc' },
    { key: 'home_runs', label: '本塁打', kind: 'count', side: 'batting', order: 'desc' },
    { key: 'rbis', label: '打点', kind: 'count', side: 'batting', order: 'desc' },
    { key: 'stolen_bases', label: '盗塁', kind: 'count', side: 'batting', order: 'desc' },
  ];
}

/** 率の比べ方で、計算のわずかな誤差を「同じ値」とみなす幅 */
const RANKING_EPSILON = 1e-9;

/**
 * 選手ごとの成績から、全部門のランキングを作る。
 * @param {Array<Object>} players [{ displayName, isMe, batting: battingSummary_, pitching: pitchingSummary_,
 *                                   qualifyPa: 規定打席, qualifyOuts: 規定投球回（アウト数） }]
 * @return {Object} { avg: { label, kind, order, rows: [...] }, ... }
 */
function computeRankings_(players) {
  const result = {};
  rankingCategories_().forEach(function (c) {
    result[c.key] = { label: c.label, kind: c.kind, order: c.order, rows: rankCategory_(c, players) };
  });
  return result;
}

function rankCategory_(c, players) {
  const isPitching = c.side === 'pitching';
  // 対象：打撃の部門は打席が1以上の人（数の部門は打撃の記録が1件以上の人）、防御率は投手の記録が1件以上の人（6.4章）
  const targets = players.filter(function (p) {
    if (isPitching) return p.pitching.games > 0;
    if (c.kind === 'rate') return p.batting.plate_appearances > 0;
    return p.batting.games > 0;
  });

  const rowOf = function (p) {
    const s = isPitching ? p.pitching : p.batting;
    const raw = s[c.key];
    const value = c.kind === 'rate' ? raw.value : raw;
    const row = {
      displayName: p.displayName,
      is_me: Boolean(p.isMe),
      value: value,
      text: c.kind === 'rate' ? raw.text : String(raw),
      rank: null,
      qualified: true,
    };
    if (p.teamName !== undefined) row.teamName = p.teamName; // 大会のランキング用（B-13b）
    if (c.kind === 'rate') {
      if (isPitching) {
        row.innings_text = p.pitching.innings_text;
        const short = p.qualifyOuts - p.pitching.outs;
        row.qualified = short <= 0;
        row.remaining = row.qualified ? 0 : short;
        row.remaining_text = row.qualified ? '' : '規定投球回まであと' + formatShortInnings_(short);
      } else {
        row.plate_appearances = p.batting.plate_appearances;
        const short = p.qualifyPa - p.batting.plate_appearances;
        row.qualified = short <= 0;
        row.remaining = row.qualified ? 0 : short;
        row.remaining_text = row.qualified ? '' : '規定打席まであと' + short + '打席';
      }
    }
    return row;
  };
  const rows = targets.map(rowOf);

  const byName = function (a, b) { return a.displayName.localeCompare(b.displayName, 'ja'); };
  const better = function (a, b) { // a が上なら負の数
    if (Math.abs(a.value - b.value) <= RANKING_EPSILON) return 0;
    return c.order === 'desc' ? b.value - a.value : a.value - b.value;
  };

  // 順位を付ける人：規定に届いていて、値がある人（率の分母が0の人は値が無いので、順位を付けない）
  const ranked = rows.filter(function (r) { return r.qualified && r.value !== null; });
  const noValue = rows.filter(function (r) { return r.qualified && r.value === null; });
  const unqualified = rows.filter(function (r) { return !r.qualified; });

  ranked.sort(function (a, b) { return better(a, b) || byName(a, b); });
  ranked.forEach(function (r, i) {
    // 同じ値は同じ順位（1位、1位、3位）
    r.rank = (i > 0 && better(ranked[i - 1], r) === 0) ? ranked[i - 1].rank : i + 1;
  });
  noValue.sort(byName);
  // 規定に届いていない人は、あと少しの人から順。同じなら表示名の順
  unqualified.sort(function (a, b) { return (a.remaining - b.remaining) || byName(a, b); });

  return ranked.concat(noValue, unqualified);
}

/**
 * 操作：getTeamRanking（チーム内ランキング。6.4章）
 * data: { team_id: チームID（必須。所属しているチームだけ）,
 *         season: 'all'（通算） または '2026' など（省略すると今年。今年の試合が無ければ通算） }
 * 返事：チーム名、年度、選択欄に出す年度とチーム、チーム試合数、規定打席・規定投球回、8部門のランキング
 */
function handleGetTeamRanking_(data, user, options) {
  const scope = teamSeasonScope_(data, user, options, 'ランキング');
  const team = scope.team;
  const myTeams = scope.myTeams;
  const season = scope.season;
  const seasons = scope.seasons;
  const gamesInSeason = scope.gamesInSeason;
  const gameCount = Object.keys(gamesInSeason).length;
  const qualifyPa = gameCount * CONFIG.QUALIFY_PA_PER_GAME;
  const qualifyOuts = gameCount * CONFIG.QUALIFY_IP_PER_GAME * 3;

  // 載せるのは、今そのチームに所属している人だけ（退会した人の成績は、チーム全体の成績には残るが、ランキングには載せない。B-20）
  const members = {};
  readRecords_(CONFIG.SHEET.MEMBERSHIPS).forEach(function (m) {
    if (m.team_id === team.teamId) members[m.user_id] = true;
  });

  // 選手ごとに記録を集める
  const byUser = {};
  const collect = function (sheet, kind) {
    readRecords_(sheet).forEach(function (r) {
      if (r.deleted_at || !gamesInSeason[r.game_id] || !members[r.user_id]) return;
      if (!byUser[r.user_id]) byUser[r.user_id] = { batting: [], pitching: [] };
      byUser[r.user_id][kind].push(r);
    });
  };
  collect(CONFIG.SHEET.BATTING, 'batting');
  collect(CONFIG.SHEET.PITCHING, 'pitching');

  const names = displayNamesById_();
  const players = Object.keys(byUser).map(function (userId) {
    return {
      displayName: names[userId] || CONFIG.DEFAULT_DISPLAY_NAME,
      isMe: userId === user.userId,
      batting: battingSummary_(byUser[userId].batting),
      pitching: pitchingSummary_(byUser[userId].pitching),
      qualifyPa: qualifyPa,
      qualifyOuts: qualifyOuts,
    };
  });

  return {
    teamId: team.teamId,
    teamName: team.teamName,
    season: season,
    seasons: seasons,
    teams: myTeams.map(function (t) { return { teamId: t.teamId, teamNumber: t.teamNumber, teamName: t.teamName }; }),
    teamGames: gameCount,
    qualifyPlateAppearances: qualifyPa,
    qualifyOuts: qualifyOuts,
    qualifyInningsText: formatInnings_(qualifyOuts),
    categories: computeRankings_(players),
  };
}

/**
 * チームと年度を決める（チームのランキング B-13 とチーム全体の成績 B-14 で共通）。
 * - team_id は必須。所属しているチームだけ（大会のIDや所属していないチームは FORBIDDEN）。
 * - 年度の選択欄：そのチームの試合がある年度（新しい順）。省略すると今年、今年の試合が無ければ通算。
 * @param {string} what 断るときの文に入れる言葉（「ランキング」「成績」）
 * @return {{ team, myTeams, season, seasons, gamesInSeason: { game_id: 試合 } }}
 */
function teamSeasonScope_(data, user, options, what) {
  const myTeams = handleListMyTeams_({}, user).teams.filter(function (t) { return t.orgType === ORG_TYPE.TEAM; });
  if (data.team_id === undefined || data.team_id === null || data.team_id === '') {
    throw new AppError(APP_ERROR.BAD_REQUEST, 'team_id（チーム）を指定してください');
  }
  const team = myTeams.filter(function (t) { return t.teamId === data.team_id; })[0];
  if (!team) {
    throw new AppError(APP_ERROR.FORBIDDEN, '所属していないチームの' + what + 'は見られません');
  }

  // そのチームの、消していない試合
  const teamGames = readRecords_(CONFIG.SHEET.GAMES).filter(function (g) {
    return g.team_id === team.teamId && !g.deleted_at;
  });

  const seasons = [];
  teamGames.forEach(function (g) {
    const s = seasonOf_(g.game_date);
    if (seasons.indexOf(s) === -1) seasons.push(s);
  });
  seasons.sort().reverse();

  let season = data.season;
  if (season === undefined || season === null || season === '') {
    const thisYear = todayText_(options).slice(0, 4);
    season = seasons.indexOf(thisYear) !== -1 ? thisYear : 'all';
  }
  if (season !== 'all' && !/^\d{4}$/.test(String(season))) {
    throw new AppError(APP_ERROR.BAD_REQUEST, '年度は「all」（通算）か「2026」のような4けたの年で指定してください');
  }
  season = String(season);

  const gamesInSeason = {};
  teamGames.forEach(function (g) {
    if (season === 'all' || seasonOf_(g.game_date) === season) gamesInSeason[g.game_id] = g;
  });
  return { team: team, myTeams: myTeams, season: season, seasons: seasons, gamesInSeason: gamesInSeason };
}

/**
 * 操作：getTournamentRanking（大会のランキング。11.7章のE・F・K。B-13b）
 * data: { tournament_id: 大会ID（必須。参加している大会だけ）,
 *         season: 'all'（通算） または '2026' など（省略すると今年。今年の大会の試合が無ければ通算） }
 * - 対象は、その大会に結びついた試合（消していない試合）の、消していない記録。チームをまたいで集計する。
 * - 載るのは、その大会に参加している人だけ（参加していない人の記録は入れない：K）。
 * - 規定：その選手のチームが、その大会（その年度）で戦った試合の数 × 倍率。
 *   同じ大会で2つのチームの記録がある人は、両チームの試合の数を足す（F）。
 * - 表示名の横に出すチーム名（teamName）を行に付ける。2つのチームなら「・」でつなぐ（E）。
 */
function handleGetTournamentRanking_(data, user, options) {
  const myTournaments = handleListMyTeams_({}, user).teams.filter(function (t) { return t.orgType === ORG_TYPE.TOURNAMENT; });
  if (data.tournament_id === undefined || data.tournament_id === null || data.tournament_id === '') {
    throw new AppError(APP_ERROR.BAD_REQUEST, 'tournament_id（大会）を指定してください');
  }
  const tournament = myTournaments.filter(function (t) { return t.teamId === data.tournament_id; })[0];
  if (!tournament) {
    throw new AppError(APP_ERROR.FORBIDDEN, '参加していない大会のランキングは見られません');
  }

  // その大会の、消していない試合
  const tourGames = readRecords_(CONFIG.SHEET.GAMES).filter(function (g) {
    return g.tournament_id === tournament.teamId && !g.deleted_at;
  });

  const seasons = [];
  tourGames.forEach(function (g) {
    const s = seasonOf_(g.game_date);
    if (seasons.indexOf(s) === -1) seasons.push(s);
  });
  seasons.sort().reverse();

  let season = data.season;
  if (season === undefined || season === null || season === '') {
    const thisYear = todayText_(options).slice(0, 4);
    season = seasons.indexOf(thisYear) !== -1 ? thisYear : 'all';
  }
  if (season !== 'all' && !/^\d{4}$/.test(String(season))) {
    throw new AppError(APP_ERROR.BAD_REQUEST, '年度は「all」（通算）か「2026」のような4けたの年で指定してください');
  }
  season = String(season);

  // 対象の試合と、チームごとの試合の数
  const gamesInSeason = {};
  const gamesPerTeam = {};
  tourGames.forEach(function (g) {
    if (season !== 'all' && seasonOf_(g.game_date) !== season) return;
    gamesInSeason[g.game_id] = g;
    gamesPerTeam[g.team_id] = (gamesPerTeam[g.team_id] || 0) + 1;
  });

  // 大会に参加している人
  const participants = {};
  readRecords_(CONFIG.SHEET.MEMBERSHIPS).forEach(function (m) {
    if (m.team_id === tournament.teamId) participants[m.user_id] = true;
  });

  // 選手ごとに記録と、記録があるチームを集める
  const byUser = {};
  const collect = function (sheet, kind) {
    readRecords_(sheet).forEach(function (r) {
      const g = gamesInSeason[r.game_id];
      if (r.deleted_at || !g || !participants[r.user_id]) return;
      if (!byUser[r.user_id]) byUser[r.user_id] = { batting: [], pitching: [], teamIds: [] };
      byUser[r.user_id][kind].push(r);
      if (byUser[r.user_id].teamIds.indexOf(g.team_id) === -1) byUser[r.user_id].teamIds.push(g.team_id);
    });
  };
  collect(CONFIG.SHEET.BATTING, 'batting');
  collect(CONFIG.SHEET.PITCHING, 'pitching');

  const teamNames = {};
  readRecords_(CONFIG.SHEET.TEAMS).forEach(function (t) { teamNames[t.team_id] = String(t.team_name); });
  const names = displayNamesById_();

  const players = Object.keys(byUser).map(function (userId) {
    const p = byUser[userId];
    const teamIds = p.teamIds.slice().sort(function (a, b) { return teamNames[a].localeCompare(teamNames[b], 'ja'); });
    const games = teamIds.reduce(function (sum, id) { return sum + gamesPerTeam[id]; }, 0);
    return {
      displayName: names[userId] || CONFIG.DEFAULT_DISPLAY_NAME,
      teamName: teamIds.map(function (id) { return teamNames[id]; }).join('・'),
      isMe: userId === user.userId,
      batting: battingSummary_(p.batting),
      pitching: pitchingSummary_(p.pitching),
      qualifyPa: games * CONFIG.QUALIFY_PA_PER_GAME,
      qualifyOuts: games * CONFIG.QUALIFY_IP_PER_GAME * 3,
    };
  });

  // 大会に出たチームと、その大会（その年度）での試合の数（試合の多い順。同じならチーム名の順）
  const teamGames = Object.keys(gamesPerTeam).map(function (id) {
    return { teamName: teamNames[id] || '', games: gamesPerTeam[id] };
  }).sort(function (a, b) { return (b.games - a.games) || a.teamName.localeCompare(b.teamName, 'ja'); });

  return {
    tournamentId: tournament.teamId,
    tournamentName: tournament.teamName,
    season: season,
    seasons: seasons,
    tournaments: myTournaments.map(function (t) { return { tournamentId: t.teamId, tournamentNumber: t.teamNumber, tournamentName: t.teamName }; }),
    tournamentGames: Object.keys(gamesInSeason).length,
    teamGames: teamGames,
    categories: computeRankings_(players),
  };
}

/** 足りない投球回の表示。1回に満たないときは「0回2/3」ではなく「2/3回」にする */
function formatShortInnings_(outs) {
  return outs < 3 ? outs + '/3回' : formatInnings_(outs);
}

/** user_id → 表示名 */
function displayNamesById_() {
  const map = {};
  readRecords_(CONFIG.SHEET.USERS).forEach(function (u) { map[u.user_id] = String(u.display_name); });
  return map;
}
