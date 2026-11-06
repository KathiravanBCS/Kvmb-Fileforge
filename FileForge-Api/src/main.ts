import 'reflect-metadata';

import { Logger } from 'nestjs-pino';

import type { ConfigType } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';

import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { SessionStoreService } from './common/session/session-store.service';
import appConfig from './config/app.config';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
  const logger = app.get(Logger);
  app.useLogger(logger);

  configureApp(app);

  const { port, nodeEnv } = app.get<ConfigType<typeof appConfig>>(appConfig.KEY);
  await app.listen(port);
  logger.log(`FileForge API listening on port ${port} (${nodeEnv})`);
  if (!app.get(SessionStoreService).store) {
    logger.warn('Sessions use the in-memory store: for local development only, not for production.');
  }
}

bootstrap().catch((error: unknown) => {
  // Startup errors here are configuration errors (variable names only, never values).
  console.error(error instanceof Error ? error.message : 'FileForge API failed to start.');
  process.exit(1);
});
