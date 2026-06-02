import test from "node:test";
import assert from "node:assert/strict";
import { convertUsd, roundMoney } from "../src/currency.js";

test("roundMoney keeps predictable cents", () => {
  assert.equal(roundMoney(12.345), 12.35);
  assert.equal(roundMoney("9.1"), 9.1);
});

test("convertUsd keeps Binance style USD payments unchanged", () => {
  const result = convertUsd(15, { currency: "USD", rateKey: "USD" }, { BDT: 118 });
  assert.deepEqual(result, { currency: "USD", exchangeRate: 1, amount: 15 });
});

test("convertUsd converts Bangladesh and India methods from USD", () => {
  assert.deepEqual(convertUsd(10, { currency: "BDT", rateKey: "BDT" }, { BDT: 118 }), {
    currency: "BDT",
    exchangeRate: 118,
    amount: 1180
  });
  assert.deepEqual(convertUsd(10, { currency: "INR", rateKey: "INR" }, { INR: 84 }), {
    currency: "INR",
    exchangeRate: 84,
    amount: 840
  });
});
