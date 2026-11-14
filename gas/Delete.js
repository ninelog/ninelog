/**
 * チーム・大会を消す／ひとりの記録の成績をチームに移す（CLAUDE.md 11.9章。B-21）
 *
 * 操作：
 * - getDeletePreview：消す前の確認の画面に出す数（メンバーの人数、移る成績の件数など）
 * - deleteTeam：チームか大会を消す（代表者だけ。ひとりの記録は消せない）
 * - listSoloMoveTargets：ひとりの記録の成績と、それぞれを移せるチームの試合（同じ日の試合）
 * - moveSoloRecords：ひとりの記録の成績を、まとめてチームの試合に移す（本人だけ）
 *
 * 決まり：
 * - チームを消すとき、他のメンバー（退会した人を含む）の成績は、本人それぞれの「ひとりの記録」に移す。
 *   ひとりの記録が無い人には自動で作る。代表者自身の成績だけは「移す」か「消す」かを選べる。
 * - 移すときは、試合の情報（日付・第何試合・相手・区分・勝敗）を、ひとりの記録の側に写した試合を作る。
 *   第何試合が重なるときは、その日の次の番号にする。大会の印は外す（ひとりの記録には大会を付けないため）。
 * - 大会を消すと、試合に付いていた大会の印を外す。成績はチームにそのまま残る。
 * - 消したチーム・大会の行は、teams と memberships から消す（番号をまた使えるように）。試合は論理削除。
 * - 30日の期限は、消すとき・移すときには使わない（数字は変えない）。
 * - 消したこと・移したことは record_changes に残す。
 */

const DELETE_MOVE_MAX = 50; // ひとりの記録から一度に移せる記録の数

/* ---------- 消す前の確認 ---------- */

/**
 * 操作：getDeletePreview
 * data: { team_id }
 * 返事（チーム）：{ orgType, teamName, teamNumber, members, games, ownerRecords, otherRecords, otherPeople, tournamentRecords }
 * 返事（大会）：{ orgType, teamName, teamNumber, members, games }
 */
function handleGetDeletePreview_(data, user) {
  const org = ownedOrgForDelete_(data.team_id, user);
  const base = {
    orgType: orgTypeOf_(org),
    teamName: String(org.team_name),
    teamNumber: String(org.team_number),
    members: membershipsOf_(org.team_id).length,
  };
  if (orgTypeOf_(org) === ORG_TYPE.TOURNAMENT) {
    base.games = gamesOfTournament_(org.team_id).length;
    return base;
  }
  const games = activeGamesOf_(org.team_id);
  const records = recordsInGames_(games);
  base.games = games.length;
  base.ownerRecords = records.filter(function (x) { return x.record.user_id === user.userId; }).length;
  const others = records.filter(function (x) { return x.record.user_id !== user.userId; });
  base.otherRecords = others.length;
  base.otherPeople = Object.keys(others.reduce(function (m, x) { m[x.record.user_id] = true; return m; }, {})).length;
  base.tournamentRecords = records.filter(function (x) { return x.game.tournament_id; }).length;
  return base;
}

/* ---------- チーム・大会を消す ---------- */

/**
 * 操作：deleteTeam
 * data: { team_id, confirm_name（チーム名・大会名をそのまま入力）, owner_records（チームのときだけ：'move' か 'delete'） }
 * 返事：{ deleted: true, orgType, teamName, movedRecords, deletedRecords, createdSolos, untaggedGames }
 */
function handleDeleteTeam_(data, user) {
  const org = ownedOrgForDelete_(data.team_id, user);
  const type = orgTypeOf_(org);
  const name = String(org.team_name);
  if (String(data.confirm_name === undefined || data.confirm_name === null ? '' : data.confirm_name).trim() !== name) {
    throw new AppError(APP_ERROR.VALIDATION_ERROR, '入力内容に誤りがあります', [
      { field: 'confirm_name', message: (type === ORG_TYPE.TOURNAMENT ? '大会名' : 'チーム名') + 'が違います（「' + name + '」と入力してください）' },
    ]);
  }
  const now = new Date();
  const result = { deleted: true, orgType: type, teamName: name, movedRecords: 0, deletedRecords: 0, createdSolos: 0, untaggedGames: 0 };

  if (type === ORG_TYPE.TOURNAMENT) {
    // 大会の印を外す（成績はチームにそのまま残る）
    gamesOfTournament_(org.team_id).forEach(function (g) {
      updateRecord_(CONFIG.SHEET.GAMES, g._row, { tournament_id: '', updated_at: now });
      appendRecordChanges_('game', g.game_id, user.userId, 'update', { tournament_id: { oldValue: org.team_id, newValue: '' } }, now);
      result.untaggedGames += 1;
    });
  } else {
    const games = activeGamesOf_(org.team_id).sort(compareGames_);
    const records = recordsInGames_(games);
    const ownerHas = records.some(function (x) { return x.record.user_id === user.userId; });
    const ownerMode = data.owner_records;
    if (ownerHas && ownerMode !== 'move' && ownerMode !== 'delete') {
      throw new AppError(APP_ERROR.VALIDATION_ERROR, '入力内容に誤りがあります', [
        { field: 'owner_records', message: 'あなたの成績を、ひとりの記録に移すか消すかを選んでください' },
      ]);
    }
    const t = recordTypes_();
    const soloOf = {};      // user_id → ひとりの記録の行
    const copiedGame = {};  // 「ひとりの記録のID|元の試合のID」→ 写した試合
    records.forEach(function (x) {
      const r = x.record;
      const g = x.game;
      if (r.user_id === user.userId && ownerMode === 'delete') {
        updateRecord_(t[x.type].sheet, r._row, { deleted_at: now, updated_at: now });
        appendRecordChanges_(x.type, r.record_id, user.userId, 'delete', { deleted_at: { oldValue: '', newValue: now } }, now);
        result.deletedRecords += 1;
        return;
      }
      if (!soloOf[r.user_id]) {
        const found = findSoloOf_(r.user_id);
        soloOf[r.user_id] = found || createSolo_(r.user_id, now);
        if (!found) result.createdSolos += 1;
      }
      const solo = soloOf[r.user_id];
      const key = solo.team_id + '|' + g.game_id;
      if (!copiedGame[key]) copiedGame[key] = copyGameToSolo_(g, solo, r.user_id, now);
      const target = copiedGame[key];
      updateRecord_(t[x.type].sheet, r._row, { game_id: target.game_id, updated_at: now });
      appendRecordChanges_(x.type, r.record_id, user.userId, 'update', { game_id: { oldValue: g.game_id, newValue: target.game_id } }, now);
      result.movedRecords += 1;
    });
    // チームの試合を消す（論理削除）
    games.forEach(function (g) {
      updateRecord_(CONFIG.SHEET.GAMES, g._row, { deleted_at: now, updated_at: now });
      appendRecordChanges_('game', g.game_id, user.userId, 'delete', { deleted_at: { oldValue: '', newValue: now } }, now);
    });
  }

  // チーム・大会の行と、所属の行を消す（番号をまた使えるように）。消したことを記録に残す
  appendRecordChanges_(type, org.team_id, user.userId, 'delete', {
    team: { oldValue: name + '（番号 ' + org.team_number + '）', newValue: '' },
  }, now);
  deleteRows_(CONFIG.SHEET.MEMBERSHIPS, membershipsOf_(org.team_id).map(function (m) { return m._row; }));
  const row = findRecord_(CONFIG.SHEET.TEAMS, function (x) { return x.team_id === org.team_id; });
  if (row) deleteRows_(CONFIG.SHEET.TEAMS, [row._row]);
  return result;
}

/** 消せるチーム・大会を探す：代表者（owner）だけ。ひとりの記録・存在しないIDは断る */
function ownedOrgForDelete_(teamId, user) {
  const org = typeof teamId === 'string' && teamId !== ''
    ? findRecord_(CONFIG.SHEET.TEAMS, function (t) { return t.team_id === teamId; })
    : null;
  if (org && orgTypeOf_(org) === ORG_TYPE.SOLO) {
    throw new AppError(APP_ERROR.FORBIDDEN, 'ひとりの記録は消せません');
  }
  const owner = org && findRecord_(CONFIG.SHEET.MEMBERSHIPS, function (m) {
    return m.team_id === teamId && m.user_id === user.userId && m.role === 'owner';
  });
  if (!org || !owner) {
    throw new AppError(APP_ERROR.FORBIDDEN, 'チーム・大会を消せるのは、代表者だけです');
  }
  return org;
}

function membershipsOf_(teamId) {
  return readRecords_(CONFIG.SHEET.MEMBERSHIPS).filter(function (m) { return m.team_id === teamId; });
}

/** 大会が付いている、消していない試合 */
function gamesOfTournament_(tournamentId) {
  return readRecords_(CONFIG.SHEET.GAMES).filter(function (g) {
    return String(g.tournament_id || '') === tournamentId && !g.deleted_at;
  });
}

/** 試合の一覧に付いた、消していない打撃・投手の記録：[{ type, record, game }]（試合の順） */
function recordsInGames_(games) {
  const byId = {};
  games.forEach(function (g) { byId[g.game_id] = g; });
  const list = [];
  ['batting', 'pitching'].forEach(function (type) {
    readRecords_(recordTypes_()[type].sheet).forEach(function (r) {
      if (!r.deleted_at && byId[r.game_id]) list.push({ type: type, record: r, game: byId[r.game_id] });
    });
  });
  const order = {};
  games.forEach(function (g, i) { order[g.game_id] = i; });
  list.sort(function (a, b) { return order[a.game.game_id] - order[b.game.game_id]; });
  return list;
}

/**
 * 試合の情報を、ひとりの記録の側に写した試合を作る（大会の印は外す）。
 * 第何試合は元の番号を使い、その日のひとりの記録に同じ番号があれば、次の番号にする。
 */
function copyGameToSolo_(game, solo, userId, now) {
  const date = dateText_(game.game_date);
  const sameDay = activeGamesOf_(solo.team_id).filter(function (g) { return dateText_(g.game_date) === date; });
  const used = sameDay.map(function (g) { return Number(g.game_number); });
  let number = Number(game.game_number) || 1;
  if (used.indexOf(number) !== -1) number = nextGameNumber_(sameDay);
  const copy = {
    game_id: Utilities.getUuid(),
    team_id: solo.team_id,
    tournament_id: '',
    game_date: date,
    game_number: number,
    opponent: String(game.opponent || ''),
    category: String(game.category || ''),
    result: String(game.result || ''),
    created_by: userId,
    created_at: now,
    updated_at: now,
    deleted_at: '',
  };
  appendRecord_(CONFIG.SHEET.GAMES, copy);
  return copy;
}

/* ---------- ひとりの記録の成績を、チームの試合に移す ---------- */

/**
 * 操作：listSoloMoveTargets
 * 返事：{ soloTeamId, records: [{ record_type, record_id, game_date, game_number, opponent, …数, candidates: [...] }] }
 *   candidates：同じ日の、自分が所属しているチームの試合（{ game_id, team_id, team_name, game_number, opponent,
 *   tournament_name, has_my_record（その試合に同じ種類の自分の成績がすでにある＝移せない） }）
 */
function handleListSoloMoveTargets_(data, user, options) {
  const today = todayText_(options);
  const solo = findSoloOf_(user.userId);
  if (!solo) return { soloTeamId: '', records: [] };
  const soloGames = {};
  activeGamesOf_(solo.team_id).forEach(function (g) { soloGames[g.game_id] = g; });

  // 移す先になれるのは、今所属しているチーム（大会とひとりの記録は除く）の、消していない試合
  const myTeams = handleListMyTeams_({}, user).teams.filter(function (t) { return t.orgType === ORG_TYPE.TEAM; });
  const teamName = {};
  myTeams.forEach(function (t) { teamName[t.teamId] = t.teamName; });
  const teamGamesByDate = {};
  readRecords_(CONFIG.SHEET.GAMES).forEach(function (g) {
    if (g.deleted_at || !teamName.hasOwnProperty(g.team_id)) return;
    const d = dateText_(g.game_date);
    (teamGamesByDate[d] = teamGamesByDate[d] || []).push(g);
  });

  const t = recordTypes_();
  const mine = {};
  ['batting', 'pitching'].forEach(function (type) {
    mine[type] = readRecords_(t[type].sheet).filter(function (r) { return r.user_id === user.userId && !r.deleted_at; });
  });
  const hasMine = function (type, gameId) { return mine[type].some(function (r) { return r.game_id === gameId; }); };

  const list = [];
  ['batting', 'pitching'].forEach(function (type) {
    mine[type].forEach(function (r) {
      const g = soloGames[r.game_id];
      if (!g) return;
      const summary = toRecordSummary_(t[type], r, g, user, today);
      summary.record_type = type;
      summary.candidates = (teamGamesByDate[dateText_(g.game_date)] || []).slice().sort(compareGames_).map(function (tg) {
        const s = toGameSummary_(tg, user, today);
        return {
          game_id: s.game_id, team_id: s.team_id, team_name: teamName[tg.team_id], game_number: s.game_number,
          opponent: s.opponent, tournament_name: s.tournament_name, has_my_record: hasMine(type, tg.game_id),
        };
      });
      list.push(summary);
    });
  });
  list.sort(function (a, b) {
    return a.game_date < b.game_date ? 1 : a.game_date > b.game_date ? -1
      : (a.game_number - b.game_number) || (a.record_type < b.record_type ? -1 : 1);
  });
  return { soloTeamId: solo.team_id, records: list };
}

/**
 * 操作：moveSoloRecords
 * data: { moves: [{ record_type: 'batting'|'pitching', record_id, game_id（移す先のチームの試合） }] }（1〜50件）
 * すべて確かめてから、まとめて移す（1件でもまちがいがあれば、何も移さない）。
 * 移したあと、記録が1件も無くなったひとりの記録の試合は消す（論理削除）。
 * 返事：{ moved: 件数, deletedSoloGames: 件数 }
 */
function handleMoveSoloRecords_(data, user) {
  const moves = Array.isArray(data.moves) ? data.moves : null;
  if (!moves || moves.length === 0 || moves.length > DELETE_MOVE_MAX) {
    throw new AppError(APP_ERROR.BAD_REQUEST, '移す記録を1〜' + DELETE_MOVE_MAX + '件選んでください');
  }
  const solo = findSoloOf_(user.userId);
  if (!solo) throw new AppError(APP_ERROR.FORBIDDEN, 'ひとりの記録がありません');
  const t = recordTypes_();
  const errors = [];
  const plan = [];
  const taken = {}; // 同じ移す先に、同じ種類を2件移そうとしていないか

  moves.forEach(function (mv, i) {
    const type = mv && mv.record_type;
    const label = '（' + (i + 1) + '件目）';
    if (type !== 'batting' && type !== 'pitching') { errors.push({ field: 'moves', message: label + '成績の種類がまちがっています' }); return; }
    const rec = findRecord_(t[type].sheet, function (r) { return r.record_id === mv.record_id; });
    if (!rec || rec.user_id !== user.userId || rec.deleted_at) {
      throw new AppError(APP_ERROR.FORBIDDEN, '自分の記録だけを移せます');
    }
    const from = findActiveGame_(rec.game_id);
    if (!from || from.team_id !== solo.team_id) {
      throw new AppError(APP_ERROR.FORBIDDEN, '移せるのは、ひとりの記録の成績だけです');
    }
    const to = findActiveGame_(mv.game_id);
    const toTeam = to && findRecord_(CONFIG.SHEET.TEAMS, function (x) { return x.team_id === to.team_id; });
    if (!to || !toTeam || orgTypeOf_(toTeam) !== ORG_TYPE.TEAM || !isMemberOfTeamType_(user.userId, to.team_id)) {
      throw new AppError(APP_ERROR.FORBIDDEN, '移せるのは、所属しているチームの試合だけです');
    }
    const date = dateText_(from.game_date);
    const what = date + 'の' + t[type].label + '成績';
    if (dateText_(to.game_date) !== date) {
      errors.push({ field: 'moves', message: what + '：同じ日のチームの試合にだけ移せます' });
      return;
    }
    const exists = readRecords_(t[type].sheet).some(function (r) {
      return r.user_id === user.userId && !r.deleted_at && r.game_id === to.game_id;
    });
    const key = type + '|' + to.game_id;
    if (exists || taken[key]) {
      errors.push({ field: 'moves', message: what + '：移す先の試合に、あなたの' + t[type].label + '成績がすでにあります' });
      return;
    }
    taken[key] = true;
    plan.push({ type: type, record: rec, from: from, to: to });
  });
  if (errors.length) throw new AppError(APP_ERROR.VALIDATION_ERROR, '入力内容に誤りがあります', errors);

  const now = new Date();
  plan.forEach(function (p) {
    updateRecord_(t[p.type].sheet, p.record._row, { game_id: p.to.game_id, updated_at: now });
    appendRecordChanges_(p.type, p.record.record_id, user.userId, 'update', { game_id: { oldValue: p.from.game_id, newValue: p.to.game_id } }, now);
  });
  // 記録が無くなったひとりの記録の試合は消す（カレンダーに空の試合が残らないように）
  let deletedSoloGames = 0;
  const seen = {};
  plan.forEach(function (p) {
    if (seen[p.from.game_id]) return;
    seen[p.from.game_id] = true;
    if (gameHasActiveRecords_(p.from.game_id)) return;
    const g = findActiveGame_(p.from.game_id);
    updateRecord_(CONFIG.SHEET.GAMES, g._row, { deleted_at: now, updated_at: now });
    appendRecordChanges_('game', g.game_id, user.userId, 'delete', { deleted_at: { oldValue: '', newValue: now } }, now);
    deletedSoloGames += 1;
  });
  return { moved: plan.length, deletedSoloGames: deletedSoloGames };
}
