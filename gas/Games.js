/**
 * 試合（CLAUDE.md 11.0章・11.1章）
 *
 * - その日の成績を最初に入力する選手が試合を作る。ほかの選手は一覧から選ぶ。
 * - 同じチーム・同じ日・同じ番号（第何試合）の試合は2つ作れない。第何試合は1〜9。
 * - 作れるのは、所属しているチームの試合だけ。試合日から30日以内（成績と同じ期限）。
 * - 直せる・消せるのは、試合を作った人とチームの代表者だけ（大会の代表者や管理者は不可）。
 *   直すのも消すのも、試合日から30日以内（日付を変えるときは前後とも）。
 * - 消せるのは、有効な成績が1件も付いていないときだけ（論理削除）。
 * - 直す・消すは record_changes に記録する（record_type が game）。
 * - 大会（11.7章のC）：試合に大会を1つだけ付けられる（任意）。選べるのは、その操作をする人
 *   （作るときは作る人、直すときは直す人）が参加している大会だけ。外す（空にする）のは誰でもよい。
 *   大会を付けて試合区分が空なら、区分は「公式戦」にする（11.7章のD）。
 *
 * options（自動テストのときだけ。画面からは渡せない）：today（今日の日付を決め打ち）
 */

const GAME_CATEGORIES = ['official', 'practice', 'other']; // 公式戦・練習試合・その他（11.7章のD）
const GAME_RESULTS = ['win', 'lose', 'draw'];               // 勝ち・負け・引き分け
const GAME_EDIT_FIELDS = ['tournament_id', 'game_date', 'game_number', 'opponent', 'category', 'result'];

/**
 * 操作：createGame（試合を作る）
 * data: { team_id, tournament_id（省略可）, game_date, game_number（省略するとその日の次の番号）, opponent, category, result }
 */
function handleCreateGame_(data, user, options) {
  const today = todayText_(options);
  const v = validateGameInput_(data, today);
  if (!isWithinEditPeriod_(v.game_date, today)) {
    throw editPeriodOverError_();
  }
  if (!isMemberOfTeamType_(user.userId, v.team_id)) {
    throw new AppError(APP_ERROR.FORBIDDEN, '所属していないチームの試合は作れません');
  }
  if (v.tournament_id) {
    assertMyTournament_(user.userId, v.tournament_id);
    if (!v.category) v.category = 'official';
  }

  const sameDay = activeGamesOf_(v.team_id).filter(function (g) { return dateText_(g.game_date) === v.game_date; });
  if (v.game_number === null) {
    v.game_number = nextGameNumber_(sameDay);
    if (v.game_number > CONFIG.GAME_NUMBER_MAX) {
      throw gameNumberError_('この日は、もう試合を作れません（第' + CONFIG.GAME_NUMBER_MAX + '試合まで）');
    }
  } else if (sameDay.some(function (g) { return Number(g.game_number) === v.game_number; })) {
    throw gameNumberError_('この日の第' + v.game_number + '試合は、すでにあります（一覧から選んでください）');
  }

  const now = new Date();
  const game = {
    game_id: Utilities.getUuid(),
    team_id: v.team_id,
    tournament_id: v.tournament_id,
    game_date: v.game_date,
    game_number: v.game_number,
    opponent: v.opponent,
    category: v.category,
    result: v.result,
    created_by: user.userId,
    created_at: now,
    updated_at: now,
    deleted_at: '',
  };
  appendRecord_(CONFIG.SHEET.GAMES, game);
  return { game: toGameSummary_(game, user, today) };
}

/**
 * 操作：listTeamGames（チームの試合の一覧）
 * data: { team_id, game_date（省略可。指定するとその日の試合だけ） }
 * game_date を省略すると、入力・修正ができる期間（30日以内）の試合を返す。
 * 返事：games（新しい日から、同じ日は番号の順）、nextGameNumber（game_date を指定したとき）、
 *       opponentSuggestions（そのチームで前に使った対戦相手。最近使った順）
 * 試合の情報だけを返し、誰がどんな成績を記録したかは返さない（11.3章）。
 */
function handleListTeamGames_(data, user, options) {
  const today = todayText_(options);
  const teamId = typeof data.team_id === 'string' ? data.team_id : '';
  if (!teamId || !isMemberOfTeamType_(user.userId, teamId)) {
    throw new AppError(APP_ERROR.FORBIDDEN, '所属していないチームの試合は見られません');
  }
  const all = activeGamesOf_(teamId);

  let date = null;
  if (data.game_date !== undefined && data.game_date !== null && data.game_date !== '') {
    const errors = [];
    date = checkGameDate_(data.game_date, errors, { today: today });
    throwIfErrors_(errors);
  }
  const games = all
    .filter(function (g) {
      const d = dateText_(g.game_date);
      return date ? d === date : isWithinEditPeriod_(d, today);
    })
    .sort(compareGames_);

  const result = {
    games: games.map(function (g) { return toGameSummary_(g, user, today); }),
    opponentSuggestions: opponentSuggestions_(all),
    // 試合に付けられる大会（本人が参加している大会）
    myTournaments: handleListMyTeams_({}, user).teams
      .filter(function (t) { return t.orgType === ORG_TYPE.TOURNAMENT; })
      .map(function (t) { return { tournamentId: t.teamId, tournamentNumber: t.teamNumber, tournamentName: t.teamName }; }),
  };
  if (date) result.nextGameNumber = nextGameNumber_(games);
  return result;
}

/**
 * 操作：updateGame（試合の情報を直す。作った人とチームの代表者だけ）
 * data: { game_id, game_date, game_number, opponent, category, result }（チームは変えられない）
 */
function handleUpdateGame_(data, user, options) {
  const today = todayText_(options);
  const current = findEditableGame_(data.game_id, user);
  if (!isWithinEditPeriod_(dateText_(current.game_date), today)) {
    throw editPeriodOverError_();
  }
  const v = validateGameInput_(Object.assign({}, data, { team_id: String(current.team_id) }), today);
  if (v.game_number === null) v.game_number = Number(current.game_number);
  if (data.tournament_id === undefined) v.tournament_id = String(current.tournament_id || ''); // 送られなければ今のまま
  if (!isWithinEditPeriod_(v.game_date, today)) {
    throw editPeriodOverError_();
  }
  // 大会を「別の大会に変える／新しく付ける」ときは、直す人が参加している大会だけ。外す・そのままは自由
  if (v.tournament_id && v.tournament_id !== String(current.tournament_id || '')) {
    assertMyTournament_(user.userId, v.tournament_id);
  }
  const clash = activeGamesOf_(current.team_id).some(function (g) {
    return g.game_id !== current.game_id && dateText_(g.game_date) === v.game_date && Number(g.game_number) === v.game_number;
  });
  if (clash) {
    throw gameNumberError_('この日の第' + v.game_number + '試合は、すでにあります');
  }

  const changes = {};
  GAME_EDIT_FIELDS.forEach(function (field) {
    const before = field === 'game_date' ? dateText_(current[field])
      : field === 'game_number' ? Number(current[field])
        : String(current[field] === null || current[field] === undefined ? '' : current[field]);
    if (String(before) !== String(v[field])) {
      changes[field] = { oldValue: before, newValue: v[field] };
    }
  });
  if (Object.keys(changes).length === 0) {
    return { unchanged: true, game: toGameSummary_(current, user, today) };
  }

  const now = new Date();
  const update = { updated_at: now };
  Object.keys(changes).forEach(function (field) { update[field] = changes[field].newValue; });
  updateRecord_(CONFIG.SHEET.GAMES, current._row, update);
  appendRecordChanges_('game', current.game_id, user.userId, 'update', changes, now);
  return { unchanged: false, game: toGameSummary_(Object.assign({}, current, update), user, today) };
}

/**
 * 操作：deleteGame（試合を消す。作った人とチームの代表者だけ。成績が付いていないときだけ）
 * data: { game_id }
 */
function handleDeleteGame_(data, user, options) {
  const today = todayText_(options);
  const current = findEditableGame_(data.game_id, user);
  if (!isWithinEditPeriod_(dateText_(current.game_date), today)) {
    throw editPeriodOverError_();
  }
  if (gameHasActiveRecords_(current.game_id)) {
    throw new AppError(APP_ERROR.GAME_HAS_RECORDS, '成績が付いている試合は消せません（先に、その試合の成績を消してください）');
  }
  const now = new Date();
  updateRecord_(CONFIG.SHEET.GAMES, current._row, { deleted_at: now, updated_at: now });
  appendRecordChanges_('game', current.game_id, user.userId, 'delete', { deleted_at: { oldValue: '', newValue: now } }, now);
  return { deleted: true, gameId: current.game_id };
}

/* ---------- 入力チェック ---------- */

/**
 * 試合の入力を確かめて、保存する形にそろえる。
 * game_number は、空なら null（作るときは次の番号、直すときは今の番号にする）。
 */
function validateGameInput_(data, today) {
  const errors = [];
  const v = {
    team_id: checkTeamId_(data.team_id, errors),
    tournament_id: '',
    game_date: checkGameDate_(data.game_date, errors, { today: today }),
    game_number: null,
    opponent: '',
    category: '',
    result: '',
  };

  if (data.game_number !== undefined && data.game_number !== null && data.game_number !== '') {
    const n = checkCount_(data.game_number, 'game_number', '第何試合', CONFIG.GAME_NUMBER_MAX, errors);
    if (n === 0) {
      errors.push({ field: 'game_number', message: '「第何試合」は1〜' + CONFIG.GAME_NUMBER_MAX + 'で入力してください' });
    } else {
      v.game_number = n;
    }
  }

  if (data.opponent !== undefined && data.opponent !== null) {
    const opponent = String(data.opponent).trim();
    if (Array.from(opponent).length > CONFIG.OPPONENT_MAX || /[\u0000-\u001f\u007f]/.test(opponent)) {
      errors.push({ field: 'opponent', message: '対戦相手は' + CONFIG.OPPONENT_MAX + '文字までで入力してください' });
    } else {
      v.opponent = opponent;
    }
  }
  if (data.tournament_id !== undefined && data.tournament_id !== null && data.tournament_id !== '') {
    if (typeof data.tournament_id !== 'string' || data.tournament_id.length > 64) {
      errors.push({ field: 'tournament_id', message: '参加している大会だけを選べます' });
    } else {
      v.tournament_id = data.tournament_id;
    }
  }
  v.category = checkChoice_(data.category, GAME_CATEGORIES, 'category', '試合区分は「公式戦」「練習試合」「その他」から選んでください', errors);
  v.result = checkChoice_(data.result, GAME_RESULTS, 'result', '勝敗は「勝ち」「負け」「引き分け」から選んでください', errors);

  throwIfErrors_(errors);
  return v;
}

/** 選択式の項目：空か、決められた値のどれか */
function checkChoice_(value, choices, field, message, errors) {
  if (value === undefined || value === null || value === '') return '';
  if (choices.indexOf(value) === -1) {
    errors.push({ field: field, message: message });
    return '';
  }
  return value;
}

/**
 * 本人が参加している大会か確かめる（チームのIDや、存在しないIDも同じ返事）。
 */
function assertMyTournament_(userId, tournamentId) {
  const ok = Boolean(findMembership_(userId, tournamentId)) && (function () {
    const t = findRecord_(CONFIG.SHEET.TEAMS, function (x) { return x.team_id === tournamentId; });
    return Boolean(t) && orgTypeOf_(t) === ORG_TYPE.TOURNAMENT;
  })();
  if (!ok) {
    throw new AppError(APP_ERROR.VALIDATION_ERROR, '入力内容に誤りがあります', [
      { field: 'tournament_id', message: '参加している大会だけを選べます' },
    ]);
  }
}

function gameNumberError_(message) {
  return new AppError(APP_ERROR.VALIDATION_ERROR, '入力内容に誤りがあります', [{ field: 'game_number', message: message }]);
}

/* ---------- 探し方・権限 ---------- */

/** そのチームの、消していない試合 */
function activeGamesOf_(teamId) {
  return readRecords_(CONFIG.SHEET.GAMES).filter(function (g) { return g.team_id === teamId && !g.deleted_at; });
}

/** 消していない試合を1つ探す（無ければ null） */
function findActiveGame_(gameId) {
  if (typeof gameId !== 'string' || gameId === '') return null;
  return findRecord_(CONFIG.SHEET.GAMES, function (g) { return g.game_id === gameId && !g.deleted_at; });
}

/**
 * 直せる試合を探す。作った人かチームの代表者でなければ断る。
 * 試合が無い場合も同じ返事にする（ほかのチームの試合を探られないように）。
 */
function findEditableGame_(gameId, user) {
  const game = findActiveGame_(gameId);
  if (!game || !canEditGame_(game, user.userId)) {
    throw new AppError(APP_ERROR.FORBIDDEN, '試合の情報を直せるのは、試合を作った人とチームの代表者だけです');
  }
  return game;
}

/** 作った人か、チームの代表者か（今も所属している人に限る） */
function canEditGame_(game, userId) {
  const membership = findMembership_(userId, game.team_id);
  if (!membership) return false;
  return game.created_by === userId || membership.role === 'owner';
}

/** その試合に、有効な成績（打撃・投手）が付いているか */
function gameHasActiveRecords_(gameId) {
  return [CONFIG.SHEET.BATTING, CONFIG.SHEET.PITCHING].some(function (sheet) {
    return readRecords_(sheet).some(function (r) { return r.game_id === gameId && !r.deleted_at; });
  });
}

/** その日の次の番号（同じ日の試合の一番大きい番号＋1） */
function nextGameNumber_(sameDayGames) {
  return sameDayGames.reduce(function (max, g) { return Math.max(max, Number(g.game_number) || 0); }, 0) + 1;
}

/** 並び順：新しい日から。同じ日は番号の小さい順 */
function compareGames_(a, b) {
  const byDate = dateText_(b.game_date).localeCompare(dateText_(a.game_date));
  return byDate !== 0 ? byDate : Number(a.game_number) - Number(b.game_number);
}

/** そのチームで前に使った対戦相手（重ならないように。最近の試合で使った順） */
function opponentSuggestions_(games) {
  const names = [];
  games.slice().sort(compareGames_).forEach(function (g) {
    const name = String(g.opponent || '').trim();
    if (name && names.indexOf(name) === -1) names.push(name);
  });
  return names;
}

/**
 * 画面に返す試合の情報（誰が作ったかのIDは返さず、本人が作ったかどうかだけ）
 * tournament_name：付いている大会の名前。in_my_tournament：本人がその大会に参加しているか
 *   （参加していなければ、この試合の成績は大会のランキングに載らない。11.7章のK）
 */
function toGameSummary_(game, user, today) {
  const gameDate = dateText_(game.game_date);
  const tournamentId = String(game.tournament_id || '');
  const tournament = tournamentId
    ? findRecord_(CONFIG.SHEET.TEAMS, function (t) { return t.team_id === tournamentId; })
    : null;
  return {
    game_id: game.game_id,
    team_id: game.team_id,
    tournament_id: tournamentId,
    tournament_name: tournament ? String(tournament.team_name) : '',
    in_my_tournament: Boolean(tournamentId) && Boolean(findMembership_(user.userId, tournamentId)),
    game_date: gameDate,
    game_number: Number(game.game_number),
    opponent: String(game.opponent || ''),
    category: String(game.category || ''),
    result: String(game.result || ''),
    created_by_me: game.created_by === user.userId,
    can_edit: canEditGame_(game, user.userId) && isWithinEditPeriod_(gameDate, today),
    editable_until: addDays_(gameDate, CONFIG.RECORD_EDIT_DAYS),
  };
}
