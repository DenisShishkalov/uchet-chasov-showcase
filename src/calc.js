// Расчёт часов, нормы и переработки. Чистые функции без доступа к окну и диску,
// поэтому их можно проверять тестами в Node.

import { BUILTIN_CALENDAR, DEFAULT_HOLIDAYS } from './calendar-data.js';

const DAY_MS = 24 * 60 * 60 * 1000;

// Все даты — строки 'YYYY-MM-DD', считаются в UTC, чтобы не зависеть от часового пояса.
export function toDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function toIso(date) {
  return date.toISOString().slice(0, 10);
}

export function addDays(iso, n) {
  return toIso(new Date(toDate(iso).getTime() + n * DAY_MS));
}

export function daysBetween(fromIso, toIso_) {
  return Math.round((toDate(toIso_) - toDate(fromIso)) / DAY_MS);
}

export function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function monthDates(year, month) {
  const n = daysInMonth(year, month);
  const mm = String(month).padStart(2, '0');
  return Array.from({ length: n }, (_, i) => `${year}-${mm}-${String(i + 1).padStart(2, '0')}`);
}

// 0 — воскресенье, 6 — суббота.
export function weekday(iso) {
  return toDate(iso).getUTCDay();
}

// Дата смены по местному времени: до часа пересменки ещё идёт вчерашняя смена.
export function currentShiftDate(now, shiftStartHour) {
  const local = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (now.getHours() < shiftStartHour) local.setDate(local.getDate() - 1);
  const mm = String(local.getMonth() + 1).padStart(2, '0');
  const dd = String(local.getDate()).padStart(2, '0');
  return `${local.getFullYear()}-${mm}-${dd}`;
}

// Какой караул заступает в дату при графике «сутки через трое».
export function karaulForDate(iso, anchor, count = 4) {
  const diff = daysBetween(anchor.date, iso);
  return ((((anchor.karaul - 1 + diff) % count) + count) % count) + 1;
}

// Раскладка суточной смены по календарным дням: [{offset, day, night}].
// offset 0 — день заступления, 1 — следующий день.
export function shiftSplit(settings) {
  const { shiftStartHour, nightStartHour, nightEndHour } = settings;
  const parts = [{ offset: 0, day: 0, night: 0 }, { offset: 1, day: 0, night: 0 }];
  for (let i = 0; i < 24; i++) {
    const abs = shiftStartHour + i;
    const hour = abs % 24;
    const part = parts[Math.floor(abs / 24)];
    const isNight = nightStartHour > nightEndHour
      ? hour >= nightStartHour || hour < nightEndHour
      : hour >= nightStartHour && hour < nightEndHour;
    if (isNight) part.night++;
    else part.day++;
  }
  return parts.filter(p => p.day + p.night > 0);
}

// Код дня по производственному календарю: 0 — рабочий, 1 — нерабочий, 2 — сокращённый.
export function dayCode(calendar, iso) {
  const year = iso.slice(0, 4);
  const codes = calendar?.[year] ?? BUILTIN_CALENDAR[year];
  if (codes) {
    const index = daysBetween(`${year}-01-01`, iso);
    return Number(codes[index] ?? 0);
  }
  // Года нет в календаре: считаем пятидневку без праздников.
  const wd = weekday(iso);
  return wd === 0 || wd === 6 ? 1 : 0;
}

export function hasCalendarYear(calendar, year) {
  return Boolean(calendar?.[year] ?? BUILTIN_CALENDAR[year]);
}

// Норма часов за день при 40-часовой неделе.
export function dayNorm(calendar, iso) {
  const code = dayCode(calendar, iso);
  if (code === 0) return 8;
  if (code === 2) return 7;
  return 0;
}

export function monthNorm(calendar, year, month) {
  return monthDates(year, month).reduce((sum, iso) => sum + dayNorm(calendar, iso), 0);
}

// Праздничные дни года в виде 'MM-DD'. У каждого года свой список, по умолчанию — ст. 112 ТК РФ.
export function holidaysFor(data, year) {
  return data.holidays?.[year] ?? DEFAULT_HOLIDAYS;
}

export function isHoliday(holidays, iso) {
  return holidays.includes(iso.slice(5));
}

// Состояние техники. В расчёте и в резерве её можно выбрать при заступлении, в ремонте — нет.
export const VEHICLE_STATUSES = [
  { code: 'calc', label: 'В расчёте' },
  { code: 'reserve', label: 'В резерве' },
  { code: 'repair', label: 'В ремонте' },
];

export function vehicleStatusLabel(code) {
  return VEHICLE_STATUSES.find(s => s.code === code)?.label ?? code;
}

// Сотрудник заступает без техники, остаётся в части (например, диспетчер).
export const STATION = 'station';

export function vehicleName(data, id) {
  if (id === STATION) return 'В части';
  return data.vehicles.find(v => v.id === id)?.name ?? '—';
}

export function isVehicleSelectable(v) {
  return v.status !== 'repair';
}

// Виды отсутствия. Отгул берётся за переработку, поэтому норму не уменьшает.
export const ABSENCE_TYPES = [
  { code: 'Б', label: 'Больничный', reducesNorm: true },
  { code: 'О', label: 'Отпуск', reducesNorm: true },
  { code: 'К', label: 'Командировка', reducesNorm: true },
  { code: 'ОТ', label: 'Отгул', reducesNorm: false },
  { code: 'Д', label: 'Другое', reducesNorm: false },
];

export function absenceType(code) {
  return ABSENCE_TYPES.find(t => t.code === code) ?? { code, label: code, reducesNorm: false };
}

// Отсутствие сотрудника (больничный, отпуск...) на дату или null.
export function absenceOn(absences, employeeId, iso) {
  return absences.find(a => a.employeeId === employeeId && a.from <= iso && iso <= a.to) ?? null;
}

// Подмены сотрудника в чужих караулах за несколько суток до даты: [{date, karaul}], ближние первыми.
export function substitutionsBefore(data, employee, iso, days = 3) {
  const result = [];
  for (let i = 1; i <= days; i++) {
    const d = addDays(iso, -i);
    const shift = data.shifts[d];
    if (!shift || shift.karaul === employee.karaul) continue;
    if (shift.entries.some(x => x.employeeId === employee.id && x.present)) result.push({ date: d, karaul: shift.karaul });
  }
  return result;
}

// Часы сотрудника по дням месяца: {iso: {day, night}}.
export function employeeMonthHours(data, employeeId, year, month) {
  const dates = monthDates(year, month);
  const first = dates[0];
  const last = dates[dates.length - 1];
  const split = shiftSplit(data.settings);
  const result = {};
  for (const shift of Object.values(data.shifts)) {
    // Смена могла начаться в последний день прошлого месяца.
    if (shift.date < addDays(first, -1) || shift.date > last) continue;
    const entry = shift.entries.find(e => e.employeeId === employeeId && e.present);
    if (!entry) continue;
    for (const part of split) {
      const iso = addDays(shift.date, part.offset);
      if (iso < first || iso > last) continue;
      const cell = result[iso] ?? (result[iso] = { day: 0, night: 0 });
      cell.day += part.day;
      cell.night += part.night;
    }
  }
  return result;
}

export const fmtHours = n => String(n).replace('.', ',');

// Доп. часы сотрудника за месяц по дням: {iso: часы}.
export function extraHoursByDay(data, employeeId, year, month) {
  const prefix = monthKey(year, month);
  const result = {};
  for (const x of data.extraHours ?? []) {
    if (x.employeeId === employeeId && x.date.startsWith(prefix)) result[x.date] = (result[x.date] ?? 0) + x.hours;
  }
  return result;
}

// Что написать в клетке табеля: «16», «16+3», «+4» или отметка отсутствия.
export function tabelCellText(c) {
  if (c.extra) return `${c.hours || ''}+${fmtHours(c.extra)}`;
  return c.hours || c.mark || '';
}

// Строка табеля по сотруднику за месяц.
export function tabelRow(data, employee, year, month) {
  const dates = monthDates(year, month);
  const hours = employeeMonthHours(data, employee.id, year, month);
  const extras = extraHoursByDay(data, employee.id, year, month);
  const baseNorm = monthNorm(data.calendar, year, month);
  const holidays = holidaysFor(data, year);
  let day = 0, night = 0, holiday = 0, normCut = 0, extraTotal = 0;
  const cells = dates.map(iso => {
    const h = hours[iso];
    const absence = absenceOn(data.absences, employee.id, iso);
    if (absence && absenceType(absence.type).reducesNorm) normCut += dayNorm(data.calendar, iso);
    const extra = extras[iso] ?? 0;
    extraTotal += extra;
    if (isHoliday(holidays, iso)) holiday += extra;
    if (h) {
      day += h.day;
      night += h.night;
      if (isHoliday(holidays, iso)) holiday += h.day + h.night;
      return { iso, hours: h.day + h.night, extra, mark: null };
    }
    return { iso, hours: 0, extra, mark: absence ? absence.type : null };
  });
  const total = day + night + extraTotal;
  const counted = total - holiday;
  const norm = baseNorm - normCut;
  return { employee, cells, day, night, total, holiday, counted, norm, overtime: counted - norm };
}

export function fullName(e) {
  return [e.lastName, e.firstName, e.middleName].filter(Boolean).join(' ');
}

export function shortName(e) {
  const initials = [e.firstName, e.middleName].filter(Boolean).map(s => s[0] + '.').join(' ');
  return initials ? `${e.lastName} ${initials}` : e.lastName;
}

// Звание для узких столбцов: «старший лейтенант внутренней службы» → «ст. лейтенант вн. сл.».
export function shortRank(rank) {
  return (rank ?? '')
    .replace(/^старший /i, 'ст. ')
    .replace(/^младший /i, 'мл. ')
    .replace(' внутренней службы', ' вн. сл.');
}

export function sortEmployees(list) {
  return [...list].sort((a, b) => fullName(a).localeCompare(fullName(b), 'ru'));
}

// Место в списке-справочнике без учёта регистра; чего нет в списке — в конец.
export function listIndex(list, value) {
  const i = (list ?? []).findIndex(x => x.toLowerCase() === (value ?? '').trim().toLowerCase());
  return i === -1 ? list?.length ?? 0 : i;
}

// Иерархия: порядок должностей задаётся справочником, при равной должности старше звание, затем ФИО.
// Звания в справочнике идут от младшего к старшему.
export function compareByHierarchy(data, a, b) {
  return listIndex(data.positions, a.position) - listIndex(data.positions, b.position)
    || listIndex(data.ranks, b.rank) - listIndex(data.ranks, a.rank)
    || fullName(a).localeCompare(fullName(b), 'ru');
}

export function sortByHierarchy(data, list) {
  return [...list].sort((a, b) => compareByHierarchy(data, a, b));
}

// По технике в порядке справочника «Техника», затем «В части», затем без техники. Внутри — по иерархии.
export function sortByVehicle(data, list, vehicleOf = e => e.vehicleId) {
  const order = id => {
    if (id === STATION) return data.vehicles.length;
    const i = data.vehicles.findIndex(v => v.id === id);
    return i === -1 ? data.vehicles.length + 1 : i;
  };
  return [...list].sort((a, b) => order(vehicleOf(a)) - order(vehicleOf(b)) || compareByHierarchy(data, a, b));
}

export function monthKey(year, month) {
  return `${year}-${String(month).padStart(2, '0')}`;
}

function prevMonth(year, month) {
  return month === 1 ? [year - 1, 12] : [year, month - 1];
}

// Первый месяц, с которого в программе есть данные: перенесённые итоги или отмеченные смены.
// До него переработка считается нулевой.
export function firstDataMonth(data) {
  const keys = [...Object.keys(data.imported ?? {}), ...Object.keys(data.shifts).map(d => d.slice(0, 7))];
  return keys.length ? keys.sort()[0] : null;
}

// Месяц сотрудника с накопленной переработкой: на начало + за месяц = на конец.
// Если итоги месяца перенесены из документа, берутся они.
export function monthWithBalance(data, employee, year, month, cache = new Map()) {
  const key = `${employee.id}|${monthKey(year, month)}`;
  if (cache.has(key)) return cache.get(key);
  const imported = data.imported?.[monthKey(year, month)]?.[employee.id];
  let result;
  if (imported) {
    // Доп. часы, записанные на перенесённый месяц, идут сверх его итогов.
    const extras = Object.entries(extraHoursByDay(data, employee.id, year, month));
    const holidays = holidaysFor(data, year);
    const added = extras.reduce((s, [, h]) => s + h, 0);
    const addedHoliday = extras.reduce((s, [iso, h]) => s + (isHoliday(holidays, iso) ? h : 0), 0);
    const counted = added - addedHoliday;
    result = {
      employee, imported, cells: monthDates(year, month).map(iso => ({ iso, hours: 0, extra: 0, mark: null })),
      day: null, night: null, total: imported.fact + added, holiday: imported.holiday + addedHoliday,
      counted: imported.fact - imported.holiday + counted, norm: imported.norm,
      overtime: imported.end - imported.start + counted, start: imported.start, end: imported.end + counted,
    };
  } else {
    const row = tabelRow(data, employee, year, month);
    const [py, pm] = prevMonth(year, month);
    const prev = monthKey(py, pm);
    const first = firstDataMonth(data);
    // Перенесённые итоги — отправная точка для всех: кого не было в документе, тот начинает с нуля.
    const lastImported = Object.keys(data.imported ?? {}).sort().pop();
    const untracked = lastImported && prev <= lastImported && !data.imported[prev]?.[employee.id];
    const start = first && prev >= first && !untracked ? monthWithBalance(data, employee, py, pm, cache).end : 0;
    result = { ...row, start, end: start + row.overtime };
  }
  cache.set(key, result);
  return result;
}

// Табель караула (или всей части при karaul = null). Порядок — по иерархии должностей.
export function tabel(data, year, month, karaul) {
  const dates = monthDates(year, month);
  const first = dates[0];
  const people = data.employees.filter(e => {
    if (karaul && e.karaul !== karaul) return false;
    // Уволенных показываем, только если у них были часы в этом месяце.
    if (!e.archived) return true;
    return Object.keys(employeeMonthHours(data, e.id, year, month)).length > 0
      || Object.keys(extraHoursByDay(data, e.id, year, month)).length > 0 || (e.archivedAt ?? '') >= first;
  });
  const ordered = karaul
    ? sortByHierarchy(data, people)
    : [...people].sort((a, b) => (a.karaul || 9) - (b.karaul || 9) || compareByHierarchy(data, a, b));
  const cache = new Map();
  return {
    year, month, karaul, dates,
    norm: monthNorm(data.calendar, year, month),
    imported: Boolean(data.imported?.[monthKey(year, month)]),
    // Месяц раньше начала учёта в программе: показывать нечего.
    before: firstDataMonth(data) ?? null,
    rows: ordered.map(e => monthWithBalance(data, e, year, month, cache)),
  };
}
