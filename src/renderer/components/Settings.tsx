import React, { useEffect, useState } from 'react';
import type { GithubStatus, SettingsSnapshot, TerminalDiagnostic } from '@shared/types';

interface Props {
  open: boolean;
  onClose: () => void;
}

export function Settings({ open, onClose }: Props): JSX.Element | null {
  const [snapshot, setSnapshot] = useState<SettingsSnapshot | null>(null);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  // GitHub-specific
  const [ghToken, setGhToken] = useState('');
  const [ghStatus, setGhStatus] = useState<GithubStatus | null>(null);
  const [ghTesting, setGhTesting] = useState(false);
  const [ghIncludeDraft, setGhIncludeDraft] = useState('');
  const [ghExcludeDraft, setGhExcludeDraft] = useState('');

  // Terminal-specific
  const [termDiag, setTermDiag] = useState<TerminalDiagnostic | null>(null);
  const [termScanning, setTermScanning] = useState(false);

  // Shell hook
  const [hookInfo, setHookInfo] = useState<{ port: number; psScriptPath: string; shScriptPath: string } | null>(null);

  const refresh = async () => {
    const s = await window.trail.settings.get();
    setSnapshot(s);
    setGhIncludeDraft(s.github.repoInclude.join(', '));
    setGhExcludeDraft(s.github.repoExclude.join(', '));
  };

  useEffect(() => {
    if (!open) return;
    setStatus(null);
    setDraft('');
    setGhToken('');
    setGhStatus(null);
    void refresh();
    void Promise.resolve(window.trail.settings.diagnoseGithub?.())
      .then((s) => s && setGhStatus(s))
      .catch(() => undefined);
    void Promise.resolve(window.trail.settings.diagnoseTerminal?.())
      .then((s) => s && setTermDiag(s))
      .catch(() => undefined);
    void Promise.resolve(window.trail.settings.getHookInfo?.())
      .then((s) => s && setHookInfo(s))
      .catch(() => undefined);
  }, [open]);

  if (!open) return null;

  // ---- Anthropic API key ----
  const saveKey = async () => {
    if (!draft.trim()) return;
    setSaving(true);
    try {
      await window.trail.settings.setApiKey(draft.trim());
      await refresh();
      setDraft('');
      setStatus('API key saved.');
    } catch (err) {
      setStatus(`Failed: ${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  const clearKey = async () => {
    await window.trail.settings.clearApiKey();
    await refresh();
    setStatus('API key cleared.');
  };

  const toggleReconciler = async (enabled: boolean) => {
    await window.trail.settings.setReconcilerEnabled(enabled);
    await refresh();
  };

  const runNow = async () => {
    setRunning(true);
    setStatus('Reconciling…');
    try {
      const r = await window.trail.reconciler.run();
      setStatus(
        r.reason
          ? `Skipped: ${r.reason}`
          : `Done — ${r.created} created · ${r.merged} merged · ${r.skipped} skipped`,
      );
    } catch (err) {
      setStatus(`Error: ${(err as Error).message}`);
    } finally {
      setRunning(false);
    }
  };

  // ---- GitHub ----
  const saveGhToken = async () => {
    if (!ghToken.trim()) return;
    await window.trail.settings.setGithubToken(ghToken.trim());
    setGhToken('');
    await refresh();
    setGhStatus(await window.trail.settings.diagnoseGithub());
  };

  const clearGhToken = async () => {
    await window.trail.settings.clearGithubToken();
    await refresh();
    setGhStatus(await window.trail.settings.diagnoseGithub());
  };

  const toggleGh = async (enabled: boolean) => {
    await window.trail.settings.setGithubEnabled(enabled);
    await refresh();
  };

  const testGh = async () => {
    setGhTesting(true);
    try {
      setGhStatus(await window.trail.settings.diagnoseGithub());
    } finally {
      setGhTesting(false);
    }
  };

  const saveGhFilters = async () => {
    const inc = ghIncludeDraft.split(',').map((s) => s.trim()).filter(Boolean);
    const exc = ghExcludeDraft.split(',').map((s) => s.trim()).filter(Boolean);
    await window.trail.settings.setGithubRepoFilters(inc, exc);
    await refresh();
    setStatus('Repo filters saved.');
  };

  // ---- Terminal ----
  const rescanTerminal = async () => {
    setTermScanning(true);
    try {
      const r = await window.trail.settings.diagnoseTerminal?.();
      if (r) setTermDiag(r);
    } catch (err) {
      setStatus(`Terminal scan error: ${(err as Error).message}`);
    } finally {
      setTermScanning(false);
    }
  };

  const syncTerminalNow = async () => {
    try {
      const r = await window.trail.collectors.runOne('terminal');
      setStatus(`Terminal synced — ${r.created} new`);
      setTermDiag(await window.trail.settings.diagnoseTerminal());
    } catch (err) {
      setStatus(`Terminal sync failed: ${(err as Error).message}`);
    }
  };

  const syncGhNow = async () => {
    try {
      const r = await window.trail.collectors.runOne('github');
      setStatus(`GitHub synced — ${r.created} new`);
    } catch (err) {
      setStatus(`GitHub sync failed: ${(err as Error).message}`);
    }
  };

  const ghDot = ghStatus
    ? ghStatus.ok
      ? 'ok'
      : 'error'
    : 'unknown';
  const ghLabel = ghStatus
    ? ghStatus.ok
      ? `${ghStatus.mode === 'pat' ? 'Token' : 'gh CLI'} · ${ghStatus.user ?? 'connected'}`
      : `Not connected (${ghStatus.mode})`
    : 'Checking…';

  return (
    <div className="palette-backdrop" onMouseDown={onClose}>
      <div className="settings" onMouseDown={(e) => e.stopPropagation()}>
        <div className="settings-header">
          <span>Settings</span>
          <button className="icon-btn" onClick={onClose} title="Close">×</button>
        </div>

        <div className="settings-scroll">
          {/* Shell hook */}
          <div className="settings-section">
            <div className="settings-label">
              <span className="status-dot ok" /> Shell session hook
            </div>
            <div className="settings-sub">
              Local listener on port {hookInfo?.port ?? '...'}. Source the script in your shell
              profile to auto-create a task whenever you open a terminal.
            </div>
            <div className="settings-sub mono">
              {hookInfo ? (
                <>
                  <strong>PowerShell:</strong> add to <code>$PROFILE</code>:
                  {'\n'}. "{hookInfo.psScriptPath}"
                  {'\n\n'}
                  <strong>bash/zsh:</strong> add to ~/.bashrc or ~/.zshrc:
                  {'\n'}source "{hookInfo.shScriptPath}"
                </>
              ) : (
                'Loading…'
              )}
            </div>
            <div className="settings-sub">
              The hook also exposes <code>trail-task &quot;title&quot;</code> for one-off tasks
              from any shell.
            </div>
          </div>

          {/* Terminal */}
          <div className="settings-section">
            <div className="settings-label">
              <span
                className={`status-dot ${termDiag ? (termDiag.discovered.length > 0 ? 'ok' : 'error') : 'unknown'}`}
              />
              Terminal sessions
            </div>
            <div className="settings-sub">
              {termDiag
                ? `${termDiag.discovered.length} shell histor${termDiag.discovered.length === 1 ? 'y' : 'ies'} found on ${termDiag.platform}`
                : 'Scanning…'}
            </div>

            {termDiag && termDiag.discovered.length > 0 && (
              <div className="settings-sub mono">
                {termDiag.discovered
                  .map((d) => `${d.name}  ${(d.sizeBytes / 1024).toFixed(1)}KB  ${d.path}`)
                  .join('\n')}
              </div>
            )}

            {termDiag && termDiag.discovered.length === 0 && (
              <div className="settings-sub mono">
                {termDiag.attempted.map((a) => `× ${a.name}: ${a.path}`).join('\n')}
                {'\n\n'}Hint: run a few commands in PowerShell to populate
                ConsoleHost_history.txt, then click Rescan.
              </div>
            )}

            <div className="settings-row">
              <button className="btn-ghost" onClick={() => void rescanTerminal()} disabled={termScanning}>
                {termScanning ? 'Scanning…' : 'Rescan'}
              </button>
              <button className="btn-primary" onClick={() => void syncTerminalNow()}>
                Sync now
              </button>
            </div>
          </div>

          {/* GitHub */}
          <div className="settings-section">
            <div className="settings-label">
              <span className={`status-dot ${ghDot}`} /> GitHub
            </div>
            <div className="settings-sub">{ghLabel}</div>

            {ghStatus?.message && (
              <div className="settings-sub mono">{ghStatus.message.slice(0, 200)}</div>
            )}

            <label className="settings-row">
              <input
                type="checkbox"
                checked={snapshot?.github.enabled ?? false}
                onChange={(e) => void toggleGh(e.target.checked)}
              />
              <span>Enabled</span>
            </label>

            {snapshot?.github.hasToken ? (
              <div className="settings-row">
                <span className="settings-state ok">Token saved</span>
                <button className="btn-ghost" onClick={() => void clearGhToken()}>Remove</button>
              </div>
            ) : (
              <div className="settings-row">
                <input
                  className="settings-input"
                  type="password"
                  placeholder="github_pat_… or ghp_…"
                  value={ghToken}
                  onChange={(e) => setGhToken(e.target.value)}
                />
                <button
                  className="btn-primary"
                  onClick={() => void saveGhToken()}
                  disabled={!ghToken.trim()}
                >
                  Save
                </button>
              </div>
            )}

            <div className="settings-sub">
              Without token, falls back to local <code>gh</code> CLI auth.
            </div>

            <div className="settings-sub">Include repos (substring match, comma-separated)</div>
            <input
              className="settings-input"
              placeholder="acme/, owner/myrepo"
              value={ghIncludeDraft}
              onChange={(e) => setGhIncludeDraft(e.target.value)}
            />
            <div className="settings-sub">Exclude repos</div>
            <input
              className="settings-input"
              placeholder="archive, sandbox"
              value={ghExcludeDraft}
              onChange={(e) => setGhExcludeDraft(e.target.value)}
            />

            <div className="settings-row">
              <button className="btn-ghost" onClick={() => void testGh()} disabled={ghTesting}>
                {ghTesting ? 'Testing…' : 'Test connection'}
              </button>
              <button className="btn-ghost" onClick={() => void saveGhFilters()}>
                Save filters
              </button>
              <button className="btn-primary" onClick={() => void syncGhNow()}>
                Sync now
              </button>
            </div>
          </div>

          {/* Anthropic */}
          <div className="settings-section">
            <div className="settings-label">Anthropic API key</div>
            <div className="settings-sub">
              Enables LLM reconciler (Haiku 4.5). Stored encrypted via OS keychain.
            </div>
            {snapshot?.hasApiKey ? (
              <div className="settings-row">
                <span className="settings-state ok">Configured</span>
                <button className="btn-ghost" onClick={() => void clearKey()}>Remove</button>
              </div>
            ) : (
              <div className="settings-row">
                <input
                  className="settings-input"
                  type="password"
                  placeholder="sk-ant-…"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                />
                <button
                  className="btn-primary"
                  onClick={() => void saveKey()}
                  disabled={saving || !draft.trim()}
                >
                  {saving ? 'Saving…' : 'Save'}
                </button>
              </div>
            )}
          </div>

          {/* Reconciler */}
          <div className="settings-section">
            <div className="settings-label">Reconciler</div>
            <div className="settings-sub">
              Reviews rejected prompts every {snapshot?.reconciler.intervalMinutes ?? 30} min.
            </div>
            <label className="settings-row">
              <input
                type="checkbox"
                checked={snapshot?.reconciler.enabled ?? false}
                onChange={(e) => void toggleReconciler(e.target.checked)}
              />
              <span>Enabled</span>
            </label>
            <div className="settings-row">
              <button
                className="btn-primary"
                onClick={() => void runNow()}
                disabled={running || !snapshot?.hasApiKey}
              >
                {running ? 'Running…' : 'Run now'}
              </button>
            </div>
          </div>
        </div>

        {status && <div className="settings-status">{status}</div>}
      </div>
    </div>
  );
}
