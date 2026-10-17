const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');
const { sanitizeFilename } = require('./media-extractor');

/**
 * Builds a ZIP buffer from a list of media items using JSZip
 * @param {Array} mediaItems List of media items to package
 * @param {string} profileName Username for naming
 * @param {Function} [onProgress] Progress callback
 */
async function buildZipBuffer(mediaItems, profileName, onProgress = null) {
  if (!Array.isArray(mediaItems) || mediaItems.length === 0) {
    throw new Error('No media items to package into ZIP.');
  }

  const cleanName = sanitizeFilename(profileName || 'instagram_user', 'instagram_user');
  const zip = new JSZip();
  let addedCount = 0;
  const seenFilenames = new Set();

  const BATCH_SIZE = 12;
  const total = mediaItems.length;

  for (let i = 0; i < total; i += BATCH_SIZE) {
    const chunk = mediaItems.slice(i, i + BATCH_SIZE);
    await Promise.all(chunk.map(async (item, idx) => {
      if (!item || !item.url) return;
      const fileIndex = i + idx + 1;

      let fileFilename = sanitizeFilename(item.filename || `${cleanName}_${fileIndex}.jpg`, `file_${fileIndex}`);
      if (seenFilenames.has(fileFilename)) {
        const dotIdx = fileFilename.lastIndexOf('.');
        if (dotIdx !== -1) {
          fileFilename = `${fileFilename.slice(0, dotIdx)}_${fileIndex}${fileFilename.slice(dotIdx)}`;
        } else {
          fileFilename = `${fileFilename}_${fileIndex}`;
        }
      }
      seenFilenames.add(fileFilename);

      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 25000);

        const response = await fetch(item.url, {
          signal: controller.signal,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
            'Referer': 'https://www.instagram.com/'
          }
        });
        clearTimeout(timeoutId);

        if (!response.ok) {
          return;
        }

        const buffer = await response.arrayBuffer();
        if (buffer.byteLength > 0) {
          zip.file(fileFilename, Buffer.from(buffer));
          addedCount++;
        }
      } catch (err) {
        // Individual file fetch fail is non-fatal
      }
    }));

    if (onProgress) {
      onProgress({
        current: Math.min(i + BATCH_SIZE, total),
        total,
        addedCount,
        percent: Math.round((Math.min(i + BATCH_SIZE, total) / total) * 100)
      });
    }
  }

  if (addedCount === 0) {
    zip.file('README.txt', `No media files could be downloaded for @${cleanName}.`);
  }

  // STORE compression is optimal for already-compressed JPEG/PNG/MP4
  const zipBuffer = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'STORE'
  });

  return {
    buffer: zipBuffer,
    addedCount,
    totalFiles: total,
    filename: `${cleanName}.zip`
  };
}

/**
 * Build and stream ZIP directly to Express HTTP response
 */
async function streamZipArchive(mediaItems, profileName, res) {
  const cleanName = sanitizeFilename(profileName || 'instagram_user', 'instagram_user');
  const zipFilename = `${cleanName}.zip`;
  const encodedFilename = encodeURIComponent(zipFilename);

  console.log(`[ZIP Builder] Packaging ${mediaItems.length} media files for @${cleanName}...`);
  const result = await buildZipBuffer(mediaItems, cleanName);

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Length', result.buffer.length);
  res.setHeader('Content-Disposition', `attachment; filename="${zipFilename}"; filename*=UTF-8''${encodedFilename}`);

  res.send(result.buffer);
}

/**
 * Save media files and ZIP archive to disk (for terminal or web static downloads)
 */
async function saveMediaToDisk(mediaItems, profileName, baseDir = null, onProgress = null) {
  const cleanName = sanitizeFilename(profileName || 'instagram_user', 'instagram_user');
  const targetDir = baseDir || path.join(process.cwd(), cleanName);

  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  const savedFiles = [];
  const BATCH_SIZE = 10;
  const total = mediaItems.length;
  let downloadedCount = 0;

  for (let i = 0; i < total; i += BATCH_SIZE) {
    const chunk = mediaItems.slice(i, i + BATCH_SIZE);
    await Promise.all(chunk.map(async (item, idx) => {
      if (!item || !item.url) return;
      const fileIndex = i + idx + 1;
      const filename = sanitizeFilename(item.filename || `${cleanName}_${fileIndex}.jpg`, `file_${fileIndex}`);
      const filePath = path.join(targetDir, filename);

      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 25000);

        const response = await fetch(item.url, {
          signal: controller.signal,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
            'Referer': 'https://www.instagram.com/'
          }
        });
        clearTimeout(timeoutId);

        if (!response.ok) return;

        const buffer = Buffer.from(await response.arrayBuffer());
        if (buffer.length > 0) {
          fs.writeFileSync(filePath, buffer);
          downloadedCount++;
          savedFiles.push({
            filename,
            type: item.type,
            category: item.category,
            path: filePath,
            size: buffer.length
          });
        }
      } catch (e) {}
    }));

    if (onProgress) {
      onProgress({
        downloaded: downloadedCount,
        total,
        percent: Math.round((Math.min(i + BATCH_SIZE, total) / total) * 100)
      });
    }
  }

  // Also package into ZIP file in parent directory or targetDir
  const zipResult = await buildZipBuffer(mediaItems, cleanName);
  const zipPath = path.join(path.dirname(targetDir), `${cleanName}.zip`);
  fs.writeFileSync(zipPath, zipResult.buffer);

  return {
    savedDir: targetDir,
    zipPath,
    downloadedCount,
    files: savedFiles
  };
}

module.exports = {
  buildZipBuffer,
  streamZipArchive,
  saveMediaToDisk
};
