/**
 * 相手別・大会別・区分別の集計の表（C-6d。C-7b のチーム全体の成績でも使い回す）。CLAUDE.md 11.4章・B-15
 *
 * GASの getMyStats・getTeamStats の返事の breakdowns（{ by_opponent, by_tournament, by_category }）を出すだけ。
 * 計算はGASが行う（率は GAS が作った文字をそのまま出す。分母が0なら「-」）。
 *
 * 使い方：
 *   const bd = NinelogBreakdown.create(四角の要素, { withRecord: false });  // チーム全体の成績では true（勝敗の表も出す）
 *   bd.update(res.breakdowns);   // 選び直すたびに呼ぶ。行が1つも無ければ、四角ごと隠す
 */
const NinelogBreakdown = (function () {
  const DIMENSIONS = [
    ['by_opponent', '相手別', '相手'],
    ['by_tournament', '大会別', '大会'],
    ['by_category', '区分別', '区分'],
  ];

  /** 表の種類ごとの列：[見出し, 値の取り出し方] */
  const VIEWS = {
    record: {
      label: '勝敗',
      columns: [
        ['試合', function (r) { return String(r.games); }],
        ['勝', function (r) { return String(r.record.win); }],
        ['敗', function (r) { return String(r.record.lose); }],
        ['分', function (r) { return String(r.record.draw); }],
        ['勝率', function (r) { return r.winning_pct.text; }],
      ],
      note: '勝率 ＝ 勝ち ÷（勝ち＋負け）。引き分けと、勝敗が未入力の試合は入れません。',
    },
    batting: {
      label: '打撃',
      columns: [
        ['試合', function (r) { return String(r.batting.appearances); }],
        ['打率', function (r) { return r.batting.avg.text; }],
        ['安打', function (r) { return String(r.batting.hits); }],
        ['本塁打', function (r) { return String(r.batting.home_runs); }],
        ['打点', function (r) { return String(r.batting.rbis); }],
        ['OPS', function (r) { return r.batting.ops.text; }],
      ],
      note: '試合は、打撃の成績がある試合の数です。',
    },
    pitching: {
      label: '投手',
      columns: [
        ['登板', function (r) { return String(r.pitching.appearances); }],
        ['投球回', function (r) { return r.pitching.innings_text; }],
        ['自責点', function (r) { return String(r.pitching.earned_runs); }],
        ['防御率', function (r) { return r.pitching.era.text; }],
      ],
      note: '登板は、投手の成績がある試合の数です。',
    },
  };

  function create(card, options) {
    const opts = Object.assign({ withRecord: false }, options || {});
    const el = NinelogUI.el;
    const views = opts.withRecord ? ['record', 'batting', 'pitching'] : ['batting', 'pitching'];
    let dim = DIMENSIONS[0][0];
    let view = views[0];
    let data = null;

    card.innerHTML = '';
    card.appendChild(el('h2', '', '相手別・大会別の集計'));
    const dimSeg = seg(DIMENSIONS.map(function (d) { return [d[0], d[1]]; }), dim, '集計の分け方', function (v) { dim = v; render(); });
    const viewSeg = seg(views.map(function (v) { return [v, VIEWS[v].label]; }), view, '表の中身', function (v) { view = v; render(); });
    const wrap = el('div', 'nl-table-wrap');
    const table = el('table', 'nl-table nl-table--bd');
    wrap.appendChild(table);
    const note = el('p', 'nl-note');
    card.appendChild(dimSeg);
    card.appendChild(viewSeg);
    card.appendChild(wrap);
    card.appendChild(note);

    /** 切り替えボタンの組（打撃／投手などと同じ見た目） */
    function seg(items, current, label, onPick) {
      const box = el('div', 'nl-seg nl-seg--sm');
      box.setAttribute('role', 'group');
      box.setAttribute('aria-label', label);
      items.forEach(function (it) {
        const b = el('button', 'nl-seg__btn', it[1]);
        b.type = 'button';
        b.setAttribute('aria-pressed', it[0] === current ? 'true' : 'false');
        b.addEventListener('click', function () {
          box.querySelectorAll('button').forEach(function (x) { x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); });
          onPick(it[0]);
        });
        box.appendChild(b);
      });
      return box;
    }

    function render() {
      table.innerHTML = '';
      const rows = (data && data[dim]) || [];
      const v = VIEWS[view];
      const head = el('tr');
      head.appendChild(el('th', '', DIMENSIONS.filter(function (d) { return d[0] === dim; })[0][2]));
      v.columns.forEach(function (c) { head.appendChild(el('th', '', c[0])); });
      table.appendChild(head);
      rows.forEach(function (r) {
        const tr = el('tr');
        tr.appendChild(el('td', '', r.label));
        v.columns.forEach(function (c) { tr.appendChild(el('td', '', c[1](r))); });
        table.appendChild(tr);
      });
      note.textContent = v.note + (dim === 'by_opponent'
        ? '相手の名前は、全角・半角と前後の空白をそろえてまとめています。'
        : dim === 'by_tournament' ? '大会の付いていない試合は「（大会なし）」にまとめています。' : '');
    }

    return {
      /** GASの breakdowns を出す。行が1つも無ければ、四角ごと隠す */
      update: function (breakdowns) {
        data = breakdowns || {};
        const any = DIMENSIONS.some(function (d) { return (data[d[0]] || []).length > 0; });
        card.hidden = !any;
        if (any) render();
      },
    };
  }

  return { create: create };
})();
