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
  // 札を発行した元として正しい値
  LINE_ISSUER: 'https://access.line.me',

  // 書き込みの順番待ち（LockService）で待つ最長の時間（ミリ秒＝1000分の1秒）。10秒（CLAUDE.md 第4.6章）
  LOCK_WAIT_MS: 10000,

  // シートの名前（CLAUDE.md 第4章）
  SHEET: {
    USERS: 'users',
    TEAMS: 'teams',
    MEMBERSHIPS: 'memberships',
    BATTING: 'batting_records',
    PITCHING: 'pitching_records',
  },
};

/**
 * スクリプトプロパティ（GASの中の隠し保管場所）から値を読む。
 * 値そのものはプログラムに書かない（CLAUDE.md 第5章）。
 * 設定場所：GASの編集画面 → 歯車「プロジェクトの設定」→「スクリプトプロパティ」
 */
function getLineLoginChannelId_() {
  return PropertiesService.getScriptProperties().getProperty('LINE_LOGIN_CHANNEL_ID');
}
