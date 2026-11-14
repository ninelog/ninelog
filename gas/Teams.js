/**
 * 組織（チームと大会）（CLAUDE.md 第4.2章・第4.3章・第4.8章・11.7章）
 *
 * teams シートは「組織」の表で、org_type 列でチーム（team）と大会（tournament）を区別する。
 * 番号・合言葉・参加のしかたは、チームも大会も同じ。番号は同じ表の中で重ならない。
 * 成績を付けられるのはチームと「ひとりの記録」（大会は、試合に結びつけて使う）。
 * 2026-11-14 B-19：3つめの種類「ひとり」（solo）を足した。本人だけがメンバー（代表者）の記録場所で、
 *   番号・合言葉は持たず、誰も参加できない。ランキング・チーム全体の成績には出さない（11.8章）。
 *
 * B-6：作成、自分の一覧／B-6追加（Join.js）：参加、合言葉の変更／B-10a：組織の種類
 */

/** 組織の種類 */
const ORG_TYPE = {
  TEAM: 'team',
  TOURNAMENT: 'tournament',
  SOLO: 'solo', // ひとりの記録（11.8章。B-19）
};

/** ひとりの記録場所の名前（固定。11.8章の2） */
const SOLO_NAME = 'ひとりの記録';

/** シートの org_type を読む（空の古い行はチームとして扱う） */
function orgTypeOf_(team) {
  if (team.org_type === ORG_TYPE.TOURNAMENT) return ORG_TYPE.TOURNAMENT;
  if (team.org_type === ORG_TYPE.SOLO) return ORG_TYPE.SOLO;
  return ORG_TYPE.TEAM;
}

/** 試合を作って成績を付けられる種類か（チームと、ひとりの記録） */
function isRecordableOrgType_(orgType) {
  return orgType === ORG_TYPE.TEAM || orgType === ORG_TYPE.SOLO;
}

/** 画面の文言に使う名前（「チーム」または「大会」） */
function orgLabel_(orgType) {
  if (orgType === ORG_TYPE.SOLO) return 'ひとりの記録';
  return orgType === ORG_TYPE.TOURNAMENT ? '大会' : 'チーム';
}

/**
 * 操作：createTeam（チームまたは大会を作る）
 * data: { org_type: 'team'（省略可）または 'tournament', team_number: '2026', team_name: '〇〇ナイン', passphrase: '合言葉' }
 * 作った人が代表者（owner）になり、memberships にも1行足す。
 * 書き込む操作なので、順番待ちの中で呼ばれる（Main.js の write: true）。
 *
 * options.forAutomatedTest：自動テストのときだけ true にする。
 *   true のときは、自動テスト専用の番号（999999900〜999999999）だけを作れて、それ以外は作れない。
 *   画面からの要求（dispatch_）は handler に2つしか渡さないので、画面から true にすることはできない。
 */
function handleCreateTeam_(data, user, options) {
  const forAutomatedTest = Boolean(options && options.forAutomatedTest);
  const errors = [];
  let orgType = ORG_TYPE.TEAM;
  if (data.org_type !== undefined && data.org_type !== null && data.org_type !== '') {
    if (data.org_type === ORG_TYPE.TEAM || data.org_type === ORG_TYPE.TOURNAMENT) {
      orgType = data.org_type;
    } else {
      errors.push({ field: 'org_type', message: '種類は「チーム」か「大会」を選んでください' });
    }
  }
  const teamNumber = checkTeamNumberFormat_(data.team_number, errors);
  const teamName = checkTeamName_(data.team_name, errors, orgType);
  let passphrase = null;
  try {
    passphrase = validatePassphrase_(data.passphrase);
  } catch (err) {
    if (err.details) errors.push.apply(errors, err.details);
    else throw err;
  }

  // 番号の形が正しいときだけ、予約番号・使用済みかを確かめる
  if (teamNumber !== null) {
    const problem = teamNumberRuleProblem_(teamNumber, user.isAdmin, forAutomatedTest);
    if (problem) {
      errors.push({ field: 'team_number', message: problem });
    } else if (findTeamByNumber_(teamNumber)) {
      errors.push({ field: 'team_number', message: 'この番号は使われています' });
    }
  }
  throwIfErrors_(errors);

  const now = new Date();
  const salt = newPassphraseSalt_();
  const team = {
    team_id: Utilities.getUuid(),
    team_number: teamNumber,
    team_name: teamName,
    passphrase_hash: hashPassphrase_(passphrase, salt),
    passphrase_salt: salt,
    created_by: user.userId,
    created_at: now,
    updated_at: now,
    org_type: orgType,
  };
  appendRecord_(CONFIG.SHEET.TEAMS, team);
  appendRecord_(CONFIG.SHEET.MEMBERSHIPS, {
    membership_id: Utilities.getUuid(),
    user_id: user.userId,
    team_id: team.team_id,
    role: 'owner',
    joined_at: now,
  });

  return { team: toTeamSummary_(team, 'owner') };
}

/**
 * 操作：listMyTeams（自分が所属しているチームと大会の一覧）
 * 参加した順に並べる。それぞれに orgType（'team' か 'tournament'）が付く。
 * 合言葉のハッシュなどは返さない。
 */
function handleListMyTeams_(data, user) {
  const memberships = readRecords_(CONFIG.SHEET.MEMBERSHIPS)
    .filter(function (m) { return m.user_id === user.userId; })
    .sort(function (a, b) { return new Date(a.joined_at) - new Date(b.joined_at); });

  const teamsById = {};
  readRecords_(CONFIG.SHEET.TEAMS).forEach(function (t) { teamsById[t.team_id] = t; });

  const teams = [];
  memberships.forEach(function (m) {
    const team = teamsById[m.team_id];
    if (team) teams.push(toTeamSummary_(team, m.role));
  });
  return { teams: teams };
}

/* ---------- ここから下は、確かめ方と探し方 ---------- */

/**
 * チーム番号の形を確かめる：数字だけ、1〜9桁、先頭に0は付けない。
 * 全角数字も受け付ける（「２０２６」→「2026」）。
 * @return {string|null} そろえた番号（文字）。正しくなければ null
 */
function checkTeamNumberFormat_(value, errors) {
  const text = (typeof value === 'number' || typeof value === 'string')
    ? String(value).normalize('NFKC').trim()
    : '';
  if (!/^[1-9][0-9]{0,8}$/.test(text)) {
    errors.push({ field: 'team_number', message: '番号は1〜999999999の数字で入力してください（先頭に0は付けません）' });
    return null;
  }
  return text;
}

/**
 * チーム番号の「使ってよいか」の決まり（シートは見ない。CLAUDE.md 第4.8章）
 * - 999999900〜999999999：自動テスト専用。画面からは管理者を含めて誰も作れない
 * - 1〜1998：管理者が人の手でテストするための予約番号。管理者だけが作れる
 * - 自動テストのときは、自動テスト専用の番号しか作れない（本物のチームの番号に触れないため）
 * @return {string|null} 使えない理由。使ってよければ null
 */
function teamNumberRuleProblem_(teamNumber, isAdmin, forAutomatedTest) {
  const n = Number(teamNumber);
  if (isTestTeamNumber_(n)) {
    return forAutomatedTest ? null : 'この番号は使えません';
  }
  if (forAutomatedTest) {
    return '自動テストでは、自動テスト専用の番号（' + CONFIG.TEST_TEAM_NUMBER_MIN + '〜）だけを使います';
  }
  if (n <= CONFIG.RESERVED_TEAM_NUMBER_MAX && !isAdmin) {
    return 'この番号は使えません';
  }
  return null;
}

/** 自動テスト専用の番号か */
function isTestTeamNumber_(teamNumber) {
  const n = Number(teamNumber);
  return n >= CONFIG.TEST_TEAM_NUMBER_MIN && n <= CONFIG.TEST_TEAM_NUMBER_MAX;
}

/** チーム名・大会名：1〜30文字 */
function checkTeamName_(value, errors, orgType) {
  const name = typeof value === 'string' ? value.trim() : '';
  const length = Array.from(name).length;
  if (length < 1 || length > CONFIG.TEAM_NAME_MAX || /[\u0000-\u001f\u007f]/.test(name)) {
    errors.push({ field: 'team_name', message: orgLabel_(orgType) + '名は1〜' + CONFIG.TEAM_NAME_MAX + '文字で入力してください' });
    return null;
  }
  return name;
}

function findTeamByNumber_(teamNumber) {
  return findRecord_(CONFIG.SHEET.TEAMS, function (t) { return String(t.team_number) === String(teamNumber); });
}

/** 画面に返すチーム・大会の情報（合言葉のハッシュや塩は含めない） */
function toTeamSummary_(team, role) {
  return {
    teamId: team.team_id,
    teamNumber: String(team.team_number),
    teamName: String(team.team_name),
    orgType: orgTypeOf_(team),
    role: role,
  };
}

/**
 * そのIDの組織が、成績を付けられる種類（チーム・ひとりの記録）で、本人が所属しているか。
 * （B-19 から、ひとりの記録も含む。ひとりの記録は本人しかメンバーにならない）
 */
function isMemberOfTeamType_(userId, teamId) {
  if (!findMembership_(userId, teamId)) return false;
  const team = findRecord_(CONFIG.SHEET.TEAMS, function (t) { return t.team_id === teamId; });
  return Boolean(team) && isRecordableOrgType_(orgTypeOf_(team));
}

/**
 * 操作：startSolo（ひとりで記録する。11.8章。B-19）
 * 本人専用の記録場所を作る。1人に1つだけで、すでにあれば、それを返す（created: false）。
 * 番号と合言葉は持たないので、誰も参加できない。
 * @return {{ created: boolean, team: Object }}
 */
function handleStartSolo_(data, user) {
  const existing = findSoloOf_(user.userId);
  if (existing) return { created: false, team: toTeamSummary_(existing, 'owner') };
  return { created: true, team: toTeamSummary_(createSolo_(user.userId, new Date()), 'owner') };
}

/**
 * ひとりの記録場所を作る（本人が代表者のメンバー1行も足す）。
 * startSolo のほか、チームを消すときに、ひとりの記録が無いメンバーの分を自動で作るのにも使う（B-21）。
 * @return {Object} 作った teams の行
 */
function createSolo_(userId, now) {
  const team = {
    team_id: Utilities.getUuid(),
    team_number: '',
    team_name: SOLO_NAME,
    passphrase_hash: '',
    passphrase_salt: '',
    created_by: userId,
    created_at: now,
    updated_at: now,
    org_type: ORG_TYPE.SOLO,
  };
  appendRecord_(CONFIG.SHEET.TEAMS, team);
  appendRecord_(CONFIG.SHEET.MEMBERSHIPS, {
    membership_id: Utilities.getUuid(),
    user_id: userId,
    team_id: team.team_id,
    role: 'owner',
    joined_at: now,
  });
  return team;
}

/** 本人のひとりの記録場所（無ければ null） */
function findSoloOf_(userId) {
  return findRecord_(CONFIG.SHEET.TEAMS, function (t) {
    return orgTypeOf_(t) === ORG_TYPE.SOLO && t.created_by === userId;
  });
}
