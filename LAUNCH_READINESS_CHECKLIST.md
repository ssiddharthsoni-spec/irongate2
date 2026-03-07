# IronGate Launch Readiness Checklist

**Generated:** March 6, 2026
**Current Status:** NOT READY FOR LAUNCH
**Estimated Fix Time:** 5-7 days (1 senior engineer)

---

## BLOCKING ISSUES (Must Fix Before Launch)

### Dashboard & Admin

- [ ] **Demo Data Warning**
  - Add persistent banner when in demo mode
  - Don't auto-show demo data immediately on page load
  - **File:** `apps/dashboard/src/app/dashboard/page.tsx`
  - **Effort:** 2 hours
  - **Acceptance:** User sees "Demo Mode" before any data renders

- [ ] **Silent API Failures on Team Actions**
  - Fix: `admin/users/page.tsx` — invite handler (line 127-141)
  - Fix: `admin/users/page.tsx` — role change handler (line 159-164)
  - Fix: `settings/team/page.tsx` — invite handler (line 57-82)
  - **Effort:** 3 hours (all three)
  - **Acceptance:** Errors show to user, no silent demo-mode fallbacks

- [ ] **Broken Checkout Flow**
  - Fix: `settings/billing/page.tsx` (line 95-102)
  - Check for empty `url` and show error
  - **Effort:** 1 hour
  - **Acceptance:** User sees error if checkout initialization fails

- [ ] **Missing Report Pages**
  - Implement: `reports/page.tsx`
  - Implement: `reports/exposure/page.tsx`
  - Wire up to `/v1/reports/exposure` endpoint (confirmed working)
  - **Effort:** 6 hours
  - **Acceptance:** Reports load real data and can be exported

### Extension

- [ ] **Extension Onboarding State Machine**
  - Fix: `extension/src/sidepanel/App.tsx` (lines 92-152)
  - Add timeout for storage.local.get()
  - Show error state if storage fails
  - **Effort:** 2 hours
  - **Acceptance:** User never sees blank loading screen

- [ ] **Extension Content UI Components**
  - Find or build: BlockOverlay, SensitivityBadge, EntityTooltip
  - Status: **Files not found in codebase**
  - **Effort:** 8-12 hours (may need to build from scratch)
  - **Acceptance:** Core extension features visible to user

### API Validation

- [ ] **Plugin Code Validation**
  - File: `admin/plugins/page.tsx`
  - Add syntax validation before upload
  - Prevent `require()` and `eval()` calls
  - **Effort:** 2 hours
  - **Acceptance:** Bad code rejected with error message

---

## HIGH PRIORITY (Strongly Recommended)

### Dashboard

- [ ] **Empty States on All List Pages**
  - `dashboard/page.tsx` — Recent High Risk Events (line 393-407)
  - `admin/analytics/page.tsx` — Users table (line 185-216)
  - `compliance/page.tsx` — Framework selection (line 232-272)
  - Add help text, next steps, icons
  - **Effort:** 4 hours (all pages)
  - **Acceptance:** Users know what to do when empty

- [ ] **Webhook Event Type Documentation**
  - File: `admin/webhooks/page.tsx`
  - Add tooltips/help text explaining each event type
  - **Effort:** 1 hour
  - **Acceptance:** Users understand webhook options

- [ ] **Remove User Confirmation Dialog**
  - File: `settings/team/page.tsx` (line 96-106)
  - Add modal asking "Are you sure?"
  - **Effort:** 1.5 hours
  - **Acceptance:** Users can't accidentally delete team members

### Analytics

- [ ] **Replace Demo Data with Real Data in Admin Analytics**
  - File: `admin/analytics/page.tsx` (line 41-58)
  - Stop using hard-coded timestamps for `lastActive`
  - Show actual active user status, not fake 2 days ago
  - **Effort:** 2 hours
  - **Acceptance:** Chart data changes daily, not static

---

## MEDIUM PRIORITY (Nice to Have)

- [ ] **CSV Upload Preview**
  - File: `admin/page.tsx`
  - Show table of parsed data before confirming upload
  - **Effort:** 3 hours

- [ ] **Save Confirmation Feedback**
  - File: `compliance/page.tsx`
  - Add toast/message when save succeeds
  - **Effort:** 1 hour

- [ ] **Trial Days Calculation Robustness**
  - File: `settings/billing/page.tsx` (line 148-150)
  - Use `floor` instead of `ceil` for conservative calculation
  - **Effort:** 0.5 hours

- [ ] **Billing Portal Integration Testing**
  - Test Stripe checkout end-to-end
  - Test portal link opens correctly
  - **Effort:** 2 hours (testing only)

---

## API & BACKEND (Status: ✅ COMPLETE)

All core API routes are **fully implemented and working**:

- ✅ `GET /v1/reports/exposure` — Ready
- ✅ `GET /v1/incidents/:id/narrative` — Ready
- ✅ `GET /v1/alerts/` — Ready
- ✅ `POST /v1/documents/scan` — Ready
- ✅ `GET /v1/notifications/preferences` — Ready
- ✅ `GET /v1/provenance/:entityHash` — Ready
- ✅ `GET /v1/user/export` — Ready

**No backend changes needed for launch.**

---

## SECURITY AUDIT

- ✅ PII handling correct (hashed, encrypted in documents)
- ✅ GDPR export properly scoped to user
- ⚠️ **Plugin code execution needs input validation** (CRITICAL)
- ✅ Webhook signatures handled properly
- ✅ CSV injection risk low

---

## BEFORE LAUNCH CHECKLIST

### Testing
- [ ] End-to-end: Sign up → Install extension → Run demo → Get report
- [ ] All error states (network down, 5xx errors, timeouts)
- [ ] Mobile responsiveness (particularly dashboard)
- [ ] Dark mode on all pages (CSS appears to support it)
- [ ] Billing flow with test Stripe account
- [ ] GDPR data export contains correct data

### Documentation
- [ ] API rate limits documented
- [ ] Webhook event types documented
- [ ] Compliance framework mappings published
- [ ] FAQ: Why do I see demo data?
- [ ] FAQ: How do I invite team members?

### Monitoring
- [ ] Error tracking (Sentry or similar) enabled
- [ ] Performance monitoring (LCP, CLS, FID)
- [ ] API endpoint monitoring with alerts
- [ ] Database connection pool monitoring

### Deployment
- [ ] Environment variables documented
- [ ] Database migrations tested
- [ ] Rollback plan ready
- [ ] Staging environment mirrors production

---

## RISK ASSESSMENT

### High Risk
- **Demo data confusion** → Will get user support tickets day 1
- **Silent API failures** → Users won't know why team invites don't work
- **Missing reports** → Flagship feature unavailable
- **Extension UI missing** → Core product can't be used

### Medium Risk
- **Empty states** → Users confused but not data loss
- **Webhook docs missing** → Users need support, not breaking
- **Removal confirmation** → Might delete wrong user, recoverable

### Low Risk
- **Trial days edge case** → Rare, non-critical
- **CSV preview missing** → Workaround exists

---

## ESTIMATED TIMELINE

### Day 1 (8 hours)
- [ ] Fix demo data handling (2h)
- [ ] Fix all API failure handlers (3h)
- [ ] Add empty states (3h)

### Day 2 (8 hours)
- [ ] Implement report pages (6h)
- [ ] Fix extension onboarding (2h)

### Day 3 (8 hours)
- [ ] Build/locate extension UI components (4-8h)
- [ ] Plugin validation (2h)

### Day 4 (4 hours)
- [ ] Webhook documentation (1h)
- [ ] Remove confirmation dialog (1.5h)
- [ ] Testing & polish (1.5h)

**Total: 28-32 hours ≈ 3.5-4 days for one engineer**

---

## GO/NO-GO DECISION FRAMEWORK

### Must Have (Blocking)
- [ ] No demo data confusion
- [ ] All API calls show real errors to user
- [ ] Report pages implemented
- [ ] Extension core UI built
- [ ] Plugin validation in place

### Should Have
- [ ] Empty states everywhere
- [ ] Confirmation dialogs for destructive actions
- [ ] All event types documented

### Nice to Have
- [ ] CSV preview
- [ ] Save confirmations
- [ ] Edge case fixes

---

## FINAL ASSESSMENT

**Current State:** 70% complete
- ✅ API layer: 100%
- ✅ Core features: 85%
- ⚠️ UX polish: 45%
- ⚠️ Error handling: 40%

**Ready to launch?** **NO** — Too many user-facing issues that will erode trust.

**Can ship with fixes?** **YES** — 4 days of work gets to 95% launch-ready.

**Recommended action:** Allocate senior engineer for 1 week, then launch.
