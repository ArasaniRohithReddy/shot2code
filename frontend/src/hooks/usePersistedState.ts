import { Dispatch, SetStateAction, useEffect, useState } from 'react';

type PersistedState<T> = [T, Dispatch<SetStateAction<T>>];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Merge a stored value over the defaults.
 *
 * Stored settings are written once and then read back by every later version of
 * the app, so a value saved before a field existed would leave that field
 * undefined. That is not theoretical: it crashed the settings page for anyone
 * upgrading, because the component read `.includes` off a missing array.
 * Filling in absent keys from the defaults keeps older saved state usable as
 * new fields are added.
 */
function withDefaults<T>(stored: unknown, defaultValue: T): T {
  if (!isPlainObject(stored) || !isPlainObject(defaultValue)) {
    return (stored as T) ?? defaultValue;
  }

  const merged: Record<string, unknown> = { ...defaultValue };
  for (const [key, value] of Object.entries(stored)) {
    // Only trust keys the current version still knows about, and never let a
    // stored null/undefined wipe out a default.
    if (key in defaultValue && value !== undefined && value !== null) {
      merged[key] = value;
    }
  }
  return merged as T;
}

function usePersistedState<T>(defaultValue: T, key: string): PersistedState<T> {
  const [value, setValue] = useState<T>(() => {
    try {
      const stored = window.localStorage.getItem(key);
      if (!stored) return defaultValue;
      return withDefaults(JSON.parse(stored), defaultValue);
    } catch {
      // Corrupt JSON shouldn't take the whole app down.
      return defaultValue;
    }
  });

  useEffect(() => {
    window.localStorage.setItem(key, JSON.stringify(value));
  }, [key, value]);

  return [value, setValue];
}

export { usePersistedState, withDefaults };
