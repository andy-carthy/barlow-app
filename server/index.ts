import express from 'express';
import cors from 'cors';
import { extractRoute } from './routes/extract';
import { ingestTapeRoute } from './routes/ingestTape';
import { processNoticeRoute } from './routes/processNotice';
import { runTestsRoute } from './routes/runTests';
import { runWaterfallRoute } from './routes/runWaterfall';
import { assembleReportRoute } from './routes/assembleReport';
import { generateNarrativesRoute } from './routes/generateNarratives';

const app = express();
const PORT = 3001;

app.use(cors({ origin: 'http://localhost:3000' }));
app.use(express.json({ limit: '50mb' }));

app.post('/api/extract', extractRoute);
app.post('/api/ingest-tape', ingestTapeRoute);
app.post('/api/process-notice', processNoticeRoute);
app.post('/api/run-tests', runTestsRoute);
app.post('/api/run-waterfall', runWaterfallRoute);
app.post('/api/assemble-report', assembleReportRoute);
app.post('/api/generate-narratives', generateNarrativesRoute);

app.listen(PORT, () => {
  console.log(`\n  Barlow API server running on http://localhost:${PORT}`);
  console.log(`  ANTHROPIC_API_KEY: ${process.env.ANTHROPIC_API_KEY ? 'set ✓' : 'NOT SET — extraction and narratives will fail'}\n`);
});
