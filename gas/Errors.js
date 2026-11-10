/**
 * 本人確認以外のエラー（うまくいかなかった理由）の一覧（CLAUDE.md 第3.5章）
 * 本人確認のエラーは Auth.js の AUTH_ERROR を使う。
 * 新しい理由が必要になったら、ここに足す。
 */
const APP_ERROR = {
  BAD_REQUEST: 'BAD_REQUEST',       // 要求の形が正しくない（JSONでない、action が無いなど）
  UNKNOWN_ACTION: 'UNKNOWN_ACTION', // 知らない操作の名前が送られてきた
  VALIDATION_ERROR: 'VALIDATION_ERROR', // 入力された成績の数字や日付が正しくない（details に項目ごとの説明）
  BUSY: 'BUSY',                     // ほかの書き込みが終わるのを待ちきれなかった（少し待って再試行）
  INTERNAL: 'INTERNAL',             // サーバー側の想定外のエラー
};

/**
 * 理由 code つきのエラー
 * details：入力チェックのとき、項目ごとの説明の一覧 [{ field: 'hits', message: '…' }, …]
 */
class AppError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.details = details || null;
  }
}
