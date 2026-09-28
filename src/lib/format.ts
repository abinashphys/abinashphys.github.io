// Number formatting shared by the build-time figure and the browser script.
const SUP: Record<string, string> = {
  '-': '⁻', '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹',
};
/** 1.96×10⁴⁰ style; exact zero prints as "0". */
export function sci(v: number, digits = 2): string {
  if (v === 0) return '0';
  let e = Math.floor(Math.log10(Math.abs(v)));
  let m = v / 10 ** e;
  if (Number(Math.abs(m).toFixed(digits)) >= 10) {
    m /= 10;
    e += 1;
  }
  return `${m.toFixed(digits)}×10${String(e).replace(/./g, (c) => SUP[c])}`;
}
/** Radius in pc: one decimal above 100 pc, two below. */
export const fmtR = (r: number) => (r >= 100 ? r.toFixed(1) : r.toFixed(2));
