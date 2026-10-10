import type { ImplantInfo } from '@shared/types';

/**
 * Toggle for one pod's critical flag (undocking in it raises a warning while
 * the character is live-tracked). Renders nothing for a pod with no implants —
 * there is nothing to protect.
 *
 * The click is kept from bubbling: on the character sheet the toggle sits in a
 * `<summary>`, whose default action would open/close the clone instead.
 */
export default function CriticalCloneToggle({
  implants,
  critical,
  busy,
  onChange,
}: {
  implants: ImplantInfo[];
  critical: boolean;
  busy: boolean;
  onChange: (critical: boolean) => void;
}) {
  if (implants.length === 0) return null;
  return (
    <button
      type="button"
      className={critical ? 'chip chip--danger chip-button' : 'ghost btn-sm'}
      disabled={busy}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onChange(!critical);
      }}
      title={
        critical
          ? 'Critical — undocking in this implant set raises a warning. Click to unmark.'
          : 'Mark critical: warn whenever this character undocks wearing this implant set'
      }
      data-testid="critical-toggle"
    >
      {critical ? 'Critical' : 'Mark critical'}
    </button>
  );
}
