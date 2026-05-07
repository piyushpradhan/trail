import React, { useEffect, useState } from 'react';
import type { UpdateStatus } from '@shared/types';

export function UpdateBanner(): JSX.Element | null {
  const [status, setStatus] = useState<UpdateStatus>({ kind: 'idle' });
  const [installing, setInstalling] = useState(false);

  useEffect(() => {
    void window.trail.updater.status().then(setStatus).catch(() => undefined);
    const off = window.trail.updater.onStatus((s) => setStatus(s));
    return () => off();
  }, []);

  if (status.kind === 'idle' || status.kind === 'checking' || status.kind === 'not-available') {
    return null;
  }

  if (status.kind === 'available') {
    return (
      <div className="update-banner info">
        <span>Update available — v{status.info.version}</span>
        <span className="update-banner-spacer">downloading…</span>
      </div>
    );
  }

  if (status.kind === 'downloading') {
    return (
      <div className="update-banner info">
        <span>Downloading update…</span>
        <span className="update-banner-spacer">{status.percent}%</span>
      </div>
    );
  }

  if (status.kind === 'downloaded') {
    return (
      <div className="update-banner ready">
        <span>Update v{status.version} ready</span>
        <button
          className="btn-primary update-banner-btn"
          onClick={async () => {
            setInstalling(true);
            try {
              await window.trail.updater.install();
            } finally {
              setInstalling(false);
            }
          }}
          disabled={installing}
        >
          {installing ? 'Restarting…' : 'Restart & install'}
        </button>
      </div>
    );
  }

  if (status.kind === 'error') {
    return (
      <div className="update-banner error">
        <span>Update check failed</span>
        <span className="update-banner-spacer" title={status.message}>
          {status.message.slice(0, 40)}
        </span>
      </div>
    );
  }

  return null;
}
