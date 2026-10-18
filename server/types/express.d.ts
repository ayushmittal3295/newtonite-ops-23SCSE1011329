declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email: string;
        name: string;
        memberships: Array<{ teamId: string; role: string }>;
      };
      teamRole?: string;
    }
  }
}

export {};
