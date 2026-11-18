const { test, expect } = require('@playwright/test');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

/* Throwaway verifier input. This is not the site password. */
const FIXTURE_TEXT = 'fixture-测试-门';
const FIXTURE_DIGEST = crypto.createHash('sha256').update(FIXTURE_TEXT, 'utf8').digest('hex');
const OLD_DIGEST = 'd6bf3505438aa2fc64264878bac1355dcf9c08f6c622fb1978f8c52719fef429';
const REAL_DIGEST = '2e4779f9bc31f2d42190443bc47953353e0abc7c741c12595c2bfeabac2c702c';
const SESSION_KEY = 'sfl-gate-v2';
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

async function visibleGateText(page) {
  return page.locator('#gate').evaluate((el) => {
    function hidden(node) {
      if (!(node instanceof Element)) return false;
      if (node.classList.contains('sr-only')) return true;
      if (node.tagName === 'NOSCRIPT' || node.tagName === 'STYLE' || node.tagName === 'SCRIPT') return true;
      if (node.getAttribute('aria-hidden') === 'true') return true;
      if (node.hasAttribute('hidden')) return true;
      const cs = getComputedStyle(node);
      if (cs.display === 'none' || cs.visibility === 'hidden') return true;
      return false;
    }
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let out = '';
    let n;
    while ((n = walker.nextNode())) {
      let p = n.parentElement;
      let skip = false;
      while (p) {
        if (hidden(p)) { skip = true; break; }
        p = p.parentElement;
      }
      if (!skip) out += n.textContent;
    }
    return out.replace(/\s+/g, '');
  });
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
  expect(gateJs).not.toContain(OLD_DIGEST);
  expect(gateJs).toContain(SESSION_KEY);
  expect(gateJs).not.toContain('sfl-gate-v1');
  expect(gateJs).not.toMatch(/localStorage\s*\./);
  expect(joined).not.toContain(FIXTURE_TEXT);
  expect(joined).not.toContain(FIXTURE_DIGEST);
  expect(joined).not.toContain('我的全名');
  expect(fs.readFileSync('CNAME', 'utf8').trim()).toBe('sunfulei.com');
  expect(fs.existsSync('.nojekyll')).toBe(true);
  for (const file of pages) {
    const html = fs.readFileSync(file, 'utf8');
    expect(html).toContain('>请先验证</h1>');
    expect(html).toContain('aria-label="进入"');
    expect(html).not.toContain('需要启用 JavaScript');
    expect(html).not.toMatch(/id="gate-input"[^>]*placeholder/);
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

test('locked homepage shows only the four-character title and does not flash content', async ({ page }) => {
  const errors = trackErrors(page);
  const posts = [];
  page.on('request', (req) => {
    if (req.method() === 'POST') posts.push(req.url());
  });
  await watchPaint(page);
  await page.goto('/');
  await expect(page.locator('#gate-form')).toBeVisible();
  await expect(page.locator('#gate-title')).toHaveText('请先验证');
  expect(await visibleGateText(page)).toBe('请先验证');
  expect([...'请先验证']).toHaveLength(4);
  await expect(page.locator('#gate-input')).not.toHaveAttribute('placeholder', /.+/);
  const submit = page.getByRole('button', { name: '进入' });
  await expect(submit).toBeVisible();
  expect((await submit.innerText()).replace(/\s+/g, '')).toBe('');
  await expect(submit.locator('svg')).toHaveCount(1);
  await page.screenshot({ path: path.join(ARTIFACTS, 'gate_v2_desktop.png') });
  await submit.focus();
  await expect(submit).toBeFocused();
  await expect(page.locator('.hero')).toBeHidden();
  await expect(page.getByText('宋家台小学')).toBeHidden();
  const visible = await page.locator('body').innerText();
  expect(visible).not.toContain('我的全名');
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
  await page.locator('#gate-input').press('Enter');
  expect(await page.locator('#gate-error').textContent()).toBe('请先输入内容。');
  expect(await visibleGateText(page)).toBe('请先验证');
  await expect(page.locator('#gate-input')).toHaveClass(/gate-bad/);
  await expect(page.locator('#gate-status-icon')).toBeVisible();
  await expect(page.locator('.hero')).toBeHidden();

  const submit = page.getByRole('button', { name: '进入' });
  await submit.focus();
  await expect(submit).toBeFocused();
  await page.keyboard.press('Enter');
  expect(await page.locator('#gate-error').textContent()).toBe('请先输入内容。');

  await page.locator('#gate-input').fill('  不是名字  ');
  await page.locator('#gate-input').press('Enter');
  expect(await page.locator('#gate-error').textContent()).toBe('不对，请再试一次。');
  expect(await visibleGateText(page)).toBe('请先验证');
  await expect(page.locator('.hero')).toBeHidden();
  await expect(page.locator('#gate-submit')).toBeEnabled();
  expect(page.url()).not.toContain('不是');
  expect(posts).toEqual([]);

  await page.evaluate(() => {
    document.getElementById('gate-input').value = '';
  });
  await page.screenshot({ path: path.join(ARTIFACTS, 'gate_v2_wrong_desktop.png') });

  await page.locator('#gate-input').fill('  ' + FIXTURE_TEXT + '\u3000');
  await page.locator('#gate-submit').click();
  await expect(page.locator('#gate')).toBeHidden();
  await expect(page.locator('.hero h1')).toContainText('孙福磊');
  await expect(page.locator('#days')).toHaveText(/\d/);
  await expect(page.locator('a[href="http://kanban.sunfulei.com/"]')).toHaveAttribute('target', '_blank');
  const mark = await page.evaluate((key) => sessionStorage.getItem(key), SESSION_KEY);
  expect(mark).toBe('1');
  expect(await page.evaluate(() => sessionStorage.getItem('sfl-gate-v1'))).toBeNull();
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
  expect(await page.locator('#gate-error').textContent()).toBe('不对，请再试一次。');
  expect(await visibleGateText(page)).toBe('请先验证');
  await expect(page.getByText('宋家台小学')).toBeHidden();
  const stored = await page.evaluate((key) => sessionStorage.getItem(key), SESSION_KEY);
  expect(stored).toBeNull();
});

test('localStorage and a wrong session value do not unlock', async ({ page }) => {
  await page.addInitScript((key) => {
    localStorage.setItem(key, '1');
    localStorage.setItem('sfl-gate-v1', '1');
    localStorage.setItem('nutritionFridgeV1', JSON.stringify({ have: ['鸡蛋'], pantry: true }));
    sessionStorage.setItem('sfl-gate-v1', '1');
    sessionStorage.setItem(key, 'yes');
  }, SESSION_KEY);
  await page.goto('/');
  await expect(page.locator('#gate-form')).toBeVisible();
  await expect(page.locator('.hero')).toBeHidden();
  expect(await visibleGateText(page)).toBe('请先验证');
  const fridge = await page.evaluate(() => localStorage.getItem('nutritionFridgeV1'));
  expect(fridge).toContain('鸡蛋');
});

test('a previous verified session does not bypass the rotated check', async ({ page }) => {
  await page.addInitScript(() => {
    sessionStorage.setItem('sfl-gate-v1', '1');
  });
  await page.goto('/cooking/');
  await expect(page.locator('#gate-form')).toBeVisible();
  expect(await visibleGateText(page)).toBe('请先验证');
  expect(await page.evaluate((key) => sessionStorage.getItem(key), SESSION_KEY)).toBeNull();
  const visible = await page.locator('body').innerText();
  expect(visible).not.toContain('冰箱里有啥');
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
    sessionStorage.removeItem('sfl-gate-v2');
    sessionStorage.setItem('sfl-gate-v1', '1');
  }, FIXTURE_DIGEST);
  await page.goto('/cooking/');
  await expect(page.locator('#gate-form')).toBeVisible();
  await page.locator('#gate-input').fill(' \t ');
  await page.locator('#gate-submit').click();
  expect(await page.locator('#gate-error').textContent()).toBe('请先输入内容。');
  expect(await visibleGateText(page)).toBe('请先验证');
  await unlock(page);
  await expect(page.locator('#gate-storage-banner')).toBeVisible();
  await expect(page.locator('#fridgeTags')).toContainText('鸡蛋');
  expect(await page.evaluate(() => sessionStorage.getItem('sfl-gate-v2'))).toBeNull();
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
  expect(await page.locator('#gate-error').textContent()).toBe('不对，请再试一次。');
  expect(await visibleGateText(page)).toBe('请先验证');
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
    await expect(page.locator('#gate-title')).toBeVisible();
    await expect(page.locator('#gate-title')).toHaveText('请先验证');
    await expect(page.locator('#gate-form')).toBeHidden();
    await expect(page.locator('.wrap')).toBeHidden();
    expect((await page.locator('#gate').innerText()).replace(/\s+/g, '')).toBe('请先验证');
    const visible = await page.locator('body').innerText();
    expect(visible).not.toContain('宋家台小学');
    expect(visible).not.toContain('数据只在本地电脑');
    expect(visible).not.toContain('冰箱里有啥');
    expect(visible).not.toContain('我的全名');
  }
  await page.screenshot({ path: path.join(ARTIFACTS, 'gate_v2_noscript.png') });
  await context.close();
});

test.describe('mobile', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('gate fits and wrong entry stays on screen', async ({ page }) => {
    await page.goto('/');
    expect(await visibleGateText(page)).toBe('请先验证');
    await expect(page.getByRole('button', { name: '进入' })).toBeVisible();
    let overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    await page.screenshot({ path: path.join(ARTIFACTS, 'gate_v2_mobile_empty.png') });
    await page.locator('#gate-input').fill('错');
    await page.locator('#gate-submit').click();
    expect(await page.locator('#gate-error').textContent()).toBe('不对，请再试一次。');
    expect(await visibleGateText(page)).toBe('请先验证');
    await page.evaluate(() => {
      document.getElementById('gate-input').value = '';
    });
    await page.screenshot({ path: path.join(ARTIFACTS, 'gate_v2_mobile_wrong.png') });
    await page.setViewportSize({ width: 320, height: 680 });
    overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    await expect(page.locator('.hero')).toBeHidden();
  });
});
