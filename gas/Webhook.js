/**
 * 公式LINEのトークへの返信（CLAUDE.md 11.11章。B-23）
 *
 * LINEのWebhook（送られたメッセージやボタンの合図を、こちらのサーバーに知らせる仕組み）を受けて、
 * Reply API（返信。無料のメッセージ数に数えない）で返す。
 * - 「成績」：自分の成績の要約のカード（Flex Message）。「ランキング」：所属しているチームのランキングの要約のカード。
 *   リッチメニューの「自分の成績」「ランキング」のボタンは、この言葉を送る動き（テキスト）にしてある（8.11章）。
 * - それ以外の言葉には、使い方の案内を返す。
 * - GASのWebアプリは302（転送）を返すので、LINEから見るとエラーになるが、返信は届く（2026-11-14 確かめた）。
 *
 * 安全の対策：
 * - Webhook の URL に秘密の目印（?hook=…）を付け、スクリプトプロパティ LINE_WEBHOOK_KEY と合わない要求は何もしない
 *   （GASはLINEの署名を読めないため。目印は画面のプログラムやGitHubには書かない）
 * - 返信は、LINEが付けた「返信用の札」（replyToken。その人のトークにだけ、1回だけ使える）でしか送れない
 * - 1対1のトークだけに返す（グループ・複数人トークには返さない）。見るだけで、シートには書き込まない
 * - 中身は、画面と同じ担当の関数・同じ権限の決まり（所属しているチームだけ）で作る
 * - 合鍵（チャネルアクセストークン）はスクリプトプロパティ LINE_MESSAGING_TOKEN にだけ置き、記録（ログ）にも出さない
 * - 送られてきた文は、返信を作るためだけに使い、保存しない
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

/** 1つの出来事（メッセージ・ボタンの合図）に返信する */
function handleWebhookEvent_(ev) {
  if (!ev || !ev.replyToken || !ev.source || ev.source.type !== 'user' || !ev.source.userId) return; // 1対1のトークだけ
  if (ev.type !== 'message' && ev.type !== 'postback') return;
  sendLineReply_(ev.replyToken, talkReplyMessages_(ev.source.userId, talkCommandOf_(ev)));
}

/**
 * 何を頼まれたか：'stats'（成績）・'ranking'（ランキング）・'help'（それ以外）。
 * 文字は前後の空白を取って、「ランキング」「成績」を含むかで見る（「自分の成績」でもよい）。
 * ポストバック（data に action=stats など）も受け付ける（今のリッチメニューでは使っていない）。
 */
function talkCommandOf_(ev) {
  if (ev.type === 'postback') {
    const m = /(?:^|&)action=(stats|ranking)(?:&|$)/.exec(String((ev.postback && ev.postback.data) || ''));
    return m ? m[1] : 'help';
  }
  if (!ev.message || ev.message.type !== 'text') return 'help';
  const text = String(ev.message.text || '').trim();
  if (/ランキング|らんきんぐ/.test(text)) return 'ranking';
  if (/成績|せいせき/.test(text)) return 'stats';
  return 'help';
}

/**
 * 返信のメッセージを作る（見るだけ。シートには書かない）。
 * 読めなかったときは、短いお知らせだけを返す（中身のエラーは記録にだけ残す）。
 */
function talkReplyMessages_(userId, command) {
  const user = { userId: userId, isAdmin: false };
  try {
    if (command === 'stats') return [statsReplyMessage_(user)];
    if (command === 'ranking') return [rankingReplyMessage_(user)];
    return [{ type: 'text', text: '「成績」と送ると、あなたの成績の要約を、「ランキング」と送ると、チームのランキングの要約をお返しします。\n入力や詳しい成績は、下のメニューから開いてください。' }];
  } catch (err) {
    console.error('トークの返信を作れませんでした：' + (err && err.message));
    return [{ type: 'text', text: 'いま成績を読み込めませんでした。少し時間をおいて、もう一度送ってください。' }];
  }
}

/* ---------- カード（Flex Message）の部品 ---------- */

const TALK_COLOR = { accent: '#1f7a4d', sub: '#5b6b62', line: '#dfe5e1', me: '#e3f2ea' };

/** 画面を開くURL（LIFF。公開してよい値） */
function liffPageUrl_(page) { return CONFIG.LIFF_URL + '/' + page; }

function flexText_(text, opts) {
  return Object.assign({ type: 'text', text: String(text), wrap: true, size: 'sm' }, opts || {});
}

/** 「打率 …… .400」の1行 */
function flexRow_(label, value) {
  return {
    type: 'box', layout: 'horizontal', contents: [
      flexText_(label, { color: TALK_COLOR.sub, flex: 3 }),
      flexText_(value, { align: 'end', weight: 'bold', flex: 2 }),
    ],
  };
}

function flexSeparator_() { return { type: 'separator', margin: 'md', color: TALK_COLOR.line }; }

/** 上に題、下にボタンが1つあるカード */
function flexBubble_(title, subtitle, bodyContents, buttonLabel, buttonPage) {
  const header = [flexText_(title, { weight: 'bold', size: 'md', color: TALK_COLOR.accent })];
  if (subtitle) header.push(flexText_(subtitle, { size: 'xs', color: TALK_COLOR.sub }));
  return {
    type: 'bubble', size: 'kilo',
    header: { type: 'box', layout: 'vertical', contents: header, paddingBottom: 'none' },
    body: { type: 'box', layout: 'vertical', spacing: 'sm', contents: bodyContents },
    footer: { type: 'box', layout: 'vertical', contents: [
      { type: 'button', style: 'primary', color: TALK_COLOR.accent, height: 'sm',
        action: { type: 'uri', label: buttonLabel, uri: liffPageUrl_(buttonPage) } },
    ] },
  };
}

function flexMessage_(altText, contents) {
  return { type: 'flex', altText: String(altText).slice(0, 400), contents: contents };
}

/* ---------- 「成績」：自分の成績の要約 ---------- */

/** 今年（記録が無ければ通算）の、全チーム合計の成績。成績が1件も無ければ「成績を入力」を案内する */
function statsReplyMessage_(user) {
  const res = handleGetMyStats_({}, user);
  const b = res.batting;
  const p = res.pitching;
  if (!b.games && !p.games) {
    return flexMessage_('まだ成績が登録されていません', flexBubble_('あなたの成績', '',
      [flexText_('まだ成績が登録されていません。試合のあとに「成績を入力」から入力してください。')],
      '成績を入力', 'input.html'));
  }
  const body = [];
  if (b.games) {
    body.push(flexText_('打撃（' + b.games + '試合）', { weight: 'bold', color: TALK_COLOR.accent }));
    body.push(flexRow_('打率', b.avg.text));
    body.push(flexRow_('出塁率', b.obp.text));
    body.push(flexRow_('OPS', b.ops.text));
    body.push(flexRow_('本塁打', String(b.home_runs)));
    body.push(flexRow_('打点', String(b.rbis)));
  }
  if (p.games) {
    if (b.games) body.push(flexSeparator_());
    body.push(flexText_('投手（' + p.games + '試合）', { weight: 'bold', color: TALK_COLOR.accent, margin: b.games ? 'md' : 'none' }));
    body.push(flexRow_('防御率', p.era.text));
    body.push(flexRow_('投球回', p.innings_text));
  }
  const season = res.season === 'all' ? '通算' : res.season + '年';
  const alt = 'あなたの成績（' + season + '）' +
    (b.games ? '　打率 ' + b.avg.text + '　本塁打 ' + b.home_runs + '　打点 ' + b.rbis : '') +
    (p.games ? '　防御率 ' + p.era.text : '');
  return flexMessage_(alt, flexBubble_('あなたの成績', season + '・全チーム合計', body, '詳細を見る', 'mystats.html'));
}

/* ---------- 「ランキング」：所属しているチームのランキングの要約 ---------- */

const TALK_RANKING_TEAMS = 3; // カードにするチームの数（多いときは一覧の最初の3チーム）
const TALK_RANKING_TOP = 3;   // 各部門の上位何位まで（同じ順位の人は全員）

/** 所属しているチームごとに1枚（最大3枚。横にすべらせて見る）。チームに入っていなければ「チーム・設定」を案内する */
function rankingReplyMessage_(user) {
  const teams = handleListMyTeams_({}, user).teams.filter(function (t) { return t.orgType === ORG_TYPE.TEAM; });
  if (!teams.length) {
    return flexMessage_('ランキングは、チームに参加すると見られます', flexBubble_('ランキング', '',
      [flexText_('ランキングは、チームに参加すると見られます。代表者から番号と合言葉を教えてもらい、「チーム・設定」から参加してください。')],
      'チーム・設定', 'team.html'));
  }
  const shown = teams.slice(0, TALK_RANKING_TEAMS);
  const bubbles = shown.map(function (t) { return rankingBubble_(handleGetTeamRanking_({ team_id: t.teamId }, user)); });
  const alt = 'ランキング：' + shown.map(function (t) { return t.teamName; }).join('・');
  return flexMessage_(alt, bubbles.length === 1 ? bubbles[0] : { type: 'carousel', contents: bubbles });
}

/** 1チームのカード：打率と安打の上位。規定打席に届いた人がいなければ、その旨と数の部門（安打・本塁打・打点）の上位 */
function rankingBubble_(res) {
  const cats = res.categories;
  const body = [];
  const section = function (key, first) {
    const c = cats[key];
    if (!first) body.push(flexSeparator_());
    body.push(flexText_(c.label, { weight: 'bold', color: TALK_COLOR.accent, margin: first ? 'none' : 'md' }));
    const rows = c.rows.filter(function (r) { return r.rank && r.rank <= TALK_RANKING_TOP; });
    if (!rows.length) {
      body.push(flexText_('（記録はまだありません）', { color: TALK_COLOR.sub, size: 'xs' }));
      return;
    }
    rows.forEach(function (r) { body.push(rankingRow_(r)); });
  };
  if (cats.avg.rows.some(function (r) { return r.rank; })) {
    section('avg', true);
    section('hits', false);
  } else {
    body.push(flexText_('規定打席（' + res.qualifyPlateAppearances + '打席）に届いた人は、まだいません。数の部門の上位をお知らせします。',
      { color: TALK_COLOR.sub, size: 'xs' }));
    section('hits', false);
    section('home_runs', false);
    section('rbis', false);
  }
  const season = res.season === 'all' ? '通算' : res.season + '年';
  return flexBubble_(res.teamName, season + '・チーム試合数 ' + res.teamGames + '試合', body, '詳細を見る', 'ranking.html');
}

/** 「1位　山田　.500」の1行（自分の行は色を付けて「（あなた）」を添える） */
function rankingRow_(r) {
  const row = {
    type: 'box', layout: 'horizontal', contents: [
      flexText_(r.rank + '位', { flex: 1, color: TALK_COLOR.sub }),
      flexText_(r.displayName + (r.is_me ? '（あなた）' : ''), { flex: 4, weight: r.is_me ? 'bold' : 'regular' }),
      flexText_(r.text, { flex: 2, align: 'end', weight: 'bold' }),
    ],
  };
  if (r.is_me) {
    row.backgroundColor = TALK_COLOR.me;
    row.cornerRadius = 'sm';
    row.paddingAll = 'xs';
  }
  return row;
}

/* ---------- 返信を送る・目印の確かめ・URLを作る ---------- */

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
    console.error('返信に失敗しました：状態コード ' + res.getResponseCode() + ' ' + String(res.getContentText()).slice(0, 300));
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
