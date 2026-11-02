/**
 * A post being made, shared by the three posting screens (pick media → tag
 * it → caption). It lives only as long as the New post screens are open;
 * nothing is saved until "Post it".
 */
import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from 'react';

import type { PickedMedia } from './media';
import { NO_TAGS, type SlideTags } from './posts';

export type DraftItem = PickedMedia & { tags: SlideTags };
export type DraftPark = { id: string; name: string };

type Draft = {
  items: DraftItem[];
  setItems: (update: (prev: DraftItem[]) => DraftItem[]) => void;
  addMedia: (media: PickedMedia[], max: number) => void;
  setTags: (key: string, tags: SlideTags) => void;
  park: DraftPark | null;
  /** Changing the park drops obstacle picks from the old park (general types stay). */
  setPark: (park: DraftPark | null) => void;
  caption: string;
  setCaption: (caption: string) => void;
  /** Usernames for tagged people, so the screens can show them. */
  names: Record<string, string>;
  addName: (id: string, username: string) => void;
};

const DraftContext = createContext<Draft | null>(null);

export function PostDraftProvider({ initialPark, children }: { initialPark: DraftPark | null; children: ReactNode }) {
  const [items, setItemsState] = useState<DraftItem[]>([]);
  const [park, setParkState] = useState<DraftPark | null>(initialPark);
  const [caption, setCaption] = useState('');
  const [names, setNames] = useState<Record<string, string>>({});

  const setItems = useCallback((update: (prev: DraftItem[]) => DraftItem[]) => setItemsState(update), []);

  const addMedia = useCallback((media: PickedMedia[], max: number) => {
    setItemsState((prev) => {
      const seen = new Set(prev.map((m) => m.key));
      const added = media.filter((m) => !seen.has(m.key)).map((m) => ({ ...m, tags: NO_TAGS }));
      return [...prev, ...added].slice(0, max);
    });
  }, []);

  const setTags = useCallback((key: string, tags: SlideTags) => {
    setItemsState((prev) => prev.map((m) => (m.key === key ? { ...m, tags } : m)));
  }, []);

  const setPark = useCallback(
    (next: DraftPark | null) => {
      if (park?.id !== next?.id) {
        setItemsState((prev) => prev.map((m) => ({ ...m, tags: { ...m.tags, obstacleId: null } })));
      }
      setParkState(next);
    },
    [park],
  );

  const addName = useCallback((id: string, username: string) => {
    setNames((prev) => (prev[id] === username ? prev : { ...prev, [id]: username }));
  }, []);

  const value = useMemo(
    () => ({ items, setItems, addMedia, setTags, park, setPark, caption, setCaption, names, addName }),
    [items, setItems, addMedia, setTags, park, setPark, caption, names, addName],
  );
  return <DraftContext.Provider value={value}>{children}</DraftContext.Provider>;
}

export function usePostDraft(): Draft {
  const draft = useContext(DraftContext);
  if (!draft) throw new Error('usePostDraft outside PostDraftProvider');
  return draft;
}
