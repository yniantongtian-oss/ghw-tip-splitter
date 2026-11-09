// Money is integer cents so a split never depends on binary floating point.
// Wrapped so the helpers stay off the page's global scope. Chrome also blocks
// type=module on file://, so this stays a classic script (see the footer).
(function () {

const PEOPLE_MAX = 9999;

/**
 * @param {unknown} value
 * @param {number} scale digits after the decimal to keep
 * @param {{ allowDollar?: boolean, allowPercent?: boolean, allowThousands?: boolean }} [options]
 * @returns {{ value: number, error?: undefined } | { error: "invalid" | "negative", value?: number }}
 */
function parseScaled(value, scale, options = {}) {
  const { allowDollar = false, allowPercent = false, allowThousands = false } = options;

  let raw;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return { error: "invalid" };
    raw = numberToString(value);
  } else if (value == null) {
    return { error: "invalid" };
  } else {
    raw = String(value);
  }

  raw = raw.trim().replace(/[−–—]/g, "-");
  if (allowDollar) raw = raw.replace(/\$/g, "");
  raw = raw.replace(/\s+/g, "");
  if (allowPercent) raw = raw.replace(/%$/, "");
  if (raw === "") return { error: "invalid" };

  let negative = false;
  if (raw.startsWith("-")) {
    negative = true;
    raw = raw.slice(1);
  }
  if (raw.startsWith("+") || raw === "") return { error: "invalid" };

  if (allowThousands && /^\d{1,3}(,\d{3})+(\.\d*)?$/.test(raw)) {
    raw = raw.replace(/,/g, "");
  }

  if (!/^\d+(\.\d*)?$/.test(raw) && !/^\.\d+$/.test(raw)) {
    return { error: "invalid" };
  }

  let [whole, frac = ""] = raw.split(".");
  if (!whole) whole = "0";
  if (whole.length > 12) return { error: "invalid" };

  const needed = frac.slice(0, scale);
  const rest = frac.slice(scale);
  const padded = needed.padEnd(scale, "0");
  let intVal = Number(whole) * 10 ** scale + Number(padded || "0");
  if (!Number.isSafeInteger(intVal)) return { error: "invalid" };
  if (rest.length > 0 && rest[0] >= "5") intVal += 1;
  if (!Number.isSafeInteger(intVal)) return { error: "invalid" };

  if (negative) return { error: "negative", value: -intVal };
  return { value: intVal };
}

function numberToString(value) {
  if (Object.is(value, -0)) return "-0";
  const raw = String(value);
  if (!/[eE]/.test(raw)) return raw;
  const sign = value < 0 ? "-" : "";
  return sign + Math.abs(value).toFixed(12).replace(/0+$/, "").replace(/\.$/, "");
}

/**
 * @param {unknown} value
 * @returns {{ value: number } | { error: "invalid" | "negative" }}
 */
function parsePeople(value) {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || Object.is(value, -0)) {
      return Object.is(value, -0) || value < 0 ? { error: "negative" } : { error: "invalid" };
    }
    if (value < 0) return { error: "negative" };
    if (!Number.isInteger(value) || value < 1 || value > PEOPLE_MAX) return { error: "invalid" };
    return { value };
  }

  const raw = String(value ?? "").trim().replace(/[−–—]/g, "-");
  if (raw.startsWith("-")) return { error: "negative" };
  if (!/^\d+$/.test(raw)) return { error: "invalid" };
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n < 1 || n > PEOPLE_MAX) return { error: "invalid" };
  return { value: n };
}

function divRoundHalfUp(numerator, denominator) {
  return Math.floor((numerator + Math.floor(denominator / 2)) / denominator);
}

function fieldError(parsed, field) {
  if (!parsed.error) return undefined;
  return parsed.error === "negative" ? `${field}_negative` : `${field}_invalid`;
}

/**
 * Split a bill plus tip.
 *
 * With rounding off, leftover cents are given one each to the first shares
 * so the shares add up to the total. With rounding on, each share goes to
 * the nearest dollar. If that sum would miss the exact total, as few shares
 * as possible go up by one dollar so the table still covers the bill.
 *
 * @param {{ bill?: unknown, tipPercent?: unknown, people?: unknown, round?: boolean }} [input]
 */
function calculate({ bill, tipPercent, people, round } = {}) {
  const billParsed = parseScaled(bill, 2, { allowDollar: true, allowThousands: true });
  const tipParsed = parseScaled(tipPercent, 2, { allowPercent: true });
  const peopleParsed = parsePeople(people);

  const errors = {};
  const billError = fieldError(billParsed, "bill");
  const tipError = fieldError(tipParsed, "tip");
  const peopleError = fieldError(peopleParsed, "people");
  if (billError) errors.bill = billError;
  if (tipError) errors.tip = tipError;
  if (peopleError) errors.people = peopleError;
  if (billError || tipError || peopleError) return { ok: false, errors };

  const billCents = billParsed.value;
  const basisPoints = tipParsed.value;
  const headcount = peopleParsed.value;
  const product = billCents * basisPoints;
  if (!Number.isSafeInteger(product)) {
    return { ok: false, errors: { bill: "bill_invalid" } };
  }

  const exactTipCents = divRoundHalfUp(product, 10_000);
  const exactTotalCents = billCents + exactTipCents;

  if (round !== true) {
    const base = Math.floor(exactTotalCents / headcount);
    const remainder = exactTotalCents % headcount;
    const perHigh = remainder === 0 ? base : base + 1;
    return {
      ok: true,
      errors: {},
      billCents,
      tipCents: exactTipCents,
      totalCents: exactTotalCents,
      perPersonCents: perHigh,
      perPersonCentsLow: base,
      highCount: remainder === 0 ? headcount : remainder,
      lowCount: remainder === 0 ? 0 : headcount - remainder,
      people: headcount,
      round: false,
      roundMode: null,
    };
  }

  const perDollars = divRoundHalfUp(exactTotalCents, headcount * 100);
  const nearestCents = perDollars * 100;
  const nearestTotal = nearestCents * headcount;
  if (nearestTotal >= exactTotalCents) {
    return roundedResult({
      billCents,
      tipCents: nearestTotal - billCents,
      totalCents: nearestTotal,
      perPersonCents: nearestCents,
      perPersonCentsLow: nearestCents,
      highCount: headcount,
      lowCount: 0,
      people: headcount,
      roundMode: "nearest",
    });
  }

  const extraPeople = Math.ceil((exactTotalCents - nearestTotal) / 100);
  const highCents = nearestCents + 100;
  if (extraPeople >= headcount) {
    const totalCents = highCents * headcount;
    return roundedResult({
      billCents,
      tipCents: totalCents - billCents,
      totalCents,
      perPersonCents: highCents,
      perPersonCentsLow: highCents,
      highCount: headcount,
      lowCount: 0,
      people: headcount,
      roundMode: "up",
    });
  }

  const lowCount = headcount - extraPeople;
  const totalCents = highCents * extraPeople + nearestCents * lowCount;
  return roundedResult({
    billCents,
    tipCents: totalCents - billCents,
    totalCents,
    perPersonCents: highCents,
    perPersonCentsLow: nearestCents,
    highCount: extraPeople,
    lowCount,
    people: headcount,
    roundMode: "up",
  });
}

function roundedResult(result) {
  return { ok: true, errors: {}, round: true, ...result };
}

/** Format integer cents as USD, e.g. 1999 → "$19.99". */
function formatUSD(cents) {
  if (!Number.isSafeInteger(cents)) return "—";
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100);
  const rem = String(abs % 100).padStart(2, "0");
  const grouped = String(dollars).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "-" : ""}$${grouped}.${rem}`;
}

// Chrome treats <script type="module"> on file:// as a CORS request and blocks
// it (origin null), so opening index.html never ran the calculator. This file
// is a classic script in the browser and a CommonJS module under Node.
if (typeof module === "object" && module.exports) {
  module.exports = { calculate, formatUSD };
} else {
  globalThis.TipCalc = { calculate, formatUSD };
}
})();
