/**
 * 公式LINEのトークへの返信（CLAUDE.md 11.11章。B-23）
 *
 * LINEのWebhook（送られたメッセージやボタンの合図を、こちらのサーバーに知らせる仕組み）を受けて、
 * Reply API（返信。無料のメッセージ数に数えない）で返す。
 *
 * 今は「作る前の小さな確かめ」の段階：どんなメッセージ・合図にも「受け取りました」とだけ返す。
 * GASのWebアプリは302（転送）を返すので、LINEから見るとエラーになるが、返信が届くかをここで確かめる。
 *
 * 安全の対策：
 * - Webhook の URL に秘密の目印（?hook=…）を付け、スクリプトプロパティ LINE_WEBHOOK_KEY と合わない要求は何もしない
 *   （GASはLINEの署名を読めないため。目印は画面のプログラムやGitHubには書かない）
 * - 返信は、LINEが付けた「返信用の札」（replyToken。その人のトークにだけ、1回だけ使える）でしか送れない
 * - 1対1のトークだけに返す（グループ・複数人トークには返さない）。見るだけで、書き込まない
 * - 合鍵（チャネルアクセストークン）はスクリプトプロパティ LINE_MESSAGING_TOKEN にだけ置き、記録（ログ）にも出さない
 */

/** 画面からの要求ではなく、LINEのWebhookか（URLに ?hook= が付いているか） */
function isWebhookRequest_(e) {
  return Boolean(e && e.parameter && Object.prototype.hasOwnProperty.call(e.parameter, 'hook'));
}

/** Webhook を受け付ける。どんな場合も「ok」とだけ返す（中身を相手に知らせない） */
function handleWebhook_(e) {
  const done = ContentService.createTextOutput('ok');
  const expected = PropertiesService.getScriptProperties().getProperty('LINE_WEBHOOK_KEY');
  if (!expected || !sameText_(String(e.parameter.hook || ''), expected)) return done; // 目印が合わない：何もしない
  let body;
  try {
    body = JSON.parse(e.postData && e.postData.contents);
  } catch (err) {
    return done;
  }
  (body && Array.isArray(body.events) ? body.events : []).forEach(function (ev) {
    try {
      handleWebhookEvent_(ev);
    } catch (err) {
      console.error('Webhookの処理でエラー：' + (err && err.message)); // 合鍵や札は書かない
    }
  });
  return done;
}

/** 1つの出来事（メッセージ・ボタンの合図）に返信する。今は「受け取りました」だけ */
function handleWebhookEvent_(ev) {
  if (!ev || !ev.replyToken || !ev.source || ev.source.type !== 'user') return; // 1対1のトークだけ
  if (ev.type !== 'message' && ev.type !== 'postback') return;
  sendLineReply_(ev.replyToken, [{ type: 'text', text: '受け取りました（ナインログの返信のためしです）' }]);
}

/** Reply API で返信する（失敗しても、合鍵は記録に出さない） */
function sendLineReply_(replyToken, messages) {
  const token = PropertiesService.getScriptProperties().getProperty('LINE_MESSAGING_TOKEN');
  if (!token) {
    console.error('スクリプトプロパティ LINE_MESSAGING_TOKEN が設定されていません');
    return false;
  }
  const res = UrlFetchApp.fetch(CONFIG.LINE_REPLY_URL, {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + token },
    payload: JSON.stringify({ replyToken: replyToken, messages: messages }),
    muteHttpExceptions: true,
  });
  if (res.getResponseCode() !== 200) {
    console.error('返信に失敗しました：状態コード ' + res.getResponseCode());
    return false;
  }
  return true;
}

/** 2つの文字が同じか（文字を1つずつ全部比べる。どこで違ったかで時間が変わらないように） */
function sameText_(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * 【手作業で1回だけ実行】Webhook の URL を作って、実行ログに出す（B-23。8.10章）。
 * 秘密の目印（LINE_WEBHOOK_KEY）が無ければ作って保存する。あれば、それを使う。
 * 出てきた URL は、LINE Developers の「Webhook URL」に貼る。チャットやGitHubには貼らない。
 */
function showWebhookUrl() {
  const props = PropertiesService.getScriptProperties();
  let key = props.getProperty('LINE_WEBHOOK_KEY');
  if (!key) {
    key = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
    props.setProperty('LINE_WEBHOOK_KEY', key);
  }
  Logger.log('LINE Developers の「Webhook URL」に、次の1行をそのまま貼ってください（チャットやGitHubには貼らないでください）：');
  Logger.log(CONFIG.WEB_APP_URL + '?hook=' + key);
  Logger.log('合鍵 LINE_MESSAGING_TOKEN：' + (props.getProperty('LINE_MESSAGING_TOKEN') ? '設定済み' : 'まだ設定されていません'));
}
