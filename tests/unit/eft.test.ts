import { describe, expect, it } from 'vitest';
import { countsForSkills, parseEft } from '@main/fits/eft';

const FIT = `[Rifter, Test Rifter]
Damage Control II
200mm AutoCannon II, Republic Fleet EMP S

5MN Y-T8 Compact Microwarpdrive
Warp Scrambler II /OFFLINE

[Empty Low slot]

Hobgoblin II x5

Republic Fleet EMP S x1000`;

describe('parseEft', () => {
  it('parses the ship and fit name from the header', () => {
    const fit = parseEft(FIT);
    expect(fit.shipName).toBe('Rifter');
    expect(fit.fitName).toBe('Test Rifter');
  });

  it('splits a module with a loaded charge into two items', () => {
    const fit = parseEft(FIT);
    expect(fit.items).toContainEqual({ name: '200mm AutoCannon II', quantity: 1, kind: 'module' });
    expect(fit.items).toContainEqual({ name: 'Republic Fleet EMP S', quantity: 1, kind: 'charge' });
  });

  it('strips the /OFFLINE suffix and skips empty slots', () => {
    const fit = parseEft(FIT);
    expect(fit.items).toContainEqual({ name: 'Warp Scrambler II', quantity: 1, kind: 'module' });
    expect(fit.items.some((i) => i.name.includes('Empty'))).toBe(false);
  });

  it('parses xN lines as quantity items', () => {
    const fit = parseEft(FIT);
    expect(fit.items).toContainEqual({ name: 'Hobgoblin II', quantity: 5, kind: 'quantity' });
    expect(fit.items).toContainEqual({
      name: 'Republic Fleet EMP S',
      quantity: 1000,
      kind: 'quantity',
    });
  });

  it('rejects text that is not an EFT fit', () => {
    expect(() => parseEft('just some text')).toThrow();
    expect(() => parseEft('')).toThrow();
  });
});

describe('countsForSkills', () => {
  const MODULE = 7;
  const CHARGE = 8;
  const MATERIAL = 4;
  const DRONE = 18;

  it('always counts fitted modules and loaded charges', () => {
    expect(countsForSkills('module', MODULE)).toBe(true);
    expect(countsForSkills('charge', CHARGE)).toBe(true);
    expect(countsForSkills('module', undefined)).toBe(true);
  });

  it('counts xN drones, spare charges (mining crystals, ammo) and spare modules', () => {
    expect(countsForSkills('quantity', DRONE)).toBe(true);
    expect(countsForSkills('quantity', CHARGE)).toBe(true);
    expect(countsForSkills('quantity', MODULE)).toBe(true);
  });

  it('does not count inert cargo', () => {
    expect(countsForSkills('quantity', MATERIAL)).toBe(false);
    expect(countsForSkills('quantity', undefined)).toBe(false);
  });
});
