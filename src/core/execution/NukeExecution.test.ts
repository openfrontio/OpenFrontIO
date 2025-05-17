import { NukeExecution } from './NukeExecution';

describe('NukeExecution.execute', () => {
  let mockCommandService: { run: jest.Mock };
  let execution: NukeExecution;

  beforeEach(() => {
    mockCommandService = { run: jest.fn() };
    execution = new NukeExecution(mockCommandService as any);
  });

  it('should return empty successes and failures when called with an empty array', async () => {
    const result = await execution.execute([]);
    expect(result.successes).toEqual([]);
    expect(result.failures).toEqual([]);
    expect(mockCommandService.run).not.toHaveBeenCalled();
  });

  it('should record a successful execution when commandService.run resolves with exitCode 0', async () => {
    mockCommandService.run.mockResolvedValue({ exitCode: 0, stdout: 'ok', stderr: '' });
    const result = await execution.execute(['target1']);
    expect(mockCommandService.run).toHaveBeenCalledWith('nuke target1', []);
    expect(result.successes).toEqual([{ target: 'target1', output: 'ok' }]);
    expect(result.failures).toEqual([]);
  });

  it('should record a failure when commandService.run resolves with a non-zero exitCode', async () => {
    mockCommandService.run.mockResolvedValue({ exitCode: 1, stdout: '', stderr: 'error' });
    const result = await execution.execute(['badTarget']);
    expect(result.successes).toEqual([]);
    expect(result.failures).toEqual([{ target: 'badTarget', error: 'error' }]);
  });

  it('should separate successes and failures for multiple targets', async () => {
    mockCommandService.run
      .mockResolvedValueOnce({ exitCode: 0, stdout: 'first-ok', stderr: '' })
      .mockResolvedValueOnce({ exitCode: 2, stdout: '', stderr: 'oops' });

    const result = await execution.execute(['first', 'second']);
    expect(result.successes).toEqual([{ target: 'first', output: 'first-ok' }]);
    expect(result.failures).toEqual([{ target: 'second', error: 'oops' }]);
  });

  it('should catch thrown exceptions from commandService.run and record them as failures', async () => {
    mockCommandService.run.mockRejectedValue(new Error('network down'));
    const result = await execution.execute(['targetX']);
    expect(result.successes).toEqual([]);
    expect(result.failures).toEqual([{ target: 'targetX', error: 'network down' }]);
  });

  it('should build the correct command string for a given target via the private helper', () => {
    // Access the private method via casting to any
    const cmd = (execution as any).buildCommand('my-target');
    expect(cmd).toBe('nuke my-target');
  });
});