/**
 * 本人確認（Auth.js）のテスト
 *
 * 使い方：GASの編集画面で、上の関数の選択欄から testVerifyIdToken を選んで「実行」を押す。
 * 結果は画面下の「実行ログ」に出る。すべて「OK」なら合格。
 *
 * 本物の札（IDトークン）は、LINEの中で画面を開かないと手に入らないため、
 * ここでは「正しくない札がきちんと断られること」を確かめる。
 * 本物の札で通ることは C-2（LIFFの初期化）で確かめる。
 */
function testVerifyIdToken() {
  const cases = [
    { title: '札が空', token: '', expected: AUTH_ERROR.TOKEN_MISSING },
    { title: '札が送られていない', token: undefined, expected: AUTH_ERROR.TOKEN_MISSING },
    { title: 'でたらめな文字の札', token: 'this-is-not-a-token', expected: AUTH_ERROR.TOKEN_INVALID },
    { title: '札の形だけまねた偽物', token: 'aaaa.bbbb.cccc', expected: AUTH_ERROR.TOKEN_INVALID },
  ];

  let passed = 0;
  cases.forEach(function (c) {
    let actual;
    try {
      verifyIdToken_(c.token);
      actual = '（断られずに通ってしまった）';
    } catch (err) {
      actual = err.code || ('想定外のエラー：' + err.message);
    }
    const ok = actual === c.expected;
    if (ok) passed++;
    Logger.log((ok ? 'OK' : 'NG') + '｜' + c.title + '｜期待：' + c.expected + '｜結果：' + actual);
  });

  Logger.log('合計：' + passed + ' / ' + cases.length + ' 件 OK');
}
