import {
  time,
  loadFixture,
} from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";
import { expect } from "chai";
import "@nomicfoundation/hardhat-chai-matchers";
import hre from "hardhat";
import { ethers } from "hardhat";

// Helper function to create commitment hash
function createCommitmentHash(position: bigint, wager: bigint, nonce: bigint): string {
  return ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["uint256", "uint256", "uint256"],
      [position, wager, nonce]
    )
  );
}

describe("VPOP", function () {
  let vpop: any;
  let owner: any;
  let otherAccount: any;

  before(async function() {
    const [ownerSigner, otherAccountSigner] = await hre.ethers.getSigners();
    owner = ownerSigner;
    otherAccount = otherAccountSigner;

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
        lowerBound: ethers.parseEther("10"), // Higher than upperBound
        upperBound: ethers.parseEther("1"),  // Lower than lowerBound
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
        ethers.parseEther("1"),
        ethers.parseEther("10"),
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
        ethers.parseEther("1"),
        ethers.parseEther("10"),
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
      
      // Create commitment parameters
      const position = 5000n; // 50%
      const nonce = ethers.toBigInt(ethers.hexlify(ethers.randomBytes(32)));
      const wager = ethers.parseEther("0.5");

      // Calculate the commitment hash
      const commitmentHash = createCommitmentHash(position, wager, nonce);

      // Create commitment
      const tx = await vpop.commit(marketCount, commitmentHash, wager, { value: wager });
      const receipt = await tx.wait();
      const event = receipt?.logs[0];

      // Verify commitment was created
      const commitment = await vpop.commitments(marketCount, commitmentHash);
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
        vpop.commit(marketCount + 1n, commitmentHash, wager, { value: wager })
      ).to.be.revertedWith("Market does not exist");
    });

    it("Should fail when wager is below minimum", async function () {
      // Create a market with minWager of 0.1 ETH
      await vpop.initializeMarket(
        ethers.ZeroAddress,
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
      const position = 5000n;
      const nonce = ethers.toBigInt(ethers.hexlify(ethers.randomBytes(32)));
      const wager = ethers.parseEther("0.05"); // Below minimum wager
      const commitmentHash = createCommitmentHash(position, wager, nonce);

      await expect(
        vpop.commit(marketCount, commitmentHash, wager, { value: wager })
      ).to.be.revertedWith("Weight below minimum wager");
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
        vpop.commit(marketCount, commitmentHash, wager, { value: wager })
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
      await vpop.commit(marketCount, commitmentHash1, wager, { value: wager });
      await vpop.commit(marketCount, commitmentHash2, wager, { value: wager });

      // Verify commitments exist
      const commitment1 = await vpop.commitments(marketCount, commitmentHash1);
      const commitment2 = await vpop.commitments(marketCount, commitmentHash2);
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

      expect(platformFeeRate).to.equal(800); // 8%
      expect(creatorFeeRate).to.equal(200); // 2%
      expect(apeFeeRate).to.equal(200); // 2%
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

  });

  describe("Reveal Phase", function () {
    it("Should successfully reveal a valid commitment", async function () {
      // Create a market
      await vpop.initializeMarket(
        ethers.ZeroAddress,
        ethers.parseEther("1"),
        ethers.parseEther("10"),
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
      await vpop.commit(marketCount, commitmentHash, wager, { value: wager });

      // Advance time to reveal phase
      await time.increase(3600 + 1); // Just after commit phase ends

      // Reveal the commitment
      const tx = await vpop.reveal(
        marketCount,
        commitmentHash,
        position,
        wager,
        nonce
      );
      const receipt = await tx.wait();

      // Verify the commitment is marked as revealed
      const commitment = await vpop.commitments(marketCount, commitmentHash);
      expect(commitment.revealed).to.be.true;

      // // Verify the event was emitted
      // const event = receipt?.logs[0];
      // expect(event?.topics[0]).to.equal(ethers.id("CommitmentRevealed(uint256,address,bytes32,uint256,uint256)"));
    });

    it("Should fail when revealing during commit phase", async function () {
      // Create a market
      await vpop.initializeMarket(
        ethers.ZeroAddress,
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
      
      // Create commitment parameters
      const position = 5000n;
      const nonce = ethers.toBigInt(ethers.hexlify(ethers.randomBytes(32)));
      const wager = ethers.parseEther("0.5");

      // Calculate the commitment hash
      const commitmentHash = createCommitmentHash(position, wager, nonce);

      // Create commitment
      await vpop.commit(marketCount, commitmentHash, wager, { value: wager });

      // Try to reveal during commit phase
      await expect(
        vpop.reveal(
          marketCount,
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
      
      // Create commitment parameters
      const position = 5000n;
      const nonce = ethers.toBigInt(ethers.hexlify(ethers.randomBytes(32)));
      const wager = ethers.parseEther("0.5");

      // Calculate the commitment hash
      const commitmentHash = createCommitmentHash(position, wager, nonce);

      // Create commitment
      await vpop.commit(marketCount, commitmentHash, wager, { value: wager });

      // Advance time past both commit and reveal phases
      await time.increase(7200 + 1);

      // Try to reveal after reveal phase
      await expect(
        vpop.reveal(
          marketCount,
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
      
      // Create commitment parameters
      const position = 5000n;
      const nonce = ethers.toBigInt(ethers.hexlify(ethers.randomBytes(32)));
      const wager = ethers.parseEther("0.5");

      // Calculate the commitment hash
      const commitmentHash = createCommitmentHash(position, wager, nonce);

      // Create commitment
      await vpop.commit(marketCount, commitmentHash, wager, { value: wager });

      // Advance time to reveal phase
      await time.increase(3600 + 1);

      // Try to reveal with incorrect data
      const incorrectPosition = 6000n;
      await expect(
        vpop.reveal(
          marketCount,
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
      
      // Create commitment parameters
      const position = 5000n;
      const nonce = ethers.toBigInt(ethers.hexlify(ethers.randomBytes(32)));
      const wager = ethers.parseEther("0.5");

      // Calculate the commitment hash
      const commitmentHash = createCommitmentHash(position, wager, nonce);

      // Create commitment
      await vpop.commit(marketCount, commitmentHash, wager, { value: wager });

      // Advance time to reveal phase
      await time.increase(3600 + 1);

      // Reveal the commitment
      await vpop.reveal(
        marketCount,
        commitmentHash,
        position,
        wager,
        nonce
      );

      // Try to reveal the same commitment again
      await expect(
        vpop.reveal(
          marketCount,
          commitmentHash,
          position,
          wager,
          nonce
        )
      ).to.be.revertedWith("Commitment already revealed");
    });
  });
});







