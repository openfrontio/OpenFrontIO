import { createLobby, getContractAddress, getContractABI, type CreateLobbyParams } from '../../src/client/contract';
import { writeContract } from '@wagmi/core';
import { parseEther } from 'viem';

jest.mock('@wagmi/core', () => ({
  createConfig: jest.fn(() => ({ chains: [], transports: {} })),
  writeContract: jest.fn(),
  readContract: jest.fn(),
  http: jest.fn()
}));

jest.mock('@wagmi/core/chains', () => ({
  hardhat: { id: 31337 }
}));

describe('Contract Functions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getContractAddress', () => {
    it('should return the correct contract address', () => {
      const address = getContractAddress();
      expect(address).toBe('0x5FbDB2315678afecb367f032d93F642f64180aa3');
    });
  });

  describe('getContractABI', () => {
    it('should return contract ABI with createLobby function', () => {
      const abi = getContractABI();
      expect(abi).toBeDefined();
      
      const createLobbyFunction = abi.find(item => 
        item.type === 'function' && item.name === 'createLobby'
      );
      
      expect(createLobbyFunction).toBeDefined();
      expect(createLobbyFunction?.inputs).toHaveLength(2);
      expect(createLobbyFunction?.inputs?.[0].name).toBe('lobbyId');
      expect(createLobbyFunction?.inputs?.[1].name).toBe('betAmount');
    });
  });

  describe('createLobby', () => {
    const mockWriteContract = writeContract as jest.MockedFunction<typeof writeContract>;

    beforeEach(() => {
      mockWriteContract.mockResolvedValue('0x1234567890abcdef' as any);
    });

    it('should create a lobby with valid parameters', async () => {
      const params: CreateLobbyParams = {
        lobbyId: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        betAmount: '1.0'
      };

      const result = await createLobby(params);

      expect(result).toEqual({
        hash: '0x1234567890abcdef',
        lobbyId: params.lobbyId,
        betAmount: params.betAmount
      });

      expect(mockWriteContract).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          address: '0x5FbDB2315678afecb367f032d93F642f64180aa3',
          abi: expect.any(Array),
          functionName: 'createLobby',
          args: [params.lobbyId, parseEther(params.betAmount)],
          value: parseEther(params.betAmount)
        })
      );
    });

    it('should handle different bet amounts correctly', async () => {
      const testCases = [
        { betAmount: '0.1', expectedWei: parseEther('0.1') },
        { betAmount: '0.5', expectedWei: parseEther('0.5') },
        { betAmount: '2.0', expectedWei: parseEther('2.0') },
        { betAmount: '10', expectedWei: parseEther('10') }
      ];

      for (const testCase of testCases) {
        const params: CreateLobbyParams = {
          lobbyId: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
          betAmount: testCase.betAmount
        };

        await createLobby(params);

        expect(mockWriteContract).toHaveBeenCalledWith(
          expect.anything(),
          expect.objectContaining({
            args: [params.lobbyId, testCase.expectedWei],
            value: testCase.expectedWei
          })
        );
      }
    });

    it('should handle contract write errors', async () => {
      const params: CreateLobbyParams = {
        lobbyId: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        betAmount: '1.0'
      };

      const error = new Error('Contract execution failed');
      mockWriteContract.mockRejectedValue(error);

      await expect(createLobby(params)).rejects.toThrow('Contract execution failed');
    });

    it('should pass correct contract configuration', async () => {
      const params: CreateLobbyParams = {
        lobbyId: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        betAmount: '1.0'
      };

      await createLobby(params);

      const callArgs = mockWriteContract.mock.calls[0];
      const contractCall = callArgs[1];

      expect(contractCall.address).toBe('0x5FbDB2315678afecb367f032d93F642f64180aa3');
      expect(contractCall.functionName).toBe('createLobby');
      expect(contractCall.abi).toBeDefined();
    });

    it('should handle zero bet amount edge case', async () => {
      const params: CreateLobbyParams = {
        lobbyId: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        betAmount: '0'
      };

      await createLobby(params);

      expect(mockWriteContract).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          args: [params.lobbyId, parseEther('0')],
          value: parseEther('0')
        })
      );
    });

    it('should preserve lobby ID in result', async () => {
      const uniqueLobbyId = '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef';
      const params: CreateLobbyParams = {
        lobbyId: uniqueLobbyId,
        betAmount: '1.5'
      };

      const result = await createLobby(params);

      expect(result.lobbyId).toBe(uniqueLobbyId);
      expect(result.betAmount).toBe('1.5');
    });
  });
});