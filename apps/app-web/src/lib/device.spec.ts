import { describe, expect, it } from 'vitest';
import { describeDevice } from './device';

const UA = {
  chromeMac:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
  safariIphone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  edgeWindows:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 Edg/130.0',
  firefoxLinux: 'Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0',
  operaAndroid:
    'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36 OPR/85.0',
  chromebook:
    'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
};

describe('describing a session’s device', () => {
  it.each([
    [UA.chromeMac, { browser: 'Chrome', os: 'macOS' }],
    [UA.safariIphone, { browser: 'Safari', os: 'iOS' }],
    [UA.edgeWindows, { browser: 'Edge', os: 'Windows' }],
    [UA.firefoxLinux, { browser: 'Firefox', os: 'Linux' }],
    [UA.operaAndroid, { browser: 'Opera', os: 'Android' }],
    [UA.chromebook, { browser: 'Chrome', os: 'ChromeOS' }],
  ])('recognises %s', (ua, expected) => {
    expect(describeDevice(ua)).toEqual(expected);
  });

  it.each([
    [null],
    ['curl/8.4.0'],
    ['Mozilla/5.0 (Windows NT 10.0) SomeBrowser/1.0'],
    ['Chrome/130.0 (PlayStation)'],
  ])('says it cannot tell rather than guessing: %j', (ua) => {
    expect(describeDevice(ua)).toBeNull();
  });
});
