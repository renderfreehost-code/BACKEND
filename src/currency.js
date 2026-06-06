export function roundMoney(value, decimals = 2) {
  return Number((Number(value || 0)).toFixed(decimals));
}

export function currencyDecimals(code = "USD") {
  const currency = String(code || "USD").toUpperCase();
  if (currency === "BTC") return 8;
  if (currency === "USDT" || currency === "USD") return 2;
  return 0;
}

export function convertUsd(totalUsd, method, rates) {
  const currency = String(method?.currency || "USD").toUpperCase();
  const rateKey = String(method?.rateKey || currency).toUpperCase();
  const rate = currency === "USD" ? 1 : Number(rates?.[rateKey] || 1);
  return {
    currency,
    exchangeRate: rate,
    amount: roundMoney(Number(totalUsd || 0) * rate, currencyDecimals(currency))
  };
}
