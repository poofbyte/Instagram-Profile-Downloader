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

  let operations = [];
  page.on('response', async res => {
    const url = res.url();
    if (url.includes('graphql') || url.includes('/api/v1/')) {
      try {
        const req = res.request();
        const postData = req.postData() || '';
        const text = await res.text();
        let json;
        try { json = JSON.parse(text); } catch(e) {}
        if (json) {
          const keys = Object.keys(json.data || json || {});
          operations.push({
            url,
            postDataSummary: postData.slice(0, 150),
            dataKeys: keys,
            json
          });
        }
      } catch(e) {}
    }
  });

  await page.goto('https://www.instagram.com/instagram/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await new Promise(r => setTimeout(r, 6000));

  console.log('Total API/graphql ops:', operations.length);
  operations.forEach((op, idx) => {
    console.log(`[${idx}] URL: ${op.url.slice(0, 70)} | keys: ${op.dataKeys.join(',')} | post: ${op.postDataSummary.slice(0, 80)}`);
  });

  // Save the operations to a json file to inspect structure
  fs.writeFileSync('scratch_ops.json', JSON.stringify(operations.map(o => ({
    url: o.url,
    keys: o.dataKeys,
    post: o.postDataSummary,
    dataPreview: JSON.stringify(o.json).slice(0, 500)
  })), null, 2));

  await browser.close();
})();
