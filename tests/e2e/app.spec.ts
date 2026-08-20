import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';
import { appEnv } from '../support/electronEnv';

/**
 * Launch the built app against an isolated, throwaway userData directory.
 *
 * `env` overlays `appEnv()`, whose whole job is keeping the run off the network
 * — override a key only for a test that stays off it by other means.
 */
async function launchApp(
  userDataDir: string,
  env: Record<string, string> = {},
): Promise<ElectronApplication> {
  return electron.launch({
    args: ['out/main/index.js', '--no-sandbox', `--user-data-dir=${userDataDir}`],
    env: { ...appEnv(), ...env },
  });
}

test('launches with an empty roster and setup banners', async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'mco-e2e-'));
  const app = await launchApp(userDataDir);
  const window = await app.firstWindow();

  await expect(window.locator('h1')).toHaveText('MCO');
  await expect(window.locator('.empty-state h3')).toHaveText('No characters yet');

  // A fresh profile has no SDE imported, so the import prompt is shown.
  await expect(window.getByTestId('sde-import')).toBeVisible();

  await app.close();
});

test('creates an account that persists across restarts', async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'mco-e2e-'));

  const first = await launchApp(userDataDir);
  const firstWindow = await first.firstWindow();
  await firstWindow.getByRole('link', { name: 'Accounts' }).click();
  await firstWindow.getByTestId('new-account-input').fill('Main Account');
  await firstWindow.getByTestId('add-account').click();
  await expect(firstWindow.getByTestId('account-name-1')).toHaveValue('Main Account');
  await first.close();

  const second = await launchApp(userDataDir);
  const secondWindow = await second.firstWindow();
  await secondWindow.getByRole('link', { name: 'Accounts' }).click();
  await expect(secondWindow.getByTestId('account-name-1')).toHaveValue('Main Account');
  await second.close();
});

test('creates a usage group that persists across restarts', async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'mco-e2e-'));

  const first = await launchApp(userDataDir);
  const firstWindow = await first.firstWindow();
  await firstWindow.getByRole('link', { name: 'Groups' }).click();
  await firstWindow.getByTestId('new-group-input').fill('WH defense');
  await firstWindow.getByTestId('add-group').click();
  await expect(firstWindow.getByTestId('group-name-1')).toHaveValue('WH defense');
  await first.close();

  const second = await launchApp(userDataDir);
  const secondWindow = await second.firstWindow();
  await secondWindow.getByRole('link', { name: 'Groups' }).click();
  await expect(secondWindow.getByTestId('group-name-1')).toHaveValue('WH defense');

  // The group page opens with priority selectors and (with no characters) an
  // empty member state.
  await secondWindow.getByTestId('open-group-1').click();
  await expect(secondWindow.getByTestId('group-detail-name')).toHaveText('WH defense');
  await expect(secondWindow.getByTestId('priority-fit-select')).toBeVisible();
  await expect(secondWindow.getByTestId('priority-plan-select')).toBeVisible();
  // Pod whitelist starts empty: the section renders with its add-system hint.
  await expect(secondWindow.getByTestId('pod-whitelist')).toBeVisible();
  await expect(secondWindow.getByTestId('pod-whitelist-empty')).toBeVisible();
  // The Ignored tab is empty on a fresh profile.
  await secondWindow.getByTestId('pod-tab-ignored').click();
  await expect(secondWindow.getByTestId('pod-ignored-empty')).toBeVisible();
  // Collapsing hides the section body but keeps the header.
  await secondWindow.getByTestId('pod-whitelist-toggle').click();
  await expect(secondWindow.getByTestId('pod-whitelist-body')).toBeHidden();
  await secondWindow.getByTestId('pod-whitelist-toggle').click();
  await expect(secondWindow.getByTestId('pod-whitelist-body')).toBeVisible();
  await expect(secondWindow.getByTestId('group-detail-empty')).toBeVisible();
  await second.close();
});

test('creates a capability tag that persists across restarts', async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'mco-e2e-'));

  const first = await launchApp(userDataDir);
  const firstWindow = await first.firstWindow();
  await firstWindow.getByRole('link', { name: 'Tags' }).click();
  await firstWindow.getByTestId('new-tag-input').fill('Cyno');
  await firstWindow.getByTestId('add-tag').click();
  await expect(firstWindow.getByTestId('tag-name-1')).toHaveValue('Cyno');
  await first.close();

  const second = await launchApp(userDataDir);
  const secondWindow = await second.firstWindow();
  await secondWindow.getByRole('link', { name: 'Tags' }).click();
  await expect(secondWindow.getByTestId('tag-name-1')).toHaveValue('Cyno');
  await second.close();
});

test('opens the Location page', async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'mco-e2e-'));
  const app = await launchApp(userDataDir);
  const window = await app.firstWindow();

  await window.getByRole('link', { name: 'Location' }).click();
  await expect(window.locator('h2')).toContainText('Location');
  await expect(window.locator('.empty-state h3')).toHaveText('No characters yet');

  await app.close();
});

test('imports an EFT fit and shows it on the Fits page', async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'mco-e2e-'));
  const app = await launchApp(userDataDir);
  const window = await app.firstWindow();

  await window.getByRole('link', { name: 'Fits' }).click();
  await window.getByTestId('eft-input').fill('[Rifter, E2E Test Rifter]\n200mm AutoCannon II');
  await window.getByTestId('import-fit').click();

  await expect(window.getByTestId('fits-table')).toContainText('E2E Test Rifter');
  await expect(window.getByTestId('fits-table')).toContainText('Rifter');

  await app.close();
});

test('shows a failed import as plain copy, not as a raw internal error', async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'mco-e2e-'));
  const app = await launchApp(userDataDir);
  const window = await app.firstWindow();

  // A parse failure is deliberate user-facing copy (UserFacingError), so it
  // crosses the IPC boundary verbatim — and without the plumbing Electron wraps
  // a rejected handler in. See src/main/errors.ts.
  await window.getByRole('link', { name: 'Fits' }).click();
  await window.getByTestId('eft-input').fill('not a fit at all');
  await window.getByTestId('import-fit').click();

  const fitsError = window.getByTestId('fits-error');
  await expect(fitsError).toHaveText(
    'Not a valid EFT fit — the first line must be "[Ship, Fit name]"',
  );
  await expect(fitsError).not.toContainText('Error invoking remote method');

  await app.close();
});

test('reports a duplicate tag name without leaking SQL', async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'mco-e2e-'));
  const app = await launchApp(userDataDir);
  const window = await app.firstWindow();

  // tags(name) is UNIQUE COLLATE NOCASE. Unwrapped, better-sqlite3's message
  // would put "UNIQUE constraint failed: tags.name" on screen.
  await window.getByRole('link', { name: 'Tags' }).click();
  await window.getByTestId('new-tag-input').fill('Cyno');
  await window.getByTestId('add-tag').click();
  await expect(window.getByTestId('tag-name-1')).toHaveValue('Cyno');

  await window.getByTestId('new-tag-input').fill('cyno');
  await window.getByTestId('add-tag').click();

  const tagsError = window.getByTestId('tags-error');
  await expect(tagsError).toHaveText('That name is already in use.');
  await expect(tagsError).not.toContainText('UNIQUE constraint');

  await app.close();
});

test('imports a skill plan and shows it on the Plans page', async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'mco-e2e-'));
  const app = await launchApp(userDataDir);
  const window = await app.firstWindow();

  await window.getByRole('link', { name: 'Skill Plans' }).click();
  await window.getByTestId('plan-name-input').fill('E2E Test Plan');
  await window.getByTestId('plan-text-input').fill('Gunnery V\nSmall Hybrid Turret IV');
  await window.getByTestId('import-plan').click();

  await expect(window.getByTestId('plans-table')).toContainText('E2E Test Plan');

  await app.close();
});

test('hides a plan from the character sheets and remembers it across restarts', async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'mco-e2e-'));

  const first = await launchApp(userDataDir);
  const firstWindow = await first.firstWindow();
  await firstWindow.getByRole('link', { name: 'Skill Plans' }).click();
  await firstWindow.getByTestId('plan-name-input').fill('Sheet Toggle Plan');
  await firstWindow.getByTestId('plan-text-input').fill('Gunnery V');
  await firstWindow.getByTestId('import-plan').click();

  // A new plan shows on the sheets; the toggle is what takes it off them.
  const listToggle = firstWindow.getByTestId('plan-sheet-toggle-1');
  await expect(listToggle).toBeChecked();
  await listToggle.uncheck();
  await expect(firstWindow.getByTestId('plan-row-1')).toContainText('Hidden');
  await first.close();

  const second = await launchApp(userDataDir);
  const secondWindow = await second.firstWindow();
  await secondWindow.getByRole('link', { name: 'Skill Plans' }).click();
  await expect(secondWindow.getByTestId('plan-sheet-toggle-1')).not.toBeChecked();

  // The plan detail page shows the same flag, and setting it back there sticks.
  await secondWindow.getByRole('link', { name: 'Sheet Toggle Plan' }).click();
  const detailToggle = secondWindow.getByTestId('plan-sheet-toggle');
  await expect(detailToggle).not.toBeChecked();
  await detailToggle.check();
  await secondWindow.getByRole('link', { name: '← Skill Plans' }).click();
  await expect(secondWindow.getByTestId('plan-sheet-toggle-1')).toBeChecked();

  await second.close();
});

test('edits a plan in the creator, reorders it and saves it back', async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'mco-e2e-'));
  const app = await launchApp(userDataDir);
  const window = await app.firstWindow();

  await window.getByRole('link', { name: 'Skill Plans' }).click();
  await window.getByTestId('plan-name-input').fill('Reorder Me');
  await window.getByTestId('plan-text-input').fill('Gunnery V\nSmall Hybrid Turret IV');
  await window.getByTestId('import-plan').click();
  await expect(window.getByTestId('plans-table')).toContainText('Reorder Me');

  // A fresh profile has no SDE, so both lines load as unrecognised names — the
  // point here is that the creator keeps them verbatim rather than dropping
  // them, and that the reordered draft is what gets saved.
  await window.getByTestId('edit-plan-1').click();
  await expect(window.getByTestId('creator-name')).toHaveValue('Reorder Me');
  await expect(window.getByTestId('creator-row-0')).toContainText('Gunnery');
  await expect(window.getByTestId('creator-row-1')).toContainText('Small Hybrid Turret');

  await window.getByTestId('creator-down-0').click();
  await expect(window.getByTestId('creator-row-0')).toContainText('Small Hybrid Turret');

  await window.getByTestId('creator-save').click();
  await expect(window.locator('h2')).toContainText('Reorder Me');
  await window.locator('.fit-source summary').click();
  await expect(window.locator('.eft-block')).toHaveText(/Small Hybrid Turret IV\s+Gunnery V/);

  await app.close();
});

test('opens on the Dashboard by default, with Roster moved to its own nav entry', async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'mco-e2e-'));
  const app = await launchApp(userDataDir);
  const window = await app.firstWindow();

  // The Dashboard is the landing page now, but its empty-state copy matches
  // every other board page, so this stays consistent with a bare profile.
  await expect(window.locator('h2')).toContainText('Dashboard');
  await expect(window.getByTestId('dashboard-tiles')).toBeVisible();
  await expect(window.getByTestId('tile-characters-registered')).toContainText('0');
  // With no characters the SP packed-circles chart is replaced by the empty
  // state (and amCharts never initializes on an empty profile).
  await expect(window.locator('.empty-state h3')).toHaveText('No characters yet');

  // Roster still works, just at its own route now.
  await window.getByRole('link', { name: 'Roster' }).click();
  await expect(window.locator('h2')).toContainText('Roster');
  await expect(window.locator('.empty-state h3')).toHaveText('No characters yet');

  await app.close();
});

test('opens the Wallet page with the income chart placeholder', async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'mco-e2e-'));
  const app = await launchApp(userDataDir);
  const window = await app.firstWindow();

  await window.getByRole('link', { name: 'Wallet' }).click();
  await expect(window.locator('h2')).toContainText('Wallet');
  await expect(window.getByTestId('wallet-tiles')).toBeVisible();
  // No income this month → the chart card shows its quiet placeholder, so
  // amCharts never initializes on an empty profile.
  await expect(window.getByTestId('income-chart-empty')).toContainText(
    'No income recorded this month.',
  );

  // Previous months start collapsed; expanding an empty profile explains why
  // there is no history rather than drawing an empty chart.
  await expect(window.getByTestId('wallet-history-empty')).toHaveCount(0);
  await window.getByTestId('wallet-history-toggle').click();
  await expect(window.getByTestId('wallet-history-empty')).toContainText('No completed months');

  await app.close();
});

test('opens the Clones page', async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'mco-e2e-'));
  const app = await launchApp(userDataDir);
  const window = await app.firstWindow();

  await window.getByRole('link', { name: 'Clones' }).click();
  await expect(window.locator('h2')).toContainText('Clones');
  await expect(window.locator('.empty-state h3')).toHaveText('No characters yet');

  await app.close();
});

test('opens the Blueprints page, which explains it needs the SDE', async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'mco-e2e-'));
  const app = await launchApp(userDataDir);
  const window = await app.firstWindow();

  await window.getByRole('link', { name: 'Blueprints' }).click();
  await expect(window.locator('h2')).toContainText('Blueprints');
  // Without an SDE import there is no blueprint universe to check against, so
  // the page says so rather than claiming 0 of 0 blueprints owned.
  await expect(window.locator('.empty-state h3')).toHaveText('No blueprint data');
  // Tracking an alt corp is still offered — it is what the page is for.
  await expect(window.getByTestId('bp-add-corp')).toBeVisible();

  await app.close();
});

test('opens Settings from the gear and persists a theme change', async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'mco-e2e-'));

  const first = await launchApp(userDataDir);
  const firstWindow = await first.firstWindow();

  await firstWindow.getByTestId('settings-gear').click();
  await expect(firstWindow.locator('h2')).toContainText('Settings');

  // Sync status renders scheduler/SDE facts even on an empty profile.
  await expect(firstWindow.getByTestId('settings-page')).toContainText('Background sync');
  await expect(firstWindow.getByTestId('settings-page')).toContainText('No characters yet.');

  // ESI activity readout renders from its IPC channel on an empty profile.
  await expect(firstWindow.getByTestId('esi-activity-facts')).toContainText('Requests');

  // Collapsing the sync section hides the body but keeps the header squares.
  await expect(firstWindow.getByTestId('square-sync-fresh')).toBeVisible();
  await firstWindow.getByTestId('sync-status-toggle').click();
  await expect(firstWindow.getByTestId('sync-status-body')).toBeHidden();
  await expect(firstWindow.getByTestId('square-sync-fresh')).toBeVisible();
  await firstWindow.getByTestId('sync-status-toggle').click();
  await expect(firstWindow.getByTestId('sync-status-body')).toBeVisible();

  // GitHub links are present.
  await expect(firstWindow.getByRole('link', { name: 'GitHub repository' })).toBeVisible();
  await expect(firstWindow.getByRole('link', { name: 'Report an issue' })).toBeVisible();

  // CCP's third-party notice has to be displayed, not just written down
  // somewhere — see A5 in docs/improvement-plan.md.
  await expect(firstWindow.locator('.legal-notice')).toContainText(
    'is not in any way affiliated with, MCO',
  );

  // The profile's migration version, for bug reports (A6).
  await expect(firstWindow.getByTestId('settings-page')).toContainText(/schema v\d+/);

  // Switching theme applies immediately (data-theme on <html>)…
  await expect(firstWindow.locator('html')).toHaveAttribute('data-theme', 'dark');
  await firstWindow.locator('.theme-option', { hasText: 'Light' }).click();
  await expect(firstWindow.locator('html')).toHaveAttribute('data-theme', 'light');
  await first.close();

  // …and survives a restart.
  const second = await launchApp(userDataDir);
  const secondWindow = await second.firstWindow();
  await expect(secondWindow.locator('html')).toHaveAttribute('data-theme', 'light');
  await second.close();
});

test('demo mode toggle persists across restarts', async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'mco-e2e-'));

  const first = await launchApp(userDataDir);
  const firstWindow = await first.firstWindow();
  await firstWindow.getByTestId('settings-gear').click();
  const toggle = firstWindow.getByTestId('demo-mode-toggle');
  await expect(toggle).not.toBeChecked();
  await toggle.check();
  await expect(toggle).toBeChecked();
  await first.close();

  const second = await launchApp(userDataDir);
  const secondWindow = await second.firstWindow();
  await secondWindow.getByTestId('settings-gear').click();
  await expect(secondWindow.getByTestId('demo-mode-toggle')).toBeChecked();
  await second.close();
});

test('close-to-tray preference persists across restarts', async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'mco-e2e-'));

  // Unlike theme/demo mode this one lives in the database (app_settings), because
  // the main process reads it with no renderer around to ask.
  //
  // Click + expect, not check()/uncheck(): the box is fully controlled by state
  // that only lands after the IPC round trip, so check() verifies `checked` too
  // early and reports "clicking the checkbox did not change its state".
  const first = await launchApp(userDataDir);
  const firstWindow = await first.firstWindow();
  await firstWindow.getByTestId('settings-gear').click();
  const toggle = firstWindow.getByTestId('close-to-tray-toggle');
  await expect(toggle).not.toBeChecked();
  await toggle.click();
  await expect(toggle).toBeChecked();
  await first.close();

  const second = await launchApp(userDataDir);
  const secondWindow = await second.firstWindow();
  await secondWindow.getByTestId('settings-gear').click();
  const restored = secondWindow.getByTestId('close-to-tray-toggle');
  await expect(restored).toBeChecked();
  // Turning it back off keeps the profile quittable for the next run.
  await restored.click();
  await expect(restored).not.toBeChecked();
  await second.close();
});

test('"Run in background now" closes the window but keeps the app alive', async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'mco-e2e-'));
  const app = await launchApp(userDataDir);
  const window = await app.firstWindow();

  await window.getByTestId('settings-gear').click();
  await window.getByTestId('settings-run-in-background').click();

  // No windows left, but the process (and with it the hourly sweep) lives on.
  await expect.poll(() => app.windows().length).toBe(0);
  expect(await app.evaluate(({ app: electronApp }) => electronApp.isReady())).toBe(true);

  await app.close();
});

test('shows an empty notification bell on a fresh profile', async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'mco-e2e-'));
  const app = await launchApp(userDataDir);
  const window = await app.firstWindow();

  await expect(window.getByTestId('notification-bell-badge')).not.toBeVisible();

  await window.getByTestId('notification-bell-button').click();
  await expect(window.getByTestId('notification-bell-panel')).toContainText(
    'No notifications yet.',
  );

  await app.close();
});

test('asks once whether to check for updates, and remembers no', async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'mco-e2e-'));
  // The suite pins MCO_UPDATE_CHECK=0, which is a build that never checks and
  // so never asks either. This test is the question itself, so it opts the
  // build back in — and stays off the network regardless, because an
  // unanswered profile checks nothing and answering "no" checks nothing.
  const updatable = { MCO_UPDATE_CHECK: '1' };

  const first = await launchApp(userDataDir, updatable);
  const firstWindow = await first.firstWindow();
  await expect(firstWindow.getByTestId('update-consent')).toBeVisible();

  await firstWindow.getByTestId('update-consent-no').click();
  await expect(firstWindow.getByTestId('update-consent')).not.toBeVisible();
  // Settings agrees, and offers the same switch to change one's mind.
  await firstWindow.getByTestId('settings-gear').click();
  await expect(firstWindow.getByTestId('auto-update-toggle')).not.toBeChecked();
  await first.close();

  const second = await launchApp(userDataDir, updatable);
  const secondWindow = await second.firstWindow();
  // Answered once, ever: a profile that said no is not asked again at launch.
  await expect(secondWindow.getByTestId('settings-gear')).toBeVisible();
  await expect(secondWindow.getByTestId('update-consent')).not.toBeVisible();
  await second.close();
});
