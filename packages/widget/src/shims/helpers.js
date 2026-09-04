import { useEffect, useRef } from 'react';

// Stands in for the one helper the reused components take from @plone/volto/helpers.
export function usePrevious(value) {
  const ref = useRef();
  useEffect(() => {
    ref.current = value;
  }, [value]);
  return ref.current;
}
