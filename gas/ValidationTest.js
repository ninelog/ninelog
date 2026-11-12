/**
 * 入力チェック（Validation.js）のテスト
 *
 * 使い方：GASの編集画面で testValidation を選んで「実行」。結果は「実行ログ」に出る。
 * すべて「OK」なら合格。
 * 「今日」の日付は 2026-11-10 に決め打ちして試す（テストを実行する日によって結果が変わらないように）。
 * （2026-11-11 B-11：成績は試合に結びつけるので、入力は game_id。試合日の確かめ方は試合を作るときに使うので、
 *   試合日の5件は checkGameDate_ を直接確かめる形にした。件数は33件のまま）
 */
function testValidation() {
  const opt = { today: '2026-11-10' };

  // 正しい打撃の入力（4打席3打数2安打、二塁打1、四球1）
  const goodBatting = {
    game_id: 'game-a',
    plate_appearances: 4, at_bats: 3, hits: 2, doubles: 1, triples: 0, home_runs: 0, rbis: 1,
    walks: 1, hbp: 0, sacrifice_bunts: 0, sacrifice_flies: 0, strikeouts: 1, stolen_bases: 0,
  };
  // 正しい投手の入力（5回1/3、自責点2）
  const goodPitching = { game_id: 'game-a', innings: 5, partial_outs: 1, earned_runs: 2 };

  /** base の一部を change で書き換えた入力を作る */
  function withChange(base, change) {
    return Object.assign({}, base, change);
  }

  // expected：通るなら 'pass'、断られるなら引っかかる項目名（field）
  const cases = [
    // --- 打撃：正しい入力 ---
    { title: '打撃：正しい入力', fn: 'bat', data: goodBatting, expected: 'pass' },
    { title: '打撃：数字が文字（"3"）でも通る', fn: 'bat', data: withChange(goodBatting, { at_bats: '3' }), expected: 'pass' },
    { title: '打撃：全部0でも通る（出場のみ）', fn: 'bat', data: withChange(goodBatting, { plate_appearances: 0, at_bats: 0, hits: 0, doubles: 0, rbis: 0, walks: 0, strikeouts: 0 }), expected: 'pass' },
    { title: '試合日：今日は通る', fn: 'date', data: '2026-11-10', expected: 'pass' },
    // --- 打撃：1項目ずつのまちがい ---
    { title: '打撃：安打が空', fn: 'bat', data: withChange(goodBatting, { hits: '' }), expected: 'hits' },
    { title: '打撃：打点が無い', fn: 'bat', data: withChange(goodBatting, { rbis: undefined }), expected: 'rbis' },
    { title: '打撃：マイナス', fn: 'bat', data: withChange(goodBatting, { walks: -1 }), expected: 'walks' },
    { title: '打撃：小数', fn: 'bat', data: withChange(goodBatting, { rbis: 1.5 }), expected: 'rbis' },
    { title: '打撃：数字以外の文字', fn: 'bat', data: withChange(goodBatting, { stolen_bases: 'a' }), expected: 'stolen_bases' },
    { title: '打撃：上限を超える（100）', fn: 'bat', data: withChange(goodBatting, { rbis: 100 }), expected: 'rbis' },
    { title: '打撃：試合が選ばれていない', fn: 'bat', data: withChange(goodBatting, { game_id: '' }), expected: 'game_id' },
    // --- 試合日（試合を作るときの確かめ方） ---
    { title: '試合日：形がちがう（2026/4/1）', fn: 'date', data: '2026/4/1', expected: 'game_date' },
    { title: '試合日：存在しない日付（2月30日）', fn: 'date', data: '2026-02-30', expected: 'game_date' },
    { title: '試合日：未来の日付', fn: 'date', data: '2026-11-11', expected: 'game_date' },
    { title: '試合日：古すぎる日付', fn: 'date', data: '1999-12-31', expected: 'game_date' },
    // --- 打撃：項目どうしの関係（第4.5章） ---
    { title: '打撃：打数 ＞ 打席', fn: 'bat', data: withChange(goodBatting, { plate_appearances: 2, walks: 0 }), expected: 'at_bats' },
    { title: '打撃：安打 ＞ 打数', fn: 'bat', data: withChange(goodBatting, { hits: 4, plate_appearances: 5 }), expected: 'hits' },
    { title: '打撃：打席が足りない（打数＋四球＝4 ＞ 打席3）', fn: 'bat', data: withChange(goodBatting, { plate_appearances: 3 }), expected: 'plate_appearances' },
    { title: '打撃：二塁打＋三塁打＋本塁打 ＞ 安打', fn: 'bat', data: withChange(goodBatting, { doubles: 1, home_runs: 2 }), expected: 'hits' },
    { title: '打撃：三振 ＞ 打数', fn: 'bat', data: withChange(goodBatting, { strikeouts: 4 }), expected: 'strikeouts' },
    { title: '打撃：安打＋三振 ＝ 打数 は通る（3打数2安打1三振）', fn: 'bat', data: goodBatting, expected: 'pass' },
    { title: '打撃：安打＋三振 ＞ 打数（3打数2安打2三振）', fn: 'bat', data: withChange(goodBatting, { strikeouts: 2 }), expected: 'strikeouts' },
    { title: '打撃：安打＋三振 ＞ 打数（3打数3安打1三振）', fn: 'bat', data: withChange(goodBatting, { hits: 3, strikeouts: 1 }), expected: 'strikeouts' },

    // --- 投手 ---
    { title: '投手：正しい入力', fn: 'pit', data: goodPitching, expected: 'pass' },
    { title: '投手：アウトを1つも取れずに降板', fn: 'pit', data: withChange(goodPitching, { innings: 0, partial_outs: 0, earned_runs: 3 }), expected: 'pass' },
    { title: '投手：アウト数が3', fn: 'pit', data: withChange(goodPitching, { partial_outs: 3 }), expected: 'partial_outs' },
    { title: '投手：回が空', fn: 'pit', data: withChange(goodPitching, { innings: '' }), expected: 'innings' },
    { title: '投手：自責点がマイナス', fn: 'pit', data: withChange(goodPitching, { earned_runs: -1 }), expected: 'earned_runs' },
    { title: '投手：試合が選ばれていない', fn: 'pit', data: withChange(goodPitching, { game_id: undefined }), expected: 'game_id' },
  ];

  const results = [];
  cases.forEach(function (c) {
    let actual;
    try {
      if (c.fn === 'bat') validateBattingInput_(c.data);
      else if (c.fn === 'pit') validatePitchingInput_(c.data);
      else {
        const dateErrors = [];
        checkGameDate_(c.data, dateErrors, opt);
        throwIfErrors_(dateErrors);
      }
      actual = 'pass';
    } catch (err) {
      if (err.code === APP_ERROR.VALIDATION_ERROR) {
        actual = err.details.map(function (d) { return d.field; }).join(',');
      } else {
        actual = '想定外のエラー：' + err.message;
      }
    }
    results.push({ title: c.title, expected: c.expected, actual: actual });
  });

  // 保存する形にそろっているか（投手：5回1/3 → outs 16）
  const saved = validatePitchingInput_(goodPitching, opt);
  results.push({ title: '投手：5回1/3 は outs=16 で保存される', expected: 16, actual: saved.outs });
  const savedBatting = validateBattingInput_(withChange(goodBatting, { at_bats: '3' }), opt);
  results.push({ title: '打撃：文字の "3" は数字の 3 にそろう', expected: 'number', actual: typeof savedBatting.at_bats });
  const extra = validateBattingInput_(withChange(goodBatting, { user_id: 'Unusumi' }), opt);
  results.push({ title: '打撃：画面から送られた user_id は捨てられる', expected: 'undefined', actual: typeof extra.user_id });

  // 画面に返す形（details つき）
  const body = toErrorBody_(new AppError(APP_ERROR.VALIDATION_ERROR, 'x', [{ field: 'hits', message: 'y' }]));
  results.push({ title: '返事に項目ごとの説明（details）が付く', expected: 'hits', actual: body.details ? body.details[0].field : '（無い）' });

  logResults_(results); // 結果の出し方をほかのテストとそろえる（testAll でまとめられるように）
}
