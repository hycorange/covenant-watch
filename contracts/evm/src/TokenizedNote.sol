// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

interface ICovenantRegistry {
    function isBreached(uint64 cik) external view returns (bool);
}

/**
 * @title TokenizedNote
 * @notice Minimal demo ERC-20-style note whose transfers halt while its issuer is flagged in breach by
 *         CovenantRegistry (an "event of default" circuit breaker driven by SEC filings via Chainlink CRE).
 */
contract TokenizedNote {
    string public name;
    string public constant symbol = "NOTE";
    uint8 public constant decimals = 18;
    uint64 public immutable issuerCik;
    ICovenantRegistry public immutable registry;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;

    event Transfer(address indexed from, address indexed to, uint256 value);

    error TransfersHalted(uint64 cik);
    error InsufficientBalance();

    constructor(string memory _name, uint64 _issuerCik, ICovenantRegistry _registry, uint256 supply) {
        name = _name;
        issuerCik = _issuerCik;
        registry = _registry;
        totalSupply = supply;
        balanceOf[msg.sender] = supply;
        emit Transfer(address(0), msg.sender, supply);
    }

    function transfersHalted() public view returns (bool) {
        return registry.isBreached(issuerCik);
    }

    function transfer(address to, uint256 value) external returns (bool) {
        if (transfersHalted()) revert TransfersHalted(issuerCik);
        if (balanceOf[msg.sender] < value) revert InsufficientBalance();
        balanceOf[msg.sender] -= value;
        balanceOf[to] += value;
        emit Transfer(msg.sender, to, value);
        return true;
    }
}
