const puppeteer = require('puppeteer');
const fs = require('fs');
const { getBrowserExecutablePath } = require('./browserHelper');

(async () => {
  const cookies = JSON.parse(fs.readFileSync('cookie.json', 'utf8'));
  const browser = await puppeteer.launch({
    headless: true,
    executablePath: getBrowserExecutablePath(),
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--lang=en-US'],
    defaultViewport: { width: 1280, height: 800 }
  });
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36');
  
  const normCookies = cookies.map(c => ({
    name: c.name,
    value: c.value,
    domain: c.domain,
    path: c.path || '/',
    secure: c.secure !== undefined ? c.secure : true,
    httpOnly: c.httpOnly || false
  })).filter(c => c.domain.includes('instagram.com'));
  
  await page.setCookie(...normCookies);

  let targetUserId = null;
  const username = 'instagram';

  const capturedPosts = [];
  const capturedReels = [];
  const capturedHighlights = [];
  const allDocIds = new Set();

  page.on('response', async res => {
    const url = res.url();
    if (url.includes('graphql') || url.includes('/api/v1/')) {
      try {
        const text = await res.text();
        const json = JSON.parse(text);
        const req = res.request();
        const postData = req.postData() || '';
        
        // Check for doc_id
        const docIdMatch = postData.match(/doc_id=(\d+)/);
        if (docIdMatch) allDocIds.add(docIdMatch[1]);

        // Check user info
        if (json.data?.user?.pk) {
          targetUserId = json.data.user.pk;
          console.log(`[FOUND USER] pk=${targetUserId}, username=${json.data.user.username}`);
        }

        // Check timeline connection
        const timeline = json.data?.xdt_api__v1__feed__user_timeline_graphql_connection;
        if (timeline && timeline.edges) {
          console.log(`[TIMELINE] edges=${timeline.edges.length}, has_next=${timeline.page_info?.has_next_page}, cursor=${timeline.page_info?.end_cursor}`);
          timeline.edges.forEach(e => {
            if (e.node) capturedPosts.push(e.node);
          });
        }

        // Check clips/reels connection
        const clips = json.data?.xdt_api__v1__clips__user__connection_v2;
        if (clips && clips.edges) {
          console.log(`[CLIPS/REELS] edges=${clips.edges.length}`);
          clips.edges.forEach(e => {
            if (e.node?.media) capturedReels.push(e.node.media);
          });
        }

        // Check highlights
        const hl = json.data?.highlights;
        if (hl && hl.edges) {
          console.log(`[HIGHLIGHTS] count=${hl.edges.length}`);
          hl.edges.forEach(e => {
            if (e.node) capturedHighlights.push(e.node);
          });
        }

        // Check reels_media (highlight stories or user stories)
        if (json.data?.xdt_api__v1__feed__reels_media) {
          console.log(`[REELS_MEDIA]`, Object.keys(json.data.xdt_api__v1__feed__reels_media));
        }

      } catch(e) {}
    }
  });

  console.log('Navigating to profile...');
  await page.goto(`https://www.instagram.com/${username}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await new Promise(r => setTimeout(r, 4000));

  console.log('Scrolling to test timeline pagination...');
  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => window.scrollBy(0, 1500));
    await new Promise(r => setTimeout(r, 2500));
  }

  console.log(`After scroll: capturedPosts=${capturedPosts.length}`);
  if (capturedPosts.length > 0) {
    const p0 = capturedPosts[0];
    console.log('Post 0 summary:', {
      code: p0.code,
      pk: p0.pk,
      user_pk: p0.user?.pk,
      owner_id: p0.owner?.id,
      media_type: p0.media_type,
      has_carousel: !!p0.carousel_media,
      carousel_count: p0.carousel_media?.length,
      has_image_versions2: !!p0.image_versions2,
      has_video_versions: !!p0.video_versions
    });
    fs.writeFileSync('sample_post.json', JSON.stringify(p0, null, 2));
  }

  // Now test reels tab
  console.log('Navigating to reels tab...');
  await page.goto(`https://www.instagram.com/${username}/reels/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await new Promise(r => setTimeout(r, 5000));
  console.log(`After reels tab: capturedReels=${capturedReels.length}`);

  console.log('Captured doc_ids:', Array.from(allDocIds));

  await browser.close();
})();
