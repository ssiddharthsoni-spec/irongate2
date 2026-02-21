// ============================================================================
// Iron Gate — Invite Routes
// ============================================================================
// Manages team member invitations: create, list, revoke, and accept.
// Invite tokens are generated as crypto-random hex strings and stored in the
// invites table with a 7-day expiry.
// ============================================================================

import { Hono } from 'hono';
import { z } from 'zod';
import crypto from 'crypto';
import { db } from '../db/client';
import { invites, users, firms } from '../db/schema';
import { eq, and, isNull } from 'drizzle-orm';
import { sendInviteEmail } from '../services/email';
import type { AppEnv } from '../types';

export const inviteRoutes = new Hono<AppEnv>();

const INVITE_EXPIRY_DAYS = 7;

// ---------------------------------------------------------------------------
// POST /v1/invites — Create and send an invite
// ---------------------------------------------------------------------------
inviteRoutes.post('/', async (c) => {
  const firmId = c.get('firmId');
  const userId = c.get('userId');

  const body = await c.req.json();

  const inviteSchema = z.object({
    email: z.string().email(),
    role: z.enum(['admin', 'user']).optional().default('user'),
  });

  const parsed = inviteSchema.parse(body);

  // Check if the email is already a member of this firm
  const [existingUser] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.email, parsed.email), eq(users.firmId, firmId)))
    .limit(1);

  if (existingUser) {
    return c.json({ error: 'User is already a member of this organization' }, 409);
  }

  // Check if there's already a pending invite for this email
  const [existingInvite] = await db
    .select({ id: invites.id })
    .from(invites)
    .where(
      and(
        eq(invites.email, parsed.email),
        eq(invites.firmId, firmId),
        isNull(invites.acceptedAt),
      ),
    )
    .limit(1);

  if (existingInvite) {
    return c.json({ error: 'An invite has already been sent to this email' }, 409);
  }

  // Generate a secure token
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + INVITE_EXPIRY_DAYS);

  // Store the invite
  const [invite] = await db
    .insert(invites)
    .values({
      firmId,
      email: parsed.email,
      role: parsed.role,
      token,
      invitedBy: userId,
      expiresAt,
    })
    .returning();

  // Look up the inviter's name and firm name for the email
  const [inviter] = await db
    .select({ displayName: users.displayName, email: users.email })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  const [firm] = await db
    .select({ name: firms.name })
    .from(firms)
    .where(eq(firms.id, firmId))
    .limit(1);

  const inviterName = inviter?.displayName || inviter?.email || 'A team member';
  const firmName = firm?.name || 'your organization';

  // Send the invite email
  const emailResult = await sendInviteEmail(parsed.email, inviterName, firmName, token);

  return c.json(
    {
      id: invite.id,
      email: invite.email,
      role: invite.role,
      expiresAt: invite.expiresAt,
      emailSent: emailResult.success,
    },
    201,
  );
});

// ---------------------------------------------------------------------------
// GET /v1/invites — List pending invites for the firm
// ---------------------------------------------------------------------------
inviteRoutes.get('/', async (c) => {
  const firmId = c.get('firmId');

  const pendingInvites = await db
    .select({
      id: invites.id,
      email: invites.email,
      role: invites.role,
      invitedBy: invites.invitedBy,
      expiresAt: invites.expiresAt,
      createdAt: invites.createdAt,
      acceptedAt: invites.acceptedAt,
    })
    .from(invites)
    .where(and(eq(invites.firmId, firmId), isNull(invites.acceptedAt)));

  // Annotate with expiry status
  const now = new Date();
  const result = pendingInvites.map((inv) => ({
    ...inv,
    expired: new Date(inv.expiresAt) < now,
  }));

  return c.json(result);
});

// ---------------------------------------------------------------------------
// DELETE /v1/invites/:id — Revoke an invite
// ---------------------------------------------------------------------------
inviteRoutes.delete('/:id', async (c) => {
  const firmId = c.get('firmId');
  const inviteId = c.req.param('id');

  const deleted = await db
    .delete(invites)
    .where(and(eq(invites.id, inviteId), eq(invites.firmId, firmId)))
    .returning({ id: invites.id });

  if (deleted.length === 0) {
    return c.json({ error: 'Invite not found' }, 404);
  }

  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// POST /v1/invites/:token/accept — Accept an invite
// ---------------------------------------------------------------------------
inviteRoutes.post('/:token/accept', async (c) => {
  const token = c.req.param('token');
  const clerkId = c.get('clerkId');

  // Find the invite by token
  const [invite] = await db
    .select()
    .from(invites)
    .where(eq(invites.token, token))
    .limit(1);

  if (!invite) {
    return c.json({ error: 'Invalid invite token' }, 404);
  }

  if (invite.acceptedAt) {
    return c.json({ error: 'This invite has already been accepted' }, 410);
  }

  if (new Date(invite.expiresAt) < new Date()) {
    return c.json({ error: 'This invite has expired' }, 410);
  }

  // Check if user already belongs to this firm
  const [existingUser] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.email, invite.email), eq(users.firmId, invite.firmId)))
    .limit(1);

  if (existingUser) {
    // Mark invite as accepted since the user already exists
    await db
      .update(invites)
      .set({ acceptedAt: new Date() })
      .where(eq(invites.id, invite.id));

    return c.json({ ok: true, userId: existingUser.id, alreadyMember: true });
  }

  // Check if user exists with this clerkId (from a different firm or no firm)
  const [existingClerkUser] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.clerkId, clerkId))
    .limit(1);

  let newUserId: string;

  if (existingClerkUser) {
    // Move existing user to the inviting firm
    await db
      .update(users)
      .set({
        firmId: invite.firmId,
        role: invite.role,
        email: invite.email,
        updatedAt: new Date(),
      })
      .where(eq(users.id, existingClerkUser.id));
    newUserId = existingClerkUser.id;
  } else {
    // Create a new user record linked to this firm
    const [newUser] = await db
      .insert(users)
      .values({
        clerkId,
        firmId: invite.firmId,
        email: invite.email,
        role: invite.role,
      })
      .returning({ id: users.id });
    newUserId = newUser.id;
  }

  // Mark invite as accepted
  await db
    .update(invites)
    .set({ acceptedAt: new Date() })
    .where(eq(invites.id, invite.id));

  return c.json({ ok: true, userId: newUserId, firmId: invite.firmId }, 201);
});
