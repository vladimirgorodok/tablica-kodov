// Чистая логика приложения без обращения к DOM.
// Модуль используется и в браузере, и в Node-тестах.

export const STORAGE_KEY = 'codeTable.v1';
export const APP_VERSION = '1.1.0';

export const FLAGS = [
  { key: 'funnel', label: 'Воронка', short: 'В', hint: 'Показать записи без отметки «Воронка»' },
  { key: 'guide', label: 'Проводник', short: 'П', hint: 'Показать записи без отметки «Проводник»' },
  { key: 'monad', label: 'Монада', short: 'М', hint: 'Показать записи без отметки «Монада»' },
];

export const DEFAULT_SETTINGS = {
  iof: 'Владимир Владимирович Кравченко',
  dr: '04111978',
  places: ['Ленинградская область Мурино'],
};

/** Оставляет только цифры кода. */
export function digitsOf(value) {
  return String(value ?? '').replace(/\D/g, '');
}

/** Приводит код к виду «123 456 789». */
export function formatCode(value) {
  const digits = digitsOf(value).slice(0, 9);
  return digits.replace(/(\d{3})(?=\d)/g, '$1 ').trim();
}

/** Код считается корректным, когда в нём ровно 9 цифр. */
export function isValidCode(value) {
  return digitsOf(value).length === 9;
}

/** Количество слов в строке. */
export function wordCount(value) {
  const text = String(value ?? '').trim();
  return text ? text.split(/\s+/).length : 0;
}

/**
 * Форматирует «Место» для итогового текста.
 * Если слов больше двух, после каждого слова «область» и «район»
 * добавляется перенос строки. Иначе строка выводится как есть.
 */
export function formatPlace(value) {
  const text = String(value ?? '').trim().replace(/\s+/g, ' ');
  if (!text || wordCount(text) <= 2) return text;
  return text
    .replace(/(область|район)(?=\s|$)/gi, '$1\n')
    .replace(/[ \t]*\n[ \t]*/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

/** ISO-дата (2026-03-14) → 14.03.2026. */
export function formatDateRu(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso ?? ''));
  if (!m) return String(iso ?? '');
  return `${m[3]}.${m[2]}.${m[1]}`;
}

/** Приводит дату из ISO или ДД.ММ.ГГГГ к ISO. */
export function toISODate(value) {
  const text = String(value ?? '').trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})[.\/](\d{1,2})[.\/](\d{4})$/.exec(text);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return '';
}

/** Сегодняшняя дата в локальном часовом поясе, ISO. */
export function todayISO(now = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function makeId() {
  try {
    if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
      return globalThis.crypto.randomUUID();
    }
  } catch (_) {
    // ниже — запасной вариант
  }
  return `r-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Проверяет и нормализует одну запись. Возвращает null, если запись пустая. */
export function sanitizeRow(row) {
  if (!row || typeof row !== 'object') return null;
  const name = String(row.name ?? '').trim().replace(/\s+/g, ' ');
  const rawCodes = Array.isArray(row.codes)
    ? row.codes
    : typeof row.codes === 'string'
      ? row.codes.split(/[\n,;]+/)
      : String(row.code ?? '').split(/[\n,;]+/);
  const codes = rawCodes
    .map(formatCode)
    .filter((code) => isValidCode(code));
  if (!name && codes.length === 0) return null;
  return {
    id: typeof row.id === 'string' && row.id ? row.id : makeId(),
    name,
    codes,
    funnel: Boolean(row.funnel ?? row.funnelFlag ?? false),
    guide: Boolean(row.guide ?? row.guideFlag ?? false),
    monad: Boolean(row.monad ?? row.monadFlag ?? false),
    date: toISODate(row.date),
  };
}

export function sanitizeSettings(value) {
  const source = value && typeof value === 'object' ? value : {};
  const places = Array.isArray(source.places)
    ? [...new Set(source.places.map((p) => String(p ?? '').trim().replace(/\s+/g, ' ')).filter(Boolean))]
    : [...DEFAULT_SETTINGS.places];
  return {
    iof: String(source.iof ?? DEFAULT_SETTINGS.iof).trim() || DEFAULT_SETTINGS.iof,
    dr: String(source.dr ?? DEFAULT_SETTINGS.dr).trim() || DEFAULT_SETTINGS.dr,
    places: places.length ? places : [...DEFAULT_SETTINGS.places],
  };
}

/** Данные первого запуска. */
export function createDefaultState(sampleRows) {
  return {
    version: APP_VERSION,
    rows: (sampleRows || []).map(sanitizeRow).filter(Boolean),
    settings: sanitizeSettings(DEFAULT_SETTINGS),
  };
}

/**
 * Фильтрация: поиск по наименованию, отметки (логическое И), дата.
 * Отметки работают в обратной логике: включённый фильтр оставляет записи,
 * у которых соответствующая отметка НЕ стоит.
 */
export function filterRows(rows, filters = {}) {
  const query = String(filters.query ?? '').trim().toLocaleLowerCase('ru');
  const flags = Array.isArray(filters.flags) ? filters.flags : [];
  const date = String(filters.date ?? '');
  return rows.filter((row) => {
    if (query && !String(row.name).toLocaleLowerCase('ru').includes(query)) return false;
    for (const flag of flags) {
      if (row[flag]) return false;
    }
    if (date && row.date !== date) return false;
    return true;
  });
}

/** Уникальные даты в порядке возрастания. */
export function uniqueDates(rows) {
  return [...new Set(rows.map((r) => r.date).filter(Boolean))].sort();
}

/**
 * Итоговый текст: для каждой записи — ИОФ, ДР, Место, затем коды.
 * Двойной код выводится последовательно, каждый на новой строке.
 */
export function buildText(rows, values) {
  const iof = String(values.iof ?? '').trim();
  const dr = String(values.dr ?? '').trim();
  const place = formatPlace(values.place);
  if (!rows.length) return '';
  const blocks = rows.map((row) => {
    const codes = (row.codes || []).map(formatCode).filter((c) => digitsOf(c).length);
    return [iof, dr, place, ...codes].join('\n');
  });
  return `${blocks.join('\n')}\n`;
}

/**
 * Разбор импортированного JSON.
 * Поддерживает как полный экспорт {rows, settings}, так и простой массив записей.
 */
export function parseImport(raw) {
  let data;
  try {
    data = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch (_) {
    throw new Error('Файл не является корректным JSON.');
  }

  let rawRows;
  let settings;
  if (Array.isArray(data)) {
    rawRows = data;
  } else if (data && typeof data === 'object' && Array.isArray(data.rows)) {
    rawRows = data.rows;
    settings = data.settings;
  } else {
    throw new Error('В файле нет массива записей rows.');
  }

  const rows = rawRows.map(sanitizeRow).filter(Boolean);
  if (rawRows.length && !rows.length) {
    throw new Error('В файле не найдено ни одной корректной записи.');
  }
  return { rows, settings: settings ? sanitizeSettings(settings) : null };
}

/** Полный объект для экспорта. */
export function buildExport(state, now = new Date()) {
  return {
    app: 'Таблица кодов',
    version: APP_VERSION,
    exportedAt: now.toISOString(),
    settings: sanitizeSettings(state.settings),
    rows: state.rows.map(sanitizeRow).filter(Boolean),
  };
}

/** Строка для экспорта: аккуратный JSON с отступом. */
export function exportJSON(state, now = new Date()) {
  return `${JSON.stringify(buildExport(state, now), null, 2)}\n`;
}

/** Подсказка для поля «Место»: известные значения, подходящие под ввод. */
export function placeSuggestions(places, query) {
  const q = String(query ?? '').trim().toLocaleLowerCase('ru');
  const list = [...new Set((places || []).map((p) => String(p).trim()).filter(Boolean))];
  return q ? list.filter((p) => p.toLocaleLowerCase('ru').includes(q)) : list;
}

/** Краткая статистика для шапки. */
export function summarize(rows) {
  return {
    count: rows.length,
    dates: uniqueDates(rows).length,
    codes: rows.reduce((sum, row) => sum + (row.codes ? row.codes.length : 0), 0),
  };
}
