/**
 * A browser and an operating system from a user-agent string — enough for a person to recognise
 * their own session ("Chrome on macOS"), and nothing more. Null where it cannot tell: an unknown
 * device is labelled as unknown, not guessed at.
 */
export function describeDevice(userAgent: string | null): { browser: string; os: string } | null {
  if (userAgent === null) return null;
  const browser = /Edg\//.test(userAgent)
    ? 'Edge'
    : /OPR\//.test(userAgent)
      ? 'Opera'
      : /Firefox\//.test(userAgent)
        ? 'Firefox'
        : /Chrome\//.test(userAgent)
          ? 'Chrome'
          : /Safari\//.test(userAgent)
            ? 'Safari'
            : null;
  const os = /iPhone|iPad/.test(userAgent)
    ? 'iOS'
    : /Android/.test(userAgent)
      ? 'Android'
      : /CrOS/.test(userAgent)
        ? 'ChromeOS'
        : /Mac OS X/.test(userAgent)
          ? 'macOS'
          : /Windows/.test(userAgent)
            ? 'Windows'
            : /Linux/.test(userAgent)
              ? 'Linux'
              : null;
  return browser === null || os === null ? null : { browser, os };
}
