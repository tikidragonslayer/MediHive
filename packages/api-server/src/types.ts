import { MediRole } from './middleware/auth';

/** Hono context variables set by auth middleware */
export type AppEnv = {
  Variables: {
    auth: {
      pubkey: string;
      role: MediRole;
      permissions: string[];
    };
  };
};
