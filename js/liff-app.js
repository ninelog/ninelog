/**
 * どの画面でも使う部品：LIFFの準備と、GASへの問い合わせ（CLAUDE.md 第3章）
 *
 * 使い方（各ページ）：
 *   <script src="https://static.line-scdn.net/liff/edge/2/sdk.js"></script>
 *   <script src="js/config.js"></script>
 *   <script src="js/liff-app.js"></script>
 *   NinelogApp.start().then(function () { return NinelogApp.call('whoami'); }).then(...)
 */
const NinelogApp = (function () {
  const RETRY_KEY = 'ninelog_token_retry'; // 札の期限切れでやり直したかの印（1回だけやり直すため）
  const TIMING_KEY = 'ninelog_timing';      // 通信にかかった時間の記録（このスマホだけ。最近の40件）
  const TIMING_MAX = 40;

  /**
   * かかった時間を残す（2026-11-14：読み込みを速くする方法を考えるため）。
   * 残すのは、操作の名前・時間・成功したか・時刻だけ（成績や名前などの中身は残さない）。
   */
  function recordTiming(name, ms, ok) {
    try {
      const list = JSON.parse(localStorage.getItem(TIMING_KEY) || '[]');
      const now = new Date();
      const pad = function (n) { return ('0' + n).slice(-2); };
      list.push({ at: (now.getMonth() + 1) + '/' + now.getDate() + ' ' + pad(now.getHours()) + ':' + pad(now.getMinutes()) + ':' + pad(now.getSeconds()),
        name: name, ms: Math.round(ms), ok: ok });
      localStorage.setItem(TIMING_KEY, JSON.stringify(list.slice(-TIMING_MAX)));
    } catch (e) { /* 残せなくても動く */ }
  }

  function readTimings() {
    try { return JSON.parse(localStorage.getItem(TIMING_KEY) || '[]'); } catch (e) { return []; }
  }
  function clearTimings() {
    try { localStorage.removeItem(TIMING_KEY); } catch (e) { /* そのまま */ }
  }

  /**
   * LIFF（LINEの中で開く画面の仕組み）を準備する。
   * - LINEの外（パソコンのブラウザなど）で開いてログインしていなければ、LINEのログイン画面へ移動する。
   * - リッチメニューから input.html などを開いたときは、liff.init の中で目的のページへ自動で移動する（3.4章）。
   * @return {Promise<boolean>} 準備ができたら true。ログイン画面へ移動したときは false
   */
  function start() {
    const t0 = performance.now();
    return liff.init({ liffId: NINELOG_CONFIG.LIFF_ID }).then(function () {
      recordTiming('LINEの準備（liff.init）', performance.now() - t0, true);
      if (!liff.isLoggedIn()) {
        liff.login({ redirectUri: location.href });
        return false;
      }
      return true;
    });
  }

  /**
   * GASに操作を頼む（3.2章：本文はJSON文字列、Content-Type は text/plain、POSTだけ）。
   * 成功したら data を返し、失敗したら { code, message, details, info } を持つエラーを投げる。
   * 札（IDトークン）の期限切れ（TOKEN_EXPIRED）のときは、ログインし直して1回だけやり直す（3.3章）。
   */
  function call(action, data) {
    // 見るだけの操作は、同じときに頼まれたものをまとめて1回で送る（B-22。11.10章）
    if (BATCHABLE.hasOwnProperty(action)) {
      return new Promise(function (resolve, reject) {
        queue.push({ action: action, data: data || {}, resolve: resolve, reject: reject });
        if (!flushTimer) flushTimer = setTimeout(flush, 0);
      });
    }
    return callOne(action, data);
  }

  /** 1つの操作を送る。混み合っている（BUSY）ときは、1.5秒待って1回だけやり直す（3.5章） */
  function callOne(action, data, label) {
    return send(action, data, label).catch(function (err) {
      if (err.code !== 'BUSY') throw err;
      return new Promise(function (resolve) { setTimeout(resolve, 1500); })
        .then(function () { return send(action, data, label); });
    });
  }

  /* ---------- 見るだけの操作をまとめて送る（B-22） ---------- */

  /** まとめてよい操作（書き込まない操作だけ。GASも書き込む操作は断る） */
  const BATCHABLE = {
    whoami: 1, listMyTeams: 1, listMyBattingRecords: 1, listMyPitchingRecords: 1, getMyStats: 1,
    getTeamRanking: 1, getTournamentRanking: 1, getTeamStats: 1, getCalendar: 1, listTeamGames: 1,
    getDeletePreview: 1, listSoloMoveTargets: 1,
  };
  const BATCH_MAX = 10;   // GASの決まりと同じ
  let queue = [];
  let flushTimer = null;
  let batchUnsupported = false; // GASが batch を知らない（古い版の）ときは、1件ずつ送る

  function toError(e) {
    const err = new Error(e.message);
    err.code = e.code;
    err.details = e.details || null;
    err.info = e.info || null;
    return err;
  }

  /** たまった操作を送る：1件なら今までどおり、2件以上なら batch で1回に */
  function flush() {
    const items = queue;
    queue = [];
    flushTimer = null;
    for (let i = 0; i < items.length; i += BATCH_MAX) sendGroup(items.slice(i, i + BATCH_MAX));
  }

  function sendOneEach(items) {
    items.forEach(function (it) { callOne(it.action, it.data).then(it.resolve, it.reject); });
  }

  function sendGroup(items) {
    if (items.length === 1 || batchUnsupported) { sendOneEach(items); return; }
    const label = 'まとめて：' + items.map(function (it) { return it.action; }).join('・');
    callOne('batch', { requests: items.map(function (it) { return { action: it.action, data: it.data }; }) }, label)
      .then(function (res) {
        res.results.forEach(function (r, i) {
          if (r.ok) items[i].resolve(r.data);
          else items[i].reject(toError(r.error || { code: 'INTERNAL', message: '想定外の返事でした' }));
        });
      }, function (err) {
        if (err.code === 'UNKNOWN_ACTION') { batchUnsupported = true; sendOneEach(items); return; }
        items.forEach(function (it) { it.reject(err); });
      });
  }

  function send(action, data, label) {
    const t0 = performance.now();
    return sendOnce(action, data).then(function (result) {
      recordTiming(label || action, performance.now() - t0, true);
      return result;
    }, function (err) {
      recordTiming(label || action, performance.now() - t0, false);
      throw err;
    });
  }

  function sendOnce(action, data) {
    const idToken = liff.getIDToken();
    return fetch(NINELOG_CONFIG.GAS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: action, idToken: idToken, data: data || {} }),
    })
      .then(function (res) { return res.json(); })
      .then(function (body) {
        if (body.ok) {
          sessionStorage.removeItem(RETRY_KEY);
          return body.data;
        }
        const error = body.error || { code: 'INTERNAL', message: '想定外の返事でした' };
        if (error.code === 'TOKEN_EXPIRED' && !sessionStorage.getItem(RETRY_KEY)) {
          // 1回だけ、札を取り直してページを開き直す（開き直したページで同じ操作がもう一度行われる）
          sessionStorage.setItem(RETRY_KEY, '1');
          liff.logout();
          if (liff.isInClient()) {
            location.reload();
          } else {
            liff.login({ redirectUri: location.href });
          }
          return new Promise(function () {}); // 移動するので、ここで止める
        }
        const err = new Error(error.message);
        err.code = error.code;
        err.details = error.details || null;
        err.info = error.info || null;
        throw err;
      }, function () {
        const err = new Error('通信できませんでした。電波のよい場所で、もう一度お試しください');
        err.code = 'NETWORK';
        throw err;
      });
  }

  return { start: start, call: call, recordTiming: recordTiming, readTimings: readTimings, clearTimings: clearTimings };
})();
