// Hand-written viem ABI subset of contracts/evm/src/CovenantRegistry.sol used by the workflow.
export const CovenantRegistryABI = [
	{ type: 'function', name: 'seen', stateMutability: 'view', inputs: [{ name: '', type: 'bytes32' }], outputs: [{ name: '', type: 'bool' }] },
	{ type: 'function', name: 'isBreached', stateMutability: 'view', inputs: [{ name: '', type: 'uint64' }], outputs: [{ name: '', type: 'bool' }] },
	{ type: 'function', name: 'eventCount', stateMutability: 'view', inputs: [{ name: '', type: 'uint64' }], outputs: [{ name: '', type: 'uint256' }] },
] as const
