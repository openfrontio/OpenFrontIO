import { expectExperiments } from "./Experiments";

// Main's first import, so it runs before any component module: the homepage
// sale banner (NewsBox) fetches the catalog as soon as it connects, before
// Main's body starts auth, and that fetch should wait (briefly) for the
// player's store experiment group rather than go out without it and be
// fetched again when the group lands.
expectExperiments();
