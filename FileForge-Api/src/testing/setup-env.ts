import { applyTestEnv } from './test-env';

// Jest `setupFiles`: runs before each test file, before AppModule's ConfigModule reads the environment.
applyTestEnv();
