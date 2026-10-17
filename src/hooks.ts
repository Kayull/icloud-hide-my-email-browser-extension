import {
  Dispatch,
  useEffect,
  useState,
  SetStateAction,
  useCallback,
} from 'react';
import isEqual from 'fast-deep-equal/es6';
import browser from 'webextension-polyfill';
import {
  getBrowserStorageValue,
  setBrowserStorageValue,
  Store,
} from './storage';

export function useBrowserStorageState<K extends keyof Store>(
  key: K,
  initialValue: Store[K]
): [Store[K], Dispatch<SetStateAction<Store[K]>>, boolean] {
  const [state, setState] = useState(initialValue);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    const onChange = (
      changes: Record<string, browser.Storage.StorageChange>,
      area: string
    ) => {
      if (area === 'local' && changes[key]) {
        const value = changes[key].newValue as Store[K] | undefined;
        setState((previous) =>
          isEqual(previous, value ?? initialValue)
            ? previous
            : value ?? initialValue
        );
      }
    };
    browser.storage.onChanged.addListener(onChange);
    async function getBrowserStorageState() {
      setIsLoading(true);
      const value = await getBrowserStorageValue(key);

      if (mounted && value !== undefined) {
        setState((prevState) =>
          isEqual(prevState, value) ? prevState : value
        );
      }
    }

    getBrowserStorageState()
      .catch(console.error)
      .finally(() => {
        if (mounted) setIsLoading(false);
      });
    return () => {
      mounted = false;
      browser.storage.onChanged.removeListener(onChange);
    };
  }, [key, initialValue]);

  const setBrowserStorageState = useCallback(
    (value: SetStateAction<Store[K]>) =>
      setState((prevState) => {
        const newValue = value instanceof Function ? value(prevState) : value;
        if (isEqual(prevState, newValue)) return prevState;
        void setBrowserStorageValue(key, newValue).catch(console.error);
        return newValue;
      }),
    [key]
  );

  return [state, setBrowserStorageState, isLoading];
}
