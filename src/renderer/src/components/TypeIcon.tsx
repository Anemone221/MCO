import { useState } from 'react';

/** The image server publishes 32/64/128px tiers; ask for the one that fits. */
function imageSize(size: number): number {
  if (size > 64) return 128;
  if (size > 32) return 64;
  return 32;
}

/**
 * An inventory-type icon (ship hull, module, …) from the EVE image server —
 * the same host the character portraits come from, which is why the renderer
 * CSP already allows it (`src/renderer/index.html`).
 *
 * Falls back to an empty box of the same size rather than a broken image, so a
 * profile with no network keeps its rows aligned.
 */
export default function TypeIcon({
  typeId,
  size = 20,
  alt = '',
}: {
  typeId: number;
  size?: number;
  alt?: string;
}) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return <span className="type-icon" style={{ width: size, height: size }} aria-hidden="true" />;
  }
  return (
    <img
      className="type-icon"
      width={size}
      height={size}
      src={`https://images.evetech.net/types/${typeId}/icon?size=${imageSize(size)}`}
      alt={alt}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}
