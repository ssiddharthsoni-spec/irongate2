import { test, expect } from '@playwright/test';

test.describe('Authentication', () => {
  test('redirects unauthenticated users to sign-in for protected routes', async ({ page }) => {
    await page.goto('/dashboard');
    // Clerk middleware should redirect to sign-in
    await expect(page).toHaveURL(/sign-in/);
  });

  test('allows access to public routes without auth', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL('/');

    await page.goto('/demo');
    await expect(page).toHaveURL('/demo');

    await page.goto('/install');
    await expect(page).toHaveURL('/install');
  });
});
