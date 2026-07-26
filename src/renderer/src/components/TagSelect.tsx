import type { Tag } from '@shared/types';
import type { TagFilter } from '../lib/tags';

/** A dropdown that narrows a view to characters with one capability tag. Empty when no tags exist. */
export default function TagSelect({
  tags,
  value,
  onChange,
  testId,
}: {
  tags: Tag[];
  value: TagFilter;
  onChange: (value: TagFilter) => void;
  testId?: string;
}) {
  if (tags.length === 0) return null;
  return (
    <select
      value={value === 'all' ? 'all' : String(value)}
      onChange={(e) => onChange(e.target.value === 'all' ? 'all' : Number(e.target.value))}
      aria-label="Filter by tag"
      data-testid={testId}
    >
      <option value="all">All tags</option>
      {tags.map((t) => (
        <option key={t.id} value={t.id}>
          {t.name}
        </option>
      ))}
    </select>
  );
}
