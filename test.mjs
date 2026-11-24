import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8')
const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1]
assert.ok(script, 'inline script is present')
new vm.Script(script)

const testScript = script.replace('selectDate(calendarDate(new Date()));', `globalThis.app={
  MENU, RECIPES, SHOPPING, selectDate, selectPlanDay, saveDay, currentState
};`)

const fakeFoodJournalId = 'mock-food-journal-abcdefghijkl'
const defaultJournalHash = '#journal=' + fakeFoodJournalId

function setup({ storage = new Map(), hash = defaultJournalHash, oauthError, httpFail, existing, failAfterAppend } = {}) {
  const requests = []
  const journal = { exists: Boolean(existing), headers: [], rows: [] }
  const elements = new Map()
  function element() {
    return {
      textContent: '',
      classList: { add() {}, remove() {} },
      addEventListener() {},
      setAttribute() {},
      appendChild() {},
      querySelectorAll() { return [] },
    }
  }
  const google = {
    accounts: {
      oauth2: {
        initTokenClient({ callback, error_callback }) {
          return {
            requestAccessToken() {
              if (oauthError) error_callback({ type: oauthError })
              else callback({ access_token: 'mock-token', expires_in: 3600 })
            },
          }
        },
      },
    },
  }

  function response(body, status = 200) {
    return { ok: status >= 200 && status < 300, status, json: async () => body }
  }
  async function fetch(url, options) {
    assert.equal(options.headers.Authorization, 'Bearer mock-token')
    const method = options.method ?? 'GET'
    const path = decodeURIComponent(url)
    assert.ok(path.startsWith('https://sheets.googleapis.com/v4/spreadsheets/' + fakeFoodJournalId))
    const body = options.body ? JSON.parse(options.body) : undefined
    requests.push({ path, method, body })
    if (httpFail) return response({}, httpFail)
    if (path.includes('?fields=')) {
      return response({ sheets: journal.exists ? [{ properties: { title: 'Питание' } }] : [] })
    }
    if (path.endsWith(':batchUpdate')) {
      const properties = body.requests[0].addSheet.properties
      assert.equal(properties.title, 'Питание')
      assert.deepEqual(properties.gridProperties, { rowCount: 1000, columnCount: 9 })
      assert.equal(properties.rowCount, undefined)
      assert.equal(properties.columnCount, undefined)
      journal.exists = true
      return response({})
    }
    assert.ok(journal.exists, 'worksheet already exists')
    if (path.endsWith('!A1:I1')) return response({ values: [journal.headers] })
    if (path.endsWith('!A1:I1?valueInputOption=RAW')) {
      assert.equal(method, 'PUT')
      assert.equal(body.values[0].length, 9)
      journal.headers = body.values[0]
      return response({})
    }
    if (path.endsWith('!A2:A?valueRenderOption=UNFORMATTED_VALUE')) {
      return response({ values: journal.rows.map(([date]) => [date]) })
    }
    assert.match(path, /!A:I:append\?valueInputOption=RAW&insertDataOption=INSERT_ROWS$/)
    assert.equal(method, 'POST')
    assert.equal(body.values.length, 4)
    assert.ok(body.values.every(row => row.length === 9))
    journal.rows.push(...body.values)
    if (failAfterAppend) throw new TypeError('Connection reset after save')
    return response({ updates: { updatedRows: body.values.length } })
  }

  const sandbox = {
    document: {
      getElementById(id) {
        if (!elements.has(id)) elements.set(id, element())
        return elements.get(id)
      },
      createElement: element,
    },
    localStorage: {
      getItem(key) { return storage.get(key) ?? null },
      setItem(key, value) { storage.set(key, value) },
    },
    navigator: { locks: { async request(_name, write) { await write() } } },
    window: { google, location: { hash } }, google, fetch, AbortController, URLSearchParams,
    setTimeout() { return 0 },
    clearTimeout() {},
  }
  vm.runInNewContext(testScript, sandbox)
  return { app: sandbox.app, requests, journal, elements, storage }
}

const { app: { MENU, RECIPES, SHOPPING } } = setup()
assert.equal(MENU.length, 14)
assert.equal(SHOPPING.length, 14)
for (const [index, day] of MENU.entries()) {
  assert.equal(day.meals.length, 4)
  const totals = day.meals.reduce((sum, meal) => ({ kcal: sum.kcal + meal.kcal, protein: sum.protein + meal.protein }), { kcal: 0, protein: 0 })
  assert.ok(totals.kcal >= 2100 && totals.kcal <= 2250, `day ${index + 1}: calories are in range`)
  assert.ok(totals.protein >= 160, `day ${index + 1}: protein is at least 160 g`)
  for (const meal of day.meals) {
    assert.ok(RECIPES[meal.recipe], `${meal.dish}: recipe exists`)
    assert.ok(meal.portion.length && meal.kcal > 0 && meal.protein > 0)
  }
  const lunch = day.meals[1]
  const dinner = MENU[(index + 13) % 14].meals[3]
  assert.deepEqual({ ...lunch, name: dinner.name }, { ...dinner }, `day ${index + 1}: dinner and next lunch are the same portion`)
  assert.ok(SHOPPING[index].buy.length && SHOPPING[index].use.length)
}

const included = new Set(MENU.flatMap(day => day.meals.map(meal => meal.recipe)))
const uploadedRecipes = [
  'savoryWaffles', 'poppyPancakes', 'funchose', 'syrniki', 'omelet',
  'chocolateWaffles', 'chickenPatties', 'barrel', 'meatballsMash',
  'lavashBreakfast', 'shawarma', 'chickenSkewers', 'sausageOmelet', 'choppedCutlets',
]
for (const recipe of uploadedRecipes) assert.ok(included.has(recipe), `uploaded recipe ${recipe} is in the plan`)
assert.equal(MENU[6].meals[0].recipe, 'tunaAvocado')
assert.doesNotMatch(JSON.stringify(MENU), /лосос|треск|кревет|кильк|наваг|тилапи/i)
assert.ok(!RECIPES.omelet.img)
assert.equal(MENU[5].meals[1].recipe, 'shawarma')
for (const index of [1, 3, 8, 10]) assert.notEqual(MENU[index].meals[1].recipe, 'shawarma')
assert.equal(MENU[1].meals[1].recipe, 'chickenRice')
assert.deepEqual(Array.from(MENU[1].meals[1].portion), ['грудка готовая 150 г', 'рис готовый 170 г', 'брокколи 150 г'])
assert.match(SHOPPING[0].buy.join(' '), /Филе 900 г.*рис 540 г.*340 г на гарнир, 200 г на два замеса.*брокколи 300 г/)
assert.match(SHOPPING[1].use.join(' '), /400 г филе и 100 г готового риса/)
assert.match(SHOPPING[8].use.join(' '), /400 г.*100 г готового риса/)
assert.doesNotMatch(SHOPPING[1].buy.join(' '), /курин.*грудк/i)
assert.match(SHOPPING[4].left.join(' '), /450 г.*400 г.*50 г/)
assert.match(SHOPPING[13].use.join(' '), /150 г.*100 г.*100 г.*50 г/)
assert.match(RECIPES.chickenSkewers.method, /8 часов.*200 °C/)

const day = '2026-11-23'
const next = '2026-11-24'
const key = 'menu:' + day
const draft = { days: { 0: { done: [true, false, false, true], comment: '=1+1', googleSaved: false } } }

const disconnected = setup({ hash: '#journal=invalid', storage: new Map([[key, JSON.stringify(draft)]]) })
disconnected.app.selectDate(day)
assert.equal(disconnected.elements.get('saveDay').disabled, true)
assert.equal(disconnected.elements.get('comment').disabled, false)
await disconnected.app.saveDay()
assert.equal(disconnected.requests.length, 0)

const first = setup({ storage: new Map([[key, JSON.stringify(draft)]]) })
first.app.selectDate(day)
assert.equal(first.app.currentState().comment, '=1+1', 'saved draft from the published version is restored')
const foodJournalUrl = 'https://docs.google.com/spreadsheets/d/' + fakeFoodJournalId + '/edit'
assert.equal(first.elements.get('journalLink').href, foodJournalUrl)
assert.equal(first.storage.get('menu:food-journal'), fakeFoodJournalId)
const reopened = setup({ storage: first.storage, hash: '' })
reopened.app.selectDate(day)
assert.equal(reopened.elements.get('journalLink').href, foodJournalUrl, 'plain menu remembers the first linked journal')
const anotherLink = setup({ storage: first.storage, hash: '#journal=another-journal-abcdefghijkl' })
assert.equal(anotherLink.elements.get('journalLink').href, foodJournalUrl, 'another link cannot replace the saved journal')
const write = first.app.saveDay()
first.app.selectPlanDay(1)
assert.equal(first.elements.get('journalDate').value, next, 'selecting Tuesday advances the date')
await write
assert.equal(first.app.currentState().googleSaved, false, 'navigating during sync does not mark the next day saved')
assert.equal(JSON.parse(first.storage.get(key)).days[0].googleSaved, true)
assert.deepEqual(first.requests.map(request => request.method), ['GET', 'POST', 'GET', 'PUT', 'GET', 'POST'])
assert.equal(first.journal.rows.length, 4)
assert.ok(first.journal.rows.every(row => row[0] === day && row[7] === '=1+1'))
assert.equal(first.journal.rows[3][3], 'Куриная грудка с рисом и брокколи')
assert.equal(first.journal.rows[3][6], 'Съедено')

const retry = setup({ storage: new Map([[key, JSON.stringify(draft)]]), failAfterAppend: true })
retry.app.selectDate(day)
await retry.app.saveDay()
assert.equal(retry.app.currentState().googleSaved, false, 'network error leaves the draft editable')
await retry.app.saveDay()
assert.equal(retry.app.currentState().googleSaved, true)
assert.equal(retry.requests.filter(request => request.path.includes(':append')).length, 1, 'retry does not duplicate rows')

const legacy = setup({ storage: new Map([[key, JSON.stringify(draft)]]), existing: true })
legacy.journal.headers = first.journal.headers
const serialDate = (Date.parse(day) - Date.UTC(1899, 11, 30)) / 86400000
legacy.journal.rows = Array.from({ length: 4 }, () => [serialDate])
legacy.app.selectDate(day)
await legacy.app.saveDay()
assert.equal(legacy.app.currentState().googleSaved, true)
assert.ok(!legacy.requests.some(request => request.path.includes(':append')))

const popup = setup({ storage: new Map([[key, JSON.stringify(draft)]]), oauthError: 'popup_closed' })
popup.app.selectDate(day)
await popup.app.saveDay()
assert.match(popup.elements.get('syncState').textContent, /окно входа Google закрыто/i)
assert.equal(popup.app.currentState().comment, '=1+1')
assert.equal(popup.requests.length, 0)

const noPermission = setup({ storage: new Map([[key, JSON.stringify(draft)]]), httpFail: 403 })
noPermission.app.selectDate(day)
await noPermission.app.saveDay()
assert.match(noPermission.elements.get('syncState').textContent, /нет доступа на запись/i)
assert.equal(noPermission.app.currentState().googleSaved, false)

console.log('OK: 14 дней, 14 загруженных рецептов, завтрак с тунцом, 14 переходов ужин → обед, первое сохранение и повтор Google Sheets')
