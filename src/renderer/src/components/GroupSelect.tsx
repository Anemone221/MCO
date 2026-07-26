import type { CharacterGroup } from '@shared/types';
import type { GroupFilter } from '../lib/groups';

/** A dropdown that narrows a view to one usage group. Empty when no groups exist. */
export default function GroupSelect({
  groups,
  value,
  onChange,
  testId,
}: {
  groups: CharacterGroup[];
  value: GroupFilter;
  onChange: (value: GroupFilter) => void;
  testId?: string;
}) {
  if (groups.length === 0) return null;
  return (
    <select
      value={value === 'all' ? 'all' : String(value)}
      onChange={(e) => onChange(e.target.value === 'all' ? 'all' : Number(e.target.value))}
      aria-label="Filter by group"
      data-testid={testId}
    >
      <option value="all">All groups</option>
      {groups.map((g) => (
        <option key={g.id} value={g.id}>
          {g.name}
        </option>
      ))}
    </select>
  );
}
