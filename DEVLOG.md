# Dev log

Debugging pass for Tip Splitter. Checks:

- `node --test tests/app.test.mjs` — pure splits in `calc.js`
- `node scripts/smoke.mjs` — headless Chrome opening `index.html`, then presets, validation, rounding, the people stepper, Enter, Chinese, and dark mode (including a reload)

The sample check is $86.40, 18% tip, 3 people: tip $15.55, total $101.95, one person pays $33.99 and two pay $33.98.

## 1. Opening `index.html` never started the calculator

Headless Chrome painted the sample numbers and then sat there. `dataset.ready` never flipped. The console said:

`Access to script at 'file:///workspace/app.js' from origin 'null' has been blocked by CORS policy`

`<script type="module">` is a CORS request. On `file://` the origin is `null`, so Chrome refuses `app.js` and the import of `calc.js`. The page looked done and did nothing when you typed.

**Fix:** load `calc.js` and `app.js` as classic scripts. `calc.js` assigns `globalThis.TipCalc` in the browser and `module.exports` under Node. `tests/app.test.mjs` loads that same file with `createRequire`. Relative `src` paths still work on GitHub Pages, and there is still no build step.

## 2. `Identifier 'calculate' has already been declared`

After the classic-script change, the page threw before the first update. Both scripts share the page's global scope. `function calculate` in `calc.js` and `const { calculate }` in `app.js` are the same binding.

**Fix:** wrap each file in an IIFE. The only name added to the page is `TipCalc`.

## 3. A preset did not replace a custom tip

Smoke typed 12.5% (tip $10.80 on the sample bill) and then clicked 15%. The custom field cleared, and the tip stayed $10.80 instead of $12.96. The 15% button was not pressed.

Assigning `input.value = ""` does not fire `input`. The click handler only recalculated in the branch where the custom field was already empty, so clearing a typed percent skipped `update()`.

**Fix:** on every preset click, clear the custom field, mark that preset pressed, and recalculate.

## 4. Nearest-dollar rounding charged every person an extra dollar

$86.40 at 15% is $99.36 total, $33.12 each. The nearest dollar is $33. Three of those are $99, which is 36 cents short of the bill. The first rounding rule then moved every share to $34, total $102.

**Fix:** keep the nearest dollar, and add $1 only to as many shares as it takes to cover the exact total. The same check is now one person at $34 and two at $33, total $100. Covered by `tests/app.test.mjs` and the smoke script. If the nearest sum already covers the bill (the sample at 18% rounds to $34 each, total $102), nobody pays the extra dollar.

## 5. An invalid total drew as a green bar

Clearing the result used an em dash in the 3.4rem money style. On a phone that dash rendered as a thick green rule under “每人”.

**Fix:** `.is-empty` draws the dash smaller, in the muted color. Smoke checks that the class is present when the bill is negative.

## 6. The custom field looked filled in while a preset was selected

The placeholder was `12.5`, same color family as a typed value, next to a selected 18% button.

**Fix:** placeholder `e.g. 12.5` (Chinese: `例如 12.5`) and a muted `::placeholder` color.
