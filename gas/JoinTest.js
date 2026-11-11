/**
 * B-6追加（チームへの参加・間違い回数の制限・合言葉の変更）のテスト
 *
 * 使い方：GASの編集画面で testJoin を選んで「実行」。結果は「実行ログ」に出る。
 * すべて「OK」なら合格。
 *
 * B-6のテストと同じく、仮の人（Utest…）と自動テスト専用の番号（999999900〜）だけを使い、
 * 最後に消す。本物のチームや予約番号（1〜1998）には触れない。
 * 合言葉の照合で何度もハッシュを計算するので、終わるまで1分ほどかかることがある。
 */
function testJoin() {
  const realTeamsBefore = countRealTeams_();
  cleanupTestData_();
  const results = [];
  try {
    runJoinTests_(results);
  } finally {
    cleanupTestData_();
  }
  results.push({ title: '本物のチームの行数が、テストの前後で変わらない', expected: realTeamsBefore, actual: countRealTeams_() });
  logResults_(results);
}

function runJoinTests_(results) {
  const owner = { userId: 'Utest_jowner', name: '代表テスト' };
  const member = { userId: 'Utest_jmember', name: '参加テスト' };
  const typo = { userId: 'Utest_jtypo', name: 'まちがいテスト' };
  const locked = { userId: 'Utest_jlocked', name: 'しめだしテスト' };
  const NUMBER = '999999911';
  createTestTeam_(owner, NUMBER, '参加テストナイン', 'ないんろぐ99');
  const team = findTeamByNumber_(NUMBER);

  // --- 参加できる ---
  const joined = joinTestTeam_(member, NUMBER, 'ナインログ99'); // カタカナで入力しても同じ合言葉
  results.push({ title: '正しい番号と合言葉で参加できる（カタカナでもよい）', expected: 'false/member', actual: joined.alreadyMember + '/' + (joined.team && joined.team.role) });
  results.push({ title: 'memberships に一般（member）として1行入る', expected: 'member', actual: (findMembership_(member.userId, team.team_id) || {}).role });
  const memberTeams = dispatch_({ action: 'listMyTeams', data: {} }, member).teams;
  results.push({ title: '参加したチームが一覧に出る', expected: NUMBER, actual: memberTeams.map(function (t) { return t.teamNumber; }).join(',') });
  results.push({ title: '返事にハッシュや塩が含まれない', expected: false, actual: /passphrase|salt|hash/i.test(JSON.stringify(joined)) });

  const again = joinTestTeam_(member, NUMBER, 'ないんろぐ99');
  results.push({ title: '2回目は「すでに参加しています」になり、行が増えない', expected: 'true/1', actual: again.alreadyMember + '/' + countMemberships_(member.userId, team.team_id) });
  const ownerAgain = joinTestTeam_(owner, NUMBER, 'ないんろぐ99');
  results.push({ title: '代表者が参加しても「すでに参加しています」（代表者のまま）', expected: 'true/owner', actual: ownerAgain.alreadyMember + '/' + ownerAgain.team.role });

  // --- 間違えたとき ---
  const wrong = joinTestTeam_(typo, NUMBER, 'ちがうあいことば');
  results.push({ title: '合言葉が違うと断られる', expected: 'JOIN_FAILED', actual: wrong.code });
  results.push({ title: '残りの回数が返る（あと9回）', expected: 9, actual: wrong.info && wrong.info.remainingAttempts });
  results.push({ title: '間違いが1回と記録される', expected: 1, actual: testFailCount_(typo.userId) });
  results.push({ title: '断られた返事に、どちらが違うかは書かない', expected: true, actual: wrong.message.indexOf('番号か合言葉が違います') === 0 });

  const noTeam = joinTestTeam_(typo, '999999998', 'ないんろぐ99');
  results.push({ title: '存在しない番号も1回と数える', expected: 'JOIN_FAILED/2', actual: noTeam.code + '/' + testFailCount_(typo.userId) });

  const badFormat = joinTestTeam_(typo, 'abc', 'ないんろぐ99');
  results.push({ title: '番号の形のまちがいは、入力チェックで断り、回数に数えない', expected: 'VALIDATION_ERROR/2', actual: badFormat.code + '/' + testFailCount_(typo.userId) });
  const empty = joinTestTeam_(typo, NUMBER, '');
  results.push({ title: '合言葉が空なら、入力チェックで断り、回数に数えない', expected: 'VALIDATION_ERROR/2', actual: empty.code + '/' + testFailCount_(typo.userId) });

  const recovered = joinTestTeam_(typo, NUMBER, 'ないんろぐ99');
  results.push({ title: '正しく入れたら参加でき、回数は0に戻る', expected: 'false/0', actual: recovered.alreadyMember + '/' + testFailCount_(typo.userId) });

  // --- 10回で1時間止める ---
  const start = new Date();
  const at = function (minutes) { return new Date(start.getTime() + minutes * 60000); };
  let last = null;
  for (let i = 1; i <= 9; i++) last = joinTestTeam_(locked, '999999998', 'ないんろぐ99', at(0));
  results.push({ title: '9回目まではまだ止まらない（あと1回）', expected: 'JOIN_FAILED/1', actual: last.code + '/' + (last.info && last.info.remainingAttempts) });
  const tenth = joinTestTeam_(locked, '999999998', 'ないんろぐ99', at(0));
  results.push({ title: '10回目で止まる（あと60分）', expected: 'JOIN_LOCKED/60', actual: tenth.code + '/' + (tenth.info && tenth.info.minutesLeft) });
  const whileLocked = joinTestTeam_(locked, NUMBER, 'ないんろぐ99', at(1));
  results.push({ title: '止まっている間は、正しい合言葉でも参加できない', expected: 'JOIN_LOCKED', actual: whileLocked.code });
  results.push({ title: '止まっている間に入れても、参加の行は増えない', expected: 0, actual: countMemberships_(locked.userId, team.team_id) });
  const halfway = joinTestTeam_(locked, NUMBER, 'ないんろぐ99', at(30));
  results.push({ title: '30分後は「あと30分」', expected: 'JOIN_LOCKED/30', actual: halfway.code + '/' + (halfway.info && halfway.info.minutesLeft) });
  const justBefore = joinTestTeam_(locked, NUMBER, 'ないんろぐ99', at(59.5));
  results.push({ title: '59分30秒後でも、まだ止まっている（あと1分）', expected: 'JOIN_LOCKED/1', actual: justBefore.code + '/' + (justBefore.info && justBefore.info.minutesLeft) });
  const afterLock = joinTestTeam_(locked, NUMBER, 'ないんろぐ99', at(61));
  results.push({ title: '1時間たったら参加でき、回数も0に戻る', expected: 'false/0', actual: afterLock.alreadyMember + '/' + testFailCount_(locked.userId) });

  // 1時間たったあとに間違えたら、1回目から数え直す
  const locked2 = { userId: 'Utest_jlocked2', name: 'しめだしテスト2' };
  for (let i = 1; i <= 10; i++) joinTestTeam_(locked2, '999999998', 'x123456', at(0));
  const recount = joinTestTeam_(locked2, '999999998', 'x123456', at(61));
  results.push({ title: '止まっていた1時間が過ぎてから間違えたら、1回目から数え直す（あと9回）', expected: 'JOIN_FAILED/9', actual: recount.code + '/' + (recount.info && recount.info.remainingAttempts) });

  // --- 画面からは、自動テスト専用の番号のチームに参加できない ---
  const viaScreen = errorSummary_(function () {
    dispatch_({ action: 'joinTeam', data: { team_number: NUMBER, passphrase: 'ないんろぐ99' } }, { userId: 'Utest_jscreen', name: '画面テスト' });
  });
  results.push({ title: '画面からは、自動テスト専用の番号のチームに参加できない', expected: 'JOIN_FAILED', actual: viaScreen });

  // --- 合言葉の変更 ---
  const changed = dispatch_({ action: 'changePassphrase', data: { team_id: team.team_id, passphrase: 'あたらしい2026' } }, owner);
  results.push({ title: '代表者は合言葉を変えられる', expected: NUMBER, actual: changed.team.teamNumber });
  const newcomerOld = joinTestTeam_({ userId: 'Utest_jnew', name: '新人' }, NUMBER, 'ないんろぐ99');
  results.push({ title: '変えたあとは、古い合言葉では参加できない', expected: 'JOIN_FAILED', actual: newcomerOld.code });
  const newcomerNew = joinTestTeam_({ userId: 'Utest_jnew', name: '新人' }, NUMBER, 'アタラシイ2026');
  results.push({ title: '変えたあとは、新しい合言葉で参加できる', expected: false, actual: newcomerNew.alreadyMember });
  results.push({ title: '合言葉を変えても、前からのメンバーはそのまま', expected: 'member', actual: (findMembership_(member.userId, team.team_id) || {}).role });

  results.push({
    title: '代表者でないメンバーは、合言葉を変えられない',
    expected: 'FORBIDDEN',
    actual: errorSummary_(function () { dispatch_({ action: 'changePassphrase', data: { team_id: team.team_id, passphrase: 'のっとり2026' } }, member); }),
  });
  results.push({
    title: '所属していないチームの合言葉は変えられない',
    expected: 'FORBIDDEN',
    actual: errorSummary_(function () { dispatch_({ action: 'changePassphrase', data: { team_id: team.team_id, passphrase: 'のっとり2026' } }, { userId: 'Utest_joutsider', name: '部外者' }); }),
  });
  results.push({
    title: '存在しないチームIDも同じ返事（FORBIDDEN）',
    expected: 'FORBIDDEN',
    actual: errorSummary_(function () { dispatch_({ action: 'changePassphrase', data: { team_id: 'no-such-team', passphrase: 'のっとり2026' } }, owner); }),
  });
  results.push({
    title: '新しい合言葉も決まり（6文字以上など）を守る',
    expected: 'passphrase',
    actual: errorSummary_(function () { dispatch_({ action: 'changePassphrase', data: { team_id: team.team_id, passphrase: '短い' } }, owner); }).split('：')[0],
  });
  const stillNew = joinTestTeam_({ userId: 'Utest_jnew2', name: '新人2' }, NUMBER, 'あたらしい2026');
  results.push({ title: '断られた変更では、合言葉は変わらない', expected: false, actual: stillNew.alreadyMember });
}

function countMemberships_(userId, teamId) {
  return readRecords_(CONFIG.SHEET.MEMBERSHIPS).filter(function (m) { return m.user_id === userId && m.team_id === teamId; }).length;
}
