import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8')
const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1]
assert.ok(script, 'inline script is present')
new Function(script)

const data = script.match(/var RECIPES=(\{[\s\S]*?\});\n\n  var WEEK=(\[[\s\S]*?\]);\n\n  var GOOGLE_CLIENT_ID=/)
assert.ok(data, 'menu data is readable')
const context = {}
vm.createContext(context)
vm.runInContext(`RECIPES=${data[1]};WEEK=${data[2]}`, context)

assert.equal(context.WEEK.length, 7)
for (const day of context.WEEK) {
  assert.equal(day.meals.length, 4, `${day.day}: four meals`)
  for (const meal of day.meals) {
    assert.ok(context.RECIPES[meal.recipe], `${meal.dish}: recipe exists`)
    assert.ok(meal.portion.length, `${meal.dish}: portion exists`)
    assert.ok(meal.kcal > 0 && meal.protein > 0, `${meal.dish}: macros exist`)
  }
}

const menuData = JSON.stringify(context.WEEK) + JSON.stringify(context.RECIPES)
assert.doesNotMatch(menuData, /рыб|лосос|тунец|треск|кревет|морепродукт/i)
for (const removed of ['Личный план', 'Нормальная еда на неделю', 'Белковая страховка', 'Почему не 2500']) {
  assert.ok(!html.includes(removed), `removed block is absent: ${removed}`)
}

assert.ok(html.includes('Рецепт и порция'))
assert.ok(html.includes('Синхронизировать день'))
assert.ok(html.includes('GOOGLE_SHEET_NAME="Питание"'))
assert.ok(html.includes('addSheet'))
assert.ok(html.includes('client.requestAccessToken({prompt:"select_account"})'))
assert.ok(html.includes('dayAlreadySaved'))

console.log('OK: 7 дней, 4 блюда, встроенные рецепты и Google-журнал проверены')
