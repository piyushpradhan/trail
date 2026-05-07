import React, { useEffect, useState } from 'react';
import type { GithubStatus, LinearStatus, SettingsSnapshot } from '@shared/types';
import { CheckIcon } from '../icons';

interface Props {
  open: boolean;
  onClose: () => void;
  onSettingsClick: () => void;
}

type Step = 'github' | 'linear' | 'hook' | 'done';

const STEPS: { id: Step; title: string; description: string }[] = [
  {
    id: 'github',
    title: 'Connect GitHub',
    description: 'Track your PRs and assigned issues. Status auto-flips on merge or review request.',
  },
  {
    id: 'linear',
    title: 'Connect Linear (optional)',
    description: 'Pull assigned issues. Status mirrors your Linear workflow state.',
  },
  {
    id: 'hook',
    title: 'Install shell hook',
    description: 'Every new terminal becomes a tracked task tagged with repo + branch.',
  },
];

export function Onboarding({ open, onClose, onSettingsClick }: Props): JSX.Element | null {
  const [step, setStep] = useState<Step>('github');
  const [snapshot, setSnapshot] = useState<SettingsSnapshot | null>(null);
  const [ghStatus, setGhStatus] = useState<GithubStatus | null>(null);
  const [linearStatus, setLinearStatus] = useState<LinearStatus | null>(null);

  // GitHub PAT input
  const [ghToken, setGhToken] = useState('');
  const [ghBusy, setGhBusy] = useState(false);

  // Linear PAT input
  const [linearToken, setLinearToken] = useState('');
  const [linearBusy, setLinearBusy] = useState(false);

  // Hook install
  const [hookShell, setHookShell] = useState<'powershell' | 'bash' | 'zsh'>('powershell');
  const [hookBusy, setHookBusy] = useState(false);
  const [hookMessage, setHookMessage] = useState<string | null>(null);

  const refresh = async () => {
    const s = await window.trail.settings.get();
    setSnapshot(s);
  };

  useEffect(() => {
    if (!open) return;
    void refresh();
    void Promise.resolve(window.trail.settings.diagnoseGithub?.())
      .then((r) => r && setGhStatus(r))
      .catch(() => undefined);
    void Promise.resolve(window.trail.settings.diagnoseLinear?.())
      .then((r) => r && setLinearStatus(r))
      .catch(() => undefined);
    void Promise.resolve(window.trail.settings.suggestedShell?.())
      .then((r) => r && setHookShell(r))
      .catch(() => undefined);
  }, [open]);

  if (!open) return null;

  const githubDone = !!(snapshot?.github.hasToken || ghStatus?.ok);
  const linearDone = !!snapshot?.linear.hasToken;
  const hookDone = !!hookMessage?.includes('Installed') || !!hookMessage?.includes('Already');

  const saveGh = async () => {
    if (!ghToken.trim()) return;
    setGhBusy(true);
    try {
      await window.trail.settings.setGithubToken(ghToken.trim());
      const s = await window.trail.settings.diagnoseGithub();
      setGhStatus(s);
      await refresh();
      setGhToken('');
      if (s.ok) setStep('linear');
    } finally {
      setGhBusy(false);
    }
  };

  const skipGhUseCli = async () => {
    const s = await window.trail.settings.diagnoseGithub();
    setGhStatus(s);
    await refresh();
    if (s.ok) setStep('linear');
    else setStep('linear'); // user can retry from Settings later
  };

  const saveLinear = async () => {
    if (!linearToken.trim()) return;
    setLinearBusy(true);
    try {
      await window.trail.settings.setLinearToken(linearToken.trim());
      const s = await window.trail.settings.diagnoseLinear();
      setLinearStatus(s);
      await refresh();
      setLinearToken('');
      setStep('hook');
    } finally {
      setLinearBusy(false);
    }
  };

  const skipLinear = () => setStep('hook');

  const installHook = async () => {
    setHookBusy(true);
    setHookMessage(null);
    try {
      const r = await window.trail.settings.installShellHook(hookShell);
      setHookMessage(
        r.ok
          ? r.alreadyInstalled
            ? 'Already installed'
            : `Installed at ${r.profilePath}`
          : `Failed: ${r.message}`,
      );
    } catch (err) {
      setHookMessage(`Failed: ${(err as Error).message}`);
    } finally {
      setHookBusy(false);
    }
  };

  const finish = async () => {
    await window.trail.settings.setOnboardingComplete(true);
    onClose();
  };

  const skipAll = async () => {
    await window.trail.settings.setOnboardingComplete(true);
    onClose();
  };

  return (
    <div className="palette-backdrop" onMouseDown={onClose}>
      <div className="onboarding" onMouseDown={(e) => e.stopPropagation()}>
        <div className="settings-header">
          <span>Welcome to Trail</span>
          <button className="btn-ghost" onClick={() => void skipAll()}>
            Skip
          </button>
        </div>

        <div className="onboarding-progress">
          {STEPS.map((s, i) => {
            const done =
              (s.id === 'github' && githubDone) ||
              (s.id === 'linear' && linearDone) ||
              (s.id === 'hook' && hookDone);
            const active = step === s.id;
            return (
              <div
                key={s.id}
                className={`onboarding-step-pill ${done ? 'done' : ''} ${active ? 'active' : ''}`}
                onClick={() => setStep(s.id)}
              >
                <span className="onboarding-step-num">
                  {done ? <CheckIcon /> : i + 1}
                </span>
                <span className="onboarding-step-label">{s.title.split(' ')[1] ?? s.title}</span>
              </div>
            );
          })}
        </div>

        <div className="onboarding-body">
          {step === 'github' && (
            <>
              <div className="onboarding-title">Connect GitHub</div>
              <div className="onboarding-desc">
                Paste a personal access token with <code>repo</code> + <code>read:user</code>{' '}
                scopes. Get one at{' '}
                <a
                  href="#"
                  onClick={(e) => {
                    e.preventDefault();
                    window.trail.app.openExternal('https://github.com/settings/tokens/new');
                  }}
                >
                  github.com/settings/tokens/new
                </a>
                . Or skip and use the local <code>gh</code> CLI.
              </div>
              {githubDone ? (
                <div className="settings-sub ok">✓ Connected as {ghStatus?.user ?? '...'}</div>
              ) : (
                <>
                  <div className="settings-row">
                    <input
                      className="settings-input"
                      type="password"
                      placeholder="ghp_… or github_pat_…"
                      value={ghToken}
                      onChange={(e) => setGhToken(e.target.value)}
                    />
                    <button
                      className="btn-primary"
                      onClick={() => void saveGh()}
                      disabled={ghBusy || !ghToken.trim()}
                    >
                      {ghBusy ? 'Saving…' : 'Connect'}
                    </button>
                  </div>
                  {ghStatus && !ghStatus.ok && (
                    <div className="settings-sub error">{ghStatus.message}</div>
                  )}
                </>
              )}
              <div className="onboarding-actions">
                <button className="btn-ghost" onClick={() => void skipGhUseCli()}>
                  Use gh CLI / skip
                </button>
                <button
                  className="btn-primary"
                  onClick={() => setStep('linear')}
                  disabled={!githubDone}
                >
                  Next
                </button>
              </div>
            </>
          )}

          {step === 'linear' && (
            <>
              <div className="onboarding-title">Connect Linear (optional)</div>
              <div className="onboarding-desc">
                Get a personal API key at{' '}
                <a
                  href="#"
                  onClick={(e) => {
                    e.preventDefault();
                    window.trail.app.openExternal('https://linear.app/settings/api');
                  }}
                >
                  linear.app/settings/api
                </a>
                . Skip if you don't use Linear.
              </div>
              {linearDone ? (
                <div className="settings-sub ok">
                  ✓ Connected as {linearStatus?.user ?? '...'}
                </div>
              ) : (
                <div className="settings-row">
                  <input
                    className="settings-input"
                    type="password"
                    placeholder="lin_api_…"
                    value={linearToken}
                    onChange={(e) => setLinearToken(e.target.value)}
                  />
                  <button
                    className="btn-primary"
                    onClick={() => void saveLinear()}
                    disabled={linearBusy || !linearToken.trim()}
                  >
                    {linearBusy ? 'Saving…' : 'Connect'}
                  </button>
                </div>
              )}
              <div className="onboarding-actions">
                <button className="btn-ghost" onClick={skipLinear}>
                  Skip Linear
                </button>
                <button className="btn-primary" onClick={() => setStep('hook')}>
                  Next
                </button>
              </div>
            </>
          )}

          {step === 'hook' && (
            <>
              <div className="onboarding-title">Install shell hook</div>
              <div className="onboarding-desc">
                Adds a single sourced line to your shell profile so every new terminal pings Trail.
                Backed up to <code>.trail.bak</code> before any change.
              </div>
              <div className="settings-row">
                <select
                  className="settings-input"
                  value={hookShell}
                  onChange={(e) => setHookShell(e.target.value as typeof hookShell)}
                >
                  <option value="powershell">PowerShell ($PROFILE)</option>
                  <option value="bash">bash (~/.bashrc)</option>
                  <option value="zsh">zsh (~/.zshrc)</option>
                </select>
                <button
                  className="btn-primary"
                  onClick={() => void installHook()}
                  disabled={hookBusy}
                >
                  {hookBusy ? 'Installing…' : 'Install'}
                </button>
              </div>
              {hookMessage && (
                <div className={`settings-sub ${hookMessage.startsWith('Failed') ? 'error' : 'ok'}`}>
                  {hookMessage}
                </div>
              )}
              <div className="onboarding-actions">
                <button className="btn-ghost" onClick={() => void finish()}>
                  Skip hook
                </button>
                <button className="btn-primary" onClick={() => void finish()}>
                  Done
                </button>
              </div>
            </>
          )}
        </div>

        <div className="onboarding-footer">
          <span>You can change any of this later from Settings.</span>
          <button className="btn-ghost" onClick={onSettingsClick}>
            Open full Settings
          </button>
        </div>
      </div>
    </div>
  );
}
