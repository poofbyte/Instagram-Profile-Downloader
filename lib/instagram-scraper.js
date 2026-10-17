const puppeteer = require('puppeteer');
const { getBrowserExecutablePath } = require('../browserHelper');
const { loadCookies, parseCookies } = require('./cookie-manager');
const {
  normalizeProfileInput,
  sanitizeFilename,
  isTargetUserMedia,
  extractMediaFromPost,
  extractMediaFromHighlight,
  deduplicateMedia
} = require('./media-extractor');

class InstagramScraper {
  constructor() {
    this.browser = null;
    this.isCancelled = false;
  }

  cancel() {
    this.isCancelled = true;
    if (this.browser) {
      try {
        this.browser.close().catch(() => {});
      } catch (e) {}
    }
  }

  /**
   * Main scrape method
   * @param {string} rawInput Profile URL or username
   * @param {Array|string} [userCookies] Optional cookies from client
   * @param {Function} [onProgress] Progress event callback
   */
  async scrape(rawInput, userCookies = null, onProgress = () => {}) {
    this.isCancelled = false;

    const normalized = normalizeProfileInput(rawInput);
    if (!normalized || !normalized.username) {
      throw new Error('Please enter a valid Instagram profile URL or username.');
    }

    const targetUsername = normalized.username;
    const profileUrl = normalized.profileUrl;
    let targetUserId = null;
    let profileData = {
      username: targetUsername,
      fullName: '',
      biography: '',
      avatarUrl: '',
      followersCount: 0,
      postsCount: 0,
      isPrivate: false,
      isVerified: false
    };

    onProgress({
      type: 'status',
      stage: 'init',
      message: `Initializing extraction engine for @${targetUsername}...`
    });

    // 1. Prepare Authentication Cookies
    let activeCookies = [];
    if (userCookies) {
      activeCookies = parseCookies(userCookies);
    }
    if (activeCookies.length === 0) {
      // Fallback to cookies.json or cookie.json on disk
      const diskCookies = loadCookies();
      if (diskCookies.cookies.length > 0) {
        activeCookies = diskCookies.cookies;
        onProgress({
          type: 'status',
          stage: 'auth',
          message: `Loaded ${activeCookies.length} session cookies from local ${diskCookies.source}.`
        });
      }
    } else {
      onProgress({
        type: 'status',
        stage: 'auth',
        message: `Using ${activeCookies.length} user-supplied session cookies.`
      });
    }

    // 2. Launch Puppeteer
    const launchOptions = {
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu',
        '--lang=en-US'
      ],
      defaultViewport: { width: 1280, height: 800 }
    };

    const execPath = getBrowserExecutablePath();
    if (execPath) {
      launchOptions.executablePath = execPath;
      onProgress({
        type: 'status',
        stage: 'browser',
        message: `Detected browser executable: ${execPath}`
      });
    }

    this.browser = await puppeteer.launch(launchOptions);
    const page = await this.browser.newPage();

    // Modern Chrome User-Agent
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36');
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9'
    });

    // Inject cookies
    if (activeCookies.length > 0) {
      await page.setCookie(...activeCookies);
      onProgress({
        type: 'status',
        stage: 'auth',
        message: `Injected ${activeCookies.length} authentication cookies into session.`
      });
    }

    let collectedMedia = [];
    const discoveredHighlights = [];
    const discoveredPostCodes = new Set();
    const unpackedPostCodes = new Set();
    const discoveredReelCodes = new Set();

    // Helper to dismiss cookie/notification prompts
    const dismissOverlays = async () => {
      try {
        await page.evaluate(() => {
          const candidates = Array.from(document.querySelectorAll('button, div[role="button"]'));
          for (const el of candidates) {
            const txt = (el.innerText || '').toLowerCase().trim();
            if (
              txt === 'not now' ||
              txt === 'decline optional cookies' ||
              txt === 'allow all cookies' ||
              txt === 'accept all' ||
              txt === 'cancel'
            ) {
              el.click();
              break;
            }
          }
        });
      } catch (e) {}
    };

    // 3. Setup Selective Network Response Interception
    // Enforcing strict profile isolation by intercepting ONLY target profile endpoints
    page.on('response', async (response) => {
      if (this.isCancelled) return;

      try {
        const url = response.url();
        const resourceType = response.request().resourceType();

        if (resourceType === 'xhr' || resourceType === 'fetch') {
          // Explicitly ignore noise that pollutes media
          if (
            url.includes('discover/chaining') ||
            url.includes('feed/reels_tray') ||
            url.includes('feed/timeline') ||
            url.includes('direct_v2') ||
            url.includes('inbox') ||
            url.includes('logging') ||
            url.includes('analytics')
          ) {
            return;
          }

          if (url.includes('/graphql') || url.includes('/api/v1/')) {
            const contentType = response.headers()['content-type'] || '';
            if (!contentType.includes('json') && !contentType.includes('text')) return;

            const text = await response.text();
            let json;
            try {
              json = JSON.parse(text);
            } catch (e) {
              return;
            }

            // A. Detect Profile Identity (User PK & Details)
            if (json.data?.user) {
              const u = json.data.user;
              if (u.username && u.username.toLowerCase() === targetUsername.toLowerCase()) {
                targetUserId = String(u.pk || u.id);
                profileData = {
                  username: u.username,
                  fullName: u.full_name || '',
                  biography: u.biography || '',
                  avatarUrl: u.hd_profile_pic_url_info?.url || u.profile_pic_url_hd || u.profile_pic_url || '',
                  followersCount: u.edge_followed_by?.count || u.follower_count || 0,
                  postsCount: u.edge_owner_to_timeline_media?.count || u.media_count || 0,
                  isPrivate: Boolean(u.is_private),
                  isVerified: Boolean(u.is_verified)
                };
              }
            }

            // B. Profile Timeline Posts (xdt_api__v1__feed__user_timeline_graphql_connection)
            const timeline = json.data?.xdt_api__v1__feed__user_timeline_graphql_connection;
            if (timeline && Array.isArray(timeline.edges)) {
              let addedFromThisBatch = 0;
              timeline.edges.forEach(edge => {
                if (edge.node) {
                  const post = edge.node;
                  // Capture targetUserId if present
                  if (!targetUserId && post.user?.pk && post.user.username?.toLowerCase() === targetUsername.toLowerCase()) {
                    targetUserId = String(post.user.pk);
                  }

                  if (post.code) discoveredPostCodes.add(post.code);

                  const extracted = extractMediaFromPost(post, targetUsername, targetUserId, 'post');
                  if (extracted.length > 0) {
                    collectedMedia.push(...extracted);
                    addedFromThisBatch += extracted.length;

                    // Check if carousel was fully unpacked
                    if (post.media_type === 8 && post.carousel_media) {
                      unpackedPostCodes.add(post.code);
                    }
                  }
                }
              });

              if (addedFromThisBatch > 0) {
                collectedMedia = deduplicateMedia(collectedMedia);
                onProgress({
                  type: 'media_batch',
                  stage: 'feed_scan',
                  totalCount: collectedMedia.length,
                  message: `Collected ${addedFromThisBatch} media items from profile posts (${collectedMedia.length} total)...`
                });
              }
            }

            // C. Legacy GraphQL Timeline pattern (data.user.edge_owner_to_timeline_media)
            const edgeMedia = json.data?.user?.edge_owner_to_timeline_media;
            if (edgeMedia && Array.isArray(edgeMedia.edges)) {
              let addedFromThisBatch = 0;
              edgeMedia.edges.forEach(edge => {
                if (edge.node) {
                  const post = edge.node;
                  if (post.shortcode || post.code) {
                    post.code = post.code || post.shortcode;
                    discoveredPostCodes.add(post.code);
                  }
                  const extracted = extractMediaFromPost(post, targetUsername, targetUserId, 'post');
                  if (extracted.length > 0) {
                    collectedMedia.push(...extracted);
                    addedFromThisBatch += extracted.length;
                  }
                }
              });
              if (addedFromThisBatch > 0) {
                collectedMedia = deduplicateMedia(collectedMedia);
              }
            }

            // D. Highlights List Discovery
            const hl = json.data?.highlights;
            if (hl && Array.isArray(hl.edges)) {
              hl.edges.forEach(e => {
                if (e.node && e.node.id) {
                  const exists = discoveredHighlights.some(h => h.id === e.node.id);
                  if (!exists) {
                    discoveredHighlights.push({
                      id: e.node.id,
                      title: e.node.title || 'Highlight',
                      coverUrl: e.node.cover_media?.cropped_image_version?.url || ''
                    });
                  }
                }
              });
            }

            // E. Clips / Reels Discovery (fetch__XDTUserDict or xdt_api__v1__clips__user__connection_v2)
            const clipsConn = json.data?.fetch__XDTUserDict?.clips_connection || json.data?.xdt_api__v1__clips__user__connection_v2;
            if (clipsConn && Array.isArray(clipsConn.edges)) {
              clipsConn.edges.forEach(edge => {
                const media = edge.node?.media || edge.node;
                if (media && media.code) {
                  discoveredReelCodes.add(media.code);
                  const extracted = extractMediaFromPost(media, targetUsername, targetUserId, 'reel');
                  if (extracted.length > 0) {
                    collectedMedia.push(...extracted);
                  }
                }
              });
              collectedMedia = deduplicateMedia(collectedMedia);
            }
          }
        }
      } catch (err) {
        // Non-fatal response handling error
      }
    });

    try {
      // 4. Navigate to Target Profile Page
      onProgress({
        type: 'status',
        stage: 'navigation',
        message: `Navigating to ${profileUrl}...`
      });

      await page.goto(profileUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await dismissOverlays();
      await new Promise(r => setTimeout(r, 4000));

      // Check login status
      const isLoggedIn = await page.evaluate(() => {
        const hasLogin = document.querySelector('input[name="username"]') || document.querySelector('input[name="email"]');
        const isLoginUrl = window.location.href.includes('/accounts/login') || window.location.href.includes('/challenge');
        return !(hasLogin || isLoginUrl);
      });

      if (isLoggedIn) {
        onProgress({
          type: 'status',
          stage: 'auth_success',
          message: 'Authenticated session active! Full profile media access granted.'
        });
      } else {
        onProgress({
          type: 'status',
          stage: 'guest_mode',
          message: 'Running in public mode (cookies not provided or expired).'
        });
      }

      // Check if profile exists / is private
      const pageStatus = await page.evaluate(() => {
        const text = document.body.innerText || '';
        const isUnavailable = text.includes("Sorry, this page isn't available") || text.includes('The link you followed may be broken');
        const isPrivate = text.includes('This account is private') || text.includes('This Account is Private');
        return { isUnavailable, isPrivate };
      });

      if (pageStatus.isUnavailable) {
        throw new Error(`Profile @${targetUsername} was not found on Instagram.`);
      }

      if (pageStatus.isPrivate && !isLoggedIn) {
        throw new Error(`Profile @${targetUsername} is private. You must provide valid cookies from an account that follows them.`);
      }

      // 5. Scroll Timeline to Trigger Pagination
      onProgress({
        type: 'status',
        stage: 'scrolling',
        message: 'Scrolling feed to capture all profile posts & carousels...'
      });

      let previousHeight = await page.evaluate(() => document.body.scrollHeight);
      let scrollAttempts = 0;
      let scrollsDone = 0;
      const maxScrolls = activeCookies.length > 0 ? 60 : 25;

      while (scrollAttempts < 3 && scrollsDone < maxScrolls && !this.isCancelled) {
        await page.evaluate(() => {
          window.scrollBy(0, 1200);
        });
        await new Promise(resolve => setTimeout(resolve, 2200));
        await dismissOverlays();
        scrollsDone++;

        const newHeight = await page.evaluate(() => document.body.scrollHeight);
        if (newHeight === previousHeight) {
          scrollAttempts++;
        } else {
          scrollAttempts = 0;
        }
        previousHeight = newHeight;

        onProgress({
          type: 'scroll_progress',
          stage: 'scrolling',
          round: scrollsDone,
          maxRounds: maxScrolls,
          totalCount: collectedMedia.length,
          message: `Scrolled feed (step ${scrollsDone}/${maxScrolls}) — ${collectedMedia.length} media files isolated.`
        });
      }

      // 6. Highlights Extraction: If profile has highlights, fetch each highlight's stories
      if (discoveredHighlights.length > 0 && !this.isCancelled) {
        onProgress({
          type: 'status',
          stage: 'highlights',
          message: `Discovered ${discoveredHighlights.length} Highlights collections. Fetching highlight stories...`
        });

        for (let i = 0; i < discoveredHighlights.length; i++) {
          if (this.isCancelled) break;
          const hl = discoveredHighlights[i];

          try {
            onProgress({
              type: 'status',
              stage: 'highlights',
              message: `[Highlight ${i + 1}/${discoveredHighlights.length}] Fetching "${hl.title}"...`
            });

            const highlightData = await page.evaluate(async (highlightId) => {
              try {
                const res = await fetch(`/api/v1/feed/reels_media/?reel_ids=${encodeURIComponent(highlightId)}`, {
                  headers: {
                    'X-IG-App-ID': '936619743392459',
                    'X-Requested-With': 'XMLHttpRequest'
                  }
                });
                if (!res.ok) return null;
                return await res.json();
              } catch (e) {
                return null;
              }
            }, hl.id);

            if (highlightData && highlightData.reels) {
              const reelObj = highlightData.reels[hl.id] || highlightData.reels[Object.keys(highlightData.reels)[0]];
              if (reelObj && Array.isArray(reelObj.items)) {
                const hlMedia = extractMediaFromHighlight(reelObj, hl.title, targetUsername, targetUserId);
                if (hlMedia.length > 0) {
                  collectedMedia.push(...hlMedia);
                  collectedMedia = deduplicateMedia(collectedMedia);
                  onProgress({
                    type: 'media_batch',
                    stage: 'highlights',
                    totalCount: collectedMedia.length,
                    message: `Extracted ${hlMedia.length} stories from Highlight "${hl.title}". Total media: ${collectedMedia.length}.`
                  });
                }
              }
            }
          } catch (hlErr) {
            console.warn(`[Highlights] Notice for "${hl.title}":`, hlErr.message);
          }
        }
      }

      // 7. Reels Tab Extraction: Scan reels tab (/reels/) for any reels not in main grid
      if (!this.isCancelled) {
        onProgress({
          type: 'status',
          stage: 'reels_tab',
          message: `Scanning Reels tab (${normalized.reelsUrl})...`
        });

        try {
          await page.goto(normalized.reelsUrl, { waitUntil: 'domcontentloaded', timeout: 35000 });
          await dismissOverlays();
          await new Promise(r => setTimeout(r, 4000));

          const reelsScrolls = activeCookies.length > 0 ? 15 : 6;
          for (let s = 1; s <= reelsScrolls; s++) {
            if (this.isCancelled) break;
            await page.evaluate(() => window.scrollBy(0, 1200));
            await new Promise(r => setTimeout(r, 2000));
          }

          collectedMedia = deduplicateMedia(collectedMedia);
          onProgress({
            type: 'status',
            stage: 'reels_tab',
            message: `Reels tab scan finished. Total media collected: ${collectedMedia.length}.`
          });
        } catch (reelsErr) {
          console.warn('[Reels Tab] Notice:', reelsErr.message);
        }
      }

      // 8. Deep Video & Carousel Unpacking
      // For any discovered reel codes whose video versions weren't captured in the grid
      const reelsWithoutVideo = collectedMedia.filter(m => m.category === 'reel' && m.type !== 'video' && m.code);
      const postCodesToInspect = Array.from(new Set([...reelsWithoutVideo.map(m => m.code)])).slice(0, 20);

      if (postCodesToInspect.length > 0 && !this.isCancelled) {
        onProgress({
          type: 'status',
          stage: 'unpacking',
          message: `Unpacking high-definition video versions for ${postCodesToInspect.length} reels...`
        });

        for (let i = 0; i < postCodesToInspect.length; i++) {
          if (this.isCancelled) break;
          const code = postCodesToInspect[i];
          try {
            await page.goto(`https://www.instagram.com/reel/${code}/`, { waitUntil: 'domcontentloaded', timeout: 25000 });
            await new Promise(r => setTimeout(r, 2500));

            const scriptData = await page.evaluate(() => {
              const scripts = Array.from(document.querySelectorAll('script')).map(s => s.textContent);
              return scripts.filter(t => t && (t.includes('video_versions') || t.includes('xdt_shortcode_media')));
            });

            for (const text of scriptData) {
              const videoMatches = text.match(/"video_versions"\s*:\s*(\[[^\]]+\])/);
              if (videoMatches) {
                try {
                  const versions = JSON.parse(videoMatches[1]);
                  const bestVid = versions.sort((a, b) => (b.width || 0) * (b.height || 0) - (a.width || 0) * (a.height || 0))[0];
                  if (bestVid && bestVid.url) {
                    // Update item to video
                    const targetItem = collectedMedia.find(m => m.code === code);
                    if (targetItem) {
                      targetItem.type = 'video';
                      targetItem.url = bestVid.url;
                      targetItem.width = bestVid.width || targetItem.width;
                      targetItem.height = bestVid.height || targetItem.height;
                      targetItem.resolution = `${targetItem.width || 720}x${targetItem.height || 1280}`;
                      targetItem.filename = targetItem.filename.replace(/\.jpg$/, '.mp4');
                    }
                  }
                } catch (e) {}
              }
            }
          } catch (e) {}
        }
      }

      await this.browser.close();
      this.browser = null;

      // Final Deduplication and Counts
      collectedMedia = deduplicateMedia(collectedMedia);

      const imagesCount = collectedMedia.filter(m => m.type === 'image' && m.category !== 'highlight').length;
      const videosCount = collectedMedia.filter(m => m.type === 'video' && m.category !== 'highlight').length;
      const carouselsCount = collectedMedia.filter(m => m.isCarousel).length;
      const highlightsCount = collectedMedia.filter(m => m.category === 'highlight').length;

      const summary = {
        totalMedia: collectedMedia.length,
        imagesCount,
        videosCount,
        carouselsCount,
        highlightsCount
      };

      onProgress({
        type: 'complete',
        stage: 'complete',
        profile: profileData,
        summary,
        totalCount: collectedMedia.length,
        message: `Scan finished! Successfully isolated ${collectedMedia.length} high-res media files exclusively for @${targetUsername}.`
      });

      return {
        username: targetUsername,
        profile: profileData,
        summary,
        media: collectedMedia
      };

    } catch (err) {
      if (this.browser) {
        try {
          await this.browser.close();
        } catch (e) {}
        this.browser = null;
      }
      throw err;
    }
  }
}

module.exports = {
  InstagramScraper,
  normalizeProfileInput
};
