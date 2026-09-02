const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const archiver = require('archiver');
const readline = require('readline');
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

// Ask user for input
function askQuestion(query) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) =>
    rl.question(query, (ans) => {
      rl.close();
      resolve(ans.trim());
    })
  );
}

// Parse profile input into clean username and canonical URL
function parseProfileInput(input) {
  if (!input) return null;
  let raw = input.trim();

  // Strip wrapping quotes if any
  raw = raw.replace(/^["']|["']$/g, '');

  if (raw.startsWith('@')) {
    raw = raw.substring(1);
  }

  // Handle plain username (e.g. "tabassum_nirjhi")
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

// Load cookies from JSON file
function loadCookies(cookieFile = 'cookie.json') {
  try {
    if (fs.existsSync(cookieFile)) {
      const cookieData = fs.readFileSync(cookieFile, 'utf8');
      const cookies = JSON.parse(cookieData);

      const normalizedCookies = cookies.map(cookie => {
        const normalized = {
          name: cookie.name,
          value: cookie.value,
          domain: cookie.domain,
          path: cookie.path || '/',
          httpOnly: cookie.httpOnly || false,
          secure: cookie.secure !== undefined ? cookie.secure : true
        };

        // Only specify expires if positive, otherwise preserve as session cookie
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
      }).filter(cookie => {
        return cookie.domain && (
          cookie.domain.includes('instagram.com') ||
          cookie.domain.includes('.instagram.com')
        );
      });

      console.log(`✅ Loaded ${normalizedCookies.length} cookies from ${cookieFile}`);
      return normalizedCookies;
    } else {
      console.log(`⚠️  Cookie file ${cookieFile} not found. Running without authentication.`);
    }
  } catch (err) {
    console.log(`⚠️  Could not load cookies: ${err.message}`);
  }
  return null;
}

// Filter out low-resolution images and unwanted thumbnails
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

    // image_versions2
    if (obj.image_versions2 && obj.image_versions2.candidates) {
      const sorted = [...obj.image_versions2.candidates].sort((a, b) => (b.width || 0) - (a.width || 0));
      const best = sorted[0];
      if (best && best.url) urlsArray.push({ url: best.url, type: 'image' });
    }

    // display_resources
    if (obj.display_resources && Array.isArray(obj.display_resources)) {
      const sorted = [...obj.display_resources].sort((a, b) => (b.config_width || 0) - (a.config_width || 0));
      const best = sorted[0];
      if (best && best.src) urlsArray.push({ url: best.src, type: 'image' });
    }

    // video_versions
    if (obj.video_versions && Array.isArray(obj.video_versions)) {
      const sorted = [...obj.video_versions].sort((a, b) => (b.width || 0) - (a.width || 0));
      const best = sorted[0];
      if (best && best.url) urlsArray.push({ url: best.url, type: 'video' });
    }

    // Carousel items / edge_sidecar_to_children
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

    // Carousel media list
    if (obj.carousel_media && Array.isArray(obj.carousel_media)) {
      obj.carousel_media.forEach(c => extractUrlsFromJson(c, urlsArray, depth + 1));
    }

    // GraphQL edge pattern
    if (obj.node) {
      if (obj.node.video_url) urlsArray.push({ url: obj.node.video_url, type: 'video' });
      if (obj.node.display_url) urlsArray.push({ url: obj.node.display_url, type: obj.node.is_video ? 'video' : 'image' });
      if (obj.node.media_url) urlsArray.push({ url: obj.node.media_url, type: obj.node.is_video ? 'video' : 'image' });
    }

    // Another GraphQL pattern
    if (obj.media_url) {
      urlsArray.push({ url: obj.media_url, type: obj.is_video ? 'video' : 'image' });
    }

    for (let key in obj) {
      extractUrlsFromJson(obj[key], urlsArray, depth + 1);
    }
  }
}

// Download media and create a ZIP file
async function downloadMedia(mediaItems, username) {
  if (!mediaItems || mediaItems.length === 0) {
    console.log('❌ No media found to download.');
    return;
  }

  const safeUsername = username.replace(/[<>:"/\\|?*]/g, '_').trim() || 'instagram_user';
  const outputDir = path.join(process.cwd(), safeUsername);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const zipFilename = `${safeUsername}.zip`;
  const output = fs.createWriteStream(zipFilename);
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

  let count = 0;
  let failed = 0;

  try {
    for (let i = 0; i < mediaItems.length; i++) {
      const item = mediaItems[i];
      try {
        const url = typeof item === 'string' ? item : item.url;
        const type = typeof item === 'string' ? 'unknown' : (item.type || 'image');

        console.log(`⬇️  [${count + 1}/${mediaItems.length}] Downloading ${type}: ${url.substring(0, 80)}...`);
        const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
        if (!res.ok) {
          console.warn(`⚠️  Failed to download ${url.substring(0, 80)}: HTTP ${res.status}`);
          failed++;
          continue;
        }

        const buffer = Buffer.from(await res.arrayBuffer());
        if (buffer.length === 0) {
          console.warn(`⚠️  Empty response body for ${url.substring(0, 80)}`);
          failed++;
          continue;
        }

        // Determine proper extension
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

        // Save individual file to disk in dedicated folder
        fs.writeFileSync(path.join(outputDir, filename), buffer);

        // Append to zip archive stream
        archive.append(buffer, { name: filename });
        count++;
      } catch (err) {
        console.error(`❌ Error downloading item ${i + 1}:`, err.message);
        failed++;
      }
    }

    if (count === 0) {
      console.log('❌ No media was downloaded successfully.');
      archive.abort();
      output.destroy();
      if (fs.existsSync(zipFilename)) {
        try { fs.unlinkSync(zipFilename); } catch (e) {}
      }
      return;
    }

    console.log('\n📦 Finalizing ZIP archive...');
    await archive.finalize();
    await archivePromise;

    const stats = fs.statSync(zipFilename);
    const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);
    console.log(`\n📁 Folder saved to: ${outputDir}`);
    console.log(`📦 Backup saved to ${zipFilename} (${sizeMB} MB)`);
    console.log(`✅ Successfully downloaded ${count} files! (${failed} failed)`);
  } catch (err) {
    console.error('❌ Error during archiving/downloading:', err.message);
    archive.destroy();
    output.destroy();
    if (fs.existsSync(zipFilename)) {
      try {
        const s = fs.statSync(zipFilename);
        if (s.size === 0) fs.unlinkSync(zipFilename);
      } catch(e) {}
    }
    throw err;
  }
}

// Scroll to load all posts
async function scrollToLoadPosts(page, getInterceptedCount) {
  console.log('🔄 Scrolling to load posts...');
  let previousHeight = await page.evaluate(() => document.body.scrollHeight);
  let scrollAttempts = 0;
  let scrollsDone = 0;
  const maxScrolls = 80;

  // Try dismissing any overlay modals/popups
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
    const count = getInterceptedCount ? getInterceptedCount() : 0;

    if (newHeight === previousHeight) {
      scrollAttempts++;
      console.log(`📜 Attempt ${scrollAttempts}/3 to load more (intercepted ${count} items so far)...`);
    } else {
      scrollAttempts = 0;
      console.log(`📜 Scrolled down (step ${scrollsDone}), intercepted ${count} items so far...`);
    }
    previousHeight = newHeight;
  }
  console.log('🛑 Reached end of posts feed.');
}

// Main function to download media from Instagram profile
async function downloadInstagramMedia(rawInput) {
  const parsed = parseProfileInput(rawInput);
  if (!parsed) {
    console.error('❌ Could not parse a valid Instagram profile or username.');
    return;
  }

  const { username, url: profileUrl } = parsed;
  console.log(`🚀 Starting advanced media download for @${username}...`);
  console.log(`🔗 Target URL: ${profileUrl}`);

  const launchOptions = {
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--lang=en-US'],
    defaultViewport: { width: 1280, height: 800 }
  };
  const execPath = getBrowserExecutablePath();
  if (execPath) {
    launchOptions.executablePath = execPath;
    console.log(`🌐 Using browser: ${execPath}`);
  }

  const browser = await puppeteer.launch(launchOptions);
  const page = await browser.newPage();

  // Set a realistic modern user agent
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36');

  // Load and inject cookies for authentication
  const cookies = loadCookies('cookie.json');
  if (cookies && cookies.length > 0) {
    console.log('🍪 Injecting cookies for authentication...');
    await page.setCookie(...cookies);
    console.log('✅ Cookies injected successfully!');
  }

  // Set up network interception array
  let interceptedMedia = [];

  // Listen for responses - broadened to catch all Instagram API patterns
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
              const before = interceptedMedia.length;
              extractUrlsFromJson(json, interceptedMedia, 0);
              if (interceptedMedia.length > before) {
                console.log(`  🔗 Intercepted ${interceptedMedia.length - before} media items from API`);
              }
            } catch(e) {
              // Fallback regex for URLs inside response string
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
    } catch (e) {
      // Ignore abort/timeout
    }
  });

  console.log(`🧭 Loading profile: ${profileUrl}`);
  await page.goto(profileUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await new Promise(resolve => setTimeout(resolve, 3000));

  // Extract from inline JSON inside <script> tags
  console.log(`🧠 Parsing initial page state for media...`);
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

  console.log(`  📄 Found ${inlineScripts.length} relevant script tags`);
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

    const mediaUrlMatches = scriptContent.match(/"media_url"\s*:\s*"([^"]+)"/g);
    if (mediaUrlMatches) {
      mediaUrlMatches.forEach(m => {
        try {
          const u = JSON.parse('{' + m + '}').media_url;
          if (u && u.startsWith('http')) interceptedMedia.push({ url: u, type: 'image' });
        } catch(e){}
      });
    }
  }

  const isLoggedIn = await page.evaluate(() => {
    const hasLoginInput = document.querySelector('input[name="username"]') || document.querySelector('input[name="email"]');
    const isLoginUrl = window.location.href.includes('/accounts/login') || window.location.href.includes('/challenge');
    return !(hasLoginInput || isLoginUrl);
  });

  if (isLoggedIn) {
    console.log('✅ Successfully authenticated with cookies!');
  } else {
    console.log('⚠️  Not authenticated - limited access to public posts only');
  }

  // Scroll to trigger GraphQL / API requests
  await scrollToLoadPosts(page, () => interceptedMedia.length);

  // Wait for trailing network responses
  console.log('⏳ Waiting for final API responses...');
  await new Promise(resolve => setTimeout(resolve, 4000));

  // Extract from rendered DOM as fallback
  console.log('🖼️  Extracting media URLs from rendered DOM...');
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
    console.log(`  🖼️  Found ${domMedia.length} media elements in DOM`);
    interceptedMedia.push(...domMedia);
  }

  await browser.close();

  // Process and deduplicate intercepted items
  console.log('🔍 Processing intercepted network payloads...');
  console.log(`  📦 Raw intercepted items: ${interceptedMedia.length}`);

  const uniqueMediaMap = new Map();
  interceptedMedia.forEach(item => {
    const url = item.url;
    if (url && typeof url === 'string' && url.startsWith('http') && !url.includes('logging') && !url.includes('analytics')) {
      uniqueMediaMap.set(url, item);
    }
  });

  let uniqueMediaItems = Array.from(uniqueMediaMap.values());
  console.log(`  📦 After dedup: ${uniqueMediaItems.length}`);

  const beforeFilter = uniqueMediaItems.length;
  uniqueMediaItems = uniqueMediaItems.filter(item => {
    const filtered = filterHighResUrls([item.url]);
    return filtered.length > 0;
  });

  console.log(`🔧 Filtered ${beforeFilter - uniqueMediaItems.length} low-resolution images/thumbnails`);
  console.log(`✅ Extracted a total of ${uniqueMediaItems.length} high-quality media files.\n`);

  if (uniqueMediaItems.length > 0) {
    console.log(`📥 Downloading ${uniqueMediaItems.length} media files...\n`);
    await downloadMedia(uniqueMediaItems, username);
  } else {
    console.log('❌ No media found to download.');
  }

  console.log('🏁 Process completed!');
}

// --- Entry Point ---
(async () => {
  const input = await askQuestion('🔗 Enter Instagram profile URL or username (e.g. tabassum_nirjhi): ');

  if (!input) {
    console.error('❌ Input cannot be empty.');
    process.exit(1);
  }

  try {
    await downloadInstagramMedia(input);
  } catch (err) {
    console.error('❌ An unexpected error occurred:', err);
  }
})();
