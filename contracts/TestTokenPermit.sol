// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";

contract TestTokenPermit is ERC20, ERC20Permit {
    constructor() ERC20("Test Token Permit", "TESTP") ERC20Permit("Test Token Permit") {}

    function mint(address to, uint256 amount) public {
        _mint(to, amount);
    }
}