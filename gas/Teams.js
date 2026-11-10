/**
 * チーム（CLAUDE.md 第4.2章・第4.3章・第4.8章）
 *
 * B-6：チームの作成、自分のチーム一覧
 * B-6追加：チームへの参加、合言葉の変更（このあと作る）
 */

/**
 * 操作：createTeam（チームを作る）
 * data: { team_number: '2026', team_name: '〇〇ナイン', passphrase: '合言葉' }
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
  const teamNumber = checkTeamNumberFormat_(data.team_number, errors);
  const teamName = checkTeamName_(data.team_name, errors);
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
 * 操作：listMyTeams（自分が所属しているチームの一覧）
 * 参加した順に並べる。合言葉のハッシュなどは返さない。
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
    errors.push({ field: 'team_number', message: 'チーム番号は1〜999999999の数字で入力してください（先頭に0は付けません）' });
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

/** チーム名：1〜30文字 */
function checkTeamName_(value, errors) {
  const name = typeof value === 'string' ? value.trim() : '';
  const length = Array.from(name).length;
  if (length < 1 || length > CONFIG.TEAM_NAME_MAX || /[\u0000-\u001f\u007f]/.test(name)) {
    errors.push({ field: 'team_name', message: 'チーム名は1〜' + CONFIG.TEAM_NAME_MAX + '文字で入力してください' });
    return null;
  }
  return name;
}

function findTeamByNumber_(teamNumber) {
  return findRecord_(CONFIG.SHEET.TEAMS, function (t) { return String(t.team_number) === String(teamNumber); });
}

/** 画面に返すチームの情報（合言葉のハッシュや塩は含めない） */
function toTeamSummary_(team, role) {
  return {
    teamId: team.team_id,
    teamNumber: String(team.team_number),
    teamName: String(team.team_name),
    role: role,
  };
}
