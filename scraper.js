const path = require('path');
const { InstagramScraper, normalizeProfileInput } = require('./lib/instagram-scraper');
const { saveMediaToDisk } = require('./lib/zip-builder');

/**
 * High-level scraping function used by server and legacy scripts
 */
async function scrapeInstagram(rawInput, cookiesData, onProgress = () => {}) {
  const scraper = new InstagramScraper();

  const progressBridge = (event) => {
    if (typeof onProgress === 'function') {
      if (typeof event === 'string') {
        onProgress(event);
      } else if (event && event.message) {
        onProgress(event.message);
      }
    }
  };

  try {
    const scanResult = await scraper.scrape(rawInput, cookiesData, progressBridge);
    const { username, media, profile, summary } = scanResult;

    if (!media || media.length === 0) {
      progressBridge('❌ No media found to download for this profile.');
      return {
        zipUrl: null,
        files: [],
        count: 0,
        username,
        profile,
        summary
      };
    }

    progressBridge(`💾 Downloading and packaging ${media.length} media files into local backup...`);

    const publicDir = path.join(__dirname, 'public');
    const downloadsDir = path.join(publicDir, 'downloads', username);
    const diskResult = await saveMediaToDisk(media, username, downloadsDir, (p) => {
      progressBridge(`⬇️ Downloaded ${p.downloaded}/${p.total} files (${p.percent}%)...`);
    });

    const zipFilename = `${username}.zip`;
    progressBridge(`✅ Archive successfully created: ${zipFilename} (${diskResult.downloadedCount} files)`);

    const clientFiles = diskResult.files.map(f => ({
      filename: f.filename,
      type: f.type,
      category: f.category,
      url: `/downloads/${username}/${f.filename}`
    }));

    return {
      zipUrl: `/downloads/${zipFilename}`,
      files: clientFiles,
      count: diskResult.downloadedCount,
      username,
      profile,
      summary,
      media
    };
  } catch (err) {
    progressBridge(`❌ ERROR: ${err.message}`);
    throw err;
  }
}

module.exports = {
  scrapeInstagram,
  InstagramScraper,
  normalizeProfileInput
};
