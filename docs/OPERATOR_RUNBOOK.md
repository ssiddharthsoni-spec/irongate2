# IronGate Operator Runbook

Common operational questions and how to answer them today, without a
dedicated operator dashboard. Use Supabase SQL Editor (or `psql` against
your production database) for all SQL queries below.

---

## 1. Who has signed up? Who's active?

### All firms, with size and activity

```sql
SELECT
  f.id,
  f.name,
  f.created_at,
  s.tier,
  s.status as sub_status,
  s.current_period_end as trial_or_renewal,
  COUNT(DISTINCT u.id) as user_count,
  COUNT(DISTINCT e.id) FILTER (WHERE e.created_at > NOW() - INTERVAL '7 days') as events_last_7d
FROM firms f
LEFT JOIN subscriptions s ON s.firm_id = f.id
LEFT JOIN users u ON u.firm_id = f.id
LEFT JOIN events e ON e.firm_id = f.id
GROUP BY f.id, s.tier, s.status, s.current_period_end
ORDER BY f.created_at DESC;
```

### Firms signed up this week

```sql
SELECT id, name, created_at
FROM firms
WHERE created_at > NOW() - INTERVAL '7 days'
ORDER BY created_at DESC;
```

### Firms that haven't been used in 14+ days (churn risk)

```sql
SELECT f.id, f.name, f.created_at,
       MAX(e.created_at) as last_event
FROM firms f
LEFT JOIN events e ON e.firm_id = f.id
GROUP BY f.id
HAVING MAX(e.created_at) < NOW() - INTERVAL '14 days'
    OR MAX(e.created_at) IS NULL
ORDER BY f.created_at DESC;
```

---

## 2. Which customers are actually using the product?

### Top 10 firms by weekly event volume

```sql
SELECT f.name, COUNT(*) as events_last_7d
FROM events e
JOIN firms f ON f.id = e.firm_id
WHERE e.created_at > NOW() - INTERVAL '7 days'
GROUP BY f.name
ORDER BY events_last_7d DESC
LIMIT 10;
```

### Per-firm detection quality (last 7 days)

```sql
SELECT
  f.name,
  COUNT(*) as total_events,
  COUNT(*) FILTER (WHERE sensitivity_level = 'critical') as critical,
  COUNT(*) FILTER (WHERE sensitivity_level = 'high') as high,
  COUNT(*) FILTER (WHERE sensitivity_level = 'medium') as medium,
  COUNT(*) FILTER (WHERE action = 'block') as blocked,
  COUNT(*) FILTER (WHERE action = 'proxy') as pseudonymized
FROM events e
JOIN firms f ON f.id = e.firm_id
WHERE e.created_at > NOW() - INTERVAL '7 days'
GROUP BY f.name
ORDER BY total_events DESC;
```

### Active users per firm (last 24 hours)

```sql
SELECT f.name, COUNT(DISTINCT h.user_id) as active_users
FROM extension_heartbeats h
JOIN firms f ON f.id = h.firm_id
WHERE h.received_at > NOW() - INTERVAL '24 hours'
GROUP BY f.name
ORDER BY active_users DESC;
```

---

## 3. Turn a firm on/off (emergency or non-payment)

The `kill_switch` table has a `firm` scope that disables all IronGate
functionality for a specific firm immediately. Extensions pick this up
on next API call.

### Disable a specific firm

```sql
INSERT INTO kill_switch (enabled, scope, firm_id, reason, activated_by)
VALUES (
  true,
  'firm',
  '<FIRM-UUID>',
  'Non-payment — account past due 60 days',
  'siddharth@irongate.ai'
)
ON CONFLICT (scope, firm_id)
DO UPDATE SET enabled = true, reason = EXCLUDED.reason, activated_at = NOW();
```

### Re-enable

```sql
UPDATE kill_switch
SET enabled = false, deactivated_at = NOW()
WHERE scope = 'firm' AND firm_id = '<FIRM-UUID>';
```

### See which firms are currently disabled

```sql
SELECT f.name, k.reason, k.activated_at, k.activated_by
FROM kill_switch k
JOIN firms f ON f.id = k.firm_id
WHERE k.scope = 'firm' AND k.enabled = true
ORDER BY k.activated_at DESC;
```

---

## 4. Billing and revenue

For billing state, **use the Stripe Dashboard** (dashboard.stripe.com):
- Revenue trends: Stripe → Home
- Per-customer billing: Stripe → Customers → search by email
- Failed charges: Stripe → Payments → filter by failed
- Subscriptions about to renew: Stripe → Billing → Subscriptions

For the IronGate-side view of subscriptions:

```sql
SELECT f.name, s.tier, s.status,
       s.current_period_start, s.current_period_end,
       s.cancel_at_period_end
FROM subscriptions s
JOIN firms f ON f.id = s.firm_id
ORDER BY s.current_period_end;
```

### Trials ending in next 7 days

```sql
SELECT f.name, s.current_period_end
FROM subscriptions s
JOIN firms f ON f.id = s.firm_id
WHERE s.status = 'trialing'
  AND s.current_period_end BETWEEN NOW() AND NOW() + INTERVAL '7 days'
ORDER BY s.current_period_end;
```

Use this query weekly to identify firms to reach out to before their trial
expires.

---

## 5. Debug a specific customer's issue

### See a firm's recent events

```sql
SELECT created_at, ai_tool_id, sensitivity_level, sensitivity_score, action
FROM events
WHERE firm_id = '<FIRM-UUID>'
ORDER BY created_at DESC
LIMIT 50;
```

### See a firm's enrolled devices

```sql
SELECT h.user_id, u.email, h.extension_version, h.device_platform,
       h.ollama_reachable, h.ollama_model_pulled, h.received_at
FROM extension_heartbeats h
JOIN users u ON u.id = h.user_id
WHERE h.firm_id = '<FIRM-UUID>'
ORDER BY h.received_at DESC;
```

### Impersonate a firm admin (for debugging)

Currently not built — you'd need to manually authenticate as the admin
via the Clerk dashboard (Users → find the admin → "Sign in as user").

---

## 6. Platform health snapshot

### Today's events across all firms

```sql
SELECT
  COUNT(*) as total_events_today,
  COUNT(DISTINCT firm_id) as active_firms_today,
  COUNT(*) FILTER (WHERE sensitivity_level IN ('high', 'critical')) as sensitive_events
FROM events
WHERE created_at > CURRENT_DATE;
```

### Error rate

```sql
-- Check API logs in Render dashboard for 5xx response rate
-- https://dashboard.render.com → irongate-api → Logs
```

### Extension version distribution (catch stale installs)

```sql
SELECT extension_version, COUNT(*) as devices
FROM extension_heartbeats
WHERE received_at > NOW() - INTERVAL '7 days'
GROUP BY extension_version
ORDER BY devices DESC;
```

---

## 7. When to build an operator dashboard

You need a dedicated `/ops` dashboard when any of these become true:

- [ ] You have **10+ paying customers** (manual management becomes tedious)
- [ ] You run **queries like the above more than 3x/week**
- [ ] You've **manually toggled kill switches more than twice** in a month
- [ ] You've **signed up your first non-founder team member** and they need ops access
- [ ] A customer emails about billing/access issues **more than once/month**

Until then, the SQL + Stripe + Supabase combo is enough.

---

## 8. What's already built that helps

- **Audit log** (`/admin/audit-log` on the dashboard — scoped per-firm)
- **Deployment health** (`/admin/deployment` — per-firm extension version, last-seen)
- **Ollama status wizard** (`/admin/deployment/ollama` — per-device Tier 2 health)
- **Kill switch via firm-scoped admin UI** (`/admin/controls`)

All of these are **customer-facing** (Priya sees her own firm). For the
operator view across all firms, use the SQL queries above.

---

## 9. Emergency contacts

Who to call when something breaks:

- **Render (API hosting):** Render Dashboard → Status; support@render.com
- **Vercel (dashboard hosting):** Vercel Dashboard → Status; vercel-incidents on Twitter
- **Supabase (database):** Supabase Dashboard → Infrastructure; support@supabase.io
- **Clerk (auth):** Clerk Dashboard → Status; support@clerk.com
- **Stripe (billing):** Stripe Dashboard → Support; help.stripe.com

For customer-reported issues, the playbook is:

1. Reproduce on your own machine (use the firm's test account if needed)
2. Check Render logs for 5xx responses around the time of the incident
3. Check Supabase logs for slow queries
4. If infra-related, escalate to the vendor
5. If code-related, hotfix + push + deploy
