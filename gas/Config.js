/**
 * @OnlyCurrentDoc
 * ↑ スプレッドシートの許可を「このプログラムが付いているスプレッドシートだけ」に絞る印。
 *   実際の許可の一覧は appsscript.json の oauthScopes に書いてある（そちらが優先される）。
 */

/**
 * 設定値（CLAUDE.md 第6.3章）
 * 規定の倍率など、あとから変える可能性がある数字はここにだけ書く。
 * ほかのファイルには数字を直接書かず、この CONFIG を使う。
 * ファイル名は英語にする（日本語のファイル名は使わない）。
 */
const CONFIG = {
  // 規定打席 ＝ チーム試合数 × この数
  QUALIFY_PA_PER_GAME: 2,

  // 規定投球回 ＝ チーム試合数 × この数（回）
  QUALIFY_IP_PER_GAME: 1,

  // 防御率の計算に使うイニング数（7イニング制）
  INNINGS_PER_GAME: 7,

  // LINEのIDトークン（本人確認の札）を確かめる窓口（CLAUDE.md 第3.1章）
  LINE_VERIFY_URL: 'https://api.line.me/oauth2/v2.1/verify',
  LINE_REPLY_URL: 'https://api.line.me/v2/bot/message/reply', // 返信（B-23）
  LIFF_URL: 'https://liff.line.me/2012474583-SwqZLVvf', // 画面を開くURL（公開してよい値。トークの返信の「詳細を見る」ボタンに使う）
  // 公開中のWebアプリのURL（公開してよい値。画面の js/config.js と同じ）。Webhook の URL を作るときに使う（B-23）
  WEB_APP_URL: 'https://script.google.com/macros/s/AKfycbwQ95a4VTZtdlzstnY9fliiDLgVeDZ66luyeAkW8m5aqe1WjAgIGJaiWp0TZN-bUhUb/exec',
  // 札を発行した元として正しい値
  LINE_ISSUER: 'https://access.line.me',

  // 入力チェック（CLAUDE.md 第4.5章）
  // 1試合で入力できる数の上限（打ち間違いで「100」などが入るのを防ぐ）
  MAX_COUNT_PER_GAME: 99,
  // 入力できる試合日の範囲：この日から、今日（日本時間）まで
  MIN_GAME_DATE: '2000-01-01',
  TIME_ZONE: 'Asia/Tokyo',

  // 成績の入力・修正・削除ができる期間：試合日（0日目）から、この日数目まで（CLAUDE.md 第4.5b章）
  RECORD_EDIT_DAYS: 30,

  // 試合（CLAUDE.md 11.1章）
  GAME_NUMBER_MAX: 9,   // 第何試合の上限（1〜9）
  OPPONENT_MAX: 30,     // 対戦相手の最大文字数

  // チームと参加（CLAUDE.md 第4.8章）
  RESERVED_TEAM_NUMBER_MAX: 1998, // 1〜この番号は、管理者が人の手でテストするための予約番号。管理者だけが作れる
  TEST_TEAM_NUMBER_MIN: 999999900, // ここから下の MAX までは、プログラムの自動テスト専用。
  TEST_TEAM_NUMBER_MAX: 999999999, // 画面からは管理者を含めて誰も作れない
  TEAM_NAME_MAX: 30,              // チーム名の最大文字数
  DISPLAY_NAME_MAX: 20,           // 本人が決める表示名の最大文字数
  DEFAULT_DISPLAY_NAME: 'LINEユーザー', // LINEの名前が取れなかったときの表示名
  PASSPHRASE_MIN: 6,              // 合言葉の最小文字数（そろえたあと）
  PASSPHRASE_MAX: 32,             // 合言葉の最大文字数（そろえたあと）
  PASSPHRASE_HASH_ROUNDS: 1000,   // ハッシュの計算をくり返す回数
  JOIN_MAX_FAILS: 10,             // この回数間違えたら、参加の入力を止める
  JOIN_LOCK_MINUTES: 60,          // 止める時間（分）

  // 記録達成のお祝い（CLAUDE.md 11.4章。B-16）
  CELEBRATION: {
    MULTI_HIT: 3,     // 猛打賞：1試合でこの数以上の安打
    MULTI_HR: 2,      // 1試合でこの数以上の本塁打
    // 通算の節目（この数に届いたとき）。投球回は「回」で書く
    MILESTONES: {
      hits: [10, 50, 100, 200, 300],
      home_runs: [5, 10, 20, 30, 50, 100],
      rbis: [10, 50, 100],
      stolen_bases: [10, 30, 50],
      innings: [10, 50, 100],
    },
  },

  // 書き込みの順番待ち（LockService）で待つ最長の時間（ミリ秒＝1000分の1秒）。10秒（CLAUDE.md 第4.6章）
  LOCK_WAIT_MS: 10000,

  // シートの名前（CLAUDE.md 第4章）
  SHEET: {
    USERS: 'users',
    TEAMS: 'teams',
    GAMES: 'games',
    MEMBERSHIPS: 'memberships',
    BATTING: 'batting_records',
    PITCHING: 'pitching_records',
    JOIN_ATTEMPTS: 'join_attempts',
    RECORD_CHANGES: 'record_changes',
  },
};

/**
 * スクリプトプロパティ（GASの中の隠し保管場所）から値を読む。
 * 値そのものはプログラムに書かない（CLAUDE.md 第5章）。
 * 設定場所：GASの編集画面 → 歯車「プロジェクトの設定」→「スクリプトプロパティ」
 */
function getLineLoginChannelId_() {
  return measure_('props', function () {
    return PropertiesService.getScriptProperties().getProperty('LINE_LOGIN_CHANNEL_ID');
  });
}

/**
 * 管理者かどうか（CLAUDE.md 第4.8章・8.7章）
 * スクリプトプロパティ ADMIN_LINE_USER_IDS に、カンマ区切りで並べたLINEユーザーIDで判定する。
 */
function isAdmin_(userId) {
  const list = measure_('props', function () {
    return PropertiesService.getScriptProperties().getProperty('ADMIN_LINE_USER_IDS');
  }) || '';
  return list.split(',').map(function (s) { return s.trim(); }).filter(Boolean).indexOf(userId) !== -1;
}

/**
 * 合言葉のハッシュに混ぜる「隠し味」（ペッパー）を取り出す。
 * まだ無ければ、ランダムな値を作ってスクリプトプロパティに保存する（最初の1回だけ）。
 * 秘密の値なので、画面にも記録にも出さない。
 * 注意：書き込みの順番待ち（withLock_）の中から呼ぶこと。2人が同時に作ってしまうのを防ぐため。
 */
function getOrCreatePassphrasePepper_() {
  return measure_('props', function () {
    const props = PropertiesService.getScriptProperties();
    let pepper = props.getProperty('PASSPHRASE_PEPPER');
    if (!pepper) {
      pepper = Utilities.getUuid() + Utilities.getUuid();
      props.setProperty('PASSPHRASE_PEPPER', pepper);
    }
    return pepper;
  });
}
