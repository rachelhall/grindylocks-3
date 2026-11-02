/**
 * How clips play (Nov 1):
 * - In a feed, clips autoplay muted once they're mostly on screen, one at a
 *   time, and loop. Scrolled away, they pause.
 * - Tapping a clip turns sound on, and it stays on for the next clips until
 *   the app is closed or it's muted again. The silent switch still wins.
 * - Autoplay switches off (tap to play instead) under Low Data Mode or Data
 *   Saver, when iOS's Auto-Play Video Previews is off, or with Reduce Motion.
 */
import { createContext, useContext, useEffect, useState, useSyncExternalStore } from 'react';
import { AccessibilityInfo, AppState } from 'react-native';

import { getDataSaverState } from '../../modules/data-saver';

/* Sound, for the whole session ------------------------------------------------ */

let soundOn = false;
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Whether clips play with sound. Starts muted every time the app opens. */
export function useSoundOn(): boolean {
  return useSyncExternalStore(subscribe, () => soundOn);
}

export function toggleSound() {
  soundOn = !soundOn;
  listeners.forEach((l) => l());
}

/* Autoplay allowed ------------------------------------------------------------ */

/**
 * False under Low Data Mode / Data Saver, with Auto-Play Video Previews off,
 * or with Reduce Motion on. Checked again when the app comes back, since
 * these are changed in the phone's Settings.
 */
export function useAutoplayAllowed(): boolean {
  const [allowed, setAllowed] = useState(true);

  useEffect(() => {
    let alive = true;
    async function check() {
      const [reduceMotion, saver] = await Promise.all([
        AccessibilityInfo.isReduceMotionEnabled().catch(() => false),
        getDataSaverState(),
      ]);
      if (alive) setAllowed(!reduceMotion && !saver.lowData && saver.autoplayVideo);
    }
    void check();
    const motion = AccessibilityInfo.addEventListener('reduceMotionChanged', () => void check());
    const app = AppState.addEventListener('change', (state) => {
      if (state === 'active') void check();
    });
    return () => {
      alive = false;
      motion.remove();
      app.remove();
    };
  }, []);

  return allowed;
}

/* Which clip is playing -------------------------------------------------------- */

/**
 * A feed says which post is mostly on screen; only that post's showing clip
 * plays. Outside a feed (post detail) there's no provider, so the clip on
 * screen is the active one.
 */
export const ActivePostContext = createContext<string | null | undefined>(undefined);

/** Whether this post is the one allowed to play right now. */
export function useIsActivePost(postId: string | undefined): boolean {
  const active = useContext(ActivePostContext);
  if (active === undefined) return true;
  return Boolean(postId) && active === postId;
}
