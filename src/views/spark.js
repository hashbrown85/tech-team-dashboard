// @ts-check
/**
 * A small inline trend line.
 *
 * This started as the meeting-rating trend and was hard-wired to a 1-5 scale. Win
 * confidence is 0-100, so rather than write a second one that drifts out of step,
 * the scale is a parameter and both callers use this.
 *
 * Everything it draws is already styled: `.spark` and its `.sg` gridlines, `.sl`
 * line, `.se` end dot and `.st` date labels are all in the stylesheet.
 */

import { fmt } from '../lib/dates.js';

/**
 * @typedef {{d: string, v: number}} Point - a date and a value
 */

/**
 * @param {Point[]} points - oldest first; fewer than two draws nothing
 * @param {object} [opts]
 * @param {number} [opts.min] - bottom of the scale (default 0)
 * @param {number} [opts.max] - top of the scale (default 100)
 * @param {number[]} [opts.grid] - values to draw a gridline at
 * @param {string} [opts.label] - the accessible description
 * @param {boolean} [opts.bare] - omit the date labels, for tight spaces
 * @param {number} [opts.w]
 * @param {number} [opts.h]
 * @returns {string}
 */
export function spark(points, opts) {
  // One point is not a trend, and dividing by (length - 1) would be division by
  // zero. Callers decide what to say instead.
  if (!points || points.length < 2) return '';

  const o = opts || {};
  const min = o.min == null ? 0 : o.min;
  const max = o.max == null ? 100 : o.max;
  const grid = o.grid || [];
  const bare = !!o.bare;
  const W = o.w || 240;
  const H = o.h || 64;
  const px = 8, py = 8;
  const span = (max - min) || 1;

  const x = function (i) { return px + i * (W - 2 * px) / (points.length - 1); };
  const y = function (v) {
    const clamped = Math.max(min, Math.min(max, v));
    return py + (max - clamped) * (H - 2 * py) / span;
  };

  const last = points[points.length - 1];
  const height = bare ? H : H + 16;

  return '<svg class="spark' + (bare ? ' bare' : '') + '" viewBox="0 0 ' + W + ' ' + height +
    '" role="img" aria-label="' + (o.label || 'Trend') + '">' +
    grid.map(function (v) {
      return '<line class="sg" x1="' + px + '" x2="' + (W - px) +
        '" y1="' + y(v).toFixed(1) + '" y2="' + y(v).toFixed(1) + '"></line>';
    }).join('') +
    '<polyline class="sl" points="' + points.map(function (p, i) {
      return x(i).toFixed(1) + ',' + y(p.v).toFixed(1);
    }).join(' ') + '"></polyline>' +
    '<circle class="se" cx="' + x(points.length - 1).toFixed(1) +
    '" cy="' + y(last.v).toFixed(1) + '" r="3.5"></circle>' +
    (bare ? ''
      : '<text class="st" x="' + px + '" y="' + (H + 13) + '">' + fmt(points[0].d) + '</text>' +
        '<text class="st" x="' + (W - px) + '" y="' + (H + 13) +
        '" text-anchor="end">' + fmt(last.d) + '</text>') +
    '</svg>';
}
