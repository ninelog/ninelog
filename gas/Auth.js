/**
 * 本人確認（CLAUDE.md 第3.1章・第3.3章）
 *
 * 画面から届いた IDトークン（LINEが発行した、本人確認の札）を
 * LINEの窓口に問い合わせて確かめ、その人の LINEユーザーID を取り出す。
 *
 * 大事な決まり：
 * - 画面から送られてきた「ユーザーID」は信用しない。必ずこの関数で札から取り出した値を使う。
 * - 札そのものはログ（記録）に書かない。
 * - B-22：確かめた結果を、GASの中（CacheService）に短い間だけ覚える。同じ札がまた届いたら、LINEに問い合わせない。
 *   目印は札から作った元に戻せない文字（SHA-256）で、札そのものは覚えない。覚えるのは、札の期限の30秒前と10分の早いほうまで。
 */

/** 確かめた結果を覚えておく、いちばん長い時間（秒）。B-22 */
const ID_TOKEN_CACHE_MAX_SECONDS = 600;
/** 札の期限より、これだけ早く忘れる（秒）。期限ぎりぎりの札を使わないため */
const ID_TOKEN_CACHE_MARGIN_SECONDS = 30;

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

  // 少し前に同じ札を確かめていれば、その結果を使う（LINEに問い合わせない。B-22）
  const cacheKey = idTokenCacheKey_(idToken, channelId);
  const cached = readVerifiedCache_(cacheKey);
  if (cached) return cached;

  // LINEの窓口に「この札は、このチャネル用の本物か」を問い合わせる
  let response;
  try {
    response = measure_('fetch', function () {
      return UrlFetchApp.fetch(CONFIG.LINE_VERIFY_URL, {
        method: 'post',
        payload: { id_token: idToken, client_id: channelId },
        muteHttpExceptions: true, // エラーの返事も受け取って、自分で理由を判断する
      });
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
    const user = { userId: body.sub, name: body.name || '' };
    cacheVerified_(cacheKey, user, body.exp);
    return user;
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

/* ---------- 確かめた結果を短い間だけ覚える（B-22。11.10章） ---------- */

/**
 * 覚えるときの目印：チャネルIDと札から作った SHA-256 の文字（元の札には戻せない）。
 * 同じ札なら同じ目印、少しでも違う札なら別の目印になる。
 */
function idTokenCacheKey_(idToken, channelId) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(channelId) + ':' + idToken, Utilities.Charset.UTF_8);
  return 'idt:' + bytes.map(function (b) { return ('0' + ((b + 256) % 256).toString(16)).slice(-2); }).join('');
}

/**
 * 確かめた結果を覚える。exp：札の期限（1970年からの秒。LINEの返事の exp）。
 * 期限が分からないとき・もうすぐ切れるときは覚えない。覚えるのはユーザーIDと名前と期限だけ。
 */
function cacheVerified_(key, user, exp, nowMs) {
  const now = Math.floor((nowMs === undefined ? Date.now() : nowMs) / 1000);
  const expSec = Number(exp);
  if (!expSec) return false;
  const ttl = Math.min(ID_TOKEN_CACHE_MAX_SECONDS, expSec - now - ID_TOKEN_CACHE_MARGIN_SECONDS);
  if (ttl < 10) return false;
  try {
    CacheService.getScriptCache().put(key, JSON.stringify({ userId: user.userId, name: user.name, exp: expSec }), ttl);
    return true;
  } catch (err) {
    return false; // 覚えられなくても、毎回LINEに問い合わせるだけで動く
  }
}

/** 覚えた結果を読む（無い・期限が近い・読めないときは null） */
function readVerifiedCache_(key, nowMs) {
  let raw = null;
  try {
    raw = CacheService.getScriptCache().get(key);
  } catch (err) {
    return null;
  }
  if (!raw) return null;
  let v;
  try { v = JSON.parse(raw); } catch (err) { return null; }
  const now = Math.floor((nowMs === undefined ? Date.now() : nowMs) / 1000);
  if (!v || !v.userId || !(Number(v.exp) - now > ID_TOKEN_CACHE_MARGIN_SECONDS)) return null;
  return { userId: v.userId, name: v.name || '' };
}
