/**
 * Instagram Media Extractor
 * Strictly isolates target profile media, selects highest resolution assets,
 * normalizes filenames, handles carousels, reels, and highlights.
 */

/**
 * Clean and normalize user input into an Instagram username and canonical URLs
 */
function normalizeProfileInput(input) {
  if (!input || typeof input !== 'string') return null;
  let str = input.trim().replace(/^["']|["']$/g, '');

  // Strip leading @
  if (str.startsWith('@')) {
    str = str.slice(1);
  }

  // Handle URL inputs
  if (str.includes('instagram.com')) {
    if (!str.startsWith('http://') && !str.startsWith('https://')) {
      str = 'https://' + str;
    }

    try {
      const u = new URL(str);
      const segments = u.pathname.split('/').filter(Boolean);

      // Check for /p/ or /reel/ links
      if (segments.length >= 2 && (segments[0] === 'p' || segments[0] === 'reel' || segments[0] === 'tv')) {
        // Provided a single post/reel URL instead of profile
        return {
          type: 'single_post',
          code: segments[1],
          profileUrl: str,
          rawInput: input
        };
      }

      if (segments.length > 0) {
        // First segment is username, ignoring reserved paths like 'accounts', 'explore', etc.
        const reserved = ['explore', 'reels', 'stories', 'direct', 'accounts', 'developer', 'about'];
        if (!reserved.includes(segments[0].toLowerCase())) {
          const cleanUser = segments[0].replace(/[<>:"/\\|?*]/g, '_').trim();
          return {
            username: cleanUser,
            profileUrl: `https://www.instagram.com/${cleanUser}/`,
            reelsUrl: `https://www.instagram.com/${cleanUser}/reels/`,
            rawInput: input
          };
        }
      }
    } catch (e) {}

    // Fallback regex match
    const match = str.match(/instagram\.com\/([a-zA-Z0-9._]+)/i);
    if (match) {
      const cleanUser = match[1].replace(/[<>:"/\\|?*]/g, '_').trim();
      return {
        username: cleanUser,
        profileUrl: `https://www.instagram.com/${cleanUser}/`,
        reelsUrl: `https://www.instagram.com/${cleanUser}/reels/`,
        rawInput: input
      };
    }
  }

  // Pure username
  const cleanUsername = str.split(/[/?#]/)[0].replace(/[^a-zA-Z0-9._]/g, '').trim();
  if (!cleanUsername) return null;

  return {
    username: cleanUsername,
    profileUrl: `https://www.instagram.com/${cleanUsername}/`,
    reelsUrl: `https://www.instagram.com/${cleanUsername}/reels/`,
    rawInput: input
  };
}

/**
 * Sanitize filename preserving valid characters across Windows, Linux, and macOS
 */
function sanitizeFilename(name, fallback = 'media') {
  if (!name || typeof name !== 'string') return fallback;
  let clean = name.replace(/[<>:"/\\|?*\x00-\x1F]+/g, '_').trim();
  clean = clean.replace(/^[.\s]+|[.\s]+$/g, '');
  return clean || fallback;
}

/**
 * Format timestamp into ISO-like readable date string
 */
function formatTimestamp(timestamp) {
  if (!timestamp) return 'unknown_date';
  const d = new Date(typeof timestamp === 'number' && timestamp < 1e11 ? timestamp * 1000 : timestamp);
  if (isNaN(d.getTime())) return 'unknown_date';

  const pad = (n) => String(n).padStart(2, '0');
  const y = d.getUTCFullYear();
  const m = pad(d.getUTCMonth() + 1);
  const day = pad(d.getUTCDate());
  const h = pad(d.getUTCHours());
  const min = pad(d.getUTCMinutes());
  const s = pad(d.getUTCSeconds());
  return `${y}-${m}-${day}_${h}-${min}-${s}Z`;
}

/**
 * Pick highest resolution image candidate by area
 */
function getBestImageCandidate(candidates) {
  if (!Array.isArray(candidates) || candidates.length === 0) return null;
  return candidates.reduce((best, curr) => {
    if (!curr || !curr.url) return best;
    if (!best) return curr;
    const bestArea = (best.width || 0) * (best.height || 0);
    const currArea = (curr.width || 0) * (curr.height || 0);
    return currArea > bestArea ? curr : best;
  }, null);
}

/**
 * Pick highest quality progressive video version
 */
function getBestVideoVersion(versions) {
  if (!Array.isArray(versions) || versions.length === 0) return null;
  return versions.reduce((best, curr) => {
    if (!curr || !curr.url) return best;
    if (!best) return curr;
    const bestArea = (best.width || 0) * (best.height || 0);
    const currArea = (curr.width || 0) * (curr.height || 0);
    return currArea > bestArea ? curr : best;
  }, versions[0]);
}

/**
 * Infer extension from URL or type
 */
function inferExtension(url, type = 'image') {
  try {
    const pathname = new URL(url).pathname;
    const match = pathname.match(/\.([a-z0-9]+)$/i);
    if (match) {
      const ext = match[1].toLowerCase();
      if (['jpg', 'jpeg', 'png', 'webp', 'mp4', 'mov', 'webm'].includes(ext)) {
        return ext === 'jpeg' ? 'jpg' : ext;
      }
    }
  } catch (e) {}
  return type === 'video' ? 'mp4' : 'jpg';
}

/**
 * CRITICAL PROFILE-ISOLATION CHECK:
 * Strictly verify that a post or media item belongs to the requested profile.
 * Rejects suggested users, ads, story tray items, and timeline feed items from other users.
 */
function isTargetUserMedia(item, targetUserId, targetUsername) {
  if (!item) return false;

  const targetPkStr = targetUserId ? String(targetUserId) : null;
  const targetUserLower = targetUsername ? String(targetUsername).toLowerCase().trim() : null;

  // 1. Direct user / owner match
  const user = item.user || item.owner;
  if (user) {
    const userPk = user.pk || user.id || user.pk_id;
    if (targetPkStr && userPk && String(userPk) === targetPkStr) {
      return true;
    }
    const username = user.username;
    if (targetUserLower && username && String(username).toLowerCase().trim() === targetUserLower) {
      return true;
    }
  }

  // 2. Post ID suffix match (Instagram GraphQL format: `${media_pk}_${user_pk}`)
  if (targetPkStr && item.id && typeof item.id === 'string') {
    const parts = item.id.split('_');
    if (parts.length === 2 && parts[1] === targetPkStr) {
      return true;
    }
  }

  // 3. Coauthor check (if target user co-authored the post)
  if (Array.isArray(item.coauthor_producers) && item.coauthor_producers.length > 0) {
    const isCoauthor = item.coauthor_producers.some(co => {
      const coPk = co.pk || co.id;
      if (targetPkStr && coPk && String(coPk) === targetPkStr) return true;
      if (targetUserLower && co.username && String(co.username).toLowerCase().trim() === targetUserLower) return true;
      return false;
    });
    if (isCoauthor) return true;
  }

  // 4. If neither user PK nor username matched, reject to prevent profile mixing
  return false;
}

/**
 * Extract normalized media items from an Instagram post object
 */
function extractMediaFromPost(post, targetUsername, targetUserId = null, sourceCategory = 'post') {
  if (!post) return [];

  // Enforce strict profile isolation
  if (!isTargetUserMedia(post, targetUserId, targetUsername)) {
    return [];
  }

  const results = [];
  const username = sanitizeFilename(post.user?.username || targetUsername || 'instagram_user');
  const code = post.code || '';
  const postId = String(post.pk || post.id || code);
  const dateStr = formatTimestamp(post.taken_at);
  const caption = post.caption?.text || '';
  const postUrl = code ? `https://www.instagram.com/p/${code}/` : null;

  // Helper to extract a single normalized item
  const buildItem = (rawItem, index, isCarousel = false, totalSlides = 1) => {
    let type = 'image';
    let mediaUrl = null;
    let previewUrl = null;
    let width = rawItem.original_width || null;
    let height = rawItem.original_height || null;

    // Check for video first (Reels, Feed Videos, Carousel Videos)
    const hasVideo = (rawItem.media_type === 2) || (Array.isArray(rawItem.video_versions) && rawItem.video_versions.length > 0) || rawItem.video_url;
    if (hasVideo) {
      type = 'video';
      if (Array.isArray(rawItem.video_versions) && rawItem.video_versions.length > 0) {
        const bestVid = getBestVideoVersion(rawItem.video_versions);
        if (bestVid) {
          mediaUrl = bestVid.url;
          width = bestVid.width || width;
          height = bestVid.height || height;
        }
      } else if (rawItem.video_url) {
        mediaUrl = rawItem.video_url;
      }

      // Poster thumbnail
      const posterCandidate = getBestImageCandidate(rawItem.image_versions2?.candidates);
      previewUrl = posterCandidate?.url || rawItem.display_url || null;
    } else {
      // Image (Photos, Carousel Images)
      type = 'image';
      if (rawItem.image_versions2?.candidates?.length) {
        const bestImg = getBestImageCandidate(rawItem.image_versions2.candidates);
        if (bestImg) {
          mediaUrl = bestImg.url;
          width = bestImg.width || width;
          height = bestImg.height || height;
          previewUrl = bestImg.url;
        }
      } else if (rawItem.display_resources?.length) {
        const sorted = [...rawItem.display_resources].sort((a, b) => (b.config_width || 0) - (a.config_width || 0));
        if (sorted[0]?.src) {
          mediaUrl = sorted[0].src;
          previewUrl = mediaUrl;
        }
      } else if (rawItem.display_url) {
        mediaUrl = rawItem.display_url;
        previewUrl = mediaUrl;
      }
    }

    if (!mediaUrl) return null;

    const ext = inferExtension(mediaUrl, type);
    const mediaPk = rawItem.pk || rawItem.id || `${postId}_${index}`;
    let category = sourceCategory;
    if (isCarousel) {
      category = 'carousel';
    } else if (post.product_type === 'clips' || type === 'video') {
      category = 'reel';
    }

    const filename = isCarousel
      ? `${username}_${dateStr}_${code || postId}_carousel_${index + 1}_of_${totalSlides}.${ext}`
      : `${username}_${dateStr}_${code || postId}_${category}.${ext}`;

    return {
      id: `${postId}_${mediaPk}_${index}`,
      postId,
      mediaPk: String(mediaPk),
      code,
      postUrl,
      type,
      category,
      url: mediaUrl,
      previewUrl: previewUrl || mediaUrl,
      width,
      height,
      resolution: width && height ? `${width}x${height}` : (type === 'video' ? 'HD Video' : 'Original'),
      caption,
      takenAt: post.taken_at ? (typeof post.taken_at === 'number' && post.taken_at < 1e11 ? post.taken_at * 1000 : post.taken_at) : null,
      username,
      isCarousel,
      carouselIndex: isCarousel ? index + 1 : null,
      carouselTotal: isCarousel ? totalSlides : null,
      filename: sanitizeFilename(filename, `instagram_${postId}.${ext}`)
    };
  };

  // 1. Check for Carousel Album
  if (Array.isArray(post.carousel_media) && post.carousel_media.length > 0) {
    const total = post.carousel_media.length;
    post.carousel_media.forEach((item, idx) => {
      const extracted = buildItem(item, idx, true, total);
      if (extracted) results.push(extracted);
    });
  } else if (post.edge_sidecar_to_children?.edges?.length) {
    // GraphQL edge_sidecar_to_children format
    const edges = post.edge_sidecar_to_children.edges;
    edges.forEach((edge, idx) => {
      if (edge.node) {
        const extracted = buildItem(edge.node, idx, true, edges.length);
        if (extracted) results.push(extracted);
      }
    });
  } else {
    // 2. Single item (Photo or Video/Reel)
    const single = buildItem(post, 0, false, 1);
    if (single) results.push(single);
  }

  return results;
}

/**
 * Extract media items from an Instagram Highlight Reel
 */
function extractMediaFromHighlight(reel, highlightTitle, targetUsername, targetUserId = null) {
  if (!reel || !Array.isArray(reel.items) || reel.items.length === 0) return [];

  const results = [];
  const safeTitle = sanitizeFilename(highlightTitle || 'highlight', 'highlight');
  const username = sanitizeFilename(targetUsername || 'instagram_user');

  reel.items.forEach((item, idx) => {
    // Highlights can be image or video
    let type = 'image';
    let mediaUrl = null;
    let previewUrl = null;
    let width = item.original_width || null;
    let height = item.original_height || null;

    if (item.media_type === 2 && Array.isArray(item.video_versions) && item.video_versions.length > 0) {
      type = 'video';
      const bestVid = getBestVideoVersion(item.video_versions);
      if (bestVid) {
        mediaUrl = bestVid.url;
        width = bestVid.width || width;
        height = bestVid.height || height;
      }
      const poster = getBestImageCandidate(item.image_versions2?.candidates);
      previewUrl = poster?.url || null;
    } else if (item.image_versions2?.candidates?.length) {
      type = 'image';
      const bestImg = getBestImageCandidate(item.image_versions2.candidates);
      if (bestImg) {
        mediaUrl = bestImg.url;
        width = bestImg.width || width;
        height = bestImg.height || height;
        previewUrl = bestImg.url;
      }
    }

    if (!mediaUrl) return;

    const ext = inferExtension(mediaUrl, type);
    const dateStr = formatTimestamp(item.taken_at);
    const itemId = String(item.pk || item.id || idx);
    const filename = `${username}_highlight_${safeTitle}_${dateStr}_${String(idx + 1).padStart(2, '0')}.${ext}`;

    results.push({
      id: `highlight_${reel.id}_${itemId}_${idx}`,
      postId: itemId,
      mediaPk: itemId,
      code: '',
      postUrl: null,
      type,
      category: 'highlight',
      highlightTitle: highlightTitle || 'Highlight',
      url: mediaUrl,
      previewUrl: previewUrl || mediaUrl,
      width,
      height,
      resolution: width && height ? `${width}x${height}` : (type === 'video' ? 'HD Story' : 'Original'),
      caption: `Highlight: ${highlightTitle || 'Story'}`,
      takenAt: item.taken_at ? (item.taken_at < 1e11 ? item.taken_at * 1000 : item.taken_at) : null,
      username,
      isCarousel: false,
      carouselIndex: idx + 1,
      carouselTotal: reel.items.length,
      filename: sanitizeFilename(filename, `highlight_${itemId}.${ext}`)
    });
  });

  return results;
}

/**
 * Filter and deduplicate media items
 */
function deduplicateMedia(items) {
  if (!Array.isArray(items)) return [];
  const seen = new Set();
  return items.filter(item => {
    if (!item || !item.url) return false;
    let key = item.id;
    try {
      const u = new URL(item.url);
      key = `${item.type}:${u.pathname}`;
    } catch (e) {
      key = `${item.type}:${item.url}`;
    }
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

module.exports = {
  normalizeProfileInput,
  sanitizeFilename,
  formatTimestamp,
  getBestImageCandidate,
  getBestVideoVersion,
  inferExtension,
  isTargetUserMedia,
  extractMediaFromPost,
  extractMediaFromHighlight,
  deduplicateMedia
};
