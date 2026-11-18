const { test, expect } = require('@playwright/test');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

/* Throwaway verifier input. This is not the site password. */
const FIXTURE_TEXT = 'fixture-测试-门';
const FIXTURE_DIGEST = crypto.createHash('sha256').update(FIXTURE_TEXT, 'utf8').digest('hex');
const REAL_DIGEST = 'd6bf3505438aa2fc64264878bac1355dcf9c08f6c622fb1978f8c52719fef429';
const ARTIFACTS = '/opt/cursor/artifacts';

const PERSON = {
  id: 'keep-me',
  name: '本地记录',
  rel: '我',
  relType: 'self',
  g: 'm',
  cal: 'solar',
  sy: 1990,
  sm: 1,
  sd: 1,
  ret: 'std',
  time: '',
  life: null,
  comp: true,
  created: 1,
};

function arm(page, extra) {
  return page.addInitScript((cfg) => {
    window.__SUNFULEI_GATE_TEST__ = cfg;
  }, Object.assign({ digest: FIXTURE_DIGEST }, extra || {}));
}

function trackErrors(page) {
  const errors = [];
  page.on('pageerror', (err) => errors.push(String(err)));
  return errors;
}

async function unlock(page) {
  await page.locator('#gate-input').fill(FIXTURE_TEXT);
  await page.locator('#gate-submit').click();
  await expect(page.locator('#gate')).toBeHidden();
}

function watchPaint(page) {
  return page.addInitScript(() => {
    window.__gatePaint = [];
    const note = () => {
      const el = document.querySelector('body > .wrap');
      if (!el) return;
      const cs = getComputedStyle(el);
      const sample = {
        open: document.documentElement.classList.contains('gate-open'),
        visibility: cs.visibility,
      };
      const prev = window.__gatePaint[window.__gatePaint.length - 1];
      if (prev && prev.open === sample.open && prev.visibility === sample.visibility) return;
      window.__gatePaint.push(sample);
    };
    let frames = 0;
    const tick = () => {
      note();
      if (++frames < 8) requestAnimationFrame(tick);
    };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(tick);
    document.addEventListener('DOMContentLoaded', note);
  });
}

test.beforeAll(() => {
  fs.mkdirSync(ARTIFACTS, { recursive: true });
});

test('source keeps the digest, memoir, hosting files, and no fixture secret', () => {
  const gateJs = fs.readFileSync('gate.js', 'utf8');
  const pages = ['index.html', 'huozhe/index.html', 'cooking/index.html'];
  const joined = [gateJs, fs.readFileSync('gate.css', 'utf8')]
    .concat(pages.map((file) => fs.readFileSync(file, 'utf8')))
    .join('\n');
  expect(gateJs).toContain(REAL_DIGEST);
  expect(gateJs).not.toMatch(/localStorage\s*\./);
  expect(joined).not.toContain(FIXTURE_TEXT);
  expect(joined).not.toContain(FIXTURE_DIGEST);
  expect(fs.readFileSync('CNAME', 'utf8').trim()).toBe('sunfulei.com');
  expect(fs.existsSync('.nojekyll')).toBe(true);
  for (const file of pages) {
    const html = fs.readFileSync(file, 'utf8');
    expect(html).toContain('<p id="gate-hint" class="gate-hint">我的全名</p>');
    expect(html).toContain('需要启用 JavaScript');
    expect(html).not.toMatch(/id="gate-input"[^>]*value=/);
    expect(html).toContain('src="/gate.js"');
  }
  const home = fs.readFileSync('index.html', 'utf8');
  expect(home).toContain('宋家台小学');
  expect(home).toContain('好好活吧');
  expect(home).toContain('http://kanban.sunfulei.com/');
  expect(fs.readFileSync('huozhe/index.html', 'utf8')).toContain('id="homeLink" href="/"');
  expect(fs.readFileSync('cooking/index.html', 'utf8')).toContain('id="homeLink" href="/"');
});

test('locked homepage hides memoir, shows the hint, and does not flash content', async ({ page }) => {
  const errors = trackErrors(page);
  const posts = [];
  page.on('request', (req) => {
    if (req.method() === 'POST') posts.push(req.url());
  });
  await watchPaint(page);
  await page.goto('/');
  await expect(page.locator('#gate-form')).toBeVisible();
  await expect(page.locator('#gate-hint')).toHaveText('我的全名');
  await expect(page.locator('#gate-title')).toHaveText('请先验证');
  await expect(page.locator('.hero')).toBeHidden();
  await expect(page.getByText('宋家台小学')).toBeHidden();
  const visible = await page.locator('body').innerText();
  expect(visible).toContain('我的全名');
  expect(visible).not.toContain('宋家台小学');
  expect(visible).not.toContain('好好活吧');
  const source = await page.content();
  expect(source).toContain('宋家台小学');
  const paint = await page.evaluate(() => window.__gatePaint);
  expect(paint.length).toBeGreaterThan(0);
  for (const sample of paint) {
    expect(sample.open).toBe(false);
    expect(sample.visibility).toBe('hidden');
  }
  expect(posts).toEqual([]);
  expect(errors).toEqual([]);
  await page.screenshot({ path: path.join(ARTIFACTS, 'gate_desktop_empty.png') });
});

test('blank, whitespace, wrong entry, and trimmed fixture', async ({ page }) => {
  const errors = trackErrors(page);
  const posts = [];
  page.on('request', (req) => {
    if (req.method() === 'POST') posts.push(req.url());
  });
  await arm(page);
  await page.goto('/');

  await page.locator('#gate-input').fill('   \n\t');
  await page.locator('#gate-submit').click();
  await expect(page.locator('#gate-error')).toHaveText('请先输入内容。');
  await expect(page.locator('.hero')).toBeHidden();

  await page.locator('#gate-input').fill('  不是名字  ');
  await page.locator('#gate-input').press('Enter');
  await expect(page.locator('#gate-error')).toHaveText('不对，请再试一次。');
  await expect(page.locator('.hero')).toBeHidden();
  await expect(page.locator('#gate-submit')).toBeEnabled();
  expect(page.url()).not.toContain('不是');
  expect(posts).toEqual([]);

  await page.evaluate(() => {
    document.getElementById('gate-input').value = '';
  });
  await page.screenshot({ path: path.join(ARTIFACTS, 'gate_wrong_desktop.png') });

  await page.locator('#gate-input').fill('  ' + FIXTURE_TEXT + '\u3000');
  await page.locator('#gate-submit').click();
  await expect(page.locator('#gate')).toBeHidden();
  await expect(page.locator('.hero h1')).toContainText('孙福磊');
  await expect(page.locator('#days')).toHaveText(/\d/);
  await expect(page.locator('a[href="http://kanban.sunfulei.com/"]')).toHaveAttribute('target', '_blank');
  const mark = await page.evaluate(() => sessionStorage.getItem('sfl-gate-v1'));
  expect(mark).toBe('1');
  expect(page.url()).not.toContain('fixture');
  expect(posts).toEqual([]);
  expect(errors).toEqual([]);
  await page.screenshot({ path: path.join(ARTIFACTS, 'gate_unlocked_home.png') });
});

test('fixture text does not open the real digest', async ({ page }) => {
  await page.goto('/index.html');
  await expect(page.locator('#gate-form')).toBeVisible();
  await page.locator('#gate-input').fill(FIXTURE_TEXT);
  await page.locator('#gate-input').press('Enter');
  await expect(page.locator('#gate-error')).toHaveText('不对，请再试一次。');
  await expect(page.getByText('宋家台小学')).toBeHidden();
  const stored = await page.evaluate(() => sessionStorage.getItem('sfl-gate-v1'));
  expect(stored).toBeNull();
});

test('localStorage and a wrong session value do not unlock', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('sfl-gate-v1', '1');
    localStorage.setItem('nutritionFridgeV1', JSON.stringify({ have: ['鸡蛋'], pantry: true }));
    sessionStorage.setItem('sfl-gate-v1', 'yes');
  });
  await page.goto('/');
  await expect(page.locator('#gate-form')).toBeVisible();
  await expect(page.locator('.hero')).toBeHidden();
  const fridge = await page.evaluate(() => localStorage.getItem('nutritionFridgeV1'));
  expect(fridge).toContain('鸡蛋');
});

test('refresh keeps the same tab open and a new context asks again', async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await arm(page);
  await watchPaint(page);
  await page.goto('/');
  await unlock(page);
  await page.reload();
  await expect(page.locator('#gate')).toBeHidden();
  await expect(page.locator('.hero h1')).toContainText('孙福磊');
  const paint = await page.evaluate(() => window.__gatePaint);
  expect(paint.length).toBeGreaterThan(0);
  for (const sample of paint) expect(sample.open).toBe(true);

  const fresh = await browser.newContext();
  const other = await fresh.newPage();
  await other.goto('/');
  await expect(other.locator('#gate-form')).toBeVisible();
  const visible = await other.locator('body').innerText();
  expect(visible).not.toContain('宋家台小学');
  await context.close();
  await fresh.close();
});

test('direct subpages cannot bypass, then round-trip home without asking again', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/huozhe/');
  await expect(page.locator('#gate-form')).toBeVisible();
  let visible = await page.locator('body').innerText();
  expect(visible).not.toContain('数据只在本地电脑');
  await page.goto('/huozhe/#open');
  await expect(page.locator('#gate-form')).toBeVisible();
  await page.goto('/cooking/?ok=1');
  await expect(page.locator('#gate-form')).toBeVisible();
  visible = await page.locator('body').innerText();
  expect(visible).not.toContain('冰箱里有啥');

  await arm(page);
  await page.goto('/huozhe/');
  await unlock(page);
  await expect(page.getByText('数据只在本地电脑')).toBeVisible();
  await expect.poll(() => page.locator('#cv').evaluate((el) => el.width)).toBeGreaterThan(50);
  await page.locator('#btnSettings').click();
  await expect(page.locator('#ovSet')).toBeVisible();
  await page.locator('#ovSet [data-close]').first().click();
  await page.locator('#homeLink').click();
  await expect(page.locator('.hero h1')).toContainText('孙福磊');
  await expect(page.locator('#gate')).toBeHidden();

  await page.locator('a.card[href="/cooking/"]').click();
  await expect(page.locator('#gate')).toBeHidden();
  await expect(page.locator('header h1')).toContainText('七大营养素');
  await page.getByRole('button', { name: '示例：西红柿 鸡蛋 米饭' }).click();
  await expect(page.locator('#fridgeHint')).toContainText('已选');
  const fridge = await page.evaluate(() => localStorage.getItem('nutritionFridgeV1'));
  expect(fridge).toContain('西红柿');
  await page.locator('#homeLink').click();
  await expect(page.locator('.hero h1')).toContainText('孙福磊');
  await page.goBack();
  await expect(page.locator('#gate')).toBeHidden();
  await expect(page.locator('#fridgeTags')).toContainText('西红柿');
  await page.goBack();
  await expect(page.locator('#gate')).toBeHidden();
  await expect(page.locator('.hero h1')).toContainText('孙福磊');
  expect(errors).toEqual([]);
});

test('back and bfcache do not ask again after verification', async ({ page }) => {
  // This runner's Chromium reloads on Back (navigation type back_forward) instead of
  // restoring BFCache. The persisted pageshow below checks the frozen-page path.
  await arm(page);
  await page.goto('/');
  await unlock(page);
  await page.evaluate(() => {
    window.__bfEvents = [];
    window.addEventListener('pageshow', (event) => {
      window.__bfEvents.push(!!event.persisted);
    });
  });
  await page.goto('/cooking/');
  await expect(page.locator('#homeLink')).toBeVisible();
  await page.goBack();
  await expect(page.locator('#gate')).toBeHidden();
  await expect(page.locator('.hero h1')).toContainText('孙福磊');
  const nav = await page.evaluate(() => ({
    bf: window.__bfEvents || null,
    type: performance.getEntriesByType('navigation').map((entry) => entry.type),
  }));
  expect(nav.type.includes('back_forward') || (nav.bf && nav.bf.includes(true))).toBeTruthy();

  await page.evaluate(() => {
    document.documentElement.classList.remove('gate-open');
    document.documentElement.classList.add('gate-locked');
  });
  await expect(page.locator('.hero')).toBeHidden();
  await page.evaluate(() => {
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
  });
  await expect(page.locator('#gate')).toBeHidden();
  await expect(page.locator('.hero h1')).toContainText('孙福磊');
  fs.writeFileSync(path.join(ARTIFACTS, 'bfcache-note.json'), JSON.stringify(nav));
});

test('storage failure still unlocks this view and leaves app data alone', async ({ page }) => {
  const errors = trackErrors(page);
  await page.addInitScript((digest) => {
    window.__SUNFULEI_GATE_TEST__ = { digest: digest, storage: 'deny' };
    localStorage.setItem('nutritionFridgeV1', JSON.stringify({ have: ['鸡蛋'], pantry: true }));
    localStorage.setItem('huozhe.v2.people', JSON.stringify([{
      id: 'keep-me',
      name: '本地记录',
      rel: '我',
      relType: 'self',
      g: 'm',
      cal: 'solar',
      sy: 1990,
      sm: 1,
      sd: 1,
      ret: 'std',
      time: '',
      life: null,
      comp: true,
      created: 1,
    }]));
    sessionStorage.removeItem('sfl-gate-v1');
  }, FIXTURE_DIGEST);
  await page.goto('/cooking/');
  await expect(page.locator('#gate-form')).toBeVisible();
  await page.locator('#gate-input').fill(' \t ');
  await page.locator('#gate-submit').click();
  await expect(page.locator('#gate-error')).toHaveText('请先输入内容。');
  await unlock(page);
  await expect(page.locator('#gate-storage-banner')).toBeVisible();
  await expect(page.locator('#fridgeTags')).toContainText('鸡蛋');
  expect(await page.evaluate(() => sessionStorage.getItem('sfl-gate-v1'))).toBeNull();
  expect(await page.evaluate(() => localStorage.getItem('nutritionFridgeV1'))).toContain('鸡蛋');
  await page.reload();
  await expect(page.locator('#gate-form')).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('nutritionFridgeV1'))).toContain('鸡蛋');
  await page.goto('/huozhe/');
  await expect(page.locator('#gate-form')).toBeVisible();
  await unlock(page);
  await expect(page.getByText('本地记录').first()).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('huozhe.v2.people'))).toContain('本地记录');
  await expect(page.locator('#homeLink')).toBeVisible();
  expect(errors).toEqual([]);
});

test('thrown sessionStorage does not break the gate or localStorage', async ({ page }) => {
  const errors = trackErrors(page);
  await page.addInitScript((digest) => {
    window.__SUNFULEI_GATE_TEST__ = { digest: digest };
    localStorage.setItem('nutritionFridgeV1', JSON.stringify({ have: ['豆腐'], pantry: false }));
    Object.defineProperty(window, 'sessionStorage', {
      configurable: true,
      get() {
        throw new DOMException('sessionStorage disabled', 'SecurityError');
      },
    });
  }, FIXTURE_DIGEST);
  await page.goto('/cooking/');
  await expect(page.locator('#gate-form')).toBeVisible();
  await page.locator('#gate-input').fill('错的');
  await page.locator('#gate-submit').click();
  await expect(page.locator('#gate-error')).toHaveText('不对，请再试一次。');
  await unlock(page);
  await expect(page.locator('#gate-storage-banner')).toBeVisible();
  await expect(page.locator('#fridgeTags')).toContainText('豆腐');
  expect(await page.evaluate(() => localStorage.getItem('nutritionFridgeV1'))).toContain('豆腐');
  await page.getByRole('button', { name: '配一餐' }).click();
  expect(errors).toEqual([]);
});

test('same-origin only and huozhe keeps its saved person', async ({ page }) => {
  const urls = [];
  page.on('request', (req) => urls.push(req.url()));
  await arm(page);
  await page.addInitScript((person) => {
    localStorage.setItem('huozhe.v2.people', JSON.stringify([person]));
  }, PERSON);
  await page.goto('/huozhe/');
  await unlock(page);
  await expect(page.getByText('本地记录').first()).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('huozhe.v2.people'))).toContain('keep-me');
  await page.locator('#homeLink').click();
  await page.locator('a.card[href="/cooking/"]').click();
  const origin = new URL(page.url()).origin;
  expect(urls.length).toBeGreaterThan(0);
  for (const url of urls) {
    expect(url.startsWith(origin) || url.startsWith('data:')).toBeTruthy();
  }
});

test('disabled javascript fails closed', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  for (const url of ['/', '/huozhe/', '/cooking/']) {
    await page.goto(url);
    await expect(page.locator('#gate-noscript')).toBeVisible();
    await expect(page.locator('#gate-noscript')).toContainText('需要启用 JavaScript');
    await expect(page.locator('#gate-noscript')).toContainText('不会直接显示');
    await expect(page.locator('#gate-form')).toBeHidden();
    await expect(page.locator('.wrap')).toBeHidden();
    const visible = await page.locator('body').innerText();
    expect(visible).not.toContain('宋家台小学');
    expect(visible).not.toContain('数据只在本地电脑');
    expect(visible).not.toContain('冰箱里有啥');
  }
  await page.screenshot({ path: path.join(ARTIFACTS, 'gate_noscript.png') });
  await context.close();
});

test.describe('mobile', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('gate fits and wrong entry stays on screen', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#gate-hint')).toHaveText('我的全名');
    await expect(page.locator('#gate-submit')).toBeVisible();
    let overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    await page.screenshot({ path: path.join(ARTIFACTS, 'gate_mobile_empty.png') });
    await page.locator('#gate-input').fill('错');
    await page.locator('#gate-submit').click();
    await expect(page.locator('#gate-error')).toHaveText('不对，请再试一次。');
    await page.evaluate(() => {
      document.getElementById('gate-input').value = '';
    });
    await page.screenshot({ path: path.join(ARTIFACTS, 'gate_mobile_wrong.png') });
    await page.setViewportSize({ width: 320, height: 680 });
    overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    await expect(page.locator('.hero')).toBeHidden();
  });
});
