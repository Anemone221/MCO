import { IpcChannel } from '@shared/ipc';
import {
  createAccount,
  listAccounts,
  removeAccount,
  renameAccount,
  setAccountOmega,
} from '../../db/repositories/accounts';
import { handle } from '../handle';

export function registerAccountChannels(): void {
  handle(IpcChannel.accountsList, () => listAccounts());
  handle(IpcChannel.accountsCreate, (_event, label: string, color: string | null) =>
    createAccount(label, color),
  );
  handle(IpcChannel.accountsRename, (_event, id: number, label: string) =>
    renameAccount(id, label),
  );
  handle(IpcChannel.accountsSetOmega, (_event, id: number, isOmega: boolean) =>
    setAccountOmega(id, isOmega),
  );
  handle(IpcChannel.accountsRemove, (_event, id: number) => removeAccount(id));
}
