// Runs the level check off the main thread so the editor never stalls.
importScripts('../games/racer/core.js', 'check.js');

onmessage = (e) => {
  const t0 = Date.now();
  let res;
  try { res = RacerCheck.analyse(e.data.level); }
  catch (err) { res = { error: String((err && err.stack) || err) }; }
  res.id = e.data.id;
  res.ms = Date.now() - t0;
  const transfer = [];
  if (res.grid) transfer.push(res.grid.st.buffer, res.grid.reach.buffer);
  if (res.line) transfer.push(res.line.buffer);
  postMessage(res, transfer);
};
