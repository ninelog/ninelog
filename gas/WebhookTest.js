/**
 * B-23（公式LINEのトークへの返信）のテスト
 *
 * 使い方：GASの編集画面で testWebhook を選んで「実行」。
 * 本物のLINEには送らない（返信を送る部品を、テストの間だけ「送ったことを覚えるだけ」に置き換える）。
 * スクリプトプロパティの秘密の目印は、テストの間だけ仮の値にして、最後に元に戻す。
 */
function testWebhook() {
  const results = [];
  const props = PropertiesService.getScriptProperties();
  const savedKey = props.getProperty('LINE_WEBHOOK_KEY');
  const realSend = sendLineReply_;
  const sent = [];
  sendLineReply_ = function (token, messages) { sent.push({ token: token, messages: messages }); return true; };
  try {
    props.setProperty('LINE_WEBHOOK_KEY', 'Utest-hook-key');
    const req = function (key, events) {
      return { parameter: key === null ? {} : { hook: key }, postData: { contents: JSON.stringify({ destination: 'x', events: events }) } };
    };
    const msg = function (text, sourceType) {
      return { type: 'message', replyToken: 'Utest-reply-' + text, source: { type: sourceType || 'user', userId: 'Utest_wh' }, message: { type: 'text', text: text } };
    };
    results.push({ title: '?hook= が無い要求は、画面からの要求として扱う（Webhookではない）', expected: false, actual: isWebhookRequest_(req(null, [])) });
    results.push({ title: '?hook= が付いた要求は、Webhookとして扱う', expected: true, actual: isWebhookRequest_(req('x', [])) });

    sent.length = 0;
    const out = doPost(req('Utest-hook-key', [msg('成績')]));
    results.push({ title: '目印が合えば、1対1のトークのメッセージに返信する', expected: '1/Utest-reply-成績', actual: sent.length + '/' + (sent[0] && sent[0].token) });
    results.push({ title: '返事は「ok」だけ（中身を相手に知らせない）', expected: 'ok', actual: out.getContent() });

    sent.length = 0;
    doPost(req('wrong-key', [msg('成績')]));
    results.push({ title: '目印が違えば、何も返信しない', expected: 0, actual: sent.length });
    sent.length = 0;
    doPost(req('', [msg('成績')]));
    results.push({ title: '目印が空でも、何も返信しない', expected: 0, actual: sent.length });

    sent.length = 0;
    doPost(req('Utest-hook-key', [msg('成績', 'group'), msg('成績', 'room')]));
    results.push({ title: 'グループ・複数人トークには返信しない', expected: 0, actual: sent.length });
    sent.length = 0;
    doPost(req('Utest-hook-key', [{ type: 'follow', replyToken: 'Utest-reply-follow', source: { type: 'user', userId: 'Utest_wh' } }]));
    results.push({ title: '友だち追加などの出来事には、今は返信しない', expected: 0, actual: sent.length });
    sent.length = 0;
    doPost(req('Utest-hook-key', [{ type: 'postback', replyToken: 'Utest-reply-pb', source: { type: 'user', userId: 'Utest_wh' }, postback: { data: 'action=ranking' } }]));
    results.push({ title: 'ボタンの合図（ポストバック）にも返信する', expected: 1, actual: sent.length });
    sent.length = 0;
    const broken = doPost({ parameter: { hook: 'Utest-hook-key' }, postData: { contents: 'JSONではない' } });
    results.push({ title: '中身が壊れていても、エラーにせず「ok」', expected: 'ok/0', actual: broken.getContent() + '/' + sent.length });
    results.push({ title: '目印の比べ方：同じ・違う・長さ違い', expected: 'true/false/false', actual: [sameText_('abc', 'abc'), sameText_('abc', 'abd'), sameText_('abc', 'abcd')].join('/') });
  } finally {
    sendLineReply_ = realSend;
    if (savedKey === null) props.deleteProperty('LINE_WEBHOOK_KEY');
    else props.setProperty('LINE_WEBHOOK_KEY', savedKey);
  }
  results.push({ title: 'テストのあと、秘密の目印は元に戻っている', expected: String(savedKey), actual: String(props.getProperty('LINE_WEBHOOK_KEY')) });
  logResults_(results);
}
