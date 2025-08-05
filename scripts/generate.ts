import { ethers } from "hardhat";
import { VPOP } from "../typechain-types";

async function main() {
  // Get the signer
  const [deployer] = await ethers.getSigners();
  console.log('Network:', await ethers.provider.getNetwork());
  console.log('Provider URL:', (ethers.provider as any).connection?.url || 'boof');
  console.log('Deployer address:', deployer.address);
  console.log('Deployer balance:', ethers.formatEther(await ethers.provider.getBalance(deployer.address)), 'ETH');

  // Get the deployed VPOP contract
  const vpopAddress = "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512"; // Replace with your deployed contract address
  const VPOP = await ethers.getContractFactory("VPOP");
  const vpop = await VPOP.attach(vpopAddress) as unknown as VPOP;

  // Create 20 markets with commit durations from 20 to 1 minutes
  console.log("\nCreating 20 markets with commit durations from 20 to 1 minutes...");
  
  const totalMarkets = 20;
  
  for (let i = totalMarkets; i >= 1; i--) {
    const minutes = i; // 20 to 1 minutes
    const commitDuration = minutes * 60; // Convert minutes to seconds
    const revealDuration = 3600; // 5 minute reveal duration
    
    console.log(`\nCreating market ${21-i}/20 with ${minutes} minute commit phase...`);
    
    const tx = await vpop.initializeMarket(
      ethers.ZeroAddress, // ETH market
      0, // lower bound: 0
      100, // upper bound: 100
      1, // decimals
      ethers.parseEther("0.1"), // min wager: 0.1 ETH
      20, // decay factor
      commitDuration,
      revealDuration,
      50, // winning percentile
      `QmMarket${minutes}min` // IPFS hash
    );
    
    const receipt = await tx.wait();
    const marketId = await vpop.getMarketCount();
    console.log(`Market created with ID: ${marketId}`);
    console.log(`Commit duration: ${minutes} minutes`);
    console.log(`Reveal duration: ${revealDuration/60} minutes`);
  }
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}); 