import {
  APP_VERSION,
  DEFAULT_SETTINGS,
  FLAGS,
  buildText,
  digitsOf,
  exportJSON,
  filterRows,
  formatCode,
  formatDateRu,
  formatPlace,
  makeId,
  parseImport,
  placeSuggestions,
  sanitizeRow,
  sanitizeSettings,
  summarize,
  todayISO,
  uniqueDates,
  wordCount,
} from './core.js';
import { SAMPLE_ROWS } from './data.js';

const STORAGE_KEY = 'codeTable.v1';
const MAX_CODES = 4;

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const bridge = window.CodeTableBridge || null;

const state = {
  data: loadState(),
  filters: { query: '', flags: [], date: '' },
  editingId: null,
  filterDefaults: false,
};

let filteredRows = [];
let generateRows = [];
const generateSelection = new Set();
let lastGeneratedText = '';
let confirmAction = null;
let toastTimer = 0;
let saveTimer = 0;
let modalReturnFocus = null;

const el = {
  tableScreen: $('#tableScreen'),
  settingsScreen: $('#settingsScreen'),
  bottombar: $('#bottombar'),
  tableBody: $('#tableBody'),
  tableScroll: $('#tableScroll'),
  emptyState: $('#emptyState'),
  emptyTitle: $('#emptyTitle'),
  emptyHint: $('#emptyHint'),
  summary: $('#summary'),
  filterCount: $('#filterCount'),
  filterDot: $('#filterDot'),
  searchInput: $('#searchInput'),
  searchClear: $('#searchClear'),
  dateFilter: $('#dateFilter'),
  flagFilters: $('#flagFilters'),
  generateBtn: $('#generateBtn'),
  settingsBtn: $('#settingsBtn'),
  settingsBack: $('#settingsBack'),
  rowModal: $('#rowModal'),
  rowForm: $('#rowForm'),
  rowModalTitle: $('#rowModalTitle'),
  rowName: $('#rowName'),
  rowDate: $('#rowDate'),
  rowFlags: $('#rowFlags'),
  codeFields: $('#codeFields'),
  addCodeBtn: $('#addCodeBtn'),
  rowError: $('#rowError'),
  generateModal: $('#generateModal'),
  generateForm: $('#generateForm'),
  genIof: $('#genIof'),
  genDr: $('#genDr'),
  genPlace: $('#genPlace'),
  placeCombo: $('#placeCombo'),
  placeList: $('#placeList'),
  placeToggle: $('#placeToggle'),
  selectList: $('#selectList'),
  selectMeta: $('#selectMeta'),
  generateError: $('#generateError'),
  resultModal: $('#resultModal'),
  resultText: $('#resultText'),
  resultMeta: $('#resultMeta'),
  copyBtn: $('#copyBtn'),
  confirmModal: $('#confirmModal'),
  confirmTitle: $('#confirmTitle'),
  confirmText: $('#confirmText'),
  confirmOk: $('#confirmOk'),
  confirmIcon: $('#confirmIcon'),
  toast: $('#toast'),
  splash: $('#splash'),
  exportBtn: $('#exportBtn'),
  importBtn: $('#importBtn'),
  importFile: $('#importFile'),
  defaultIof: $('#defaultIof'),
  defaultDr: $('#defaultDr'),
  defaultsHint: $('#defaultsHint'),
  placesList: $('#placesList'),
  newPlaceInput: $('#newPlaceInput'),
  addPlaceBtn: $('#addPlaceBtn'),
  resetBtn: $('#resetBtn'),
  dataStats: $('#dataStats'),
  appVersion: $('#appVersion'),
};

/* ============================ Состояние ============================ */

function defaultState() {
  return {
    version: APP_VERSION,
    rows: SAMPLE_ROWS.map((row) => sanitizeRow({ ...row, id: makeId(), codes: [...row.codes] })),
    settings: sanitizeSettings(DEFAULT_SETTINGS),
  };
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.rows)) {
        return {
          version: APP_VERSION,
          rows: parsed.rows.map(sanitizeRow).filter(Boolean),
          settings: sanitizeSettings(parsed.settings),
        };
      }
    }
  } catch (_) {
    // повреждённое хранилище заменяем образцом
  }
  return defaultState();
}

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.data));
  } catch (_) {
    toast('Не удалось сохранить данные на устройстве');
  }
}

function persistSoon() {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(persist, 180);
}

function hasActiveFilters() {
  return Boolean(state.filters.query || state.filters.flags.length || state.filters.date);
}

/* ============================ Утилиты UI ============================ */

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[ch]));
}

function icon(name, cls = '') {
  return `<svg class="${cls}" aria-hidden="true"><use href="#i-${name}"></use></svg>`;
}

function plural(n, one, few, many) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

function toast(message) {
  el.toast.textContent = message;
  el.toast.classList.add('show');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.toast.classList.remove('show'), 2300);
}

function setError(node, message) {
  if (!message) {
    node.hidden = true;
    node.textContent = '';
    return;
  }
  node.hidden = false;
  node.textContent = message;
}

function openModal(id) {
  const modal = document.getElementById(id);
  if (!modal) return;
  modalReturnFocus = document.activeElement;
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
  const focusTarget = modal.querySelector('input:not([type="hidden"]), button.btn-primary, button');
  // Фокус ставим сразу: отложенный focus мог перехватить ввод, если пользователь
  // успевал коснуться поля в первые ~100 мс после открытия листа.
  if (focusTarget) focusTarget.focus({ preventScroll: true });
}

function closeModal(id) {
  const modal = document.getElementById(id);
  if (!modal) return;
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
  if (modalReturnFocus && typeof modalReturnFocus.focus === 'function') {
    try { modalReturnFocus.focus({ preventScroll: true }); } catch (_) { /* noop */ }
  }
}

function anyModalOpen() {
  return $$('.modal.open').length > 0;
}

function closeTopModal() {
  const open = $$('.modal.open');
  if (!open.length) return false;
  closeModal(open[open.length - 1].id);
  return true;
}

function askConfirm({ title, text, okText = 'Удалить', danger = true, iconName = 'trash', onOk }) {
  el.confirmTitle.textContent = title;
  el.confirmText.textContent = text;
  el.confirmOk.textContent = okText;
  el.confirmOk.className = danger ? 'btn btn-danger' : 'btn btn-primary';
  el.confirmIcon.innerHTML = icon(iconName);
  el.confirmIcon.style.color = danger ? 'var(--danger)' : 'var(--gold)';
  el.confirmIcon.style.background = danger ? 'var(--rose-soft)' : 'var(--gold-soft)';
  confirmAction = onOk;
  openModal('confirmModal');
}

/* ============================ Фильтры ============================ */

function renderFlagFilters() {
  el.flagFilters.innerHTML = FLAGS.map((flag) => `
    <button class="flag-chip" type="button" data-flag="${flag.key}" aria-pressed="${state.filters.flags.includes(flag.key)}" aria-label="${flag.hint}" title="${flag.hint}">
      <span class="chip-box">${icon('check')}</span>
      <span>${flag.label}</span>
    </button>
  `).join('');
}

function renderDateFilter() {
  const dates = uniqueDates(state.data.rows);
  if (state.filters.date && !dates.includes(state.filters.date)) state.filters.date = '';
  el.dateFilter.innerHTML = `<option value="">Даты</option>${dates.map((date) => `
    <option value="${date}">${formatDateRu(date)}</option>
  `).join('')}`;
  el.dateFilter.value = state.filters.date;
}

function renderSummary() {
  const stats = summarize(state.data.rows);
  if (hasActiveFilters()) {
    el.summary.innerHTML = `Показано <b>${filteredRows.length}</b> из ${stats.count} · ${stats.codes} ${plural(stats.codes, 'код', 'кода', 'кодов')}`;
  } else {
    el.summary.innerHTML = `<b>${stats.count}</b> ${plural(stats.count, 'запись', 'записи', 'записей')} · ${stats.dates} ${plural(stats.dates, 'дата', 'даты', 'дат')} · ${stats.codes} ${plural(stats.codes, 'код', 'кода', 'кодов')}`;
  }
  el.filterCount.textContent = `${filteredRows.length} ${plural(filteredRows.length, 'запись', 'записи', 'записей')}`;
  el.filterDot.style.opacity = hasActiveFilters() ? '1' : '0.35';
}

function applyFilters() {
  filteredRows = filterRows(state.data.rows, state.filters);
  renderSummary();
  renderTable();
  el.generateBtn.disabled = filteredRows.length === 0;
  el.searchClear.hidden = !state.filters.query;
}

/* ============================ Таблица ============================ */

function renderTable() {
  const scrollTop = el.tableScroll.scrollTop;
  el.tableBody.innerHTML = filteredRows.map((row) => {
    const codes = row.codes && row.codes.length
      ? row.codes.map((code) => `<div class="code-line">${esc(formatCode(code))}</div>`).join('')
      : '<div class="code-line empty">—</div>';
    const flags = FLAGS.map((flag) => `
      <td class="flag-cell">
        <button class="flag-toggle" type="button" data-action="flag" data-flag="${flag.key}" aria-pressed="${Boolean(row[flag.key])}" aria-label="${flag.label}: ${row[flag.key] ? 'отмечено' : 'не отмечено'}" title="${flag.label}"></button>
      </td>
    `).join('');
    return `
      <tr data-id="${esc(row.id)}" tabindex="0" aria-label="${esc(row.name)}. Нажмите, чтобы изменить">
        <td><div class="name-cell">${esc(row.name)}</div></td>
        <td class="code-cell">${codes}</td>
        ${flags}
        <td class="date-cell">${row.date ? formatDateRu(row.date) : '—'}</td>
        <td class="action-cell">
          <button class="delete-btn" type="button" data-action="delete" aria-label="Удалить ${esc(row.name)}" title="Удалить">${icon('trash')}</button>
        </td>
      </tr>
    `;
  }).join('');

  const isEmpty = filteredRows.length === 0;
  el.emptyState.hidden = !isEmpty;
  if (isEmpty) {
    const noRows = state.data.rows.length === 0;
    el.emptyTitle.textContent = noRows ? 'Пока нет кодов' : 'Ничего не найдено';
    el.emptyHint.textContent = noRows ? 'Добавьте первую запись — и она появится здесь' : 'Измените запрос или сбросьте фильтры';
  }
  el.tableScroll.scrollTop = scrollTop;
}

function findRow(id) {
  return state.data.rows.find((row) => row.id === id) || null;
}

function toggleFlag(id, flag) {
  const row = findRow(id);
  if (!row) return;
  row[flag] = !row[flag];
  persist();
  applyFilters();
}

function deleteRow(id) {
  const row = findRow(id);
  if (!row) return;
  askConfirm({
    title: 'Удалить запись?',
    text: `«${row.name}» и её коды будут удалены. Действие нельзя отменить.`,
    okText: 'Удалить',
    onOk: () => {
      state.data.rows = state.data.rows.filter((item) => item.id !== id);
      persist();
      renderDateFilter();
      applyFilters();
      renderDataStats();
      toast('Запись удалена');
    },
  });
}

/* ============================ Редактирование ============================ */

function createCodeField(value = '') {
  const wrap = document.createElement('div');
  wrap.className = 'code-field';
  const input = document.createElement('input');
  input.type = 'text';
  input.inputMode = 'numeric';
  input.autocomplete = 'off';
  input.maxLength = 11;
  input.placeholder = '123 456 789';
  input.value = formatCode(value);
  input.setAttribute('aria-label', 'Код из девяти цифр');
  input.addEventListener('input', () => {
    const formatted = formatCode(input.value);
    if (input.value !== formatted) input.value = formatted;
  });
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'code-remove';
  remove.setAttribute('aria-label', 'Убрать код');
  remove.innerHTML = icon('close');
  remove.addEventListener('click', () => {
    if ($$('.code-field', el.codeFields).length <= 1) {
      input.value = '';
      input.focus();
      return;
    }
    wrap.remove();
    updateCodeButtons();
  });
  wrap.append(input, remove);
  return wrap;
}

function updateCodeButtons() {
  const count = $$('.code-field', el.codeFields).length;
  el.addCodeBtn.hidden = count >= MAX_CODES;
  $$('.code-field', el.codeFields).forEach((field, index) => {
    const remove = $('.code-remove', field);
    remove.hidden = index === 0 && count === 1;
  });
}

function setCodeFields(values) {
  el.codeFields.innerHTML = '';
  const list = values && values.length ? values : [''];
  list.slice(0, MAX_CODES).forEach((value) => el.codeFields.append(createCodeField(value)));
  updateCodeButtons();
}

function renderFlagPills(row) {
  el.rowFlags.innerHTML = FLAGS.map((flag) => `
    <button class="flag-pill" type="button" data-flag="${flag.key}" aria-pressed="${Boolean(row[flag.key])}">
      <span class="pill-check">${icon('check')}</span>
      <span>${flag.label}</span>
    </button>
  `).join('');
}

function openRowEditor(row = null) {
  state.editingId = row ? row.id : null;
  el.rowModalTitle.textContent = row ? 'Редактирование' : 'Новая запись';
  el.rowName.value = row ? row.name : '';
  el.rowDate.value = row && row.date ? row.date : todayISO();
  setCodeFields(row ? row.codes : []);
  renderFlagPills(row || { funnel: false, guide: false, monad: false });
  setError(el.rowError, '');
  openModal('rowModal');
}

function submitRow(event) {
  event.preventDefault();
  const name = el.rowName.value.trim().replace(/\s+/g, ' ');
  const date = el.rowDate.value;
  const codeInputs = $$('.code-field input', el.codeFields);
  const codes = [];
  for (const input of codeInputs) {
    const raw = input.value.trim();
    if (!raw) continue;
    if (digitsOf(raw).length !== 9) {
      setError(el.rowError, 'В каждом коде должно быть ровно 9 цифр. Например: 123 456 789.');
      input.focus();
      return;
    }
    codes.push(formatCode(raw));
  }
  if (!name) {
    setError(el.rowError, 'Укажите наименование кода.');
    el.rowName.focus();
    return;
  }
  if (!codes.length) {
    setError(el.rowError, 'Добавьте хотя бы один код из девяти цифр.');
    const first = $('.code-field input', el.codeFields);
    if (first) first.focus();
    return;
  }
  if (!date) {
    setError(el.rowError, 'Укажите дату занятия.');
    el.rowDate.focus();
    return;
  }

  const flags = {};
  $$('.flag-pill[data-flag]', el.rowFlags).forEach((pill) => {
    flags[pill.dataset.flag] = pill.getAttribute('aria-pressed') === 'true';
  });

  if (state.editingId) {
    const row = findRow(state.editingId);
    if (row) Object.assign(row, { name, codes, date, ...flags });
    toast('Запись обновлена');
  } else {
    state.data.rows.push({ id: makeId(), name, codes, date, ...flags });
    toast('Запись добавлена');
  }
  persist();
  closeModal('rowModal');
  renderDateFilter();
  applyFilters();
  renderDataStats();
}

/* ============================ Формирование ============================ */

function selectedRows() {
  return generateRows.filter((row) => generateSelection.has(row.id));
}

function renderSelection() {
  const selected = selectedRows();
  el.selectMeta.textContent = generateRows.length
    ? `Выбрано ${selected.length} из ${generateRows.length}`
    : 'Нет записей для выбора';
  el.generateForm.querySelector('button[type="submit"]').disabled = selected.length === 0;

  if (!generateRows.length) {
    el.selectList.innerHTML = '<p class="combo-empty">Под текущие фильтры не попала ни одна запись.</p>';
    return;
  }
  el.selectList.innerHTML = generateRows.map((row) => {
    const pressed = generateSelection.has(row.id);
    const codes = (row.codes || []).map(formatCode).join(' · ');
    return `
      <button class="select-item" type="button" data-id="${esc(row.id)}" aria-pressed="${pressed}">
        <span class="select-check">${icon('check')}</span>
        <span class="select-main">
          <span class="select-name">${esc(row.name)}</span>
          <span class="select-codes">${esc(codes || 'без кода')}</span>
        </span>
      </button>
    `;
  }).join('');
}

function openGenerate() {
  filteredRows = filterRows(state.data.rows, state.filters);
  if (!filteredRows.length) {
    toast('В отфильтрованной таблице нет записей');
    return;
  }
  generateRows = filteredRows;
  generateSelection.clear();
  generateRows.forEach((row) => generateSelection.add(row.id));
  el.genIof.value = state.data.settings.iof;
  el.genDr.value = state.data.settings.dr;
  el.genPlace.value = state.data.settings.places[0] || '';
  setError(el.generateError, '');
  closePlaceList();
  renderSelection();
  openModal('generateModal');
  window.setTimeout(() => el.genIof.select(), 120);
}

function normalizePlaceValue(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ');
}

function rememberPlace(value) {
  const place = normalizePlaceValue(value);
  if (!place) return;
  const places = state.data.settings.places;
  if (!places.some((item) => item.toLocaleLowerCase('ru') === place.toLocaleLowerCase('ru'))) {
    places.unshift(place);
  }
}

function submitGenerate(event) {
  event.preventDefault();
  const rows = selectedRows();
  const iof = el.genIof.value.trim();
  const dr = el.genDr.value.trim();
  const place = normalizePlaceValue(el.genPlace.value);

  if (!iof) {
    setError(el.generateError, 'Укажите ИОФ.');
    el.genIof.focus();
    return;
  }
  if (!dr) {
    setError(el.generateError, 'Укажите ДР.');
    el.genDr.focus();
    return;
  }
  if (!place) {
    setError(el.generateError, 'Укажите место или выберите его из списка.');
    el.genPlace.focus();
    return;
  }
  if (!rows.length) {
    setError(el.generateError, 'Отметьте хотя бы один код.');
    return;
  }

  state.data.settings.iof = iof;
  state.data.settings.dr = dr;
  rememberPlace(place);
  persist();

  lastGeneratedText = buildText(rows, { iof, dr, place });
  el.resultText.textContent = lastGeneratedText;
  const lineCount = lastGeneratedText.replace(/\n$/, '').split('\n').length;
  el.resultMeta.textContent = `${rows.length} ${plural(rows.length, 'запись', 'записи', 'записей')} · ${lineCount} ${plural(lineCount, 'строка', 'строки', 'строк')}`;
  resetCopyButton();
  closeModal('generateModal');
  renderDataStats();
  openModal('resultModal');
  window.setTimeout(() => el.resultText.focus({ preventScroll: true }), 150);
}

/* ============================ Комбобокс места ============================ */

function closePlaceList() {
  el.placeList.hidden = true;
  el.placeCombo.classList.remove('open');
  el.genPlace.setAttribute('aria-expanded', 'false');
}

function choosePlace(value) {
  el.genPlace.value = normalizePlaceValue(value);
  closePlaceList();
  el.genPlace.focus();
}

function renderPlaceList() {
  const query = normalizePlaceValue(el.genPlace.value);
  const suggestions = placeSuggestions(state.data.settings.places, query);
  const exact = state.data.settings.places.some(
    (place) => place.toLocaleLowerCase('ru') === query.toLocaleLowerCase('ru'),
  );
  const items = [];
  if (query && !exact) {
    items.push(`
      <button class="combo-option" type="button" data-value="${esc(query)}" data-new="1">
        ${icon('plus')}<span><span class="combo-option-new">Добавить</span> «${esc(query)}»</span>
      </button>
    `);
  }
  for (const place of suggestions) {
    items.push(`<button class="combo-option" type="button" data-value="${esc(place)}">${icon('check')}<span>${esc(place)}</span></button>`);
  }
  el.placeList.innerHTML = items.length ? items.join('') : '<p class="combo-empty">Начните вводить новое место</p>';
  el.placeList.hidden = false;
  el.placeCombo.classList.add('open');
  el.genPlace.setAttribute('aria-expanded', 'true');
}

/* ============================ Результат и копирование ============================ */

function resetCopyButton() {
  el.copyBtn.innerHTML = `${icon('copy')}<span>Скопировать</span>`;
  el.copyBtn.disabled = false;
}

function legacyCopy(text) {
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.left = '-9999px';
  area.style.top = '0';
  document.body.append(area);
  area.select();
  area.setSelectionRange(0, text.length);
  let ok = false;
  try { ok = document.execCommand('copy'); } catch (_) { ok = false; }
  area.remove();
  return ok;
}

async function copyResult() {
  const text = lastGeneratedText;
  if (!text) return;
  let ok = false;
  if (bridge && typeof bridge.copyText === 'function') {
    try {
      bridge.copyText(text);
      ok = true;
    } catch (_) {
      ok = false;
    }
  }
  if (!ok && navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      ok = true;
    } catch (_) {
      ok = false;
    }
  }
  if (!ok) ok = legacyCopy(text);
  if (ok) {
    el.copyBtn.innerHTML = `${icon('check')}<span>Скопировано</span>`;
    toast(`Скопировано: ${lastGeneratedText.replace(/\n$/, '').split('\n').length} строк`);
    window.setTimeout(resetCopyButton, 2200);
  } else {
    toast('Не удалось скопировать. Выделите текст вручную.');
    el.resultText.focus();
  }
}

/* ============================ Настройки ============================ */

function showSettings() {
  el.tableScreen.hidden = true;
  el.settingsScreen.hidden = false;
  el.bottombar.hidden = true;
  renderSettings();
}

function showTable() {
  el.settingsScreen.hidden = true;
  el.tableScreen.hidden = false;
  el.bottombar.hidden = false;
  el.settingsBtn.focus({ preventScroll: true });
}

function renderSettings() {
  el.defaultIof.value = state.data.settings.iof;
  el.defaultDr.value = state.data.settings.dr;
  el.appVersion.textContent = APP_VERSION;
  renderPlaces();
  renderDataStats();
}

function renderDataStats() {
  if (!el.dataStats) return;
  const stats = summarize(state.data.rows);
  el.dataStats.innerHTML = `
    <span class="stat-chip"><b>${stats.count}</b> ${plural(stats.count, 'запись', 'записи', 'записей')}</span>
    <span class="stat-chip"><b>${stats.codes}</b> ${plural(stats.codes, 'код', 'кода', 'кодов')}</span>
    <span class="stat-chip"><b>${stats.dates}</b> ${plural(stats.dates, 'дата', 'даты', 'дат')}</span>
  `;
}

function renderPlaces() {
  const places = state.data.settings.places;
  el.placesList.innerHTML = places.map((place, index) => `
    <div class="place-row">
      <input type="text" value="${esc(place)}" data-index="${index}" aria-label="Место ${index + 1}" />
      <button class="place-remove" type="button" data-index="${index}" aria-label="Удалить место">${icon('trash')}</button>
    </div>
  `).join('') || '<p class="hint">Список пуст. Добавьте первое место ниже.</p>';
}

function addPlace() {
  const value = normalizePlaceValue(el.newPlaceInput.value);
  if (!value) {
    el.newPlaceInput.focus();
    return;
  }
  if (state.data.settings.places.some((place) => place.toLocaleLowerCase('ru') === value.toLocaleLowerCase('ru'))) {
    toast('Такое место уже есть в списке');
    el.newPlaceInput.select();
    return;
  }
  state.data.settings.places.push(value);
  el.newPlaceInput.value = '';
  persist();
  renderPlaces();
  toast('Место добавлено');
}

function exportData() {
  const json = exportJSON(state.data);
  const date = todayISO();
  const filename = `tablica-kodov-${date}.json`;
  if (bridge && typeof bridge.exportFile === 'function') {
    try {
      bridge.exportFile(filename, json);
      return;
    } catch (_) {
      // переходим к браузерному способу
    }
  }
  const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
  toast('Файл экспорта сохранён');
}

function handleImportText(text) {
  if (!text || !text.trim()) {
    toast('Файл пуст');
    return;
  }
  let parsed;
  try {
    parsed = parseImport(text);
  } catch (error) {
    toast(error.message || 'Не удалось прочитать файл');
    return;
  }
  askConfirm({
    title: 'Импортировать данные?',
    text: `В файле ${parsed.rows.length} ${plural(parsed.rows.length, 'запись', 'записи', 'записей')}. Текущие записи и настройки будут заменены.`,
    okText: 'Импортировать',
    danger: false,
    iconName: 'upload',
    onOk: () => {
      state.data.rows = parsed.rows;
      if (parsed.settings) state.data.settings = parsed.settings;
      persist();
      renderDateFilter();
      applyFilters();
      renderSettings();
      toast(`Импортировано: ${parsed.rows.length} ${plural(parsed.rows.length, 'запись', 'записи', 'записей')}`);
    },
  });
}

function pickImportFile() {
  if (bridge && typeof bridge.importFile === 'function') {
    try {
      bridge.importFile();
      return;
    } catch (_) {
      // переходим к браузерному способу
    }
  }
  el.importFile.value = '';
  el.importFile.click();
}

function resetToSample() {
  askConfirm({
    title: 'Сбросить к образцу?',
    text: 'Все текущие записи будут заменены 38 записями из образца. Значения по умолчанию и список мест сохранятся.',
    okText: 'Сбросить',
    onOk: () => {
      state.data.rows = SAMPLE_ROWS.map((row) => sanitizeRow({ ...row, id: makeId(), codes: [...row.codes] }));
      state.filters = { query: '', flags: [], date: '' };
      persist();
      renderFlagFilters();
      renderDateFilter();
      applyFilters();
      renderSettings();
      toast('Данные восстановлены из образца');
    },
  });
}

/* ============================ События ============================ */

function bindEvents() {
  el.searchInput.addEventListener('input', () => {
    state.filters.query = el.searchInput.value;
    applyFilters();
  });
  el.searchClear.addEventListener('click', () => {
    el.searchInput.value = '';
    state.filters.query = '';
    applyFilters();
    el.searchInput.focus();
  });

  el.flagFilters.addEventListener('click', (event) => {
    const chip = event.target.closest('.flag-chip');
    if (!chip) return;
    const flag = chip.dataset.flag;
    const index = state.filters.flags.indexOf(flag);
    if (index >= 0) state.filters.flags.splice(index, 1);
    else state.filters.flags.push(flag);
    chip.setAttribute('aria-pressed', String(index < 0));
    applyFilters();
  });

  el.dateFilter.addEventListener('change', () => {
    state.filters.date = el.dateFilter.value;
    applyFilters();
  });

  el.tableBody.addEventListener('click', (event) => {
    const flagBtn = event.target.closest('[data-action="flag"]');
    if (flagBtn) {
      event.stopPropagation();
      const tr = flagBtn.closest('tr');
      if (tr) toggleFlag(tr.dataset.id, flagBtn.dataset.flag);
      return;
    }
    const deleteBtn = event.target.closest('[data-action="delete"]');
    if (deleteBtn) {
      event.stopPropagation();
      const tr = deleteBtn.closest('tr');
      if (tr) deleteRow(tr.dataset.id);
      return;
    }
    const tr = event.target.closest('tr[data-id]');
    if (tr) {
      const row = findRow(tr.dataset.id);
      if (row) openRowEditor(row);
    }
  });

  el.tableBody.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    if (event.target.closest('button')) return;
    const tr = event.target.closest('tr[data-id]');
    if (!tr) return;
    event.preventDefault();
    const row = findRow(tr.dataset.id);
    if (row) openRowEditor(row);
  });

  $('#addBtn').addEventListener('click', () => openRowEditor());
  $('#addTopBtn').addEventListener('click', () => openRowEditor());
  el.generateBtn.addEventListener('click', openGenerate);
  el.settingsBtn.addEventListener('click', showSettings);
  el.settingsBack.addEventListener('click', showTable);

  el.addCodeBtn.addEventListener('click', () => {
    if ($$('.code-field', el.codeFields).length >= MAX_CODES) return;
    const field = createCodeField('');
    el.codeFields.append(field);
    updateCodeButtons();
    $('input', field).focus();
  });

  el.rowForm.addEventListener('submit', submitRow);
  el.rowFlags.addEventListener('click', (event) => {
    const pill = event.target.closest('.flag-pill');
    if (!pill) return;
    pill.setAttribute('aria-pressed', String(pill.getAttribute('aria-pressed') !== 'true'));
  });

  el.generateForm.addEventListener('submit', submitGenerate);
  el.genDr.addEventListener('input', () => {
    el.genDr.value = el.genDr.value.replace(/\D/g, '').slice(0, 8);
  });

  el.selectList.addEventListener('click', (event) => {
    const item = event.target.closest('.select-item');
    if (!item) return;
    const id = item.dataset.id;
    if (generateSelection.has(id)) generateSelection.delete(id);
    else generateSelection.add(id);
    item.setAttribute('aria-pressed', String(generateSelection.has(id)));
    renderSelectionMetaOnly();
  });

  $('#selectAllBtn').addEventListener('click', () => {
    generateRows.forEach((row) => generateSelection.add(row.id));
    renderSelection();
  });
  $('#selectNoneBtn').addEventListener('click', () => {
    generateSelection.clear();
    renderSelection();
  });

  el.copyBtn.addEventListener('click', copyResult);

  el.genPlace.addEventListener('input', () => {
    renderPlaceList();
  });
  el.genPlace.addEventListener('focus', () => {
    renderPlaceList();
  });
  el.genPlace.addEventListener('keydown', (event) => {
    const options = $$('.combo-option', el.placeList);
    if (!options.length) return;
    const activeIndex = options.findIndex((option) => option.classList.contains('active'));
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      options[Math.min(activeIndex + 1, options.length - 1)].classList.add('active');
      options.forEach((option, index) => {
        if (index !== Math.min(activeIndex + 1, options.length - 1)) option.classList.remove('active');
      });
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      const next = Math.max(activeIndex - 1, 0);
      options[next].classList.add('active');
      options.forEach((option, index) => {
        if (index !== next) option.classList.remove('active');
      });
    } else if (event.key === 'Enter' && activeIndex >= 0) {
      event.preventDefault();
      choosePlace(options[activeIndex].dataset.value);
    } else if (event.key === 'Escape') {
      if (!el.placeList.hidden) {
        event.stopPropagation();
        closePlaceList();
      }
    }
  });
  el.placeList.addEventListener('mousedown', (event) => event.preventDefault());
  el.placeList.addEventListener('click', (event) => {
    const option = event.target.closest('.combo-option');
    if (option) choosePlace(option.dataset.value);
  });
  el.placeToggle.addEventListener('click', () => {
    if (el.placeList.hidden) {
      el.genPlace.focus();
      renderPlaceList();
    } else {
      closePlaceList();
    }
  });
  document.addEventListener('click', (event) => {
    if (!el.placeCombo.contains(event.target)) closePlaceList();
  });

  document.addEventListener('click', (event) => {
    const closer = event.target.closest('[data-close]');
    if (closer) closeModal(closer.dataset.close);
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      if (anyModalOpen()) {
        closeTopModal();
      } else if (!el.settingsScreen.hidden) {
        showTable();
      }
    }
  });

  el.confirmOk.addEventListener('click', () => {
    const action = confirmAction;
    confirmAction = null;
    closeModal('confirmModal');
    if (action) window.setTimeout(action, 30);
  });

  el.exportBtn.addEventListener('click', exportData);
  el.importBtn.addEventListener('click', pickImportFile);
  el.importFile.addEventListener('change', async () => {
    const file = el.importFile.files && el.importFile.files[0];
    if (!file) return;
    try {
      handleImportText(await file.text());
    } catch (_) {
      toast('Не удалось прочитать файл');
    }
  });

  el.defaultIof.addEventListener('input', () => {
    state.data.settings.iof = el.defaultIof.value;
    el.defaultsHint.textContent = 'Сохранено';
    persistSoon();
    window.setTimeout(() => { el.defaultsHint.textContent = 'Изменения сохраняются автоматически'; }, 1200);
  });
  el.defaultDr.addEventListener('input', () => {
    el.defaultDr.value = el.defaultDr.value.replace(/\D/g, '').slice(0, 8);
    state.data.settings.dr = el.defaultDr.value;
    el.defaultsHint.textContent = 'Сохранено';
    persistSoon();
    window.setTimeout(() => { el.defaultsHint.textContent = 'Изменения сохраняются автоматически'; }, 1200);
  });

  el.placesList.addEventListener('input', (event) => {
    const input = event.target.closest('input[data-index]');
    if (!input) return;
    const index = Number(input.dataset.index);
    if (!Number.isInteger(index) || !state.data.settings.places[index]) return;
    state.data.settings.places[index] = input.value;
    persistSoon();
  });
  el.placesList.addEventListener('change', (event) => {
    const input = event.target.closest('input[data-index]');
    if (!input) return;
    const index = Number(input.dataset.index);
    const value = normalizePlaceValue(input.value);
    if (!value) {
      input.value = state.data.settings.places[index] || '';
      return;
    }
    state.data.settings.places[index] = value;
    input.value = value;
    persist();
  });
  el.placesList.addEventListener('click', (event) => {
    const remove = event.target.closest('.place-remove');
    if (!remove) return;
    if (state.data.settings.places.length <= 1) {
      toast('Должно остаться хотя бы одно место');
      return;
    }
    state.data.settings.places.splice(Number(remove.dataset.index), 1);
    persist();
    renderPlaces();
    toast('Место удалено');
  });
  el.addPlaceBtn.addEventListener('click', addPlace);
  el.newPlaceInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      addPlace();
    }
  });
  el.resetBtn.addEventListener('click', resetToSample);

  window.addEventListener('storage', (event) => {
    if (event.key !== STORAGE_KEY) return;
    state.data = loadState();
    renderDateFilter();
    applyFilters();
    if (!el.settingsScreen.hidden) renderSettings();
  });
}

function renderSelectionMetaOnly() {
  const selected = selectedRows();
  el.selectMeta.textContent = `Выбрано ${selected.length} из ${generateRows.length}`;
  el.generateForm.querySelector('button[type="submit"]').disabled = selected.length === 0;
  $$('.select-item', el.selectList).forEach((item) => {
    item.setAttribute('aria-pressed', String(generateSelection.has(item.dataset.id)));
  });
}

/* ============================ Мост Android ============================ */

window.__applySafeArea = (top = 0, right = 0, bottom = 0, left = 0) => {
  const style = document.documentElement.style;
  style.setProperty('--safe-top', `${Math.max(0, Number(top) || 0)}px`);
  style.setProperty('--safe-right', `${Math.max(0, Number(right) || 0)}px`);
  style.setProperty('--safe-bottom', `${Math.max(0, Number(bottom) || 0)}px`);
  style.setProperty('--safe-left', `${Math.max(0, Number(left) || 0)}px`);
};
window.__onImportText = handleImportText;
window.__onExportDone = (ok) => toast(ok ? 'Файл экспорта сохранён' : 'Не удалось сохранить файл');
window.__appBack = () => {
  if (anyModalOpen()) {
    closeTopModal();
    return true;
  }
  if (!el.settingsScreen.hidden) {
    showTable();
    return true;
  }
  return false;
};

/* ============================ Заставка и запуск ============================ */

function initSplash() {
  const params = new URLSearchParams(window.location.search);
  if (params.has('native')) {
    el.splash.remove();
    return;
  }
  const standalone = window.matchMedia('(display-mode: standalone)').matches
    || window.navigator.standalone === true;
  if (!standalone && !params.has('splash')) {
    el.splash.remove();
    return;
  }
  el.splash.hidden = false;
  window.setTimeout(() => {
    el.splash.style.transition = 'opacity 0.45s ease';
    el.splash.style.opacity = '0';
    window.setTimeout(() => el.splash.remove(), 500);
  }, 5000);
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  // В APK файлы уже лежат локально, service worker только риск устаревшего кэша.
  if (new URLSearchParams(window.location.search).has('native')) return;
  if (location.protocol !== 'http:' && location.protocol !== 'https:') return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => { /* офлайн-кэш не критичен */ });
  });
}

function init() {
  initSplash();
  el.appVersion.textContent = APP_VERSION;
  persist();
  renderFlagFilters();
  renderDateFilter();
  applyFilters();
  renderDataStats();
  bindEvents();
  registerServiceWorker();
  if (bridge && typeof bridge.ready === 'function') {
    try { bridge.ready(); } catch (_) { /* noop */ }
  }
}

init();
