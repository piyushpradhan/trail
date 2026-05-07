import React, { useEffect, useState, useCallback } from 'react';
import type { ActivityEvent } from '@shared/types';
import { formatEvent, relTime } from '../activity';

interface Props {
  active: boolean;
}

const POLL_MS = 8000;
const DEFAULT_LIMIT = 120;

export function Activity({ active }: Props): JSX.Element {
  const [events, setEvents] = useState<ActivityEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const e = await window.trail.events.recent(DEFAULT_LIMIT);
      setEvents(e);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    if (!active) return;
    void refresh();
    const id = setInterval(() => void refresh(), POLL_MS);
    const off = window.trailEvents.onChange(() => void refresh());
    return () => {
      clearInterval(id);
      off();
    };
  }, [active, refresh]);

  if (!active) return <></>;

  if (error) {
    return <div className="empty">Failed to load activity: {error}</div>;
  }

  if (events === null) {
    return <div className="empty">Loading…</div>;
  }

  if (events.length === 0) {
    return <div className="empty">No activity yet. Run a sync to populate.</div>;
  }

  return (
    <div className="activity-list">
      {events.map((e) => {
        const f = formatEvent(e);
        return (
          <div key={f.id} className={`activity-row tone-${f.tone}`}>
            <span className={`activity-source source-chip ${f.source}`}>{f.source}</span>
            <div className="activity-body">
              <div className="activity-message">{f.message}</div>
              {f.detail && <div className="activity-detail">{f.detail}</div>}
            </div>
            <span className="activity-time">{relTime(f.ts)}</span>
          </div>
        );
      })}
    </div>
  );
}
