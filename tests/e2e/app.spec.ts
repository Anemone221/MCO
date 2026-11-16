import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';
import electronModule from 'electron';
import { appEnv } from '../support/electronEnv';

/** Outside Electron, requiring `electron` yields the path of its executable. */
const electronBinary = electronModule as unknown as string;

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

test('Ctrl+K jumps to a fit, and "/" focuses the page search', async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'mco-e2e-'));
  const app = await launchApp(userDataDir);
  const window = await app.firstWindow();

  await window.getByRole('link', { name: 'Fits' }).click();
  await window.getByTestId('eft-input').fill('[Rifter, Palette Rifter]\n200mm AutoCannon II');
  await window.getByTestId('import-fit').click();
  await expect(window.getByTestId('fits-table')).toContainText('Palette Rifter');

  await window.getByRole('link', { name: 'Dashboard' }).click();
  await window.keyboard.press('Control+K');
  await expect(window.getByTestId('command-palette')).toBeVisible();
  await window.getByTestId('palette-input').fill('palette rif');
  await expect(window.locator('[data-testid^="palette-item-fit:"]')).toHaveCount(1);
  await window.keyboard.press('Enter');
  await expect(window.getByTestId('command-palette')).toHaveCount(0);
  await expect(window.locator('h2')).toContainText('Palette Rifter');

  // Arrow keys move through pages; Escape closes without navigating.
  await window.keyboard.press('Control+K');
  await window.getByTestId('palette-input').fill('roster');
  await window.keyboard.press('Escape');
  await expect(window.getByTestId('command-palette')).toHaveCount(0);
  await expect(window.locator('h2')).toContainText('Palette Rifter');

  await window.keyboard.press('Control+K');
  await window.getByTestId('palette-input').fill('roster');
  await window.keyboard.press('Enter');
  await expect(window.locator('h2')).toHaveText('Roster');

  // A page's own search box: "/" from outside a text field, Ctrl+F from anywhere.
  await window.getByRole('link', { name: 'Mercenary Dens' }).click();
  const denFilter = window.getByRole('searchbox', { name: 'Filter dens' });
  await window.locator('h2').click();
  await window.keyboard.press('/');
  await expect(denFilter).toBeFocused();
  await expect(denFilter).toHaveValue('');
  await window.locator('h2').click();
  await window.keyboard.press('Control+F');
  await expect(denFilter).toBeFocused();

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

test('compares two skill plans', async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'mco-e2e-'));
  const app = await launchApp(userDataDir);
  const window = await app.firstWindow();

  await window.getByRole('link', { name: 'Skill Plans' }).click();
  const importPlan = async (name: string, text: string): Promise<void> => {
    await window.getByTestId('plan-name-input').fill(name);
    await window.getByTestId('plan-text-input').fill(text);
    await window.getByTestId('import-plan').click();
    await expect(window.getByTestId('plans-table')).toContainText(name);
  };
  await importPlan('Plan One', 'Gunnery V\nNavigation III');
  await window.getByTestId('toggle-import-plan').click();
  await importPlan('Plan Two', 'Gunnery III\nNavigation III\nMechanics IV');

  await window.getByTestId('compare-plans').click();
  await window.getByTestId('compare-plan-a').selectOption({ label: 'Plan One' });
  await window.getByTestId('compare-plan-b').selectOption({ label: 'Plan Two' });

  // No static data on a fresh profile, so skills are matched by name.
  const table = window.getByTestId('compare-table');
  await expect(table).toContainText('Gunnery');
  await expect(table).toContainText('A higher');
  await expect(table).toContainText('Mechanics');
  await expect(table).toContainText('Only in B');
  await expect(table).not.toContainText('Navigation');

  await window.getByTestId('compare-view-same').click();
  await expect(table).toContainText('Navigation');

  await window.getByTestId('compare-swap').click();
  await window.getByTestId('compare-view-differences').click();
  await expect(table).toContainText('Only in A');
  await expect(table).toContainText('B higher');

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

test('puts a plan on the roster and remembers it across restarts', async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'mco-e2e-'));

  const first = await launchApp(userDataDir);
  const firstWindow = await first.firstWindow();
  await firstWindow.getByRole('link', { name: 'Skill Plans' }).click();
  await firstWindow.getByTestId('plan-name-input').fill('Roster Toggle Plan');
  await firstWindow.getByTestId('plan-text-input').fill('Gunnery V');
  await firstWindow.getByTestId('import-plan').click();

  // Unlike the sheet flag, a new plan stays off the roster until asked.
  const listToggle = firstWindow.getByTestId('plan-roster-toggle-1');
  await expect(listToggle).not.toBeChecked();
  await listToggle.check();
  await first.close();

  const second = await launchApp(userDataDir);
  const secondWindow = await second.firstWindow();
  await secondWindow.getByRole('link', { name: 'Skill Plans' }).click();
  await expect(secondWindow.getByTestId('plan-roster-toggle-1')).toBeChecked();

  // The plan detail page shows the same flag, and clearing it there sticks.
  await secondWindow.getByRole('link', { name: 'Roster Toggle Plan' }).click();
  const detailToggle = secondWindow.getByTestId('plan-roster-toggle');
  await expect(detailToggle).toBeChecked();
  await detailToggle.uncheck();
  await secondWindow.getByRole('link', { name: '← Skill Plans' }).click();
  await expect(secondWindow.getByTestId('plan-roster-toggle-1')).not.toBeChecked();

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

test('keeps a plan\'s remap points through the creator and back into the saved text', async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'mco-e2e-'));
  const app = await launchApp(userDataDir);
  const window = await app.firstWindow();

  await window.getByRole('link', { name: 'Skill Plans' }).click();
  await window.getByTestId('plan-name-input').fill('Remap Me');
  await window
    .getByTestId('plan-text-input')
    .fill('Gunnery V\n[Remap] Int 27 Mem 21 Per 17 Wil 17 Cha 17\nSmall Hybrid Turret IV');
  await window.getByTestId('import-plan').click();
  await expect(window.getByTestId('plans-table')).toContainText('Remap Me');

  // The stored remap opens as a remap row above the line it preceded.
  await window.getByTestId('edit-plan-1').click();
  await expect(window.getByTestId('creator-remap-1')).toBeVisible();
  await expect(window.getByTestId('remap-1-intelligence')).toHaveValue('27');
  await expect(window.getByTestId('creator-remap-count')).toContainText('1');

  // Move it: drop the remap on row 1, put one ahead of row 0 instead.
  await window.getByTestId('remap-remove-1').click();
  await expect(window.getByTestId('creator-remap-1')).toHaveCount(0);
  await window.getByTestId('creator-add-remap-0').click();
  await expect(window.getByTestId('creator-remap-0')).toBeVisible();
  await window.getByTestId('remap-0-perception').fill('27');

  // With no static data nothing can be priced, so auto remap says so and
  // leaves the hand-placed remap alone.
  await window.getByTestId('auto-remap').click();
  await expect(window.getByTestId('creator-notice')).toContainText('no skill in the plan has training data');
  await expect(window.getByTestId('creator-remap-0')).toBeVisible();

  await window.getByTestId('creator-save').click();
  await expect(window.locator('h2')).toContainText('Remap Me');
  await window.locator('.fit-source summary').click();
  await expect(window.locator('.eft-block')).toHaveText(
    /^\[Remap\] Int \d+ Mem \d+ Per 27 Wil \d+ Cha \d+\s+Gunnery V\s+Small Hybrid Turret IV$/,
  );

  await app.close();
});

test('reorders the creator queue by dragging whole rows', async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'mco-e2e-'));
  const app = await launchApp(userDataDir);
  const window = await app.firstWindow();

  await window.getByRole('link', { name: 'Skill Plans' }).click();
  await window.getByTestId('plan-name-input').fill('Drag Me');
  await window.getByTestId('plan-text-input').fill('Alpha I\nBravo I\nCharlie I\nDelta I');
  await window.getByTestId('import-plan').click();
  await window.getByTestId('edit-plan-1').click();
  await expect(window.getByTestId('creator-row-0')).toContainText('Alpha');

  const order = async (): Promise<string[]> =>
    (await window.locator('[data-testid^="creator-reveal-"]').allTextContents()).map((text) =>
      text.replace(/^⠿|unknown/g, '').trim(),
    );

  /** Press on a row's name (not its grip) and drag to a height on another row. */
  const drag = async (from: number, to: number, where: 'upper' | 'lower', cancel = false) => {
    const source = (await window.getByTestId(`creator-row-${from}`).boundingBox())!;
    const target = (await window.getByTestId(`creator-row-${to}`).boundingBox())!;
    const y = where === 'upper' ? target.y + target.height * 0.2 : target.y + target.height * 0.8;
    await window.mouse.move(source.x + 160, source.y + source.height / 2);
    await window.mouse.down();
    await window.mouse.move(source.x + 160, source.y + source.height / 2 + 8, { steps: 2 });
    await window.mouse.move(source.x + 160, y, { steps: 8 });
    if (cancel) await window.keyboard.press('Escape');
    await window.mouse.up();
  };

  // Down: Alpha onto the lower half of Charlie lands after it.
  await drag(0, 2, 'lower');
  expect(await order()).toEqual(['Bravo', 'Charlie', 'Alpha', 'Delta']);

  // Up: Delta onto the upper half of the first row lands at the top.
  await drag(3, 0, 'upper');
  expect(await order()).toEqual(['Delta', 'Bravo', 'Charlie', 'Alpha']);

  // Escape mid-drag drops nothing.
  await drag(0, 3, 'lower', true);
  expect(await order()).toEqual(['Delta', 'Bravo', 'Charlie', 'Alpha']);

  // A plain click on a row is still a click, not a reorder.
  await window.getByTestId('creator-reveal-1').click();
  expect(await order()).toEqual(['Delta', 'Bravo', 'Charlie', 'Alpha']);

  await window.getByTestId('creator-save').click();
  await expect(window.locator('h2')).toContainText('Drag Me');
  await window.locator('.fit-source summary').click();
  await expect(window.locator('.eft-block')).toHaveText(/^Delta I\s+Bravo I\s+Charlie I\s+Alpha I$/);

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

test('opens the Mining page with an empty ledger', async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'mco-e2e-'));
  const app = await launchApp(userDataDir);
  const window = await app.firstWindow();

  await window.getByRole('link', { name: 'Mining' }).click();
  await expect(window.locator('h2')).toContainText('Mining');
  await expect(window.getByTestId('mining-tiles')).toBeVisible();
  // Nothing mined → the table says so and the by-day chart never renders, so
  // amCharts does not initialize on an empty profile.
  await expect(window.getByTestId('mining-table')).toContainText('No mining recorded');
  await expect(window.getByTestId('mining-chart')).toHaveCount(0);

  // The breakdown tabs swap the table's columns in place.
  await window.getByTestId('mining-breakdown-ore').click();
  await expect(window.getByTestId('mining-table')).toContainText('m³ / unit');
  await window.getByTestId('mining-breakdown-system').click();
  await expect(window.getByTestId('mining-table')).toContainText('Region');

  await app.close();
});

test('opens the Mercenary Dens page with no dens on record', async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'mco-e2e-'));
  const app = await launchApp(userDataDir);
  const window = await app.firstWindow();

  await window.getByRole('link', { name: 'Mercenary Dens' }).click();
  await expect(window.locator('h2')).toContainText('Mercenary Dens');
  await expect(window.getByTestId('mercenary-tiles')).toBeVisible();
  // A fresh profile has no characters, so it cannot even ask ESI about dens —
  // the empty state has to say that rather than imply the roster owns none.
  await expect(window.getByTestId('mercenary-empty')).toContainText(
    'No character has granted the scopes',
  );
  await expect(window.getByTestId('mercenary-table')).toHaveCount(0);

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
  // somewhere — the EVE Developer License Agreement requires it (README § Legal).
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

test('a notification type switched off stays off across restarts', async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'mco-e2e-'));

  // Stored in the database (app_settings), like close-to-tray: the main process
  // decides whether to raise a notification with no renderer around to ask.
  const first = await launchApp(userDataDir);
  const firstWindow = await first.firstWindow();
  await firstWindow.getByTestId('settings-gear').click();
  const toggle = firstWindow.getByTestId('notify-toggle-fatigue-clear');
  await expect(toggle).toBeChecked(); // every type defaults to on
  await toggle.click();
  await expect(toggle).not.toBeChecked();
  // Only the one that was clicked.
  await expect(firstWindow.getByTestId('notify-toggle-critical-undock')).toBeChecked();
  await first.close();

  const second = await launchApp(userDataDir);
  const secondWindow = await second.firstWindow();
  await secondWindow.getByTestId('settings-gear').click();
  await expect(secondWindow.getByTestId('notify-toggle-fatigue-clear')).not.toBeChecked();
  await expect(secondWindow.getByTestId('notify-toggle-queue-drain')).toBeChecked();
  await second.close();
});

test('takes a weekly backup on its own and writes a log file', async () => {
  test.setTimeout(90_000);
  const userDataDir = await mkdtemp(join(tmpdir(), 'mco-e2e-'));
  const app = await launchApp(userDataDir);
  const window = await app.firstWindow();
  await window.getByTestId('settings-gear').click();
  await expect(window.getByTestId('backups-empty')).toBeVisible();

  // The snapshot rides the first sweep, ~15 s after start. Nothing pushes it
  // to the page, so re-read until it shows.
  await expect(async () => {
    await window.getByRole('button', { name: 'Refresh' }).click();
    await expect(window.getByTestId('backups-table')).toContainText('Weekly', { timeout: 1000 });
  }).toPass({ timeout: 60_000 });

  await app.close();

  // The log outlives the process: this is what the next session's export reads.
  const log = await readFile(join(userDataDir, 'logs', 'mco.log'), 'utf8');
  expect(log).toContain('session started');
  expect(log).toContain('[backup] weekly snapshot saved');
});

test('restores a scheduled backup on the next start and keeps what it replaced', async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'mco-e2e-'));
  const snapshotName = 'mco-auto-20260101-000000.sqlite';

  // A profile with one tag, then a snapshot of it.
  const first = await launchApp(userDataDir);
  const firstWindow = await first.firstWindow();
  await firstWindow.getByRole('link', { name: 'Tags' }).click();
  await firstWindow.getByTestId('new-tag-input').fill('Cyno');
  await firstWindow.getByTestId('add-tag').click();
  await expect(firstWindow.getByTestId('tag-name-1')).toHaveValue('Cyno');
  await first.close();
  await mkdir(join(userDataDir, 'backups'), { recursive: true });
  await copyFile(join(userDataDir, 'mco.sqlite'), join(userDataDir, 'backups', snapshotName));

  // Something recorded after the snapshot, which the restore should take away.
  const second = await launchApp(userDataDir);
  const secondWindow = await second.firstWindow();
  await secondWindow.getByRole('link', { name: 'Tags' }).click();
  await secondWindow.getByTestId('new-tag-input').fill('Fax');
  await secondWindow.getByTestId('add-tag').click();
  await expect(secondWindow.getByTestId('tag-name-2')).toHaveValue('Fax');
  await second.close();

  // What Settings → Restore leaves behind before it restarts the app. Written
  // by hand because the restart itself would take the app out from under
  // Playwright.
  await writeFile(
    join(userDataDir, 'restore-pending.json'),
    JSON.stringify({ fileName: snapshotName }),
  );

  const third = await launchApp(userDataDir);
  const thirdWindow = await third.firstWindow();
  await thirdWindow.getByRole('link', { name: 'Tags' }).click();
  await expect(thirdWindow.getByTestId('tag-name-1')).toHaveValue('Cyno');
  await expect(thirdWindow.getByTestId('tag-name-2')).toHaveCount(0);
  // The database that was replaced is offered back, so a restore can be undone.
  await thirdWindow.getByTestId('settings-gear').click();
  await expect(thirdWindow.getByTestId('backups-table')).toContainText('Before the last restore');
  await third.close();
});

/**
 * Keep a sign-in test off the network and out of the user's browser: the SSO
 * page is never opened, and anything the main process tries to fetch fails as
 * if offline. The loopback listener, the pending-login state and the IPC
 * around them are the real thing.
 */
async function isolateSignIn(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ shell }) => {
    shell.openExternal = async () => {};
    globalThis.fetch = () => Promise.reject(new Error('offline in tests'));
  });
}

/**
 * Run SQL against a closed profile's database, inside Electron's Node — the
 * only runtime the native SQLite module is built for.
 */
function seedDatabase(userDataDir: string, sql: string): void {
  const script =
    `const db = require('better-sqlite3')(${JSON.stringify(join(userDataDir, 'mco.sqlite'))});` +
    `db.exec(${JSON.stringify(sql)}); db.close();`;
  execFileSync(electronBinary, ['-e', script], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  });
}

test('a waiting sign-in can be cancelled, and "Add several" runs until Done', async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'mco-e2e-'));
  const app = await launchApp(userDataDir);
  await isolateSignIn(app);
  const window = await app.firstWindow();
  await window.getByRole('link', { name: 'Roster' }).click();

  // One character: the wait can be called off instead of sat through.
  await window.getByTestId('add-character').click();
  await expect(window.getByTestId('add-status')).toContainText('Waiting for EVE SSO');
  await window.getByTestId('add-cancel').click();
  await expect(window.getByTestId('add-character')).toBeEnabled();
  // Cancelling is an outcome, not a failure.
  await expect(window.getByTestId('roster-error')).toHaveCount(0);

  // The port was freed by the cancel, so the next sign-in starts straight away.
  await window.getByTestId('add-several').click();
  await expect(window.getByTestId('add-status')).toContainText('0 added');
  await expect(window.getByTestId('add-cancel')).toHaveText('Done');
  await window.getByTestId('add-cancel').click();
  await expect(window.getByTestId('add-several')).toBeEnabled();
  await expect(window.getByTestId('roster-error')).toHaveCount(0);

  await app.close();
});

test('the re-authorize queue steps through characters that need a new sign-in', async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'mco-e2e-'));

  // First launch creates the schema; the characters go in while it is closed.
  const first = await launchApp(userDataDir);
  await first.firstWindow();
  await first.close();
  seedDatabase(
    userDataDir,
    // Tokens from before most of today's scopes existed.
    `INSERT INTO characters (id, name) VALUES (90000001, 'Reauth Alice'), (90000002, 'Reauth Bob');
     INSERT INTO tokens (character_id, refresh_token_encrypted, scopes) VALUES
       (90000001, X'00', 'esi-skills.read_skills.v1'),
       (90000002, X'00', 'esi-skills.read_skills.v1');`,
  );

  const app = await launchApp(userDataDir);
  await isolateSignIn(app);
  const window = await app.firstWindow();
  await window.getByRole('link', { name: 'Settings' }).click();

  const panel = window.getByTestId('reauth-panel');
  await expect(panel).toContainText('2 characters need a new EVE sign-in');

  await window.getByTestId('reauth-start').click();
  await expect(panel).toContainText('Sign in as Reauth Alice');
  await expect(panel).toContainText('1 of 2');

  // Skip moves on to the next character without ending the run…
  await window.getByTestId('reauth-skip').click();
  await expect(panel).toContainText('Sign in as Reauth Bob');
  await expect(panel).toContainText('2 of 2');

  // …and Stop ends it, leaving the rest in the queue.
  await window.getByTestId('reauth-stop').click();
  await expect(panel).toContainText('Stopped with 1 of 2 still to do');
  await expect(window.getByTestId('reauth-start')).toBeVisible();

  await app.close();
});

test('roster rows can be selected and changed in bulk', async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'mco-e2e-'));

  const first = await launchApp(userDataDir);
  await first.firstWindow();
  await first.close();
  seedDatabase(
    userDataDir,
    `INSERT INTO characters (id, name) VALUES
       (90000001, 'Sel Alice'), (90000002, 'Sel Bob'), (90000003, 'Sel Carol'), (90000004, 'Sel Dave');
     INSERT INTO accounts (id, label) VALUES (1, 'Main');
     INSERT INTO tags (id, name) VALUES (1, 'Cyno');
     INSERT INTO character_groups (id, name) VALUES (1, 'WH defense');`,
  );

  const app = await launchApp(userDataDir);
  const window = await app.firstWindow();
  await window.getByRole('link', { name: 'Roster' }).click();
  await expect(window.getByTestId('bulk-bar')).toHaveCount(0);

  // A click, then a shift-click two rows down: the range between is selected.
  await window.getByTestId('select-90000001').click();
  await window.getByTestId('select-90000003').click({ modifiers: ['Shift'] });
  await expect(window.getByTestId('bulk-count')).toContainText('3 selected');
  await expect(window.getByTestId('select-90000002')).toBeChecked();
  await expect(window.getByTestId('select-90000004')).not.toBeChecked();

  // One account for all three; the fourth is untouched.
  await window.getByTestId('bulk-account').selectOption({ label: 'Main' });
  for (const id of [90000001, 90000002, 90000003]) {
    await expect(window.getByTestId(`account-select-${id}`)).toHaveValue('1');
  }
  await expect(window.getByTestId('account-select-90000004')).toHaveValue('');
  // The selection survives the action, ready for the next one.
  await expect(window.getByTestId('bulk-count')).toContainText('3 selected');

  // A tag for all three, then taken off again.
  await window.getByTestId('bulk-tags').click();
  await expect(window.getByTestId('bulk-tags-remove-1')).toBeDisabled();
  await window.getByTestId('bulk-tags-add-1').click();
  await expect(window.getByTestId('bulk-tags-add-1')).toBeDisabled();
  await expect(window.getByTestId('roster-row-90000002')).toContainText('Cyno');
  await expect(window.getByTestId('roster-row-90000004')).not.toContainText('Cyno');
  await window.getByTestId('bulk-tags-remove-1').click();
  await expect(window.getByTestId('roster-row-90000002')).not.toContainText('Cyno');
  await window.keyboard.press('Escape');

  // And a group.
  await window.getByTestId('bulk-groups').click();
  await window.getByTestId('bulk-groups-add-1').click();
  await expect(window.getByTestId('bulk-groups-add-1')).toBeDisabled();
  await window.keyboard.press('Escape');

  // Filtering keeps the selection and says how much of it is out of sight;
  // the header box adds what is on screen.
  await window.getByTestId('roster-search').fill('Dave');
  await expect(window.getByTestId('bulk-count')).toContainText('3 hidden by filters');
  await window.getByTestId('select-all').click();
  await expect(window.getByTestId('bulk-count')).toContainText('4 selected');

  await window.getByTestId('bulk-clear').click();
  await expect(window.getByTestId('bulk-bar')).toHaveCount(0);

  await app.close();
});
