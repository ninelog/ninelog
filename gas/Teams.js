/**
 * 組織（チームと大会）（CLAUDE.md 第4.2章・第4.3章・第4.8章・11.7章）
 *
 * teams シートは「組織」の表で、org_type 列でチーム（team）と大会（tournament）を区別する。
 * 番号・合言葉・参加のしかたは、チームも大会も同じ。番号は同じ表の中で重ならない。
 * 成績を付けられるのはチームと「個人用の記録」（大会は、試合に結びつけて使う）。
 * 2026-11-14 B-19：3つめの種類「個人用の記録」（solo。最初の名前は「個人用の記録」）を足した。本人だけがメンバー（代表者）の記録場所で、
 *   番号・合言葉は持たず、誰も参加できない。ランキング・チーム全体の成績には出さない（11.8章）。
 *
 * B-6：作成、自分の一覧／B-6追加（Join.js）：参加、合言葉の変更／B-10a：組織の種類
 */

/** 組織の種類 */
const ORG_TYPE = {
  TEAM: 'team',
  TOURNAMENT: 'tournament',
  SOLO: 'solo', // 個人用の記録（11.8章。B-19）
};

/** 個人用の記録場所の名前（固定。11.8章の2） */
const SOLO_NAME = '個人用の記録';

/** シートの org_type を読む（空の古い行はチームとして扱う） */
function orgTypeOf_(team) {
  if (team.org_type === ORG_TYPE.TOURNAMENT) return ORG_TYPE.TOURNAMENT;
  if (team.org_type === ORG_TYPE.SOLO) return ORG_TYPE.SOLO;
  return ORG_TYPE.TEAM;
}

/** 試合を作って成績を付けられる種類か（チームと、個人用の記録） */
function isRecordableOrgType_(orgType) {
  return orgType === ORG_TYPE.TEAM || orgType === ORG_TYPE.SOLO;
}

/** 画面の文言に使う名前（「チーム」または「大会」） */
function orgLabel_(orgType) {
  if (orgType === ORG_TYPE.SOLO) return '個人用の記録';
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
  const teamNumber = checkTeamNumberFormat_(data.team_number, errors, { forCreate: true, isAdmin: Boolean(user.isAdmin) });
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
      errors.push({ field: 'team_number', message: TEAM_NUMBER_USED_MESSAGE });
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

/*
 * チーム・大会のID（2026-11-15 利用者が決定。前の「番号」。シートの列の名前は team_number のまま）
 * - 使える文字：半角の英字と数字だけ（記号は不可）。全角で入れても半角にそろえ、英字は小文字にそろえる
 *   （大文字・小文字は区別しない。同じIDとして扱う）。
 * - 作るとき：4〜20文字。参加するとき：1〜20文字（前に作った「5」「201」などの短い番号も、そのままIDとして使えるように）。
 * - テスト用のID（1〜1998の数字。管理者だけが作れる）と、自動テスト用のID（999999900〜999999999）は取っておく。
 *   一般の人がこれらを作ろうとしたときは、ほかと重なったときと同じ文だけを出す（テスト用・予約という言葉は出さない）。
 */

/** IDをそろえる：全角→半角（NFKC）、前後の空白を取る、英字を小文字に */
function normalizeTeamId_(value) {
  return (typeof value === 'number' || typeof value === 'string')
    ? String(value).normalize('NFKC').trim().toLowerCase()
    : '';
}

/**
 * IDの形を確かめる。
 * options.forCreate：作るとき（4〜20文字。管理者は、テスト用のID（1〜1998の数字）なら短くてもよい）
 * options.isAdmin：管理者か
 * @return {string|null} そろえたID。正しくなければ null（errors に理由を足す）
 */
function checkTeamNumberFormat_(value, errors, options) {
  const forCreate = Boolean(options && options.forCreate);
  const isAdmin = Boolean(options && options.isAdmin);
  const id = normalizeTeamId_(value);
  const length = Array.from(id).length;
  let message = '';
  if (id === '') {
    message = 'IDを入力してください';
  } else if (!/^[a-z0-9]+$/.test(id)) {
    message = TEAM_ID_CHARS_MESSAGE;
  } else if (length > CONFIG.TEAM_ID_MAX) {
    message = 'IDは' + CONFIG.TEAM_ID_MAX + '文字までです（いま' + length + '文字）';
  } else if (forCreate && length < CONFIG.TEAM_ID_MIN && !(isAdmin && isReservedTeamId_(id))) {
    message = 'IDは' + CONFIG.TEAM_ID_MIN + '〜' + CONFIG.TEAM_ID_MAX + '文字にしてください（いま' + length + '文字）';
  }
  if (message) {
    errors.push({ field: 'team_number', message: message });
    return null;
  }
  return id;
}

/** IDに使えない文字が入っているときの文 */
const TEAM_ID_CHARS_MESSAGE = 'IDに使えるのは、半角の英字と数字だけです（記号・空白・ひらがななどは使えません）';
/** ほかのチーム・大会が使っているIDのときの文（取っておいたIDを一般の人が作ろうとしたときも、この文だけを出す） */
const TEAM_NUMBER_USED_MESSAGE = 'このIDは、すでに使われています。別のIDにしてください';
/** 管理者が、自動テスト用のIDを作ろうとしたときの文（管理者にだけ出す） */
const TEAM_ID_ADMIN_TEST_MESSAGE = CONFIG.TEST_TEAM_NUMBER_MIN + '〜' + CONFIG.TEST_TEAM_NUMBER_MAX + 'は自動テスト用のIDなので、管理者も使えません';

/**
 * IDの「使ってよいか」の決まり（シートは見ない。CLAUDE.md 第4.8章）
 * - 999999900〜999999999：自動テスト用。画面からは管理者を含めて誰も作れない
 * - 1〜1998（数字だけのID）：管理者が人の手でテストするためのID。管理者だけが作れる
 * - 自動テストのときは、自動テスト用のIDしか作れない（本物のチームに触れないため）
 * @return {string|null} 使えない理由。使ってよければ null
 */
function teamNumberRuleProblem_(teamNumber, isAdmin, forAutomatedTest) {
  if (isTestTeamNumber_(teamNumber)) {
    if (forAutomatedTest) return null;
    return isAdmin ? TEAM_ID_ADMIN_TEST_MESSAGE : TEAM_NUMBER_USED_MESSAGE;
  }
  if (forAutomatedTest) {
    return '自動テストでは、自動テスト用のID（' + CONFIG.TEST_TEAM_NUMBER_MIN + '〜）だけを使います';
  }
  if (isReservedTeamId_(teamNumber) && !isAdmin) {
    return TEAM_NUMBER_USED_MESSAGE;
  }
  return null;
}

/** 自動テスト用のID（999999900〜999999999。9けたの数字）か */
function isTestTeamNumber_(teamNumber) {
  const id = normalizeTeamId_(teamNumber);
  if (!/^[1-9][0-9]{8}$/.test(id)) return false;
  const n = Number(id);
  return n >= CONFIG.TEST_TEAM_NUMBER_MIN && n <= CONFIG.TEST_TEAM_NUMBER_MAX;
}

/** テスト用のID（1〜1998。先頭に0の付かない数字だけ）か。管理者だけが作れる */
function isReservedTeamId_(teamNumber) {
  const id = normalizeTeamId_(teamNumber);
  return /^[1-9][0-9]{0,3}$/.test(id) && Number(id) <= CONFIG.RESERVED_TEAM_NUMBER_MAX;
}

/** チーム名・大会名：1〜30文字 */
function checkTeamName_(value, errors, orgType) {
  const name = cleanName_(value);
  const problem = nameProblem_(name, orgLabel_(orgType) + '名', CONFIG.TEAM_NAME_MAX);
  if (problem) {
    errors.push({ field: 'team_name', message: problem });
    return null;
  }
  return name;
}

/**
 * 名前（チーム名・大会名・表示名）の決まり：1〜max文字、改行などの見えない文字は使えない。
 * 合わなければ、どの決まりに合わないかが分かる文を返す（合っていれば null）。
 * 文字数は、絵文字なども1文字として数える。
 */
function nameProblem_(name, label, max) {
  const length = Array.from(name).length;
  if (length === 0) return label + 'を入力してください';
  if (length > max) return label + 'は' + max + '文字までです（いま' + length + '文字）';
  if (/[\u0000-\u001f\u007f]/.test(name)) return label + 'に、改行などの使えない文字が入っています';
  return null;
}

/**
 * 名前（チーム名・大会名・表示名）から、目に見えない文字を取り除き、前後の空白を取る（2026-11-15）。
 * 取り除くのは、幅の無い文字（ゼロ幅スペースなど）・文字の向きを変える文字・見えないハイフンなど。
 * 見た目が同じで中身が違う名前（ほかの人とまぎらわしい名前）を作れないようにするため。
 */
const INVISIBLE_CHARS_RE = /[\u00AD\u034F\u061C\u115F\u1160\u17B4\u17B5\u180B-\u180E\u200B\u200C\u200E\u200F\u202A-\u202E\u2060-\u206F\u3164\uFEFF\uFFA0]/g; // 絵文字に使う U+200D（つなぎ）と U+FE0F（絵文字の形）は残す（絵文字がこわれないように）
function cleanName_(value) {
  return typeof value === 'string' ? value.replace(INVISIBLE_CHARS_RE, '').trim() : '';
}

/** IDでチーム・大会を探す（大文字・小文字、全角・半角は区別しない） */
function findTeamByNumber_(teamNumber) {
  const id = normalizeTeamId_(teamNumber);
  if (!id) return null;
  return findRecord_(CONFIG.SHEET.TEAMS, function (t) { return normalizeTeamId_(t.team_number) === id; });
}

/** 画面に返すチーム・大会の情報（合言葉のハッシュや塩は含めない） */
function toTeamSummary_(team, role) {
  return {
    teamId: team.team_id,
    teamNumber: String(team.team_number),
    // 個人用の記録は、シートに入っている名前ではなく、いまの名前（SOLO_NAME）で返す。
    // 2026-11-15 に「ひとりの記録」から名前を変えたので、前に作った行（シートには「ひとりの記録」）も新しい名前で出るように
    teamName: orgTypeOf_(team) === ORG_TYPE.SOLO ? SOLO_NAME : String(team.team_name),
    orgType: orgTypeOf_(team),
    role: role,
  };
}

/**
 * そのIDの組織が、成績を付けられる種類（チーム・個人用の記録）で、本人が所属しているか。
 * （B-19 から、個人用の記録も含む。個人用の記録は本人しかメンバーにならない）
 */
function isMemberOfTeamType_(userId, teamId) {
  if (!findMembership_(userId, teamId)) return false;
  const team = findRecord_(CONFIG.SHEET.TEAMS, function (t) { return t.team_id === teamId; });
  return Boolean(team) && isRecordableOrgType_(orgTypeOf_(team));
}

/**
 * 操作：startSolo（個人用の記録を始める。11.8章。B-19）
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
 * 個人用の記録場所を作る（本人が代表者のメンバー1行も足す）。
 * startSolo のほか、チームを消すときに、個人用の記録が無いメンバーの分を自動で作るのにも使う（B-21）。
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

/** 本人の個人用の記録場所（無ければ null） */
function findSoloOf_(userId) {
  return findRecord_(CONFIG.SHEET.TEAMS, function (t) {
    return orgTypeOf_(t) === ORG_TYPE.SOLO && t.created_by === userId;
  });
}
