const { test, expect } = require('@playwright/test');
const crypto = require('crypto');
const path = require('path');

const FIXTURE_TEXT = 'fixture-测试-门';
const FIXTURE_DIGEST = crypto.createHash('sha256').update(FIXTURE_TEXT, 'utf8').digest('hex');
const ARTIFACTS = '/opt/cursor/artifacts';

function arm(page) {
  return page.addInitScript((digest) => {
    window.__SUNFULEI_GATE_TEST__ = { digest: digest };
  }, FIXTURE_DIGEST);
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

test('memoir stays behind the same gate', async ({ page }) => {
  await page.goto('/memoir/');
  await expect(page.locator('#gate-form')).toBeVisible();
  expect(await visibleGateText(page)).toBe('请先验证');
  await expect(page.getByRole('heading', { name: '人生分卷' })).toBeHidden();
  const visible = await page.locator('body').innerText();
  expect(visible).not.toContain('孙嘉妍');
  expect(visible).not.toContain('济南林海');
});

test('tabs, deeplinks, and only confirmed facts', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (err) => errors.push(String(err)));
  await arm(page);
  await page.goto('/memoir/#qinggan');
  await unlock(page);
  await expect(page.getByRole('heading', { name: '人生分卷' })).toBeVisible();
  await expect(page.locator('#panel-qinggan')).toBeVisible();
  await expect(page.locator('#panel-work')).toBeHidden();
  await expect(page.getByRole('tab', { name: '情感' })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('tab', { name: '情感' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#panel-aihao')).toBeVisible();
  await expect(page.getByText('阅读学习').first()).toBeVisible();
  await expect(page.locator('#panel-aihao')).toContainText('待补充');
  expect(await page.locator('#panel-aihao').innerText()).not.toContain('摄影');
  expect(await page.locator('#panel-aihao').innerText()).not.toContain('旅行');

  await page.goto('/memoir/#work');
  await expect(page.locator('#gate')).toBeHidden();
  await expect(page.locator('#panel-work')).toBeVisible();
  await expect(page.getByRole('tab', { name: '工作' })).toHaveText('工作');
  await expect(page.locator('#panel-work')).toContainText('2014 年 6 月 9 日');
  await expect(page.locator('#panel-work')).toContainText('济南林海建设发展有限公司');
  await expect(page.locator('#panel-work')).toContainText('施工员');
  await expect(page.locator('#panel-work')).toContainText('技术负责人');
  await expect(page.locator('#panel-work')).toContainText('没有建造师证书');
  await expect(page.locator('#panel-work')).toContainText('2019 年 5 月 31 日');
  await expect(page.locator('#panel-work')).toContainText('这批材料未记载评审结果');
  await expect(page.locator('#y2026')).toContainText('知新楼 B218');
  await expect(page.locator('#y2026')).toContainText('后续过程待补充');
  await expect(page.locator('#panel-work')).not.toContainText('尚未取得');
  await expect(page.locator('#panel-work')).not.toContainText('第一次完整');
  await expect(page.getByRole('link', { name: '前半生' }).first()).toHaveAttribute('href', '/#timeline');
  await page.locator('.years button', { hasText: '2019–2020' }).click();
  const yearTop = await page.locator('#y2020').evaluate((el) => Math.round(el.getBoundingClientRect().top));
  expect(yearTop).toBeLessThan(90);

  await page.getByRole('tab', { name: '情感' }).click();
  await page.getByText('父女时光').click();
  await expect(page.getByText('女儿孙嘉妍出生')).toBeVisible();
  await expect(page.locator('#panel-qinggan')).toContainText('配偶的姓名，首页没有写');
  await expect(page.locator('#panel-qinggan')).not.toContainText('妻子');
  expect(errors).toEqual([]);
});

test('homepage entry, back, and the three existing cards', async ({ page }) => {
  await arm(page);
  await page.goto('/');
  await unlock(page);
  await expect(page.locator('a.card[href="/huozhe/"]')).toBeVisible();
  await expect(page.locator('a.card[href="/cooking/"]')).toBeVisible();
  await expect(page.locator('a[href="http://kanban.sunfulei.com/"]')).toBeVisible();
  await expect(page.locator('#timeline')).toContainText('宋家台小学');
  await page.locator('#memoirLink').click();
  await expect(page).toHaveURL(/\/memoir\/#work$/);
  await expect(page.locator('#gate')).toBeHidden();
  await expect(page.getByRole('heading', { name: '人生分卷' })).toBeVisible();
  await page.locator('#homeLink').click();
  await expect(page.locator('.hero h1')).toContainText('孙福磊');
  await expect(page.locator('#gate')).toBeHidden();
  await page.goBack();
  await expect(page.locator('#gate')).toBeHidden();
  await expect(page.getByRole('heading', { name: '人生分卷' })).toBeVisible();
});

test('public memoir text has no Work label or private details', async () => {
  const fs = require('fs');
  const html = fs.readFileSync('memoir/index.html', 'utf8');
  const home = fs.readFileSync('index.html', 'utf8');
  expect(html).not.toMatch(/>\s*Work\s*</);
  expect(html).not.toContain('私下审阅');
  expect(html).not.toContain('未上线');
  expect(html).not.toContain('未加密');
  expect(home).not.toContain('>Work<');
  for (const word of ['受伤', '轻伤', '家装', '鲁商', '东悦府', '回款', '尾款', '质保', '投诉', '万元']) {
    expect(html).not.toContain(word);
  }
});

test('education deeplink, stages, and no raw names', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (err) => errors.push(String(err)));
  await page.goto('/memoir/#education');
  expect(await visibleGateText(page)).toBe('请先验证');
  await expect(page.getByRole('heading', { name: '山上的那些年' })).toBeHidden();
  await arm(page);
  await page.reload();
  await unlock(page);
  await expect(page.locator('#panel-education')).toBeVisible();
  await expect(page.locator('#panel-work')).toBeHidden();
  await expect(page.getByRole('tab', { name: '求学' })).toHaveText('求学');
  await expect(page.locator('#panel-education')).toContainText('大约1994—1999年');
  await expect(page.locator('#panel-education')).toContainText('初一，也就是六年级');
  await expect(page.locator('#panel-education')).toContainText('1997年香港回归');
  await expect(page.locator('#panel-education')).toContainText('2010年领到毕业证');
  await expect(page.locator('#panel-education')).toContainText('2024年开始用 AI、学 AI');
  await expect(page.locator('.addendum')).toContainText('2026年11月补记');
  await expect(page.locator('.addendum')).toContainText('2026年3月');
  const edu = await page.locator('#panel-education').innerText();
  for (const name of ['宋家台', '付家庄', '冶源', '华宇', '李新', '孙嘉妍']) {
    expect(edu).not.toContain(name);
  }
  expect(edu).not.toContain('核对');
  expect(edu).not.toContain('编辑注');
  await page.screenshot({ path: path.join(ARTIFACTS, 'memoir_education_desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await page.screenshot({ path: path.join(ARTIFACTS, 'memoir_education_mobile.png') });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole('tab', { name: '工作' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#panel-education')).toBeVisible();
  await page.locator('.edu-nav button', { hasText: '大学' }).click();
  const college = await page.locator('#edu-college').evaluate((el) => {
    const r = el.getBoundingClientRect();
    const max = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
    return { top: Math.round(r.top), bottom: Math.round(r.bottom), y: window.scrollY, max, vh: window.innerHeight };
  });
  expect(college.top).toBeGreaterThan(-8);
  expect(college.bottom).toBeLessThanOrEqual(college.vh + 8);
  expect(college.top < 140 || Math.abs(college.y - college.max) <= 2).toBe(true);
  await page.locator('.edu-nav button', { hasText: '小学' }).click();
  const primaryTop = await page.locator('#edu-primary').evaluate((el) => Math.round(el.getBoundingClientRect().top));
  expect(primaryTop).toBeGreaterThan(-8);
  expect(primaryTop).toBeLessThan(80);
  expect(errors).toEqual([]);
});

test('old session key does not open the memoir', async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('sfl-gate-v1', '1'));
  await page.goto('/memoir/#aihao');
  await expect(page.locator('#gate-form')).toBeVisible();
  expect(await visibleGateText(page)).toBe('请先验证');
});

test.describe('memoir layout', () => {
  test('desktop unlocked preview', async ({ page }) => {
    await arm(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/memoir/#work');
    await unlock(page);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    await page.screenshot({ path: path.join(ARTIFACTS, 'memoir_timeline_desktop.png') });
  });

  test('mobile unlocked preview', async ({ page }) => {
    await arm(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/memoir/#work');
    await unlock(page);
    await expect(page.locator('#y2014')).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    await page.screenshot({ path: path.join(ARTIFACTS, 'memoir_timeline_mobile.png') });
  });
});
