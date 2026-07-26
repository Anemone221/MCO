import { useState } from 'react';
import { isDemoMode } from '../lib/demo';

/** Size class + image-server resolution tiers (the server serves 32/64/128…). */
function avatarClass(size: number): string {
  if (size > 64) return 'avatar avatar--xl';
  if (size > 32) return 'avatar avatar--lg';
  return 'avatar';
}

function imageSize(size: number): number {
  if (size > 64) return 128;
  if (size > 32) return 64;
  return 32;
}

/**
 * Character portrait from the EVE image server (allowed by the renderer CSP).
 * Hides itself if the image cannot load (offline, deleted character).
 */
export default function CharacterAvatar({
  characterId,
  size = 24,
}: {
  characterId: number;
  size?: number;
}) {
  const [failed, setFailed] = useState(false);
  // Demo mode: a real portrait would identify the character no matter what
  // the name says, so render a deterministic colored block instead.
  if (isDemoMode()) {
    const hue = (characterId * 137) % 360;
    return (
      <span
        className={avatarClass(size)}
        style={{ backgroundColor: `hsl(${hue}, 25%, 45%)` }}
      />
    );
  }
  if (failed) return <span className={avatarClass(size)} />;
  return (
    <img
      className={avatarClass(size)}
      src={`https://images.evetech.net/characters/${characterId}/portrait?size=${imageSize(size)}`}
      alt=""
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}
