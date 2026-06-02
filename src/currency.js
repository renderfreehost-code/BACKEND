export function roundMoney(value, decimals = 2) {
  return Number((Number(value || 0)).toFixed(decimals));
}

export function convertUsd(totalUsd, method, rates) {
  const currency = method?.currency || "USD";
  const rateKey = method?.rateKey || currency;
  const rate = currency === "USD" ? 1 : Number(rates?.[rateKey] || 1);
  return {
    currency,
    exchangeRate: rate,
    amount: roundMoney(Number(totalUsd || 0) * rate, currency === "USD" ? 2 : 0)
  };
}
