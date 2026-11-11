/**
 * 本人確認以外のエラー（うまくいかなかった理由）の一覧（CLAUDE.md 第3.5章）
 * 本人確認のエラーは Auth.js の AUTH_ERROR を使う。
 * 新しい理由が必要になったら、ここに足す。
 */
const APP_ERROR = {
  BAD_REQUEST: 'BAD_REQUEST',       // 要求の形が正しくない（JSONでない、action が無いなど）
  UNKNOWN_ACTION: 'UNKNOWN_ACTION', // 知らない操作の名前が送られてきた
  VALIDATION_ERROR: 'VALIDATION_ERROR', // 入力された成績の数字や日付が正しくない（details に項目ごとの説明）
  JOIN_FAILED: 'JOIN_FAILED',       // チーム番号か合言葉が違う（info.remainingAttempts に残りの回数）
  JOIN_LOCKED: 'JOIN_LOCKED',       // 間違えすぎて、しばらく参加の入力ができない（info.minutesLeft に残りの分）
  FORBIDDEN: 'FORBIDDEN',           // その操作をする権限がない（例：代表者以外が合言葉を変えようとした、他人の記録を直そうとした）
  EDIT_PERIOD_OVER: 'EDIT_PERIOD_OVER', // 成績の入力・修正・削除の期限（試合日から30日）を過ぎている
  GAME_HAS_RECORDS: 'GAME_HAS_RECORDS', // 成績が付いている試合は消せない
  BUSY: 'BUSY',                     // ほかの書き込みが終わるのを待ちきれなかった（少し待って再試行）
  INTERNAL: 'INTERNAL',             // サーバー側の想定外のエラー
};

/**
 * 理由 code つきのエラー
 * details：入力チェックのとき、項目ごとの説明の一覧 [{ field: 'hits', message: '…' }, …]
 * info：画面が動きを変えるのに使う追加の情報（例：{ remainingAttempts: 7 }）
 */
class AppError extends Error {
  constructor(code, message, details, info) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.details = details || null;
    this.info = info || null;
  }
}
