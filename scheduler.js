const cron = require('node-cron');
const http = require('http');

const PORT = process.env.PORT || 3000;

const request = (path, method = 'POST') => {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: PORT,
      path: path,
      method: method,
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          resolve(data);
        }
      });
    });

    req.on('error', (error) => {
      reject(error);
    });

    if (method === 'POST') {
      req.write(JSON.stringify({}));
    }
    
    req.end();
  });
};

async function runPipeline() {
  console.log(`[${new Date().toISOString()}] Starting scheduled pipeline...`);
  try {
    const result = await request('/api/pipeline', 'POST');
    console.log('Pipeline result:', result);
    console.log(`[${new Date().toISOString()}] Pipeline finished successfully.`);
  } catch (error) {
    console.error('Pipeline error:', error.message);
  }
}

// Run every 6 hours locally. Keep `npm run dev` running in another terminal.
console.log('Scheduler started. Pipeline will run every 6 hours.');
console.log('Ensure your Next.js server is running on port ' + PORT);

cron.schedule('0 */6 * * *', () => {
  runPipeline();
});

// Run once on startup if you want immediate results (optional)
// runPipeline();
