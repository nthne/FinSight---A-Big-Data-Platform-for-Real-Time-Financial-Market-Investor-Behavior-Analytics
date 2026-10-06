export function formatVnd(value: number, maximumFractionDigits = 0) {
  return `VND ${value.toLocaleString("en-US", {
    maximumFractionDigits,
  })}`;
}

export const DISPLAY_CURRENCY = "VND";
