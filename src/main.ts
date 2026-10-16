// Entry point of the test app. Each section of index.html has its own module; this file only
// starts them in order. Engine first, so every later plugin call goes to the chosen engine.
import { initImages } from './images';
import { initInk } from './ink';
import { initLive, initLiveListeners } from './live';
import { initResult } from './result';
import { initEngine, initStatus, refreshStatus, watchReady } from './status';

async function init(): Promise<void> {
  await initEngine();
  await initLiveListeners();

  initStatus();
  initInk();
  initLive();
  initImages();
  initResult();

  await refreshStatus();
  // The recognizer warms up in the background; show when it becomes ready and how long it took.
  void watchReady();
}

void init();
