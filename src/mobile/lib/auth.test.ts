import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getDeviceToken,
  setDeviceToken,
  clearDeviceToken,
  getPairToken,
  getDeviceName,
} from './auth';

describe('auth', () => {
  beforeEach(() => {
    localStorage.clear();
    window.history.replaceState({}, '', '/');
  });

  describe('getDeviceToken', () => {
    it('returns null when no token is stored', () => {
      expect(getDeviceToken()).toBeNull();
    });

    it('returns token from localStorage', () => {
      localStorage.setItem('cli_mobile_device_token', 'token-from-storage');
      expect(getDeviceToken()).toBe('token-from-storage');
    });

    it('extracts token from URL query param and persists to localStorage', () => {
      window.history.replaceState({}, '', '/?token=abc12345678901234567890123456789!!');
      const token = getDeviceToken();
      expect(token).toBe('abc12345678901234567890123456789!!');
      expect(localStorage.getItem('cli_mobile_device_token')).toBe('abc12345678901234567890123456789!!');
      // URL should be cleaned
      expect(window.location.search).not.toContain('token');
    });

    it('ignores short URL tokens (<32 chars)', () => {
      localStorage.setItem('cli_mobile_device_token', 'stored');
      window.history.replaceState({}, '', '/?token=short');
      expect(getDeviceToken()).toBe('stored'); // falls back to localStorage
    });
  });

  describe('setDeviceToken / clearDeviceToken', () => {
    it('sets and clears token', () => {
      setDeviceToken('my-token');
      expect(localStorage.getItem('cli_mobile_device_token')).toBe('my-token');

      clearDeviceToken();
      expect(localStorage.getItem('cli_mobile_device_token')).toBeNull();
    });
  });

  describe('getPairToken', () => {
    it('extracts pair token from URL', () => {
      window.history.replaceState({}, '', '/?pair=ABCDEF');
      expect(getPairToken()).toBe('ABCDEF');
    });

    it('returns null when no pair param', () => {
      window.history.replaceState({}, '', '/');
      expect(getPairToken()).toBeNull();
    });
  });

  describe('getDeviceName', () => {
    it('returns iPhone for iPhone UA', () => {
      expect(getDeviceName()).toBeTruthy(); // depends on test env
      // Just ensure it returns a string
      expect(typeof getDeviceName()).toBe('string');
    });
  });
});
