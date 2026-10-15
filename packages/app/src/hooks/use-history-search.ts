import { useMemo, useState } from "react";
import { createTextSearch, SearchQueryError } from "@getpaseo/protocol/search/query";
import type { SearchOptions } from "@getpaseo/protocol/search/options";
import { useDebouncedValue } from "@/hooks/use-debounced-value";

export function useHistorySearch() {
  const [input, setInput] = useState("");
  const [options, setOptions] = useState<SearchOptions>({});
  const compiled = useMemo(() => {
    const query = options.regex ? input : input.trim();
    try {
      return { query, options, matcher: createTextSearch({ query, options }), invalid: false };
    } catch (error) {
      if (!(error instanceof SearchQueryError)) throw error;
      return { query, options, matcher: undefined, invalid: true };
    }
  }, [input, options]);
  const debounced = useDebouncedValue(compiled, 200);
  return {
    input,
    setInput,
    options,
    setOptions,
    query: debounced.query,
    queryOptions: debounced.options,
    matcher: debounced.matcher,
    invalid: compiled.invalid,
    enabled: !compiled.invalid && !debounced.invalid,
  };
}
