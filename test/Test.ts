import {
  time,
  loadFixture,
} from "@nomicfoundation/hardhat-toolbox/network-helpers";
// import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";
import { MerkleTree } from "merkletreejs";

import { expect } from "chai";
import "@nomicfoundation/hardhat-chai-matchers";
import hre from "hardhat";
import { ethers } from "hardhat";
import { TestToken, TestToken__factory } from "../typechain-types";

// Helper function to create commitment hash
function createCommitmentHash(position: bigint, wager: bigint, nonce: bigint): string {
  return ethers.keccak256(
    ethers.solidityPacked(
      ["uint256", "uint256", "uint256"],
      [position, wager, nonce]
    )
  );
}

describe("VPOP", function () {
  let vpop: any;
  let owner: any;
  let otherAccount: any;
  let thirdAccount: any;
  let testToken: TestToken;
  const apeAddress = "0x1000000000000000000000000000000000000000";
  before(async function() {
    const [ownerSigner, otherAccountSigner, thirdAccountSigner] = await hre.ethers.getSigners();
    owner = ownerSigner;
    console.log('owner.address: ',owner.address);
    console.log('owner private key: ', owner.privateKey);


    otherAccount = otherAccountSigner;
    thirdAccount = thirdAccountSigner;

    const VPOP = await hre.ethers.getContractFactory("VPOP");
    vpop = await VPOP.deploy();
  });

  it("Should deploy the contract", async function() {
    expect(vpop).to.not.be.undefined;
  });

  describe("Market Creation", function () {
    it("Should create a market with correct parameters", async function () {
      const marketParams = {
        token: ethers.ZeroAddress,
        lowerBound: ethers.parseEther("1"),
        upperBound: ethers.parseEther("10"),
        decimals: 18,
        minWager: ethers.parseEther("0.1"),
        decayFactor: 20,
        commitDuration: 3600, // 1 hour
        revealDuration: 3600, // 1 hour
        percentile: 50,
        ipfsHash: "QmTest123"
      };
      
      // Create the market
      const tx = await vpop.initializeMarket(
        marketParams.token,
        marketParams.lowerBound,
        marketParams.upperBound,
        marketParams.decimals,
        marketParams.minWager,
        marketParams.decayFactor,
        marketParams.commitDuration,
        marketParams.revealDuration,
        marketParams.percentile,
        marketParams.ipfsHash
      );
      
      // Verify the market was created correctly
      const market = await vpop.markets(1n); // Use BigInt for market ID
      expect(market.creator).to.equal(owner.address);
      expect(market.token).to.equal(marketParams.token);
      expect(market.lowerBound).to.equal(marketParams.lowerBound);
      expect(market.upperBound).to.equal(marketParams.upperBound);
      expect(market.decimals).to.equal(marketParams.decimals);
      expect(market.minWager).to.equal(marketParams.minWager);
      expect(market.decayFactor).to.equal(marketParams.decayFactor);
      expect(market.commitDuration).to.equal(marketParams.commitDuration);
      expect(market.revealDuration).to.equal(marketParams.revealDuration);
      expect(market.percentile).to.equal(marketParams.percentile);
      expect(market.ipfsHash).to.equal(marketParams.ipfsHash);
    });

    it("Should fail when creating a market with invalid parameters", async function () {
      const marketParams = {
        token: ethers.ZeroAddress,
        lowerBound: 10000n, // Higher than upperBound
        upperBound: 1000n,  // Lower than lowerBound
        decimals: 19, // Invalid decimals
        minWager: 0, // Invalid minWager
        decayFactor: 0, // Invalid decayFactor
        commitDuration: 0, // Invalid commitDuration
        revealDuration: 0, // Invalid revealDuration
        percentile: 101, // Invalid percentile
        ipfsHash: "" // Empty IPFS hash
      };

      await expect(
        vpop.initializeMarket(
          marketParams.token,
          marketParams.lowerBound,
          marketParams.upperBound,
          marketParams.decimals,
          marketParams.minWager,
          marketParams.decayFactor,
          marketParams.commitDuration,
          marketParams.revealDuration,
          marketParams.percentile,
          marketParams.ipfsHash
        )
      ).to.be.revertedWith("Lower bound must be less than upper bound");
    });

    it("Should increment market counter correctly", async function () {

      // Create first market
      await vpop.initializeMarket(
        ethers.ZeroAddress,
        1000n,
        10000n,
        18,
        ethers.parseEther("0.1"),
        10,
        3600,
        3600,
        50,
        "QmTest1"
      );

      // Create second market
      await vpop.initializeMarket(
        ethers.ZeroAddress,
        1000n,
        10000n,
        18,
        ethers.parseEther("0.1"),
        10,
        3600,
        3600,
        50,
        "QmTest2"
      );
      const marketCount = await vpop.getMarketCount();
      // Check market count
      expect(marketCount).to.equal(3); // Starting from 1
    });
  });

  describe("Commitments", function () {
    it("Should create a commitment with correct parameters", async function () {
      const ownerBalance = await ethers.provider.getBalance(owner.address);
      
      // Create a market first
      await vpop.initializeMarket(
        ethers.ZeroAddress,
        1000n,
        10000n,
        18,
        ethers.parseEther("0.1"),
        20,
        3600,
        3600,
        50,
        "QmTest123"
      );

      const marketCount = await vpop.getMarketCount();
      
      // Create commitment parameters
      const position = 5000n; // 50%
      const nonce = ethers.toBigInt(ethers.hexlify(ethers.randomBytes(32)));
      const wager = ethers.parseEther("0.5");

      // Calculate the commitment hash
      const commitmentHash = createCommitmentHash(position, wager, nonce);

      // Create commitment
      const tx = await vpop.commit(marketCount, commitmentHash, wager, [], { value: wager });
      const receipt = await tx.wait();
      const event = receipt?.logs[0];

      const marketConsensus = await vpop.marketConsensus(marketCount);
      const commitmentId = marketConsensus.totalCommitments;
      
      // Verify commitment was created
      const commitment = await vpop.commitments(marketCount, commitmentId);
      expect(commitment.commitmentHash).to.equal(commitmentHash);
      expect(commitment.wager).to.equal(wager);
      expect(commitment.position).to.equal(0); // Position should be 0 until revealed
      expect(commitment.nonce).to.equal(0); // Nonce should be 0 until revealed
      expect(commitment.revealed).to.be.false;
    });

    it("Should fail when creating commitment for non-existent market", async function () {
      const position = 5000n;
      const nonce = ethers.toBigInt(ethers.hexlify(ethers.randomBytes(32)));
      const wager = ethers.parseEther("0.01");
      const marketCount = await vpop.getMarketCount();
      const commitmentHash = createCommitmentHash(position, wager, nonce);

      await expect(
        vpop.commit(marketCount + 1n, commitmentHash, wager, [], { value: wager })
      ).to.be.revertedWith("Market does not exist");
    });

    it("Should fail when wager is below minimum", async function () {
      // Create a market with minWager of 0.1 ETH
      await vpop.initializeMarket(
        ethers.ZeroAddress,
        1000n,
        10000n,
        18,
        ethers.parseEther("0.1"),
        20,
        3600,
        3600,
        50,
        "QmTest123"
      );

      const marketCount = await vpop.getMarketCount();
      const position = 5000n;
      const nonce = ethers.toBigInt(ethers.hexlify(ethers.randomBytes(32)));
      const wager = ethers.parseEther("0.05"); // Below minimum wager
      const commitmentHash = createCommitmentHash(position, wager, nonce);

      await expect(
        vpop.commit(marketCount, commitmentHash, wager, [], { value: wager })
      ).to.be.revertedWith("Wager below minimum wager");
    });

    it("Should fail when commitment phase has ended", async function () {
      // Create a market with 1 hour commit duration
      await vpop.initializeMarket(
        ethers.ZeroAddress,
        ethers.parseEther("1"),
        ethers.parseEther("10"),
        18,
        ethers.parseEther("0.1"),
        20,
        3600, // 1 hour
        3600,
        50,
        "QmTest123"
      );

      const marketCount = await vpop.getMarketCount();
      const position = 5000n;
      const nonce = ethers.toBigInt(ethers.hexlify(ethers.randomBytes(32)));
      const wager = ethers.parseEther("0.5");
      const commitmentHash = createCommitmentHash(position, wager, nonce);

      // Advance time by 2 hours
      await time.increase(7200);

      await expect(
        vpop.commit(marketCount, commitmentHash, wager, [], { value: wager })
      ).to.be.revertedWith("Commitment phase has ended");
    });

    it("Should create multiple commitments", async function () {
      // Create a market with a longer commit duration (2 hours)
      await vpop.initializeMarket(
        ethers.ZeroAddress,
        ethers.parseEther("1"),
        ethers.parseEther("10"),
        18,
        ethers.parseEther("0.1"),
        20,
        7200, // 2 hours commit duration
        3600,
        50,
        "QmTest123"
      );

      const marketCount = await vpop.getMarketCount();
      
      // Create commitment parameters
      const position1 = 5000n;
      const position2 = 6000n;
      const nonce1 = ethers.toBigInt(ethers.hexlify(ethers.randomBytes(32)));
      const nonce2 = ethers.toBigInt(ethers.hexlify(ethers.randomBytes(32)));
      const wager = ethers.parseEther("0.5");

      // Calculate commitment hashes
      const commitmentHash1 = createCommitmentHash(position1, wager, nonce1);
      const commitmentHash2 = createCommitmentHash(position2, wager, nonce2);

      // Get the market to check timing
      const market = await vpop.markets(marketCount);
      const commitEndTime = market.createdAt + market.commitDuration;
      const currentTime = await time.latest();
      
      // Verify we're still in the commit phase
      expect(currentTime).to.be.lessThan(commitEndTime);

      // Create two commitments
      await vpop.commit(marketCount, commitmentHash1, wager, [], { value: wager });
      await vpop.commit(marketCount, commitmentHash2, wager, [], { value: wager });

      // Verify commitments exist
      const commitment1 = await vpop.commitments(marketCount, 1);
      const commitment2 = await vpop.commitments(marketCount, 2);
      expect(commitment1.commitmentHash).to.equal(commitmentHash1);
      expect(commitment2.commitmentHash).to.equal(commitmentHash2);
      expect(commitment1.position).to.equal(0); // Position should be 0 until revealed
      expect(commitment2.position).to.equal(0); // Position should be 0 until revealed
    });

  });

  describe("Fee Management", function () {
    it("Should have correct initial fee rates", async function () {
      const platformFeeRate = await vpop.platformFeeRate();
      const creatorFeeRate = await vpop.creatorFeeRate();
      const apeFeeRate = await vpop.apeFeeRate();
      const apeOwner = await vpop.apeOwner();

      expect(platformFeeRate).to.equal(800); // 8%
      expect(creatorFeeRate).to.equal(200); // 2%
      expect(apeFeeRate).to.equal(200); // 2%
      expect(apeOwner).to.equal(apeAddress); // Initial ape owner should be zero address
    });

    it("Should allow owner to update fee rates", async function () {
      const newPlatformFeeRate = 1000; // 10%
      const newCreatorFeeRate = 300; // 3%
      const newApeFeeRate = 300; // 3%

      await vpop.updatePlatformSettings(
        newPlatformFeeRate,
        newCreatorFeeRate,
        newApeFeeRate
      );

      const platformFeeRate = await vpop.platformFeeRate();
      const creatorFeeRate = await vpop.creatorFeeRate();
      const apeFeeRate = await vpop.apeFeeRate();

      expect(platformFeeRate).to.equal(newPlatformFeeRate);
      expect(creatorFeeRate).to.equal(newCreatorFeeRate);
      expect(apeFeeRate).to.equal(newApeFeeRate);
    });

    it("Should not allow non-owner to update fee rates", async function () {
      const newPlatformFeeRate = 1000;
      const newCreatorFeeRate = 300;
      const newApeFeeRate = 300;

      await expect(
        vpop.connect(otherAccount).updatePlatformSettings(
          newPlatformFeeRate,
          newCreatorFeeRate,
          newApeFeeRate
        )
      ).to.be.revertedWithCustomError(vpop, "OwnableUnauthorizedAccount");
    });

    it("Should distribute fees correctly including ape fee", async function () {
      // Create a market
      await vpop.connect(otherAccount).initializeMarket(
        ethers.ZeroAddress,
        1000n,
        10000n,
        18,
        ethers.parseEther("0.1"),
        20,
        3600,
        3600,
        50,
        "QmTest123"
      );

      const marketCount = await vpop.getMarketCount();
      const market = await vpop.markets(marketCount);
      const marketCreator = market.creator;
      expect(marketCreator).to.equal(otherAccount.address);

      // Create commitment parameters
      const position = 5000n;
      const nonce = ethers.toBigInt(ethers.hexlify(ethers.randomBytes(32)));
      const wager = ethers.parseEther("1.0"); // 1 ETH wager
      const commitmentHash = createCommitmentHash(position, wager, nonce);

      // Get initial balances
      const initialOwnerBalance = await ethers.provider.getBalance(owner.address);
      const initialCreatorBalance = await ethers.provider.getBalance(marketCreator);
      const initialApeOwnerBalance = await ethers.provider.getBalance(apeAddress);

      // Create commitment
      await vpop.connect(thirdAccount).commit(marketCount, commitmentHash, wager, [], { value: wager });


      // Calculate expected fees
      const platformFee = (wager * 1000n) / 10000n; // 10%
      const creatorFee = (wager * 300n) / 10000n; // 3%
      const apeFee = (wager * 300n) / 10000n; // 3%

      // Get final balances
      const finalOwnerBalance = await ethers.provider.getBalance(owner.address);
      const finalCreatorBalance = await ethers.provider.getBalance(marketCreator);
      const finalApeOwnerBalance = await ethers.provider.getBalance(apeAddress);

      // Verify fee distribution
      expect(finalOwnerBalance - initialOwnerBalance).to.equal(platformFee);
      expect(finalCreatorBalance - initialCreatorBalance).to.equal(creatorFee);
      expect(finalApeOwnerBalance - initialApeOwnerBalance).to.equal(apeFee);
    });

    it("Should distribute ERC20 fees correctly including ape fee", async function () {
      // Deploy a test ERC20 token
      const TestToken = await ethers.getContractFactory("TestToken");
      testToken = await TestToken.deploy();
      await testToken.waitForDeployment();

      // Mint tokens to the test account
      const wager = ethers.parseEther("1.0"); // 1 token
      await testToken.mint(thirdAccount.address, wager * 2n); // Mint extra for fees
      await testToken.connect(thirdAccount).approve(await vpop.getAddress(), wager * 2n);

      // Create a market with the test token
      await vpop.connect(otherAccount).initializeMarket(
        await testToken.getAddress(),
        ethers.parseEther("1"),
        ethers.parseEther("10"),
        18,
        ethers.parseEther("0.1"),
        20,
        3600,
        3600,
        50,
        "QmTest123"
      );

      const marketCount = await vpop.getMarketCount();
      const market = await vpop.markets(marketCount);
      const marketCreator = market.creator;
      
      // Create commitment parameters
      const position = 5000n;
      const nonce = ethers.toBigInt(ethers.hexlify(ethers.randomBytes(32)));
      const commitmentHash = createCommitmentHash(position, wager, nonce);

      // Get initial balances
      const initialOwnerBalance = await testToken.balanceOf(owner.address);
      const initialCreatorBalance = await testToken.balanceOf(marketCreator);
      const initialApeOwnerBalance = await testToken.balanceOf(apeAddress);

      // Create commitment
      await vpop.connect(thirdAccount).commit(marketCount, commitmentHash, wager, [], { value: wager });

      // Calculate expected fees
      const platformFee = (wager * 1000n) / 10000n; // 10%
      const creatorFee = (wager * 300n) / 10000n; // 3%
      const apeFee = (wager * 300n) / 10000n; // 3%

      // Get final balances
      const finalOwnerBalance = await testToken.balanceOf(owner.address);
      const finalCreatorBalance = await testToken.balanceOf(marketCreator);
      const finalApeOwnerBalance = await testToken.balanceOf(apeAddress);

      // Verify fee distribution
      expect(finalOwnerBalance - initialOwnerBalance).to.equal(platformFee);
      expect(finalCreatorBalance - initialCreatorBalance).to.equal(creatorFee);
      expect(finalApeOwnerBalance - initialApeOwnerBalance).to.equal(apeFee);
    });
  });

  describe("Reveal Phase", function () {
    it("Should successfully reveal a valid commitment", async function () {
      // Create a market
      await vpop.initializeMarket(
        ethers.ZeroAddress,
        1000n,
        10000n,
        18,
        ethers.parseEther("0.1"),
        20,
        3600, // 1 hour commit
        3600, // 1 hour reveal
        50,
        "QmTest123"
      );

      const marketCount = await vpop.getMarketCount();
      
      // Create commitment parameters
      const position = 5000n;
      const nonce = ethers.toBigInt(ethers.hexlify(ethers.randomBytes(32)));
      const wager = ethers.parseEther("0.5");

      // Calculate the commitment hash
      const commitmentHash = createCommitmentHash(position, wager, nonce);

      // Create commitment
      await vpop.commit(marketCount, commitmentHash, wager, [], { value: wager });

      // Advance time to reveal phase
      await time.increase(3600 + 1); // Just after commit phase ends

      // Reveal the commitment
      const tx = await vpop.reveal(
        marketCount,
        1,
        commitmentHash,
        position,
        wager,
        nonce
      );
      const receipt = await tx.wait();

      // Verify the commitment is marked as revealed
      const commitment = await vpop.commitments(marketCount, 1);
      expect(commitment.revealed).to.be.true;

    });

    it("Should fail when revealing during commit phase", async function () {
      // Create a market
      await vpop.initializeMarket(
        ethers.ZeroAddress,
        1000n,
        10000n,
        18,
        ethers.parseEther("0.1"),
        20,
        3600,
        3600,
        50,
        "QmTest123"
      );

      const marketCount = await vpop.getMarketCount();
      
      // Create commitment parameters
      const position = 5000n;
      const nonce = ethers.toBigInt(ethers.hexlify(ethers.randomBytes(32)));
      const wager = ethers.parseEther("0.5");

      // Calculate the commitment hash
      const commitmentHash = createCommitmentHash(position, wager, nonce);

      // Create commitment
      await vpop.commit(marketCount, commitmentHash, wager, [], { value: wager });

      // Try to reveal during commit phase
      await expect(
        vpop.reveal(
          marketCount,
          1,
          commitmentHash,
          position,
          wager,
          nonce
        )
      ).to.be.revertedWith("Not in reveal phase");
    });

    it("Should fail when revealing after reveal phase", async function () {
      // Create a market
      await vpop.initializeMarket(
        ethers.ZeroAddress,
        1000n,
        10000n,
        18,
        ethers.parseEther("0.1"),
        20,
        3600,
        3600,
        50,
        "QmTest123"
      );

      const marketCount = await vpop.getMarketCount();
      
      // Create commitment parameters
      const position = 5000n;
      const nonce = ethers.toBigInt(ethers.hexlify(ethers.randomBytes(32)));
      const wager = ethers.parseEther("0.5");

      // Calculate the commitment hash
      const commitmentHash = createCommitmentHash(position, wager, nonce);

      // Create commitment
      await vpop.commit(marketCount, commitmentHash, wager, [], { value: wager });

      // Advance time past both commit and reveal phases
      await time.increase(7200 + 1);

      // Try to reveal after reveal phase
      await expect(
        vpop.reveal(
          marketCount,
          1,
          commitmentHash,
          position,
          wager,
          nonce
        )
      ).to.be.revertedWith("Not in reveal phase");
    });

    it("Should fail when revealing with incorrect data", async function () {
      // Create a market
      await vpop.initializeMarket(
        ethers.ZeroAddress,
        1000n,
        10000n,
        18,
        ethers.parseEther("0.1"),
        20,
        3600,
        3600,
        50,
        "QmTest123"
      );

      const marketCount = await vpop.getMarketCount();
      
      // Create commitment parameters
      const position = 5000n;
      const nonce = ethers.toBigInt(ethers.hexlify(ethers.randomBytes(32)));
      const wager = ethers.parseEther("0.5");

      // Calculate the commitment hash
      const commitmentHash = createCommitmentHash(position, wager, nonce);

      // Create commitment
      await vpop.commit(marketCount, commitmentHash, wager, [], { value: wager });

      // Advance time to reveal phase
      await time.increase(3600 + 1);

      // Try to reveal with incorrect data
      const incorrectPosition = 6000n;
      await expect(
        vpop.reveal(
          marketCount,
          1,
          commitmentHash,
          incorrectPosition,
          wager,
          nonce
        )
      ).to.be.revertedWith("Revealed data does not match commitment hash");
    });

    it("Should fail when revealing the same commitment twice", async function () {
      // Create a market
      await vpop.initializeMarket(
        ethers.ZeroAddress,
        1000n,
        10000n,
        18,
        ethers.parseEther("0.1"),
        0,
        3600,
        3600,
        50,
        "QmTest123"
      );

      const marketCount = await vpop.getMarketCount();
      
      // Create commitment parameters
      const position = 5000n;
      const nonce = ethers.toBigInt(ethers.hexlify(ethers.randomBytes(32)));
      const wager = ethers.parseEther("0.5");

      // Calculate the commitment hash
      const commitmentHash = createCommitmentHash(position, wager, nonce);

      // Create commitment
      await vpop.commit(marketCount, commitmentHash, wager, [], { value: wager });

      // Advance time to reveal phase
      await time.increase(3600 + 1);

      // Reveal the commitment
      await vpop.reveal(
        marketCount,
        1,
        commitmentHash,
        position,
        wager,
        nonce
      );

      // Try to reveal the same commitment again
      await expect(
        vpop.reveal(
          marketCount,
          1,
          commitmentHash,
          position,
          wager,
          nonce
        )
      ).to.be.revertedWith("Commitment already revealed");
    });
  });

  describe("Market Resolve", function () {
    it("should resolve only after reveal phase or all revealed, and set consensus and winning threshold", async function () {
      // Use existing signers
      const signers = [owner, otherAccount, thirdAccount];

      // Create a market
      await vpop.initializeMarket(
        ethers.ZeroAddress,
        0,
        1000,
        1,
        ethers.parseEther("0.1"),
        0,
        3600, // 1 hour commit
        3600, // 1 hour reveal
        2000, // 20% percentile
        "ipfs://resolve-test"
      );
      const marketId = await vpop.getMarketCount();

      // Commitments
      const positions = [
        120n,
        150n,
        180n
      ];
      const wagers = [
        ethers.parseEther("1"),
        ethers.parseEther("2"),
        ethers.parseEther("1")
      ];
      const nonces = positions.map(() => ethers.toBigInt(ethers.hexlify(ethers.randomBytes(32))));
      const commitmentHashes = positions.map((pos, i) => createCommitmentHash(pos, wagers[i], nonces[i]));

      // Move to reveal phase
      await time.increase(3500);

      // Submit commitments
      for (let i = 0; i < 3; i++) {
        await vpop.connect(signers[i]).commit(marketId, commitmentHashes[i], wagers[i], [], { value: wagers[i] });
      }

      // Move to reveal phase
      await time.increase(200);

      // Reveal only the first two
      for (let i = 0; i < 2; i++) {
        // console.log('positions[i]: ',positions[i])
        await vpop.connect(signers[i]).reveal(
          marketId,
          i+1,
          commitmentHashes[i],
          positions[i],
          wagers[i],
          nonces[i]
        );
      }

      const revealedmMrketConsensus = await vpop.marketConsensus(marketId);

      // Try to resolve before reveal phase ends (should fail)
      await expect(vpop.resolve(marketId)).to.be.revertedWith("Market not ready for resolution");

      // Move to after reveal phase
      await time.increase(3601);

      // Now resolve should succeed
      await vpop.resolve(marketId);
      
      const marketConsensus = await vpop.marketConsensus(marketId);
      const consensus = marketConsensus.consensusPosition;
      expect(marketConsensus.resolved).to.be.true;
      expect(consensus).to.be.gt(0);
      expect(marketConsensus.winningThreshold).to.be.gte(0);

      // The consensus should be the weighted average of revealed positions
      const totalWeight = wagers[0] + wagers[1];
      const weightedSum = positions[0] * wagers[0] + positions[1] * wagers[1];
      const expectedConsensus = weightedSum / totalWeight;
      expect(consensus).to.equal(expectedConsensus);

      // Try to resolve again - should fail
      await expect(vpop.resolve(marketId)).to.be.revertedWith("Market already resolved");
      // The third (unrevealed) commitment should not affect consensus or threshold
      // Only revealed commitments are considered
    });

  });

  describe("Claim Winnings", function () {
    it("should calculate correct winning threshold and allow only winning positions to claim", async function () {
      // Create a market with 20% percentile
      await vpop.initializeMarket(
        ethers.ZeroAddress,
        1000,
        2000,
        0,
        ethers.parseEther("0.1"),
        1,
        3600,
        3600,
        2000, // 20% percentile
        "ipfs://threshold-test"
      );
      const marketId = await vpop.getMarketCount();

      // Create commitments with different positions
      const positions = [
        1200n, // Far below
        1500n, // Below
        1600n, // Middle
        1700n, // Above
        1800n  // Far above
      ];
      const wagers = [
        ethers.parseEther("1"),
        ethers.parseEther("2"),
        ethers.parseEther("3"),
        ethers.parseEther("2"),
        ethers.parseEther("1")
      ];
      const nonces = positions.map(() => ethers.toBigInt(ethers.hexlify(ethers.randomBytes(32))));
      const commitmentHashes = positions.map((pos, i) => createCommitmentHash(pos, wagers[i], nonces[i]));

      // Submit all commitments
      for (let i = 0; i < 5; i++) {
        await vpop.connect([owner, otherAccount, thirdAccount, owner, otherAccount][i])
          .commit(marketId, commitmentHashes[i], wagers[i], [], { value: wagers[i] });
      }

      // Move to reveal phase
      await time.increase(3601);

      // Reveal all commitments
      for (let i = 0; i < 5; i++) {
        await vpop.connect([owner, otherAccount, thirdAccount, owner, otherAccount][i])
          .reveal(marketId, i+1, commitmentHashes[i], positions[i], wagers[i], nonces[i]);
      }

      // Verify all commitments have been revealed
      const marketConsensusBeforeResolve   = await vpop.marketConsensus(marketId);
      expect(marketConsensusBeforeResolve.totalCommitments).to.equal(5);
      expect(marketConsensusBeforeResolve.revealedCommitments).to.equal(5);
      // Move to resolution phase
      await time.increase(3601);

      // Resolve market
      await vpop.resolve(marketId);

      // Get market consensus and threshold
      // const consensus = await vpop.getMarketConsensus(marketId);
      const marketConsensus = await vpop.marketConsensus(marketId);
      const consensus = marketConsensus.consensusPosition;
      const threshold = marketConsensus.winningThreshold;
      
      // Calculate distances from consensus
      const distances = positions.map(pos => 
        pos > consensus ? pos - consensus : consensus - pos
      );
      


      // Try to claim for each position
      for (let i = 0; i < 5; i++) {
        const distance = positions[i] > consensus ? positions[i] - consensus : consensus - positions[i];
        const isWinning = distance <= threshold;
        if (isWinning) {
          // Should succeed for winning positions
          await expect(vpop.connect([owner, otherAccount, thirdAccount, owner, otherAccount][i])
            .claim(marketId, i+1))
            .to.not.be.reverted;
        } else {
          // Should fail for non-winning positions
          await expect(vpop.connect([owner, otherAccount, thirdAccount, owner, otherAccount][i])
            .claim(marketId, i+1))
            .to.be.revertedWith("Not a winning position");
        }
      }

      // Verify winning positions received their winnings
      const totalWinnings = marketConsensus.totalWinnings;
      const totalWinningWagers = wagers.reduce((sum, wager, i) => 
        distances[i] <= threshold ? sum + wager : sum, 0n);

      for (let i = 0; i < 5; i++) {
        if (distances[i] <= threshold) {
          const expectedWinnings = (wagers[i] * totalWinnings) / totalWinningWagers;
          const balance = await ethers.provider.getBalance([owner, otherAccount, thirdAccount, owner, otherAccount][i].address);
          expect(balance).to.be.gt(0); // Should have received winnings
        }
      }
    });

    it("should not allow claiming before market resolution", async function () {
      // Create market and commitment
      await vpop.initializeMarket(
        ethers.ZeroAddress,
        1000,
        2000,
        0,
        ethers.parseEther("0.1"),
        1,
        3600,
        3600,
        2000, // 20% percentile
        "ipfs://threshold-test"
      );
      const marketId = await vpop.getMarketCount();

      const position = 1500n;
      const wager = ethers.parseEther("1");
      const nonce = ethers.toBigInt(ethers.hexlify(ethers.randomBytes(32)));
      const commitmentHash = createCommitmentHash(position, wager, nonce);

      await vpop.commit(marketId, commitmentHash, wager, [], { value: wager });
      await time.increase(3601);
      await vpop.reveal(marketId, 1, commitmentHash, position, wager, nonce);

      // Try to claim before resolution
      await expect(vpop.claim(marketId, 1))
        .to.be.revertedWith("Market not resolved");
    });

    it("should not allow claiming unrevealed commitments", async function () {
      // Create market and commitment
      await vpop.initializeMarket(
        ethers.ZeroAddress,
        1000,
        2000,
        0,
        ethers.parseEther("0.1"),
        1,
        3600,
        3600,
        2000, // 20% percentile
        "ipfs://threshold-test"
      );
      const marketId = await vpop.getMarketCount();
     

      const position = 1500n;
      const wager = ethers.parseEther("1");
      const nonce = ethers.toBigInt(ethers.hexlify(ethers.randomBytes(32)));
      const commitmentHash = createCommitmentHash(position, wager, nonce);

      await vpop.commit(marketId, commitmentHash, wager, [], { value: wager });

      const position2 = 1600n;
      const wager2 = ethers.parseEther("1");
      const nonce2 = ethers.toBigInt(ethers.hexlify(ethers.randomBytes(32)));
      const commitmentHash2 = createCommitmentHash(position2, wager2, nonce2);

      await vpop.commit(marketId, commitmentHash2, wager2, [], { value: wager2 });
      await time.increase(3601);
      await vpop.reveal(marketId, 2, commitmentHash2, position2, wager2, nonce2);
      await time.increase(7201); // Move past reveal phase
      await vpop.resolve(marketId);
      // Try to claim unrevealed commitment
      await expect(vpop.claim(marketId, 1))
        .to.be.revertedWith("Commitment not revealed");
    });
  });

  describe("Whitelist", function () {
    it("Should allow creating market with whitelist", async function () {
      const whitelistRoot = ethers.keccak256(ethers.randomBytes(32));
      
      const marketParams = {
        token: ethers.ZeroAddress,
        lowerBound: ethers.parseEther("1"),
        upperBound: ethers.parseEther("10"),
        decimals: 18,
        minWager: ethers.parseEther("0.1"),
        decayFactor: 20,
        commitDuration: 3600,
        revealDuration: 3600,
        percentile: 50,
        ipfsHash: "QmTest123"
      };
      
      const tx = await vpop.initializeMarket(
        marketParams.token,
        marketParams.lowerBound,
        marketParams.upperBound,
        marketParams.decimals,
        marketParams.minWager,
        marketParams.decayFactor,
        marketParams.commitDuration,
        marketParams.revealDuration,
        marketParams.percentile,
        marketParams.ipfsHash
      );

      const marketId = await vpop.getMarketCount();
      await vpop.updateWhitelistRoot(marketId, whitelistRoot);

      const rooty = await vpop.whitelistRoots(marketId);
      expect(rooty).to.equal(whitelistRoot);
    });

    it("Should verify whitelist correctly", async function () {
      // Create a whitelist with 7 addresses
      const addresses = [
        owner.address,
        otherAccount.address,
        thirdAccount.address,
        "0x90F79bf6EB2c4f870365E785982E1f101E93b906",
        "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65"
      ];
      
      // Create leaf nodes by hashing each address
      const leaves = addresses.map(addr => 
        ethers.keccak256(ethers.solidityPacked(["address"], [addr]))
      );

      // Construct Merkle Tree
      const tree = new MerkleTree(leaves, ethers.keccak256, {
        sortPairs: true,
      });

      // Get root
      const root = tree.getHexRoot();

      // Create market with whitelist
      await vpop.initializeMarket(
        ethers.ZeroAddress,
        1000n,
        10000n,
        2,
        0, // ethers.parseEther("0.1"),
        20,
        3600,
        3600,
        50,
        "QmTest123"
      );

      const marketId = await vpop.getMarketCount();
      await vpop.updateWhitelistRoot(marketId, root);
      
      // Create commitment parameters
      const position = 5000n;
      const nonce = ethers.toBigInt(ethers.hexlify(ethers.randomBytes(32)));
      const wager = ethers.parseEther("0.5");
      const commitmentHash = createCommitmentHash(position, wager, nonce);
      
      // Test each whitelisted address
      for (const address of addresses) {
        const leaf = ethers.keccak256(ethers.solidityPacked(["address"], [address]));
        const proof = tree.getHexProof(leaf);
        const signer = await ethers.getSigner(address);
        
        // Should allow whitelisted address to commit
        await vpop.connect(signer).commit(marketId, commitmentHash, wager, proof, { value: wager });
      }
      
      // Test non-whitelisted address
      const nonWhitelistedAddress = "0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc";
      const nonWhitelistedSigner = await ethers.getSigner(nonWhitelistedAddress);
      const wrongProof = [ethers.keccak256(ethers.randomBytes(32))];
      
      await expect(
        vpop.connect(nonWhitelistedSigner).commit(marketId, commitmentHash, wager, wrongProof, { value: wager })
      ).to.be.revertedWith("Address not whitelisted");
    });
  });

  describe("Zero Wager Markets", function () {
    

    it("Should allow external funding of prizes for zero wager market", async function () {
      // Create market with zero minWager
      await vpop.initializeMarket(
        ethers.ZeroAddress,
        1000n,
        10000n,
        2,
        0n,
        20,
        3600,
        3600,
        50,
        "QmTest123"
      );

      const marketId = await vpop.getMarketCount();
      
      // Fund the market with ETH in multiple steps
      const firstPrizeAmount = ethers.parseEther("1.0");
      const secondPrizeAmount = ethers.parseEther("2.0");
      
      // First funding by owner
      await vpop.addWinnings(marketId, firstPrizeAmount, { value: firstPrizeAmount });
      let marketConsensus = await vpop.marketConsensus(marketId);
      expect(marketConsensus.totalWinnings).to.equal(firstPrizeAmount);

      // Second funding by other account
      await vpop.connect(otherAccount).addWinnings(marketId, secondPrizeAmount, { value: secondPrizeAmount });
      marketConsensus = await vpop.marketConsensus(marketId);
      expect(marketConsensus.totalWinnings).to.equal(firstPrizeAmount + secondPrizeAmount);

      // Try to fund with incorrect value
      await expect(
        vpop.connect(thirdAccount).addWinnings(marketId, ethers.parseEther("1.0"), { value: ethers.parseEther("0.5") })
      ).to.be.revertedWith("Sent value must match additional winnings");

      // Create commitment parameters
      const position = 5000n;
      const nonce = ethers.toBigInt(ethers.hexlify(ethers.randomBytes(32)));
      const wager = 0n; // Zero wager
      const commitmentHash = createCommitmentHash(position, wager, nonce);

      // Create commitment with zero wager
      await vpop.commit(marketId, commitmentHash, wager, [], { value: 0n });

      // Move to reveal phase
      await time.increase(3601);

      // Reveal commitment
      await vpop.reveal(marketId, 1, commitmentHash, position, wager, nonce);

      // Move to resolution phase
      await time.increase(3601);

      // Resolve market
      await vpop.resolve(marketId);

      // Claim winnings
      await vpop.claim(marketId, 1);

      // Verify winnings were claimed
      const finalBalance = await ethers.provider.getBalance(owner.address);
      expect(finalBalance).to.be.gt(0);
    });

    it("Should allow external funding with ERC20 tokens", async function () {
      // Deploy test token
      const TestToken = await ethers.getContractFactory("TestToken");
      const testToken = await TestToken.deploy();
      await testToken.waitForDeployment();

      // Create market with test token and zero minWager
      await vpop.initializeMarket(
        await testToken.getAddress(),
        1000n,
        10000n,
        2,
        0n,
        20,
        3600,
        3600,
        50,
        "QmTest123"
      );

      const marketId = await vpop.getMarketCount();
      
      // Fund the market with tokens in multiple steps
      const firstPrizeAmount = ethers.parseEther("1.0");
      const secondPrizeAmount = ethers.parseEther("2.0");
      
      // First funding by owner
      await testToken.mint(owner.address, firstPrizeAmount + secondPrizeAmount);
      await testToken.approve(await vpop.getAddress(), firstPrizeAmount + secondPrizeAmount);
      
      await vpop.addWinnings(marketId, firstPrizeAmount, { value: firstPrizeAmount });
      let marketConsensus = await vpop.marketConsensus(marketId);
      expect(marketConsensus.totalWinnings).to.equal(firstPrizeAmount);

      // Second funding by other account
      await testToken.mint(otherAccount.address, secondPrizeAmount);
      await testToken.connect(otherAccount).approve(await vpop.getAddress(), secondPrizeAmount);
      await vpop.connect(otherAccount).addWinnings(marketId, secondPrizeAmount, { value: secondPrizeAmount });
      marketConsensus = await vpop.marketConsensus(marketId);
      expect(marketConsensus.totalWinnings).to.equal(firstPrizeAmount + secondPrizeAmount);

      // Try to fund with incorrect value
      await expect(
        vpop.connect(thirdAccount).addWinnings(marketId, ethers.parseEther("1.0"), { value: ethers.parseEther("0.5") })
      ).to.be.revertedWith("Sent value must match additional winnings");

      // Create commitment parameters
      const position = 5000n;
      const nonce = ethers.toBigInt(ethers.hexlify(ethers.randomBytes(32)));
      const wager = 0n; // Zero wager
      const commitmentHash = createCommitmentHash(position, wager, nonce);

      // Create commitment with zero wager
      await vpop.commit(marketId, commitmentHash, wager, []);

      // Move to reveal phase
      await time.increase(3601);

      // Reveal commitment
      await vpop.reveal(marketId, 1, commitmentHash, position, wager, nonce);

      // Move to resolution phase
      await time.increase(3601);

      // Resolve market
      await vpop.resolve(marketId);

      // Claim winnings
      await vpop.claim(marketId, 1);

      // Verify winnings were claimed
      const finalBalance = await testToken.balanceOf(owner.address);
      expect(finalBalance).to.equal(firstPrizeAmount + secondPrizeAmount);
    });
  });
});




