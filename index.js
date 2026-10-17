const path = require('path');
const readline = require('readline');
const { InstagramScraper, normalizeProfileInput } = require('./lib/instagram-scraper');
const { loadCookies, getCookieStatus } = require('./lib/cookie-manager');
const { saveMediaToDisk } = require('./lib/zip-builder');

function askQuestion(query) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  return new Promise((resolve) =>
    rl.question(query, (ans) => {
      rl.close();
      resolve(ans.trim());
    })
  );
}

async function main() {
  console.log('\n======================================================');
  console.log('📸  INSTAGRAM PROFILE MEDIA DOWNLOADER (PRO)');
  console.log('    High-Resolution Photos, Videos, Reels, Carousels & Highlights');
  console.log('======================================================\n');

  // Check authentication cookies from cookies.json or cookie.json
  const cookieStatus = getCookieStatus();
  if (cookieStatus.hasCookies && cookieStatus.hasSession) {
    console.log(`🍪 Authentication: ACTIVE (${cookieStatus.count} cookies loaded from ${cookieStatus.source})`);
    if (cookieStatus.userId) {
      console.log(`👤 Logged in as User ID: ${cookieStatus.userId}`);
    }
  } else {
    console.log('⚠️  Authentication: No active session cookies found in cookies.json / cookie.json');
    console.log('   (Running in public guest mode — private profiles require cookies)');
  }
  console.log('');

  const input = await askQuestion('🔗 Enter Instagram profile URL or username (e.g. natgeo, @poofbyte): ');
  if (!input) {
    console.error('❌ Input cannot be empty.');
    process.exit(1);
  }

  const normalized = normalizeProfileInput(input);
  if (!normalized || !normalized.username) {
    console.error('❌ Could not parse a valid Instagram profile or username.');
    process.exit(1);
  }

  console.log(`\n🚀 Starting target extraction for @${normalized.username}...`);
  console.log(`🔗 Target URL: ${normalized.profileUrl}\n`);

  const scraper = new InstagramScraper();

  // Handle Ctrl+C gracefully
  process.on('SIGINT', () => {
    console.log('\n🛑 Aborting scan, closing browser...');
    scraper.cancel();
    process.exit(0);
  });

  try {
    const result = await scraper.scrape(input, null, (event) => {
      if (typeof event === 'object' && event.message) {
        console.log(`  ${event.message}`);
      } else if (typeof event === 'string') {
        console.log(`  ${event}`);
      }
    });

    const { username, media, profile, summary } = result;

    if (!media || media.length === 0) {
      console.log('\n❌ No media items found to download.');
      process.exit(0);
    }

    console.log('\n------------------------------------------------------');
    console.log(`🎯 Media Extracted Exclusively for @${username}:`);
    console.log(`   📸 Images:      ${summary.imagesCount}`);
    console.log(`   🎬 Videos/Reels:${summary.videosCount}`);
    console.log(`   🎠 Carousels:   ${summary.carouselsCount}`);
    console.log(`   ⭐ Highlights:  ${summary.highlightsCount}`);
    console.log(`   📦 Total Files: ${summary.totalMedia}`);
    console.log('------------------------------------------------------\n');

    console.log(`📥 Downloading ${media.length} files to disk and building ZIP archive...`);

    const outputDir = path.join(process.cwd(), username);
    const saveResult = await saveMediaToDisk(media, username, outputDir, (p) => {
      process.stdout.write(`\r⬇️  Progress: ${p.downloaded}/${p.total} files downloaded (${p.percent}%)...`);
    });

    console.log('\n\n✅ Download and Archiving Complete!');
    console.log(`📁 Media Folder: ${saveResult.savedDir}`);
    console.log(`📦 ZIP Archive:  ${saveResult.zipPath}`);
    console.log(`🎉 Successfully saved ${saveResult.downloadedCount} high-res media files!\n`);

  } catch (err) {
    console.error('\n❌ An error occurred during scraping:', err.message);
    process.exit(1);
  }
}

main();
