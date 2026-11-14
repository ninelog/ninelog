/**
 * 画面の中に出す月のカレンダー（C-4b。C-6b の記録カレンダーでも使い回す）
 *
 * - ○：選んでいるチームの試合がある日、●：自分の成績を入れた日（●の日は○の日でもあるので、●を優先して出す）
 * - min〜max の外の日は押せない（試合日から30日より前・未来など）
 * - 月の移動（‹ ›）も、min〜max を含む月の中だけ
 *
 * 使い方：
 *   const cal = NinelogCalendar.create(箱の要素, {
 *     min: '2026-10-15', max: '2026-11-14', selected: '2026-11-14',
 *     onSelect: function (date) { … },          // 日を押したとき
 *     onMonthChange: function (month) { … },    // 表示する月が変わったとき（○●を読み直すため）
 *   });
 *   cal.setMarks({ '2026-11-08': { game: true, mine: true } });
 *   cal.setSelected('2026-11-13');              // 違う月なら、その月を出す
 */
const NinelogCalendar = (function () {
  const WEEK = ['日', '月', '火', '水', '木', '金', '土'];

  function pad(n) { return ('0' + n).slice(-2); }
  function monthOf(date) { return date.slice(0, 7); }
  function addMonth(month, diff) {
    const y = Number(month.slice(0, 4));
    const m = Number(month.slice(5, 7)) - 1 + diff;
    const d = new Date(Date.UTC(y, m, 1));
    return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1);
  }

  function create(box, options) {
    const opts = Object.assign({ marks: {} }, options || {});
    let month = monthOf(opts.selected || opts.max);
    let selected = opts.selected || '';
    let marks = opts.marks || {};
    const el = NinelogUI.el;

    function render() {
      box.innerHTML = '';
      box.classList.add('nl-cal');

      // 見出し：‹ 2026年11月 ›
      const head = el('div', 'nl-cal__head');
      const prev = el('button', 'nl-cal__nav', '‹');
      prev.type = 'button';
      prev.setAttribute('aria-label', '前の月');
      prev.disabled = Boolean(opts.min) && month <= monthOf(opts.min);
      const next = el('button', 'nl-cal__nav', '›');
      next.type = 'button';
      next.setAttribute('aria-label', '次の月');
      next.disabled = Boolean(opts.max) && month >= monthOf(opts.max);
      head.appendChild(prev);
      head.appendChild(el('div', 'nl-cal__title', Number(month.slice(0, 4)) + '年' + Number(month.slice(5, 7)) + '月'));
      head.appendChild(next);
      prev.addEventListener('click', function () { changeMonth(-1); });
      next.addEventListener('click', function () { changeMonth(1); });
      box.appendChild(head);

      // 曜日と日付
      const grid = el('div', 'nl-cal__grid');
      WEEK.forEach(function (w, i) {
        const cell = el('div', 'nl-cal__week' + (i === 0 ? ' is-sun' : i === 6 ? ' is-sat' : ''), w);
        grid.appendChild(cell);
      });
      const y = Number(month.slice(0, 4));
      const m = Number(month.slice(5, 7));
      const firstDay = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
      const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
      for (let i = 0; i < firstDay; i++) grid.appendChild(el('div', 'nl-cal__blank'));
      for (let d = 1; d <= days; d++) {
        const date = month + '-' + pad(d);
        const dow = (firstDay + d - 1) % 7;
        const b = el('button', 'nl-cal__day' + (dow === 0 ? ' is-sun' : dow === 6 ? ' is-sat' : ''));
        b.type = 'button';
        b.appendChild(el('span', 'nl-cal__num', String(d)));
        const mark = marks[date] || {};
        const symbol = mark.mine ? '●' : mark.game ? '○' : '';
        b.appendChild(el('span', 'nl-cal__mark', symbol));
        let label = (m + '月' + d + '日');
        if (mark.mine) label += '、自分の成績あり';
        else if (mark.game) label += '、チームの試合あり';
        b.setAttribute('aria-label', label);
        const outside = (opts.min && date < opts.min) || (opts.max && date > opts.max);
        b.disabled = Boolean(outside);
        if (date === selected) {
          b.classList.add('is-selected');
          b.setAttribute('aria-pressed', 'true');
        }
        if (date === opts.max) b.classList.add('is-today');
        b.addEventListener('click', function () {
          if (b.disabled) return;
          selected = date;
          render();
          if (opts.onSelect) opts.onSelect(date);
        });
        grid.appendChild(b);
      }
      box.appendChild(grid);

      const legend = el('div', 'nl-cal__legend', '○ チームの試合がある日　● 自分の成績を入れた日');
      box.appendChild(legend);
    }

    function changeMonth(diff) {
      month = addMonth(month, diff);
      render();
      if (opts.onMonthChange) opts.onMonthChange(month);
    }

    render();
    return {
      /** 表示している月（yyyy-MM） */
      month: function () { return month; },
      /** ○●の印を入れ替える：{ 'yyyy-MM-dd': { game: bool, mine: bool } } */
      setMarks: function (next) { marks = next || {}; render(); },
      /** 選んでいる日を変える（違う月なら、その月を出して onMonthChange を呼ぶ） */
      setSelected: function (date) {
        selected = date;
        const changed = monthOf(date) !== month;
        month = monthOf(date);
        render();
        if (changed && opts.onMonthChange) opts.onMonthChange(month);
      },
      /** 押せる範囲を変える */
      setRange: function (min, max) { opts.min = min; opts.max = max; render(); },
    };
  }

  return { create: create };
})();
