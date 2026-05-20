const fs = require('fs');
const path = require('path');
const logger = require('./logger');

const sessionsDir = path.resolve(process.env.IG_SESSION_DIR || './data/ig-sessions');
const activeProfileLocks = new Map();

function ensureSessionsDir() {
  if (!fs.existsSync(sessionsDir)) fs.mkdirSync(sessionsDir, { recursive: true });
}

function getSessionPath(accountId) {
  ensureSessionsDir();
  return path.join(sessionsDir, String(accountId));
}

function getLegacySessionPath(accountId) {
  ensureSessionsDir();
  return path.join(sessionsDir, `${accountId}.json`);
}

function getProfilePath(accountId) {
  return path.join(getSessionPath(accountId), 'profile');
}

function ensureAccountSessionDir(accountId) {
  const accountSessionDir = getSessionPath(accountId);
  if (!fs.existsSync(accountSessionDir)) fs.mkdirSync(accountSessionDir, { recursive: true });
  return accountSessionDir;
}

function isLegacyStorageStatePath(sessionPath) {
  return !!sessionPath && path.extname(sessionPath).toLowerCase() === '.json';
}

function isLoggedOutPath(url = '') {
  return /\/accounts\/login\/?/i.test(url);
}

function isInsideSessionsDir(targetPath) {
  const resolvedRoot = path.resolve(sessionsDir);
  const resolvedTarget = path.resolve(targetPath);
  return resolvedTarget === resolvedRoot || resolvedTarget.startsWith(`${resolvedRoot}${path.sep}`);
}

async function withAccountSessionLock(accountId, task) {
  const key = String(accountId || 'unknown');
  const previous = activeProfileLocks.get(key) || Promise.resolve();
  let release;
  const current = new Promise(resolve => { release = resolve; });
  activeProfileLocks.set(key, previous.finally(() => current));

  await previous;
  try {
    return await task();
  } finally {
    release();
    if (activeProfileLocks.get(key) === current) {
      activeProfileLocks.delete(key);
    }
  }
}

async function getPlaywright() {
  try {
    return require('playwright');
  } catch (err) {
    throw new Error('Playwright is not installed. Run `npm install playwright` and `npx playwright install chromium` in the backend.');
  }
}

async function launchBrowser(playwright) {
  return playwright.chromium.launch({
    headless: process.env.IG_FALLBACK_HEADLESS !== 'false',
  });
}

async function launchPersistentBrowserContext(playwright, accountId) {
  const userDataDir = getProfilePath(accountId);
  ensureAccountSessionDir(accountId);
  if (!fs.existsSync(userDataDir)) fs.mkdirSync(userDataDir, { recursive: true });

  return playwright.chromium.launchPersistentContext(userDataDir, {
    headless: process.env.IG_FALLBACK_HEADLESS !== 'false',
  });
}

async function dismissDialogs(page) {
  const labels = ['Not now', 'Cancel', 'Allow all cookies', 'Only allow essential cookies'];
  for (const label of labels) {
    const locator = page.getByRole('button', { name: label }).first();
    if (await locator.count()) {
      await locator.click().catch(() => {});
    }
  }
}

async function loginWithCredentials(page, username, password, context = {}) {
  logger.info('Instagram fallback login started', {
    accountId: context.accountId || null,
    username,
  });

  await page.goto('https://www.instagram.com/accounts/login/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await dismissDialogs(page);
  await page.locator('input[name="username"]').fill(username);
  await page.locator('input[name="password"]').fill(password);
  await page.locator('button[type="submit"]').click();
  await page.waitForLoadState('networkidle', { timeout: 60000 }).catch(() => {});
  await dismissDialogs(page);

  const loginError = page.locator("text=/incorrect|try again|couldn't log you in/i").first();
  if (await loginError.count()) {
    throw new Error('Instagram fallback login failed. Check the username/password or complete the login challenge in the browser.');
  }

  logger.info('Instagram fallback login succeeded', {
    accountId: context.accountId || null,
    username,
  });
}

async function ensureLoginStillValid(page, context = {}) {
  await page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await dismissDialogs(page);
  await page.waitForTimeout(1500);

  const currentUrl = page.url();
  if (isLoggedOutPath(currentUrl)) {
    logger.warn('Instagram fallback session requires re-login', {
      accountId: context.accountId || null,
      postId: context.postId || null,
      username: context.username || null,
      currentUrl,
    });
    return false;
  }

  const usernameInput = page.locator('input[name="username"]').first();
  if (await usernameInput.count()) {
    logger.warn('Instagram fallback session appears logged out on homepage', {
      accountId: context.accountId || null,
      postId: context.postId || null,
      username: context.username || null,
    });
    return false;
  }

  return true;
}

async function createFallbackSession(accountId, username, password) {
  const playwright = await getPlaywright();
  const sessionPath = getSessionPath(accountId);

  return withAccountSessionLock(accountId, async () => {
    const browserContext = await launchPersistentBrowserContext(playwright, accountId);

    try {
      const page = browserContext.pages()[0] || await browserContext.newPage();
      await loginWithCredentials(page, username, password, { accountId });
      const valid = await ensureLoginStillValid(page, { accountId, username });
      if (!valid) {
        throw new Error('Instagram fallback login needs additional verification. Complete the challenge manually in a local persistent session, then try again.');
      }

      logger.info('Instagram fallback session stored', {
        accountId,
        username,
        sessionPath,
      });
      return { sessionPath, username };
    } finally {
      await browserContext.close().catch(() => {});
    }
  });
}

async function uploadViaComposer(page, videoPath, caption, context = {}) {
  const hasValidSession = await ensureLoginStillValid(page, context);
  if (!hasValidSession) {
    throw new Error('Instagram fallback session is no longer valid. Reconnect this account before using browser fallback again.');
  }

  const createButton = page.getByRole('link', { name: /create/i }).first();
  if (await createButton.count()) {
    await createButton.click();
  } else {
    await page.goto('https://www.instagram.com/create/select/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  }

  const fileInput = page.locator('input[type="file"]').first();
  await fileInput.setInputFiles(videoPath);
  logger.info('Instagram fallback upload started', {
    accountId: context.accountId || null,
    postId: context.postId || null,
    videoPath,
  });

  for (let i = 0; i < 3; i++) {
    const nextButton = page.getByRole('button', { name: /^Next$/i }).first();
    if (await nextButton.count()) {
      await nextButton.click().catch(() => {});
      await page.waitForTimeout(1500);
    }
  }

  const captionBox = page.locator('textarea[aria-label*="caption"], div[role="textbox"]').first();
  await captionBox.fill(caption || '');
  logger.info('Instagram fallback caption entered', {
    accountId: context.accountId || null,
    postId: context.postId || null,
    captionLength: (caption || '').length,
  });

  const shareButton = page.getByRole('button', { name: /share/i }).first();
  await shareButton.click();
  logger.info('Instagram fallback publish submitted', {
    accountId: context.accountId || null,
    postId: context.postId || null,
  });

  await page.waitForLoadState('networkidle', { timeout: 120000 }).catch(() => {});
  await page.waitForTimeout(5000);
}

async function postReelWithBrowser(account, videoPath, caption, context = {}) {
  if (!videoPath || !fs.existsSync(videoPath)) {
    throw new Error('Local video file is required for Instagram browser fallback publishing.');
  }

  const accountId = account.id || context.accountId;
  const sessionPath = account.fallback_session_path || getSessionPath(accountId);
  if (!sessionPath || !fs.existsSync(sessionPath)) {
    const legacySessionPath = getLegacySessionPath(accountId);
    if (!fs.existsSync(legacySessionPath)) {
      throw new Error('No Instagram fallback session found for this account. Create one first with /api/accounts/:id/fallback-session.');
    }
    account.fallback_session_path = legacySessionPath;
  }

  const playwright = await getPlaywright();
  const resolvedSessionPath = account.fallback_session_path || sessionPath;

  return withAccountSessionLock(accountId, async () => {
    let browser;
    let browserContext;

    try {
      if (isLegacyStorageStatePath(resolvedSessionPath)) {
        browser = await launchBrowser(playwright);
        browserContext = await browser.newContext({ storageState: resolvedSessionPath });
      } else {
        browserContext = await launchPersistentBrowserContext(playwright, accountId);
      }

      const page = browserContext.pages()[0] || await browserContext.newPage();
      await uploadViaComposer(page, videoPath, caption, {
        ...context,
        accountId,
        username: account.fallback_username || account.username || null,
      });

      if (isLegacyStorageStatePath(resolvedSessionPath)) {
        await browserContext.storageState({ path: resolvedSessionPath });
      }

      logger.info('Instagram fallback publish completed', {
        accountId: context.accountId || account.id || null,
        postId: context.postId || null,
        username: account.fallback_username || account.username || null,
        sessionPath: resolvedSessionPath,
      });
      return { method: 'playwright-fallback', sessionPath: resolvedSessionPath };
    } catch (err) {
      logger.error('Instagram fallback publish failed', {
        accountId: context.accountId || account.id || null,
        postId: context.postId || null,
        username: account.fallback_username || account.username || null,
        sessionPath: resolvedSessionPath,
        errorMessage: err.message,
      });
      throw err;
    } finally {
      await browserContext?.close().catch(() => {});
      await browser?.close().catch(() => {});
    }
  });
}

function removeSessionPath(sessionPath) {
  if (!sessionPath || !fs.existsSync(sessionPath)) return;
  if (!isInsideSessionsDir(sessionPath)) {
    throw new Error('Refusing to remove fallback session outside IG session directory.');
  }

  const stats = fs.statSync(sessionPath);
  if (stats.isDirectory()) {
    fs.rmSync(sessionPath, { recursive: true, force: true });
    return;
  }

  fs.unlinkSync(sessionPath);
}

module.exports = {
  createFallbackSession,
  getSessionPath,
  getLegacySessionPath,
  postReelWithBrowser,
  removeSessionPath,
};
