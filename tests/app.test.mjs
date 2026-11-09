import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";

const { calculate, formatUSD } = createRequire(import.meta.url)("../calc.js");

test("18% on $86.40 split 3 ways hands out the leftover cent", () => {
  const result = calculate({ bill: "86.40", tipPercent: "18", people: "3", round: false });
  assert.equal(result.ok, true);
  assert.equal(result.billCents, 8640);
  assert.equal(result.tipCents, 1555);
  assert.equal(result.totalCents, 10195);
  assert.equal(result.perPersonCents, 3399);
  assert.equal(result.perPersonCentsLow, 3398);
  assert.equal(result.highCount, 1);
  assert.equal(result.lowCount, 2);
  assert.equal(
    result.highCount * result.perPersonCents + result.lowCount * result.perPersonCentsLow,
    result.totalCents,
  );
});

test("accepts a numeric bill and a dollar-formatted string as the same amount", () => {
  const fromNumber = calculate({ bill: 86.4, tipPercent: 18, people: 3, round: false });
  const fromMoney = calculate({ bill: "$86.40", tipPercent: "18%", people: 3, round: false });
  assert.deepEqual(
    [fromNumber.billCents, fromNumber.tipCents, fromNumber.totalCents],
    [fromMoney.billCents, fromMoney.tipCents, fromMoney.totalCents],
  );
});

test("parses thousands separators and keeps 19.99 exact", () => {
  const thousands = calculate({ bill: "1,234.50", tipPercent: "0", people: "1", round: false });
  assert.equal(thousands.billCents, 123450);
  const cents = calculate({ bill: 19.99, tipPercent: 0, people: 1, round: false });
  assert.equal(cents.billCents, 1999);
  assert.equal(cents.totalCents, 1999);
});

test("rounds a half cent up", () => {
  const result = calculate({ bill: "1.005", tipPercent: "0", people: "1", round: false });
  assert.equal(result.billCents, 101);
});

test("10% of $100 split 3 ways sums to the total", () => {
  const result = calculate({ bill: "100", tipPercent: "10", people: "3", round: false });
  assert.equal(result.tipCents, 1000);
  assert.equal(result.totalCents, 11000);
  assert.equal(result.perPersonCents, 3667);
  assert.equal(result.perPersonCentsLow, 3666);
  assert.equal(result.highCount, 2);
  assert.equal(result.lowCount, 1);
  assert.equal(result.highCount + result.lowCount, result.people);
});

test("12.5% of $80 split 2 ways is exact", () => {
  const result = calculate({ bill: "80", tipPercent: "12.5", people: "2", round: false });
  assert.equal(result.tipCents, 1000);
  assert.equal(result.totalCents, 9000);
  assert.equal(result.perPersonCents, 4500);
  assert.equal(result.lowCount, 0);
});

test("zero bill stays zero", () => {
  const result = calculate({ bill: "0", tipPercent: "20", people: "4", round: false });
  assert.equal(result.ok, true);
  assert.equal(result.tipCents, 0);
  assert.equal(result.totalCents, 0);
  assert.equal(result.perPersonCents, 0);
});

test("rounding uses the nearest dollar when the table still covers the bill", () => {
  const result = calculate({ bill: "86.40", tipPercent: "18", people: "3", round: true });
  assert.equal(result.ok, true);
  assert.equal(result.roundMode, "nearest");
  assert.equal(result.perPersonCents, 3400);
  assert.equal(result.totalCents, 10200);
  assert.equal(result.tipCents, 1560);
  assert.equal(result.perPersonCents % 100, 0);
});

test("rounding adds one dollar to as few shares as possible", () => {
  const exact = calculate({ bill: "100", tipPercent: "0", people: "3", round: false });
  const rounded = calculate({ bill: "100", tipPercent: "0", people: "3", round: true });
  assert.equal(exact.totalCents, 10000);
  assert.equal(rounded.roundMode, "up");
  assert.equal(rounded.perPersonCents, 3400);
  assert.equal(rounded.perPersonCentsLow, 3300);
  assert.equal(rounded.highCount, 1);
  assert.equal(rounded.lowCount, 2);
  assert.equal(rounded.totalCents, 10000);
  assert.equal(rounded.tipCents, 0);
});

test("15% of $86.40 does not raise every share when nearest is a few cents short", () => {
  const result = calculate({ bill: "86.40", tipPercent: "15", people: "3", round: true });
  assert.equal(result.roundMode, "up");
  assert.equal(result.perPersonCents, 3400);
  assert.equal(result.perPersonCentsLow, 3300);
  assert.equal(result.highCount, 1);
  assert.equal(result.lowCount, 2);
  assert.equal(result.totalCents, 10000);
  assert.equal(
    result.highCount * result.perPersonCents + result.lowCount * result.perPersonCentsLow,
    result.totalCents,
  );
});

test("an even dollar split stays on that dollar", () => {
  const result = calculate({ bill: "90", tipPercent: "0", people: "3", round: true });
  assert.equal(result.roundMode, "nearest");
  assert.equal(result.perPersonCents, 3000);
  assert.equal(result.tipCents, 0);
  assert.equal(result.totalCents, 9000);
});

test("rounding never collects less than the exact total", () => {
  const cases = [
    ["10", "18", "3"],
    ["1", "10", "6"],
    ["0", "20", "4"],
    ["19.99", "15", "2"],
    ["33.49", "0", "1"],
  ];
  for (const [bill, tipPercent, people] of cases) {
    const exact = calculate({ bill, tipPercent, people, round: false });
    const rounded = calculate({ bill, tipPercent, people, round: true });
    assert.equal(exact.ok && rounded.ok, true, `${bill} / ${tipPercent} / ${people}`);
    assert.ok(rounded.totalCents >= exact.totalCents);
    assert.equal(
      rounded.highCount * rounded.perPersonCents + rounded.lowCount * rounded.perPersonCentsLow,
      rounded.totalCents,
    );
    assert.equal(rounded.highCount + rounded.lowCount, rounded.people);
    assert.equal(rounded.tipCents, rounded.totalCents - rounded.billCents);
    assert.equal(rounded.perPersonCents % 100, 0);
    assert.equal(rounded.perPersonCentsLow % 100, 0);
    assert.ok(rounded.tipCents >= 0);
  }
});

test("rejects negatives, fractions of a person, and empty amounts together", () => {
  const result = calculate({ bill: "-5", tipPercent: "-1", people: "0", round: false });
  assert.equal(result.ok, false);
  assert.equal(result.errors.bill, "bill_negative");
  assert.equal(result.errors.tip, "tip_negative");
  assert.equal(result.errors.people, "people_invalid");
});

test("rejects a negative person count, a fractional count, and a negative-zero bill", () => {
  assert.equal(
    calculate({ bill: "10", tipPercent: "10", people: -3, round: false }).errors.people,
    "people_negative",
  );
  assert.equal(
    calculate({ bill: "10", tipPercent: "10", people: 1.5, round: false }).errors.people,
    "people_invalid",
  );
  assert.equal(
    calculate({ bill: "-0", tipPercent: "10", people: "1", round: false }).errors.bill,
    "bill_negative",
  );
  assert.equal(
    calculate({ bill: "abc", tipPercent: "", people: "", round: true }).ok,
    false,
  );
});

test("ignores a non-boolean round flag", () => {
  const result = calculate({ bill: "90", tipPercent: "0", people: "3", round: "true" });
  assert.equal(result.round, false);
  assert.equal(result.totalCents, 9000);
});

test("formats cents as USD", () => {
  assert.equal(formatUSD(10195), "$101.95");
  assert.equal(formatUSD(0), "$0.00");
  assert.equal(formatUSD(-155), "-$1.55");
  assert.equal(formatUSD(100000), "$1,000.00");
  assert.equal(formatUSD(1.5), "—");
});
