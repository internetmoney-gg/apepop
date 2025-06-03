// import { HardhatUserConfig } from "hardhat/config";
// import "@nomicfoundation/hardhat-toolbox";

// const config: HardhatUserConfig = {
//   solidity: "0.8.28",
// };

// export default config;


require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();


// const INFURA_API_KEY = process.env.INFURA_KEY;
// SEPOLIA_PRIVATE_KEY = process.env.SEPOLIA_PRIVATE_KEY;
// SEPOLIA_PROTOCOL_PRIVATE_KEY = process.env.SEPOLIA_PROTOCOL_PRIVATE_KEY;

// MAINNET_PRIVATE_KEY = process.env.MAINNET_PRIVATE_KEY;

// console.log('process.env.MAINNET_PRIVATE_KEY: ',process.env.MAINNET_PRIVATE_KEY)


/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: "0.8.28",
  // allowUnlimitedContractSize: true,
  networks: {
    localhost: {
      // forking: {
      //   url: `https://mainnet.infura.io/v3/${process.env.INFURA_API_KEY}`,
      // },
      // chainId: 33139,
      cors: true,
      chainId: 31337,
      gasPrice: 2000000000,
      allowUnlimitedContractSize: true,      
    },
    
    // curtis: {
    //   url: "https://curtis.rpc.caldera.xyz/http",
    //   chainId: 33111,
    //   accounts: [process.env.CURTIS_PRIVATE_KEY],
    // }
    // remote: {
    //   url: 'http://ec2-3-89-186-112.compute-1.amazonaws.com:8545',
    //   chainId: 31337,
    //   // allowUnlimitedContractSize: true,
    //   accounts: [
    //     '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
    //     '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
    //     '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a',
    //     '0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6',
    //     '0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a',
    //     '0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba',
    //     '0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e'
    //   ]
    // },
    // sepolia: {
    //   url: `https://sepolia.infura.io/v3/${INFURA_API_KEY}`,
    //   accounts: [SEPOLIA_PRIVATE_KEY, SEPOLIA_PROTOCOL_PRIVATE_KEY],
    // },
    // mainnet: {
    //   url: `https://mainnet.infura.io/v3/${INFURA_API_KEY}`,
    //   accounts: [MAINNET_PRIVATE_KEY],
    // },
  },
  etherscan: {
    apiKey: process.env.ETHERSCAN_API_KEY,
  },
  ignition: {
    strategyConfig: {
      create2: {
        salt: "0x0000000000000000000000000000000000000000000000000000000000000000",
      },
    },
  },
};