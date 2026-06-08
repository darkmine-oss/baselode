/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { useCallback, useRef, useState } from 'react';

/**
 * Controlled / uncontrolled state hook used by every panel.
 *
 * When the caller passes `{ value, onChange }`, the hook is fully
 * controlled — `value` is the source of truth and every setter
 * routes back through `onChange`.  Mode is locked on first render;
 * a runtime switch (controlled ↔ uncontrolled) would lose user
 * picks, so we warn instead of toggling.
 *
 * When `value` or `onChange` is missing, the hook is uncontrolled —
 * it holds its own state seeded from `defaultValue`.
 *
 * The returned setter accepts either a flat patch object (merged
 * into the current state) or a function `(current) => patch` —
 * matching the way callers thread defaults through `useEffect`s
 * without listing the state itself as a dep.
 *
 * @param {Object} options
 * @param {Object} [options.value] - Controlled value (caller-owned).
 * @param {Function} [options.onChange] - Notified with the next
 *   state object whenever a setter is invoked in controlled mode.
 * @param {Object} options.defaultValue - Initial state in
 *   uncontrolled mode; ignored in controlled mode.
 * @returns {[Object, Function]} `[state, setState]` — setState
 *   accepts `(current) => patch` or a flat patch object and merges
 *   it into the current state shallowly.
 */
export function useControllable({ value, onChange, defaultValue } = {}) {
  const isControlled = value !== undefined && typeof onChange === 'function';
  const controlledRef = useRef(isControlled);
  const [internal, setInternal] = useState(defaultValue);

  // Warn (dev only) if the caller flips between controlled and
  // uncontrolled — React's own components do the same and the
  // mid-life switch loses state silently otherwise.
  if (process.env.NODE_ENV !== 'production' && controlledRef.current !== isControlled) {
    // eslint-disable-next-line no-console
    console.warn(
      'useControllable: panel switched between controlled and uncontrolled modes — ' +
      'pass a stable `value` + `onChange` from the first render.'
    );
  }

  const setState = useCallback((patchOrFn) => {
    if (isControlled) {
      const current = value;
      const patch = typeof patchOrFn === 'function' ? patchOrFn(current) : patchOrFn;
      onChange({ ...current, ...patch });
      return;
    }
    setInternal((current) => {
      const patch = typeof patchOrFn === 'function' ? patchOrFn(current) : patchOrFn;
      return { ...current, ...patch };
    });
  }, [isControlled, value, onChange]);

  return [isControlled ? value : internal, setState];
}
