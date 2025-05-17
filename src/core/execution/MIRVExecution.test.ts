// Testing framework: Jest
import { describe, test, expect, jest } from '@jest/globals';
import { MIRVExecution } from './MIRVExecution';

describe('MIRVExecution – additional unit tests', () => {
  let mockPayload: { launch: jest.Mock; abort: jest.Mock; getStatus: jest.Mock };

  beforeEach(() => {
    mockPayload = {
      launch: jest.fn().mockReturnValue('launched'),
      abort: jest.fn(),
      getStatus: jest.fn().mockReturnValue('completed'),
    };
    jest.clearAllMocks();
  });

  test('constructor should throw if payloads array is empty or not provided', () => {
    expect(() => new MIRVExecution([])).toThrow('Payloads must be a non-empty array');
    expect(() => new MIRVExecution(null as any)).toThrow();
    expect(() => new MIRVExecution(undefined as any)).toThrow();
  });

  test('constructor should create an instance when given a valid payload array', () => {
    const exec = new MIRVExecution([mockPayload]);
    expect(exec).toBeInstanceOf(MIRVExecution);
  });

  test('execute should call launch on each payload and return an array of results', () => {
    const exec = new MIRVExecution([mockPayload, mockPayload]);
    const results = exec.execute();
    expect(mockPayload.launch).toHaveBeenCalledTimes(2);
    expect(results).toEqual(['launched', 'launched']);
  });

  test('abort should call abort on each payload', () => {
    const exec = new MIRVExecution([mockPayload]);
    exec.abort();
    expect(mockPayload.abort).toHaveBeenCalledTimes(1);
  });

  test('getStatus should call getStatus on each payload and return their statuses', () => {
    const exec = new MIRVExecution([mockPayload, mockPayload]);
    const statuses = exec.getStatus();
    expect(mockPayload.getStatus).toHaveBeenCalledTimes(2);
    expect(statuses).toEqual(['completed', 'completed']);
  });

  test('execute should throw TypeError when payload objects lack a launch method', () => {
    // @ts-ignore
    const badExec = new MIRVExecution([{}]);
    expect(() => badExec.execute()).toThrow(TypeError);
  });
});