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

// Ask user for input (URL)
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

// Load cookies from JSON file
function loadCookies(cookieFile = 'fb_cookie.json') {
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
          cookie.domain.includes('facebook.com') ||
          cookie.domain.includes('.facebook.com')
        );
      });
      
      console.log(`✅ Loaded ${normalizedCookies.length} cookies from ${cookieFile}`);
      return normalizedCookies;
    } else {
      console.log(`⚠️  Cookie file ${cookieFile} not found. You likely need it for full access.`);
    }
  } catch (err) {
    console.log(`⚠️  Could not load cookies: ${err.message}`);
  }
  return null;
}

// Filter out low-resolution images and non-media patterns
function filterHighResUrls(urls) {
  const lowResPatterns = [
    /p\d+x\d+/i,
    /s\d+x\d+/i,
    /thumb/i,
    /small/i,
    /lowres/i,
    /thumbnail/i,
    /avatar/i,
    /profile_pic/i,
    /profile_cover/i,
    /emoji\.php/i,
    /rsrc\.php/i,
    /static\.xx\.fbcdn\.net/i,
    /150x150/i,
    /320x320/i,
    /100x100/i,
    /240x240/i,
    /480x480/i
  ];
  return urls.filter(url => !lowResPatterns.some(pattern => pattern.test(url)));
}

// Check if a URL looks like an actual FB media item
function isValidFbMediaUrl(url) {
  if (!url || typeof url !== 'string') return false;
  if (!url.startsWith('https://') && !url.startsWith('http://')) return false;
  if (!url.includes('fbcdn.net')) return false;
  
  // Filter out static assets
  if (url.includes('/rsrc.php/') || url.includes('/static.xx/')) return false;

  // Typical photo or video markers on fbcdn
  const isMediaPattern = 
    url.includes('/t39.30808-6/') ||
    url.includes('/t1.6435-9/') ||
    url.includes('/t51.2885-15/') ||
    url.includes('/v/t') ||
    url.includes('.mp4') ||
    url.includes('.jpg') ||
    url.includes('.jpeg') ||
    url.includes('.png');

  return isMediaPattern;
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
    // Check for high-res photo/video node fields in Facebook's GraphQL responses
    if (obj.image && obj.image.uri) {
      urlsArray.push({ url: obj.image.uri, type: 'image' });
    }
    if (obj.large_share_image && obj.large_share_image.uri) {
      urlsArray.push({ url: obj.large_share_image.uri, type: 'image' });
    }
    if (obj.photo_image && obj.photo_image.uri) {
      urlsArray.push({ url: obj.photo_image.uri, type: 'image' });
    }
    if (obj.full_screen_video_and_audio_url) {
      urlsArray.push({ url: obj.full_screen_video_and_audio_url, type: 'video' });
    }
    if (obj.playable_url_quality_hd) {
      urlsArray.push({ url: obj.playable_url_quality_hd, type: 'video' });
    } else if (obj.playable_url) {
      urlsArray.push({ url: obj.playable_url, type: 'video' });
    }
    if (obj.browser_native_hd_url) {
      urlsArray.push({ url: obj.browser_native_hd_url, type: 'video' });
    } else if (obj.browser_native_sd_url) {
      urlsArray.push({ url: obj.browser_native_sd_url, type: 'video' });
    }

    if (obj.url && typeof obj.url === 'string' && isValidFbMediaUrl(obj.url)) {
      const type = obj.url.includes('.mp4') ? 'video' : 'image';
      urlsArray.push({ url: obj.url, type });
    }

    for (let key in obj) {
      extractUrlsFromJson(obj[key], urlsArray, depth + 1);
    }
  }
}

// Download media and create a ZIP file
async function downloadMedia(mediaItems, profileName) {
  if (!mediaItems || mediaItems.length === 0) {
    console.log('❌ No media found to download.');
    return;
  }

  const safeProfileName = profileName.replace(/[<>:"/\\|?*]/g, '_').trim() || 'facebook_media';
  const outputDir = path.join(process.cwd(), safeProfileName);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const zipFilename = `${safeProfileName}.zip`;
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
        const url = item.url;
        let type = item.type;
        
        if (type === 'unknown' || !type) {
          type = url.includes('.mp4') ? 'video' : 'photo';
        } else if (type === 'image') {
          type = 'photo';
        }

        console.log(`⬇️  [${count + 1}/${mediaItems.length}] Downloading ${type}: ${url.substring(0, 80)}...`);
        
        const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
        if (!res.ok) {
          console.warn(`⚠️  Failed to download ${url.substring(0, 80)}: HTTP ${res.status}`);
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
        } else if (!ext || ext === '') {
          ext = type === 'video' ? '.mp4' : '.jpg';
        }
        
        const filename = `${safeProfileName}_${String(count + 1).padStart(4, '0')}_${type}${ext}`;
        fs.writeFileSync(path.join(outputDir, filename), buffer);

        archive.append(buffer, { name: filename });
        count++;
      } catch (err) {
        console.error(`❌ Error downloading item ${i + 1}:`, err.message);
        failed++;
      }
    }

    if (count === 0) {
      console.log('❌ No media was downloaded.');
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
      } catch (e) {}
    }
    throw err;
  }
}

// Scroll to load all posts
async function scrollToLoadPosts(page) {
  console.log('🔄 Scrolling to load posts/media...');
  let previousHeight = await page.evaluate(() => document.body.scrollHeight);
  let scrollAttempts = 0;
  let scrollsDone = 0;
  const maxScrolls = 80;

  try {
    await page.evaluate(() => {
      const candidates = Array.from(document.querySelectorAll('div[aria-label="Close"], button, div[role="button"]'));
      for (const el of candidates) {
        const txt = (el.innerText || '').toLowerCase().trim();
        if (txt === 'not now' || txt === 'decline optional cookies' || txt === 'allow all cookies') {
          el.click();
          break;
        }
      }
    });
  } catch(e) {}
  
  while (scrollAttempts < 4 && scrollsDone < maxScrolls) {
    await page.evaluate(() => {
      window.scrollBy(0, 1000);
      window.scrollTo(0, document.body.scrollHeight);
    });
    await new Promise(resolve => setTimeout(resolve, 2500));
    scrollsDone++;
    
    const newHeight = await page.evaluate(() => document.body.scrollHeight);
    if (newHeight === previousHeight) {
      scrollAttempts++;
      console.log(`📜 Attempt ${scrollAttempts}/4 to load more...`);
    } else {
      scrollAttempts = 0;
      console.log(`📜 Scrolled down (step ${scrollsDone}), more media loading...`);
    }
    previousHeight = newHeight;
  }
  console.log('🛑 Reached end of media feed.');
}

// Parse Facebook input URL or username
function parseFacebookInput(targetUrl) {
  let clean = targetUrl.trim().replace(/^["']|["']$/g, '');
  if (!clean.startsWith('http://') && !clean.startsWith('https://')) {
    clean = 'https://' + clean;
  }

  let profileName = 'facebook_media';
  try {
    const urlObj = new URL(clean);
    if (urlObj.searchParams.has('id')) {
      profileName = `profile_${urlObj.searchParams.get('id')}`;
    } else {
      const pathParts = urlObj.pathname.split('/').filter(p => p.length > 0);
      if (pathParts.length > 0) {
        profileName = pathParts[0];
      }
    }
  } catch (e) {}

  profileName = profileName.replace(/[<>:"/\\|?*]/g, '_').trim() || 'facebook_media';
  return { profileName, targetUrl: clean };
}

// Main function to download media from Facebook
async function downloadFacebookMedia(rawUrl) {
  const { profileName, targetUrl } = parseFacebookInput(rawUrl);

  console.log(`🚀 Starting advanced media download for ${profileName}...`);
  console.log(`🔗 Target URL: ${targetUrl}`);

  const launchOptions = {
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--lang=en-US', '--disable-notifications'],
    defaultViewport: { width: 1280, height: 800 }
  };
  const execPath = getBrowserExecutablePath();
  if (execPath) {
    launchOptions.executablePath = execPath;
    console.log(`🌐 Using browser: ${execPath}`);
  }

  const browser = await puppeteer.launch(launchOptions);
  const page = await browser.newPage();
  
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36');

  // Load and inject cookies for authentication
  const cookies = loadCookies('fb_cookie.json');
  if (cookies && cookies.length > 0) {
    console.log('🍪 Injecting cookies for authentication...');
    await page.setCookie(...cookies);
    console.log('✅ Cookies injected successfully!');
  }

  let interceptedMedia = [];

  // Listen for responses
  page.on('response', async (response) => {
    try {
      const url = response.url();
      const resourceType = response.request().resourceType();

      if (resourceType === 'xhr' || resourceType === 'fetch') {
        const isApiEndpoint = url.includes('/api/graphql/') || url.includes('/graphql/');

        if (isApiEndpoint) {
          const contentType = response.headers()['content-type'] || '';
          if (contentType.includes('json') || contentType.includes('text') || contentType.includes('application/x-www-form-urlencoded')) {
            const text = await response.text();
            const parts = text.split('\n');
            const before = interceptedMedia.length;

            for (const part of parts) {
              if (!part.trim()) continue;
              try {
                const json = JSON.parse(part);
                extractUrlsFromJson(json, interceptedMedia, 0);
              } catch(e) {
                const urlMatches = part.match(/https:\/\/[^"]*fbcdn\.net[^"\\]*/g);
                if (urlMatches) {
                  urlMatches.forEach(m => {
                    const cleanUrl = m.replace(/\\/g, '');
                    if (isValidFbMediaUrl(cleanUrl)) {
                      const type = cleanUrl.includes('.mp4') ? 'video' : 'image';
                      interceptedMedia.push({ url: cleanUrl, type });
                    }
                  });
                }
              }
            }
            
            if (interceptedMedia.length > before) {
              console.log(`  🔗 Intercepted ${interceptedMedia.length - before} media items from GraphQL`);
            }
          }
        }
      }
    } catch (e) {
      // Ignore
    }
  });

  console.log(`🧭 Loading URL: ${targetUrl}`);
  await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await new Promise(resolve => setTimeout(resolve, 3000));
  
  console.log(`🧠 Parsing initial page state for media...`);
  const inlineScripts = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('script'))
      .map(script => script.textContent)
      .filter(text => text && text.includes('fbcdn.net'));
  });

  console.log(`  📄 Found ${inlineScripts.length} relevant script tags`);

  for (const scriptContent of inlineScripts) {
    try {
      extractUrlsFromJson(scriptContent, interceptedMedia, 0);
    } catch(e) {}
    
    const urlMatches = scriptContent.match(/https:\/\/[^"]*fbcdn\.net[^"\\]*/g);
    if (urlMatches) {
      urlMatches.forEach(m => {
        const cleanUrl = m.replace(/\\/g, '');
        if (isValidFbMediaUrl(cleanUrl)) {
          const type = cleanUrl.includes('.mp4') ? 'video' : 'image';
          interceptedMedia.push({ url: cleanUrl, type });
        }
      });
    }
  }

  const isLoggedIn = await page.evaluate(() => {
    return !window.location.href.includes('/login');
  });
  
  if (isLoggedIn) {
    console.log('✅ Successfully authenticated with cookies (or public page accessible)!');
  } else {
    console.log('⚠️  Not authenticated - redirected to login screen! Check your fb_cookie.json');
  }

  await scrollToLoadPosts(page);
  await new Promise(resolve => setTimeout(resolve, 3000));

  await browser.close();

  // Process intercepted media
  console.log('🔍 Processing intercepted network payloads...');
  console.log(`  📦 Raw intercepted items: ${interceptedMedia.length}`);

  const uniqueMediaMap = new Map();
  interceptedMedia.forEach(item => {
    let url = item.url;
    try {
      url = url.replace(/\\u0025/g, '%');
      url = decodeURIComponent(url);
    } catch(e){}

    if (isValidFbMediaUrl(url)) {
      const baseUrl = url.split('?')[0];
      if (uniqueMediaMap.has(baseUrl)) {
        if (item.type === 'video' && uniqueMediaMap.get(baseUrl).type === 'image') {
          uniqueMediaMap.set(baseUrl, { url, type: item.type });
        }
      } else {
        uniqueMediaMap.set(baseUrl, { url, type: item.type });
      }
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
    await downloadMedia(uniqueMediaItems, profileName);
  } else {
    console.log('❌ No media found to download.');
  }

  console.log('🏁 Process completed!');
}

// --- Entry Point ---
(async () => {
  console.log('📘 Welcome to Facebook Media Downloader');
  const targetUrl = await askQuestion('🔗 Enter Facebook profile/page URL (e.g. https://www.facebook.com/username/photos): ');

  if (!targetUrl || !targetUrl.includes('facebook.com')) {
    console.error('❌ Invalid Facebook URL.');
    process.exit(1);
  }

  try {
    await downloadFacebookMedia(targetUrl);
  } catch (err) {
    console.error('❌ An unexpected error occurred:', err);
  }
})();
