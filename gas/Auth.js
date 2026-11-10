/**
 * 本人確認（CLAUDE.md 第3.1章・第3.3章）
 *
 * 画面から届いた IDトークン（LINEが発行した、本人確認の札）を
 * LINEの窓口に問い合わせて確かめ、その人の LINEユーザーID を取り出す。
 *
 * 大事な決まり：
 * - 画面から送られてきた「ユーザーID」は信用しない。必ずこの関数で札から取り出した値を使う。
 * - 札そのものはログ（記録）に書かない。
 */

/** 本人確認でうまくいかなかったときの理由の一覧 */
const AUTH_ERROR = {
  TOKEN_MISSING: 'TOKEN_MISSING',       // 札が送られてこなかった
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',       // 札の有効期限が切れている（画面は再ログインして取り直す）
  TOKEN_INVALID: 'TOKEN_INVALID',       // 札が正しくない（偽物、別のアプリ用など）
  CONFIG_MISSING: 'CONFIG_MISSING',     // スクリプトプロパティにチャネルIDが入っていない
  LINE_UNAVAILABLE: 'LINE_UNAVAILABLE', // LINEの窓口とうまく通信できなかった
};

/**
 * 本人確認の失敗を表すエラー（理由 code つき）
 */
class AuthError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'AuthError';
    this.code = code;
  }
}

/**
 * IDトークンを確かめて、本人の情報を返す。
 * @param {string} idToken 画面から届いた札
 * @return {{userId: string, name: string}} 本人のLINEユーザーIDと表示名
 * @throws {AuthError} 確かめられなかったとき
 */
function verifyIdToken_(idToken) {
  if (typeof idToken !== 'string' || idToken.trim() === '') {
    throw new AuthError(AUTH_ERROR.TOKEN_MISSING, 'IDトークンが送られていません');
  }

  const channelId = getLineLoginChannelId_();
  if (!channelId) {
    throw new AuthError(AUTH_ERROR.CONFIG_MISSING, 'スクリプトプロパティ LINE_LOGIN_CHANNEL_ID が設定されていません');
  }

  // LINEの窓口に「この札は、このチャネル用の本物か」を問い合わせる
  let response;
  try {
    response = UrlFetchApp.fetch(CONFIG.LINE_VERIFY_URL, {
      method: 'post',
      payload: { id_token: idToken, client_id: channelId },
      muteHttpExceptions: true, // エラーの返事も受け取って、自分で理由を判断する
    });
  } catch (err) {
    throw new AuthError(AUTH_ERROR.LINE_UNAVAILABLE, 'LINEの窓口に接続できませんでした');
  }

  const status = response.getResponseCode();
  let body = {};
  try {
    body = JSON.parse(response.getContentText());
  } catch (err) {
    // 返事がJSONでなかった場合は、空のまま下で判断する
  }

  if (status === 200) {
    // 念のため、発行元・宛先・ユーザーIDを自分でも確かめる
    if (body.iss !== CONFIG.LINE_ISSUER || String(body.aud) !== String(channelId) || !body.sub) {
      throw new AuthError(AUTH_ERROR.TOKEN_INVALID, 'IDトークンの中身が正しくありません');
    }
    return { userId: body.sub, name: body.name || '' };
  }

  if (status === 400) {
    // LINEは、期限切れのとき error_description に "IdToken expired." と返す
    const description = String(body.error_description || '');
    if (/expired/i.test(description)) {
      throw new AuthError(AUTH_ERROR.TOKEN_EXPIRED, 'IDトークンの有効期限が切れています');
    }
    throw new AuthError(AUTH_ERROR.TOKEN_INVALID, 'IDトークンが正しくありません');
  }

  throw new AuthError(AUTH_ERROR.LINE_UNAVAILABLE, 'LINEの窓口から想定外の返事がありました（状態コード ' + status + '）');
}
