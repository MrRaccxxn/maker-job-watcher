export const IJOB_ABI = [
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "network",
        "type": "bytes32"
      },
      {
        "internalType": "bytes",
        "name": "args",
        "type": "bytes"
      }
    ],
    "name": "work",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "network",
        "type": "bytes32"
      }
    ],
    "name": "workable",
    "outputs": [
      {
        "internalType": "bool",
        "name": "canWork",
        "type": "bool"
      },
      {
        "internalType": "bytes",
        "name": "args",
        "type": "bytes"
      }
    ],
    "stateMutability": "nonpayable",
    "type": "function"
  }
] as const;