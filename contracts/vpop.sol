// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";

/**
 * @title VPOP
 */
contract VPOP is Ownable {
    using SafeERC20 for IERC20;
    uint256 public platformFeeRate; // Fee rate in basis points (1% = 100)
    uint256 public creatorFeeRate; // Fee rate in basis points (1% = 100)
    uint256 public apeFeeRate; // Fee rate in basis points (1% = 100)
    uint256 public marketCreateFee; // Fee rate in basis points (1% = 100)
    address public apeOwner = 0x5AC40A1175715F1c27e3FEAa8C79664040717679; // Address that receives ape fees
    bool private allowPublicMarkets;
    
    struct Market {
        address creator;
        uint256 createdAt;
        uint256 creationBlock;
        // Market parameters
        address token;
        uint256 lowerBound;
        uint256 upperBound;
        uint8 decimals;
        uint256 minWager;
        uint256 decayFactor;
        uint256 commitDuration;
        uint256 revealDuration;
        uint16 winningPercentile;
        string ipfsHash;
    }

    struct MarketConsensus {
        uint256 totalWagers;
        uint256 totalWinnings;
        // Market consensus tracking
        uint256 totalWeight;
        uint256 weightedSum;
        // Market status
        bool resolved;
        // Commitment tracking
        uint256 totalCommitments;
        uint256 revealedCommitments;
        // Resolution data
        uint256 winningThreshold;
        uint256 consensusPosition;
        uint256 winningWagers; // Sum of wagers for winning positions
        uint256 winningCommitments; // Count of winning positions
    }

    struct Commitment {
        uint128 wager;        // 16 bytes
        uint128 weight;       // 16 bytes
        uint64 timestamp;     // 8 bytes (seconds since epoch)
        uint64 position;      // 8 bytes (market position)
        uint64 nonce;         // 8 bytes (user-supplied entropy)
        bytes32 commitmentHash; // 32 bytes
        bool revealed;        // 1 byte
        bool claimed;         // 1 byte
        address owner;        // 20 bytes
    }

    // Mapping to store markets by their ID
    mapping(uint256 => Market) public markets;
    mapping(uint256 => MarketConsensus) public marketConsensus;
    mapping(uint256 => bytes32) public whitelistRoots;
    mapping(uint256 => mapping(address => bool)) public whitelistCommits;

    // Mapping to store commitments by market ID and sequential commitment ID
    mapping(uint256 => mapping(uint256 => Commitment)) public commitments;

    // Counter for market IDs
    uint256 private _marketIdCounter;
    
    // Events
    event MarketCreated(
        uint256 indexed marketId, 
        address creator,
        address token,
        uint256 lowerBound,
        uint256 upperBound,
        uint16 winningPercentile
    );

    event CommitmentCreated(
        uint256 indexed marketId,
        address indexed user,
        uint256 commitmentId,
        bytes32 commitmentHash,
        uint256 wager,
        uint256 weight
    );

    event CommitmentRevealed(
        uint256 indexed marketId,
        address indexed user,
        uint256 commitmentId,
        bytes32 commitmentHash,
        uint256 position,
        uint256 wager,
        uint256 nonce
    );

    event WinningsClaimed(
        uint256 indexed marketId,
        address indexed user,
        uint256 commitmentId,
        uint256 amount
    );

    constructor() payable Ownable(msg.sender) {
        _marketIdCounter = 0;
        platformFeeRate = 800; // 8% in basis points (1000 = 10%)
        creatorFeeRate = 200; // 2% in basis points (1000 = 10%)
        apeFeeRate = 200; // 2% in basis points (1000 = 10%)
        marketCreateFee = 0; //lets start with 0
        allowPublicMarkets = true;
    }

    /**
     * @dev Updates the fee rate. Only callable by the owner.
     * @param _platformFeeRate The new fee rate in basis points (1% = 100)
     * @param _creatorFeeRate The new fee rate in basis points (1% = 100)
     * @param _apeFeeRate The new fee rate in basis points (1% = 100)
     */
    function updatePlatformSettings(uint256 _platformFeeRate, uint256 _creatorFeeRate, uint256 _apeFeeRate, uint256 _marketCreateFee, bool _allowPublicMarkets) external onlyOwner {
        platformFeeRate = _platformFeeRate;
        creatorFeeRate = _creatorFeeRate;
        apeFeeRate = _apeFeeRate;
        marketCreateFee = _marketCreateFee;
        allowPublicMarkets = _allowPublicMarkets;
    }

    function updateWhitelistRoot(uint256 marketId, bytes32 whitelistRoot) external onlyOwner {
        whitelistRoots[marketId] = whitelistRoot;
    }


    function addWinnings(uint256 marketId, uint256 additionalWinnings) external payable {
        Market storage market = markets[marketId];
        
        if (market.token != address(0)) {
            // ERC20 token transfer
            IERC20(market.token).safeTransferFrom(msg.sender, address(this), additionalWinnings);
        } else {
            // ETH transfer
            require(msg.value == additionalWinnings, "Sent value must match additional winnings");
        }
        
        marketConsensus[marketId].totalWinnings += additionalWinnings;
    }

    /**
     * @dev Initializes a new market with the given parameters
     * @param _token The token address for the market
     * @param _lowerBound The lower bound of the market range
     * @param _upperBound The upper bound of the market range
     * @param _decimals The number of decimal places for the market
     * @param _minWager The minimum wager amount
     * @param _decayFactor The decay factor for the market
     * @param _commitDuration The duration of the commit phase in seconds
     * @param _revealDuration The duration of the reveal phase in seconds
     * @param _winningPercentile The winningPercentile value (0-10000)
     * @param _ipfsHash The IPFS hash containing additional market data
     * @return marketId The ID of the newly created market
     */
    function initializeMarket(
        address _token,
        uint256 _lowerBound,
        uint256 _upperBound,
        uint8 _decimals,
        uint256 _minWager,
        uint16 _decayFactor,
        uint256 _commitDuration,
        uint256 _revealDuration,
        uint16 _winningPercentile,
        string memory _ipfsHash
    ) public payable returns (uint256 marketId) {        
        // Input validation
        require(allowPublicMarkets == true || msg.sender == owner(), "Only owner can create markets");
        require(_lowerBound < _upperBound, "Lower bound must be less than upper bound");
        require(_decimals <= 18, "Decimals must be <= 18");
        require(_minWager >= 0, "Minimum wager must be greater than 0");
        require(_decayFactor <= 10000, "Decay factor must be <= 10000 (100%)");
        require(_commitDuration > 0, "Commit duration must be greater than 0");
        require(_revealDuration > 0, "Reveal duration must be greater than 0");
        require(_winningPercentile <= 10000, "Winning Percentile must be <= 10000 (100%)");
        require(bytes(_ipfsHash).length > 0, "IPFS hash cannot be empty");

        if(marketCreateFee > 0){
            require(msg.value >= marketCreateFee, "Market create fee not met");
            (bool success, ) = owner().call{value: marketCreateFee}("");
            require(success, "Market create fee transfer failed");
        }
        
        // Get the next market ID and increment the counter
         _marketIdCounter++;
        marketId = _marketIdCounter;

        Market memory newMarket = Market({
            creator: msg.sender,
            createdAt: block.timestamp,
            creationBlock: block.number,
            token: _token,
            lowerBound: _lowerBound,
            upperBound: _upperBound,
            decimals: _decimals,
            minWager: _minWager,
            decayFactor: _decayFactor,
            commitDuration: _commitDuration,
            revealDuration: _revealDuration,
            winningPercentile: _winningPercentile,
            ipfsHash: _ipfsHash
        });

        MarketConsensus memory newMarketConsensus = MarketConsensus({
            totalWagers: 0,
            totalWinnings: 0,
            totalWeight: 0,
            weightedSum: 0,
            resolved: false,
            totalCommitments: 0,
            revealedCommitments: 0,
            winningThreshold: 0,
            consensusPosition: 0,
            winningWagers: 0,
            winningCommitments: 0
        });

        // Store the market in the mapping
        markets[marketId] = newMarket;
        marketConsensus[marketId] = newMarketConsensus;
        emit MarketCreated(
            marketId,
            msg.sender,
            _token,
            _lowerBound,
            _upperBound,
            _winningPercentile
        );
        
        return marketId;
    }

    /**
     * @dev Submit a commitment for a market
     * @param marketId The ID of the market to commit to
     * @param commitmentHash The hash of the commitment (position, nonce, wager)
     * @param wager The wager of the commitment
     * @param proof The Merkle proof for whitelist verification
     */
    function commit(
        uint256 marketId,
        bytes32 commitmentHash,
        uint128 wager,
        bytes32[] calldata proof
    ) public payable {
        // Validate market exists and is active
        require(marketId <= _marketIdCounter && marketId > 0, "Market does not exist");
        
        Market storage market = markets[marketId];
        
        // Validate commitment phase is still open
        require(
            block.timestamp <= market.createdAt + market.commitDuration,
            "Commitment phase has ended"
        );

        // Validate wager is greater than minimum wager
        require(wager >= market.minWager, "Wager below minimum wager");
        
        if (whitelistRoots[marketId] != bytes32(0)) {   
            // whitelisted market      
            require(whitelistCommits[marketId][msg.sender] == false, "Address already used in this market");
            // require(verifyWhitelist(marketId, msg.sender, proof), "Address not whitelisted");
            bool verified = MerkleProof.verify(proof, whitelistRoots[marketId], keccak256(abi.encodePacked(msg.sender)));
            require(verified, "Address not whitelisted");
            whitelistCommits[marketId][msg.sender] = true;
            wager = 100000;
        } else {
            //normal market
            // Calculate platform fee
            uint256 platformFee = Math.mulDiv(uint256(wager), platformFeeRate, 10000);
            // Calculate creator fee
            uint256 creatorFee = Math.mulDiv(uint256(wager), creatorFeeRate, 10000);
            // Calculate ape fee
            uint256 apeFee = Math.mulDiv(uint256(wager), apeFeeRate, 10000);
            // Add to the pot 
            uint256 winnings = uint256(wager) - platformFee - creatorFee - apeFee;
            marketConsensus[marketId].totalWinnings += winnings;

            // Check if the market uses native token or ERC20
            if (market.token == address(0)) {
                // For native token (ETH), ensure the sent value matches the wager
                require(msg.value >= uint256(wager), "Wager must equal transferred amount");
                // Transfer platform fee to platform owner
                (bool platformSuccess, ) = owner().call{value: platformFee}("");
                require(platformSuccess, "Platform fee transfer failed");
                
                // Transfer creator fee to market creator
                (bool creatorSuccess, ) = market.creator.call{value: creatorFee}("");
                require(creatorSuccess, "Creator fee transfer failed");

                // Transfer ape fee to ape owner
                (bool apeSuccess, ) = apeOwner.call{value: apeFee}("");
                require(apeSuccess, "Ape fee transfer failed");

            } else {
                // Transfer ERC20 tokens from user to contract
                IERC20 token = IERC20(market.token);
                
                // Transfer tokens from user to contract, platform, and creator using SafeERC20
                token.safeTransferFrom(msg.sender, address(this), uint256(wager));

                // Transfer fees to platform and creator from contract using SafeERC20
                token.safeTransfer(owner(), platformFee);
                token.safeTransfer(market.creator, creatorFee);
                token.safeTransfer(apeOwner, apeFee);
            }
        }
        marketConsensus[marketId].totalWagers += uint256(wager);

        // Calculate weight using linear decay: weight = wager * (1 - decayFactor * elapsed / commitDuration)
        // decay is scaled by 1e4 (basis points) so the result keeps precision
        uint256 elapsed = block.timestamp - market.createdAt;
        uint256 decay = Math.mulDiv(market.decayFactor, elapsed, market.commitDuration); // 0-10000
        uint128 weight = uint128(wager * (10000 - decay) / 10000);
        if (weight == 0) weight = 1;
        // Increment total commitments counter
        marketConsensus[marketId].totalCommitments++;
        // Get the next commitment ID
        uint256 commitmentId = marketConsensus[marketId].totalCommitments;
        
        // Store the commitment
        commitments[marketId][commitmentId] = Commitment({
            wager: wager,
            weight: weight,
            timestamp: uint64(block.timestamp),
            position: 0, // Will be set during reveal
            nonce: 0,    // Will be set during reveal
            commitmentHash: commitmentHash,
            revealed: false,
            claimed: false,
            owner: msg.sender
        });

        emit CommitmentCreated(
            marketId,
            msg.sender,
            commitmentId,
            commitmentHash,
            uint256(wager),
            uint256(weight)
        );
    }

    /**
     * @dev Reveal a commitment by providing the original data
     * @param marketId The ID of the market
     * @param commitmentId The ID of the commitment to reveal
     * @param commitmentHash The hash of the commitment to reveal
     * @param position The original position value
     * @param nonce The original nonce
     */
    function reveal(
        uint256 marketId,
        uint256 commitmentId,
        bytes32 commitmentHash,
        uint64 position,
        uint64 nonce
    ) external {
        // Validate market exists
        require(marketId <= _marketIdCounter && marketId > 0, "Market does not exist");
        
        Market storage market = markets[marketId];
        require(position >= market.lowerBound && position <= market.upperBound, "Position out of bounds");

        // Validate reveal phase is active
        require(
            block.timestamp > market.createdAt + market.commitDuration &&
            block.timestamp <= market.createdAt + market.commitDuration + market.revealDuration,
            "Not in reveal phase"
        );

        // Get the commitment
        Commitment storage commitment = commitments[marketId][commitmentId];
        // Verify commitment exists and hasn't been revealed
        require(commitment.commitmentHash == commitmentHash, "Commitment does not exist");
        require(!commitment.revealed, "Commitment already revealed");
        
        // Verify the revealed data matches the commitment hash using stored wager
        bytes32 calculatedHash = keccak256(abi.encodePacked(uint256(position), uint256(commitment.wager), uint256(nonce)));
        require(
            calculatedHash == commitmentHash,
            "Revealed data does not match commitment hash"
        );

        // Update market consensus
        marketConsensus[marketId].totalWeight += commitment.weight;
        marketConsensus[marketId].weightedSum += position * commitment.weight;
        marketConsensus[marketId].consensusPosition = marketConsensus[marketId].weightedSum / marketConsensus[marketId].totalWeight;
        marketConsensus[marketId].revealedCommitments++;
        
        // Mark commitment as revealed and increment revealed counter
        commitment.revealed = true;
        commitment.position = position;

        emit CommitmentRevealed(
            marketId,
            msg.sender,
            commitmentId,
            commitmentHash,
            position,
            commitment.wager,
            nonce
        );
    }

    /**
     * @dev Resolves a market after checking reveal status
     * @param marketId The ID of the market to resolve
     */
    function resolve(uint256 marketId, uint256 proposedWinningThreshold) external {
        // Validate market exists
        require(marketId <= _marketIdCounter && marketId > 0, "Market does not exist");
        
        Market storage market = markets[marketId];
        MarketConsensus storage consensus = marketConsensus[marketId];
        
        // Check if market is already resolved
        require(!consensus.resolved, "Market already resolved");
        // Check if reveal phase has ended
        bool revealPhaseEnded = block.timestamp > market.createdAt + market.commitDuration + market.revealDuration;
        // Check if all commitments have been revealed
        bool allRevealed = consensus.totalCommitments > 0 && consensus.totalCommitments == consensus.revealedCommitments;
        // Require either all commitments revealed or reveal phase ended
        require(allRevealed || revealPhaseEnded, "Market not ready for resolution");
        require(consensus.revealedCommitments > 0, "No revealed commitments to resolve"); // Ensure there's something to resolve
        
        // Calculate market consensus position
        if (consensus.totalWeight > 0) { // Avoid division by zero if no weights (e.g., all reveals failed, though unlikely here)
            consensus.consensusPosition = consensus.weightedSum / consensus.totalWeight;
        } else {
             revert("No weight in consensus, cannot determine consensus position");
        }

        uint256 revealedCommitmentCount = consensus.revealedCommitments;
        uint256 targetRank;

        // Calculate targetRank: ceil((winningPercentile * revealedCommitmentCount) / 10000)
        // (A * B + D-1) / D for ceil(A*B/D)
        targetRank = Math.mulDiv(market.winningPercentile, revealedCommitmentCount, 10000, Math.Rounding.Ceil);
        if (targetRank == 0 && revealedCommitmentCount > 0) { // Ensure at least 1 winner if percentile > 0 and commitments exist
            targetRank = 1;
        }

        uint256 numStrictlyBelowPWT = 0;
        uint256 numAtOrBelowPWT = 0;
        consensus.winningWagers = 0;
        consensus.winningCommitments = 0;

        for (uint256 i = 0; i < consensus.totalCommitments; i++) {
            Commitment storage commitment = commitments[marketId][i + 1];
            if (commitment.revealed) {
                uint256 distance;
                if (commitment.position > consensus.consensusPosition) {
                    distance = commitment.position - consensus.consensusPosition;
                } else {
                    distance = consensus.consensusPosition - commitment.position;
                }

                if (distance < proposedWinningThreshold) {
                    numStrictlyBelowPWT++;
                }
                if (distance <= proposedWinningThreshold) {
                    numAtOrBelowPWT++;
                    consensus.winningWagers += commitment.wager;
                    consensus.winningCommitments++;
                }
            }
        }

        require(numStrictlyBelowPWT < targetRank, "PWT too high or non-existent rank");
        require(numAtOrBelowPWT >= targetRank, "PWT too low or non-existent rank");

        consensus.winningThreshold = proposedWinningThreshold;
        // Mark market as resolved
        consensus.resolved = true;
    }

    /**
     * @dev Allows winners to claim their portion of the winnings
     * @param marketId The ID of the market to claim from
     * @param commitmentId The ID of the commitment to claim for
     */
    function claim(uint256 marketId, uint256 commitmentId) external {
        // Validate market exists and is resolved
        require(marketId <= _marketIdCounter && marketId > 0, "Market does not exist");
        MarketConsensus storage consensus = marketConsensus[marketId];
        require(consensus.resolved, "Market not resolved");
        require(consensus.totalWinnings > 0, "No winnings to claim... yet");
        // Get the commitment
        Commitment storage commitment = commitments[marketId][commitmentId];
        require(commitment.revealed, "Commitment not revealed");
        require(!commitment.claimed, "Already claimed");

        // Check if position is winning
        uint256 distance = commitment.position > consensus.consensusPosition ? 
            commitment.position - consensus.consensusPosition : 
            consensus.consensusPosition - commitment.position;
        require(distance <= consensus.winningThreshold, "Not a winning position");

        Market storage market = markets[marketId];

        // Calculate winnings based on proportion of total winning wagers
        uint256 winnings = 0;
        if (market.minWager > 0) {
            // Calculate winnings based on proportion of total winning wagers
            winnings = Math.mulDiv(commitment.wager, consensus.totalWinnings, consensus.winningWagers);
        } else {
            winnings = consensus.totalWinnings / consensus.winningCommitments;
        }
       
        // Mark as claimed
        commitment.claimed = true;

        // Transfer winnings
        if (market.token == address(0)) {
            (bool success, ) = payable(commitment.owner).call{value: winnings}("");
            require(success, "Transfer failed");
        } else {
            IERC20 token = IERC20(market.token);
            token.safeTransfer(commitment.owner, winnings);
        }
        
        emit WinningsClaimed(marketId, msg.sender, commitmentId, winnings);
    }
    
    // //==//==//==//==//==//==//==//==//==//==//==//==//==//==//==//==//==//==
    // //==//==//==//==//==//== public helper functions //==//==//==//==//==//==
    // //==//==//==//==//==//==//==//==//==//==//==//==//==//==//==//==//==//==

    // /**
    //  * @dev Returns whether a position is a winning position
    //  * @param marketId The ID of the market
    //  * @param position The position to check
    //  * @return bool True if the position is a winning position
    //  */
    // function isWinningPosition(uint256 marketId, uint256 position) public view returns (bool) {
    //     MarketConsensus storage consensus = marketConsensus[marketId];
    //     require(consensus.resolved, "Market not resolved");
        
    //     uint256 distance = position > consensus.consensusPosition ? 
    //         position - consensus.consensusPosition : 
    //         consensus.consensusPosition - position;
            
    //     return distance <= consensus.winningThreshold;
    // }

    // /**
    //  * @dev Returns the total number of markets
    //  */
    // function getMarketCount() public view returns (uint256) {
    //     return _marketIdCounter;
    // }

    // /**
    //  * @dev Returns a a market by its ID
    //  * @param marketId The ID of the market to check
    //  */
    // function getMarket(uint256 marketId) public view returns (Market memory) {
    //     return markets[marketId];
    // }
}
