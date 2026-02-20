import { Hono } from 'hono';

// Declare custom variables available on the Hono context
export type AppVariables = {
  userId: string;
  clerkId: string;
  firmId: string;
};

export type AppEnv = {
  Variables: AppVariables;
};
