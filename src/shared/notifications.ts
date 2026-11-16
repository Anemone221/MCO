/**
 * The notification kinds MCO can raise, with the wording Settings shows beside
 * each one's switch. A kind's `kind` string is what its rows carry in the
 * `notifications` table and what its preference is stored under, so it must
 * not change once released.
 *
 * Adding a kind means adding it here as well as raising it: a kind missing
 * from this list still delivers (unknown kinds default to on) but cannot be
 * switched off.
 */
export const NOTIFICATION_KINDS = [
  {
    kind: 'queue-drain',
    label: 'Skill queue about to run dry',
    description: 'A character is on the last skill in its queue.',
  },
  {
    kind: 'omega-idle',
    label: 'Omega account training nobody',
    description: 'No character on an Omega account is training. Once a day per account.',
  },
  {
    kind: 'fatigue-clear',
    label: 'Jump fatigue cleared',
    description: "A character's jump fatigue has finished decaying.",
  },
  {
    kind: 'clone-jump-ready',
    label: 'Clone jump ready',
    description: "A character's clone-jump cooldown has ended.",
  },
  {
    kind: 'critical-undock',
    label: 'Undocked in a critical clone',
    description: 'An online character is in space wearing a pod marked critical.',
  },
] as const;

export type NotificationKind = (typeof NOTIFICATION_KINDS)[number]['kind'];

/** Whether each kind is switched on. Every kind is present; the default is on. */
export type NotificationPreferences = Record<NotificationKind, boolean>;

export function isNotificationKind(value: string): value is NotificationKind {
  return NOTIFICATION_KINDS.some((k) => k.kind === value);
}
