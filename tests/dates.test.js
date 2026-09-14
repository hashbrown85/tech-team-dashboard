// @ts-check
/**
 * Tests for the date maths.
 *
 * Boring on the surface, but every one of these has an off-by-one or a timezone
 * mistake waiting in it, and the whole app keys its records by date string — a date
 * that shifts by a day puts an entry in the wrong meeting.
 */

import { group, test, eq } from './harness.js';
import { toStr, parseD, addDays, diffDays, nextOn, fmt, fmtDay, rel } from '../src/lib/dates.js';

group('Date maths');

test('Round-trips a date string through a Date object', () => {
  eq(toStr(parseD('2026-09-14')), '2026-09-14');
});

test('Pads single-digit months and days', () => {
  eq(toStr(new Date(2026, 0, 5)), '2026-01-05');
});

test('Parses to LOCAL midnight, not UTC', () => {
  // This is the bug that bites everyone: new Date('2026-09-14') parses as UTC and
  // reads back as the 13th anywhere west of Greenwich. parseD must not do that.
  const d = parseD('2026-09-14');
  eq(d.getFullYear(), 2026);
  eq(d.getMonth(), 8, 'September is month 8');
  eq(d.getDate(), 14, 'the 14th in local time, whatever the timezone');
  eq(d.getHours(), 0);
});

test('Adds and subtracts days', () => {
  eq(addDays('2026-09-14', 7), '2026-09-21');
  eq(addDays('2026-09-14', -7), '2026-09-07');
  eq(addDays('2026-09-14', 0), '2026-09-14');
});

test('Crosses month, year and leap-year boundaries', () => {
  eq(addDays('2026-09-28', 7), '2026-10-05', 'month end');
  eq(addDays('2026-12-28', 7), '2027-01-04', 'year end');
  eq(addDays('2026-03-01', -1), '2026-02-28', 'backwards over a month start');
  eq(addDays('2028-02-28', 1), '2028-02-29', '2028 is a leap year');
  eq(addDays('2026-02-28', 1), '2026-03-01', '2026 is not');
});

test('Counts whole days between dates, signed', () => {
  eq(diffDays('2026-09-14', '2026-09-21'), 7);
  eq(diffDays('2026-09-21', '2026-09-14'), -7, 'negative going backwards');
  eq(diffDays('2026-09-14', '2026-09-14'), 0);
  eq(diffDays('2026-12-28', '2027-01-04'), 7, 'across a year boundary');
});

test('Finds the next given weekday, ON or after the date', () => {
  // 2026-09-14 is a Monday.
  eq(parseD('2026-09-14').getDay(), 1, 'confirming the fixture is a Monday');

  eq(nextOn('2026-09-14', 1), '2026-09-14', 'already Monday — returns the same day');
  eq(nextOn('2026-09-14', 2), '2026-09-15', 'next Tuesday is tomorrow');
  eq(nextOn('2026-09-14', 0), '2026-09-20', 'next Sunday is six days off');
  eq(nextOn('2026-09-15', 1), '2026-09-21', 'from Tuesday, Monday is next week');
});

test('"On or after" is what makes a meeting show on the morning it happens', () => {
  // If this returned the FOLLOWING week when given the meeting day itself, the board
  // would skip past today's meeting exactly when you needed it.
  eq(nextOn('2026-09-14', 1), '2026-09-14');
});

test('Finding a weekday works across a month end', () => {
  eq(nextOn('2026-09-29', 1), '2026-10-05', 'Tuesday the 29th to the next Monday');
});

test('Formats dates for display', () => {
  eq(fmt('2026-09-14'), 'Sep 14');
  eq(fmtDay('2026-09-14'), 'Mon, Sep 14');
  eq(fmt('2026-01-05'), 'Jan 5', 'no leading zero when spoken');
});

test('Describes dates relative to a reference day', () => {
  const from = '2026-09-14';
  eq(rel('2026-09-14', from), 'today');
  eq(rel('2026-09-15', from), 'tomorrow');
  eq(rel('2026-09-13', from), 'yesterday');
  eq(rel('2026-09-17', from), 'in 3 days');
  eq(rel('2026-09-11', from), '3 days ago');
});

test('Switches from days to weeks at a fortnight', () => {
  const from = '2026-09-14';
  eq(rel('2026-09-27', from), 'in 13 days', 'still days at 13');
  eq(rel('2026-09-28', from), 'in 2 weeks', 'weeks from 14');
  eq(rel('2026-09-01', from), '13 days ago', 'and symmetrically backwards');
  eq(rel('2026-08-31', from), '2 weeks ago');
});

/* Tests run on import. tests/all.test.js gathers every file and reports once. */
