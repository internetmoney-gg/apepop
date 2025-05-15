import {
  time,
  loadFixture,
} from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";
import { expect } from "chai";
import hre from "hardhat";
import { ethers } from "hardhat";

describe("VPOP", function () {
  // We define a fixture to reuse the same setup in every test.
  async function deployVPOPFixture() {
    const [owner, otherAccount] = await hre.ethers.getSigners();

    const VPOP = await hre.ethers.getContractFactory("VPOP");
    const vpop = await VPOP.deploy();

    return { vpop, owner, otherAccount };
  }

  describe("Market Creation", function () {
    it("Should create a market with correct parameters", async function () {
      const { vpop, owner } = await deployVPOPFixture();

      const marketParams = {
        title: "Test Market",
        description: "A test market description",
        lowerBound: ethers.parseEther("1"),
        upperBound: ethers.parseEther("10"),
        decimals: 18,
        minWager: ethers.parseEther("0.1"),
        decayFactor: ethers.parseEther("0.1"),
        commitDuration: 3600, // 1 hour
        revealDuration: 3600, // 1 hour
        percentile: 50,
        nonce: 1,
        ipfsHash: "QmTest123"
      };

      // Create the market
      const tx = await vpop.initializeMarket(
        marketParams.title,
        marketParams.description,
        marketParams.lowerBound,
        marketParams.upperBound,
        marketParams.decimals,
        marketParams.minWager,
        marketParams.decayFactor,
        marketParams.commitDuration,
        marketParams.revealDuration,
        marketParams.percentile,
        marketParams.nonce,
        marketParams.ipfsHash
      );

      // Get the market ID from the event
      const receipt = await tx.wait();
      const event = receipt?.logs[0];
      const marketId = event?.topics[1]; // The marketId is in the first indexed parameter

      // Verify the market was created correctly
      const market = await vpop.markets(marketId);
      expect(market.title).to.equal(marketParams.title);
      expect(market.description).to.equal(marketParams.description);
      expect(market.creator).to.equal(owner.address);
      expect(market.lowerBound).to.equal(marketParams.lowerBound);
      expect(market.upperBound).to.equal(marketParams.upperBound);
      expect(market.decimals).to.equal(marketParams.decimals);
      expect(market.minWager).to.equal(marketParams.minWager);
      expect(market.decayFactor).to.equal(marketParams.decayFactor);
      expect(market.commitDuration).to.equal(marketParams.commitDuration);
      expect(market.revealDuration).to.equal(marketParams.revealDuration);
      expect(market.percentile).to.equal(marketParams.percentile);
      expect(market.nonce).to.equal(marketParams.nonce);
      expect(market.ipfsHash).to.equal(marketParams.ipfsHash);
      expect(market.isActive).to.be.true;
    });

    it("Should fail when creating a market with invalid parameters", async function () {
      const { vpop } = await deployVPOPFixture();

      const marketParams = {
        title: "Test Market",
        description: "A test market description",
        lowerBound: ethers.parseEther("10"), // Higher than upperBound
        upperBound: ethers.parseEther("1"),  // Lower than lowerBound
        decimals: 19, // Invalid decimals
        minWager: 0, // Invalid minWager
        decayFactor: 0, // Invalid decayFactor
        commitDuration: 0, // Invalid commitDuration
        revealDuration: 0, // Invalid revealDuration
        percentile: 101, // Invalid percentile
        nonce: 1,
        ipfsHash: "" // Empty IPFS hash
      };

      await expect(
        vpop.initializeMarket(
          marketParams.title,
          marketParams.description,
          marketParams.lowerBound,
          marketParams.upperBound,
          marketParams.decimals,
          marketParams.minWager,
          marketParams.decayFactor,
          marketParams.commitDuration,
          marketParams.revealDuration,
          marketParams.percentile,
          marketParams.nonce,
          marketParams.ipfsHash
        )
      ).to.be.revertedWith("Lower bound must be less than upper bound");
    });

    it("Should increment market counter correctly", async function () {
      const { vpop } = await deployVPOPFixture();

      // Create first market
      await vpop.initializeMarket(
        "Market 1",
        "First market",
        ethers.parseEther("1"),
        ethers.parseEther("10"),
        18,
        ethers.parseEther("0.1"),
        ethers.parseEther("0.1"),
        3600,
        3600,
        50,
        1,
        "QmTest1"
      );

      // Create second market
      await vpop.initializeMarket(
        "Market 2",
        "Second market",
        ethers.parseEther("1"),
        ethers.parseEther("10"),
        18,
        ethers.parseEther("0.1"),
        ethers.parseEther("0.1"),
        3600,
        3600,
        50,
        2,
        "QmTest2"
      );

      // Check market count
      expect(await vpop.getMarketCount()).to.equal(3); // Starting from 1
    });
  });
});







