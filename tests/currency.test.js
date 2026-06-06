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

test("convertUsd keeps crypto payment amounts precise", () => {
  assert.deepEqual(convertUsd(1.35, { currency: "USDT", rateKey: "USDT" }, { USDT: 1 }), {
    currency: "USDT",
    exchangeRate: 1,
    amount: 1.35
  });
  assert.deepEqual(convertUsd(100, { currency: "BTC", rateKey: "BTC" }, { BTC: 0.0000091 }), {
    currency: "BTC",
    exchangeRate: 0.0000091,
    amount: 0.00091
  });
});
