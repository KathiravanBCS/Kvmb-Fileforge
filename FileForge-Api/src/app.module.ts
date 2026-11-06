import { randomUUID } from 'node:crypto';

import { LoggerModule } from 'nestjs-pino';

import { Module } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';

import { AppController } from './app.controller';
import { AppService } from './app.services';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { BigIntInterceptor } from './common/interceptors/bigint.interceptor';
import { SessionModule } from './common/session/session.module';
import { serializeRequestForLog, serializeResponseForLog } from './common/utils/logging.util';
import appConfig from './config/app.config';
import authConfig from './config/auth.config';
import { recoveryConfig, sessionStoreConfig, uploadLimitsConfig } from './config/central-hardening.config';
import centralStorageConfig from './config/central-storage.config';
import databaseConfig from './config/database.config';
import { validateEnv } from './config/env.validation';
import { AuthModule } from './modules/auth/auth.module';
import { CentralStorageModule } from './modules/central-storage/central-storage.module';
import { MicrosoftModule } from './modules/microsoft/microsoft.module';
import { StorageModule } from './modules/storage/storage.module';
import { UsersModule } from './modules/users/users.module';
import { WorkspacesModule } from './modules/workspaces/workspaces.module';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
      load: [
        appConfig,
        authConfig,
        centralStorageConfig,
        databaseConfig,
        uploadLimitsConfig,
        recoveryConfig,
        sessionStoreConfig,
      ],
    }),
    LoggerModule.forRootAsync({
      inject: [appConfig.KEY],
      useFactory: (config: ConfigType<typeof appConfig>) => ({
        pinoHttp: {
          level: config.logLevel,
          // Always generated here; a client-supplied id is never trusted into the logs.
          genReqId: () => randomUUID(),
          redact: {
            paths: [
              'req.headers.authorization',
              'req.headers.cookie',
              'res.headers["set-cookie"]',
              '*.access_token',
              '*.refresh_token',
              '*.id_token',
              '*.client_secret',
              '*.code',
              '*.codeVerifier',
              '*.csrfToken',
            ],
            censor: '[REDACTED]',
          },
          // Whitelist what is logged about a request. The query string is dropped because the OAuth
          // callback URL carries the authorization `code` and `state`; headers (cookies) are not logged.
          serializers: { req: serializeRequestForLog, res: serializeResponseForLog },
          transport:
            config.nodeEnv === 'development'
              ? {
                  target: 'pino-pretty',
                  options: { singleLine: true, colorize: true, translateTime: 'SYS:standard', ignore: 'pid,hostname' },
                }
              : undefined,
        },
      }),
    }),
    PrismaModule,
    SessionModule,
    MicrosoftModule,
    UsersModule,
    WorkspacesModule,
    StorageModule,
    CentralStorageModule,
    AuthModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
    { provide: APP_INTERCEPTOR, useClass: BigIntInterceptor },
  ],
})
export class AppModule {}
