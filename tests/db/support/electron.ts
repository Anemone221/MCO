/**
 * Stand-in for the `electron` module in the database-backed suite (aliased in
 * `vitest.db.config.ts`). Only what main-process code reaches for outside a
 * window: the profile folder, token encryption, the browser hand-off, dialogs.
 */

let userDataDir: string | null = null;

/** Point `app.getPath('userData')` at a test's throwaway profile folder. */
export function setUserDataDir(dir: string | null): void {
  userDataDir = dir;
}

/** URLs handed to the browser, oldest first — the SSO authorize pages. */
export const openedUrls: string[] = [];

/** What `shell.openExternal` does next; replaceable to simulate a browser that won't open. */
let openExternalImpl: (url: string) => Promise<void> = async () => {};

export function setOpenExternal(impl: ((url: string) => Promise<void>) | null): void {
  openExternalImpl = impl ?? (async () => {});
}

export const app = {
  isPackaged: false,
  getPath(name: string): string {
    if (userDataDir === null) {
      throw new Error(`app.getPath('${name}') was called outside a test profile`);
    }
    return userDataDir;
  },
  getVersion: (): string => '0.0.0-test',
  relaunch(): void {},
  exit(): void {},
};

const ENCRYPTED_PREFIX = 'enc:';

/** Reversible and obviously not plaintext, so a test can tell the two apart. */
export const safeStorage = {
  isEncryptionAvailable: (): boolean => true,
  encryptString: (plain: string): Buffer => Buffer.from(ENCRYPTED_PREFIX + plain, 'utf8'),
  decryptString(encrypted: Buffer): string {
    const text = Buffer.from(encrypted).toString('utf8');
    if (!text.startsWith(ENCRYPTED_PREFIX)) throw new Error('not an encrypted value');
    return text.slice(ENCRYPTED_PREFIX.length);
  },
};

export const shell = {
  async openExternal(url: string): Promise<void> {
    openedUrls.push(url);
    await openExternalImpl(url);
  },
  openPath: async (): Promise<string> => '',
};

/** Index of the button "pressed" on the next blocking message box; 1 approves a prod migration. */
let messageBoxChoice = 1;

export function setMessageBoxChoice(choice: number): void {
  messageBoxChoice = choice;
}

export const dialog = {
  showErrorBox(): void {},
  showMessageBoxSync: (): number => messageBoxChoice,
  showSaveDialog: async (): Promise<{ canceled: boolean; filePath?: string }> => ({
    canceled: true,
  }),
};

/** What `net.isOnline()` answers; tests flip it to take the machine "offline". */
let online = true;

export function setOnline(value: boolean): void {
  online = value;
}

export const net = {
  isOnline: (): boolean => online,
};

type PowerListener = () => void;
const powerListeners = new Map<string, Set<PowerListener>>();

interface PowerMonitorStub {
  on(event: string, listener: PowerListener): PowerMonitorStub;
  off(event: string, listener: PowerListener): PowerMonitorStub;
  /** Test-only: fire an event the way the OS would. */
  emit(event: string): void;
}

/** Just enough of Electron's `powerMonitor` to subscribe, unsubscribe and be woken by a test. */
export const powerMonitor: PowerMonitorStub = {
  on(event, listener) {
    let set = powerListeners.get(event);
    if (!set) powerListeners.set(event, (set = new Set()));
    set.add(listener);
    return powerMonitor;
  },
  off(event, listener) {
    powerListeners.get(event)?.delete(listener);
    return powerMonitor;
  },
  emit(event) {
    for (const listener of powerListeners.get(event) ?? []) listener();
  },
};

export class Notification {
  static isSupported(): boolean {
    return false;
  }
  on(): this {
    return this;
  }
  show(): void {}
}
