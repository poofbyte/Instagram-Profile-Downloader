const express = require('express');
const path = require('path');
const fs = require('fs');
const { InstagramScraper, normalizeProfileInput } = require('./lib/instagram-scraper');
const { getCookieStatus, saveCookies, parseCookies } = require('./lib/cookie-manager');
const { streamZipArchive } = require('./lib/zip-builder');
const { sanitizeFilename } = require('./lib/media-extractor');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Active scraping sessions for cancellation and caching
const activeSessions = new Map();
const completedScans = new Map();

// Periodic cleanup of completed scans cache (every 45 minutes)
setInterval(() => {
  const now = Date.now();
  for (const [id, scan] of completedScans.entries()) {
    if (now - (scan.createdAt || 0) > 45 * 60 * 1000) {
      completedScans.delete(id);
    }
  }
}, 30 * 60 * 1000).unref();

/**
 * Health check & environment diagnostics
 */
app.get('/api/health', (req, res) => {
  const cookieStatus = getCookieStatus();
  res.json({
    status: 'ok',
    cookieStatus,
    timestamp: new Date().toISOString()
  });
});

/**
 * Cookie Management ("Give Cookies") Endpoints
 */
app.get('/api/cookies', (req, res) => {
  try {
    const status = getCookieStatus();
    res.json(status);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/cookies', (req, res) => {
  try {
    const { cookies } = req.body;
    if (!cookies) {
      return res.status(400).json({ error: 'No cookie data provided.' });
    }

    const saveResult = saveCookies(cookies);
    const updatedStatus = getCookieStatus();

    res.json({
      success: true,
      message: `Successfully saved ${saveResult.count} cookies to ${saveResult.filePath}!`,
      status: updatedStatus
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * Server-Sent Events (SSE) Profile Scraping endpoint
 * Supports GET /api/scan?profile=... and POST /api/scrape
 */
const handleScrapeRequest = async (req, res) => {
  const profileInput = req.query.profile || req.body?.url || req.body?.profile;
  const sessionId = req.query.sessionId || req.body?.sessionId || `session_${Date.now()}`;
  const clientCookies = req.headers['x-instagram-cookies'] || req.body?.cookies || req.query.cookies || null;

  if (!profileInput) {
    return res.status(400).json({ error: 'Instagram profile URL or username is required.' });
  }

  const normalized = normalizeProfileInput(profileInput);
  if (!normalized || !normalized.username) {
    return res.status(400).json({ error: 'Invalid Instagram profile URL or username.' });
  }

  // Setup SSE Headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  if (typeof res.flushHeaders === 'function') {
    res.flushHeaders();
  }

  const sendEvent = (eventType, data) => {
    if (res.writableEnded) return;
    res.write(`event: ${eventType}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  const scraper = new InstagramScraper();
  activeSessions.set(sessionId, scraper);

  req.on('close', () => {
    scraper.cancel();
    activeSessions.delete(sessionId);
  });

  try {
    sendEvent('status', {
      stage: 'init',
      message: `Starting extraction for @${normalized.username}...`,
      sessionId
    });

    const result = await scraper.scrape(profileInput, clientCookies, (event) => {
      sendEvent(event.type || 'status', event);
    });

    if (result && Array.isArray(result.media) && result.media.length > 0) {
      const scanEntry = {
        username: result.username || normalized.username,
        profile: result.profile,
        summary: result.summary,
        media: result.media,
        createdAt: Date.now()
      };
      completedScans.set(sessionId, scanEntry);
      completedScans.set(normalized.username.toLowerCase(), scanEntry);
    }

    sendEvent('complete', {
      stage: 'complete',
      sessionId,
      username: result.username,
      profile: result.profile,
      summary: result.summary,
      media: result.media,
      count: result.media.length,
      message: `Scan finished successfully! ${result.media.length} media files isolated.`
    });

    activeSessions.delete(sessionId);
    res.end();
  } catch (err) {
    console.error(`[Scraper Error] @${normalized.username}:`, err.message);
    sendEvent('error', {
      stage: 'error',
      message: err.message || 'An error occurred during profile scraping.'
    });
    activeSessions.delete(sessionId);
    res.end();
  }
};

app.get('/api/scan', handleScrapeRequest);
app.post('/api/scrape', handleScrapeRequest);

/**
 * Stop an ongoing scan session
 */
app.post('/api/scan/stop', (req, res) => {
  const { sessionId } = req.body;
  if (sessionId && activeSessions.has(sessionId)) {
    const scraper = activeSessions.get(sessionId);
    scraper.cancel();
    activeSessions.delete(sessionId);
    return res.json({ success: true, message: 'Scan cancelled.' });
  }
  res.json({ success: false, message: 'Session not found or already finished.' });
});

/**
 * Local Image Proxy: Allows browser to reliably load avatars and thumbnails
 * without CORS, referrer policy blocks, or browser tracking protection interference.
 */
app.get('/api/proxy-image', async (req, res) => {
  const imageUrl = req.query.url;
  if (!imageUrl) {
    return res.status(400).send('Missing "url" parameter');
  }

  try {
    const upstreamRes = await fetch(imageUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
        'Referer': 'https://www.instagram.com/'
      }
    });

    if (!upstreamRes.ok) {
      return res.status(upstreamRes.status).send(`Upstream returned ${upstreamRes.status}`);
    }

    const contentType = upstreamRes.headers.get('content-type') || 'image/jpeg';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    const buffer = await upstreamRes.arrayBuffer();
    res.send(Buffer.from(buffer));
  } catch (err) {
    res.status(500).send('Image proxy failed: ' + err.message);
  }
});

/**
 * Proxy download for a single media file (bypasses CDN CORS, sets proper filename)
 */
app.get('/api/download-single', async (req, res) => {
  const fileUrl = req.query.url;
  const rawFilename = req.query.filename || 'instagram_media.bin';

  if (!fileUrl) {
    return res.status(400).send('Missing "url" parameter');
  }

  try {
    const cleanFilename = sanitizeFilename(rawFilename, 'instagram_media');
    const encodedFilename = encodeURIComponent(cleanFilename);

    const upstreamRes = await fetch(fileUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
        'Referer': 'https://www.instagram.com/'
      }
    });

    if (!upstreamRes.ok) {
      return res.status(upstreamRes.status).send(`Failed to fetch file from source (Status: ${upstreamRes.status})`);
    }

    const contentType = upstreamRes.headers.get('content-type') || 'application/octet-stream';
    const contentLength = upstreamRes.headers.get('content-length');

    res.setHeader('Content-Type', contentType);
    if (contentLength) res.setHeader('Content-Length', contentLength);
    res.setHeader('Content-Disposition', `attachment; filename="${cleanFilename}"; filename*=UTF-8''${encodedFilename}`);

    const buffer = await upstreamRes.arrayBuffer();
    res.send(Buffer.from(buffer));
  } catch (err) {
    console.error('Single download error:', err.message);
    res.status(500).send('Download failed: ' + err.message);
  }
});

/**
 * Download all or selected media as a ZIP archive
 * Supports:
 * 1. GET /api/download-zip?sessionId=... or ?username=...
 * 2. POST /api/download-zip (JSON payload with sessionId, username, or items array)
 */
const handleZipDownload = async (req, res) => {
  const sessionId = req.query.sessionId || req.body?.sessionId;
  const usernameParam = req.query.username || req.query.profile || req.body?.profileName || req.body?.username;
  let items = req.body?.items;
  let username = usernameParam;

  // 1. Try resolving from completedScans cache
  if (sessionId && completedScans.has(sessionId)) {
    const cached = completedScans.get(sessionId);
    items = items && items.length > 0 ? items : cached.media;
    username = cached.username || username;
  } else if (username && completedScans.has(username.toLowerCase())) {
    const cached = completedScans.get(username.toLowerCase());
    items = items && items.length > 0 ? items : cached.media;
    username = cached.username || username;
  }

  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).send('No media items available for ZIP packaging. Please re-scan the profile.');
  }

  const validItems = items.filter(it => it && it.url);
  if (validItems.length === 0) {
    return res.status(400).send('No downloadable media URLs found.');
  }

  try {
    await streamZipArchive(validItems, username || 'instagram_user', res);
  } catch (err) {
    console.error('ZIP download error:', err.message);
    if (!res.headersSent) {
      res.status(500).send('ZIP packaging failed: ' + err.message);
    }
  }
};

app.get('/api/download-zip', handleZipDownload);
app.post('/api/download-zip', handleZipDownload);

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n======================================================`);
  console.log(`🚀 Instagram Profile Downloader Web App Running!`);
  console.log(`🌐 Local URL: http://localhost:${PORT}`);
  console.log(`======================================================\n`);
});
