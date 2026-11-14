/**
 * 合言葉（CLAUDE.md 第4.8章）
 *
 * - そろえ方：① 全角・半角をそろえる → ② 英字を小文字に → ③ カタカナをひらがなに
 *   例：「ナイン9」「ないん９」「ﾅｲﾝ9」→ どれも「ないん9」
 * - 使える文字（そろえたあと）：ひらがな、長音「ー」、英小文字、数字。6〜32文字。
 * - 保存するのはハッシュ（元に戻せない形）だけ。合言葉そのものは保存しない・記録に出さない。
 */

/** 合言葉をそろえる（比べたりハッシュにしたりする前に、必ずこれを通す） */
function normalizePassphrase_(text) {
  return String(text)
    .normalize('NFKC')   // 全角英数字→半角、半角カタカナ→全角カタカナ（ｶﾞ→ガ）
    .toLowerCase()       // 大文字→小文字
    .replace(/[ァ-ヶ]/g, function (ch) {
      // カタカナ（ァ〜ヶ）→ ひらがな（ぁ〜ゖ）。文字の番号が 0x60 ずつずれている
      return String.fromCharCode(ch.charCodeAt(0) - 0x60);
    });
}

/**
 * 合言葉が決まりに合っているか確かめ、そろえた形を返す。
 * 決まりに合わなければ VALIDATION_ERROR（項目名 passphrase）。
 */
function validatePassphrase_(text) {
  if (typeof text !== 'string' || text === '') {
    throw passphraseError_('合言葉を入力してください');
  }
  const normalized = normalizePassphrase_(text);
  if (!/^[ぁ-ゖー0-9a-z]+$/.test(normalized)) {
    throw passphraseError_('合言葉に使えるのは、ひらがな・カタカナ・英字・数字です（漢字・記号・空白は使えません）');
  }
  const length = Array.from(normalized).length;
  if (length < CONFIG.PASSPHRASE_MIN || length > CONFIG.PASSPHRASE_MAX) {
    throw passphraseError_('合言葉は' + CONFIG.PASSPHRASE_MIN + '〜' + CONFIG.PASSPHRASE_MAX + '文字にしてください（いま' + length + '文字）');
  }
  return normalized;
}

/** チームごとの「塩」（ソルト）を新しく作る */
function newPassphraseSalt_() {
  return Utilities.getUuid().replace(/-/g, '');
}

/**
 * そろえた合言葉をハッシュにする。
 * 塩（チームごと）と隠し味（スクリプトプロパティ）を混ぜて、HMAC-SHA256 をくり返す。
 * 注意：書き込みの順番待ちの中から呼ぶこと（隠し味を初めて作ることがあるため）。
 */
function hashPassphrase_(normalized, salt) {
  const pepper = getOrCreatePassphrasePepper_();
  return measure_('hash', function () {
    let value = salt + ':' + normalized;
    for (let i = 0; i < CONFIG.PASSPHRASE_HASH_ROUNDS; i++) {
      value = bytesToHex_(Utilities.computeHmacSha256Signature(value, pepper, Utilities.Charset.UTF_8));
    }
    return value;
  });
}

/** 入力された合言葉が、保存されているハッシュと一致するか */
function passphraseMatches_(text, salt, savedHash) {
  if (typeof text !== 'string' || text === '') return false;
  return hashPassphrase_(normalizePassphrase_(text), salt) === savedHash;
}

function bytesToHex_(bytes) {
  return bytes.map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}

function passphraseError_(message) {
  return new AppError(APP_ERROR.VALIDATION_ERROR, '入力内容に誤りがあります', [
    { field: 'passphrase', message: message },
  ]);
}
