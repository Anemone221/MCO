import { describe, expect, it } from 'vitest';
import { ESI_BASE_URL } from '@main/config';
import { upsertCharacterLocation } from '@main/db/repositories/characterLocation';
import { replaceActiveImplants, replaceJumpClones } from '@main/db/repositories/clones';
import { getCached, putCached } from '@main/db/repositories/esiCache';
import { buildCharacterDetail } from '@main/services/characterDetail';
import { seedCharacter, useFakeEve } from './support/fakeEve';
import { useFreshProfile } from './support/profile';

const ALICE = 90000001;
const JITA_4_4 = 60003760;
const AMARR_VIII = 60008494;

/**
 * Opening a character page must not wait on ESI: everything it shows is
 * already stored by sync and live tracking, and a live request would queue
 * behind any sweep in the rate limiter.
 */
describe('buildCharacterDetail', () => {
  useFreshProfile();
  const eve = useFakeEve();

  it('builds location, ship and implants from stored rows without any ESI request', async () => {
    seedCharacter({ characterId: ALICE, name: 'Alice' });
    upsertCharacterLocation({
      characterId: ALICE,
      solarSystemId: 30000142,
      stationId: JITA_4_4,
      structureId: null,
      shipTypeId: 587,
      shipName: "Alice's Rifter",
    });
    replaceActiveImplants(ALICE, [9899, 9941]);
    replaceJumpClones(
      ALICE,
      [{ jumpCloneId: 501, name: null, locationId: JITA_4_4, locationType: 'station', implants: [] }],
      { lastCloneJumpDate: null, homeLocationId: JITA_4_4, homeLocationType: 'station' },
    );
    // Seen before but long expired: a station's name doesn't change, so the
    // stored body serves without a revalidation.
    putCached({
      url: `${ESI_BASE_URL}/universe/stations/${JITA_4_4}`,
      etag: '"jita"',
      expiresAt: new Date(Date.now() - 86_400_000).toISOString(),
      body: JSON.stringify({ station_id: JITA_4_4, name: 'Jita IV - Moon 4', system_id: 30000142 }),
      pages: null,
    });

    const detail = await buildCharacterDetail(ALICE);

    expect(eve.esiRequests).toEqual([]);
    expect(eve.tokenRequests).toEqual([]);
    expect(detail.location?.solarSystemId).toBe(30000142);
    expect(detail.ship).toMatchObject({ typeId: 587, name: "Alice's Rifter" });
    expect(detail.locationUpdatedAt).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
    expect(Math.abs(Date.parse(detail.locationUpdatedAt!) - Date.now())).toBeLessThan(60_000);
    expect(detail.implants.map((i) => i.typeId).sort()).toEqual([9899, 9941]);
    expect(detail.clones[0]?.locationName).toBe('Jita IV - Moon 4');
    expect(detail.medicalClone?.locationName).toBe('Jita IV - Moon 4');
  });

  it('shows "—" data, not an error, before anything was synced', async () => {
    seedCharacter({ characterId: ALICE, name: 'Alice' });

    const detail = await buildCharacterDetail(ALICE);

    expect(eve.esiRequests).toEqual([]);
    expect(detail.location).toBeNull();
    expect(detail.ship).toBeNull();
    expect(detail.locationUpdatedAt).toBeNull();
    expect(detail.implants).toEqual([]);
  });

  it('fetches a station never seen before once, then serves it from the store', async () => {
    seedCharacter({ characterId: ALICE, name: 'Alice' });
    replaceJumpClones(
      ALICE,
      [{ jumpCloneId: 501, name: null, locationId: AMARR_VIII, locationType: 'station', implants: [] }],
      { lastCloneJumpDate: null, homeLocationId: null, homeLocationType: null },
    );
    const path = `/universe/stations/${AMARR_VIII}`;
    eve.esi(path, {
      body: { station_id: AMARR_VIII, name: 'Amarr VIII (Oris)', system_id: 30002187 },
      expiresIn: 0,
    });

    expect((await buildCharacterDetail(ALICE)).clones[0]?.locationName).toBe('Amarr VIII (Oris)');
    expect(getCached(`${ESI_BASE_URL}${path}`)).not.toBeNull();
    // Already expired (Expires: now), yet the second open makes no request.
    expect((await buildCharacterDetail(ALICE)).clones[0]?.locationName).toBe('Amarr VIII (Oris)');
    expect(eve.count(path)).toBe(1);
  });
});
