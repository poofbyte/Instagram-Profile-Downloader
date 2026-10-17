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
  
  await page.goto('https://www.instagram.com/accounts/login/?next=%2Fjesspuja%2F&source=omni_redirect', { waitUntil: 'networkidle2', timeout: 60000 });
  await new Promise(r => setTimeout(r, 5000));
  
  const hasUsernameInput = await page.evaluate(() => !!document.querySelector('input[name="username"]'));
  const hasInputs = await page.evaluate(() => document.querySelectorAll('input').length);
  const inputsHtml = await page.evaluate(() => Array.from(document.querySelectorAll('input')).map(i => i.outerHTML).join('\n'));
  
  console.log('hasUsernameInput:', hasUsernameInput);
  console.log('hasInputs:', hasInputs);
  console.log('inputsHtml:', inputsHtml);
  await browser.close();
})();
