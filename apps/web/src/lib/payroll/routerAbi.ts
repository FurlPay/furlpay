import { parseAbi } from "viem";
// FurlPayRouter and ERC-20 fragments used by payroll execution (client and server). Pure: no server imports.
export const ROUTER_ABI = parseAbi([
  "event PaymentExecuted(string paymentId, address indexed payer, address indexed recipient, uint256 amount, uint256 fee, bytes32 nonce)",
  "function batchPay((string paymentId, address recipient, uint256 amount, uint256 fee, bytes32 nonce, uint256 deadline)[] ps, address[] payers, bytes[] signatures)",
]);
export const ERC20_ABI = parseAbi([
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function balanceOf(address owner) view returns (uint256)",
]);
