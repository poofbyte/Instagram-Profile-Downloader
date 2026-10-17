const puppeteer = require('puppeteer');
const { getBrowserExecutablePath } = require('./browserHelper');

(async () => {
  console.log('Launching browser...');
  const execPath = getBrowserExecutablePath();
  const browser = await puppeteer.launch({
    headless: true,
    ...(execPath ? { executablePath: execPath } : {}),
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--lang=en-US'],
    defaultViewport: { width: 1280, height: 800 }
  });
  
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36');
  
  let networkUrls = [];
  page.on('response', async (response) => {
    const url = response.url();
    const rt = response.request().resourceType();
    if (rt === 'xhr' || rt === 'fetch') {
      networkUrls.push(url);
    }
  });

  console.log('Navigating to profile...');
  await page.goto('https://www.instagram.com/jesspuja/', { waitUntil: 'networkidle2', timeout: 60000 });
  
  console.log('Waiting 5s...');
  await new Promise(r => setTimeout(r, 5000));
  
  console.log('Extracting DOM img tags...');
  const imgs = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('img')).map(img => img.src);
  });
  
  console.log('Network XHR/Fetch URLs:');
  console.log(networkUrls.slice(0, 20).join('\n'));
  
  console.log('IMG tags:');
  console.log(imgs.join('\n'));
  
  await browser.close();
})();
