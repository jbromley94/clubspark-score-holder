
We want to build a service where spectators can decide to subscribe to specific Tennis matches and get notified every time the score changes.

Build a new ScoreHolder class for holding scores for different tennis matches using the skeleton `scoreHolder.ts` module in this folder. 
Requirements
* the producer can store an updated score for a given match by calling `putScore()`.
* The consumer can retrieve the latest score for a given match using `getScore()`.
* The consumer can wait for the next score for a given match using `waitForNextScore()`.
* The consumer can subscribe to (and unsubscribe from) score changes using `subscribe()`.
* The consumer can get the last N scores for a specific match by calling `getHistory`. N is defined when ScoreHolder class is instantiated.
* **No dependencies should be used in the implementation**, but they're fine in the tests.
* `waitForNextScore()` and `subscribe()` should respond to `putScore()` being called.

Feel free to rename these methods or change their signatures.
Keep in mind that:
* Scores will generally be produced faster than they are consumed.
* ScoreHolder will be used in a web server which handles concurrent requests and receives the score feed. Instances of ScoreHolder will be shared between requests handlers.
* There can be multiple consumers and producers.

A first set of unit tests has been provided. Feel free to change them as you see fit.

