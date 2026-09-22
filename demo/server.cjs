const ScoreHolder = require('../build/scoreHolder.js').default;
const { createScoreServer } = require('../build/server/scoreServer.js');

// All requests share this instance, so scores survive between requests.
const server = createScoreServer(new ScoreHolder());

server.listen(3000, '127.0.0.1', () => {
  console.info('Score demo listening at http://127.0.0.1:3000');
});
