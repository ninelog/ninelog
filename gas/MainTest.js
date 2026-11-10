/**
 * 共通の入口（Main.js）のテスト
 *
 * 使い方：GASの編集画面で testDoPost を選んで「実行」。結果は「実行ログ」に出る。
 * すべて「OK」なら合格。
 *
 * 前半：doPost に、いろいろな形の要求を送ったつもりで呼び出し、正しく断られるか確かめる。
 * 後半：本人確認が済んだ「つもり」の仮の本人で、振り分けと順番待ちを確かめる。
 *       （本物の札は C-2 まで手に入らないため）
 */
function testDoPost() {
  cleanupTestData_();
  try {
    runDoPostTests_();
  } finally {
    // whoami などで、仮の人（Utest…）が users シートに登録されるので、最後に消す
    cleanupTestData_();
  }
}

function runDoPostTests_() {
  const results = [];

  // --- 前半：doPost 全体 ---
  const postCases = [
    { title: '中身なし', e: {}, expected: APP_ERROR.BAD_REQUEST },
    { title: 'JSONではない', e: fakePost_('abc'), expected: APP_ERROR.BAD_REQUEST },
    { title: '配列が送られた', e: fakePost_('[1,2]'), expected: APP_ERROR.BAD_REQUEST },
    { title: 'action が無い', e: fakePost_('{"idToken":"x"}'), expected: APP_ERROR.BAD_REQUEST },
    { title: 'data が配列', e: fakePost_('{"action":"whoami","data":[]}'), expected: APP_ERROR.BAD_REQUEST },
    { title: '札が無い', e: fakePost_('{"action":"whoami"}'), expected: AUTH_ERROR.TOKEN_MISSING },
    { title: '偽物の札', e: fakePost_('{"action":"whoami","idToken":"aaaa.bbbb.cccc"}'), expected: AUTH_ERROR.TOKEN_INVALID },
    { title: '偽物の札＋知らない操作（本人確認が先）', e: fakePost_('{"action":"nope","idToken":"aaaa.bbbb.cccc"}'), expected: AUTH_ERROR.TOKEN_INVALID },
  ];
  postCases.forEach(function (c) {
    const res = JSON.parse(doPost(c.e).getContent());
    const actual = res.ok ? '（断られずに通ってしまった）' : res.error.code;
    results.push({ title: c.title, expected: c.expected, actual: actual });
  });

  // --- 後半：振り分けと順番待ち（仮の本人） ---
  const fakeUser = { userId: 'Utest0000', name: 'テスト太郎' };

  const who = dispatch_({ action: 'whoami', data: {} }, fakeUser);
  results.push({
    title: 'whoami が本人を返す',
    expected: 'Utest0000',
    actual: who.userId,
  });

  ['nope', 'toString', '__proto__'].forEach(function (name) {
    let actual;
    try {
      dispatch_({ action: name, data: {} }, fakeUser);
      actual = '（断られずに通ってしまった）';
    } catch (err) {
      actual = err.code || ('想定外のエラー：' + err.message);
    }
    results.push({ title: '知らない操作「' + name + '」', expected: APP_ERROR.UNKNOWN_ACTION, actual: actual });
  });

  // 順番待ちが、終わったあとにきちんと解除されるか（2回続けて取れれば解除されている）
  const first = withLock_(function () { return 'ok1'; });
  const second = withLock_(function () { return 'ok2'; });
  results.push({ title: '順番待ちが解除される', expected: 'ok1,ok2', actual: first + ',' + second });

  // --- 結果 ---
  let passed = 0;
  results.forEach(function (r) {
    const ok = r.actual === r.expected;
    if (ok) passed++;
    Logger.log((ok ? 'OK' : 'NG') + '｜' + r.title + '｜期待：' + r.expected + '｜結果：' + r.actual);
  });
  Logger.log('合計：' + passed + ' / ' + results.length + ' 件 OK');
}

/** テスト用：画面から本文 text が届いたつもりの e を作る */
function fakePost_(text) {
  return { postData: { contents: text, type: 'text/plain' } };
}
