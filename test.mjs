import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8')
const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1]
assert.ok(script, 'inline script is present')
new Function(script)

const data = script.match(/var RECIPES=(\{[\s\S]*?\});\n\n  var MENU=(\[[\s\S]*?\]);\n\n  var SHOPPING=(\[[\s\S]*?\]);\n\n  var GOOGLE_CLIENT_ID=/)
assert.ok(data, 'menu data is readable')
const context = {}
vm.createContext(context)
vm.runInContext(`RECIPES=${data[1]};MENU=${data[2]};SHOPPING=${data[3]}`, context)

assert.equal(context.MENU.length, 14)
assert.equal(context.SHOPPING.length, 14)
for (const [index, day] of context.MENU.entries()) {
  assert.equal(day.meals.length, 4, `${day.day}: four meals`)
  const totals = day.meals.reduce((sum, meal) => ({ kcal: sum.kcal + meal.kcal, protein: sum.protein + meal.protein }), { kcal: 0, protein: 0 })
  assert.ok(totals.kcal >= 2100 && totals.kcal <= 2250, `day ${index + 1}: calories are in range`)
  assert.ok(totals.protein >= 160, `day ${index + 1}: protein is at least 160 g`)
  for (const meal of day.meals) {
    assert.ok(context.RECIPES[meal.recipe], `${meal.dish}: recipe exists`)
    assert.ok(meal.portion.length, `${meal.dish}: portion exists`)
    assert.ok(meal.kcal > 0 && meal.protein > 0, `${meal.dish}: macros exist`)
  }
  for (const group of ['buy', 'use', 'left']) {
    assert.ok(context.SHOPPING[index][group].length, `day ${index + 1}: ${group} list exists`)
  }
}
for (let weekday = 0; weekday < 7; weekday += 1) {
  assert.notDeepEqual(
    context.MENU[weekday].meals.map(meal => meal.dish),
    context.MENU[weekday + 7].meals.map(meal => meal.dish),
    `weekday ${weekday + 1}: week two is not a copy of week one`,
  )
}

const menuData = JSON.stringify(context.MENU) + JSON.stringify(context.RECIPES) + JSON.stringify(context.SHOPPING)
assert.doesNotMatch(menuData, /рыб|лосос|тунец|треск|кревет|морепродукт/i)
for (const removed of ['Личный план', 'Нормальная еда на неделю', 'Белковая страховка', 'Почему не 2500']) {
  assert.ok(!html.includes(removed), `removed block is absent: ${removed}`)
}

assert.ok(html.includes('Рецепт и порция'))
assert.ok(html.includes('weekButton.textContent="Неделя "+(week+1)'))
assert.ok(html.includes('Что купить и куда уйдут остатки'))
assert.ok(html.includes('Куриное филе — упаковка 900 г'))
assert.match(context.SHOPPING[0].left.join(' '), /550 г.*вторник/)
assert.match(context.SHOPPING[1].use.join(' '), /550 г.*150 г.*400 г/)
assert.match(context.SHOPPING[9].left.join(' '), /550 г.*четверг/)

// Owner feedback: portions, recipes and ingredient flows must change together.
assert.ok(!context.RECIPES.omelet.img, 'omelet has no unrelated photo')
for (const index of [0, 7]) {
  assert.doesNotMatch(JSON.stringify(context.MENU[index].meals[0]), /ягод/i, 'Monday breakfast has no berries')
}
for (const index of [0, 1, 4, 7, 8, 9, 11]) {
  const meal = context.MENU[index].meals[2]
  assert.equal(meal.dish, 'Творог с бананом, яблоком и греческим йогуртом')
  assert.equal(meal.recipe, 'cottageBowl')
  assert.match(context.SHOPPING[index].buy.join(' '), /Творог|творог/)
  assert.match(context.SHOPPING[index].buy.join(' '), /яблоко/i)
}
assert.doesNotMatch(JSON.stringify(context.RECIPES.cottageBowl), /ягод|хлеб|миска/i)
for (const mealIndex of [1, 3]) assert.equal(context.MENU[2].meals[mealIndex].recipe, 'chickenPatties')
assert.equal(context.MENU[3].meals[1].recipe, 'chickenPatties')
assert.match(context.SHOPPING[2].use.join(' '), /600 г.*3 равные порции.*обед.*ужин/)
assert.match(context.SHOPPING[2].left.join(' '), /1 готовая порция.*четверг/)
assert.match(context.SHOPPING[3].use.join(' '), /Последняя готовая порция котлет/)
assert.match(context.SHOPPING[11].buy.join(' '), /фарш — 600 г/)
assert.match(context.SHOPPING[11].left.join(' '), /2 готовые порции новых котлет/)
assert.doesNotMatch(context.SHOPPING[11].use.join(' '), /последняя порция котлет/)
for (const index of [1, 3, 8, 10]) assert.notEqual(context.MENU[index].meals[1].recipe, 'shawarma')
assert.equal(context.MENU[5].meals[1].recipe, 'shawarma', 'Saturday shawarma remains')
assert.equal(context.RECIPES[context.MENU[4].meals[1].recipe].ingredients[0], 'Куриное филе 500 г', 'first Friday keeps the full batch')
assert.equal(context.RECIPES[context.MENU[10].meals[3].recipe].ingredients[0], 'Куриное филе 400 г', 'second Thursday recipe uses exactly the available fillet')
assert.match(context.SHOPPING[10].use.join(' '), /400 г — рубленые котлеты/, 'second Thursday shopping agrees with the recipe batch')
for (const index of [1, 10]) {
  assert.equal(context.MENU[index].meals[1].recipe, 'chickenMash')
  assert.doesNotMatch(JSON.stringify(context.SHOPPING[index]), /шаурм/i)
}
for (const index of [1, 8]) {
  assert.equal(context.MENU[index].meals[3].recipe, 'meatballsMash')
  assert.match(context.MENU[index].meals[3].portion.join(' '), /картофель.*молоко.*сливочное масло/)
  assert.doesNotMatch(JSON.stringify(context.SHOPPING[index]), /паста — 167|паста 167/)
}
assert.equal(context.MENU[3].meals[0].recipe, 'granola')
assert.equal(context.MENU[7].meals[0].recipe, 'granola')
assert.doesNotMatch(JSON.stringify(context.SHOPPING[7]), /сырник/)
for (const index of [2, 8]) {
  assert.equal(context.MENU[index].meals[0].recipe, 'poppyPancakes')
  assert.match(context.MENU[index].meals[0].portion.join(' '), /варенье без сахара 20 г/)
}
assert.equal(context.MENU[9].meals[0].recipe, 'lavashBreakfast')
assert.doesNotMatch(JSON.stringify(context.MENU[9].meals[0]), /варенье|сгущ/i)
for (const index of [4, 11]) {
  assert.match(context.MENU[index].meals[0].portion.join(' '), /греческий йогурт 100 г.*сахарозаменитель/)
}
assert.match(context.RECIPES.chocolateWaffles.method, /взвесить.*калории по этикетке/)
assert.ok(html.includes('Синхронизировать день'))
assert.ok(html.includes('GOOGLE_SHEET_NAME="Питание"'))
assert.ok(html.includes('addSheet'))
assert.ok(html.includes('client.requestAccessToken({prompt:"select_account"})'))
assert.ok(html.includes('dayAlreadySaved'))

console.log('OK: 14 дней, КБЖУ, рецепты, закупки, остатки и Google-журнал проверены')
