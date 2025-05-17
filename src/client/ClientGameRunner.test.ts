import WebSocket from 'ws';
import { ClientGameRunner } from './ClientGameRunner';

jest.mock('ws');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('ClientGameRunner', () => {
  describe('constructor', () => {
    it('should throw an error if URL is missing or invalid', () => {
      expect(() => new ClientGameRunner('')).toThrow(/Invalid URL/);
      expect(() => new ClientGameRunner(null as any)).toThrow();
    });

    it('should create an instance with default settings for a valid URL', () => {
      const runner = new ClientGameRunner('ws://localhost');
      expect(runner).toBeInstanceOf(ClientGameRunner);
    });
  });

  describe('start', () => {
    let mockSend: jest.Mock;
    let mockClose: jest.Mock;
    let runner: ClientGameRunner;

    beforeEach(() => {
      mockSend = jest.fn();
      mockClose = jest.fn();
      (WebSocket as unknown as jest.Mock).mockImplementation(() => ({
        send: mockSend,
        close: mockClose,
        on: jest.fn((event, cb) => {
          /* capture in individual tests if needed */
        }),
      }));
      runner = new ClientGameRunner('ws://localhost');
    });

    it('should initialize the connection when start is called', () => {
      runner.start();
      expect(WebSocket).toHaveBeenCalledWith('ws://localhost');
    });

    it('should throw an error if start is called twice', () => {
      runner.start();
      expect(() => runner.start()).toThrow(/already started/);
    });
  });

  describe('sendMove', () => {
    let mockSend: jest.Mock;
    let runner: ClientGameRunner;

    beforeEach(() => {
      mockSend = jest.fn();
      (WebSocket as unknown as jest.Mock).mockImplementation(() => ({
        send: mockSend,
        close: jest.fn(),
        on: jest.fn(),
      }));
      runner = new ClientGameRunner('ws://localhost');
    });

    it('should throw an error if sendMove is called before start', () => {
      expect(() => runner.sendMove({ x: 1, y: 2 })).toThrow(/Connection not established/);
    });

    it('should send the correct payload when a move is valid', () => {
      runner.start();
      const move = { x: 3, y: 4 };
      runner.sendMove(move);
      expect(mockSend).toHaveBeenCalledWith(JSON.stringify({ type: 'move', payload: move }));
    });

    it('should throw an error for malformed move', () => {
      runner.start();
      expect(() => runner.sendMove(null as any)).toThrow(/Invalid move/);
    });
  });

  describe('stop', () => {
    let mockClose: jest.Mock;
    let runner: ClientGameRunner;

    beforeEach(() => {
      mockClose = jest.fn();
      (WebSocket as unknown as jest.Mock).mockImplementation(() => ({
        send: jest.fn(),
        close: mockClose,
        on: jest.fn(),
      }));
      runner = new ClientGameRunner('ws://localhost');
    });

    it('should close the connection when stop is called after start', () => {
      runner.start();
      runner.stop();
      expect(mockClose).toHaveBeenCalled();
    });

    it('should not throw if stop is called before start', () => {
      expect(() => runner.stop()).not.toThrow();
    });
  });

  describe('message handling', () => {
    let messageCallback: (data: WebSocket.Data) => void;
    let runner: ClientGameRunner;

    beforeEach(() => {
      messageCallback = () => {};
      (WebSocket as unknown as jest.Mock).mockImplementation(() => ({
        send: jest.fn(),
        close: jest.fn(),
        on: jest.fn((event, cb) => {
          if (event === 'message') {
            messageCallback = cb as any;
          }
        }),
      }));
      runner = new ClientGameRunner('ws://localhost');
      runner.start();
    });

    it('should invoke the onMessage handler when a message is received', () => {
      const handler = jest.fn();
      runner.onMessage(handler);
      const testData = JSON.stringify({ type: 'update', payload: { state: 'running' } });
      messageCallback(testData);
      expect(handler).toHaveBeenCalledWith({ type: 'update', payload: { state: 'running' } });
    });
  });

  describe('end-to-end session', () => {
    it('should start, send move, receive message, and stop correctly', () => {
      const mockSend = jest.fn();
      const mockClose = jest.fn();
      let messageCallback: (data: WebSocket.Data) => void;
      (WebSocket as unknown as jest.Mock).mockImplementation(() => ({
        send: mockSend,
        close: mockClose,
        on: jest.fn((event, cb) => {
          if (event === 'message') {
            messageCallback = cb as any;
          }
        }),
      }));

      const runner = new ClientGameRunner('ws://localhost');
      const messages: any[] = [];
      runner.onMessage(msg => messages.push(msg));

      runner.start();
      const move = { x: 5, y: 6 };
      runner.sendMove(move);
      expect(mockSend).toHaveBeenCalledWith(JSON.stringify({ type: 'move', payload: move }));

      const serverMsg = JSON.stringify({ type: 'end', payload: { result: 'win' } });
      messageCallback!(serverMsg);
      expect(messages).toContainEqual({ type: 'end', payload: { result: 'win' } });

      runner.stop();
      expect(mockClose).toHaveBeenCalled();
    });
  });
});