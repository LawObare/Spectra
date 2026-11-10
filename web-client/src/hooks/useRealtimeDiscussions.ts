import { useEffect, useState } from 'react';

interface IdentifiedThread {
  id: string;
}

interface ForumEvent<TThread> {
  thread?: TThread;
}

function normalizeThread<TThread extends IdentifiedThread>(value: unknown): TThread | null {
  if (typeof value !== 'object' || value === null) return null;

  const thread = value as Record<string, unknown>;
  const id = thread.id ?? thread.thread_id;
  if (id === undefined || id === null) return null;

  return { ...thread, id: String(id) } as TThread;
}

export function useRealtimeDiscussions<TThread extends IdentifiedThread>(
  initialThreads: TThread[]
) {
  const [threads, setThreads] = useState<TThread[]>(initialThreads);
  const [sseConnected, setSseConnected] = useState(false);

  useEffect(() => {
    let active = true;
    const upsertThread = (thread: TThread) => {
      setThreads((current) => {
        const exists = current.some((item) => item.id === thread.id);
        return exists
          ? current.map((item) => (item.id === thread.id ? thread : item))
          : [thread, ...current];
      });
    };

    void fetch('/api/forum/threads')
      .then(async (response) => {
        if (!response.ok) return;
        const payload: unknown = await response.json();
        const rows = Array.isArray(payload)
          ? payload
          : typeof payload === 'object' && payload !== null && 'threads' in payload
            ? (payload as { threads: unknown }).threads
            : [];
        if (!active || !Array.isArray(rows)) return;

        const normalized = rows
          .map((row) => normalizeThread<TThread>(row))
          .filter((row): row is TThread => row !== null);
        setThreads(normalized);
      })
      .catch(() => {
        // Keep the bundled community examples available when the API is offline.
      });

    if (typeof EventSource === 'undefined') {
      return () => {
        active = false;
      };
    }

    const source = new EventSource('/api/forum/stream');
    source.onopen = () => active && setSseConnected(true);
    source.onerror = () => active && setSseConnected(false);

    const onForumEvent = (event: Event) => {
      const message = event as MessageEvent<string>;
      try {
        const payload = JSON.parse(message.data) as ForumEvent<unknown>;
        const thread = normalizeThread<TThread>(payload.thread);
        if (thread) upsertThread(thread);
      } catch {
        // Ignore malformed events and keep the last valid feed state.
      }
    };

    for (const eventName of [
      'new_thread',
      'new_reply',
      'upvote_update',
      'moderator_verified',
      'classification_update',
    ]) {
      source.addEventListener(eventName, onForumEvent);
    }

    return () => {
      active = false;
      source.close();
      setSseConnected(false);
    };
  }, []);

  return { threads, setThreads, sseConnected };
}
