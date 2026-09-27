/** Parse editable numeric fields without silently treating zero or blank as a default. */
export function trainingFormNumber(
  value: string,
  label: string,
  options: { min: number; integer?: boolean; optional?: boolean; defaultValue?: number; exclusiveMin?: boolean },
): number | null {
  if (!value.trim()) {
    if (options.defaultValue !== undefined) return options.defaultValue;
    if (options.optional) return null;
    throw new Error(`${label} is required.`);
  }
  const number = Number(value);
  if (!Number.isFinite(number) || (options.integer && !Number.isSafeInteger(number))
    || (options.exclusiveMin ? number <= options.min : number < options.min)) {
    const bound = options.exclusiveMin ? `greater than ${options.min}` : `at least ${options.min}`;
    throw new Error(`${label} must be ${options.integer ? "a whole number" : "a number"} ${bound}.`);
  }
  return number;
}
