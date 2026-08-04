import { useEffect, useRef, useState } from "react";

/**
 * A value that settles after the user stops changing it.
 *
 * WHY THIS EXISTS. The markets search put `query` straight into a react-query
 * key, so every keystroke was a request: typing "AAPL" fired four calls to
 * `/markets/search` against a ~13k-row universe, and the answers could land out
 * of order — the response for "AAP" arriving after "AAPL" and overwriting it.
 *
 * 400ms is the compromise the research converges on: long enough that ordinary
 * typing produces one request instead of one per character, short enough that
 * the results still feel like they are keeping up.
 *
 * THE FIRST VALUE IS NOT DELAYED. A screen that opens with a query already in
 * it (a deep link, a restored filter) should render its results immediately
 * rather than showing an empty list for the first 400ms.
 */
export function useDebounced<T>(value: T, delayMs = 400): T {
  const [settled, setSettled] = useState(value);
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      setSettled(value);
      return;
    }
    const t = setTimeout(() => setSettled(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);

  return settled;
}
