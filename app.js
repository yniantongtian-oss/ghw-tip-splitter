(function () {
const { calculate, formatUSD } = globalThis.TipCalc;

const THEME_KEY = "tip-splitter-theme";
const LANG_KEY = "tip-splitter-lang";
const EN_DASH = "–";

const I18N = {
  en: {
    eyebrow: "Dinner check",
    title: "Tip Splitter",
    perPerson: "Per person",
    tip: "Tip",
    total: "Total",
    bill: "Bill amount",
    billWord: "Bill",
    tipPercent: "Tip",
    custom: "Custom",
    customPlaceholder: "e.g. 12.5",
    people: "Number of people",
    round: "Round each share to the nearest dollar",
    footer: "MLH Global Hack Week · Challenge 1",
    themeDark: "Switch to dark mode",
    themeLight: "Switch to light mode",
    langGroup: "Language",
    fewer: "Fewer people",
    more: "More people",
    empty: "—",
    noteEven: "Even split",
    noteRounded: "Rounded to the nearest dollar",
    noteRoundedUp: "Rounded up so the bill is covered",
    shareSplit: ({ highCount, high, lowCount, low }) =>
      `${highCount} ${highCount === 1 ? "person pays" : "people pay"} ${high}, ${lowCount} ${lowCount === 1 ? "person pays" : "people pay"} ${low}`,
    err: {
      bill_invalid: "Enter a valid bill amount.",
      bill_negative: "Bill amount can't be negative.",
      tip_invalid: "Enter a valid tip percent.",
      tip_negative: "Tip percent can't be negative.",
      people_invalid: "Enter a whole number of people, at least 1.",
      people_negative: "Number of people can't be negative.",
    },
  },
  zh: {
    eyebrow: "用餐账单",
    title: "小费分摊",
    perPerson: "每人",
    tip: "小费",
    total: "合计",
    bill: "账单金额",
    billWord: "账单",
    tipPercent: "小费比例",
    custom: "自定义",
    customPlaceholder: "例如 12.5",
    people: "人数",
    round: "每人金额四舍五入到整数美元",
    footer: "MLH Global Hack Week · 挑战 1",
    themeDark: "切换到深色模式",
    themeLight: "切换到浅色模式",
    langGroup: "语言",
    fewer: "减少人数",
    more: "增加人数",
    empty: "—",
    noteEven: "平均分摊",
    noteRounded: "已四舍五入到整数美元",
    noteRoundedUp: "为凑齐账单，已向上取整",
    shareSplit: ({ highCount, high, lowCount, low }) =>
      `${highCount} 人付 ${high}，${lowCount} 人付 ${low}`,
    err: {
      bill_invalid: "请输入有效的账单金额。",
      bill_negative: "账单金额不能为负数。",
      tip_invalid: "请输入有效的小费比例。",
      tip_negative: "小费比例不能为负数。",
      people_invalid: "请输入至少 1 的整数人数。",
      people_negative: "人数不能为负数。",
    },
  },
};

const els = {
  bill: document.querySelector("#bill"),
  billField: document.querySelector("#bill-field"),
  billError: document.querySelector("#bill-error"),
  custom: document.querySelector("#custom-tip"),
  customField: document.querySelector("#custom-field"),
  tipError: document.querySelector("#tip-error"),
  presets: document.querySelector("#presets"),
  people: document.querySelector("#people"),
  peopleStepper: document.querySelector("#people-stepper"),
  peopleDec: document.querySelector("#people-dec"),
  peopleInc: document.querySelector("#people-inc"),
  peopleError: document.querySelector("#people-error"),
  round: document.querySelector("#round"),
  perPerson: document.querySelector("#per-person"),
  note: document.querySelector("#share-note"),
  billAmount: document.querySelector("#bill-amount"),
  tipAmount: document.querySelector("#tip-amount"),
  totalAmount: document.querySelector("#total-amount"),
  themeToggle: document.querySelector("#theme-toggle"),
  langGroup: document.querySelector("#lang-toggle"),
  form: document.querySelector("#split-form"),
};

let lang = document.documentElement.lang.toLowerCase().startsWith("zh") ? "zh" : "en";
let fallbackPreset = "18";

function t(key) {
  return I18N[lang][key];
}

function store(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Private mode and file pages can reject storage; the toggle still works.
  }
}

function currentTheme() {
  return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
}

function syncThemeButton() {
  const dark = currentTheme() === "dark";
  els.themeToggle.setAttribute("aria-pressed", String(dark));
  els.themeToggle.setAttribute("aria-label", dark ? t("themeLight") : t("themeDark"));
}

function applyStaticCopy() {
  document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
  document.title = t("title");
  for (const node of document.querySelectorAll("[data-i18n]")) {
    node.textContent = t(node.dataset.i18n);
  }
  els.custom.placeholder = t("customPlaceholder");
  els.langGroup.setAttribute("aria-label", t("langGroup"));
  els.peopleDec.setAttribute("aria-label", t("fewer"));
  els.peopleInc.setAttribute("aria-label", t("more"));
  for (const button of els.langGroup.querySelectorAll("button[data-lang]")) {
    button.setAttribute("aria-pressed", String(button.dataset.lang === lang));
  }
  syncThemeButton();
}

function setLang(next, persist) {
  lang = next === "zh" ? "zh" : "en";
  if (persist) store(LANG_KEY, lang);
  applyStaticCopy();
  update();
}

function customRaw() {
  return els.custom.value.trim();
}

function syncPresetHighlight() {
  const custom = customRaw().replace(/%$/, "");
  const buttons = [...els.presets.querySelectorAll("button[data-tip]")];
  for (const button of buttons) {
    const pressed = custom === "" ? button.dataset.tip === fallbackPreset : button.dataset.tip === custom;
    button.setAttribute("aria-pressed", String(pressed));
  }
}

function currentTip() {
  const custom = customRaw();
  if (custom !== "") return custom;
  const pressed = els.presets.querySelector('[aria-pressed="true"]');
  return pressed ? pressed.dataset.tip : fallbackPreset;
}

function setFieldError(field, input, errorNode, code) {
  errorNode.textContent = code ? t("err")[code] || "" : "";
  field.classList.toggle("is-invalid", Boolean(code));
  input.setAttribute("aria-invalid", code ? "true" : "false");
}

function showEmpty() {
  const dash = t("empty");
  els.perPerson.textContent = dash;
  els.perPerson.classList.remove("is-range");
  els.perPerson.classList.add("is-empty");
  els.note.textContent = "";
  els.billAmount.textContent = dash;
  els.tipAmount.textContent = dash;
  els.totalAmount.textContent = dash;
}

function update() {
  const result = calculate({
    bill: els.bill.value,
    tipPercent: currentTip(),
    people: els.people.value,
    round: els.round.checked,
  });

  setFieldError(els.billField, els.bill, els.billError, result.ok ? "" : result.errors.bill);
  setFieldError(els.customField, els.custom, els.tipError, result.ok ? "" : result.errors.tip);
  setFieldError(els.peopleStepper, els.people, els.peopleError, result.ok ? "" : result.errors.people);

  const rawPeople = els.people.value.trim();
  const peopleNumber = /^\d+$/.test(rawPeople) ? Number(rawPeople) : NaN;
  els.peopleDec.disabled = peopleNumber === 1;
  els.peopleInc.disabled = peopleNumber === 9999;

  if (!result.ok) {
    showEmpty();
    return;
  }

  const low = formatUSD(result.perPersonCentsLow);
  const high = formatUSD(result.perPersonCents);
  const uneven = result.lowCount > 0 && low !== high;
  els.perPerson.classList.remove("is-empty");
  els.perPerson.classList.toggle("is-range", uneven);
  els.perPerson.textContent = uneven ? `${low}${EN_DASH}${high}` : high;
  els.billAmount.textContent = formatUSD(result.billCents);
  els.tipAmount.textContent = formatUSD(result.tipCents);
  els.totalAmount.textContent = formatUSD(result.totalCents);

  if (uneven) {
    els.note.textContent = t("shareSplit")({
      highCount: result.highCount,
      high,
      lowCount: result.lowCount,
      low,
    });
  } else if (result.round && result.roundMode === "up") els.note.textContent = t("noteRoundedUp");
  else if (result.round) els.note.textContent = t("noteRounded");
  else els.note.textContent = t("noteEven");
}

function stepPeople(delta) {
  const raw = els.people.value.trim();
  const current = /^\d+$/.test(raw) ? Number(raw) : NaN;
  const base = Number.isInteger(current) && current >= 1 ? current : 1;
  const next = Math.min(9999, Math.max(1, base + delta));
  els.people.value = String(next);
  update();
}

els.form.addEventListener("submit", (event) => {
  event.preventDefault();
});

els.form.addEventListener("input", (event) => {
  if (event.target === els.custom) syncPresetHighlight();
  update();
});

els.round.addEventListener("change", update);

els.presets.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-tip]");
  if (!button) return;
  fallbackPreset = button.dataset.tip;
  // Setting .value does not fire an input event, so the form listener
  // never sees this clear. Always refresh the highlight and the totals.
  els.custom.value = "";
  syncPresetHighlight();
  update();
});

els.peopleDec.addEventListener("click", () => stepPeople(-1));
els.peopleInc.addEventListener("click", () => stepPeople(1));

els.themeToggle.addEventListener("click", () => {
  const next = currentTheme() === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  store(THEME_KEY, next);
  syncThemeButton();
});

els.langGroup.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-lang]");
  if (!button || button.dataset.lang === lang) return;
  setLang(button.dataset.lang, true);
});

applyStaticCopy();
update();
document.documentElement.dataset.ready = "true";
})();
