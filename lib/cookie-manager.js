const fs = require('fs');
const path = require('path');

const COOKIE_FILES = ['cookies.json', 'cookie.json'];

/**
 * Find the primary cookie file path if it exists
 */
function getCookieFilePath() {
  for (const filename of COOKIE_FILES) {
    const fullPath = path.join(process.cwd(), filename);
    if (fs.existsSync(fullPath)) {
      return fullPath;
    }
  }
  return path.join(process.cwd(), 'cookies.json');
}

/**
 * Normalize an array of cookie objects for Puppeteer / Chromium
 */
function normalizeCookies(rawList) {
  if (!Array.isArray(rawList)) return [];

  return rawList
    .map(cookie => {
      if (!cookie || !cookie.name || cookie.value === undefined) return null;

      let domain = cookie.domain || '.instagram.com';
      if (!domain.includes('instagram.com')) {
        domain = '.instagram.com';
      }

      const normalized = {
        name: String(cookie.name).trim(),
        value: String(cookie.value).trim(),
        domain: domain,
        path: cookie.path || '/',
        httpOnly: cookie.httpOnly !== undefined ? Boolean(cookie.httpOnly) : false,
        secure: cookie.secure !== undefined ? Boolean(cookie.secure) : true
      };

      if (cookie.expirationDate && cookie.expirationDate > 0) {
        normalized.expires = cookie.expirationDate;
      }

      if (cookie.sameSite) {
        const sameSite = String(cookie.sameSite).toLowerCase();
        if (sameSite === 'no_restriction' || sameSite === 'none') {
          normalized.sameSite = 'None';
        } else if (sameSite === 'strict') {
          normalized.sameSite = 'Strict';
        } else {
          normalized.sameSite = 'Lax';
        }
      }

      return normalized;
    })
    .filter(Boolean);
}

/**
 * Parse cookies from various input formats:
 * 1. JSON Array (Cookie-Editor, EditThisCookie)
 * 2. Header string ("name1=val1; name2=val2")
 * 3. Array of objects
 */
function parseCookies(rawInput) {
  if (!rawInput) return [];

  // If already an array
  if (Array.isArray(rawInput)) {
    return normalizeCookies(rawInput);
  }

  if (typeof rawInput !== 'string') return [];
  const trimmed = rawInput.trim();
  if (!trimmed) return [];

  // 1. Try JSON
  if ((trimmed.startsWith('[') && trimmed.endsWith(']')) || (trimmed.startsWith('{') && trimmed.endsWith('}'))) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return normalizeCookies(parsed);
      } else if (parsed && typeof parsed === 'object') {
        // Maybe key-value map: { sessionid: "...", ds_user_id: "..." }
        const list = Object.entries(parsed).map(([name, value]) => ({
          name,
          value: typeof value === 'object' ? value.value || '' : String(value),
          domain: '.instagram.com',
          path: '/'
        }));
        return normalizeCookies(list);
      }
    } catch (e) {}
  }

  // 2. Try header string format: "key1=value1; key2=value2"
  const pairs = trimmed.split(';');
  const list = [];
  for (const pair of pairs) {
    const idx = pair.indexOf('=');
    if (idx > 0) {
      const name = pair.slice(0, idx).trim();
      const value = pair.slice(idx + 1).trim();
      if (name && value) {
        list.push({
          name,
          value,
          domain: '.instagram.com',
          path: '/'
        });
      }
    }
  }

  return normalizeCookies(list);
}

/**
 * Load cookies from either `cookies.json` or `cookie.json`
 */
function loadCookies(overridePath = null) {
  try {
    const targetPath = overridePath || getCookieFilePath();
    if (fs.existsSync(targetPath)) {
      const raw = fs.readFileSync(targetPath, 'utf8');
      const cookies = parseCookies(raw);
      if (cookies.length > 0) {
        return {
          cookies,
          filePath: targetPath,
          source: path.basename(targetPath)
        };
      }
    }
  } catch (err) {
    console.warn(`[CookieManager] Could not load cookies from file: ${err.message}`);
  }
  return {
    cookies: [],
    filePath: null,
    source: null
  };
}

/**
 * Save cookies to file (defaults to `cookies.json`)
 */
function saveCookies(cookieData, filename = 'cookies.json') {
  const normalized = parseCookies(cookieData);
  if (normalized.length === 0) {
    throw new Error('No valid cookies found to save.');
  }

  const targetPath = path.join(process.cwd(), filename);
  fs.writeFileSync(targetPath, JSON.stringify(normalized, null, 2), 'utf8');

  // Also sync to cookie.json if it exists to maintain backwards compatibility
  const altPath = path.join(process.cwd(), filename === 'cookies.json' ? 'cookie.json' : 'cookies.json');
  try {
    fs.writeFileSync(altPath, JSON.stringify(normalized, null, 2), 'utf8');
  } catch (e) {}

  return {
    success: true,
    count: normalized.length,
    filePath: targetPath
  };
}

/**
 * Inspect cookie status (checks for sessionid, ds_user_id)
 */
function getCookieStatus(cookiesArray = null) {
  let cookies = cookiesArray;
  let source = 'memory';

  if (!cookies) {
    const loaded = loadCookies();
    cookies = loaded.cookies;
    source = loaded.source || 'none';
  }

  const sessionCookie = cookies.find(c => c.name === 'sessionid');
  const userIdCookie = cookies.find(c => c.name === 'ds_user_id');
  const csrfCookie = cookies.find(c => c.name === 'csrftoken');

  const hasSession = !!(sessionCookie && sessionCookie.value);
  const userId = userIdCookie ? userIdCookie.value : null;

  return {
    hasCookies: cookies.length > 0,
    count: cookies.length,
    hasSession,
    userId,
    hasCsrf: !!csrfCookie,
    source,
    cookieNames: cookies.map(c => c.name)
  };
}

module.exports = {
  getCookieFilePath,
  normalizeCookies,
  parseCookies,
  loadCookies,
  saveCookies,
  getCookieStatus
};
