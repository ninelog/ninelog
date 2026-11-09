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

  // シートの名前（CLAUDE.md 第4章）
  SHEET: {
    USERS: 'users',
    TEAMS: 'teams',
    MEMBERSHIPS: 'memberships',
    BATTING: 'batting_records',
    PITCHING: 'pitching_records',
  },
};
