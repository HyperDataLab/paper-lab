const numbers = (text: string) =>
  text.match(/(?<![\p{L}\d])[-+−]?(?:\d+(?:[.,]\d+)*|\.\d+)(?:[eE][-+−]?\d+)?/gu) ?? [];

export function numericGrounding(value: string, source: string) {
  const observed = new Set(numbers(source));
  return numbers(value).every((number) => observed.has(number));
}
