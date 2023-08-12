const sqlite3 = require('sqlite3').verbose();
const ethers = require('ethers');
const fs = require('fs-extra');
const fetch = require('node-fetch');
const Bottleneck = require('bottleneck');
const ProgressBar = require('progress');

const { providerEndpoint, ethApiKey } = require('./secrets.json');

// Create a limiter that allows 4 requests per second
const limiter = new Bottleneck({
  minTime: 250,  // At least 250ms between each job
});

// Create a limiter that allows 20 requests per second
const limiterQuicknode = new Bottleneck({
  minTime: 50,  // At least 50ms between each job
});

// Connect to the Ethereum network. Replace with your own provider.
const provider = new ethers.providers.JsonRpcProvider(`${providerEndpoint}`);
const etherScanApi = 'https://api.etherscan.io/api';
const transactionEvalCount = 10;

// Mapping between contract addresses and names
const namedAddresses = {
  '0xdAC17F958D2ee523a2206206994597C13D831ec7': 'TetherToken',
  // Add more named addresses here
};

const excludeAddresses = [
  '0x8867fb1Dd92DbcCdf60453f031901B95537a27ca',
  // Add more addresses to exclude here
];

const bytecodeNames = {};
const excludeBytecodes = [];

let db = new sqlite3.Database('./bytecodes.db', sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (err) => {
  if (err) {
    console.error(err.message);
  }
});

db.serialize(() => {
  db.run('CREATE TABLE IF NOT EXISTS bytecodes(contract_address TEXT, bytecode TEXT, transaction_count INT);', (err) => {
    if (err) {
      console.error(err.message);
    }
  });
});

process.on('SIGINT', () => {
  console.log('\nCaught interrupt signal, closing database connection...');

  db.close((err) => {
    if (err) {
      console.error(err.message);
    }
    process.exit();
  });
});

const logAboveProgressBar = (message, bar) => {
  process.stdout.clearLine();
  process.stdout.cursorTo(0);
  console.log(message);
  bar.render();
};

const getTransactions = async (contractAddress, limiter, bar, retries = 3) => {
  return new Promise((resolve, reject) => {
    db.get('SELECT transaction_count FROM bytecodes WHERE contract_address = ?', [contractAddress], async (err, row) => {
      if (err) {
        reject(err.message);
      }
      if (row) {
//        logAboveProgressBar(`Transaction count for ${contractAddress} found in database: ${row.transaction_count}`, bar);
        resolve(row.transaction_count);
      } else {
        for (let i = 0; i < retries; i++) {
          try {
            const response = await limiter.schedule(() => fetch(
              `${etherScanApi}?module=account&action=txlist&address=${contractAddress}&startblock=0&endblock=99999999&sort=asc&apikey=${ethApiKey}`
            ));
            const data = await response.json();
            if (data.status === '1') {
              // Transactions successfully retrieved
              const transactionCount = data.result.length;
              db.run('INSERT OR IGNORE INTO bytecodes(contract_address, transaction_count) VALUES(?,?)', [contractAddress, transactionCount], (err) => {
                if (err) {
                  reject(err.message);
                } else {
                  resolve(transactionCount);
                }
              });
              return;
            } else {
              logAboveProgressBar(`Failed to fetch transactions for ${contractAddress}, retrying...`, bar);
            }
          } catch (error) {
            logAboveProgressBar(error, bar);
          }
        }
        logAboveProgressBar(`Failed to fetch transactions for ${contractAddress} after ${retries} retries.`, bar);
        resolve(0);
      }
    });
  });
};

const getBytecode = async (contractAddress, transactionCount, bar) => {
  return new Promise((resolve, reject) => {
    db.get('SELECT bytecode, transaction_count FROM bytecodes WHERE contract_address = ?', [contractAddress], async (err, row) => {
      if (err) {
        reject(err.message);
      }
      if (row && row.bytecode && row.bytecode.length > 100) {
//        logAboveProgressBar(`Data for ${contractAddress} found in database.`, bar);
        resolve(row);
      } else {
//        logAboveProgressBar(`Fetching data for ${contractAddress} from the network.`, bar);
        if (transactionCount < transactionEvalCount) {
          resolve(null);
        } else {
          let retries = 0;
          let bytecode = '';
          let txCount = row ? row.transaction_count : 0;
          while (retries < 3) {
            try {
              if (txCount === 0) {
                txCount = await getTransactions(contractAddress);
              }
              bytecode = await limiterQuicknode.schedule(() => provider.getCode(contractAddress));
              if (bytecode.length > 100) {
                break;
              }
              logAboveProgressBar(`Invalid bytecode fetched for ${contractAddress}, retrying...`, bar);
            } catch (error) {
              logAboveProgressBar(`Error while fetching data for ${contractAddress}, retrying...`, bar);
            }
            retries++;
          }

          if (bytecode.length > 100) {
            db.run('UPDATE bytecodes SET bytecode = ?, transaction_count = ? WHERE contract_address = ?', [bytecode, txCount, contractAddress], (err) => {
              if (err) {
                reject(err.message);
              } else {
                resolve({bytecode, transaction_count: txCount});
              }
            });
          } else {
            logAboveProgressBar(`Failed to fetch valid bytecode for ${contractAddress} after ${retries} attempts.`, bar);
            resolve(null);
          }
        }
      }
    });
  });
};

const getContractAddresses = async () => {
  const addressesFile = './addresses.txt';
  const data = await fs.readFile(addressesFile, 'utf-8');
  return data.split('\n').map(line => line.trim());
};

const run = async () => {
  const contractAddresses = await getContractAddresses();
  const bytecodeToAddresses = {};

  // Create a progress bar for getTransactions
  const barTransactions = new ProgressBar('Fetching Transactions :bar :percent :etas', { total: contractAddresses.length });

  const getTransactionsWithProgress = async (contractAddress, limiter) => {
    const result = await getTransactions(contractAddress, limiter, barTransactions);
    barTransactions.tick();
    return result;
  };

  const transactionPromises = contractAddresses.map(contractAddress => getTransactionsWithProgress(contractAddress, limiter));
  const transactionCounts = await Promise.all(transactionPromises);

  // Create a progress bar for getBytecode
  const barBytecodes = new ProgressBar('Fetching Bytecodes :bar :percent :etas', { total: contractAddresses.length });

  const getBytecodeWithProgress = async (contractAddress, transactionCount) => {
    const result = await getBytecode(contractAddress, transactionCount, barBytecodes);
    barBytecodes.tick();
    return result;
  };

  const bytecodePromises = contractAddresses.map((contractAddress, index) => {
    if (transactionCounts[index] > transactionEvalCount) {
      return getBytecodeWithProgress(contractAddress, transactionCounts[index]);
    }
  });
  const bytecodes = await Promise.all(bytecodePromises);

  bytecodes.forEach((data, index) => {
    if (data) {
      const { bytecode } = data;
      const address = contractAddresses[index];
      if (namedAddresses[address]) {
        bytecodeNames[bytecode] = namedAddresses[address];
      }
      if (excludeAddresses.includes(contractAddresses[index])) {
        excludeBytecodes.push(bytecode);
      }
      if (!bytecodeToAddresses[bytecode]) {
        bytecodeToAddresses[bytecode] = [];
      }
      bytecodeToAddresses[bytecode].push(contractAddresses[index]);
    }
  });

  for (const [bytecode, addresses] of Object.entries(bytecodeToAddresses)) {
    // Skip the duplicate check for the excluded bytecodes
    if (excludeBytecodes.includes(bytecode)) {
      continue;
    }

    // Get the name for the bytecode, if available
    const name = bytecodeNames[bytecode] ? `(${bytecodeNames[bytecode]}) ` : '';

    if (addresses.length > 1) {
      console.log(`Bytecode ${name}${bytecode.slice(0, 10)}... has duplicates at these addresses:`);
      for (const address of addresses) {
        console.log(`- ${address}`);
      }
      console.log();
    }
  }

  db.close((err) => {
    if (err) {
      console.error(err.message);
    }
  });
};

run();