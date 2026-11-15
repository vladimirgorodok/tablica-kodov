// Чистая логика приложения без обращения к DOM.
// Модуль используется и в браузере, и в Node-тестах.

export const STORAGE_KEY = 'codeTable.v1';
export const APP_VERSION = '1.2.1';

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

/**
 * Таблица букв в цифры из системы Хамилия.
 * Ё = 7, Е = 6; латиница и служебные символы не участвуют.
 */
const LETTER_DIGITS = {
  А: 1, И: 1, С: 1, Ъ: 1,
  Б: 2, Й: 2, Т: 2, Ы: 2,
  В: 3, К: 3, У: 3, Ь: 3,
  Г: 4, Л: 4, Ф: 4, Э: 4,
  Д: 5, М: 5, Х: 5, Ю: 5,
  Е: 6, Н: 6, Ц: 6, Я: 6,
  Ё: 7, О: 7, Ч: 7,
  Ж: 8, П: 8, Ш: 8,
  З: 9, Р: 9, Щ: 9,
};

/** Сворачивает число до одной цифры. */
export function digitalRoot(value) {
  const number = Math.abs(Math.trunc(Number(value)));
  if (!Number.isFinite(number)) return null;
  return number === 0 ? 0 : 1 + ((number - 1) % 9);
}

/** Цифра ИОФ: сумма цифр всех букв имени, отчества и фамилии. */
export function iofDigit(iof) {
  const text = String(iof ?? '').toLocaleUpperCase('ru');
  let sum = 0;
  let found = false;
  for (const letter of text) {
    if (LETTER_DIGITS[letter]) {
      sum += LETTER_DIGITS[letter];
      found = true;
    }
  }
  return found ? digitalRoot(sum) : null;
}

/** Цифра даты рождения: сумма всех цифр ДДММГГГГ. */
export function birthDateDigit(value) {
  const digits = digitsOf(value);
  if (!digits) return null;
  return digitalRoot([...digits].reduce((sum, digit) => sum + Number(digit), 0));
}

/**
 * Вторая часть двойного кода:
 * цифра программы + ИОФ + ДР + 1,4,7 цифры первой части + выданные 3 цифры.
 */
export function makePersonalCode(baseCode, programDigit, suffix, iof, dr) {
  const base = digitsOf(baseCode);
  const program = digitsOf(programDigit);
  const tail = digitsOf(suffix);
  const iofValue = iofDigit(iof);
  const drValue = birthDateDigit(dr);
  if (base.length !== 9 || program.length !== 1 || tail.length !== 3 || iofValue === null || drValue === null) {
    return '';
  }
  return formatCode(`${program}${iofValue}${drValue}${base[0]}${base[3]}${base[6]}${tail}`);
}

function extractSpacedCodes(line) {
  const codes = [];
  const re = /(?:^|[^\d])(\d{3})\s+(\d{3})\s+(\d{3})(?!\d)/g;
  let match = re.exec(line);
  while (match) {
    codes.push(formatCode(`${match[1]}${match[2]}${match[3]}`));
    match = re.exec(line);
  }
  return codes;
}

function extractContiguousCodes(line) {
  const codes = [];
  const re = /(?:^|[^\d])(\d{9})(?!\d)/g;
  let match = re.exec(line);
  while (match) {
    codes.push(formatCode(match[1]));
    match = re.exec(line);
  }
  return codes;
}

function extractCodes(line) {
  return [...new Set([...extractSpacedCodes(line), ...extractContiguousCodes(line)])];
}

function firstCodeIndex(line) {
  const match = /(?:^|[^\d])(?:\d{3}\s+\d{3}\s+\d{3}|\d{9})(?!\d)/.exec(line);
  return match ? match.index + (match[0].length - match[0].trimStart().length) : -1;
}

/** Собирает код из строки вида «268 + Тело (1) + Эмоции (6) + 246». */
function extractAssembledCode(line) {
  if (line.includes(':') || !line.includes('+')) return '';
  const parts = line.split('+').map((part) => part.trim()).filter(Boolean);
  if (parts.length < 2) return '';
  const chunks = parts.map((part) => {
    const direct = /^(\d{1,3})$/.exec(part);
    if (direct) return direct[1];
    const parenthetical = /\((\d{1,3})\)/.exec(part);
    return parenthetical ? parenthetical[1] : '';
  });
  const joined = chunks.join('');
  return joined.length === 9 ? formatCode(joined) : '';
}

function parsePersonalFormula(line) {
  if (!/ИОФ/i.test(line) || !/ДР/i.test(line)) return null;
  const match = /ИОФ\s*\+\s*ДР\s*\+\s*(\d)\s*\+\s*1\s*[,/]\s*4\s*[,/]\s*7[^+]*\+\s*(\d{3})/i.exec(line);
  return match ? { programDigit: match[1], suffix: match[2] } : null;
}

function cleanName(value) {
  return String(value ?? '')
    .replace(/^[^\p{L}\p{N}]+/u, '')
    .replace(/[\s:–—-]+$/, '')
    .replace(/^Двойной код\s*[-–—:]\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function lineValue(line) {
  const formula = parsePersonalFormula(line);
  if (formula) return { formula };
  const codes = extractCodes(line);
  if (codes.length) {
    const index = firstCodeIndex(line);
    const prefix = index > 0 ? cleanName(line.slice(0, index)) : '';
    return { codes, name: prefix, bare: !prefix };
  }
  const assembled = extractAssembledCode(line);
  if (assembled) return { codes: [assembled], name: '', bare: true };
  return null;
}

function isAllCapsHeading(line) {
  const letters = line.replace(/[^A-Za-zА-Яа-яЁё]/g, '');
  return Boolean(letters) && letters === letters.toLocaleUpperCase('ru');
}

/**
 * Разбирает вставленный список кодов с эфира/занятия.
 * Поддерживает строки «Название: 123 456 789», коды на следующей строке,
 * составные коды через «+» и формулы второй части двойного кода.
 */
export function parseCodesText(text, options = {}) {
  const lines = String(text ?? '').replace(/\r\n?/g, '\n').split('\n');
  const date = toISODate(options.date) || options.date || todayISO();
  const iof = options.iof ?? DEFAULT_SETTINGS.iof;
  const dr = options.dr ?? DEFAULT_SETTINGS.dr;
  const rows = [];
  const warnings = [];
  let pendingName = '';

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line) continue;

    const value = lineValue(line);
    if (value && value.formula) {
      const baseRow = rows[rows.length - 1];
      if (!baseRow || !baseRow.codes.length) {
        warnings.push(`Формула без базового кода: ${line}`);
        continue;
      }
      const personal = makePersonalCode(baseRow.codes[0], value.formula.programDigit, value.formula.suffix, iof, dr);
      if (!personal) {
        warnings.push(`Не удалось собрать персональный код: ${line}`);
      } else if (!baseRow.codes.includes(personal)) {
        baseRow.codes.push(personal);
      }
      continue;
    }

    if (value && value.codes.length) {
      const name = cleanName(value.name || pendingName);
      if (!name) {
        warnings.push(`Код без названия: ${line}`);
        pendingName = '';
        continue;
      }
      const row = sanitizeRow({ name, codes: value.codes, date });
      if (row) rows.push(row);
      pendingName = '';
      continue;
    }

    if (isAllCapsHeading(line)) {
      pendingName = '';
      continue;
    }

    let nextLine = '';
    for (let next = index + 1; next < lines.length; next += 1) {
      if (lines[next].trim()) {
        nextLine = lines[next].trim();
        break;
      }
    }
    const nextValue = nextLine ? lineValue(nextLine) : null;
    if (nextValue && nextValue.bare) {
      const candidate = cleanName(line);
      if (candidate) pendingName = candidate;
    }
  }

  return { rows, warnings };
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
