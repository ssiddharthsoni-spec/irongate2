import { test, expect } from '@playwright/test';

test.describe('Landing Page', () => {
  test('renders the hero section', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('text=Iron Gate')).toBeVisible();
  });

  test('has navigation links', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('a[href="#features"]')).toBeVisible();
    await expect(page.locator('a[href="#security"]')).toBeVisible();
  });

  test('has footer with legal links', async ({ page }) => {
    await page.goto('/');
    const footer = page.locator('footer');
    await expect(footer.locator('a[href="/privacy"]')).toBeVisible();
    await expect(footer.locator('a[href="/terms"]')).toBeVisible();
  });

  test('demo link navigates correctly', async ({ page }) => {
    await page.goto('/');
    await page.click('a[href="/demo"]');
    await expect(page).toHaveURL('/demo');
  });
});

test.describe('Privacy Policy', () => {
  test('renders without authentication', async ({ page }) => {
    await page.goto('/privacy');
    await expect(page.locator('text=Privacy Policy')).toBeVisible();
    await expect(page.locator('text=Data We Collect')).toBeVisible();
  });
});

test.describe('Terms of Service', () => {
  test('renders without authentication', async ({ page }) => {
    await page.goto('/terms');
    await expect(page.locator('text=Terms of Service')).toBeVisible();
    await expect(page.locator('text=Acceptable Use')).toBeVisible();
  });
});
