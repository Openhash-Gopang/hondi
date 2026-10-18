/**
 * gwp-registry.js가 실제로 로드·실행되는지 최소 확인
 * 실행: node 0018_diag_gwp_registry_live_check.cjs
 */
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto('https://hondi.net/pages/regional-gov.html', { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.waitForTimeout(500);
  const diag = await page.evaluate(() => ({
    hasGetService: typeof window.getService,
    registryLen: Array.isArray(window.GWP_REGISTRY) ? window.GWP_REGISTRY.length : 'not-array',
    klawEntry: typeof window.getService === 'function' ? window.getService('klaw') : 'no-fn',
  }));
  console.log(JSON.stringify(diag, null, 2));
  await browser.close();
})();
