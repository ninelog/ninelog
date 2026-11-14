/**
 * B-23（公式LINEのトークへの返信）のテスト
 *
 * 使い方：GASの編集画面で testWebhook を選んで「実行」。
 * 本物のLINEには送らない（返信を送る部品を、テストの間だけ「送ったことを覚えるだけ」に置き換える）。
 * スクリプトプロパティの秘密の目印は、テストの間だけ仮の値にして、最後に元に戻す。
 * 返信の中身を確かめるために、仮の人（Utest…）と自動テスト専用の番号のチームを作り、最初と最後に消す。
 */
function testWebhook() {
  const realBefore = countRealRows_();
  cleanupTestData_();
  const results = [];
  const props = PropertiesService.getScriptProperties();
  const savedKey = props.getProperty('LINE_WEBHOOK_KEY');
  const realSend = sendLineReply_;
  const sent = [];
  sendLineReply_ = function (token, messages) { sent.push({ token: token, messages: messages }); return true; };
  try {
    props.setProperty('LINE_WEBHOOK_KEY', 'Utest-hook-key');
    testWebhookGateScenario_(results, sent);
    testWebhookReplyScenario_(results, sent);
  } finally {
    sendLineReply_ = realSend;
    if (savedKey === null) props.deleteProperty('LINE_WEBHOOK_KEY');
    else props.setProperty('LINE_WEBHOOK_KEY', savedKey);
    cleanupTestData_();
  }
  results.push({ title: 'テストのあと、秘密の目印は元に戻っている', expected: String(savedKey), actual: String(props.getProperty('LINE_WEBHOOK_KEY')) });
  results.push({ title: '本物の行（チーム・試合・打撃・投手・変更の記録）の数が、テストの前後で変わらない', expected: realBefore, actual: countRealRows_() });
  logResults_(results);
}

/** Webhook の要求を作る（key が null なら ?hook= を付けない） */
function webhookTestRequest_(key, events) {
  return { parameter: key === null ? {} : { hook: key }, postData: { contents: JSON.stringify({ destination: 'x', events: events }) } };
}

/** 1対1のトークの文字のメッセージ */
function webhookTestMessage_(text, userId, sourceType) {
  return { type: 'message', replyToken: 'Utest-reply-' + text, source: { type: sourceType || 'user', userId: userId || 'Utest_wh' }, message: { type: 'text', text: text } };
}

/** 入口：目印・トークの種類・壊れた中身 */
function testWebhookGateScenario_(results, sent) {
  const req = webhookTestRequest_;
  const msg = webhookTestMessage_;
  results.push({ title: '?hook= が無い要求は、画面からの要求として扱う（Webhookではない）', expected: false, actual: isWebhookRequest_(req(null, [])) });
  results.push({ title: '?hook= が付いた要求は、Webhookとして扱う', expected: true, actual: isWebhookRequest_(req('x', [])) });

  sent.length = 0;
  const out = doPost(req('Utest-hook-key', [msg('こんにちは')]));
  results.push({ title: '目印が合えば、1対1のトークのメッセージに返信する', expected: '1/Utest-reply-こんにちは', actual: sent.length + '/' + (sent[0] && sent[0].token) });
  results.push({ title: '返事は「ok」だけ（中身を相手に知らせない）', expected: 'ok', actual: out.getContent() });
  results.push({ title: 'それ以外の言葉には、使い方の案内（文字）を返す', expected: 'text/true', actual: sent[0].messages[0].type + '/' + (sent[0].messages[0].text.indexOf('「成績」と送ると') === 0) });

  sent.length = 0;
  doPost(req('wrong-key', [msg('成績')]));
  results.push({ title: '目印が違えば、何も返信しない', expected: 0, actual: sent.length });
  sent.length = 0;
  doPost(req('', [msg('成績')]));
  results.push({ title: '目印が空でも、何も返信しない', expected: 0, actual: sent.length });
  sent.length = 0;
  doPost(req('Utest-hook-key', [msg('成績', 'Utest_wh', 'group'), msg('成績', 'Utest_wh', 'room')]));
  results.push({ title: 'グループ・複数人トークには返信しない', expected: 0, actual: sent.length });
  sent.length = 0;
  doPost(req('Utest-hook-key', [{ type: 'follow', replyToken: 'Utest-reply-follow', source: { type: 'user', userId: 'Utest_wh' } }]));
  results.push({ title: '友だち追加などの出来事には返信しない', expected: 0, actual: sent.length });
  sent.length = 0;
  const broken = doPost({ parameter: { hook: 'Utest-hook-key' }, postData: { contents: 'JSONではない' } });
  results.push({ title: '中身が壊れていても、エラーにせず「ok」', expected: 'ok/0', actual: broken.getContent() + '/' + sent.length });
  results.push({ title: '目印の比べ方：同じ・違う・長さ違い', expected: 'true/false/false', actual: [sameText_('abc', 'abc'), sameText_('abc', 'abd'), sameText_('abc', 'abcd')].join('/') });

  // 何を頼まれたか
  const cmd = function (ev) { return talkCommandOf_(ev); };
  results.push({ title: '言葉の見分け：成績・自分の成績・ランキング・らんきんぐ・ほか', expected: 'stats/stats/ranking/ranking/help',
    actual: [cmd(msg('成績')), cmd(msg(' 自分の成績 ')), cmd(msg('ランキング')), cmd(msg('らんきんぐ')), cmd(msg('てすと'))].join('/') });
  const pb = function (data) { return { type: 'postback', postback: { data: data } }; };
  results.push({ title: 'ボタンの合図（ポストバック）も見分ける', expected: 'stats/ranking/help', actual: [cmd(pb('action=stats')), cmd(pb('x=1&action=ranking')), cmd(pb('action=delete'))].join('/') });
  results.push({ title: 'スタンプなど文字でないメッセージは、案内', expected: 'help', actual: cmd({ type: 'message', message: { type: 'sticker' } }) });
}

/** 返信の中身：成績が無い・ある、チームに入っていない、規定に届いた人がいない・いる */
function testWebhookReplyScenario_(results, sent) {
  const a = { userId: 'Utest_wha', name: 'あおやま' };
  const b = { userId: 'Utest_whb', name: 'いのうえ' };
  const T = todayText_();
  const reply = function (text, user) {
    sent.length = 0;
    doPost(webhookTestRequest_('Utest-hook-key', [webhookTestMessage_(text, user.userId)]));
    return sent.length ? sent[0].messages[0] : null;
  };
  const textOf = function (m) { return JSON.stringify(m); };

  // 成績もチームも無い人
  let m = reply('成績', a);
  results.push({ title: '成績が無いとき：「まだ成績が登録されていません」と「成績を入力」ボタン', expected: 'flex/true/true',
    actual: m.type + '/' + (textOf(m).indexOf('まだ成績が登録されていません') !== -1) + '/' + (textOf(m).indexOf(CONFIG.LIFF_URL + '/input.html') !== -1) });
  m = reply('ランキング', a);
  results.push({ title: 'チームに入っていないとき：「チームに参加すると見られます」と「チーム・設定」ボタン', expected: 'true/true',
    actual: (textOf(m).indexOf('ランキングは、チームに参加すると見られます') !== -1) + '/' + (textOf(m).indexOf(CONFIG.LIFF_URL + '/team.html') !== -1) });

  // チームを作って、試合と成績を入れる（a：3打数2安打、b：1打数1安打）
  createTestTeam_(a, '999999961', 'トークテスト', 'ないんろぐ99');
  joinTestTeam_(b, '999999961', 'ないんろぐ99');
  const team = findTeamByNumber_('999999961');
  const g = createTestGame_(a, team.team_id, T, T);
  const bat = function (user, pa, ab, hits) {
    const data = { game_id: g.game_id };
    battingCountFields_().forEach(function (k) { data[k] = 0; });
    data.plate_appearances = pa; data.at_bats = ab; data.hits = hits;
    return callAsTest_(handleAddBattingRecord_, data, user, { today: T });
  };
  bat(a, 3, 3, 2);
  bat(b, 1, 1, 1); // b は規定打席（1試合×2＝2打席）に届かない
  callAsTest_(handleAddPitchingRecord_, { game_id: g.game_id, innings: 3, partial_outs: 0, earned_runs: 1 }, a, { today: T });

  m = reply('成績', a);
  results.push({ title: '成績のカード：打率 .667・本塁打・打点・防御率 2.33・「詳細を見る」で自分の成績', expected: 'flex/true/true/true',
    actual: m.type + '/' + (textOf(m).indexOf('.667') !== -1) + '/' + (textOf(m).indexOf('2.33') !== -1) + '/' + (textOf(m).indexOf(CONFIG.LIFF_URL + '/mystats.html') !== -1) });
  results.push({ title: '成績のカード：通知に出る文（altText）にも要約', expected: true, actual: m.altText.indexOf('打率 .667') !== -1 });

  m = reply('ランキング', a);
  const rt = textOf(m);
  results.push({ title: 'ランキングのカード：チーム名・打率の1位があなた・「詳細を見る」でランキング', expected: 'true/true/true',
    actual: (rt.indexOf('トークテスト') !== -1) + '/' + (rt.indexOf('あおやま（あなた）') !== -1) + '/' + (rt.indexOf(CONFIG.LIFF_URL + '/ranking.html') !== -1) });
  results.push({ title: 'ランキングのカード：規定打席に届いていない人（いのうえ）は打率に出ず、安打には出る', expected: 'true',
    actual: String(rt.indexOf('いのうえ') !== -1 && rt.indexOf('規定打席（') === -1) });

  // b から見る：b は規定に届いていないが、a は届いている → 打率がある。b だけのチームで「届いた人がいない」を確かめる
  createTestTeam_(b, '999999962', 'トークテスト2', 'ないんろぐ99');
  const team2 = findTeamByNumber_('999999962');
  const g2 = createTestGame_(b, team2.team_id, T, T);
  const d2 = { game_id: g2.game_id };
  battingCountFields_().forEach(function (k) { d2[k] = 0; });
  d2.plate_appearances = 1; d2.at_bats = 1; d2.hits = 1;
  callAsTest_(handleAddBattingRecord_, d2, b, { today: T });
  m = reply('ランキング', b);
  const bt = textOf(m);
  results.push({ title: '2チームに入っていれば、カードを2枚（横にすべらせる）', expected: 'carousel/2', actual: m.contents.type + '/' + (m.contents.contents || []).length });
  results.push({ title: '規定打席に届いた人がいないチーム：その旨と、安打・本塁打・打点の上位', expected: 'true/true/true',
    actual: (bt.indexOf('規定打席（2打席）に届いた人は、まだいません') !== -1) + '/' + (bt.indexOf('本塁打') !== -1) + '/' + (bt.indexOf('打点') !== -1) });
  results.push({ title: '返信の中身に、他人のLINEユーザーIDは入っていない', expected: false, actual: bt.indexOf(a.userId) !== -1 || rt.indexOf(b.userId) !== -1 });
}
