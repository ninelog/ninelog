/**
 * B-6（ユーザーの自動登録・表示名・合言葉・チームの作成・自分のチーム一覧）のテスト
 *
 * 使い方：GASの編集画面で testTeams を選んで「実行」。結果は「実行ログ」に出る。
 * すべて「OK」なら合格。
 *
 * 本物のシートに、仮の人（user_id が「Utest」で始まる）の行を書き込んで確かめ、
 * 最後に消す。途中で止まっても、次に実行したときの最初に消す。
 * チームを作るのは、自動テスト専用の番号（999999900〜999999999）だけ。
 * 1〜1998 の予約番号や、1999 などの本物のチームには、書き込みも削除もしない
 * （予約番号の決まりは、シートを使わない teamNumberRuleProblem_ で確かめる）。
 */
function testTeams() {
  const realTeamsBefore = countRealTeams_();
  cleanupTestData_();
  const results = [];
  try {
    testPassphraseRules_(results);
    testUserRegistration_(results);
    testTeamCreation_(results);
  } finally {
    cleanupTestData_();
  }
  results.push({ title: '本物のチームの行数が、テストの前後で変わらない', expected: realTeamsBefore, actual: countRealTeams_() });
  logResults_(results);
}

/* ---------- 合言葉 ---------- */
function testPassphraseRules_(results) {
  const same = [
    ['ナイン9ABC', 'ないん9abc'],
    ['ﾅｲﾝ９ａｂｃ', 'ないん9abc'],
    ['ないん9abc', 'ないん9abc'],
    ['ｶﾞｯﾂ123', 'がっつ123'],
    ['ヴぁいおりん', 'ゔぁいおりん'],
  ];
  same.forEach(function (p) {
    results.push({ title: '合言葉のそろえ方「' + p[0] + '」', expected: p[1], actual: normalizePassphrase_(p[0]) });
  });

  const rules = [
    ['abcdef', 'pass', '6文字はOK'],
    ['abc12', 'passphrase', '5文字は短すぎる'],
    ['a'.repeat(32), 'pass', '32文字はOK'],
    ['a'.repeat(33), 'passphrase', '33文字は長すぎる'],
    ['草野球ナイン', 'passphrase', '漢字は使えない'],
    ['ないん 9999', 'passphrase', '空白は使えない'],
    ['nine!!99', 'passphrase', '記号は使えない'],
    ['らーめん123', 'pass', '長音「ー」は使える'],
    ['', 'passphrase', '空は入力してください'],
  ];
  rules.forEach(function (r) {
    const actual = errorSummary_(function () { validatePassphrase_(r[0]); });
    results.push({ title: '合言葉の決まり：' + r[2], expected: r[1], actual: actual === 'pass' ? 'pass' : actual.split('：')[0] });
  });

  withLock_(function () {
    const salt = newPassphraseSalt_();
    const h1 = hashPassphrase_(normalizePassphrase_('ナイン9ABC'), salt);
    const h2 = hashPassphrase_(normalizePassphrase_('ﾅｲﾝ９ａｂｃ'), salt);
    const h3 = hashPassphrase_(normalizePassphrase_('ナイン9ABC'), newPassphraseSalt_());
    results.push({ title: 'ハッシュ：書き方が違っても同じ合言葉なら一致', expected: true, actual: h1 === h2 });
    results.push({ title: 'ハッシュ：塩が違えば別の値になる', expected: true, actual: h1 !== h3 });
    results.push({ title: 'ハッシュ：64文字の英数字', expected: true, actual: /^[0-9a-f]{64}$/.test(h1) });
    results.push({ title: 'ハッシュ：照合で一致', expected: true, actual: passphraseMatches_('ないん9abc', salt, h1) });
    results.push({ title: 'ハッシュ：違う合言葉は一致しない', expected: false, actual: passphraseMatches_('ないん9abd', salt, h1) });
  });
}

/* ---------- ユーザーの自動登録と表示名 ---------- */
function testUserRegistration_(results) {
  const who = dispatch_({ action: 'whoami', data: {} }, { userId: 'Utest_user', name: 'テスト太郎' });
  results.push({ title: '初めての人は自動で登録される', expected: 'テスト太郎/line', actual: who.displayName + '/' + who.nameSource });
  results.push({ title: '登録すると users に1行入る', expected: 1, actual: countRows_(CONFIG.SHEET.USERS, 'Utest_user') });

  const again = dispatch_({ action: 'whoami', data: {} }, { userId: 'Utest_user', name: 'テスト太郎' });
  results.push({ title: '2回目は行が増えない', expected: '1/テスト太郎', actual: countRows_(CONFIG.SHEET.USERS, 'Utest_user') + '/' + again.displayName });

  const renamed = dispatch_({ action: 'whoami', data: {} }, { userId: 'Utest_user', name: 'テスト次郎' });
  results.push({ title: 'LINEの名前が変わったら表示名も変わる', expected: 'テスト次郎', actual: renamed.displayName });

  const custom = dispatch_({ action: 'updateMyName', data: { display_name: '  背番号18  ' } }, { userId: 'Utest_user', name: 'テスト次郎' });
  results.push({ title: '表示名を自分で変えられる（前後の空白は除く）', expected: '背番号18/custom', actual: custom.displayName + '/' + custom.nameSource });

  const afterLine = dispatch_({ action: 'whoami', data: {} }, { userId: 'Utest_user', name: 'テスト三郎' });
  results.push({ title: '自分で変えたあとは、LINEの名前で上書きされない', expected: '背番号18', actual: afterLine.displayName });

  [
    ['', '空の表示名'],
    ['あ'.repeat(21), '21文字の表示名'],
  ].forEach(function (c) {
    const actual = errorSummary_(function () {
      dispatch_({ action: 'updateMyName', data: { display_name: c[0] } }, { userId: 'Utest_user', name: 'x' });
    });
    results.push({ title: '表示名の決まり：' + c[1] + 'は断られる', expected: 'display_name', actual: actual.split('：')[0] });
  });
  const ok20 = errorSummary_(function () {
    dispatch_({ action: 'updateMyName', data: { display_name: 'あ'.repeat(20) } }, { userId: 'Utest_user', name: 'x' });
  });
  results.push({ title: '表示名の決まり：20文字は通る', expected: 'pass', actual: ok20 });

  // 目に見えない文字は取り除いて保存する（2026-11-15）
  const Z = String.fromCharCode(0x200B);
  const cleaned = dispatch_({ action: 'updateMyName', data: { display_name: 'た' + Z + 'ろう' } }, { userId: 'Utest_user', name: 'x' });
  results.push({ title: '表示名の目に見えない文字は取り除いて保存する', expected: 'たろう', actual: cleaned.displayName });
  const lineZ = dispatch_({ action: 'whoami', data: {} }, { userId: 'Utest_userz', name: 'じ' + Z + 'ろう' });
  results.push({ title: 'LINEの名前から登録するときも、目に見えない文字を取り除く', expected: 'じろう', actual: lineZ.displayName });

  // 同じチームに、同じ表示名の人がいるときに知らせる（2026-11-15。断らずに知らせるだけ）
  const p1 = { userId: 'Utest_same1', name: 'やまだ' };
  const p2 = { userId: 'Utest_same2', name: 'すずき' };
  createTestTeam_(p1, '999999903', '重なりテスト', 'ないんろぐ99');
  joinTestTeam_(p2, '999999903', 'ないんろぐ99');
  callAsTest_(handleStartSolo_, {}, p1, {});
  const before = dispatch_({ action: 'whoami', data: {} }, p1);
  results.push({ title: '表示名が違えば、知らせない', expected: '', actual: before.sameNameTeams.join(',') });
  const first = dispatch_({ action: 'updateMyName', data: { display_name: 'ＹＡＭＡＤＡ' } }, p2);
  results.push({ title: '表示名を変えても、まだ重なっていなければ知らせない', expected: 'ＹＡＭＡＤＡ/', actual: first.displayName + '/' + first.sameNameTeams.join(',') });
  const clash = dispatch_({ action: 'updateMyName', data: { display_name: 'yamada' } }, p1);
  results.push({ title: '同じ表示名（全角・大文字の違いはそろえて比べる）にすると、断らずに、そのチームの名前を返す', expected: 'yamada/重なりテスト', actual: clash.displayName + '/' + clash.sameNameTeams.join(',') });
  const after = dispatch_({ action: 'whoami', data: {} }, p1);
  results.push({ title: 'あとから同じ名前にした人にも、開いたときに知らせる（個人用の記録は見ない）', expected: '重なりテスト', actual: after.sameNameTeams.join(',') });
  results.push({ title: '知らせる中身に、ほかの人のIDや名前は入らない', expected: false, actual: JSON.stringify(after.sameNameTeams).indexOf('Utest_same2') !== -1 });
}

/* ---------- チームの作成と一覧 ---------- */
function testTeamCreation_(results) {
  const owner = { userId: 'Utest_owner', name: '代表テスト' };
  const other = { userId: 'Utest_other', name: '別のテスト' };
  // 画面からの要求と同じ流れ（dispatch_）で作ろうとする。
  // ここで使うのは「必ず断られる番号」だけ（自動テスト専用の番号か、形がまちがった番号）
  const viaScreen = function (user, number, name, passphrase) {
    return dispatch_({ action: 'createTeam', data: { team_number: number, team_name: name, passphrase: passphrase } }, user);
  };

  // 正しく作れる（自動テスト専用の番号で）
  const created = createTestTeam_(owner, '999999901', 'テストナイン', 'ないんろぐ99');
  results.push({ title: 'チームを作れる（代表者になる）', expected: '999999901/テストナイン/owner', actual: created.team.teamNumber + '/' + created.team.teamName + '/' + created.team.role });
  const teamRow = findTeamByNumber_('999999901');
  results.push({ title: 'teams に1行入る', expected: true, actual: Boolean(teamRow) });
  results.push({ title: '合言葉はそのまま保存されない', expected: false, actual: JSON.stringify(teamRow).indexOf('ないんろぐ99') !== -1 });
  results.push({ title: '合言葉はハッシュで保存される', expected: true, actual: passphraseMatches_('ナインログ99', teamRow.passphrase_salt, teamRow.passphrase_hash) });
  results.push({ title: '画面への返事にハッシュや塩が含まれない', expected: false, actual: /passphrase|salt|hash/i.test(JSON.stringify(created)) });
  const ownerMembership = findRecord_(CONFIG.SHEET.MEMBERSHIPS, function (m) { return m.user_id === owner.userId && m.team_id === teamRow.team_id; });
  results.push({ title: 'memberships に代表者として1行入る', expected: 'owner', actual: ownerMembership ? ownerMembership.role : '（無い）' });

  // 使われているID
  results.push({
    title: 'ID：使われているIDは作れない',
    expected: 'team_number：' + TEAM_NUMBER_USED_MESSAGE,
    actual: errorSummary_(function () { createTestTeam_(other, '999999901', '別チーム', 'abcdef'); }),
  });

  // 画面からは、自動テスト用のIDを作れない。一般の人には「すでに使われています」とだけ出す（2026-11-15）
  results.push({
    title: 'ID：画面からは自動テスト用のID（999999950）を作れず、「すでに使われています」とだけ出す',
    expected: 'team_number：' + TEAM_NUMBER_USED_MESSAGE,
    actual: errorSummary_(function () { viaScreen(other, '999999950', '別チーム', 'abcdef'); }),
  });

  // IDの形（画面から。形がまちがっているので、必ず断られる。作られることはない）
  [
    ['ab', '3文字より短い'],
    ['a'.repeat(21), '21文字'],
    ['abc-1', '記号入り'],
    ['チーム12', '英数字以外'],
    ['', '空'],
  ].forEach(function (c) {
    const actual = errorSummary_(function () { viaScreen(other, c[0], '別チーム', 'abcdef'); });
    results.push({ title: 'IDの形：' + c[1] + 'は断られる', expected: 'team_number', actual: actual.split('：')[0] });
  });
  const idOf = function (v, opts) { return checkTeamNumberFormat_(v, [], opts); };
  results.push({ title: 'IDのそろえ方：全角・大文字は半角の小文字にそろう', expected: 'team2026/nostradamus/2026',
    actual: [idOf('ＴＥＡＭ２０２６', { forCreate: true }), idOf(' NostraDamus ', { forCreate: true }), idOf('２０２６', { forCreate: true })].join('/') });
  results.push({ title: 'IDの形：作るときは4〜20文字（4文字・20文字はよい）', expected: 'abcd/' + 'a'.repeat(20),
    actual: idOf('abcd', { forCreate: true }) + '/' + idOf('a'.repeat(20), { forCreate: true }) });
  results.push({ title: 'IDの形：参加するときは、前の短い番号（5・201）もそのまま使える', expected: '5/201', actual: idOf('5') + '/' + idOf('201') });
  results.push({ title: 'IDの形：管理者は、テスト用のID（5）を短くても作れる。一般の人は作れない（短い）', expected: '5/null',
    actual: idOf('5', { forCreate: true, isAdmin: true }) + '/' + idOf('5', { forCreate: true, isAdmin: false }) });

  // エラーの文：どの決まりに合わないかが分かる（2026-11-15）
  const idMessage = function (v, opts) { const e = []; checkTeamNumberFormat_(v, e, opts); return e.length ? e[0].message : 'OK'; };
  results.push({ title: 'エラーの文：IDが空なら「IDを入力してください」', expected: 'IDを入力してください', actual: idMessage('') });
  results.push({ title: 'エラーの文：IDに記号・ひらがななら、使える文字を出す', expected: TEAM_ID_CHARS_MESSAGE + '/' + TEAM_ID_CHARS_MESSAGE,
    actual: idMessage('team_01', { forCreate: true }) + '/' + idMessage('ちーむ', { forCreate: true }) });
  results.push({ title: 'エラーの文：IDが短い・長いと、いまの文字数も出す', expected: 'IDは4〜20文字にしてください（いま3文字）/IDは20文字までです（いま21文字）',
    actual: idMessage('abc', { forCreate: true }) + '/' + idMessage('a'.repeat(21), { forCreate: true }) });
  results.push({ title: 'エラーの文：名前が空・長すぎる・改行入り', expected: 'チーム名を入力してください/表示名は20文字までです（いま21文字）/大会名に、改行などの使えない文字が入っています/OK',
    actual: [nameProblem_('', 'チーム名', 30), nameProblem_('あ'.repeat(21), '表示名', 20), nameProblem_('A\nB', '大会名', 30), nameProblem_('😀'.repeat(20), '表示名', 20) || 'OK'].join('/') });
  const passMessage = function (v) { try { validatePassphrase_(v); return 'OK'; } catch (e) { return e.details[0].message; } };
  results.push({ title: 'エラーの文：合言葉が短い・長いと、いまの文字数も出す', expected: '合言葉は6〜32文字にしてください（いま5文字）/合言葉は6〜32文字にしてください（いま33文字）',
    actual: [passMessage('abcde'), passMessage('a'.repeat(33))].join('/') });
  results.push({ title: 'エラーの文：合言葉に漢字・記号・空白があると、使える文字を出す', expected: '合言葉に使えるのは、ひらがな・カタカナ・英字・数字です（漢字・記号・空白は使えません）',
    actual: passMessage('野球ないん99') });

  // 目に見えない文字を取り除く（2026-11-15）
  const Z = String.fromCharCode(0x200B); // ゼロ幅スペース
  const RLO = String.fromCharCode(0x202E); // 文字の向きを変える文字
  const ZWJ = String.fromCharCode(0x200D); // 絵文字のつなぎ（残す）
  results.push({ title: '名前から、ゼロ幅スペースと文字の向きを変える文字を取り除く', expected: 'たろう', actual: cleanName_(' た' + Z + 'ろ' + RLO + 'う ') });
  results.push({ title: '絵文字のつなぎ（U+200D）は残す（絵文字がこわれないように）', expected: true, actual: cleanName_('🏃' + ZWJ + '♂') === '🏃' + ZWJ + '♂' });
  results.push({ title: '見えない文字だけの名前は、空として断る', expected: 'チーム名を入力してください', actual: nameProblem_(cleanName_(Z + Z), 'チーム名', 30) });

  // IDの決まり（シートを使わずに確かめる。テスト用や本物のIDには書き込まない）
  [
    ['5', false, false, TEAM_NUMBER_USED_MESSAGE, 'テスト用のID（5）は、一般の人には「すでに使われています」とだけ出す'],
    ['1998', false, false, TEAM_NUMBER_USED_MESSAGE, 'テスト用のIDの上限（1998）も、一般の人には同じ文'],
    ['1990', true, false, 'null', '管理者はテスト用のID（1990）を作れる'],
    ['1999', false, false, 'null', '1999 は誰でも作れる'],
    ['0123', false, false, 'null', '先頭が0の「0123」は、テスト用のID（123）とは別のIDとして誰でも作れる'],
    ['team2026', false, false, 'null', '英字と数字のID（team2026）は誰でも作れる'],
    ['999999899', false, false, 'null', '999999899 は誰でも作れる（自動テスト用の手前）'],
    ['999999900', true, false, TEAM_ID_ADMIN_TEST_MESSAGE, '管理者でも、自動テスト用のID（999999900）は作れない（管理者には理由を出す）'],
    ['999999999', false, false, TEAM_NUMBER_USED_MESSAGE, '自動テスト用のIDの上限（999999999）は、一般の人には「すでに使われています」とだけ出す'],
    ['999999900', false, true, 'null', '自動テストは、自動テスト用のIDを作れる'],
    ['1999', false, true, '自動テストでは', '自動テストは、本物のID（1999）を作れない'],
    ['5', true, true, '自動テストでは', '自動テストは、テスト用のID（5）を作れない'],
  ].forEach(function (c) {
    const problem = teamNumberRuleProblem_(c[0], c[1], c[2]);
    const actual = problem === null ? 'null' : (problem.indexOf('自動テストでは') === 0 ? '自動テストでは' : problem);
    results.push({ title: 'IDの決まり：' + c[4], expected: c[3], actual: actual });
  });
  results.push({ title: '一般の人に出す文には、「テスト」「予約」という言葉が入らない', expected: false, actual: /テスト|予約/.test(TEAM_NUMBER_USED_MESSAGE) });
  results.push({ title: 'テスト用・自動テスト用のIDの見分け方（数字だけのときだけ）', expected: 'true/false/false/true/false',
    actual: [isReservedTeamId_('1998'), isReservedTeamId_('0123'), isReservedTeamId_('1999'), isTestTeamNumber_('999999900'), isTestTeamNumber_('0999999900')].join('/') });
  results.push({ title: 'IDで探すとき、大文字・全角でも同じチームが見つかる', expected: true, actual: Boolean(findTeamByNumber_('９９９９９９９０１')) });
  results.push({
    title: '自動テスト用の作り方は、本物の番号（1999）を受け付けない',
    expected: true,
    actual: errorSummary_(function () { createTestTeam_(other, '1999', '本物', 'abcdef'); }).indexOf('自動テストでは') !== -1,
  });

  // チーム名とまとめてのチェック
  results.push({ title: 'チーム名：空は断られる', expected: 'team_name', actual: errorSummary_(function () { createTestTeam_(other, '999999902', '', 'abcdef'); }).split('：')[0] });
  results.push({ title: 'チーム名：31文字は断られる', expected: 'team_name', actual: errorSummary_(function () { createTestTeam_(other, '999999902', 'あ'.repeat(31), 'abcdef'); }).split('：')[0] });
  const many = errorSummary_(function () { viaScreen(other, '0', '', '漢字'); });
  results.push({ title: 'まちがいが3つあれば、3つまとめて返す', expected: 3, actual: many.split(' / ').length });

  // 自分のチーム一覧
  createTestTeam_(other, '999999902', '別のテストナイン', 'abcdef');
  const ownerTeams = dispatch_({ action: 'listMyTeams', data: {} }, owner).teams;
  results.push({ title: '一覧：代表者には作ったチームが出る', expected: '999999901', actual: ownerTeams.map(function (t) { return t.teamNumber; }).join(',') });
  const otherTeams = dispatch_({ action: 'listMyTeams', data: {} }, other).teams;
  results.push({ title: '一覧：別の人には、その人が作ったチームだけ出る', expected: '999999902', actual: otherTeams.map(function (t) { return t.teamNumber; }).join(',') });
  results.push({ title: '一覧：ハッシュや塩が含まれない', expected: false, actual: /passphrase|salt|hash/i.test(JSON.stringify(ownerTeams)) });
}

/** 自動テスト専用の番号ではない（＝本物の）チームの行数 */
function countRealTeams_() {
  return readRecords_(CONFIG.SHEET.TEAMS).filter(function (t) { return !isTestTeamRow_(t); }).length;
}

function countRows_(name, userId) {
  return readRecords_(name).filter(function (r) { return r.user_id === userId; }).length;
}
