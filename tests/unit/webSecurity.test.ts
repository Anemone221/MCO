import { describe, expect, it } from 'vitest';
import { isAllowedNavigation, isSafeExternalUrl } from '@main/webSecurity';

describe('isSafeExternalUrl', () => {
  it('allows the http(s) links MCO actually opens', () => {
    expect(isSafeExternalUrl('https://github.com/Anemone221/MCO')).toBe(true);
    expect(isSafeExternalUrl('https://login.eveonline.com/v2/oauth/authorize?x=1')).toBe(true);
    expect(isSafeExternalUrl('http://localhost:8765/callback')).toBe(true);
  });

  it('refuses schemes that would launch a local handler', () => {
    expect(isSafeExternalUrl('file:///C:/Windows/System32/cmd.exe')).toBe(false);
    expect(isSafeExternalUrl('ms-msdt:/id PCWDiagnostic')).toBe(false);
    expect(isSafeExternalUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeExternalUrl('data:text/html,<script>alert(1)</script>')).toBe(false);
    expect(isSafeExternalUrl('vbscript:msgbox')).toBe(false);
  });

  it('refuses anything that is not a URL at all', () => {
    expect(isSafeExternalUrl('')).toBe(false);
    expect(isSafeExternalUrl('not a url')).toBe(false);
    expect(isSafeExternalUrl('//evil.example.com')).toBe(false);
  });
});

describe('isAllowedNavigation', () => {
  const packaged = 'file:///C:/Program%20Files/MCO/resources/app.asar/out/renderer/index.html';
  const dev = 'http://localhost:5173/';

  it('allows a reload of the page MCO loaded', () => {
    expect(isAllowedNavigation(packaged, packaged)).toBe(true);
    expect(isAllowedNavigation(dev, dev)).toBe(true);
  });

  it('allows the dev server to navigate within its own origin', () => {
    expect(isAllowedNavigation('http://localhost:5173/index.html', dev)).toBe(true);
  });

  it('blocks navigation to a remote page', () => {
    expect(isAllowedNavigation('https://evil.example.com/', packaged)).toBe(false);
    expect(isAllowedNavigation('https://evil.example.com/', dev)).toBe(false);
  });

  it('blocks another dev-server origin', () => {
    expect(isAllowedNavigation('http://localhost:9999/', dev)).toBe(false);
    expect(isAllowedNavigation('http://127.0.0.1:5173/', dev)).toBe(false);
  });

  it('blocks a different local file, whose origin is opaque and would compare equal', () => {
    expect(isAllowedNavigation('file:///C:/Users/me/evil.html', packaged)).toBe(false);
  });

  it('blocks a scheme change', () => {
    expect(isAllowedNavigation('https://localhost:5173/', dev)).toBe(false);
    expect(isAllowedNavigation('javascript:alert(1)', packaged)).toBe(false);
  });

  it('blocks anything unparseable', () => {
    expect(isAllowedNavigation('', packaged)).toBe(false);
    expect(isAllowedNavigation('not a url', packaged)).toBe(false);
  });
});
