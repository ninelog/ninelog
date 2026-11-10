/**
 * チームへの参加と、合言葉の変更（CLAUDE.md 第4.8章・第4.4c章）
 *
 * 参加：チーム番号と合言葉の両方が正しければ、memberships に1行足す。
 * 間違えた回数は人ごとに join_attempts シートに数え、10回で1時間止める。
 */

/**
 * 操作：joinTeam（チームに参加する）
 * data: { team_number: '2026', passphrase: '合言葉' }
 * 書き込む操作なので、順番待ちの中で呼ばれる（Main.js の write: true）。
 *
 * options（自動テストのときだけ。画面からは渡せない）：
 *   forAutomatedTest：true なら、自動テスト専用の番号のチームだけに参加できる
 *   now：「今」の日時を決め打ちする（1時間後などを試すため）
 */
function handleJoinTeam_(data, user, options) {
  const forAutomatedTest = Boolean(options && options.forAutomatedTest);
  const now = (options && options.now) || new Date();

  // ① 止められている間は、何も確かめずに断る
  const attempt = readJoinAttempt_(user.userId, now);
  if (attempt.lockedMinutesLeft > 0) {
    throw joinLockedError_(attempt.lockedMinutesLeft);
  }

  // ② 入力の形（形のまちがいは、打ち間違いなので回数に数えない）
  const errors = [];
  const teamNumber = checkTeamNumberFormat_(data.team_number, errors);
  if (typeof data.passphrase !== 'string' || data.passphrase.trim() === '') {
    errors.push({ field: 'passphrase', message: '合言葉を入力してください' });
  }
  throwIfErrors_(errors);

  // ③ チームを探して、合言葉を照合する
  //   画面からは自動テスト専用の番号のチームに参加できない（見つからないのと同じ扱い）。
  //   自動テストからは、自動テスト専用の番号のチームにしか参加できない。
  const allowed = forAutomatedTest ? isTestTeamNumber_(teamNumber) : !isTestTeamNumber_(teamNumber);
  const team = allowed ? findTeamByNumber_(teamNumber) : null;
  const correct = Boolean(team) && passphraseMatches_(data.passphrase, team.passphrase_salt, team.passphrase_hash);

  if (!correct) {
    // 存在しない番号も、合言葉の間違いも、同じく1回と数える（どちらが違うかは教えない）
    const failCount = recordJoinFailure_(attempt, user.userId, now);
    if (failCount >= CONFIG.JOIN_MAX_FAILS) {
      throw joinLockedError_(CONFIG.JOIN_LOCK_MINUTES);
    }
    const remaining = CONFIG.JOIN_MAX_FAILS - failCount;
    throw new AppError(APP_ERROR.JOIN_FAILED,
      'チーム番号か合言葉が違います。あと' + remaining + '回間違えると、' + CONFIG.JOIN_LOCK_MINUTES + '分間入力できなくなります',
      null, { remainingAttempts: remaining });
  }

  // ④ 正しかった：回数を0に戻す
  resetJoinAttempt_(attempt, now);

  // すでに参加していれば、行を増やさずにそのことを返す
  const membership = findMembership_(user.userId, team.team_id);
  if (membership) {
    return { alreadyMember: true, team: toTeamSummary_(team, membership.role) };
  }

  appendRecord_(CONFIG.SHEET.MEMBERSHIPS, {
    membership_id: Utilities.getUuid(),
    user_id: user.userId,
    team_id: team.team_id,
    role: 'member',
    joined_at: now,
  });
  return { alreadyMember: false, team: toTeamSummary_(team, 'member') };
}

/**
 * 操作：changePassphrase（合言葉を変える。代表者だけ）
 * data: { team_id: 'チームID', passphrase: '新しい合言葉' }
 * すでに参加しているメンバーは、そのまま残る。
 */
function handleChangePassphrase_(data, user) {
  const teamId = typeof data.team_id === 'string' ? data.team_id : '';
  const membership = teamId ? findMembership_(user.userId, teamId) : null;
  if (!membership || membership.role !== 'owner') {
    // チームが無い場合も同じ返事にする（ほかのチームの有無を探られないように）
    throw new AppError(APP_ERROR.FORBIDDEN, '合言葉を変えられるのは、そのチームの代表者だけです');
  }
  const passphrase = validatePassphrase_(data.passphrase);

  const team = findRecord_(CONFIG.SHEET.TEAMS, function (t) { return t.team_id === teamId; });
  const salt = newPassphraseSalt_();
  updateRecord_(CONFIG.SHEET.TEAMS, team._row, {
    passphrase_hash: hashPassphrase_(passphrase, salt),
    passphrase_salt: salt,
    updated_at: new Date(),
  });
  return { team: toTeamSummary_(team, 'owner') };
}

/* ---------- 間違えた回数（join_attempts シート） ---------- */

/**
 * その人の記録を読む。止めていた時間が過ぎていたら、回数を0として扱う。
 * @return {{record: Object|null, failCount: number, lockedMinutesLeft: number}}
 */
function readJoinAttempt_(userId, now) {
  const record = findRecord_(CONFIG.SHEET.JOIN_ATTEMPTS, function (r) { return r.user_id === userId; });
  if (!record) return { record: null, failCount: 0, lockedMinutesLeft: 0 };

  const lockedUntil = record.locked_until ? new Date(record.locked_until).getTime() : 0;
  if (lockedUntil > now.getTime()) {
    return {
      record: record,
      failCount: Number(record.fail_count) || 0,
      lockedMinutesLeft: Math.ceil((lockedUntil - now.getTime()) / 60000),
    };
  }
  if (lockedUntil) {
    // 止めていた時間が過ぎた：回数を0に戻したものとして扱う（シートは次の書き込みで直る）
    return { record: record, failCount: 0, lockedMinutesLeft: 0 };
  }
  return { record: record, failCount: Number(record.fail_count) || 0, lockedMinutesLeft: 0 };
}

/** 間違いを1回足して記録する。上限に届いたら止める時刻も書く。足したあとの回数を返す */
function recordJoinFailure_(attempt, userId, now) {
  const failCount = attempt.failCount + 1;
  const lockedUntil = failCount >= CONFIG.JOIN_MAX_FAILS
    ? new Date(now.getTime() + CONFIG.JOIN_LOCK_MINUTES * 60000)
    : '';
  if (attempt.record) {
    updateRecord_(CONFIG.SHEET.JOIN_ATTEMPTS, attempt.record._row, {
      fail_count: failCount, locked_until: lockedUntil, updated_at: now,
    });
  } else {
    appendRecord_(CONFIG.SHEET.JOIN_ATTEMPTS, {
      user_id: userId, fail_count: failCount, locked_until: lockedUntil, updated_at: now,
    });
  }
  return failCount;
}

/** 参加に成功したら、回数を0に戻す（記録が無ければ何もしない） */
function resetJoinAttempt_(attempt, now) {
  if (attempt.record && (Number(attempt.record.fail_count) !== 0 || attempt.record.locked_until)) {
    updateRecord_(CONFIG.SHEET.JOIN_ATTEMPTS, attempt.record._row, {
      fail_count: 0, locked_until: '', updated_at: now,
    });
  }
}

function joinLockedError_(minutesLeft) {
  return new AppError(APP_ERROR.JOIN_LOCKED,
    '合言葉を' + CONFIG.JOIN_MAX_FAILS + '回間違えたため、いまは入力できません。あと' + minutesLeft + '分で入力できるようになります',
    null, { minutesLeft: minutesLeft });
}

function findMembership_(userId, teamId) {
  return findRecord_(CONFIG.SHEET.MEMBERSHIPS, function (m) { return m.user_id === userId && m.team_id === teamId; });
}
