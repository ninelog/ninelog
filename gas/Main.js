/**
 * 画面（LIFF）からの要求を受け付ける入口（CLAUDE.md 第3章）
 * 画面からは POST だけで送る（GET は使わない）。
 *
 * いまは B-2 の動作確認用の仮の入口。
 * B-4 で、本人確認（IDトークンの検証）と操作の振り分けを入れた本番の形に作り直す。
 */
function doPost(e) {
  return jsonResponse_({
    ok: true,
    app: 'ninelog',
    message: '準備中（B-2の動作確認用）',
    // スクリプトプロパティが設定されているかだけを返す（値そのものは返さない）
    channelIdConfigured: Boolean(getLineLoginChannelId_()),
  });
}

/**
 * 結果をJSON（データを文字で表す決まった形式）にして返す。
 */
function jsonResponse_(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
