import { config } from './config.js';
import { app } from './index.js';

app.listen(config.port, () => {
  console.log(`API server listening on http://localhost:${config.port}`);
});
