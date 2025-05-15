// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title VPOP
 */
contract VPOP is Ownable {
    uint public unlockTime;

    struct Market {
        // string title;
        // string description;
        address creator;
        uint256 createdAt;
        // bool isActive;
        // Market parameters
        uint256 lowerBound;
        uint256 upperBound;
        uint8 decimals;
        uint256 minWager;
        uint256 decayFactor;
        uint256 commitDuration;
        uint256 revealDuration;
        uint8 percentile;
        // uint256 nonce;
        string ipfsHash;
    }

    struct Commitment {
        bytes32 commitmentHash;
        uint256 wager;
        uint256 weight;
        uint256 timestamp;
        bool revealed;
    }


    // Mapping to store markets by their ID
    mapping(uint256 => Market) public markets;
    
    // Mapping to store commitments by market ID and user address
    mapping(uint256 => mapping(address => Commitment)) public commitments;
    
    // // Counter for market IDs
    uint256 private _marketIdCounter;
    
    // Events
    event MarketCreated(
        uint256 indexed marketId, 
        string title, 
        address creator,
        uint256 lowerBound,
        uint256 upperBound,
        uint8 percentile
    );
    event CommitmentCreated(
        uint256 indexed marketId,
        address indexed user,
        bytes32 commitmentHash,
        uint256 wager,
        uint256 weight
    );

    constructor() payable Ownable(msg.sender) {
        _marketIdCounter = 1;
    }

    // /**
    //  * @dev Initializes a new market with the given parameters
    //  * @param _lowerBound The lower bound of the market range
    //  * @param _upperBound The upper bound of the market range
    //  * @param _decimals The number of decimal places for the market
    //  * @param _minWager The minimum wager amount
    //  * @param _decayFactor The decay factor for the market
    //  * @param _commitDuration The duration of the commit phase in seconds
    //  * @param _revealDuration The duration of the reveal phase in seconds
    //  * @param _percentile The percentile value (0-100)
    //  * @param _ipfsHash The IPFS hash containing additional market data
    //  * @return marketId The ID of the newly created market
    //  */
    function initializeMarket(
        string memory _title,
        string memory _description,
        uint256 _lowerBound,
        uint256 _upperBound,
        uint8 _decimals,
        uint256 _minWager,
        uint8 _decayFactor,
        uint256 _commitDuration,
        uint256 _revealDuration,
        uint8 _percentile,
        string memory _ipfsHash
    ) public returns (uint256 marketId) {
        // Input validation
        require(bytes(_title).length > 0, "Title cannot be empty");
        require(bytes(_description).length > 0, "Description cannot be empty");
        require(_lowerBound < _upperBound, "Lower bound must be less than upper bound");
        require(_decimals <= 18, "Decimals must be <= 18");
        require(_minWager > 0, "Minimum wager must be greater than 0");
        require(_decayFactor > 0, "Decay factor must be greater than 0");
        require(_commitDuration > 0, "Commit duration must be greater than 0");
        require(_revealDuration > 0, "Reveal duration must be greater than 0");
        require(_percentile <= 100, "Percentile must be <= 100");
        require(bytes(_ipfsHash).length > 0, "IPFS hash cannot be empty");

        // Get the next market ID and increment the counter
        marketId = _marketIdCounter;
        _marketIdCounter++;

        Market memory newMarket = Market({
            creator: msg.sender,
            createdAt: block.timestamp,
            lowerBound: _lowerBound,
            upperBound: _upperBound,
            decimals: _decimals,
            minWager: _minWager,
            decayFactor: _decayFactor,
            commitDuration: _commitDuration,
            revealDuration: _revealDuration,
            percentile: _percentile,
            ipfsHash: _ipfsHash
        });

        // Store the market in the mapping
        markets[marketId] = newMarket;

        emit MarketCreated(
            marketId,
            _title,
            msg.sender,
            _lowerBound,
            _upperBound,
            _percentile
        );
        
        return marketId;
    }

    /**
     * @dev Submit a commitment for a market
     * @param marketId The ID of the market to commit to
     * @param commitment The commitment bytes array
     * @param wager The wager of the commitment
     */
    function commit(
        uint256 marketId,
        bytes[] memory commitment,
        uint256 wager
    ) public {
        // Validate market exists and is active
        require(marketId <= getMarketCount() && marketId > 0, "Market does not exist");
        
        Market storage market = markets[marketId];
        
        // Validate commitment phase is still open
        require(
            block.timestamp <= market.createdAt + market.commitDuration,
            "Commitment phase has ended"
        );

        // Validate weight is greater than minimum wager
        require(wager >= market.minWager, "Weight below minimum wager");

        // Create commitment hash from the bytes array
        bytes32 commitmentHash = keccak256(abi.encode(commitment));
        uint256 weight = wager * market.decayFactor* ((block.timestamp - market.createdAt) / market.commitDuration);
        // Store the commitment
        commitments[marketId][msg.sender] = Commitment({
            commitmentHash: commitmentHash,
            wager: wager,
            weight: weight,
            timestamp: block.timestamp,
            revealed: false
        });

        emit CommitmentCreated(
            marketId,
            msg.sender,
            commitmentHash,
            wager,
            weight
        );
    }

    // /**
    //  * @dev Check if a market exists
    //  * @param marketId The ID of the market to check
    //  */
    // function marketExists(uint256 marketId) public view returns (bool) {
    //     return marketId < _marketIdCounter;
    // }

    /**
     * @dev Returns the total number of markets
     */
    function getMarketCount() public view returns (uint256) {
        return _marketIdCounter;
    }

    // /**
    //  * @dev Returns a a market by its ID
    //  * @param marketId The ID of the market to check
    //  */
    // function getMarket(uint256 marketId) public view returns (Market memory) {
    //     return markets[marketId];
    // }
}
