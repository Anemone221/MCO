import type { McoApi } from '@shared/ipc';

declare global {
  interface Window {
    mco: McoApi;
  }
}

export {};
