import type { McoApi } from '@shared/ipc';

/** The preload-exposed main-process API. */
export const mco: McoApi = window.mco;
