// Set all required env vars BEFORE any module loads (env.ts calls process.exit if missing)
process.env.NODE_ENV           = 'test';
process.env.DATABASE_URL       = 'postgresql://test:test@localhost:5432/testdb';
process.env.JWT_SECRET         = 'test-secret-that-is-at-least-32-characters-long!!';
process.env.SESSION_SECRET     = 'test-session-secret-at-least-32-chars-long!!!!!';
process.env.BACKEND_URL        = 'http://localhost:4001';
process.env.FRONTEND_URL       = 'http://localhost:3000';
process.env.AZURE_CLIENT_ID    = 'test-azure-client-id';
process.env.AZURE_CLIENT_SECRET= 'test-azure-client-secret';
process.env.AZURE_TENANT_ID    = 'test-azure-tenant-id';
process.env.AZURE_REDIRECT_URI             = 'http://localhost:4001/auth/callback';
process.env.AZURE_POST_LOGOUT_REDIRECT_URI = 'http://localhost:3000';
