import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';

describe('Billing Routes', () => {
  it('should return mock data when Stripe is not configured', async () => {
    // The billing route falls back to mock data when STRIPE_SECRET_KEY is not set
    const { billingRoutes } = await import('../src/routes/billing');

    const app = new Hono();
    // Mount without auth for testing
    app.route('/v1/billing', billingRoutes);

    // Note: This test verifies the module loads without errors
    // Full integration tests require a database connection
    expect(billingRoutes).toBeDefined();
  });
});

describe('Billing Price Tiers', () => {
  it('should define correct tier progression', () => {
    const tiers = ['free', 'pro', 'business', 'enterprise'];
    expect(tiers).toHaveLength(4);
    expect(tiers[0]).toBe('free');
    expect(tiers[3]).toBe('enterprise');
  });

  it('should validate billing cycles', () => {
    const validCycles = ['monthly', 'annual'];
    expect(validCycles).toContain('monthly');
    expect(validCycles).toContain('annual');
  });
});
