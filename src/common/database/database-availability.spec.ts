import { ArgumentsHost, BadRequestException } from '@nestjs/common';
import {
  DatabaseAvailabilityFilter,
  isDatabaseAvailabilityError,
} from './database-availability';

const namedError = (name: string, message = 'boom') => {
  const error = new Error(message);
  error.name = name;
  return error;
};

describe('database availability', () => {
  it.each([
    'MongoWaitQueueTimeoutError',
    'MongoNetworkError',
    'MongoNetworkTimeoutError',
    'MongoServerSelectionError',
    'MongoPoolClearedError',
    'MongooseServerSelectionError',
  ])('treats %s as a temporary database outage', (name) => {
    expect(isDatabaseAvailabilityError(namedError(name))).toBe(true);
  });

  it('treats a mongoose buffering timeout as an outage', () => {
    expect(
      isDatabaseAvailabilityError(
        namedError(
          'MongooseError',
          'Operation `users.findOne()` buffering timed out after 10000ms',
        ),
      ),
    ).toBe(true);
  });

  it('does not hide business database errors (duplicate key, validation, cast)', () => {
    expect(isDatabaseAvailabilityError(namedError('MongoServerError'))).toBe(false);
    expect(isDatabaseAvailabilityError(namedError('ValidationError'))).toBe(false);
    expect(isDatabaseAvailabilityError(namedError('CastError'))).toBe(false);
    expect(isDatabaseAvailabilityError(null)).toBe(false);
  });

  it('answers 503 with Retry-After and no internal detail', () => {
    const response = {
      setHeader: jest.fn(),
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    const host = {
      getType: () => 'http',
      switchToHttp: () => ({ getResponse: () => response }),
    } as unknown as ArgumentsHost;

    new DatabaseAvailabilityFilter().catch(
      namedError(
        'MongoWaitQueueTimeoutError',
        'Timed out while checking out a connection from connection pool',
      ),
      host,
    );

    expect(response.setHeader).toHaveBeenCalledWith('Retry-After', '2');
    expect(response.status).toHaveBeenCalledWith(503);
    const body = response.json.mock.calls[0][0];
    expect(body.statusCode).toBe(503);
    expect(JSON.stringify(body)).not.toMatch(/pool|Mongo/i);
  });

  it('delegates HTTP exceptions to the default Nest handling', () => {
    const filter = new DatabaseAvailabilityFilter();
    const fallback = jest
      .spyOn(Object.getPrototypeOf(DatabaseAvailabilityFilter.prototype), 'catch')
      .mockImplementation(() => undefined);
    const host = { getType: () => 'http' } as unknown as ArgumentsHost;
    const exception = new BadRequestException('nope');

    filter.catch(exception, host);

    expect(fallback).toHaveBeenCalledWith(exception, host);
    fallback.mockRestore();
  });
});
