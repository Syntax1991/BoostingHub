/**
 * Whole World of Warcraft gold. Not a fiat currency.
 * Grouping is ASCII commas so Node and the browser render the same string.
 */
export function formatGold(amount: number): string {
  const sign = amount < 0 ? "-" : "";
  const grouped = String(Math.abs(Math.trunc(amount))).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${sign}${grouped}g`;
}
