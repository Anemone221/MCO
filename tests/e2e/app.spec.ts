import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';

/**
 * The host environment sets ELECTRON_RUN_AS_NODE=1, which would make Electron
 * run as plain Node (no window). Strip it before launching the app.
 */
function appEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && key !== 'ELECTRON_RUN_AS_NODE') env[key] = value;
  }
  return env;
}

/** Launch the built app against an isolated, throwaway userData directory. */
async function launchApp(userDataDir: string): Promise<ElectronApplication> {
  return electron.launch({
    args: ['out/main/index.js', '--no-sandbox', `--user-data-dir=${userDataDir}`],
    env: appEnv(),
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
