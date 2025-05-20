// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title VPOP
 */
contract VPOP is Ownable {
    uint256 public platformFeeRate; // Fee rate in basis points (1% = 100)
    uint256 public creatorFeeRate; // Fee rate in basis points (1% = 100)
    uint256 public apeFeeRate; // Fee rate in basis points (1% = 100)

    struct Market {
        address creator;
        uint256 createdAt;
        // Market parameters
        address token;
        uint256 lowerBound;
        uint256 upperBound;
        uint8 decimals;
        uint256 minWager;
        uint256 decayFactor;
        uint256 commitDuration;
        uint256 revealDuration;
        uint8 percentile;
        string ipfsHash;
    }

    struct Commitment {
        bytes32 commitmentHash;
        uint256 wager;
        uint256 weight;
        uint256 timestamp;
        bool revealed;
        uint256 position;
        uint256 nonce;
    }


    // Mapping to store markets by their ID
    mapping(uint256 => Market) public markets;
    
    // Mapping to store commitments by market ID and user address
    mapping(uint256 => mapping(bytes32 => Commitment)) public commitments;
    // Counter to track the number of commitments for each market

    // // Counter for market IDs
    uint256 private _marketIdCounter;
    
    // Events
    event MarketCreated(
        uint256 indexed marketId, 
        address creator,
        address token,
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

    event CommitmentRevealed(
        uint256 indexed marketId,
        address indexed user,
        bytes32 commitmentHash,
        uint256 position,
        uint256 wager,
        uint256 nonce
    );


    constructor() payable Ownable(msg.sender) {
        _marketIdCounter = 0;
        platformFeeRate = 800; // 8% in basis points (1000 = 10%)
        creatorFeeRate = 200; // 2% in basis points (1000 = 10%)
        apeFeeRate = 200; // 2% in basis points (1000 = 10%)
    }

    /**
     * @dev Updates the fee rate. Only callable by the owner.
     * @param _newPlatformFeeRate The new fee rate in basis points (1% = 100)
     */
    function updatePlatformSettings(uint256 _newPlatformFeeRate, uint256 _newCreatorFeeRate, uint256 _newApeFeeRate) external onlyOwner {
        platformFeeRate = _newPlatformFeeRate;
        creatorFeeRate = _newCreatorFeeRate;
        apeFeeRate = _newApeFeeRate;
    }

    /**
     * @dev Initializes a new market with the given parameters
     * @param _lowerBound The lower bound of the market range
     * @param _upperBound The upper bound of the market range
     * @param _decimals The number of decimal places for the market
     * @param _minWager The minimum wager amount
     * @param _decayFactor The decay factor for the market
     * @param _commitDuration The duration of the commit phase in seconds
     * @param _revealDuration The duration of the reveal phase in seconds
     * @param _percentile The percentile value (0-100)
     * @param _ipfsHash The IPFS hash containing additional market data
     * @return marketId The ID of the newly created market
     */
    function initializeMarket(
        address _token,
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
        require(_lowerBound < _upperBound, "Lower bound must be less than upper bound");
        require(_decimals <= 18, "Decimals must be <= 18");
        require(_minWager > 0, "Minimum wager must be greater than 0");
        require(_decayFactor > 0, "Decay factor must be greater than 0");
        require(_commitDuration > 0, "Commit duration must be greater than 0");
        require(_revealDuration > 0, "Reveal duration must be greater than 0");
        require(_percentile <= 100, "Percentile must be <= 100");
        require(bytes(_ipfsHash).length > 0, "IPFS hash cannot be empty");

        // Get the next market ID and increment the counter
         _marketIdCounter++;
        marketId = _marketIdCounter;
       

        Market memory newMarket = Market({
            creator: msg.sender,
            createdAt: block.timestamp,
            token: _token,
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
            msg.sender,
            _token,
            _lowerBound,
            _upperBound,
            _percentile
        );
        
        return marketId;
    }

    /**
     * @dev Submit a commitment for a market
     * @param marketId The ID of the market to commit to
     * @param commitmentHash The hash of the commitment (position, nonce, wager)
     * @param wager The wager of the commitment
     */
    function commit(
        uint256 marketId,
        bytes32 commitmentHash,
        uint256 wager
    ) public payable {
        // Validate market exists and is active
        require(marketId <= _marketIdCounter && marketId > 0, "Market does not exist");
        
        Market storage market = markets[marketId];
        
        // Validate commitment phase is still open
        require(
            block.timestamp <= market.createdAt + market.commitDuration,
            "Commitment phase has ended"
        );

        // Validate weight is greater than minimum wager
        require(wager >= market.minWager, "Weight below minimum wager");
       
        // Calculate platform fee
        uint256 platformFee = (wager * platformFeeRate) / 10000;
        // Calculate creator fee
        uint256 creatorFee = (wager * creatorFeeRate) / 10000;
        
        // Check if the market uses native token or ERC20
        if (market.token == address(0)) {
            // For native token (ETH), ensure the sent value matches the wager
            require(msg.value >= wager, "Wager must equal transferred amount");
            // Transfer platform fee to platform owner
            (bool platformSuccess, ) = owner().call{value: platformFee}("");
            require(platformSuccess, "Platform fee transfer failed");
            
            // Transfer creator fee to market creator
            (bool creatorSuccess, ) = market.creator.call{value: creatorFee}("");
            require(creatorSuccess, "Creator fee transfer failed");

        } else {
            // Transfer ERC20 tokens from user to contract
            IERC20 token = IERC20(market.token);
            
            // Transfer tokens from user to contract, platform, and creator
            require(
                token.transferFrom(msg.sender, address(this), wager),
                "Token transfer failed - insufficient balance or allowance"
            );

            // Transfer fees to platform and creator from contract
            require(
                token.transfer(owner(), platformFee),
                "Platform fee transfer failed"
            );
            require(
                token.transfer(market.creator, creatorFee),
                "Creator fee transfer failed"
            );
        }

        // Calculate weight
        uint256 weight = wager * market.decayFactor * ((block.timestamp - market.createdAt) / market.commitDuration);
        
        // Store the commitment
        commitments[marketId][commitmentHash] = Commitment({
            commitmentHash: commitmentHash,
            wager: wager,
            weight: weight,
            timestamp: block.timestamp,
            revealed: false,
            position: 0, // Will be set during reveal
            nonce: 0    // Will be set during reveal
        });

        emit CommitmentCreated(
            marketId,
            msg.sender,
            commitmentHash,
            wager,
            weight
        );
    }

    /**
     * @dev Reveal a commitment by providing the original data
     * @param marketId The ID of the market
     * @param commitmentHash The hash of the commitment to reveal
     * @param position The original position value
     * @param wager The original wager amount
     * @param nonce The original nonce
     */
    function reveal(
        uint256 marketId,
        bytes32 commitmentHash,
        uint256 position,
        uint256 wager,
        uint256 nonce
    ) external {
        // Validate market exists
        require(marketId <= _marketIdCounter && marketId > 0, "Market does not exist");
        
        Market storage market = markets[marketId];
        
        // Validate reveal phase is active
        require(
            block.timestamp > market.createdAt + market.commitDuration &&
            block.timestamp <= market.createdAt + market.commitDuration + market.revealDuration,
            "Not in reveal phase"
        );

        // Get the commitment
        Commitment storage commitment = commitments[marketId][commitmentHash];
        
        // Verify commitment exists and hasn't been revealed
        require(commitment.commitmentHash == commitmentHash, "Commitment does not exist");
        require(!commitment.revealed, "Commitment already revealed");
        
        // Verify the revealed data matches the commitment hash
        bytes32 calculatedHash = keccak256(abi.encodePacked(position, wager, nonce));
        require(
            calculatedHash == commitmentHash,
            "Revealed data does not match commitment hash"
        );

        // Mark commitment as revealed
        commitment.revealed = true;

        emit CommitmentRevealed(
            marketId,
            msg.sender,
            commitmentHash,
            position,
            wager,
            nonce
        );
    }

    /**
     * @dev Returns the total number of markets
     */
    function getMarketCount() public view returns (uint256) {
        return _marketIdCounter;
    }

    /**
     * @dev Returns a a market by its ID
     * @param marketId The ID of the market to check
     */
    function getMarket(uint256 marketId) public view returns (Market memory) {
        return markets[marketId];
    }
}
