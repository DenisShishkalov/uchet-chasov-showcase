import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  shiftSplit, monthNorm, karaulForDate, tabel, currentShiftDate, addDays, dayCode, tabelRow, tabelCellText, monthWithBalance,
} from '../src/calc.js';

const settings = { shiftStartHour: 8, nightStartHour: 22, nightEndHour: 6 };

test('смена 08:00–08:00 даёт 14д+2н в день заступления и 2д+6н на следующий', () => {
  assert.deepEqual(shiftSplit(settings), [
    { offset: 0, day: 14, night: 2 },
    { offset: 1, day: 2, night: 6 },
  ]);
});

test('норма 2026 года при 40-часовой неделе — 1972 часа, ноябрь — 159', () => {
  let year = 0;
  for (let m = 1; m <= 12; m++) year += monthNorm({}, 2026, m);
  assert.equal(year, 1972);
  assert.equal(monthNorm({}, 2026, 11), 159);
  assert.equal(dayCode({}, '2026-11-03'), 2);
  assert.equal(dayCode({}, '2026-11-04'), 1);
});

test('караулы чередуются сутки через трое', () => {
  const anchor = { date: '2026-10-31', karaul: 2 };
  assert.equal(karaulForDate('2026-10-31', anchor), 2);
  assert.equal(karaulForDate('2026-11-01', anchor), 3);
  assert.equal(karaulForDate('2026-11-03', anchor), 1);
  assert.equal(karaulForDate('2026-11-04', anchor), 2);
  assert.equal(karaulForDate('2026-10-30', anchor), 1);
});

test('до 08:00 ещё идёт вчерашняя смена', () => {
  assert.equal(currentShiftDate(new Date(2026, 10, 1, 7, 59), 8), '2026-10-31');
  assert.equal(currentShiftDate(new Date(2026, 10, 1, 8, 0), 8), '2026-11-01');
});

function scenario() {
  const employees = ['Иванов', 'Кузнецов', 'Соколов'].map((lastName, i) => ({
    id: `e${i}`, lastName, firstName: 'И', middleName: 'И', karaul: 2, archived: false,
  }));
  const absent = { '2026-11-12': ['e1'], '2026-11-04': ['e2'], '2026-11-08': ['e2'] };
  const shifts = {};
  for (let d = '2026-10-31'; d <= '2026-11-28'; d = addDays(d, 4)) {
    shifts[d] = {
      date: d, karaul: 2,
      entries: employees.map(e => ({ employeeId: e.id, present: !(absent[d] ?? []).includes(e.id) })),
    };
  }
  const absences = [
    { employeeId: 'e1', type: 'Б', from: '2026-11-03', to: '2026-11-03' },
    { employeeId: 'e1', type: 'Б', from: '2026-11-12', to: '2026-11-13' },
    { employeeId: 'e2', type: 'Б', from: '2026-11-04', to: '2026-11-09' },
  ];
  return { settings, calendar: {}, holidays: {}, employees, shifts, absences };
}

test('табель за ноябрь: праздничные часы вычитаются, норма уменьшается на отсутствия', () => {
  const t = tabel(scenario(), 2026, 11, 2);
  const [ivanov, kuznetsov, sokolov] = t.rows;

  // Полный месяц: 8 ч с 31 октября + 7 смен по 24 ч, из них 16 ч 4 ноября.
  assert.deepEqual(
    [ivanov.day, ivanov.night, ivanov.total, ivanov.holiday, ivanov.counted, ivanov.norm, ivanov.overtime],
    [114, 62, 176, 16, 160, 159, 1],
  );
  assert.equal(ivanov.cells[3].hours, 16);
  assert.equal(ivanov.cells[0].hours, 8);

  // Пропустил смену 12-го: −24 ч; норма −7 (3-е сокращённый) −16 (12-е и 13-е).
  assert.deepEqual([kuznetsov.total, kuznetsov.counted, kuznetsov.norm, kuznetsov.overtime], [152, 136, 136, 0]);
  assert.equal(kuznetsov.cells[2].mark, 'Б');

  // Болел 4–9 ноября: две смены пропущены, праздничных часов нет.
  assert.deepEqual([sokolov.total, sokolov.holiday, sokolov.counted, sokolov.norm], [128, 0, 128, 135]);
  assert.equal(sokolov.overtime, -7);
});

test('у каждого года свой список праздничных дней', () => {
  const data = scenario();
  // В 2026 году 4 ноября убрано из праздничных: часы идут в переработку.
  data.holidays = { 2026: ['01-01'] };
  const [ivanov] = tabel(data, 2026, 11, 2).rows;
  assert.deepEqual([ivanov.holiday, ivanov.counted, ivanov.overtime], [0, 176, 17]);
});

test('сортировка по иерархии должностей и по технике', async () => {
  const { sortByHierarchy, sortByVehicle } = await import('../src/calc.js');
  const data = {
    positions: ['Начальник караула', 'Командир отделения', 'Водитель автомобиля', 'Пожарный'],
    ranks: ['рядовой', 'сержант', 'капитан'],
    vehicles: [{ id: 'v1', name: 'АЦ-40 №1' }, { id: 'v2', name: 'АЛ-30' }],
  };
  const p = (lastName, position, rank, vehicleId) => ({ lastName, position, rank, vehicleId });
  const list = [
    p('Яковлев', 'Пожарный', 'рядовой', 'v2'),
    p('Борисов', 'Пожарный', 'сержант', 'v1'),
    p('Иванов', 'Начальник караула', 'капитан', 'v1'),
    p('Кузнецов', 'Водитель автомобиля', 'сержант', 'v2'),
    p('Аксёнов', 'Повар', 'рядовой', ''),
  ];
  assert.deepEqual(sortByHierarchy(data, list).map(e => e.lastName), ['Иванов', 'Кузнецов', 'Борисов', 'Яковлев', 'Аксёнов']);
  assert.deepEqual(sortByVehicle(data, list).map(e => e.lastName), ['Иванов', 'Борисов', 'Кузнецов', 'Яковлев', 'Аксёнов']);
});

test('переработка копится: на конец октября из документа + ноябрь = на конец ноября', () => {
  const data = scenario();
  const [ivanov, kuznetsov] = data.employees;
  data.imported = { '2026-10': {
    [ivanov.id]: { norm: 176, fact: 182, holiday: 0, start: 72, end: 78 },
    [kuznetsov.id]: { norm: 176, fact: 172, holiday: 0, start: -57, end: -61 },
  } };
  const oct = tabel(data, 2026, 10, 2);
  assert.equal(oct.imported, true);
  assert.deepEqual([oct.rows[0].start, oct.rows[0].end, oct.rows[0].overtime], [72, 78, 6]);

  const [iv, ku, so] = tabel(data, 2026, 11, 2).rows;
  // Ноябрь Иванова: +1 за месяц, на начало +78 → на конец +79.
  assert.deepEqual([iv.start, iv.overtime, iv.end], [78, 1, 79]);
  assert.deepEqual([ku.start, ku.overtime, ku.end], [-61, 0, -61]);
  // Соколова в документе нет: начинает с нуля.
  assert.deepEqual([so.start, so.end], [0, -7]);

  // Декабрь начинается с конца ноября.
  assert.equal(tabel(data, 2026, 12, 2).rows[0].start, 79);
});

test('«В части» идёт после техники и перед сотрудниками без техники', async () => {
  const { sortByVehicle, vehicleName, STATION } = await import('../src/calc.js');
  const data = { positions: [], ranks: [], vehicles: [{ id: 'v1', name: 'АЦ-40 №1' }] };
  const list = [{ lastName: 'Б', vehicleId: '' }, { lastName: 'В', vehicleId: STATION }, { lastName: 'А', vehicleId: 'v1' }];
  assert.deepEqual(sortByVehicle(data, list).map(e => e.lastName), ['А', 'В', 'Б']);
  assert.equal(vehicleName(data, STATION), 'В части');
});

test('доп. часы: входят в факт и переработку, в праздник — в «Празд.», клетка «16+3» и «+4»', () => {
  const e = { id: 'a', karaul: 1 };
  const shift = date => ({ date, karaul: 1, entries: [{ employeeId: 'a', present: true }] });
  const data = {
    settings: { shiftStartHour: 8, nightStartHour: 22, nightEndHour: 6, anchor: { date: '2026-11-01', karaul: 1 } },
    calendar: {}, holidays: {}, absences: [], shifts: { '2026-11-02': shift('2026-11-02') },
    extraHours: [
      { employeeId: 'a', date: '2026-11-02', hours: 3 },
      { employeeId: 'a', date: '2026-11-10', hours: 1.5 },
      { employeeId: 'a', date: '2026-11-10', hours: 2 },
      { employeeId: 'a', date: '2026-11-04', hours: 4 },
      { employeeId: 'b', date: '2026-11-10', hours: 8 },
      { employeeId: 'a', date: '2026-12-01', hours: 8 },
    ],
  };
  const r = tabelRow(data, e, 2026, 11);
  assert.equal(r.total, 24 + 3 + 3.5 + 4);
  assert.equal(r.holiday, 4);
  assert.equal(r.overtime, 24 + 3 + 3.5 - r.norm);
  assert.equal(tabelCellText(r.cells[1]), '16+3');
  assert.equal(tabelCellText(r.cells[9]), '+3,5');
  assert.equal(tabelCellText(r.cells[2]), 8);
  assert.equal(tabelCellText(r.cells[20]), '');
});

test('доп. часы на перенесённый месяц идут сверх его итогов', () => {
  const data = {
    settings: { shiftStartHour: 8, nightStartHour: 22, nightEndHour: 6 }, calendar: {}, holidays: {}, absences: [], shifts: {},
    imported: { '2026-10': { a: { fact: 200, holiday: 0, norm: 176, start: 10, end: 34 } } },
    extraHours: [{ employeeId: 'a', date: '2026-10-05', hours: 2 }],
  };
  const r = monthWithBalance(data, { id: 'a', karaul: 1 }, 2026, 10);
  assert.deepEqual([r.total, r.overtime, r.end], [202, 26, 36]);
});
