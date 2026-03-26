import { Logger, RequestMethod, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { json, static as expressStatic, urlencoded } from 'express';
import { mkdirSync } from 'fs';
import { join } from 'path';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule);
  const apiPrefix = 'api/v1';
  const parseInteger = (value: string, fallback: number) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
  };

  const resolveTrustProxy = (rawValue: string): boolean | number | string => {
    const normalized = rawValue.trim().toLowerCase();

    if (!normalized) return false;
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;

    const numericValue = Number(normalized);
    if (Number.isFinite(numericValue) && numericValue >= 0) {
      return Math.floor(numericValue);
    }

    return rawValue.trim();
  };

  const trustProxyRaw = String(process.env.TRUST_PROXY || process.env.TRUST_PROXY_HOPS || '1');
  const trustProxy = resolveTrustProxy(trustProxyRaw);
  const expressApp = app.getHttpAdapter().getInstance();
  expressApp.set('trust proxy', trustProxy);
  app.enableShutdownHooks();
  expressApp.disable('x-powered-by');
  logger.log(`Trust proxy configured: ${String(trustProxy)}`);

  const httpServer: any = app.getHttpServer();
  httpServer.keepAliveTimeout = parseInteger(
    String(process.env.HTTP_KEEP_ALIVE_TIMEOUT_MS || '65000'),
    65000,
  );
  httpServer.headersTimeout = parseInteger(
    String(process.env.HTTP_HEADERS_TIMEOUT_MS || '66000'),
    66000,
  );
  httpServer.requestTimeout = parseInteger(
    String(process.env.HTTP_REQUEST_TIMEOUT_MS || '120000'),
    120000,
  );

  app.setGlobalPrefix(apiPrefix, {
    exclude: [
      { path: 'share', method: RequestMethod.ALL },
      { path: 'share/*path', method: RequestMethod.ALL },
      { path: 'health', method: RequestMethod.ALL },
      { path: 'health/*path', method: RequestMethod.ALL },
    ],
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  app.use(json({ limit: '50mb' }));
  app.use(urlencoded({ extended: true, limit: '50mb' }));

  const uploadsDir = join(process.cwd(), 'uploads');
  mkdirSync(uploadsDir, { recursive: true });
  app.use('/uploads', expressStatic(uploadsDir));

  const normalizeOrigin = (origin: string) =>
    origin.trim().replace(/\/+$/, '').toLowerCase();

  const configuredOrigins = String(process.env.CORS_ORIGINS || '')
    .split(',')
    .map((origin) => normalizeOrigin(origin))
    .filter(Boolean);

  const defaultOrigins = [
    'http://localhost:8100',
    'http://localhost:4200',
    'http://localhost:4300',
    'https://admin.tinguilin.yaba-in.com',
    'https://tinguilin.yaba-in.com',
  ];

  const allowedOrigins = new Set(
    (configuredOrigins.length > 0 ? configuredOrigins : defaultOrigins).map((origin) =>
      normalizeOrigin(origin),
    ),
  );

  app.enableCors({
    origin: (origin, callback) => {
      if (!origin) {
        callback(null, true);
        return;
      }

      const normalizedOrigin = normalizeOrigin(origin);

      if (allowedOrigins.has(normalizedOrigin)) {
        callback(null, true);
        return;
      }

      logger.warn(`Blocked CORS origin: ${origin}`);
      callback(new Error('Not allowed by CORS'));
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'Accept',
      'Origin',
      'X-Requested-With',
    ],
    credentials: true,
    optionsSuccessStatus: 204,
    preflightContinue: false,
  });

  const appName = String(process.env.APP_NAME || 'Tingilin API').trim();
  const appUrl = String(process.env.APP_URL || '').trim().replace(/\/$/, '');
  const listenPort = parseInteger(
    String(process.env.PORT || process.env.APP_PORT || '3000'),
    3000,
  );

  const swaggerConfig = new DocumentBuilder()
    .setTitle(appName)
    .setDescription(
      [
        'Official API documentation for Tingilin.',
        '',
        'The API is grouped by public resources, authenticated user flows, administration endpoints, payments, sharing and operational tooling.',
        '',
        'Use the `Authorize` button with a valid `Bearer` token for protected routes.',
      ].join('\n'),
    )
    .setVersion(process.env.npm_package_version || '1.0.0')
    .addServer(
      appUrl
        ? `${appUrl}/${apiPrefix}`
        : `http://localhost:${listenPort}/${apiPrefix}`,
      appUrl ? 'Current environment' : 'Local development',
    )
    .addTag('System', 'Health-style endpoints and cross-module utilities.')
    .addTag('Authentication', 'Registration, login, token refresh and account bootstrap flows.')
    .addTag('Users', 'Authenticated user profile, stats and account history.')
    .addTag('Users Admin', 'Administrative user search, moderation and role management.')
    .addTag('Products', 'Public product catalogue endpoints.')
    .addTag('Products Admin', 'Administrative product management and media upload.')
    .addTag('Raffles', 'Public raffle browsing, winners and mixed raffle endpoints.')
    .addTag('Raffles Admin', 'Administrative raffle lifecycle, winner management and exports.')
    .addTag('Tickets', 'Authenticated user ticket access.')
    .addTag('Payments', 'Authenticated payment initiation and verification.')
    .addTag('Payments Admin', 'Administrative payment analytics and transaction management.')
    .addTag('Payments Webhooks', 'Provider callbacks consumed by the payments module.')
    .addTag('Notifications', 'Authenticated notification feeds and state updates.')
    .addTag('Share', 'Shareable landing pages and redirects.')
    .addTag('Audit', 'Administrative audit trail and monitoring endpoints.')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Paste the access token returned by the login flow.',
      },
      'access-token',
    )
    .addApiKey(
      {
        type: 'apiKey',
        in: 'header',
        name: 'x-digikuntz-signature',
        description: 'Signature header expected by Digikuntz webhooks.',
      },
      'digikuntz-signature',
    )
    .build();

  const swaggerDocument = SwaggerModule.createDocument(app, swaggerConfig, {
    deepScanRoutes: true,
    operationIdFactory: (controllerKey, methodKey) =>
      `${controllerKey.replace(/Controller$/, '')}_${methodKey}`,
  });

  SwaggerModule.setup('api-docs', app, swaggerDocument, {
    customSiteTitle: `${appName} Docs`,
    jsonDocumentUrl: 'api-docs/json',
    yamlDocumentUrl: 'api-docs/yaml',
    swaggerOptions: {
      persistAuthorization: true,
      displayRequestDuration: true,
      docExpansion: 'none',
      filter: true,
      operationsSorter: 'alpha',
      tagsSorter: 'alpha',
      defaultModelsExpandDepth: 2,
      defaultModelExpandDepth: 2,
    },
    customCss: `
      .swagger-ui .topbar { background: linear-gradient(135deg, #07111f 0%, #102544 100%); padding: 0.75rem 0; }
      .swagger-ui .topbar-wrapper img { display: none; }
      .swagger-ui .topbar-wrapper::before {
        content: '${appName}';
        color: #fff;
        font-size: 1.1rem;
        font-weight: 700;
        letter-spacing: 0.04em;
      }
      .swagger-ui .info { margin: 24px 0; }
      .swagger-ui .info .title { color: #102544; }
      .swagger-ui .scheme-container { background: #f7f9fc; box-shadow: none; border-radius: 14px; }
      .swagger-ui .opblock.opblock-post { border-color: #ee7f1d; background: rgba(238, 127, 29, 0.06); }
      .swagger-ui .opblock.opblock-get { border-color: #1c7ed6; background: rgba(28, 126, 214, 0.06); }
      .swagger-ui .opblock.opblock-patch { border-color: #2b8a3e; background: rgba(43, 138, 62, 0.06); }
      .swagger-ui .opblock.opblock-delete { border-color: #c92a2a; background: rgba(201, 42, 42, 0.06); }
      .swagger-ui .btn.authorize { border-color: #102544; color: #102544; }
      .swagger-ui .btn.authorize svg { fill: #102544; }
    `,
  });

  logger.log(
    `Swagger UI available at ${appUrl || `http://localhost:${listenPort}`}/api-docs`,
  );

  await app.listen(listenPort);
}
bootstrap();
