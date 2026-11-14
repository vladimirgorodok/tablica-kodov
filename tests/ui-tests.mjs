/*
 * Интерфейсные тесты «Таблицы кодов» в Firefox (Playwright).
 * Проверяют мобильную вёрстку, фильтры, диалоги, итоговый текст,
 * копирование, импорт/экспорт и сохранение данных.
 *
 * Запуск: PLAYWRIGHT_BROWSERS_PATH=../../_tools/pw-browsers node ui-tests.mjs
 */
import { firefox } from 'playwright';
import http from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.resolve(HERE, '..', 'web');
const SHOTS = path.resolve(HERE, '..', 'docs', 'screenshots');
const TMP = '/tmp/opencode/code-table-tests';
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const results = [];
function record(name, ok, details = '') {
  results.push({ name, ok, details });
  console.log(`${ok ? '✔' : '✘'} ${name}${details ? ` — ${details}` : ''}`);
}
function check(name, condition, details = '') {
  record(name, Boolean(condition), details);
  return Boolean(condition);
}

async function startServer() {
  const server = http.createServer(async (req, res) => {
    try {
      let urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      if (urlPath === '/') urlPath = '/index.html';
      const file = path.normalize(path.join(WEB, urlPath));
      if (!file.startsWith(WEB)) {
        res.writeHead(403).end();
        return;
      }
      const data = await readFile(file);
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
        'Cache-Control': 'no-store',
      });
      res.end(data);
    } catch {
      res.writeHead(404).end('not found');
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, port: server.address().port };
}

async function screenshot(page, name) {
  await page.screenshot({ path: path.join(SHOTS, name), fullPage: false });
  console.log(`  📸 ${name}`);
}

const { server, port } = await startServer();
const base = `http://127.0.0.1:${port}`;
await mkdir(SHOTS, { recursive: true });
await mkdir(TMP, { recursive: true });

const browser = await firefox.launch({
  headless: true,
  env: (() => {
    const env = { ...process.env };
    delete env.LD_PRELOAD;
    return env;
  })(),
  firefoxUserPrefs: {
    'security.sandbox.content.level': 0,
    'gfx.webrender.software': true,
  },
});
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  locale: 'ru-RU',
  timezoneId: 'Europe/Moscow',
  acceptDownloads: true,
});
const page = await context.newPage();
const consoleErrors = [];
page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${error.message}`));
page.on('console', (message) => {
  if (message.type() === 'error') consoleErrors.push(`console: ${message.text()}`);
});

try {
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.waitForSelector('#tableBody tr');

  console.log('\nПервый экран и вёрстка');
  check('заголовок приложения', (await page.locator('.brand-title').innerText()).includes('Таблица кодов'));
  check('в таблице 38 записей из образца', (await page.locator('#tableBody tr').count()) === 38);
  check('первая запись на месте', (await page.locator('#tableBody tr').first().locator('.name-cell').innerText()) === 'Временный 14.03.2026');
  check('код отформатирован по три цифры', (await page.locator('#tableBody tr').first().locator('.code-line').innerText()) === '955 531 144');
  const doubleRow = page.locator('#tableBody tr', { hasText: 'Завершение старого' });
  check('двойной код выводится двумя строками', (await doubleRow.locator('.code-line').count()) === 2);
  check('заголовки отметок — первые буквы', (await page.locator('.codes-table thead').innerText()).includes('В'));
  check('в заголовке действия только корзина', (await page.locator('.th-action').innerText()).trim() === '');
  check('фильтр дат содержит пять вариантов', (await page.locator('#dateFilter option').count()) === 5);
  const dateFilter = await page.evaluate(() => {
    const chipTops = [...document.querySelectorAll('.flag-chip')].map((node) => node.getBoundingClientRect().top);
    const box = document.querySelector('.date-filter').getBoundingClientRect();
    return {
      label: document.querySelector('#dateFilter').selectedOptions[0].textContent.trim(),
      sameRow: chipTops.every((top) => Math.abs(top - box.top) < 2),
      right: box.right,
      vw: window.innerWidth,
    };
  });
  check('фильтр дат подписан «Даты»', dateFilter.label === 'Даты');
  check('фильтр дат в одной строке с отметками', dateFilter.sameRow);
  check('фильтр дат помещается по ширине', dateFilter.right <= dateFilter.vw);

  const layout = await page.evaluate(() => ({
    docWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
    tableOverflow: document.querySelector('#tableScroll').scrollWidth - document.querySelector('#tableScroll').clientWidth,
    tableVisible: document.querySelector('.table-card').getBoundingClientRect().height,
    bottomVisible: document.querySelector('.bottombar').getBoundingClientRect().bottom <= window.innerHeight + 1,
  }));
  check('нет горизонтальной прокрутки страницы', layout.docWidth <= layout.innerWidth + 1, `${layout.docWidth}/${layout.innerWidth}`);
  check('таблица помещается по ширине', layout.tableOverflow <= 1, `overflow=${layout.tableOverflow}`);
  check('нижняя панель видна целиком', layout.bottomVisible && layout.tableVisible > 250, `table=${Math.round(layout.tableVisible)}`);
  const longName = page.locator('#tableBody tr', { hasText: 'Эмоциональный уровень' }).locator('.name-cell');
  const nameMetrics = await longName.evaluate((node) => ({ height: node.getBoundingClientRect().height, line: parseFloat(getComputedStyle(node).lineHeight) }));
  check('длинное наименование переносится по словам', nameMetrics.height > nameMetrics.line * 1.5, `${nameMetrics.height.toFixed(1)}px`);

  await screenshot(page, '01-table.png');

  console.log('\nФильтры');
  await page.locator('.flag-chip[data-flag="guide"]').click();
  check('фильтр «Проводник» оставляет 20 записей без отметки', (await page.locator('#tableBody tr').count()) === 20);
  check('в отфильтрованных записях нет отметки «Проводник»', (await page.locator('#tableBody .flag-toggle[data-flag="guide"][aria-pressed="true"]').count()) === 0);
  check('активный фильтр подсвечен', (await page.locator('.flag-chip[data-flag="guide"]').getAttribute('aria-pressed')) === 'true');
  await screenshot(page, '02-filters.png');
  await page.locator('#dateFilter').selectOption('2026-03-31');
  check('фильтр по дате оставляет 10 записей', (await page.locator('#tableBody tr').count()) === 10);
  await page.locator('.flag-chip[data-flag="monad"]').click();
  check('отметки и дата складываются по «И»', (await page.locator('#tableBody tr').count()) === 1);
  await page.locator('.flag-chip[data-flag="monad"]').click();
  await page.locator('.flag-chip[data-flag="guide"]').click();
  await page.locator('#generateBtn').click();
  check('в диалог попадают только отфильтрованные записи', (await page.locator('#selectMeta').innerText()).includes('10 из 10'));
  await page.locator('#generateModal .sheet-head [data-close]').click();
  await page.locator('#searchInput').fill('финанс');
  check('поиск по наименованию', (await page.locator('#tableBody tr').count()) === 1);
  await page.locator('#searchClear').click();
  await page.locator('#dateFilter').selectOption('');
  check('фильтры сбрасываются', (await page.locator('#tableBody tr').count()) === 38);

  console.log('\nРедактирование');
  await page.locator('#tableBody tr', { hasText: 'Кундалини' }).click();
  await page.waitForSelector('#rowModal.open');
  check('клик по записи открывает редактирование', (await page.locator('#rowModalTitle').innerText()) === 'Редактирование');
  check('в форме два поля кода', (await page.locator('#codeFields .code-field').count()) === 2);
  check('дата подставлена', (await page.locator('#rowDate').inputValue()) === '2026-03-14');
  await screenshot(page, '03-editor.png');
  await page.locator('#rowModal .sheet-head [data-close]').click();

  console.log('\nФормирование и результат');
  await page.locator('#generateBtn').click();
  await page.waitForSelector('#generateModal.open');
  check('ИОФ по умолчанию', (await page.locator('#genIof').inputValue()) === 'Владимир Владимирович Кравченко');
  check('ДР по умолчанию', (await page.locator('#genDr').inputValue()) === '04111978');
  check('место по умолчанию', (await page.locator('#genPlace').inputValue()) === 'Ленинградская область Мурино');
  check('все записи отмечены', (await page.locator('.select-item[aria-pressed="true"]').count()) === 38);
  const genLayout = await page.evaluate(() => {
    const sheet = document.querySelector('#generateModal .sheet').getBoundingClientRect();
    const list = document.querySelector('#selectList').getBoundingClientRect();
    return {
      sheetShare: sheet.height / window.innerHeight,
      listHeight: list.height,
      listFont: parseFloat(getComputedStyle(document.querySelector('.select-name')).fontSize),
      tableFont: parseFloat(getComputedStyle(document.querySelector('.name-cell')).fontSize),
    };
  });
  check('экран формирования занимает почти всю высоту', genLayout.sheetShare > 0.9);
  check('список кодов выше 300 px', genLayout.listHeight > 300);
  check('шрифты в формировании крупнее таблицы', genLayout.listFont > genLayout.tableFont);
  await screenshot(page, '04-generate.png');
  await page.locator('#selectNoneBtn').click();
  await page.locator('.select-item').nth(0).click();
  await page.locator('.select-item').nth(1).click();
  check('счётчик выбора обновляется', (await page.locator('#selectMeta').innerText()).includes('2 из 38'));
  await page.locator('#genPlace').fill('Московская область Одинцовский район г. Одинцово');
  await page.locator('#genPlace').press('Escape');
  await page.locator('#generateForm button[type="submit"]').click();
  await page.waitForSelector('#resultModal.open');
  const resultText = await page.locator('#resultText').innerText();
  const expected = [
    'Владимир Владимирович Кравченко',
    '04111978',
    'Московская область',
    'Одинцовский район',
    'г. Одинцово',
    '955 531 144',
    'Владимир Владимирович Кравченко',
    '04111978',
    'Московская область',
    'Одинцовский район',
    'г. Одинцово',
    '019 910 581',
    '449 095 936',
  ].join('\n');
  check('итоговый текст соответствует правилам', resultText.replace(/\n$/, '') === expected, `строк: ${resultText.trim().split('\n').length}`);
  check('перенос после «область» и «район»', resultText.includes('Московская область\nОдинцовский район\nг. Одинцово'));
  check('двойной код на отдельных строках', resultText.includes('г. Одинцово\n019 910 581\n449 095 936'));
  await screenshot(page, '05-result.png');

  await page.evaluate(() => {
    window.__copied = '';
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async (text) => { window.__copied = text; } },
    });
  });
  await page.locator('#copyBtn').click();
  await page.waitForFunction(() => document.querySelector('#copyBtn').textContent.includes('Скопировано'));
  check('кнопка «Скопировать» копирует весь текст', (await page.evaluate(() => window.__copied)) === `${expected}\n`);
  check('кнопка подтверждает копирование', (await page.locator('#copyBtn').innerText()).includes('Скопировано'));
  await page.locator('#resultModal .sheet-head [data-close]').click();

  console.log('\nНастройки, экспорт и импорт');
  await page.locator('#settingsBtn').click();
  check('страница настроек открылась', await page.locator('#settingsScreen').isVisible());
  check('ИОФ сохранился после формирования', (await page.locator('#defaultIof').inputValue()) === 'Владимир Владимирович Кравченко');
  const places = await page.locator('#placesList input').evaluateAll((nodes) => nodes.map((n) => n.value));
  check('новое место сохранено в список', places.includes('Московская область Одинцовский район г. Одинцово'), places.join(' | '));
  await screenshot(page, '06-settings.png');

  const downloadPromise = page.waitForEvent('download');
  await page.locator('#exportBtn').click();
  const download = await downloadPromise;
  const exportPath = path.join(TMP, 'export.json');
  await download.saveAs(exportPath);
  const exported = JSON.parse(await readFile(exportPath, 'utf8'));
  check('экспорт содержит 38 записей', exported.rows.length === 38);
  check('экспорт содержит настройки и места', exported.settings.places.includes('Ленинградская область Мурино'));

  const importPath = path.join(TMP, 'import.json');
  await writeFile(importPath, JSON.stringify({
    rows: [{ name: 'Импортированный код', codes: ['111 222 333'], funnel: true, guide: false, monad: true, date: '2026-09-01' }],
    settings: { iof: 'Иван Иванович', dr: '01011990', places: ['Тверь'] },
  }, null, 2));
  await page.locator('#importFile').setInputFiles(importPath);
  await page.waitForSelector('#confirmModal.open');
  await page.locator('#confirmOk').click();
  await page.locator('#confirmModal').waitFor({ state: 'hidden' });
  await page.waitForFunction(() => document.querySelectorAll('#tableBody tr').length === 1);
  check('импорт заменил записи', (await page.locator('#tableBody tr').count()) === 1);
  check('импорт применил настройки', (await page.locator('#defaultIof').inputValue()) === 'Иван Иванович');

  console.log('\nДобавление, сохранение и удаление');
  await page.locator('#settingsBack').click();
  await page.locator('#addBtn').click();
  await page.waitForSelector('#rowModal.open');
  await page.locator('#rowName').fill('Новая запись для теста');
  await page.locator('#codeFields .code-field input').first().fill('987654321');
  await page.locator('#addCodeBtn').click();
  await page.waitForFunction(() => document.querySelectorAll('#codeFields .code-field input').length === 2);
  await page.locator('#codeFields .code-field input').nth(1).fill('123123123');
  await page.locator('#rowDate').fill('2026-12-31');
  await page.locator('#rowFlags .flag-pill[data-flag="funnel"]').click();
  await page.locator('#rowFlags .flag-pill[data-flag="monad"]').click();
  const codesBeforeSave = await page.locator('#codeFields .code-field input').evaluateAll((nodes) => nodes.map((node) => node.value));
  check('оба кода заполнены до сохранения', codesBeforeSave.join('|') === '987 654 321|123 123 123');
  await page.locator('#rowForm button[type="submit"]').click();
  await page.locator('#rowModal').waitFor({ state: 'hidden' });
  check('запись добавлена', (await page.locator('#tableBody tr').count()) === 2);
  const addedRow = page.locator('#tableBody tr', { hasText: 'Новая запись для теста' });
  check('код в добавленной записи отформатирован', (await addedRow.locator('.code-line').nth(1).innerText()) === '123 123 123');

  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('#tableBody tr');
  check('данные сохраняются после перезагрузки', (await page.locator('#tableBody tr').count()) === 2);
  check('настройки сохраняются после перезагрузки', await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem('codeTable.v1'));
    return state.settings.iof === 'Иван Иванович' && state.rows.length === 2;
  }));

  await page.locator('#tableBody tr', { hasText: 'Новая запись для теста' }).locator('.delete-btn').click();
  await page.locator('#confirmOk').click();
  await page.waitForTimeout(120);
  check('удаление через корзину работает', (await page.locator('#tableBody tr').count()) === 1);

  await page.locator('#settingsBtn').click();
  await page.locator('#resetBtn').click();
  await page.locator('#confirmOk').click();
  await page.waitForTimeout(120);
  check('сброс к образцу возвращает 38 записей', (await page.locator('#tableBody tr').count()) === 38);
  await page.locator('#settingsBack').click();

  console.log('\nМобильная ширина 360 px');
  await page.setViewportSize({ width: 360, height: 740 });
  await page.waitForTimeout(250);
  const narrow = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth - window.innerWidth,
    table: document.querySelector('#tableScroll').scrollWidth - document.querySelector('#tableScroll').clientWidth,
    generateVisible: document.querySelector('#generateBtn').getBoundingClientRect().width > 120,
    bottom: document.querySelector('.bottombar').getBoundingClientRect().bottom,
    dateSameRow: [...document.querySelectorAll('.flag-chip')].every((node) => Math.abs(node.getBoundingClientRect().top - document.querySelector('.date-filter').getBoundingClientRect().top) < 2),
    dateRight: document.querySelector('.date-filter').getBoundingClientRect().right,
  }));
  check('на 360 px нет горизонтального переполнения', narrow.overflow <= 1 && narrow.table <= 1, `doc=${narrow.overflow}, table=${narrow.table}`);
  check('кнопка формирования помещается', narrow.generateVisible);
  check('на 360 px фильтр дат остаётся в одной строке', narrow.dateSameRow && narrow.dateRight <= 360);
  await screenshot(page, '07-mobile-360.png');

  console.log('\nЗаставка');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${base}/?splash=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1600);
  check('заставка показана', await page.locator('#splash').isVisible());
  await screenshot(page, '08-splash.png');
  await page.waitForTimeout(4100);
  check('заставка исчезает через 5 секунд', (await page.locator('#splash').count()) === 0);

  check('нет ошибок JavaScript', consoleErrors.length === 0, consoleErrors.join(' | ').slice(0, 300));
} catch (error) {
  record('непредвиденная ошибка тестов', false, error.stack);
} finally {
  await browser.close();
  server.close();
}

const failed = results.filter((item) => !item.ok);
const report = [
  '# Отчёт интерфейсных тестов',
  '',
  `Дата: ${new Date().toISOString()}`,
  '',
  `Всего проверок: **${results.length}**, успешно: **${results.length - failed.length}**, ошибок: **${failed.length}**`,
  '',
  ...results.map((item) => `- ${item.ok ? '✅' : '❌'} ${item.name}${item.details ? ` — ${item.details}` : ''}`),
  '',
].join('\n');
await writeFile(path.resolve(HERE, '..', 'docs', 'test-report.md'), report);

console.log(`\nИтого: ${results.length - failed.length}/${results.length} успешно`);
if (failed.length) process.exit(1);
