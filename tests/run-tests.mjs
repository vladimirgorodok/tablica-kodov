import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  DEFAULT_SETTINGS,
  birthDateDigit,
  buildText,
  exportJSON,
  filterRows,
  formatCode,
  formatDateRu,
  formatPlace,
  iofDigit,
  isValidCode,
  makePersonalCode,
  parseCodesText,
  parseImport,
  placeSuggestions,
  sanitizeRow,
  sanitizeSettings,
  summarize,
  toISODate,
  uniqueDates,
  wordCount,
} from '../web/core.js';

const etherText = readFileSync(new URL('./fixtures/ether-2026-11-14.txt', import.meta.url), 'utf8');
const energyText = readFileSync(new URL('./fixtures/energy-resource-2026-11-08.txt', import.meta.url), 'utf8');

let passed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failures.push({ name, error });
    console.log(`  ✗ ${name}`);
  }
}

function row(overrides = {}) {
  return {
    id: 'r1',
    name: 'Тестовый код',
    codes: ['123 456 789'],
    funnel: true,
    guide: false,
    monad: false,
    date: '2026-03-14',
    ...overrides,
  };
}

console.log('\nКоды');
test('formatCode форматирует девять цифр разрядами по три', () => {
  assert.equal(formatCode('123456789'), '123 456 789');
  assert.equal(formatCode('123 456 789'), '123 456 789');
  assert.equal(formatCode('12-34-56-789'), '123 456 789');
});
test('formatCode ограничивает ввод девятью цифрами', () => {
  assert.equal(formatCode('123456789000'), '123 456 789');
  assert.equal(formatCode(''), '');
});
test('isValidCode принимает только девять цифр', () => {
  assert.equal(isValidCode('123 456 789'), true);
  assert.equal(isValidCode('123 456 78'), false);
  assert.equal(isValidCode('123 456 7890'), false);
  assert.equal(isValidCode('abc'), false);
});

console.log('\nМесто');
test('два слова и меньше выводятся без переносов', () => {
  assert.equal(formatPlace('Ленинградская область'), 'Ленинградская область');
  assert.equal(formatPlace('Москва Хамовники'), 'Москва Хамовники');
  assert.equal(formatPlace(' Мурино '), 'Мурино');
});
test('перенос после «область» при трёх словах', () => {
  assert.equal(formatPlace('Ленинградская область Мурино'), 'Ленинградская область\nМурино');
});
test('перенос после «область» и «район»', () => {
  assert.equal(
    formatPlace('Московская область Одинцовский район г. Одинцово'),
    'Московская область\nОдинцовский район\nг. Одинцово',
  );
});
test('перенос не зависит от регистра и лишних пробелов', () => {
  assert.equal(
    formatPlace('  московская   ОБЛАСТЬ   одинцовский РАЙОН   г. Одинцово '),
    'московская ОБЛАСТЬ\nодинцовский РАЙОН\nг. Одинцово',
  );
});
test('слова «областной» и «районный» не разрезаются', () => {
  assert.equal(formatPlace('Областной центр районный дом культуры'), 'Областной центр районный дом культуры');
});
test('wordCount считает слова', () => {
  assert.equal(wordCount('  один   два  '), 2);
  assert.equal(wordCount(''), 0);
});

console.log('\nДаты');
test('даты приводятся к ISO и обратно', () => {
  assert.equal(toISODate('14.03.2026'), '2026-03-14');
  assert.equal(toISODate('2026-03-14'), '2026-03-14');
  assert.equal(toISODate('1.3.2026'), '2026-03-01');
  assert.equal(formatDateRu('2026-03-01'), '01.03.2026');
});
test('uniqueDates сортирует и убирает повторы', () => {
  assert.deepEqual(uniqueDates([
    row({ date: '2026-05-16' }),
    row({ date: '2026-03-14' }),
    row({ date: '2026-05-16' }),
    row({ date: '' }),
  ]), ['2026-03-14', '2026-05-16']);
});

console.log('\nФильтры');
const rows = [
  row({ id: '1', name: 'Финансы', funnel: true, guide: false, monad: true, date: '2026-03-14' }),
  row({ id: '2', name: 'Кундалини', funnel: true, guide: true, monad: true, date: '2026-03-31' }),
  row({ id: '3', name: 'Вода', funnel: true, guide: false, monad: false, date: '2026-05-16' }),
];
test('поиск по наименованию без учёта регистра', () => {
  assert.deepEqual(filterRows(rows, { query: 'финан' }).map((r) => r.id), ['1']);
  assert.deepEqual(filterRows(rows, { query: 'КУНД' }).map((r) => r.id), ['2']);
});
test('несколько отметок работают по обратной логике «И»', () => {
  assert.deepEqual(filterRows(rows, { flags: ['monad'] }).map((r) => r.id), ['3']);
  assert.deepEqual(filterRows(rows, { flags: ['monad', 'guide'] }).map((r) => r.id), ['3']);
});
test('фильтр по дате', () => {
  assert.deepEqual(filterRows(rows, { date: '2026-03-31' }).map((r) => r.id), ['2']);
});
test('фильтры складываются', () => {
  assert.deepEqual(filterRows(rows, { query: 'а', flags: ['guide'], date: '2026-05-16' }).map((r) => r.id), ['3']);
});

console.log('\nИтоговый текст');
test('одиночный код: ИОФ, ДР, место, код', () => {
  const text = buildText([row()], {
    iof: 'Владимир Владимирович Кравченко',
    dr: '04111978',
    place: 'Москва Хамовники',
  });
  assert.equal(text, 'Владимир Владимирович Кравченко\n04111978\nМосква Хамовники\n123 456 789\n');
});
test('двойной код выводится двумя строками подряд', () => {
  const text = buildText([row({ codes: ['019 910 581', '449 095 936'] })], {
    iof: 'И',
    dr: 'Д',
    place: 'М',
  });
  assert.equal(text, 'И\nД\nМ\n019 910 581\n449 095 936\n');
});
test('место с районом разбивается, следующий код идёт новой строкой', () => {
  const text = buildText([row(), row({ id: 'r2', codes: ['987 654 321'] })], {
    iof: 'ИОФ',
    dr: '01012000',
    place: 'Московская область Одинцовский район г. Одинцово',
  });
  assert.equal(text,
    'ИОФ\n01012000\nМосковская область\nОдинцовский район\nг. Одинцово\n123 456 789\n'
    + 'ИОФ\n01012000\nМосковская область\nОдинцовский район\nг. Одинцово\n987 654 321\n');
});
test('пустой список даёт пустую строку', () => {
  assert.equal(buildText([], { iof: 'И', dr: 'Д', place: 'М' }), '');
});

console.log('\nРазбор списка кодов');
test('цифра ИОФ и даты рождения считаются по таблице Хамилии', () => {
  assert.equal(iofDigit('Владимир Владимирович Кравченко'), 4);
  assert.equal(birthDateDigit('04111978'), 4);
  assert.equal(iofDigit('Иван Иванович Иванов'), 7);
  assert.equal(birthDateDigit('25.02.1964'), 2);
  assert.equal(iofDigit(''), null);
  assert.equal(birthDateDigit(''), null);
});
test('вторая часть двойного кода собирается по порядку формулы', () => {
  assert.equal(
    makePersonalCode('698 275 512', 'Иван Иванович Иванов', '25.02.1964', 3, '358', ['program', 'iof', 'dr', 'positions', 'suffix']),
    '372 625 358',
  );
  assert.equal(makePersonalCode('698 275 512', DEFAULT_SETTINGS.iof, DEFAULT_SETTINGS.dr, 3, '358'), '443 625 358');
  assert.equal(makePersonalCode('276 813 762', DEFAULT_SETTINGS.iof, DEFAULT_SETTINGS.dr, 9, '312'), '449 287 312');
  assert.equal(makePersonalCode('123', DEFAULT_SETTINGS.iof, DEFAULT_SETTINGS.dr, 3, '358'), '');
});
test('список с эфира разбирается в 19 записей и 22 кода', () => {
  const parsed = parseCodesText(etherText, { date: '2026-11-14' });
  assert.equal(parsed.rows.length, 19);
  assert.equal(parsed.rows.reduce((count, item) => count + item.codes.length, 0), 22);
  assert.deepEqual(parsed.warnings, []);
  assert.equal(parsed.rows[0].name, 'Восстановление тела через события');
  assert.deepEqual(parsed.rows[0].codes, ['327 982 725']);
  assert.equal(parsed.rows[0].date, '2026-11-14');
  assert.equal(parsed.rows[0].funnel, false);
});
test('двойные коды получают персональную вторую часть', () => {
  const parsed = parseCodesText(etherText, { date: '2026-11-14' });
  const byName = Object.fromEntries(parsed.rows.map((item) => [item.name, item.codes]));
  assert.deepEqual(byName['ДНК силы молодости и красоты'], ['698 275 512', '443 625 358']);
  assert.deepEqual(byName['Новая программа'], ['138 555 162', '449 151 932']);
  assert.deepEqual(byName['Кортизол'], ['276 813 762', '449 287 312']);
  assert.deepEqual(byName['Осознанное восприятие'], ['268 169 246']);
});
test('заголовки и пояснения не превращаются в записи', () => {
  const parsed = parseCodesText(etherText, { date: '2026-11-14' });
  const names = parsed.rows.map((item) => item.name);
  assert.ok(!names.includes('ВЫДАННЫЕ КОДЫ НА ЭФИРЕ'));
  assert.ok(!names.includes('ДНК заболевания закрыть/обнулить'));
  assert.ok(!names.some((name) => name.startsWith('Коды с эфира')));
});
test('код на следующей строке получает название заголовка', () => {
  const parsed = parseCodesText('Новый код:\n123 456 789\nЕщё код: 987 654 321', { date: '2026-11-14' });
  assert.equal(parsed.rows.length, 2);
  assert.equal(parsed.rows[0].name, 'Новый код');
  assert.deepEqual(parsed.rows[1].codes, ['987 654 321']);
});
test('список без двоеточий и с эмодзи разбирается', () => {
  const parsed = parseCodesText(energyText, { date: '2026-11-08' });
  assert.equal(parsed.rows.length, 10);
  assert.equal(parsed.rows.reduce((count, item) => count + item.codes.length, 0), 10);
  assert.deepEqual(parsed.warnings, []);
  assert.equal(parsed.rows[0].name, 'Код на активность преобразований');
  assert.deepEqual(parsed.rows[0].codes, ['267 158 853']);
  assert.equal(parsed.rows[9].name, 'Код на открытие нового мира');
  assert.deepEqual(parsed.rows[9].codes, ['357 358 246']);
  assert.ok(parsed.rows.every((item) => /^[\p{L}\p{N}]/u.test(item.name)));
  assert.equal(parsed.rows[0].date, '2026-11-08');
});
test('список без кодов возвращает предупреждения, а не записи', () => {
  const parsed = parseCodesText('Просто текст без кодов', { date: '2026-11-14' });
  assert.equal(parsed.rows.length, 0);
});

console.log('\nИмпорт и экспорт');
test('sanitizeRow нормализует запись', () => {
  const result = sanitizeRow({
    name: '  Новый   код ',
    codes: ['123456789', '12'],
    funnel: 1,
    date: '14.03.2026',
  });
  assert.equal(result.name, 'Новый код');
  assert.deepEqual(result.codes, ['123 456 789']);
  assert.equal(result.funnel, true);
  assert.equal(result.date, '2026-03-14');
});
test('parseImport принимает полный экспорт', () => {
  const raw = JSON.stringify({
    rows: [{ name: 'Код', codes: ['123 456 789'], date: '2026-03-14' }],
    settings: { iof: 'И', dr: 'Д', places: ['Место'] },
  });
  const parsed = parseImport(raw);
  assert.equal(parsed.rows.length, 1);
  assert.equal(parsed.rows[0].name, 'Код');
  assert.deepEqual(parsed.settings, { iof: 'И', dr: 'Д', places: ['Место'] });
});
test('parseImport принимает простой массив', () => {
  const parsed = parseImport('[{"name":"Код","codes":["123456789"],"date":"14.03.2026"}]');
  assert.equal(parsed.rows.length, 1);
  assert.equal(parsed.rows[0].date, '2026-03-14');
  assert.equal(parsed.settings, null);
});
test('parseImport сообщает об ошибке', () => {
  assert.throws(() => parseImport('{oops'), /JSON/);
  assert.throws(() => parseImport('{"a":1}'), /rows/);
});
test('экспорт и повторный импорт сохраняют данные', () => {
  const state = {
    rows: [row()],
    settings: { iof: 'И', dr: '04111978', places: ['Ленинградская область Мурино'] },
  };
  const json = exportJSON(state, new Date('2026-11-14T00:00:00Z'));
  const parsed = parseImport(json);
  assert.equal(parsed.rows.length, 1);
  assert.equal(parsed.rows[0].name, 'Тестовый код');
  assert.deepEqual(parsed.settings, state.settings);
  assert.match(json, /"exportedAt": "2026-11-14T00:00:00.000Z"/);
});
test('sanitizeSettings добавляет значения по умолчанию', () => {
  assert.deepEqual(sanitizeSettings(null), DEFAULT_SETTINGS);
  assert.deepEqual(sanitizeSettings({ places: ['  A ', 'A', ''] }).places, ['A']);
});
test('подсказки мест фильтруются и не повторяются', () => {
  assert.deepEqual(placeSuggestions(['Москва', 'Мурино', 'Москва'], 'мур'), ['Мурино']);
  assert.deepEqual(placeSuggestions(['Москва', 'Мурино'], ''), ['Москва', 'Мурино']);
});
test('summarize считает записи, коды и даты', () => {
  assert.deepEqual(summarize([
    row({ codes: ['123 456 789', '987 654 321'] }),
    row({ id: 'r2', date: '2026-03-31' }),
  ]), { count: 2, dates: 2, codes: 3 });
});

console.log(`\nИтого: ${passed} успешно, ${failures.length} с ошибкой`);
if (failures.length) {
  for (const { name, error } of failures) {
    console.error(`\n${name}\n${error.stack}`);
  }
  process.exit(1);
}
