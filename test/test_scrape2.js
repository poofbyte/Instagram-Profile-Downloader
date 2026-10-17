const puppeteer = require('puppeteer');
const { getBrowserExecutablePath } = require('./browserHelper');

(async () => {
  const execPath = getBrowserExecutablePath();
  const browser = await puppeteer.launch({
    headless: true,
    ...(execPath ? { executablePath: execPath } : {}),
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--lang=en-US'],
    defaultViewport: { width: 1280, height: 800 }
  });
  
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36');
  
  await page.goto('https://www.instagram.com/jesspuja/', { waitUntil: 'networkidle2', timeout: 60000 });
  await new Promise(r => setTimeout(r, 5000));
  
  const finalUrl = page.url();
  const title = await page.title();
  const innerText = await page.evaluate(() => document.body.innerText.substring(0, 500));
  
  console.log('Final URL:', finalUrl);
  console.log('Title:', title);
  console.log('Body start:', innerText.replace(/\n/g, ' '));
  
  await browser.close();
})();
