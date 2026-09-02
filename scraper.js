const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const archiver = require('archiver');
const { getBrowserExecutablePath } = require('./browserHelper');

// Helper to create zip archive instance across different archiver versions
function createZipArchive(options = { zlib: { level: 0 }, forceZip64: true }) {
  if (typeof archiver === 'function') {
    return archiver('zip', options);
  }
  if (archiver.ZipArchive) {
    return new archiver.ZipArchive(options);
  }
  if (archiver.default && typeof archiver.default === 'function') {
    return archiver.default('zip', options);
  }
  if (archiver.default && archiver.default.ZipArchive) {
    return new archiver.default.ZipArchive(options);
  }
  throw new Error('Unable to initialize zip archiver');
}

// Parse profile input into clean username and canonical URL
function parseProfileInput(input) {
  if (!input) return null;
  let raw = input.trim().replace(/^["']|["']$/g, '');

  if (raw.startsWith('@')) {
    raw = raw.substring(1);
  }

  if (!raw.includes('instagram.com')) {
    const cleanUser = raw.split(/[/?#]/)[0].replace(/[<>:"/\\|?*]/g, '_').trim();
    if (!cleanUser) return null;
    return {
      username: cleanUser,
      url: `https://www.instagram.com/${cleanUser}/`
    };
  }

  if (!raw.startsWith('http://') && !raw.startsWith('https://')) {
    raw = 'https://' + raw;
  }

  try {
    const parsed = new URL(raw);
    const parts = parsed.pathname.split('/').filter(Boolean);
    if (parts.length > 0) {
      const cleanUser = parts[0].replace(/[<>:"/\\|?*]/g, '_').trim();
      return {
        username: cleanUser,
        url: `https://www.instagram.com/${cleanUser}/`
      };
    }
  } catch (e) {}

  const match = raw.match(/instagram\.com\/([a-zA-Z0-9._]+)/i);
  if (match) {
    const cleanUser = match[1].replace(/[<>:"/\\|?*]/g, '_').trim();
    return {
      username: cleanUser,
      url: `https://www.instagram.com/${cleanUser}/`
    };
  }

  return null;
}

// Filter out low-resolution images and unwanted URLs
function filterHighResUrls(urls) {
  const lowResPatterns = [
    /p\d+x\d+/i,
    /thumb/i,
    /small/i,
    /lowres/i,
    /thumbnail/i,
    /s\d+x\d+/i,
    /avatar/i,
    /profile_pic/i,
    /150x150/i,
    /320x320/i,
    /100x100/i,
    /240x240/i,
    /480x480/i,
    /t01\.\w+\/e\d/i
  ];
  return urls.filter(url => !lowResPatterns.some(pattern => pattern.test(url)));
}

// Recursively find all media URLs in a JSON object
function extractUrlsFromJson(obj, urlsArray, depth = 0) {
  if (!obj || depth > 15) return;
  if (typeof obj === 'string') {
    try {
      if (obj.trim().startsWith('{') || obj.trim().startsWith('[')) {
        const parsed = JSON.parse(obj);
        extractUrlsFromJson(parsed, urlsArray, depth + 1);
      }
    } catch(e) {}
    return;
  }

  if (Array.isArray(obj)) {
    obj.forEach(item => extractUrlsFromJson(item, urlsArray, depth + 1));
    return;
  }

  if (typeof obj === 'object') {
    if (obj.display_url) urlsArray.push({ url: obj.display_url, type: 'image' });
    if (obj.video_url) urlsArray.push({ url: obj.video_url, type: 'video' });

    if (obj.image_versions2 && obj.image_versions2.candidates) {
      const sorted = [...obj.image_versions2.candidates].sort((a, b) => (b.width || 0) - (a.width || 0));
      const best = sorted[0];
      if (best && best.url) urlsArray.push({ url: best.url, type: 'image' });
    }

    if (obj.display_resources && Array.isArray(obj.display_resources)) {
      const sorted = [...obj.display_resources].sort((a, b) => (b.config_width || 0) - (a.config_width || 0));
      const best = sorted[0];
      if (best && best.src) urlsArray.push({ url: best.src, type: 'image' });
    }

    if (obj.video_versions && Array.isArray(obj.video_versions)) {
      const sorted = [...obj.video_versions].sort((a, b) => (b.width || 0) - (a.width || 0));
      const best = sorted[0];
      if (best && best.url) urlsArray.push({ url: best.url, type: 'video' });
    }

    if (obj.edge_sidecar_to_children && obj.edge_sidecar_to_children.edges) {
      obj.edge_sidecar_to_children.edges.forEach(edge => {
        if (edge.node) {
          if (edge.node.is_video && edge.node.video_url) {
            urlsArray.push({ url: edge.node.video_url, type: 'video' });
          } else if (edge.node.display_url) {
            urlsArray.push({ url: edge.node.display_url, type: 'image' });
          }
        }
      });
    }

    if (obj.carousel_media && Array.isArray(obj.carousel_media)) {
      obj.carousel_media.forEach(c => extractUrlsFromJson(c, urlsArray, depth + 1));
    }

    if (obj.node) {
      if (obj.node.video_url) urlsArray.push({ url: obj.node.video_url, type: 'video' });
      if (obj.node.display_url) urlsArray.push({ url: obj.node.display_url, type: obj.node.is_video ? 'video' : 'image' });
      if (obj.node.media_url) urlsArray.push({ url: obj.node.media_url, type: obj.node.is_video ? 'video' : 'image' });
    }

    if (obj.media_url) {
      urlsArray.push({ url: obj.media_url, type: obj.is_video ? 'video' : 'image' });
    }

    for (let key in obj) {
      extractUrlsFromJson(obj[key], urlsArray, depth + 1);
    }
  }
}

// Download media and create a ZIP file
async function downloadMedia(mediaItems, username, onProgress) {
  if (!mediaItems || mediaItems.length === 0) {
    onProgress('❌ No media found to download.');
    return { zipUrl: null, files: [], count: 0 };
  }

  const safeUsername = username.replace(/[<>:"/\\|?*]/g, '_').trim() || 'instagram_user';
  const publicDir = path.join(__dirname, 'public');
  const downloadsDir = path.join(publicDir, 'downloads');
  if (!fs.existsSync(downloadsDir)) {
    fs.mkdirSync(downloadsDir, { recursive: true });
  }

  const userMediaDir = path.join(downloadsDir, safeUsername);
  if (!fs.existsSync(userMediaDir)) {
    fs.mkdirSync(userMediaDir, { recursive: true });
  }

  const zipFilename = `${safeUsername}.zip`;
  const zipFilePath = path.join(downloadsDir, zipFilename);
  const output = fs.createWriteStream(zipFilePath);
  const archive = createZipArchive({
    zlib: { level: 0 },
    forceZip64: true
  });

  const archivePromise = new Promise((resolve, reject) => {
    output.on('close', resolve);
    output.on('finish', resolve);
    output.on('error', (err) => {
      archive.destroy();
      reject(err);
    });
    archive.on('error', (err) => {
      output.destroy();
      reject(err);
    });
    archive.on('warning', (err) => {
      if (err.code !== 'ENOENT') {
        console.warn('⚠️  Archive warning:', err.message);
      }
    });
  });

  archive.pipe(output);

  const savedFiles = [];
  let count = 0;
  let failed = 0;

  try {
    for (let i = 0; i < mediaItems.length; i++) {
      const item = mediaItems[i];
      try {
        const url = typeof item === 'string' ? item : item.url;
        const type = typeof item === 'string' ? 'unknown' : (item.type || 'image');

        onProgress(`⬇️ [${count + 1}/${mediaItems.length}] Downloading ${type}...`);
        const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
        if (!res.ok) {
          failed++;
          continue;
        }

        const buffer = Buffer.from(await res.arrayBuffer());
        if (buffer.length === 0) {
          failed++;
          continue;
        }

        let ext = '';
        try {
          ext = path.extname(new URL(url).pathname).split('?')[0].toLowerCase();
        } catch (e) {}

        const contentType = (res.headers.get('content-type') || '').toLowerCase();
        if (contentType.includes('image/jpeg') || contentType.includes('image/jpg')) {
          ext = '.jpg';
        } else if (contentType.includes('image/png')) {
          ext = '.png';
        } else if (contentType.includes('image/webp')) {
          ext = '.webp';
        } else if (contentType.includes('video/mp4')) {
          ext = '.mp4';
        } else if (!ext || ext === '' || ext === '.heic') {
          ext = type.includes('video') ? '.mp4' : '.jpg';
        }

        const filename = `${safeUsername}_${String(count + 1).padStart(4, '0')}${ext}`;

        // Save individual file for the web gallery
        fs.writeFileSync(path.join(userMediaDir, filename), buffer);
        savedFiles.push({ filename, type, url: `/downloads/${safeUsername}/${filename}` });

        // Append to zip archive stream
        archive.append(buffer, { name: filename });
        count++;
      } catch (err) {
        failed++;
      }
    }

    if (count > 0) {
      onProgress(`📦 Finalizing ZIP archive...`);
      await archive.finalize();
      await archivePromise;

      const stats = fs.statSync(zipFilePath);
      const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);
      onProgress(`✅ Backup saved to ${zipFilename} (${sizeMB} MB)`);
      return { zipUrl: `/downloads/${zipFilename}`, files: savedFiles, count };
    }

    onProgress('❌ No media was successfully downloaded.');
    archive.abort();
    output.destroy();
    if (fs.existsSync(zipFilePath)) {
      try { fs.unlinkSync(zipFilePath); } catch (e) {}
    }
    return { zipUrl: null, files: [], count: 0 };
  } catch (err) {
    archive.destroy();
    output.destroy();
    if (fs.existsSync(zipFilePath)) {
      try {
        const s = fs.statSync(zipFilePath);
        if (s.size === 0) fs.unlinkSync(zipFilePath);
      } catch (e) {}
    }
    throw err;
  }
}

// Scroll to load all posts
async function scrollToLoadPosts(page, onProgress) {
  onProgress('🔄 Scrolling to load posts...');
  let previousHeight = await page.evaluate(() => document.body.scrollHeight);
  let scrollAttempts = 0;
  let scrollsDone = 0;
  const maxScrolls = 60;

  try {
    await page.evaluate(() => {
      const candidates = Array.from(document.querySelectorAll('button, div[role="button"]'));
      for (const el of candidates) {
        const txt = (el.innerText || '').toLowerCase().trim();
        if (txt === 'not now' || txt === 'decline optional cookies' || txt === 'allow all cookies') {
          el.click();
          break;
        }
      }
    });
  } catch (e) {}

  while (scrollAttempts < 3 && scrollsDone < maxScrolls) {
    await page.evaluate(() => {
      window.scrollBy(0, 1000);
      window.scrollTo(0, document.body.scrollHeight);
    });
    await new Promise(resolve => setTimeout(resolve, 2500));
    scrollsDone++;

    const newHeight = await page.evaluate(() => document.body.scrollHeight);
    if (newHeight === previousHeight) {
      scrollAttempts++;
      onProgress(`📜 Attempt ${scrollAttempts}/3 to load more...`);
    } else {
      scrollAttempts = 0;
      onProgress(`📜 Scrolled down (step ${scrollsDone}), more posts loading...`);
    }
    previousHeight = newHeight;
  }
  onProgress('🛑 Reached end of posts.');
}

// Main exported function
async function scrapeInstagram(rawInput, cookiesData, onProgress) {
  const parsed = parseProfileInput(rawInput);
  if (!parsed) {
    throw new Error('Invalid Instagram profile URL or username.');
  }

  const { username, url: profileUrl } = parsed;
  onProgress(`🚀 Starting advanced media download for @${username}...`);

  const launchOptions = {
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--lang=en-US'],
    defaultViewport: { width: 1280, height: 800 }
  };
  const execPath = getBrowserExecutablePath();
  if (execPath) {
    launchOptions.executablePath = execPath;
    onProgress(`🌐 Using browser: ${execPath}`);
  }

  const browser = await puppeteer.launch(launchOptions);
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36');

  if (cookiesData && Array.isArray(cookiesData)) {
    const normalizedCookies = cookiesData.map(cookie => {
      const normalized = {
        name: cookie.name,
        value: cookie.value,
        domain: cookie.domain,
        path: cookie.path || '/',
        httpOnly: cookie.httpOnly || false,
        secure: cookie.secure !== undefined ? cookie.secure : true
      };
      if (cookie.expirationDate && cookie.expirationDate > 0) {
        normalized.expires = cookie.expirationDate;
      }
      if (cookie.sameSite) {
        const sameSite = cookie.sameSite.toLowerCase();
        if (sameSite === 'no_restriction') normalized.sameSite = 'None';
        else if (sameSite === 'lax') normalized.sameSite = 'Lax';
        else if (sameSite === 'strict') normalized.sameSite = 'Strict';
        else normalized.sameSite = 'Lax'; 
      }
      return normalized;
    }).filter(c => c.domain && c.domain.includes('instagram.com'));

    onProgress('🍪 Injecting cookies for authentication...');
    await page.setCookie(...normalizedCookies);
    onProgress('✅ Cookies injected successfully!');
  }

  let interceptedMedia = [];

  page.on('response', async (response) => {
    try {
      const url = response.url();
      const resourceType = response.request().resourceType();
      
      if (resourceType === 'xhr' || resourceType === 'fetch') {
        const isApiEndpoint =
          url.includes('/graphql/query') ||
          url.includes('/api/v1/') ||
          url.includes('instagram.com/api') ||
          url.includes('edge_owner_to_timeline_media') ||
          (url.includes('media') && url.includes('graphql')) ||
          url.includes('/web/');

        if (isApiEndpoint) {
          const contentType = response.headers()['content-type'] || '';
          if (contentType.includes('json') || contentType.includes('text')) {
            const text = await response.text();
            try {
              const json = JSON.parse(text);
              extractUrlsFromJson(json, interceptedMedia, 0);
            } catch(e) {
              const displayMatches = text.match(/"display_url":"([^"]+)"/g);
              if (displayMatches) {
                displayMatches.forEach(m => {
                  try {
                    const u = JSON.parse('{' + m + '}').display_url;
                    interceptedMedia.push({ url: u, type: 'image' });
                  } catch(e){}
                });
              }
              const videoMatches = text.match(/"video_url":"([^"]+)"/g);
              if (videoMatches) {
                videoMatches.forEach(m => {
                  try {
                    const u = JSON.parse('{' + m + '}').video_url;
                    interceptedMedia.push({ url: u, type: 'video' });
                  } catch(e){}
                });
              }
            }
          }
        }
      }
    } catch (e) {}
  });

  onProgress(`🧭 Loading profile: ${profileUrl}`);
  await page.goto(profileUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await new Promise(resolve => setTimeout(resolve, 3000));
  
  onProgress(`🧠 Parsing initial page state for media...`);
  const inlineScripts = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('script'))
      .map(script => script.textContent)
      .filter(text => text && (
        text.includes('requireLazy') ||
        text.includes('window.__initialDataLoaded') ||
        text.includes('window.__additionalDataLoaded') ||
        text.includes('display_url') ||
        text.includes('video_url') ||
        text.includes('edge_owner_to_timeline_media') ||
        text.includes('__d("FeedPage")') ||
        text.includes('"media_url"') ||
        text.includes('media_url') ||
        text.includes('shortcode_media')
      ));
  });

  for (const scriptContent of inlineScripts) {
    extractUrlsFromJson(scriptContent, interceptedMedia, 0);

    const displayMatches = scriptContent.match(/"display_url"\s*:\s*"([^"]+)"/g);
    if (displayMatches) {
      displayMatches.forEach(m => {
        try {
          const u = JSON.parse('{' + m + '}').display_url;
          if (u && u.startsWith('http')) interceptedMedia.push({ url: u, type: 'image' });
        } catch(e){}
      });
    }

    const videoMatches = scriptContent.match(/"video_url"\s*:\s*"([^"]+)"/g);
    if (videoMatches) {
      videoMatches.forEach(m => {
        try {
          const u = JSON.parse('{' + m + '}').video_url;
          if (u && u.startsWith('http')) interceptedMedia.push({ url: u, type: 'video' });
        } catch(e){}
      });
    }
  }

  const isLoggedIn = await page.evaluate(() => {
    const hasLoginInput = document.querySelector('input[name="username"]') || document.querySelector('input[name="email"]');
    return !hasLoginInput;
  });

  if (isLoggedIn) {
    onProgress('✅ Successfully authenticated with cookies!');
  } else {
    onProgress('⚠️ Not authenticated - limited access to public posts only');
  }

  await scrollToLoadPosts(page, onProgress);
  await new Promise(resolve => setTimeout(resolve, 3000));

  // Extract from rendered DOM
  const domMedia = await page.evaluate(() => {
    const results = [];
    document.querySelectorAll('img[src*="cdninstagram"], img[src*="fbcdn"]').forEach(img => {
      if (img.src && img.naturalWidth > 100) {
        results.push({ url: img.src, type: 'image' });
      }
    });
    document.querySelectorAll('video source[src*="cdninstagram"], video source[src*="fbcdn"]').forEach(source => {
      if (source.src) results.push({ url: source.src, type: 'video' });
    });
    document.querySelectorAll('video[src*="cdninstagram"], video[src*="fbcdn"]').forEach(video => {
      if (video.src) results.push({ url: video.src, type: 'video' });
    });
    return results;
  });

  if (domMedia.length > 0) {
    interceptedMedia.push(...domMedia);
  }

  await browser.close();

  onProgress('🔍 Processing intercepted network payloads...');

  const uniqueMediaMap = new Map();
  interceptedMedia.forEach(item => {
    const url = item.url;
    if (url && typeof url === 'string' && url.startsWith('http') && !url.includes('logging') && !url.includes('analytics')) {
      uniqueMediaMap.set(url, item);
    }
  });
  
  let uniqueMediaItems = Array.from(uniqueMediaMap.values());
  const beforeFilter = uniqueMediaItems.length;
  uniqueMediaItems = uniqueMediaItems.filter(item => {
    const filtered = filterHighResUrls([item.url]);
    return filtered.length > 0;
  });
  
  onProgress(`🔧 Filtered ${beforeFilter - uniqueMediaItems.length} low-resolution images/thumbnails`);
  onProgress(`✅ Extracted a total of ${uniqueMediaItems.length} high-quality media files.`);

  if (uniqueMediaItems.length > 0) {
    onProgress(`📥 Preparing to download ${uniqueMediaItems.length} files...`);
    const result = await downloadMedia(uniqueMediaItems, username, onProgress);
    onProgress(`🏁 Process completed!`);
    return result;
  } else {
    onProgress('❌ No media found to download.');
    return { zipUrl: null, files: [], count: 0 };
  }
}

module.exports = { scrapeInstagram };
