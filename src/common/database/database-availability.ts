import {
  ArgumentsHost,
  Catch,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';

/**
 * Erreurs signifiant "la base est momentanement indisponible ou saturee"
 * (pool de connexions epuise, timeout, reseau, election de primaire...).
 * Elles ne disent rien de la validite de la requete: le client doit reessayer.
 * Les erreurs metier Mongo (cle dupliquee, validation...) n'en font PAS partie.
 */
const DATABASE_AVAILABILITY_ERRORS = new Set([
  'MongoWaitQueueTimeoutError',
  'MongoPoolClearedError',
  'MongoNetworkError',
  'MongoNetworkTimeoutError',
  'MongoServerSelectionError',
  'MongoNotConnectedError',
  'MongoTopologyClosedError',
  'MongooseServerSelectionError',
]);

export function isDatabaseAvailabilityError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const { name, message } = error as { name?: unknown; message?: unknown };
  if (typeof name !== 'string') return false;
  if (DATABASE_AVAILABILITY_ERRORS.has(name)) return true;
  // Mongoose: "Operation `x.findOne()` buffering timed out after 10000ms"
  if (typeof message !== 'string') return false;
  return name === 'MongooseError' && /buffering timed out/i.test(message);
}

/**
 * Transforme une indisponibilite de la base en 503 + Retry-After, au lieu
 * d'un 500 generique. Sans detail interne dans la reponse (AGENTS.md).
 */
@Catch()
export class DatabaseAvailabilityFilter extends BaseExceptionFilter {
  private readonly availabilityLogger = new Logger('DatabaseAvailability');
  private lastLogAt = 0;

  catch(exception: unknown, host: ArgumentsHost) {
    if (
      exception instanceof HttpException ||
      !isDatabaseAvailabilityError(exception) ||
      host.getType() !== 'http'
    ) {
      return super.catch(exception, host);
    }

    // Log echantillonne: pendant un pic, des milliers de lignes identiques
    // ralentiraient encore plus le processus.
    const now = Date.now();
    if (now - this.lastLogAt > 5_000) {
      this.lastLogAt = now;
      this.availabilityLogger.warn(
        `Database unavailable or saturated: ${String((exception as Error).name)}`,
      );
    }

    const response = host.switchToHttp().getResponse();
    response.setHeader('Retry-After', '2');
    response.status(HttpStatus.SERVICE_UNAVAILABLE).json({
      statusCode: HttpStatus.SERVICE_UNAVAILABLE,
      message: 'Service temporarily unavailable, please retry',
      error: 'Service Unavailable',
    });
  }
}
